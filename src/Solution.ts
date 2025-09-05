import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as binary from '@isopodlabs/binary';
import * as CompDoc from '@isopodlabs/binary_libs/CompoundDocument';
import * as utils from '@isopodlabs/utilities';
import { Project, ProjectItemEntry, known_guids } from './index';

export class NonMSBuildProject extends Project {
	public solutionWrite(_basePath: string) : string {
		return write_section('ProjectSection', 'ProjectDependencies', 'preProject', Object.fromEntries(this.dependencies.map(i => [i.name, i.name])));
	}
}

export class SolutionFolder extends NonMSBuildProject {
	public solutionItems: ProjectItemEntry[] = [];

	constructor(public parent:Solution, public type:string, public name:string, public fullpath:string, public guid:string, protected solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);
	}

	public dirty() {
		this.parent.dirty();
	}

	public solutionRead(m: string[], basePath: string) {
		if (m[1] === "ProjectSection(SolutionItems)") {
			return (s: string) => {
				const m = assign_re.exec(s);
				if (m)
					this.addFile(path.basename(m[1]), path.resolve(basePath, m[2].trim()), false);
			};
		}
	}
	public solutionWrite(basePath: string) : string {
		return super.solutionWrite(basePath) + write_section('ProjectSection', 'SolutionItems', 'preProject', Object.fromEntries(this.solutionItems.map(i => {
			const rel = path.relative(basePath, i.data.fullPath);
			return [rel, rel];
		})));
	}

	public addFile(name: string, filepath: string, markDirty: boolean): boolean {
		this.solutionItems.push( {
			name: name,
			data: {
				fullPath: filepath,
				relativePath: path.relative(this.fullpath, filepath),
			}
		});
		if (markDirty)
			this.dirty();
		return true;
	}
	
	public removeEntry(entry: ProjectItemEntry): boolean {
		this.dirty();
		return utils.arrayRemove(this.solutionItems, entry);
	}
	
	public removeFile(file: string): boolean {
		const index = this.solutionItems.findIndex(i => i.data.fullPath == file);
		if (index != -1) {
			this.solutionItems.splice(index, 1);
			this.dirty();
			return true;
		}
		return false;
	}
}

export class WebProject extends NonMSBuildProject {
	public webProperties:	Record<string, string> = {};

	public solutionWrite(basePath: string) : string {
		return super.solutionWrite(basePath) + write_section('ProjectSection', 'WebsiteProperties', 'preProject', this.webProperties);
	}

	public solutionRead(m: string[]) {
		if (m[1] === "ProjectSection(WebsiteProperties)") {
			return (s: string) => {
				const m = assign_re.exec(s);
				if (m)
					this.webProperties[m[1]] = m[2].trim();
			};
		}
	}
}

export class WebDeploymentProject extends Project {
}

Object.assign(known_guids, {
	/*Web Site*/			"{E24C65DC-7377-472B-9ABA-BC803B73C61A}": {make: WebProject},
	/*Solution Folder*/		"{2150E333-8FDC-42A3-9474-1A3956D46DE8}": {make: SolutionFolder,					icon:"FolderClosed"},
	/*wdProjectGuid*/ 		"{2CFEAB61-6A3B-4EB8-B523-560B4BEEF521}": {make: WebDeploymentProject},
});

const known_exts = Object.fromEntries(Object.entries(known_guids).filter(([_, v]) => v.ext).map(([k, v]) => [v.ext!, k]));

function createProject(parent: Solution, type: string, name: string, fullpath: string, guid: string) {
	const basePath 	= path.dirname(parent.fullpath);
	const known 	= known_guids[type];
	return known
		? new known.make(parent, type, name, fullpath, guid, basePath)
		: new Project(parent, type, name, fullpath, guid, basePath);
}

export function getProjectIconName(guid: string) : string | undefined {
	return known_guids[guid]?.icon;
}

class Histogram {
	private data: Record<string, number> = {};
	add(key: string) 	{ this.data[key] = (this.data[key] || 0) + 1; }
	get(key: string) 	{ return this.data[key] || 0; }
    keys()				{ return Object.keys(this.data); }
    clear() 			{ for (const key of this.keys()) delete this.data[key]; }
}

