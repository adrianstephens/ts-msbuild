import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bin from '@isopodlabs/binary';
import * as CompDoc from '@isopodlabs/binary_libs/CompoundDocument';
import * as utils from '@isopodlabs/utilities';
import { ProjectContainer, Project, ProjectItemEntry, Folder, FolderTree } from './Project';
import * as Locations from './Locations';

class NonMSBuildProject extends Project {
	solutionRead(m: string[]) {
		if (m[1] === "ProjectSection(ProjectDependencies)") {
			return (s: string) => {
				const m = assign_re.exec(s);
				if (m)
					this.addDependency(Project.getFromId(m[1]));
			};
		}
	}


	solutionWrite() : string {
		return write_section('ProjectSection', 'ProjectDependencies', 'preProject', Object.fromEntries(this.dependencies.map(i => [i.name, i.name])));
	}
}

export class SolutionFolder extends NonMSBuildProject {
   	get name()			{ return this._name; }
	set name(v: string)	{ this._name = v; this.container.dirty(); }

	solutionItems: ProjectItemEntry[] = [];

	constructor(container: ProjectContainer, type: string, name: string, fullpath: string, guid: string) {
		super(container, type, name, fullpath, guid);
	}

	solutionRead(m: string[]) {
		if (m[1] === "ProjectSection(SolutionItems)") {
			return (s: string) => {
				const m = assign_re.exec(s);
				if (m) {
					const filepath = path.resolve(this.container.baseDir, m[2].trim());
					this.solutionItems.push( {
						name: path.basename(m[1]),
						data: {
							fullPath: filepath,
							relativePath: path.relative(this.fullpath, filepath),
						}
					});
				}
			};
		}
		super.solutionRead(m);
	}
	solutionWrite() : string {
		const basePath = this.container.baseDir;
		return super.solutionWrite() + write_section('ProjectSection', 'SolutionItems', 'preProject', Object.fromEntries(this.solutionItems.map(i => {
			const rel = path.relative(basePath, i.data.fullPath);
			return [rel, rel];
		})));
	}

	async addFile(name: string, filepath: string) {
		const item = {
			name: name,
			data: {
				fullPath: filepath,
				relativePath: path.relative(this.fullpath, filepath),
			}
		};
		this.solutionItems.push(item);
		this.container.dirty();
		return item;
	}
	
	getFolders(_view: string) : Promise<FolderTree> {
		const container = this.container;
		class Folder2 extends Folder {
			constructor(public entries: ProjectItemEntry[]) {
				super('');
			}
			remove(item : ProjectItemEntry) {
				super.remove(item);
				container.dirty();
			}
		}
		return Promise.resolve(new FolderTree(new Folder2(this.solutionItems)));
	}

}

export class WebProject extends Project {
	webProperties:	Record<string, string> = {};

	solutionWrite() : string {
		return super.solutionWrite() + write_section('ProjectSection', 'WebsiteProperties', 'preProject', this.webProperties);
	}

	solutionRead(m: string[]) {
		if (m[1] === "ProjectSection(WebsiteProperties)") {
			return (s: string) => {
				const m = assign_re.exec(s);
				if (m)
					this.webProperties[m[1]] = m[2].trim();
			};
		}
		super.solutionRead(m);
	}
	getFolders(_view: string) {
		return Promise.resolve(new FolderTree());
	}

}

export class WebDeploymentProject extends NonMSBuildProject {
	getFolders(_view: string) {
		return Promise.resolve(new FolderTree());
	}
}

