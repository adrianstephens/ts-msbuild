import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as utils from '@isopodlabs/utilities';
import * as xml from '@isopodlabs/xml';

export { Project, Folder, FolderTree, ProjectItemEntry, FileEntry as makeFileEntry } from './Project';
export { Solution, SolutionFolder } from './Solution';
export { MsBuildBase, MsBuildProject, Items, PropertyContext, Origins } from './MsBuild';
export * as Locations from './Locations';

export const stats = {
	depth: 0,
	exists: 0,
	checkConditional: 0,
};

//-----------------------------------------------------------------------------
//	fs helpers
//-----------------------------------------------------------------------------

export async function exists(file: string): Promise<boolean> {
	stats.exists++;
	try {
		await fs.promises.access(file);
		return true;
	} catch {
		return false;
	}
}

export async function readDirectory(file: string) {
	try {
		return await fs.promises.readdir(file, { withFileTypes: true });
	} catch {
		return [] as fs.Dirent[];
	}
}

export function directories(files: fs.Dirent[]) {
	return files.filter(e => e && e.isDirectory()).map(e => e.name);
}


export class Glob {
	private readonly regexp: RegExp;

	constructor(pattern: string | string[]) {
		try {
			if (typeof pattern === 'string' && pattern.includes(';'))
				pattern = pattern.split(';');
			const re = Array.isArray(pattern)
				? '(' + pattern.map(s => toRegExp(s)).join('|') + ')'
				: toRegExp(pattern);
			this.regexp = new RegExp(re + '$');
		} catch (error) {
			this.regexp = /./g;
			console.log(`Invalid glob pattern ${pattern} : ${error}`);
		}
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
		const items = await readDirectory(basePath);
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

export async function exec(command: string, args: string[] = []) {
	return new Promise<string>((resolve, reject) => child_process.execFile(command, args, (_error, stdout) => {
		if (_error)
			reject(_error);
		else
			resolve(stdout);
	}));
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