function best_config(configs: string[], config: string, histogram: Histogram) {
	if (configs.length == 0 || configs.includes(config))
		return config;
	const counts	= configs.map(i => histogram.get(i));
	const max		= counts.reduce((acc, i) => Math.max(acc, i));
	return configs[counts.indexOf(max)];
}

//-----------------------------------------------------------------------------
//	line parsing, writing
//-----------------------------------------------------------------------------

const assign_re	= /\s*(.*?)\s*=\s*(.*)/;

class LineParser {
	private _currentLineIndex = -1;
	public constructor(private lines: string[]) {}

	public currentLine(): string {
		return this.lines[this._currentLineIndex].trim();
	}
	public readLine(): string | null {
		if (this._currentLineIndex + 1 >= this.lines.length)
			return null;
		return this.lines[++this._currentLineIndex].trim();
	}
	public parseSection(end : string, func : (str: string) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end)
			func(str);
	}
	public parseSection_re(end: string, re: RegExp, func: (m: RegExpExecArray) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end) {
			const m = re.exec(str);
			if (m)
				func(m);
		}
	}
}

function write_section(type:string, name:string, when: string, section: Record<string, string>) {
	const entries = Object.entries(section);
	return entries.length == 0 ? '' : `\t${type}(${name}) = ${when}\n${entries.map(([k,v]) => `\t\t${k} = ${v}`).join('\n')}\n\tEnd${type}\n`;
}

//-----------------------------------------------------------------------------
//	suo helpers
//-----------------------------------------------------------------------------

const string0Type	= binary.StringType(binary.UINT32_LE, 'utf16le', true);
const stringType	= binary.StringType(binary.UINT32_LE, 'utf16le', false);
const string1Type	= binary.StringType(binary.UINT32_LE, 'utf16le', true, 1);
const stringArrayType = binary.ArrayType(binary.UINT32_LE, string1Type);

function read_token(reader: binary.stream) {
	const token = binary.read(reader, binary.UINT16_LE);
	switch (token) {
		case 3: return binary.read(reader, binary.UINT32_LE);
		case 8: return binary.read(reader, stringType);
		default: return String.fromCharCode(token);
	}
}

function read_config(data: Uint8Array) {
	const config : Record<string, any> = {};
	const reader = new binary.stream(data);
	while (reader.remaining()) {
		const name = binary.read(reader, string0Type);
		let _token = read_token(reader);	//=
		const value = read_token(reader);
		config[name] = value;
		_token = read_token(reader);//';'
	}

	return config;
}

function write_token(writer: binary.stream, token: any) {
	switch (typeof token) {
		case 'number': binary.write(writer, binary.UINT16_LE, 3); binary.write(writer, binary.UINT32_LE, token); break;
		case 'string': binary.write(writer, binary.UINT16_LE, 8); binary.write(writer, stringType, token); break;
		default: throw "bad token";
	}
}
function write_char_token(writer: binary.stream, token: string) {
	binary.write(writer, binary.UINT16_LE, token.charCodeAt(0));
}

function write_config(config : Record<string, any>): Uint8Array {
	const writer = new binary.growingStream();
	Object.entries(config).forEach(([name, value]) => {
		binary.write(writer, string0Type, name);
		write_char_token(writer, '=');	//=
		write_token(writer, value);
		write_char_token(writer, ';');	//=
	});
	return writer.terminate();
}

async function open_suo(filename: string) : Promise<CompDoc.Reader> {
	return fs.promises.readFile(filename).then(bytes => {
		if (bytes) {
			const h = new CompDoc.Header(new binary.stream(bytes));
			if (h.valid())
				return new CompDoc.Reader(bytes.subarray(h.sector_size()), h);
		}
		throw('invalid');
	});
}

function suo_path(filename: string) {
	return path.join(path.dirname(filename), '.vs', 'shared', 'v17', '.suo');
}

//-----------------------------------------------------------------------------
//	Solution
//-----------------------------------------------------------------------------

export class Solution {
	public projects:		Record<string, Project> = {};
	public parents:			Record<string, Project> = {};
	public debug_include:	string[]	= [];
	public debug_exclude:	string[]	= [];

	private config_list: 	string[]	= [];
	private platform_list: 	string[]	= [];

