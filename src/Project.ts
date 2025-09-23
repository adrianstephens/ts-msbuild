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

export function FileEntry(fullPath: string) {
	return {
		name: path.basename(fullPath),
		data: {fullPath: fullPath},
	};
}

export class Folder  {
	folders: Folder[] = [];
	entries: ProjectItemEntry[] = [];
	
	constructor(protected _name: string) {}

	get name() {
		return this._name;
	}
	set name(v: string) {
		this._name = v;
	}
	add(item : ProjectItemEntry) {
		this.entries.push(item);
	}
	addFolder(name : string) {
		const folder = new Folder(name);
		this.folders.push(folder);
		return folder;
	}
	remove(item : ProjectItemEntry) {
		const index = this.entries.indexOf(item);
		if (index >= 0)
			this.entries.splice(index, 1);
	}
	removeFolder(item : Folder) {
		const index = this.folders.indexOf(item);
		if (index >= 0)
			this.folders.splice(index, 1);
	}
	find(item : ProjectItemEntry) : Folder | undefined {
		if (this.entries.indexOf(item) !== -1)
			return this;
		for (const i of this.folders) {
			const found = i.find(item);
			if (found)
				return found;
		}
	}
	findEntry(name: string, value: string) : ProjectItemEntry | undefined {
		return this.entries.find(i => i.data[name] == value);
	}

	findFile(fullpath: string) : [Folder, ProjectItemEntry] | undefined {
		const entry = this.findEntry('fullPath', fullpath);
		if (entry)
			return [this, entry];

		for (const i of this.folders) {
			const found = i.findFile(fullpath);
			if (found)
				return found;
		}
	}

}

export class FolderTree {
	constructor(public root = new Folder("")) {}

	addDirectory(relativePath: string|undefined) {
		let folder  = this.root;
		if (relativePath) {
			const parts = relativePath.split(path.sep).reduce((acc, cur) => {
				if (cur === '..')
					acc.pop();
				else if (cur && cur !== '.')
					acc.push(cur);
				return acc;
			}, [] as string[]);

			for (const part of parts) {
				let next = folder.folders.find(e => e.name == part);
				if (!next)
					next = folder.addFolder(part);
				folder = next;
			}
		}
		return folder;
	}
	add(relativePath: string, item : ProjectItemEntry) {
		this.addDirectory(path.dirname(relativePath)).add(item);
	}
	find(item : ProjectItemEntry) {
		return this.root.find(item);
	}
	findFile(fullpath: string) {
		return this.root.findFile(fullpath);
	}
}

export interface ProjectConfiguration {
	Configuration:	string,
	Platform:		string,
	build:			boolean,
	deploy:			boolean
}

export interface ProjectContainer {
	basedir: string;
	dirty(): void;
}


interface KnownProjectEntry {
	make:	new (container: ProjectContainer, type: string, name: string, fullpath: string, guid: string)=>Project,
	type?:	string,
	ext?:	string,
}

const known_guids : Record<string, KnownProjectEntry> = {};
let known_exts: Record<string, string> | undefined;

export abstract class Project {
	private static all: Record<string, Project> = {};

	static getFromId(id: string): Project | undefined {
		return Project.all[id.toUpperCase()];
	}
	static create(container: ProjectContainer, type: string, name: string, fullpath: string, guid: string) {
		const constructor 	= known_guids[type]?.make ?? BlankProject;
		return new constructor(container, type, name, fullpath, guid);
	}

	static addKnown(known: Record<string, KnownProjectEntry>) {
		Object.assign(known_guids, known);
	}

	static typeFromExt(ext: string) : string | undefined {
		if (!known_exts)
			known_exts = Object.fromEntries(Object.entries(known_guids).filter(([_, v]) => v.ext).map(([k, v]) => [v.ext!, k]));
		return known_exts[(ext[0] === '.' ? ext.slice(1) : ext).toLowerCase()];
	}

	protected solution_dir: string;
	dependencies:	Project[] = [];
	childProjects:	Project[] = [];
	configuration:	Record<string, ProjectConfiguration> = {};
	ready: 			Promise<void> = Promise.resolve();

	get name()			{ return this._name; }
	set name(v: string) { throw "can't rename"; }

	constructor(container: ProjectContainer, public type:string, protected _name:string, public fullpath:string, public guid:string) {
		this.solution_dir = container.basedir;
		Project.all[this.guid] = this;
	}

	abstract load() : Promise<void>;	//reload
	abstract save(): Promise<void>;		//save if changed

	abstract solutionRead(_m: string[], _basePath: string): ((line: string) => void) | undefined;
	abstract solutionWrite(_basePath: string) : string;

	abstract addFile(name: string, filepath: string): boolean;
	abstract getFolders(view: string): Promise<FolderTree>;

	// final implementations

	get shortType() { return known_guids[this.type]?.type; }

	addDependency(proj: Project | undefined): void {
		if (proj && this.dependencies.indexOf(proj) === -1)
			this.dependencies.push(proj);
	}

	addProject(proj: Project | undefined): void {
		if (proj)
			this.childProjects.push(proj);
	}
	removeProject(proj: Project | undefined): void {
		if (proj)
			utils.array.remove(this.childProjects, proj);
	}

	setProjectConfiguration(name: string, config: ProjectConfiguration) {
		this.configuration[name] = config;
	}
	configurationList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Configuration))];
	}
	platformList() : string[] {
		return [...new Set(Object.values(this.configuration).map(i => i.Platform))];
	}

}

export class BlankProject extends Project {
	async load() {}
	async save() {}
	solutionRead(_m: string[], _basePath: string) : ((line: string) => void) | undefined {
		return undefined;
	}
	solutionWrite(_basePath: string) : string {
		return '';
	}
	addFile(_name: string, _filepath: string): boolean {
		return false;
	}
	getFolders(_view: string) {
		return Promise.resolve(new FolderTree());
	}
}
