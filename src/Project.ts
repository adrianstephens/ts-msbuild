import * as fs from 'fs';
import * as path from 'path';
import * as utils from '@isopodlabs/utilities';

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
		return fs.promises.readdir(dirname, { withFileTypes: true }).catch(() => [] as fs.Dirent[]).then(async files => {
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
	private static all: Record<string, Project> = {};
	public static getFromId(id: string): Project | undefined {
		return Project.all[id.toUpperCase()];
	}

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

	public addDependency(proj: Project | undefined): void {
		if (proj && this.dependencies.indexOf(proj) === -1)
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

interface KnownProjectEntry {
	make:	new (parent: any, type: string, name: string, fullpath: string, guid: string, solution_dir: string)=>Project,
	type?:	string,
	ext?:	string,
}

const known_guids : Record<string, KnownProjectEntry> = {};
let known_exts: Record<string, string> | undefined;

export function addKnownProjects(known: Record<string, KnownProjectEntry>) {
	Object.assign(known_guids, known);
}

export function createProject(parent: any, type: string, name: string, fullpath: string, guid: string) {
	const basePath 	= path.dirname(parent.fullpath);
	const known 	= known_guids[type];
	return known
		? new known.make(parent, type, name, fullpath, guid, basePath)
		: new Project(parent, type, name, fullpath, guid, basePath);
}

export function getProjectType(guid: string) : string | undefined {
	return known_guids[guid]?.type;
}


export function getProjectTypeFromExt(ext: string) : string | undefined {
	if (!known_exts)
		known_exts = Object.fromEntries(Object.entries(known_guids).filter(([_, v]) => v.ext).map(([k, v]) => [v.ext!, k]));
	return known_exts[(ext[0] === '.' ? ext.slice(1) : ext).toLowerCase()];
}