	private header						= '';
	private VisualStudioVersion			= '';
	private MinimumVisualStudioVersion	= '';
	private global_sections: Record<string, {section: Record<string, string>, when:string}> = {};
	private	active						= [0, 0];
	private	config:			Record<string, any> = {};
	private writing			= false;


	update = new utils.CallCombiner(async () => {
		this.writing = true;
		await fs.promises.writeFile(this.fullpath, this.format());
		setTimeout(() => this.writing = false, 1000);
	}, 2000);

	update_suo = new utils.CallCombiner(async () => {
		const suopath = suo_path(this.fullpath);
		open_suo(suopath).then(suo => {
			const configStream = suo.find("SolutionConfiguration");
			if (configStream) {
				const config	= this.config;
				const data2 	= write_config(config);
				const config2	= read_config(data2);
				console.log(config2.toString());
				suo.write(configStream, data2);
				suo.flush(suopath);
			}
		});
	}, 2000);

	public get startup() : Project | undefined {
		return this.projects[this.config.StartupProject];
	}
	public set startup(project: Project | string) {
		if (typeof project !== 'string')
			project = project.guid;
		if (this.config.StartupProject !== project) {
			this.config.StartupProject = project;
			this.dirty_suo();
		}
	}

	public get activeConfiguration() {
		return {
			Configuration:	this.config_list[this.active[0]],
			Platform: 		this.platform_list[this.active[1]]
		};
	}
	public set activeConfiguration({Configuration, Platform}: {Configuration: string, Platform: string}) {
		const c = this.config_list.indexOf(Configuration);
		const p = this.platform_list.indexOf(Platform);

		if ((c >= 0 && c !== this.active[0]) || (p >= 0 && p !== this.active[1])) {
			if (c >= 0)
				this.active[0]	= c;
			else
				Configuration	= this.config_list[this.active[0]];

			if (p >= 0)
				this.active[1]	= p;
			else
				Platform	= this.platform_list[this.active[1]];

			this.config.ActiveCfg = `${Configuration}|${Platform}`;
			this.dirty_suo();
		}
	}

	public projectActiveConfiguration(project: Project) {
		const c = project.configuration[this.active.join('|')];
		return {
			Configuration:	c?.Configuration ?? this.config_list[this.active[0]],
			Platform: 		c?.Platform ?? this.platform_list[this.active[1]],
		};
	}

	public get childProjects() {
		return Object.keys(this.projects).filter(p => !this.parents[p]).map(p => this.projects[p]);
	}

	dispose() {
		utils.asyncMap(Object.keys(this.projects), async k => this.projects[k].clean());
	}

	private constructor(public fullpath: string) {
	}

	private static async getParser(fullpath: string) {
		const bytes		= await fs.promises.readFile(fullpath);
		if (bytes) {
			const content	= new TextDecoder().decode(bytes);
			const parser	= new LineParser(content.split('\n'));

			const slnFileHeaderNoVersion = "Microsoft Visual Studio Solution File, Format Version ";
			for (let i = 0; i < 2; i++) {
				const str = parser.readLine();
				if (str && str.startsWith(slnFileHeaderNoVersion))
					return parser;
			}
		}
	}

	public static async load(fullpath: string) : Promise<Solution | undefined> {
		const parser = await this.getParser(fullpath);
		if (parser) {
			const solution = new Solution(fullpath);

			const aconfig = open_suo(suo_path(fullpath)).then(suo => {
				const sourceStream = suo.find("DebuggerFindSource");
				if (sourceStream) {
					const reader = new binary.stream(suo.read(sourceStream));
					reader.skip(4);
					reader.skip(4);
					solution.debug_include = binary.read(reader, stringArrayType);
					reader.skip(4);
					solution.debug_exclude = binary.read(reader, stringArrayType);
				}	

				const configStream = suo.find("SolutionConfiguration");
				return configStream && read_config(suo.read(configStream));

			}).catch(error => (console.log(error), undefined));
	
			solution.parse(parser);
	
			solution.config = await aconfig ?? {};
			const parts		= solution.config.ActiveCfg.split('|');
			solution.active	= [Math.max(solution.config_list.indexOf(parts[0]), 0), Math.max(solution.platform_list.indexOf(parts[1]), 0)];
			return solution;
		}
	}

