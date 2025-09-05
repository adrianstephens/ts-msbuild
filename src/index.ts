import * as fs from 'fs';
import * as path from 'path';
import * as utils from '@isopodlabs/utilities';
import * as xml from '@isopodlabs/xml';

export { Solution } from './Solution';
export { PropertyContext, Origins } from './MsBuild';

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
	return fs.promises.readFile(filename, "utf-8").then(content	=> content ? xml.parse(content) : undefined);
}

export async function xml_save(filename : string, element: xml.Element) : Promise<void> {
	return fs.promises.writeFile(filename, element.toString()).catch(error => {
		console.log(`Failed to save ${filename} : ${error}`);
	});
}

export const XMLCache	= utils.makeCache(xml_load);
