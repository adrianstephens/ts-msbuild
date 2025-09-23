import * as fs from 'fs';
import * as path from 'path';
import * as utils from '@isopodlabs/utilities';
import * as xml from '@isopodlabs/xml';

export { Project, Folder, FolderTree, ProjectItemEntry, FileEntry as makeFileEntry } from './Project';
export { Solution, SolutionFolder } from './Solution';
export { MsBuildBase, MsBuildProject, Items, PropertyContext, Origins } from './MsBuild';
export * as Locations from './Locations';

//-----------------------------------------------------------------------------
//	fs helpers
//-----------------------------------------------------------------------------

export function exists(file: string): Promise<boolean> {
	return fs.promises.access(file).then(() => true).catch(() => false);
}


export class Glob {
	private readonly regexp: RegExp;

	constructor(pattern: string | string[]) {
		if (typeof pattern === 'string' && pattern.includes(';'))
			pattern = pattern.split(';');
		const re = Array.isArray(pattern)
			? '(' + pattern.map(s => toRegExp(s)).join('|') + ')'
			: toRegExp(pattern);
		this.regexp = new RegExp(re + '$');
	}
	public test(input: string): boolean {
		return this.regexp?.test(input) ?? false;
	}
}

export function toOSPath(input: string | undefined): string {
	if (!input)
		return '';
	return input
		.replace(/\\/g, path.sep)
		.trim();
		//.replace(new RegExp(`${path.sep}$`), '');
}

function toRegExp(pattern: string) {
	let re = "", range = false, block = false;
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		switch (c) {
			default:	re += c; break;
			case ".":
			case "/":
			case "\\":
			case "$":
			case "^":	re += "\\" + c; break;
			case "?":	re += "."; break;
			case "[":	re += "["; range = true; break;
			case "]":	re += "]"; range = false; break;
			case "!":	re += range ? "^" : "!"; break;
			case "{":	re += "("; block = true; break;
			case "}":	re += ")"; block = false; break;
			case ",":	re += block ? "|" : "\\,"; break;
			case "*":
				if (pattern[i + 1] === "*") {
					re += ".*";
					i++;
					if (pattern[i + 1] === "/" || pattern[i + 1] === "\\")
						i++;
				} else {
					re += "[^/\\\\]*";
				}
				break;
		}
	}
	return re;
}


function anchor(re: string) {
	return new RegExp(`^${re}$`);
}

const posixClasses: Record<string, string> = {
    alnum: 	'\\p{L}\\p{Nl}\\p{Nd}',
    alpha: 	'\\p{L}\\p{Nl}',
    ascii: 	'\\x00-\\x7f',
    blank: 	'\\p{Zs}\\t',
    cntrl: 	'\\p{Cc}',
    digit: 	'\\p{Nd}',
    graph: 	'^\\p{Z}\\p{C}',
    lower: 	'\\p{Ll}',
    print: 	'\\p{C}',
    punct: 	'\\p{P}',
    space: 	'\\p{Z}\\t\\r\\n\\v\\f',
    upper: 	'\\p{Lu}',
    word: 	'\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}',
    xdigit: 'A-Fa-f0-9',
};

function _globRe(glob: string): string {
	let result = '';
	let depth = 0;

	for (let i = 0; i < glob.length; ++i) {
		let c = glob[i];
		switch (c) {
			case '\\':
				c = glob[++i];
				if ('*?+.,^$()|[]a-zA-Z'.includes(c))
					result += '\\';
				break;

			case '*':
				if (glob[i + 1] === '*') {
					result += '.*';
					++i;
				} else {
					result += '[^/]*';
				}
				continue;

			case '?':
				c = '.';
				break;

			case '+': case '.': case '^': case '$': case '(': case ')': case '|':
				result += `\\`;
				break;

			case '[': {
				const end = glob.indexOf(']', i + 1);
				if (end > i) {
					const next = glob[i + 1];
					if (next === ':' && glob[end - 1] === ':') {
						const p = posixClasses[glob.slice(i + 2, end - 1)];
						if (p) {
							result += `[${p}]`;
							i = end;
							continue;
						} else {
							console.log(`Warning: Unknown POSIX class ${glob.slice(i + 2, end - 1)} in glob pattern ${glob}`);
						}
					}
					const neg = next === '!' || next === '^';
					result += `[${neg ? '^' : ''}${glob.slice(neg ? i + 2 : i + 1, end)}]`;
					i = end;
					continue;
				}
				result += '\\';
				break;
			}

			case '{':
				++depth;
				c = '(';
				break;

			case '}':
				if (depth > 0) {
					--depth;
					c = ')';
				}
				break;

			case ',':
				if (depth > 0)
					c = '|';
				break;

		}
		result += c;
	}
	if (depth > 0) {
		console.log(`Warning: Unmatched { in glob pattern ${glob}`);
		result += ')'.repeat(depth);
	}
	return result;
}


export function globRe(glob: string) {
	return anchor(_globRe(glob));
}

export function globReMulti(globs: string[]) {
	return anchor(globs.map(_globRe).join('|'));
}



export async function search(pattern: string, _exclude?:string | string[], onlyfiles?: boolean): Promise<string[]> {
	const m = /[*?[{}]/.exec(pattern);
	if (!m)
		return [pattern];

	const sep 		= pattern.lastIndexOf('\\', m.index);
	const basePath	= pattern.substring(0, sep);
	const include	= new Glob(pattern.substring(sep + 1));
	const exclude	= _exclude ? new Glob(_exclude) : undefined;

	const recurse = async (basePath: string) => {
		const items = await fs.promises.readdir(basePath, {withFileTypes: true}).catch(() => [] as fs.Dirent[]);
		const result: string[] = [];
		for (const i of items) {
			if (onlyfiles === true && !i.isFile())
				continue;

			const filename = path.join(basePath, i.name);
			if (exclude && exclude.test(filename))
				continue;

			if (onlyfiles === i.isFile() && include.test(filename))
				result.push(filename);

			if (i.isDirectory())
				result.push(...await recurse(filename));

		}
		return result;
	};
	return recurse(basePath);
}

//-----------------------------------------------------------------------------
//	xml helpers
//-----------------------------------------------------------------------------

export async function xml_load(filename : string) : Promise<xml.Element | undefined> {
	return fs.promises.readFile(filename, "utf-8").then(content	=> xml.parse(content)).catch(() => undefined);
}

export async function xml_save(filename : string, element: xml.Element) : Promise<void> {
	return fs.promises.writeFile(filename, element.toString()).catch(error => {
		console.log(`Failed to save ${filename} : ${error}`);
	});
}

export const XMLCache	= utils.makeCache(xml_load);