	public dirty() {
		this.update.trigger();
	}

	private dirty_suo() {
		this.update_suo.trigger();
	}

	private parse(parser : LineParser): void {
		this.header						= parser.currentLine();
		this.config_list.length 		= 0;
		this.platform_list.length 		= 0;
		this.VisualStudioVersion		= '';
		this.MinimumVisualStudioVersion	= '';
		this.global_sections			= {};
		this.projects					= {};

		let str:	string | null;
		let m:		RegExpExecArray | null;
		const basePath	= path.dirname(this.fullpath);

		while ((str = parser.readLine()) !== null) {
			if ((m = assign_re.exec(str))) {
				const name	= m[1];
				const value	= m[2].trim();

				if (name === "VisualStudioVersion") {
					this.VisualStudioVersion = value;

				} else if (name === "MinimumVisualStudioVersion") {
					this.MinimumVisualStudioVersion = value;

				} else if ((m = /Project\("(.*)"\)/.exec(name))) {
					const type = m[1];
					if ((m = /"(.*)"\s*,\s*"(.*)"\s*,\s*"(.*)"/.exec(value))) {
						const guid 	= m[3];
						const proj 	= Project.all[guid] ?? createProject(this, type, m[1], path.resolve(basePath, m[2]), guid);
						this.projects[guid] = proj;

						parser.parseSection_re("EndProject", assign_re, m => {
							const f = proj.solutionRead(m, basePath)
								?? m[1] === "ProjectSection(ProjectDependencies)" ? (s: string) => {
									const m = assign_re.exec(s);
									if (m)
										proj.addDependency(this.projects[m[1]]);
								} : (() => {});
							parser.parseSection("EndProjectSection", f);
						});
					}

				} else if ((m = /GlobalSection\((.*)\)/.exec(name))) {
					const section : Record<string, string> = {};
					parser.parseSection_re("EndGlobalSection", assign_re, m => section[m[1]] = m[2].trim());
					this.global_sections[m[1]] = {section: section, when: value};
				}
			}
		}

		const detach_globals = (name: string) : Record<string, string> => {
			const section = this.global_sections[name];
			if (section) {
				const r = section.section;
				section.section = {};
				return r;
			}
			return {};
		};
	
		Object.entries(detach_globals('NestedProjects')).forEach(([k, v]) => {
			this.projects[v]?.addProject(this.projects[k]);
			this.parents[k] = this.projects[v];
		});

		const configurations= Object.keys(detach_globals('SolutionConfigurationPlatforms')).filter(k => k !== 'DESCRIPTION').map(k => k.split('|'));
	
		const config_set	= new Set(configurations.map(i => i[0]));
		const platform_set	= new Set(configurations.map(i => i[1]));

		this.config_list	= [...config_set];
		this.platform_list	= [...platform_set];

		const config_map	= Object.fromEntries(this.config_list.map((v, i) => [v, i]));
		const platform_map	= Object.fromEntries(this.platform_list.map((v, i) => [v, i]));

		const rawProjectConfigurationsEntries = detach_globals('ProjectConfigurationPlatforms');
		for (const key in this.projects) {
			const project = this.projects[key];
			for (const c of configurations) {
				const configuration = `${project.guid}.${c.join('|')}`;
				const config = rawProjectConfigurationsEntries[configuration + ".ActiveCfg"];
				if (config) {
					const build		= rawProjectConfigurationsEntries[configuration + ".Build.0"];
					const deploy 	= rawProjectConfigurationsEntries[configuration + ".Deploy.0"];
					const key		= [config_map[c[0]], platform_map[c[1]]].join('|');
					const parts 	= config.split('|');
					project.setProjectConfiguration(key, {Configuration:parts[0], Platform:parts[1], build:!!build, deploy:!!deploy});
				}
			}
		}
	}