Project.addKnown({
	/*CRM*/	                	"{88A30576-7583-4F75-8136-5EFD2C14ADFF}": {make: NonMSBuildProject},	
	/*CRM plugin*/	         	"{4C25E9B5-9FA6-436C-8E19-B395D2A65FAF}": {make: NonMSBuildProject},	
	/*IL project*/	         	"{95DFC527-4DC1-495E-97D7-E94EE1F7140D}": {make: NonMSBuildProject},	
	/*InstallShield*/	      	"{FBB4BD86-BF63-432A-A6FB-6CF3A1288F83}": {make: NonMSBuildProject},	
	/*LightSwitch Project*/		"{ECD6D718-D1CF-4119-97F3-97C25A0DFBF9}": {make: NonMSBuildProject},	
	/*Micro Framework*/	    	"{B69E3092-B931-443C-ABE7-7E7B65F2A37F}": {make: NonMSBuildProject},	
	/*Miscellaneous Files*/		"{66A2671D-8FB5-11D2-AA7E-00C04F688DDE}": {make: NonMSBuildProject},	
	/*Nomad*/	              	"{4B160523-D178-4405-B438-79FB67C8D499}": {make: NonMSBuildProject},	
	/*Synergex*/	           	"{BBD0F5D1-1CC4-42FD-BA4C-A96779C64378}": {make: NonMSBuildProject},	
	/*Unloaded Project*/	   	"{67294A52-A4F0-11D2-AA88-00C04F688DDE}": {make: NonMSBuildProject},	
	/*WiX Setup*/	          	"{930C7802-8A8C-48F9-8165-68863BCCD9DD}": {make: NonMSBuildProject},	

	/*Web Site*/				"{E24C65DC-7377-472B-9ABA-BC803B73C61A}": {make: WebProject},
	/*Solution Folder*/			"{2150E333-8FDC-42A3-9474-1A3956D46DE8}": {make: SolutionFolder,					type: "Folder"},
	/*wdProjectGuid*/ 			"{2CFEAB61-6A3B-4EB8-B523-560B4BEEF521}": {make: WebDeploymentProject},
});



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
	constructor(private lines: string[]) {}

	currentLine(): string {
		return this.lines[this._currentLineIndex].trim();
	}
	readLine(): string | null {
		if (this._currentLineIndex + 1 >= this.lines.length)
			return null;
		return this.lines[++this._currentLineIndex].trim();
	}
	parseSection(end : string, func : (str: string) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end)
			func(str);
	}
	parseSection_re(end: string, re: RegExp, func: (m: RegExpExecArray) => void): void {
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

const string1Type		= bin.StringType(bin.UINT32_LE, 'utf16le', true, 1);
const stringArrayType	= bin.ArrayType(bin.UINT32_LE, string1Type);

const VT: Record<string, {tag: number, type: bin.TypeT<any>}> = {
	EMPTY:			   {tag: 0,      type: bin.UINT16_LE},								// VT_EMPTY
	NULL:			   {tag: 1,      type: bin.UINT16_LE},								// VT_NULL
	I2:			       {tag: 2,      type: bin.INT16_LE},								// VT_I2
	I4:			       {tag: 3,      type: bin.INT32_LE},								// VT_I4
	R4:			       {tag: 4,      type: bin.Float32_LE},								// VT_R4
	R8:			       {tag: 5,      type: bin.Float64_LE},								// VT_R8
//	CY:			       {tag: 6,      type: bin.UINT16_LE},								// VT_CY
//	DATE:			   {tag: 7,      type: bin.UINT16_LE},								// VT_DATE
	BSTR:			   {tag: 8,      type: bin.StringType(bin.UINT32_LE, 'utf16le')},	// VT_BSTR
//	DISPATCH:		   {tag: 9,      type: bin.UINT16_LE},								// VT_DISPATCH
//	ERROR:			   {tag: 10,     type: bin.UINT16_LE},								// VT_ERROR
	BOOL:			   {tag: 11,     type: bin.UINT16_LE},								// VT_BOOL
//	VARIANT:		   {tag: 12,     type: bin.UINT16_LE},								// VT_VARIANT
//	UNKNOWN:		   {tag: 13,     type: bin.UINT16_LE},								// VT_UNKNOWN
//	DECIMAL:		   {tag: 14,     type: bin.UINT16_LE},								// VT_DECIMAL
	I1:			       {tag: 16,     type: bin.INT8},									// VT_I1
	UI1:			   {tag: 17,     type: bin.UINT8},									// VT_UI1
	UI2:			   {tag: 18,     type: bin.UINT16_LE},								// VT_UI2
	UI4:			   {tag: 19,     type: bin.UINT32_LE},								// VT_UI4
	I8:			       {tag: 20,     type: bin.INT64_LE},								// VT_I8
	UI8:			   {tag: 21,     type: bin.UINT64_LE},								// VT_UI8
	INT:			   {tag: 22,     type: bin.INT32_LE},								// VT_INT
	UINT:			   {tag: 23,     type: bin.UINT32_LE},								// VT_UINT
//	VOID:			   {tag: 24,     type: bin.UINT32_LE},								// VT_VOID
//	HRESULT:		   {tag: 25,     type: bin.UINT32_LE},								// VT_HRESULT
//	PTR:			   {tag: 26,     type: bin.UINT32_LE},								// VT_PTR
//	SAFEARRAY:		   {tag: 27,     type: bin.UINT32_LE},								// VT_SAFEARRAY
//	CARRAY:			   {tag: 28,     type: bin.UINT32_LE},								// VT_CARRAY
//	USERDEFINED:	   {tag: 29,     type: bin.UINT32_LE},								// VT_USERDEFINED
//	LPSTR:			   {tag: 30,     type: bin.UINT32_LE},								// VT_LPSTR
//	LPWSTR:			   {tag: 31,     type: bin.UINT32_LE},								// VT_LPWSTR
//	RECORD:			   {tag: 36,     type: bin.UINT32_LE},								// VT_RECORD
//	INT_PTR:		   {tag: 37,     type: bin.UINT32_LE},								// VT_INT_PTR
//	UINT_PTR:		   {tag: 38,     type: bin.UINT32_LE},								// VT_UINT_PTR
//	FILETIME:		   {tag: 64,     type: bin.UINT32_LE},								// VT_FILETIME
//	BLOB:			   {tag: 65,     type: bin.UINT32_LE},								// VT_BLOB
//	STREAM:			   {tag: 66,     type: bin.UINT32_LE},								// VT_STREAM
//	STORAGE:		   {tag: 67,     type: bin.UINT32_LE},								// VT_STORAGE
//	STREAMED_OBJECT:   {tag: 68,     type: bin.UINT32_LE},								// VT_STREAMED_OBJECT
//	STORED_OBJECT:	   {tag: 69,     type: bin.UINT32_LE},								// VT_STORED_OBJECT
//	BLOB_OBJECT:	   {tag: 70,     type: bin.UINT32_LE},								// VT_BLOB_OBJECT
//	CF:			       {tag: 71,     type: bin.UINT32_LE},								// VT_CF
//	CLSID:			   {tag: 72,     type: bin.UINT32_LE},								// VT_CLSID
//	VERSIONED_STREAM:  {tag: 73,     type: bin.UINT32_LE},								// VT_VERSIONED_STREAM
//	BSTR_BLOB:		   {tag: 0xfff,  type: bin.UINT32_LE},								// VT_BSTR_BLOB
//	VECTOR:		       {tag: 0x1000, type: bin.UINT32_LE},								// VT_VECTOR
//	ARRAY:		       {tag: 0x2000, type: bin.UINT32_LE},								// VT_ARRAY
//	BYREF:		       {tag: 0x4000, type: bin.UINT32_LE},								// VT_BYREF
};
const VARIANT_BY_TAG: Record<number, bin.TypeT<any>> = Object.fromEntries(Object.values(VT).map(i => [i.tag, i.type]));

const suoVariant = {
	get(reader: bin.stream) {
		const tag	= bin.read(reader, bin.UINT16_LE);
		const type	= VARIANT_BY_TAG[tag & 0x7ff];
		if (type) {
			if (tag & 0x2000)
				return bin.readn(reader, type, bin.read(reader, bin.UINT32_LE));
			return type.get(reader);
		}
		return String.fromCharCode(tag);
	},	
	put(writer: bin.stream, value: any) {
		let tag;
		switch (typeof value) {
			case 'number':	tag = 3; break;	//VT_I4
			case 'string':
				if (value.length == 1) {
					bin.write(writer, bin.UINT16_LE, value.charCodeAt(0));
					return;
				}
				tag = 8; // VT_BSTR
				break;
			case 'object':
				if (Array.isArray(value)) {
					switch (typeof value[0]) {
						case 'number':	tag = 0x2003; break;	// VT_VECTOR | VT_I4
						case 'string':	tag = 0x2008; break;	// VT_VECTOR | VT_BSTR
						default:	throw "bad array type";
					}
					bin.write(writer, {tag: bin.UINT16_LE, value: bin.ArrayType(bin.UINT32_LE, VARIANT_BY_TAG[tag & 0x7ff])}, {tag, value});
				}
				// fallthrough
			default:
				throw "bad token";
		}
		bin.write(writer, {tag: bin.UINT16_LE, value: VARIANT_BY_TAG[tag]}, {tag, value});
	}
};

const suoSolutionConfiguration = bin.RemainingArrayType({
	name:		bin.StringType(bin.UINT32_LE, 'utf16le', true),
	equals:		bin.Expect(suoVariant, '='),
	value:		suoVariant,
	semicolon:	bin.Expect(suoVariant, ';')
});

const suoDebuggerFindSource = {
	ver:		bin.SkipType(4),	//version?
	unk:		bin.SkipType(4),	//unknown
	include:	stringArrayType,
	unk2:		bin.SkipType(4),	//unknown
	exclude:	stringArrayType
};

//-----------------------------------------------------------------------------
//	Solution
//-----------------------------------------------------------------------------

export class Solution implements ProjectContainer {
	projects:		Record<string, Project> = {};
	parents:		Record<string, Project> = {};
	debug_include:	string[]	= [];
	debug_exclude:	string[]	= [];

	private vs?: Locations.VisualStudioInstance;

	private config_list: 	string[]	= [];
	private platform_list: 	string[]	= [];

	private header						= '';
	public VisualStudioVersion			= '';
	public MinimumVisualStudioVersion	= '';
	private global_sections: Record<string, {section: Record<string, string>, when:string}> = {};
	private	active						= [0, 0];
	private	config:			Record<string, any> = {};
	private _dirty			= false;
	private _dirty_suo		= false;

	protected constructor(public fullpath: string) {
	}
	
	//interface ProjectContainer
	dirty() {
		this._dirty = true;
	}
	watch(_glob: string, _func: (fullpath: string, mode: number) => void): void {
	}
	dispose() {
		utils.async.map(Object.keys(this.projects), async k => this.projects[k].save());
	}
	get baseDir() {
		return path.dirname(this.fullpath);
	}
	get installDir() {
		return this.vs?.Path ?? '';
	}

	private majorVersion() {
		return +this.VisualStudioVersion.split('.')[0];
	}
	private suo_path() {
		const parsed = path.parse(this.fullpath);
		return path.join(parsed.dir, '.vs', parsed.name, `v${this.majorVersion()}`, '.suo');
	}

	get startup() : Project | undefined {
		return this.projects[this.config.StartupProject];
	}
	set startup(project: Project | string) {
		if (typeof project !== 'string')
			project = project.guid;
		if (this.config.StartupProject !== project) {
			this.config.StartupProject = project;
			this.dirty_suo();
		}
	}

	get activeConfiguration() {
		return {
			Configuration:	this.config_list[this.active[0]],
			Platform: 		this.platform_list[this.active[1]]
		};
	}
	set activeConfiguration({Configuration, Platform}: {Configuration: string, Platform: string}) {
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
	get childProjects() {
		return Object.keys(this.projects).filter(p => !this.parents[p]).map(p => this.projects[p]);
	}

	globals(): Record<string, string> {
		return {
			VisualStudioVersion:	`${this.majorVersion()}.0`,
			VsInstallRoot:			this.vs?.Path ?? '?',
			//VCTargetsPath:			this.vs?.VCTargetsPath + '\\',
		};
	}
	projectActiveConfiguration(project: Project) {
		const c = project.configuration[this.active.join('|')];
		return {
			Configuration:			c?.Configuration ?? this.config_list[this.active[0]],
			Platform: 				c?.Platform ?? this.platform_list[this.active[1]],
			...this.globals()
		};
	}	

	private dirty_suo() {
		this._dirty_suo = true;
	}

	async save() {
		if (this._dirty_suo) {
			this._dirty_suo = false;
			const suopath	= this.suo_path();
			const suo		= await CompDoc.Reader.load(suopath);

			if (suo) {
				const configStream = suo.find("SolutionConfiguration");
				if (configStream) {
					const writer	= new bin.growingStream();
					const data		= Object.entries(this.config).map(([name, value]) => ({name, value}));
					bin.write(writer, suoSolutionConfiguration, data);
					suo.write(configStream, writer.terminate());
					await suo.flush(suopath);
				}
			}
		}
		if (this._dirty) {
			this._dirty = false;
			await fs.promises.writeFile(this.fullpath, this.format());
		}

		await Promise.all(Object.values(this.projects).map(proj => proj.save()));
	}

	static async load(fullpath: string): Promise<Solution | undefined> {
		async function getParser() {
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

		const parser = await getParser();
		if (parser) {
			const solution = new this(fullpath);
			await solution.parse(parser);

			const suo = await CompDoc.Reader.load(solution.suo_path());
			if (suo) {
				const sourceStream = suo.find("DebuggerFindSource");
				if (sourceStream) {
					const source = bin.read(new bin.stream(suo.read(sourceStream)), suoDebuggerFindSource);
					solution.debug_include = source.include;
					solution.debug_exclude = source.exclude;
				}	

				const configStream = suo.find("SolutionConfiguration");
				if (configStream) {
					const data0		= suo.read(configStream);
					const config	= bin.read(new bin.stream(data0), suoSolutionConfiguration);
					solution.config	= config.reduce((acc, {name, value}) => (acc[name] = value, acc), {} as Record<string, any>);
				}

				if (solution.config.ActiveCfg) {
					const parts		= solution.config.ActiveCfg.split('|');
					solution.active	= [Math.max(solution.config_list.indexOf(parts[0]), 0), Math.max(solution.platform_list.indexOf(parts[1]), 0)];
				}

//SolutionConfiguration - Active build configuration (Debug/Release, platform) ✓ (you're using)
//UnloadedProjects / UnloadedProjectsEx - Tracks unloaded projects in the solution
//ProjectTrustInformation - Project trust state (.NET 6+ feature)
//SelectedLaunchProfileName - Active launch profile for debugging
//Useful for specific scenarios:
//ProjInfoEx - Project metadata cache (can speed up UI updates)
//ClassViewContents - Class View tree state (if you're building navigation UIs)
//BookmarkState - Editor bookmarks user placed
//OutliningStateV... - Code folding/outlining state per file
//DebuggerBreakpoints / DebuggerWatches / DebuggerExceptions ✓ (debug-related, might complement DebuggerFindSource)
//MRU Solution Files - Recent solutions list
//Property Manager - Property sheet open/closed state
//HiddenSlnFolders - Collapsed folders in Solution Explorer

			}
			return solution;
		}
	}

	private async parse(parser : LineParser) {
		this.header						= parser.currentLine();
		this.VisualStudioVersion		= '';
		this.MinimumVisualStudioVersion	= '';
		this.global_sections			= {};
		this.projects					= {};

		let str, m;

		while ((str = parser.readLine()) !== null) {
			if ((m = assign_re.exec(str))) {
				const name	= m[1];
				const value	= m[2].trim();

				if (name === "VisualStudioVersion") {
					this.VisualStudioVersion = value;
					this.vs = await Locations.vsInstances.then(vs => vs?.byVersion(this.majorVersion()));

				} else if (name === "MinimumVisualStudioVersion") {
					this.MinimumVisualStudioVersion = value;

				} else if ((m = /Project\("(.*)"\)/.exec(name))) {
					const type = m[1];
					if ((m = /"(.*)"\s*,\s*"(.*)"\s*,\s*"(.*)"/.exec(value))) {
						const guid 	= m[3];
						const proj 	= Project.getFromId(guid) ?? Project.create(this, type, m[1], path.resolve(path.dirname(this.fullpath), m[2]), guid);
						this.projects[guid] = proj;

						parser.parseSection_re("EndProject", assign_re, m => {
							const f = proj.solutionRead(m)
								?? (m[1] === "ProjectSection(ProjectDependencies)" ? (s: string) => {
									const m = assign_re.exec(s);
									if (m)
										proj.addDependency(this.projects[m[1]]);
								} : (() => {}));
							parser.parseSection("EndProjectSection", f);
						});
					}

				} else if ((m = /GlobalSection\((.*)\)/.exec(name))) {
					const section: Record<string, string> = {};
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
					project.setProjectConfiguration(key, {Configuration:parts[0], Platform:parts[1], build: !!build, deploy: !!deploy});
				}
			}
		}
	}

	private format(): string {
		const basePath = path.dirname(this.fullpath);

		let out = '\n' + this.header
			+ `\nVisualStudioVersion = ${this.VisualStudioVersion}`
			+ `\nMinimumVisualStudioVersion = ${this.MinimumVisualStudioVersion}`;

		for (const p in this.projects) {
			const proj = this.projects[p];
			out += `Project("${proj.type}") = "${proj.name}", "${path.relative(basePath, proj.fullpath)}", "${p}"\n`;
			out += proj.solutionWrite();
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

	projectByName(name : string) {
		for (const key in this.projects) {
			if (this.projects[key].name === name)
				return this.projects[key];
		}
	}

	private makeProxy(array: string[]) {
		return new Proxy(array, {
			set: (target: string[], prop: string, value: string) => {
				if (!isNaN(+prop)) {
					target[+prop] = value;
					this.dirty();
					return true;
				}
				return prop === 'length';
			},
			deleteProperty: (target: string[], prop: string) => {
				delete target[+prop];
				this.dirty();
				return true;
			}
		});
	}
	configurationList() : string[] {
		return this.makeProxy(this.config_list);
	}
	platformList() : string[] {
		return this.makeProxy(this.platform_list);
	}

	async addProject(proj: Project) {
		if (!proj.guid)
			proj.guid = crypto.randomUUID();

		//make histograms of all mappings from solution config/plat to project config/plat
		const chistogram = utils.array.make(this.config_list.length, Histogram);
		const phistogram = utils.array.make(this.platform_list.length, Histogram);

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

	async addProjectFilename(filename: string) {
		const parsed	= path.parse(filename);
		const type		= Project.typeFromExt(parsed.ext);
		if (type) {
			const project = Project.create(this, type, parsed.name, filename, '');
			this.addProject(project);
			return project;
		}
	}

	removeProject(project: Project) {
		this.parents[project.guid]?.removeProject(project);
		delete this.projects[project.guid];
		this.dirty();
	}

	private copyConfigs(keyTo: string, keyFrom: string) {
		Object.values(this.projects).forEach(p => {
			if (p.configuration[keyFrom])
				p.configuration[keyTo] = p.configuration[keyFrom];
		});
	}

	copyConfiguration(to: string, from: string) {
		const idFrom	= this.config_list.findIndex(i => i === from);
		const idTo 		= this.config_list.findIndex(i => i === to);
		if (idFrom < 0 || idTo < 0)
			return;
		for (const i in this.platform_list)
			this.copyConfigs(`${idTo}|${i}`, `${idFrom}|${i}`);
	}
	copyPlatform(to: string, from: string) {
		const idFrom	= this.platform_list.findIndex(i => i === from);
		const idTo 		= this.platform_list.findIndex(i => i === to);
		if (idFrom < 0 || idTo < 0)
			return;
		for (const i in this.config_list)
			this.copyConfigs(`${i}|${idTo}`, `${i}|${idFrom}`);
	}
}
