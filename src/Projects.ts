import * as path from 'path';
import * as fs from 'fs';
import * as xml from '@isopodlabs/xml';

import { FolderTree, Folder, Project, Properties, ProjectConfiguration, ProjectItemEntry, xml_load, xml_save, known_guids } from './index';
import { Container, PropertyContext } from './MsBuild';
import * as MsBuild from './MsBuild';
import { vsdir, getSdkPath } from './Locations';

//-----------------------------------------------------------------------------
//	Project
//-----------------------------------------------------------------------------

class MsBuildProjectBase extends Project {
	public	msbuild:	Container;
	public	user_xml?:	xml.Element;
	public	settings_ready	= Promise.resolve();
	private project_dirty	= 0;
	private user_dirty		= 0;

	constructor(parent: any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);
		this.msbuild 	= new Container;
		this.ready		= this.load();

		xml_load(fullpath + ".user").then(doc => this.user_xml = doc);
	}

	public dirty() {
		++this.project_dirty;
		super.dirty();
	}

	async preload(_root: xml.Element) : Promise<PropertyContext> {
		return this.makeProjectProps({});
	}

	async postload(props: PropertyContext) {
		await this.msbuild.readItems(props);

		this.settings_ready = this.msbuild.readImportedItems(props);

		if ('ProjectReference' in this.msbuild.items) {
			for (const i of this.msbuild.items.ProjectReference.entries || []) {
				const proj = Project.all[i.data.Project?.toUpperCase()];
				if (proj)
					this.addDependency(proj);
			}
		}
	}

	async load() : Promise<void> {
		this.project_dirty	= 0;
		await this.msbuild.load(this.fullpath);

		const root 	= this.msbuild.root;
		if (root?.name == 'Project') {
			const props = await this.preload(root);
			await this.msbuild.evaluatePropsAndImports(props);
			await this.postload(props);
			console.log(`loaded ${this.fullpath}`);
		}
	}

	protected async makeProjectProps(globals: Properties) {
		return this.msbuild.makeProjectProps(this.fullpath, {...globals, SolutionDir: this.solution_dir + path.sep});
	}

	public addSetting(source: string, name: string, value: string, condition: string | undefined, item: string|undefined, persist: string, revert: boolean) : xml.Element | undefined {
		let file: xml.Element | undefined;
		if (persist === 'UserFile') {
			this.user_dirty += revert ? -1 : 1;
			file = this.user_xml;
		} else if (persist === 'ProjectFile') {
			this.project_dirty += revert ? -1 : 1;
			file = this.msbuild.raw_xml;
		}

		if (source) {
			const items = this.msbuild.items[source];
			return items.addSetting(name, value, condition, item ? items.getEntry(item) : undefined);
		} else {
			return MsBuild.addPropertySetting(file, name, value, condition);
		}
	}

	public async getSetting(globals : Properties, name: string) {
		return this.msbuild.getSetting(this.user_xml, await this.makeProjectProps(globals), name);
	}

	public async evaluateProps(globals: Properties) : Promise<[PropertyContext, MsBuild.Origins]> {
		const props = await this.makeProjectProps(globals);
		const modified: MsBuild.Origins	= {};
		await MsBuild.evaluatePropsAndImports(
			[
				...this.msbuild.root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			undefined,
			modified
		);

		return [props, modified];
	}

	public isLocal(loc: xml.Element) : boolean {
		while (loc.parent)
			loc = loc.parent;
		return loc === this.msbuild.raw_xml || loc === this.user_xml;
	}

	public async clean() {
		const promises = [] as Promise<any>[];

		if (this.project_dirty) {
			promises.push(this.msbuild.save(this.fullpath));
			this.project_dirty = 0;
		}

		if (this.user_dirty) {
			promises.push(xml_save(this.fullpath + ".user", this.user_xml!));
			this.user_dirty = 0;
		}

		await Promise.all(promises);
	}

	public validConfig(config: ProjectConfiguration) {
		return !('ProjectConfiguration' in this.msbuild.items)
			|| !!this.msbuild.items.ProjectConfiguration.entries.find(i => i.data.Configuration === config.Configuration && i.data.Platform === config.Platform);
	}

	public addFile(_name:string, _file: string): boolean {
		return false;
	}
	public removeFile(_file: string) {
		return false;
	}
	public configurationList() : string[] {
		return 'ProjectConfiguration' in this.msbuild.items
			? [...new Set(this.msbuild.items.ProjectConfiguration.entries.map(i => i.data.Configuration))]
			: super.configurationList();
	}
	public platformList() : string[] {
		return 'ProjectConfiguration' in this.msbuild.items
			? [...new Set(this.msbuild.items.ProjectConfiguration.entries.map(i => i.data.Platform))]
			: super.platformList();
	}

}