	private format(): string {
		const basePath = path.dirname(this.fullpath);
		let out = `
${this.header}
VisualStudioVersion = ${this.VisualStudioVersion}
MinimumVisualStudioVersion = ${this.MinimumVisualStudioVersion}
`;

		for (const p in this.projects) {
			const proj = this.projects[p];
			out += `Project("${proj.type}") = "${proj.name}", "${path.relative(basePath, proj.fullpath)}", "${p}"\n`;
			out += proj.solutionWrite(basePath);
			out += "EndProject\n";
		}

		out += "Global\n";
		for (const i in this.global_sections) {
			let section = this.global_sections[i].section;
			switch (i) {
				case 'SolutionConfigurationPlatforms':
					section = Object.fromEntries(this.config_list.map(c => this.platform_list.map(p => `${c}|${p}`)).flat().map(i => [i, i]));
					break;
				case 'ProjectConfigurationPlatforms':
					section = Object.entries(this.projects).reduce((acc, [p, project]) =>
						Object.entries(project.configuration).reduce((acc, [i, c]) => {
							const parts = i.split('|');
							if (this.config_list[+parts[0]] && this.platform_list[+parts[1]]) {
								const key		= [this.config_list[+parts[0]], this.platform_list[+parts[1]]].join('|');
								const config	= [c.Configuration, c.Platform].join('|');
								acc[`${p}.${key}.ActiveCfg`] = config;
								if (c.build)
									acc[`${p}.${key}.Build.0`] = config;
								if (c.deploy)
									acc[`${p}.${key}.Deploy.0`] = config;
							}
							return acc;
						}, acc), {} as Record<string, string>);
					break;
				case 'NestedProjects':
					section = Object.entries(this.projects).reduce((acc, [p, project]) =>
						project.childProjects.reduce((acc, i) => {
							acc[i.guid] = p;
							return acc;
						}, acc), {} as Record<string, string>);
					break;
				default:
					break;
			}
			out += write_section('GlobalSection', i, this.global_sections[i].when, section);
		}
		out += "EndGlobal\n";

		return out;
	}

	public projectByName(name : string) {
		for (const key in this.projects) {
			if (this.projects[key].name === name)
				return this.projects[key];
		}
	}

	private makeProxy(array: string[]) {
		return new Proxy(array, {
			set: (target: string[], prop: string, value: string) => {
				target[+prop] = value;
				this.dirty();
				return true;
			},
			deleteProperty: (target: string[], prop: string) => {
				delete target[+prop];
				this.dirty();
				return true;
			}
		});
	}

	public configurationList() : string[] {
		return this.makeProxy(this.config_list);
	}
	public platformList() : string[] {
		return this.makeProxy(this.platform_list);
	}
	public async addProject(proj: Project) {
		if (!proj.guid)
			proj.guid = crypto.randomUUID();

		//make histograms of all mappings from solution config/plat to project config/plat
		const chistogram: Histogram[] = utils.array_make(this.config_list.length, Histogram);
		const phistogram: Histogram[] = utils.array_make(this.platform_list.length, Histogram);

		for (const c in this.config_list) {
			chistogram[c] = new Histogram;
			for (const p in this.platform_list) {
				const key = `${c}|${p}`;
				for (const i of Object.values(this.projects)) {
					const config = i.configuration[key];
					if (config) {
						chistogram[c].add(config.Configuration);
						phistogram[p].add(config.Platform);
					}
				}
			}
		}

		await proj.ready;

		// find most common mappings that are supported by this project
		const proj_configs	= proj.configurationList();
		const config_map	= this.config_list.map((c, i) => best_config(proj_configs, c, chistogram[i]));

		const proj_plats	= proj.platformList();
		const plat_map		= this.platform_list.map((p, i) => best_config(proj_plats, p, phistogram[i]));

		// make map
		for (const c in this.config_list) {
			for (const p in this.platform_list) {
				proj.setProjectConfiguration(`${c}|${p}`, {
					Configuration:	config_map[c],
					Platform:		plat_map[p],
					build: 			true,
					deploy: 		true
				});
			}
		}

		// add project to solution
		this.projects[proj.guid] = proj;
		this.dirty();
	}

	public async addProjectFilename(filename: string) {
		const parsed	= path.parse(filename);
		const type		= known_exts[parsed.ext.substring(1)];
		this.addProject(createProject(this, type, parsed.name, filename, ''));
	}

	public removeProject(project: Project) {
		this.parents[project.guid]?.removeProject(project);
		delete this.projects[project.guid];
		this.dirty();
	}
}
