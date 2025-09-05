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

export function readDirectory(file: string) {
	return fs.promises.readdir(file, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
}

export function directories(files: fs.Dirent[]) {
	return files.filter(i => i && i.isDirectory()).map(i => i.name);
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

//-----------------------------------------------------------------------------
//	Projects
//-----------------------------------------------------------------------------

export type Properties = Record<string, string>;

export interface ProjectItemEntry {
	name: string;
	data: Record<string, any>;
}

export function makeFileEntry(fullPath: string) {
	return {
		name: path.basename(fullPath),
		data: {fullPath: fullPath},
	};
}

export class Folder  {
	public folders: Folder[] = [];
	
	constructor(public name: string, public entries: ProjectItemEntry[] = []) {}

	public add(item : ProjectItemEntry) {
		this.entries.push(item);
	}
	public addFolder(item : Folder) {
		this.folders.push(item);
	}
	public remove(item : ProjectItemEntry) {
		const index = this.entries.indexOf(item);
		if (index >= 0)
			this.entries.splice(index, 1);
	}
	public removeFolder(item : Folder) {
		const index = this.folders.indexOf(item);
		if (index >= 0)
			this.folders.splice(index, 1);
	}
	public find(item : ProjectItemEntry) : Folder | undefined {
		if (this.entries.indexOf(item) !== -1)
			return this;
		for (const i of this.folders) {
			const found = i.find(item);
			if (found)
				return found;
		}
	}
	public findEntry(name: string, value: string) : ProjectItemEntry | undefined {
		return this.entries.find(i => i.data[name] == value);
	}

	public findFile(fullpath: string) : [Folder, ProjectItemEntry] | undefined {
		const entry = this.findEntry('fullPath', fullpath);
		if (entry)
			return [this, entry];

		for (const i of this.folders) {
			const found = i.findFile(fullpath);
			if (found)
				return found;
		}
	}

	static async read(dirname: string, name: string) : Promise<Folder> {
		return readDirectory(dirname).then(async files => {
			const folder = new Folder(name);
			folder.folders = await Promise.all(files.filter(i => i.isDirectory()).map(async i => Folder.read(path.join(dirname, i.name), i.name)));
			folder.entries = files.filter(i => i.isFile()).map(i => makeFileEntry(path.join(dirname, i.name)));
			return folder;
		});
	}

}

export class FolderTree {
	constructor(public root = new Folder("")) {}

	public addDirectory(relativePath?: string) : Folder {
		let folder  = this.root;
		if (relativePath) {
			const parts = relativePath.split(path.sep);
			for (const part of parts) {
				if (part && part !== "." && part != "..") {
					let next = folder.folders.find(e => e.name == part);
					if (!next) {
						next = new Folder(part);
						folder.folders.push(next);
					}
					folder = next;
				}
			}
		}
		return folder;
	}
	public add(relativePath: string, item : ProjectItemEntry) {
		this.addDirectory(path.dirname(relativePath)).add(item);
	}
	public find(item : ProjectItemEntry) {
		return this.root.find(item);
	}
	public findFile(fullpath: string) {
		return this.root.findFile(fullpath);
	}
}

export interface ProjectConfiguration {
	Configuration:	string,
	Platform:		string,
	build:			boolean,
	deploy:			boolean
}

export class Project {
	public static all: Record<string, Project> = {};

	public dependencies:	Project[] = [];
	public childProjects:	Project[] = [];
	public configuration:	Record<string, ProjectConfiguration> = {};
	public ready: 			Promise<void> = Promise.resolve();

	constructor(_parent: any, public type:string, public name:string, public fullpath:string, public guid:string, protected solution_dir: string) {
		Project.all[this.guid] = this;
	}

	public solutionRead(_m: string[], _basePath: string): ((line: string) => void) | undefined {
		return undefined;
	}

	public solutionWrite(_basePath: string) : string {
		return '';
	}

	public addDependency(proj: Project): void {
		if (this.dependencies.indexOf(proj) === -1)
			this.dependencies.push(proj);
	}

	public addFile(name: string, filepath: string, _markDirty = true): boolean {
		return false;
	}
	public removeFile(_file: string) {
		return false;
	}

	public addProject(project?: Project): void {
		if (project)
			this.childProjects.push(project);
	}
	public removeProject(project?: Project): void {
		if (project)
			utils.arrayRemove(this.childProjects, project);
	}

	public setProjectConfiguration(name: string, config: ProjectConfiguration) {
		this.configuration[name] = config;
	}
	public configurationList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Configuration))];
	}
	public platformList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Platform))];
	}

	dirty(): void {}
	clean(): void {}
}

export const known_guids : Record<string, {
	make:	new (parent: any, type: string, name: string, fullpath: string, guid: string, solution_dir: string)=>Project,
	icon?:	string,
	ext?:	string,
}> = {
	/*CRM*/	                	"{88A30576-7583-4F75-8136-5EFD2C14ADFF}": {make: Project},	
	/*CRM plugin*/	         	"{4C25E9B5-9FA6-436C-8E19-B395D2A65FAF}": {make: Project},	
	/*IL project*/	         	"{95DFC527-4DC1-495E-97D7-E94EE1F7140D}": {make: Project},	
	/*InstallShield*/	      	"{FBB4BD86-BF63-432A-A6FB-6CF3A1288F83}": {make: Project},	
	/*LightSwitch Project*/		"{ECD6D718-D1CF-4119-97F3-97C25A0DFBF9}": {make: Project},	
	/*Micro Framework*/	    	"{B69E3092-B931-443C-ABE7-7E7B65F2A37F}": {make: Project},	
	/*Miscellaneous Files*/		"{66A2671D-8FB5-11D2-AA7E-00C04F688DDE}": {make: Project},	
	/*Nomad*/	              	"{4B160523-D178-4405-B438-79FB67C8D499}": {make: Project},	
	/*Synergex*/	           	"{BBD0F5D1-1CC4-42FD-BA4C-A96779C64378}": {make: Project},	
	/*Unloaded Project*/	   	"{67294A52-A4F0-11D2-AA88-00C04F688DDE}": {make: Project},	
	/*WiX Setup*/	          	"{930C7802-8A8C-48F9-8165-68863BCCD9DD}": {make: Project},	
};