//-----------------------------------------------------------------------------
//	Project Types
//-----------------------------------------------------------------------------

class MsBuildProject extends MsBuildProjectBase {
	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);
	}

	async preload(root: xml.Element) : Promise<MsBuild.PropertyContext> {
		const globals: Properties = {};

		// try and get first configuration
		if (root.elements.ItemGroup) {
			for (const i of root.elements.ItemGroup) {
				if (i.attributes.Label == 'ProjectConfigurations') {
					const parts = i.elements.ProjectConfiguration.attributes.Include.split('|');
					globals.Configuration	= parts[0];
					globals.Platform		= parts[1];
					break;
				}
			}
		}
		return this.makeProjectProps(globals);
	}
}


function ManagedProjectMaker(language: string) {
	return class P extends MsBuildProjectBase {
		constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
			super(parent, type, name, fullpath, guid, solution_dir);
		}
		async postload(props: PropertyContext) {
			await this.msbuild.import(`${vsdir}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
			await super.postload(props);
		}
	};
}

function CPSProjectMaker(language: string, ext: string) {
	return class P extends MsBuildProjectBase {
		constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
			super(parent, type, name, fullpath, guid, solution_dir);
		}

		async preload(root: xml.Element) {
			const props		= await super.preload(root);
			await this.msbuild.import(path.join(getSdkPath(), 'Sdk.props'), props);

			const basePath	= path.dirname(this.fullpath);
			await this.msbuild.addItem('Compile').includeFiles(basePath, `**\\*.${ext}`, undefined, root);
			await this.msbuild.addItem('EmbeddedResource').includeFiles(basePath, '**\\*.resx', undefined, root);
			const None = this.msbuild.addItem('None');
			await None.includeFiles(basePath, `**\\*`, '**\\*.user;**\\*.*proj;**\\*.sln;**\\*.vssscc', root);
			None.removeFiles(basePath,  `**\\*.${ext};**/*.resx`);

			return props;
		}

		async postload(props: PropertyContext) {
			await this.msbuild.import(path.join(getSdkPath(), 'Sdk.targets'), props);
			await this.msbuild.import(`${vsdir}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
			super.postload(props);
		}
	
		public async evaluateProps(globals: Properties) : Promise<[PropertyContext, MsBuild.Origins]> {
			const props 	= await this.makeProjectProps(globals);
			const modified: MsBuild.Origins	= {};
			const sdkpath	= getSdkPath();

			await MsBuild.evaluateImport(path.join(sdkpath, 'Sdk.props'), props);
			await MsBuild.evaluatePropsAndImports(
				this.msbuild.root?.allElements()??[],
				props,
				undefined,
				modified
			);
			await MsBuild.evaluateImport(path.join(sdkpath, 'Sdk.targets'), props);
			return [props, modified];
		}
	
	};
}

export class AndroidProject extends MsBuildProjectBase {
	projectDir = '';

	async postload(props: PropertyContext) {
		await super.postload(props);
		const gradle 	= this.msbuild.items.GradlePackage;//.getDefinition('ProjectDirectory');
		const result 	= await gradle.evaluate(new PropertyContext);
		this.projectDir = path.join(path.dirname(this.fullpath), result[0].ProjectDirectory);
	}
}

export class ESProject extends MsBuildProjectBase {
	folders: Promise<FolderTree>;

	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);
		this.folders = Folder.read(path.dirname(this.fullpath), '').then(root => new FolderTree(root));
	}
}

//-----------------------------------------------------------------------------
//	Filters
//-----------------------------------------------------------------------------

async function loadFilterTree(fullPath : string, allfiles: Record<string, ProjectItemEntry>): Promise<FolderTree|undefined> {
	const basePath		= path.dirname(fullPath);
	const content		= await fs.promises.readFile(fullPath, "utf-8").catch(() => '');
	const document		= xml.parse(content);
	const filtertree	= new FolderTree;
	const project		= document?.firstElement();
	const extensions: Record<string, Folder> = {};

	if (project?.name == 'Project') {
		for (const element of project.children) {
			if (xml.isElement(element) && element.name === 'ItemGroup') {
				for (const item of element.children) {
					if (xml.isElement(item) && item.attributes.Include) {
						if (item.name === "Filter") {
							const folder 	= filtertree.addDirectory(item.attributes.Include);
							const exts		= item.elements.Extensions?.firstText();
							if (exts) {
								for (const e of exts.split(';'))
									extensions[e] = folder;
							}

						} else {
							const filename = path.resolve(basePath, item.attributes.Include);
							const entry = allfiles[filename];
							if (entry) {
								delete allfiles[filename];
								filtertree.addDirectory(item.elements.Filter?.firstText()).add(entry);
							}
						}
					}
				}
			}
		}
	}
	for (const i in allfiles) {
		const ext = path.extname(i).slice(1);
		const f = extensions[ext] ?? filtertree.root;
		f.add(allfiles[i]);
	}

	return filtertree;
}

async function saveFilterTree(tree: FolderTree, filename: string) {
	const get_group = (entry: ProjectItemEntry) => entry.data.item?.name ?? "None";
	const groups : Record<string, Set<ProjectItemEntry>> = {};

	const makeGroups = (folder: Folder, filtername:string, group: string, set: Set<ProjectItemEntry>) : xml.Element[] => {
		const acc: xml.Element[] = folder.entries.filter(i => set.has(i)).map(i => {
			i.data.relativePath ??= path.relative(filename, i.data.fullPath);
			return new xml.Element(get_group(i), {Include: i.data.relativePath}, filtername ? [
				new xml.Element('Filter', undefined, [filtername])
			] : []);
		});

		return folder.folders.reduce((acc, f) => {
			return [...acc, ...makeGroups(f, path.join(filtername, f.name), group, set)];
		}, acc);
	};

	const makeFilters = (folder: Folder, filtername:string) : xml.Element[] => {
		folder.entries.forEach(i => (groups[get_group(i)] ??= new Set<ProjectItemEntry>).add(i));
		const acc: xml.Element[] = [];
		if (filtername)
			acc.push(new xml.Element('Filter', {Include: filtername}));
		return folder.folders.reduce((acc, f) => [...acc, ...makeFilters(f, path.join(filtername, f.name))], acc);
	};

	const filters	= new xml.Element('ItemGroup', undefined, makeFilters(tree.root, ''));
	const group_xml = Object.keys(groups).map(g => new xml.Element('ItemGroup', undefined, makeGroups(tree.root, '', g, groups[g])));

	const element = new xml.Element('?xml', {version: '1.0', encoding: "utf-8"}, [
		new xml.Element('Project', {ToolsVersion: '4.0', xmlns: "http://schemas.microsoft.com/developer/msbuild/2003"}, [
			filters,
			...group_xml
		])
	]);

	return xml_save(filename, element);
}


//-----------------------------------------------------------------------------
//	VCProject
//-----------------------------------------------------------------------------

export class VCProject extends MsBuildProject {
	private filtertree: Promise<FolderTree | undefined>;
	private filter_dirty	= 0;

	constructor(parent:any, type:string, name:string, fullpath: string, guid: string, solution_dir: string) {
		super(parent, type, name, fullpath, guid, solution_dir);
		this.filtertree		= this.loadFilters(this.fullpath + ".filters");
	}

	private async loadFilters(fullPath : string): Promise<FolderTree|undefined> {
		return this.ready.then(() => {
			const allfiles : Record<string, ProjectItemEntry> = {};
			for (const i of Object.values(this.msbuild.items)) {
				if (i.mode === MsBuild.ItemMode.File) {
					//if (i.definitions.length)
						for (const entry of i.entries)
							allfiles[entry.data.fullPath] = entry;
				}
			}
			return loadFilterTree(fullPath, allfiles);
		});
	}

	public dirtyFilters() {
		++this.filter_dirty;
		//this._onDidChange.fire('filters');
	}

	public async clean() {
		const promises = [super.clean()];
		if (this.filter_dirty) {
			const tree = await this.filtertree;
			if (tree)
				promises.push(saveFilterTree(tree, this.fullpath + ".filters"));
			this.filter_dirty = 0;
		}

		await Promise.all(promises);
	}

	public renameFolder(folder: Folder, newname: string) : boolean {
		folder.name = newname;
		this.dirtyFilters();
		return true;
	}
	public addFile(name: string, filepath: string): boolean {
		this.msbuild.ext_assoc.value.then(ext_assoc => {
			const ext = path.extname(name);
			const ContentType = ext_assoc[ext];
			if (ContentType) {
				const group = this.msbuild.getItemGroup();
				if (group) {
					const item	= this.msbuild.items[ContentType];
					const x		= new xml.Element(ContentType, {Include: name});
					group.children.push(x);
					item.includeFile(path.dirname(this.fullpath), filepath, x);
					this.dirty();
				}
			}
		});
		return false;
	}
}

//-----------------------------------------------------------------------------
//	register known guids
//-----------------------------------------------------------------------------

Object.assign(known_guids, {
/*CPS*/ 											"{13B669BE-BB05-4DDF-9536-439F39A36129}": {make: CPSProjectMaker('?', '*'),			ext:"msbuildproj"},
/*ASP.NET 5*/									  	"{8BB2217D-0F2D-49D1-97BC-3654ED321F3B}": {make: MsBuildProject, ext:"xproj"},
/*ASP.NET Core Empty*/							 	"{356CAE8B-CFD3-4221-B0A8-081A261C0C10}": {make: MsBuildProject},
/*ASP.NET Core Web API*/						   	"{687AD6DE-2DF8-4B75-A007-DEF66CD68131}": {make: MsBuildProject},
/*ASP.NET Core Web App*/						   	"{E27D8B1D-37A3-4EFC-AFAE-77744ED86BCA}": {make: MsBuildProject},
/*ASP.NET Core Web App (Model-View-Controller)*/	"{065C0379-B32B-4E17-B529-0A722277FE2D}": {make: MsBuildProject},
/*ASP.NET Core with Angular*/					  	"{32F807D6-6071-4239-8605-A9B2205AAD60}": {make: MsBuildProject},
/*ASP.NET Core with React.js*/					 	"{4C3A4DF3-0AAD-4113-8201-4EEEA5A70EED}": {make: MsBuildProject},
/*ASP.NET MVC 1*/								  	"{603C0E0B-DB56-11DC-BE95-000D561079B0}": {make: MsBuildProject},
/*ASP.NET MVC 2*/								  	"{F85E285D-A4E0-4152-9332-AB1D724D3325}": {make: MsBuildProject},
/*ASP.NET MVC 3*/								  	"{E53F8FEA-EAE0-44A6-8774-FFD645390401}": {make: MsBuildProject},
/*ASP.NET MVC 4*/								  	"{E3E379DF-F4C6-4180-9B81-6769533ABE47}": {make: MsBuildProject},
/*ASP.NET MVC 5 / Web Application*/					"{349C5851-65DF-11DA-9384-00065B846F21}": {make: MsBuildProject},
/*Azure Functions*/									"{30E03E5A-5F87-4398-9D0D-FEB397AFC92D}": {make: MsBuildProject},
/*Azure Resource Group (Blank Template)*/		  	"{14B7E1DC-C58C-427C-9728-EED16291B2DA}": {make: MsBuildProject},
/*Azure Resource Group (Web app)*/				 	"{E2FF0EA2-4842-46E0-A434-C62C75BAEC67}": {make: MsBuildProject},
/*Azure WebJob (.NET Framework)*/				  	"{BFBC8063-F137-4FC6-AEB4-F96101BA5C8A}": {make: MsBuildProject},
/*Blazor Server App*/							  	"{C8A4CD56-20F4-440B-8375-78386A4431B9}": {make: MsBuildProject},
/*C#*/											 	"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}": {make: CPSProjectMaker('CSharp', 'cs'),	icon:"CSProjectNode", ext:"csproj"},
/*C# (.Net Core)*/								 	"{9A19103F-16F7-4668-BE54-9A1E7A4F7556}": {make: CPSProjectMaker('CSharp', 'cs'), 	icon:"CSProjectNode"},
/*C++*/												"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}": {make: VCProject, 						icon:"CPPProjectNode", ext:"vcxproj"},
/*Class Library*/								  	"{2EFF6E4D-FF75-4ADF-A9BE-74BEC0B0AFF8}": {make: MsBuildProject},
/*Console App*/										"{008A663C-3F22-40EF-81B0-012B6C27E2FB}": {make: MsBuildProject},
/*Database*/ 										"{C8D11400-126E-41CD-887F-60BD40844F9E}": {make: MsBuildProject},
/*Database*/									   	"{A9ACE9BB-CECE-4E62-9AA4-C7E7C5BD2124}": {make: MsBuildProject},
/*Database (other project types)*/				 	"{4F174C21-8C12-11D0-8340-0000F80270F8}": {make: MsBuildProject},
/*Deployment Cab*/								 	"{3EA9E505-35AC-4774-B492-AD1749C4943A}": {make: MsBuildProject},
/*Deployment Merge Module*/							"{06A35CCD-C46D-44D5-987B-CF40FF872267}": {make: MsBuildProject},
/*Deployment Setup*/							   	"{978C614F-708E-4E1A-B201-565925725DBA}": {make: MsBuildProject},
/*Deployment Smart Device Cab*/						"{AB322303-2255-48EF-A496-5904EB18DA55}": {make: MsBuildProject},
/*Distributed System*/							 	"{F135691A-BF7E-435D-8960-F99683D2D49C}": {make: MsBuildProject},
/*Dynamics 2012 AX C# in AOT*/					 	"{BF6F8E12-879D-49E7-ADF0-5503146B24B8}": {make: MsBuildProject},
/*Extensibility*/								  	"{82B43B9B-A64C-4715-B499-D71E9CA2BD60}": {make: MsBuildProject},
/*F#*/											 	"{F2A71F9B-5D33-465A-A702-920D77279786}": {make: ManagedProjectMaker('FSharp'), 	icon:"FSProjectNode", ext:"fsproj"},
/*F# (CPS)*/ 										"{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}": {make: CPSProjectMaker('FSharp', 'fs'),	icon:"FSProjectNode"},
/*J#*/											 	"{E6FDF86B-F3D1-11D4-8576-0002A516ECE8}": {make: MsBuildProject, 					icon:"JSProjectNode"},
/*JScript*/											"{262852C6-CD72-467D-83FE-5EEB1973A190}": {make: MsBuildProject},
/*Legacy (2003) Smart Device (C#)*/					"{20D4826A-C6FA-45DB-90F4-C717570B9F32}": {make: MsBuildProject},
/*Legacy (2003) Smart Device (VB.NET)*/				"{CB4CE8C6-1BDB-4DC7-A4D3-65A1999772F8}": {make: MsBuildProject},
/*LightSwitch*/										"{8BB0C5E8-0616-4F60-8E55-A43933E57E9C}": {make: MsBuildProject},
/*Lightswitch*/										"{DA98106F-DEFA-4A62-8804-0BD2F166A45D}": {make: MsBuildProject},
/*LightSwitch Project*/								"{581633EB-B896-402F-8E60-36F3DA191C85}": {make: MsBuildProject},
/*Micro Framework*/									"{B69E3092-B931-443C-ABE7-7E7b65f2A37F}": {make: MsBuildProject},
/*Mono for Android / Xamarin.Android*/				"{EFBA0AD7-5A72-4C68-AF49-83D382785DCF}": {make: MsBuildProject},
/*MonoDevelop Addin*/							  	"{86F6BF2A-E449-4B3E-813B-9ACC37E5545F}": {make: MsBuildProject},
/*MonoTouch  Xamarin.iOS*/							"{6BC8ED88-2882-458C-8E55-DFD12B67127B}": {make: MsBuildProject},
/*MonoTouch Binding*/							  	"{F5B4F3BC-B597-4E2B-B552-EF5D8A32436F}": {make: MsBuildProject},
/*Office/SharePoint App*/						  	"{C1CDDADD-2546-481F-9697-4EA41081F2FC}": {make: MsBuildProject},
/*Platform Toolset v120*/						  	"{8DB26A54-E6C6-494F-9B32-ACBB256CD3A5}": {make: MsBuildProject},
/*Platform Toolset v141*/						  	"{C2CAFE0E-DCE1-4D03-BBF6-18283CF86E48}": {make: MsBuildProject},
/*Portable Class Library*/						 	"{786C830F-07A1-408B-BD7F-6EE04809D6DB}": {make: MsBuildProject},
/*PowerShell*/									 	"{F5034706-568F-408A-B7B3-4D38C6DB8A32}": {make: MsBuildProject},
/*Project Folders*/									"{66A26720-8FB5-11D2-AA7E-00C04F688DDE}": {make: MsBuildProject},
/*Python*/										 	"{888888A0-9F3D-457C-B088-3A5042F75D52}": {make: MsBuildProject},
/*SharePoint (C#)*/									"{593B0543-81F6-4436-BA1E-4747859CAAE2}": {make: MsBuildProject},
/*SharePoint (VB.NET)*/								"{EC05E597-79D4-47F3-ADA0-324C4F7C7484}": {make: MsBuildProject},
/*SharePoint Workflow*/								"{F8810EC1-6754-47FC-A15F-DFABD2E3FA90}": {make: MsBuildProject},
/*Silverlight*/										"{A1591282-1198-4647-A2B1-27E5FF5F6F3B}": {make: MsBuildProject},
/*Smart Device (C#)*/							  	"{4D628B5B-2FBC-4AA6-8C16-197242AEB884}": {make: MsBuildProject},
/*Smart Device (VB.NET)*/						  	"{68B1623D-7FB9-47D8-8664-7ECEA3297D4F}": {make: MsBuildProject},
/*SSIS*/										   	"{159641D6-6404-4A2A-AE62-294DE0FE8301}": {make: MsBuildProject},
/*SSIS*/										   	"{D183A3D8-5FD8-494B-B014-37F57B35E655}": {make: MsBuildProject},
/*SSIS*/										   	"{C9674DCB-5085-4A16-B785-4C70DD1589BD}": {make: MsBuildProject},
/*SSRS*/										   	"{F14B399A-7131-4C87-9E4B-1186C45EF12D}": {make: MsBuildProject},
/*Shared Project*/								 	"{D954291E-2A0B-460D-934E-DC6B0785DB48}": {make: MsBuildProject, ext:"shproj"},
/*Test*/										   	"{3AC096D0-A1C2-E12C-1390-A8335801FDAB}": {make: MsBuildProject},
/*Universal Windows Class Library (UWP)*/		  	"{A5A43C5B-DE2A-4C0C-9213-0A381AF9435A}": {make: MsBuildProject},
/*VB.NET*/										 	"{F184B08F-C81C-45F6-A57F-5ABD9991F28F}": {make: ManagedProjectMaker('VisualBasic'),	icon:"VBProjectNode", ext:"vbproj"},
/*VB.NET (CPS)*/								 	"{778DAE3C-4631-46EA-AA77-85C1314464D9}": {make: CPSProjectMaker('VisualBasic', 'vb'),	icon:"VBProjectNode"},
/*Visual Database Tools*/						  	"{C252FEB5-A946-4202-B1D4-9916A0590387}": {make: MsBuildProject},
/*Visual Studio 2015 Installer Project Extension*/	"{54435603-DBB4-11D2-8724-00A0C9A8B90C}": {make: MsBuildProject},
/*Visual Studio Tools for Applications (VSTA)*/		"{A860303F-1F3F-4691-B57E-529FC101A107}": {make: MsBuildProject},
/*Visual Studio Tools for Office (VSTO)*/		  	"{BAA0C2D2-18E2-41B9-852F-F413020CAA33}": {make: MsBuildProject},
/*Windows Application Packaging Project (MSIX)*/	"{C7167F0D-BC9F-4E6E-AFE1-012C56B48DB5}": {make: MsBuildProject, ext:"wapproj"},
/*Windows Communication Foundation (WCF)*/		 	"{3D9AD99F-2412-4246-B90B-4EAA41C64699}": {make: MsBuildProject},
/*Windows Phone 8/8.1 Blank/Hub/Webview App*/	  	"{76F1466A-8B6D-4E39-A767-685A06062A39}": {make: MsBuildProject},
/*Windows Phone 8/8.1 App (C#)*/				   	"{C089C8C0-30E0-4E22-80C0-CE093F111A43}": {make: MsBuildProject},
/*Windows Phone 8/8.1 App (VB.NET)*/			   	"{DB03555F-0C8B-43BE-9FF9-57896B3C5E56}": {make: MsBuildProject},
/*Windows Presentation Foundation (WPF)*/		  	"{60DC8134-EBA5-43B8-BCC9-BB4BC16C2548}": {make: MsBuildProject},
/*Windows Store (Metro) Apps & Components*/			"{BC8A1FFA-BEE3-4634-8014-F334798102B3}": {make: MsBuildProject},
/*Workflow (C#)*/								  	"{14822709-B5A1-4724-98CA-57A101D1B079}": {make: MsBuildProject},
/*Workflow (VB.NET)*/							  	"{D59BE175-2ED0-4C54-BE3D-CDAA9F3214C8}": {make: MsBuildProject},
/*Workflow Foundation*/								"{32F31D43-81CC-4C15-9DE6-3FC5453562B6}": {make: MsBuildProject},
/*Workflow Foundation (Alternate)*/					"{2AA76AF3-4D9E-4AF0-B243-EB9BCDFB143B}": {make: MsBuildProject},
/*XNA (Windows)*/								  	"{6D335F3A-9D43-41b4-9D22-F6F17C4BE596}": {make: MsBuildProject},
/*XNA (XBox)*/									 	"{2DF5C3F4-5A5F-47A9-8E94-23B4456F55E2}": {make: MsBuildProject},
/*XNA (Zune)*/									 	"{D399B71A-8929-442A-A9AC-8BEC78BB2433}": {make: MsBuildProject},


/*'Javascript Application Project Files'*/			"{54A90642-561A-4BB1-A94E-469ADEE60C69}": {make: ESProject,		icon:"TSProjectNode", ext:"esproj"},
/*Android Packaging Projects'*/						"{39E2626F-3545-4960-A6E8-258AD8476CE5}": {make: AndroidProject, ext:"androidproj"},
});