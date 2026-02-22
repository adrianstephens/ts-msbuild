import * as path from 'path';
import * as fs from 'fs';
import * as xml from '@isopodlabs/xml';
import * as registry from '@isopodlabs/registry';
import { StaticFunctions, NETString, get_params, ReExpand, Evaluate, EvaluateExpressionNormal, EvaluateExpressionPartial } from './expression';
import * as utils from '@isopodlabs/utilities';
import * as insensitive from '@isopodlabs/utilities/insensitive';

import { ProjectContainer, Project, ProjectConfiguration, ProjectItemEntry, Properties, FolderTree, Folder, FileEntry } from './Project';
import { XMLCache, xml_load, xml_save, Glob, exists, toOSPath, search, stats, Solution } from './index';
import * as Locations from './Locations';

//-----------------------------------------------------------------------------
//	types
//-----------------------------------------------------------------------------

export type Metadata	= Record<string, any>;
export type Origins		= Record<string, xml.Element>;

export interface MetadataWithOrigins {
	metadata:	Metadata;
	origins:	Origins;
}

interface PropertiesWithOrigins extends PropertyContext {
	origins:	Origins;
}

interface Imports {
	[key:string]: string[];
	all: string[];
}

//-----------------------------------------------------------------------------
//	Properties
//-----------------------------------------------------------------------------

const reSubs = utils.regex('gi')`
# list reference
\@\(
	(?<list>\w+)
	(?<part2>
		\)
		|->
	)

# item metadata reference
|\%\(
	(?<meta>\w+)
	(?:\.(?<part2>\w+))?
\)

# registry reference
|\$\(
	registry:(?<key>[^@)]+)
	@(?<part2>.+?)
\)

# property or function call
|\$\(
	(?<part1>
		|\w+					# simple word
		|\[[\w.]+\]				# bracketed word/dots
	)
	(?<part2>
		\)
		|\.\w+
		|::\w+
	)
`;


export class PropertyContext {
	globals	= new Set<string>();
	properties:	Record<string, string>;
	items:		Record<string, Items> = {};
	cache	= new Map<string, Promise<boolean>>();
	
	constructor(properties: Record<string, string> = {}) {
		this.properties = insensitive.Record(properties);
	}

	substitute(value: string, metadata?: Metadata, leave_undefined = false): Promise<string> {
		const re = utils.reDup(reSubs);
		const recurse = async (metadata?: Metadata): Promise<string> => {
			return utils.async_replace(value, re, async (m) => {
				const {list, meta, key, part1, part2} = m.groups!;

				if (list) {
					//%(list) or %(list->) is a reference to the items in the list, with -> indicating that metadata should be evaluated for each item and joined with ';'

					const item = this.items[list];
					if (part2 === ')') {
						//return item.entries.join(';');
						return Promise.all(item.entries.map(async entry => {
							const settings = (await item.evaluate(this, entry)).metadata;
							return settings.Identity;

						})).then(results => results.join(';'));
					}

					const [close, params] = get_params(value.slice(re.lastIndex));
					re.lastIndex += close;

					if (item.entries.length === 0)
						return '';

					const result = await utils.async.map(item.entries, async entry => {
						const settings = (await item.evaluate(this, entry)).metadata;
						const result = await this.substitute(params[0], settings);
						return result;
					});
					
					return result.join(';');

				} else if (meta) {
					//%(meta) or %(meta.field) is a reference to the metadata of the current item, with field being optional and indicating a specific metadata field

					if (part2) {
						const _item = this.items[meta];
						return metadata?.[part2];

					} else {
						const value = metadata?.[meta];
						return value ?? (leave_undefined ? m[0] : '');
					}

				} else if (key) {
					//$(registry:key@value) is a reference to the registry, with key being the registry key and value being the name of the value to retrieve

					const hkey	= await registry.getKey(key);
					return hkey.values[part2] ?? (leave_undefined ? m[0] : '');
				}

				//$(property) or $(property.func) or $(property::func) is a reference to a property, with optional function calls. :: indicates a static function call, while . indicates an instance function call on the property value

				let replace = part1.startsWith('[') ? part1.slice(1, -1) : this.properties[part1.toUpperCase()];
				
				if (!replace) {
					if (leave_undefined)
						return m[0];
					replace = '';
				}

				if (part2 === ')')
					return replace;

				const right = await recurse(metadata);
				const [close, params] = right[0] === '(' ? get_params(right, 1) : [0, []];
				let result;

				try {
					if (part2.startsWith('::')) {
						result = await StaticFunctions.run(replace, part2.slice(2), ...params);
						if (result instanceof ReExpand)
							result = await this.substitute(result.value, metadata);
					} else {
						result = new NETString(replace)[part2.slice(1)](params);
					}

					const t = await Evaluate(result, right, close);
					return (t.result == undefined ? '' : t.result.toString()) + right.substring(t.end + 1);//+1 for substitution closing )

				} catch (_error) {
					return `error_evaluating_${result}`;
				}

			});
		};
		return recurse(metadata);
	}

	async substitute_path(value: string): Promise<string> {
		return toOSPath(await this.substitute(value, undefined, true));
	}

	async checkConditional(condition?: string, metadata?: Metadata) : Promise<boolean> {
		if (!condition)
			return true;

		const cached = this.cache.get(condition);
		if (cached)
			return cached;

		stats.checkConditional++;
		const subs	= await this.substitute(condition, metadata);
		const res	= await EvaluateExpressionNormal(subs);
		this.cache.set(condition, res.result);
		return res.result;
	}

	setPath(fullPath: string) {
		const parsed 	= path.parse(fullPath);
		this.addDirect({
			MSBuildThisFileFullpath:	fullPath,
			MSBuildThisFileDirectory:	parsed.dir + path.sep,
			MSBuildThisFile:			parsed.base,
			MSBuildThisFileName:		parsed.name,
			MSBuildThisFileExtension:	parsed.ext,
		});
	}

	currentPath() {
		return this.properties.MSBUILDTHISFILEFULLPATH;
	}

	makeLocal(locals: string[]) {
		locals.forEach(i => this.globals.delete(i.toUpperCase()));
	}

	makeGlobal(globals: string[]) {
		globals.forEach(i => this.globals.add(i.toUpperCase()));
	}
	isGlobal(name: string) {
		return this.globals.has(name.toUpperCase());
	}

	async set(name: string, value: string, substitute: boolean): Promise<boolean> {
		if (this.isGlobal(name))
			return false;
		this.properties[name] = await this.substitute(value, undefined, !substitute);
		this.cache.clear();
		return true;
	}

	async add(props: Record<string, string>) {
		for (const i in props)
			await this.set(i, props[i], true);
	}

	addDirect(props: Record<string, string>) {
		for (const i in props)
			this.properties[i] = props[i];
		this.cache.clear();
	}
}

async function evaluateImport(import_path: string, properties: PropertyContext, label = '', imports?: Imports, modified?: Origins) {
	const currentPath	= properties.currentPath();
	const currentDir	= currentPath ? path.dirname(currentPath) : process.cwd();
	const resolved		= await properties.substitute_path(import_path);
	const files			= await utils.async.map(resolved.split(';').filter(Boolean), r => search(path.resolve(currentDir, r))).then(results => results.flat());
	for (const i of files) {
		if (imports && imports.all.indexOf(i) !== -1) {
			console.log(`Double import: ${i}`);
			continue;
		}

		const root = (await XMLCache.get(i))?.firstElement();
		if (root?.name == 'Project') {
			properties.setPath(i);
			await evaluatePropsAndImports(root.allElements(), properties, imports, modified);

			if (imports) {
				if (!(label in imports))
					imports[label] = [];
				imports[label].push(i);
				imports.all.push(i);
			}
		} else {
			console.log(`Invalid import: ${i} from ${import_path}`);
		}
	}
	if (currentPath)
		properties.setPath(currentPath);
}

async function evaluatePropsAndImports(raw_xml: xml.Element[], properties: PropertyContext, imports?: Imports, modified?: Origins) : Promise<void> {
	for (const element of raw_xml) {
		if (await properties.checkConditional(element.attributes.Condition)) {
			if (element.name === 'PropertyGroup') {
				for (const e of element.allElements()) {
					if (await properties.checkConditional(e.attributes.Condition)
					&&	await properties.set(e.name, e.firstText() || '', true)
					&&	modified
					)
						modified[e.name.toUpperCase()] = e;
				}

			} else if (element.name === "Import") {
				if (element.attributes.Sdk) {
					const sdkPath = await Locations.getSdkPath(element.attributes.Sdk, properties.properties.MSBuildSDKsPath);
					//silently ignore missing SDK imports as they are often optional and handled by targets files
					if (sdkPath)
						await evaluateImport(path.join(sdkPath, element.attributes.Project), properties, '', imports, modified);
				} else {
					await evaluateImport(element.attributes.Project, properties, '', imports, modified);
				}

			} else if (element.name === "ImportGroup") {
				const label = element.attributes.Label??'';
				for (const item of element.children) {
					if (xml.isElement(item) && item.name == "Import" && await properties.checkConditional(item.attributes.Condition))
						await evaluateImport(item.attributes.Project, properties, label, imports, modified);
				}
			} else if (element.name === "Choose") {
				for (const item of element.allElements()) {
					if (item.name === "When" && await properties.checkConditional(item.attributes.Condition)) {
						await evaluatePropsAndImports(item.allElements(), properties, imports, modified);
						break;
						
					} else if (item.name === "Otherwise") {
						await evaluatePropsAndImports(item.allElements(), properties, imports, modified);
					}
				}
			}
		}
	}
}

//-----------------------------------------------------------------------------
//	Items
//-----------------------------------------------------------------------------

//these items do not use file paths
const plainItems = new Set<string>([
	"Reference",			"PackageReference",
	"BuildMacro", 			"AvailableItemName",
	"AssemblyMetadata", 	"BaseApplicationManifest", "CodeAnalysisImport",
	"COMReference", 		"COMFileReference",
	"InternalsVisibleTo", 	"NativeReference", 		"TrimmerRootAssembly", "Using", "Protobuf",
	"ProjectConfiguration", "ProjectCapability",	"ProjectTools",
	"CustomBuildStep",    	"PreBuildEvent",  		"PreLinkEvent",    "PostBuildEvent",
]);

const nonNormalItems = new Set<string>([
	'PropertyPageSchema',
	'ProjectReference',
	'TargetPathWithTargetPlatformMoniker',
	'CoreCppClean', 'CoreClangTidy',
	'DebuggerPages', 'AppHostDebuggerPages','DesktopDebuggerPages',
	'GeneralDirsToMake',
	'ManifestResourceCompile'
]);

export const ItemMode = {
	File:	0,
	Text:	1,
	Other:	2,
};
export type ItemMode = typeof ItemMode[keyof typeof ItemMode];

function getItemMode(name: string) {
	return plainItems.has(name) ? ItemMode.Text : nonNormalItems.has(name) ? ItemMode.Other : ItemMode.File;
}

function getLink(element: xml.Element) {
	const link 		= toOSPath(element.attributes.Link ?? element.elements.Link?.firstText());
	if (link)
		return link;

	const linkBase 	= toOSPath(element.attributes.LinkBase ?? element.elements.LinkBase?.firstText());
	if (linkBase)
		return path.join(linkBase, "%(RecursiveDir)%(Filename)%(Extension)");
}

function fixRelativePath(relativePath: string, link?: string): string {
	if (link) {
		const parsed = path.parse(relativePath);
		return link
			.replace("%(Extension)", parsed.ext)
			.replace("%(Filename)", parsed.name)
			.replace("%(RecursiveDir)", parsed.dir);
	}
	return relativePath;
}

class CachedMetadata {
	constructor(public properties: PropertyContext, public metadata: MetadataWithOrigins) {}
}

async function evaluateMetadata(elements: xml.Element[], properties: PropertyContext, metadata: Metadata, origins: Origins) {

	async function evaluate(item: xml.Element): Promise<any> {
		if (item.firstElement())
			return Object.fromEntries(await utils.async.map(item.allElements(), async i => [i.name, await evaluate(i)] as [string, any]));
	
		const text = item.allText().join();
		return properties.substitute(text, metadata);
	}

	for (const i of elements) {
		if (await properties.checkConditional(i.attributes.Condition, metadata)) {
			metadata[i.name]	= await evaluate(i);
			origins[i.name]		= i;
		}
	}
}

async function hasConditional(condition: string | undefined, type: string, value: string) {
	if (!condition || !condition.includes(type) || !condition.includes(value))
		return undefined;
	
	condition = condition.replaceAll(type, value);
	return await EvaluateExpressionPartial(condition);
}

function cloneNode(node: xml.Node): xml.Node {
	if (xml.isElement(node))
		return cloneElement(node);
	return node;
}

function cloneElement(element: xml.Element): xml.Element {
	return new xml.Element(element.name, {...element.attributes}, element.children.map(cloneNode));
}

function replaceConditionValue(condition: string, from: string, to: string): string {
	return condition.replaceAll(from, to);
}

async function removeConditionals(elements: xml.Element[], type: string, value: string) {
	return await utils.async.map(elements, async e => {
		const has = await hasConditional(e.attributes.Condition, type, value);
		if (typeof has === 'boolean') {
			if (!has) {
				e.parent?.remove(e);
				return undefined;
			} else {
				delete e.attributes.Condition;
			}
		}
		return e;
	}).then(results => results.filter(Boolean) as xml.Element[]);
}

async function copyConditionals(elements: xml.Element[], type: string, from: string, to: string) {
	return utils.async.map(elements, async e => {
		const has = await hasConditional(e.attributes.Condition, type, from);
		if (has === true) {
			const cloned = cloneElement(e);
			cloned.attributes.Condition = replaceConditionValue(e.attributes.Condition, from, to);
			return cloned;
		}
	}).then(results => results.filter(Boolean) as xml.Element[]);
}

class XMLProjectItemEntry implements ProjectItemEntry {
	data = new Proxy(this, {
		get(target, prop: string) {
			if (prop in target.other)
				return target.other[prop];
			return target.elements.find(e => e.name === prop)?.firstText() || '';
		},
		set(target, prop: string, value: any) {
			target.other[prop] = value;
			return true;
		},
		ownKeys(target) {
			return target.elements.map(e => e.name);
		},
		getOwnPropertyDescriptor(_target, _prop: string) {
			//if (prop in target.other || target.elements.find(e => e.name === prop))
			return {configurable: true, enumerable: true, writable: true};
		}
	
	}) as Record<string, any>;
	elements:	xml.Element[];
	cached:		CachedMetadata | undefined;

	constructor(public name:string, public source?: xml.Element, private other: Record<string, any> = {}) {
		this.elements = source?.allElements() ?? [];
	}
	add(elements: xml.Element[], other: Record<string, any> = {}) {
		for (const i of elements) {
			const alike = this.elements.filter(e => e.name === i.name && e.attributes.Condition === i.attributes.Condition);
			for (const j of alike)
				utils.array.remove(this.elements, j);
		}
		this.elements	= [...this.elements, ...elements];
		this.other		= {...this.other, ...other};
	}
	modify(name: string, value: string, condition: string | undefined) {
		const index = this.elements.findIndex(e => e.name === name && e.attributes.Condition === condition);
		const element = value === '<inherit>' ? undefined : new xml.Element(name, condition ? {Condition: condition} : undefined, [value]);
		if (index < 0) {
			if (element)
				this.elements.push(element);
		} else {
			const loc = this.elements[index];
			if (!element) {
				utils.array.remove(this.elements, loc);
			} else {
				this.elements[index] = element;
			}
			return loc;
		}
	}
	toString() {
		//return this.source?.attributes["Include"] ? await properties.substitute(this.source?.attributes["Include"]) : this.data.relativePath;
		return this.source?.attributes["Include"] ?? this.data.relativePath;
	}

}

interface Definition {
	condition: 	string;
	source?:	xml.Element;
	elements:	xml.Element[];
	isProject: 	boolean;
};

export class Items {
	definitions:	Definition[] = [];
	entries:		XMLProjectItemEntry[] = [];
	cached:			CachedMetadata | undefined;

	constructor(public name: string, public mode: ItemMode) {}

	addDefinition(condition: string, source: xml.Element, isProject:boolean) {
		this.definitions.push({condition, source, elements: source.allElements(), isProject});
	}

	getDefinition(condition: string, isProject:boolean) : Definition {
		for (const d of this.definitions) {
			if (d.condition === condition && d.isProject == isProject)
				return d;
		}
		const d = {condition, elements: [], isProject};
		this.definitions.push(d);
		return d;
	}

	async evaluate(properties: PropertyContext, entry?: XMLProjectItemEntry) : Promise<MetadataWithOrigins> {
		if (!entry) {
			if (this.cached && this.cached.properties === properties)
				return this.cached.metadata;

			const origins:	Origins		= {};
			const metadata:	Metadata	= {};
			for (const d of this.definitions) {
				if (await properties.checkConditional(d.condition, metadata))
					await evaluateMetadata(d.elements, properties, metadata, origins);
			}
			this.cached = new CachedMetadata(properties, {metadata, origins});
			return {metadata, origins};
		}

		if (entry.cached && entry.cached.properties === properties)
			return entry.cached.metadata;
		
		const defining	= path.parse(entry.data.defining);

		const origins:	Origins		= {};
		let metadata: Metadata = {
			Identity:					entry.source?.attributes["Include"] ? await properties.substitute(entry.source?.attributes["Include"]) : entry.data.relativePath,
			DefiningProjectFullPath:	entry.data.defining,
			DefiningProjectDirectory:	defining.dir,
			DefiningProjectName:		defining.name,
			DefiningProjectExtension:	defining.ext,
		};

		const fullPath 	= entry.data.fullPath;
		if (fullPath) {
			const parsed 	= path.parse(fullPath);
			const stat 		= new utils.Lazy<Promise<fs.Stats | undefined>>(() => fs.promises.stat(fullPath));
			metadata = {...metadata,
				FullPath:					fullPath,
				RootDir:					parsed.root,
				Filename:					parsed.name,
				Extension:					parsed.ext,
				RelativeDir:				entry.data.relativePath,
				Directory:					parsed.dir.slice(parsed.root.length),
				RecursiveDir:				path.dirname(entry.data.relativePath),
				get ModifiedTime()			{ return stat.then(s => s?.mtime.toISOString() ?? ''); },
				get CreatedTime()			{ return stat.then(s => s?.ctime.toISOString() ?? ''); },
				get AccessedTime()			{ return stat.then(s => s?.atime.toISOString() ?? ''); },
			};
		}

		for (const d of this.definitions) {
			if (await properties.checkConditional(d.condition))
				await evaluateMetadata(d.elements, properties, metadata, origins);
		}

		await evaluateMetadata(entry.elements, properties, metadata, origins);

		entry.cached = new CachedMetadata(properties, {metadata, origins});
		return {metadata, origins};
	}

	includePlain(name: string, source?: xml.Element, other: Record<string, any> = {}) {
		const item = this.entries.find(e => e.name === name);
		if (item) {
			item.add(source?.allElements() ?? [], other);
		} else {
			if (!source) {
				source = new xml.Element(this.name, {Include: name});
				for (const i in other)
					 source.add(new xml.Element(i, undefined, [other[i]]));
			}
			this.entries.push(new XMLProjectItemEntry(name, source, other));
		}
	}

	includeFile(defining: string, fullPath: string, source: xml.Element, link?:string) {
		let item = this.entries.find(e => e.data.fullPath === fullPath);
		if (item) {
			if (source)
				item.add(source.allElements());
		} else {
			item = new XMLProjectItemEntry(
				path.basename(fullPath), source, 
				{
					fullPath,
					defining,
					relativePath: 	fixRelativePath(path.relative(path.dirname(defining), fullPath), link),
					item: 			this,
				}
			);
			this.entries.push(item);
		}
		return item;
	}

	async includeFiles(defining: string, value: string, exclude: string | undefined, data: xml.Element, link?:string) {
		const excludes	= exclude?.split(";");
		for (let pattern of value.split(';')) {
			if ((pattern = pattern.trim())) {
				for (const filepath of await search(path.resolve(path.dirname(defining), pattern), excludes))
					this.includeFile(defining, filepath, data, link);
			}
		}
	}

	removeFiles(basePath: string, value: string) {
		const exclude = new Glob(value.split(";").map(s => path.join(basePath, s)));
		this.entries = this.entries.filter(e => !exclude.test(e.data.fullPath));
	}

	updateFiles(basePath: string, value: string, data: xml.Element, link?:string) {
		const update	= new Glob(value.split(";").map(s => path.join(basePath, s)));
		for (const entry of this.entries) {
			if (update.test(entry.data.fullPath)) {
				const relativePath 		= fixRelativePath(entry.data.relativePath, link);
				entry.name 				= path.basename(relativePath);
				entry.data.relativePath	= relativePath;
			}
		}
	}

	getEntry(filepath : string) {
		for (const entry of this.entries)
			if (entry.data.fullPath === filepath)
				return entry;
	}

	async removeConditionals(type: string, value: string) {
		this.definitions = await utils.async.map(this.definitions, async d => {
			const has = await hasConditional(d.condition, type, value);
			if (typeof has === 'boolean') {
				if (!has) {
					d.source?.parent?.remove(d.source);
					return undefined;
				} else {
					d.condition = '';
				}
			}
			d.elements = await removeConditionals(d.elements, type, value);
			return d;
		}).then(results => results.filter(Boolean) as Definition[]);

		for (const e of this.entries)
			e.elements = await removeConditionals(e.elements, type, value);
	}

	async copyConditionals(type: string, from: string, to: string) {
		const newDefinitions = await utils.async.map(this.definitions, async d => {
			d.elements.push(...await copyConditionals(d.elements, type, from, to));

			if (!d.isProject || !d.source)
				return d;

			const has = await hasConditional(d.condition, type, from);
			if (has === true) {
				const root = (() => {
					let p: xml.Element | undefined = d.source;
					while (p?.parent)
						p = p.parent;
					return p;
				})();

				if (root) {
					const newCondition = replaceConditionValue(d.condition, from, to);
					const group = new xml.Element('ItemDefinitionGroup', {Condition: newCondition});
					const newElements = [...d.elements, ...await copyConditionals(d.elements, type, from, to)];
					const newSource = new xml.Element(this.name, {...d.source.attributes}, newElements);
					group.add(newSource);
					root.add(group);
					return {condition: newCondition, source: group, elements: newElements, isProject: d.isProject};
				}
			}
		}).then(results => results.filter(Boolean) as Definition[]);

		this.definitions.push(...newDefinitions);

		for (const e of this.entries)
			e.elements.push(...await copyConditionals(e.elements, type, from, to));
	}

	addSetting(name: string, value: string, condition: string | undefined, entry: XMLProjectItemEntry|undefined) : xml.Element | undefined {
		if (entry)
			return entry.modify(name, value, condition);

		let loc: xml.Element | undefined;
		const d = this.getDefinition(condition || '', true);
		for (const i of d.elements) {
			if (i.name === name) {
				loc = i;
				break;
			}
		}
		if (value === '<inherit>') {
			utils.array.remove(d.elements, loc);
			return;
			
		} else if (loc) {
			loc.setText(value);
		} else {
			loc = new xml.Element(name, undefined, [value]);
			d.elements.push(loc);
		}

		return loc as xml.Element;
	}
}

function MakeItemsProxy(items: Record<string, Items>) {
	return new Proxy(items, {
		get(target, name: string) {
			if (!(name in target)) {
				const lower = name.toLowerCase();
				const found = Object.keys(target).find(e => e.toLowerCase() === lower);
				if (found) {
					name = found;
				} else {
					const mode = getItemMode(name);
					target[name] = new Items(name, mode);
				}
			}
			return target[name];
		},
		has(target, name: string) {
			if (name in target)
				return true;
			const lower = name.toLowerCase();
			return !!Object.keys(target).find(e => e.toLowerCase() === lower);
		}
	});
}

async function readItems(elements: xml.Element[], properties: PropertyContext, allitems: Record<string, Items>, isProject: boolean): Promise<undefined> {
	const defining 	= properties.currentPath();
	const basepath 	= path.dirname(defining);

	for (const element of elements) {
		if (element.name === "ItemDefinitionGroup") {
			const condition = element.attributes.Condition ?? '';
			for (const item of element.allElements())
				allitems[item.name].addDefinition(condition, item, isProject);

		} else if (element.name === 'ItemGroup') {//} && await properties.checkConditional(element.attributes.Condition)) {
			for (const item of element.allElements()) {
				const name	= item.name;
				const items = allitems[name];

				if (name === "Reference" && item.attributes.Include) {
					const include	= await properties.substitute_path(item.attributes.Include);
					const sdk		= Locations.ParseSDKKey(include);
					items.includePlain(sdk.identifier, item, {defining, version: sdk.version});

				} else if (name === "PackageReference" && item.attributes.Include && items.entries.length == 0 && await exists(path.join(basepath, 'packages.config'))) {
					const config = await XMLCache.get(path.join(basepath, 'packages.config'));
					if (config) {
						for (const e of config.elements.packages.allElements())
							items.includePlain(e.attributes.id, item, {defining, version: e.attributes.version});
					}

				} else if (items.mode == ItemMode.Text && item.attributes.Include) {
					const include = await properties.substitute(item.attributes.Include);
					items.includePlain(include, item, {defining});
					//{
						//source:	item,
						//...Object.fromEntries(item.allElements().filter(i => !i.firstElement()).map(i => [i.name, i.allText().join()]))
					//});
	
				} else {
					if (item.attributes.Include) {
						const include = properties.substitute_path(item.attributes.Include);
						const excludes = item.attributes.Exclude && properties.substitute_path(item.attributes.Exclude);
						await items.includeFiles(defining, await include, await excludes, item, getLink(item));
					}
				
					if (item.attributes.Remove)
						items.removeFiles(basepath, await properties.substitute_path(item.attributes.Remove));
				
					if (item.attributes.Update)
						items.updateFiles(basepath, await properties.substitute_path(item.attributes.Update), item, getLink(item));
				}
			}
		}
	}
}

//-----------------------------------------------------------------------------
//	Project
//-----------------------------------------------------------------------------
// from MSBuild.exe.config
const MSBuildProperties : Record<string, string | utils.Lazy<Promise<string>>> = {
//	VsInstallRoot:					"$([MSBuild]::GetVsInstallRoot())",
	MSBuildVersion:					"$(VisualStudioVersion)",
	MSBuildToolsVersion:			"Current",
	MSBuildRuntimeVersion:			new utils.Lazy(() => Locations.getMSBuildRuntimeVersion()),
	MSBuildProgramFiles32:			"$([MSBuild]::GetProgramFiles32())",
	MSBuildToolsRoot:				"$(VsInstallRoot)\\MSBuild",
	MSBuildToolsPath32:				"$(VsInstallRoot)\\MSBuild\\Current\\Bin",
	MSBuildToolsPath64:				"$(VsInstallRoot)\\MSBuild\\Current\\Bin\\amd64",
	MSBuildToolsPath:				"$(MSBuildToolsPath64)",
	MSBuildBinPath:					"$(MSBuildToolsPath64)",
	MSBuildExtensionsPath:			"$(MSBuildToolsRoot)",
	MSBuildExtensionsPath32:		"$(MSBuildToolsRoot)",
	MSBuildExtensionsPath64:		"$(MSBuildProgramFiles32)\\MSBuild",
	MSBuildSDKsPath:				"$(MSBuildToolsRoot)\\Sdks",
	RoslynTargetsPath:				"$(MSBuildToolsPath32)\\Roslyn",
	VCTargetsPath:					"$([MSBuild]::ValueOrDefault('$(VCTargetsPath)','$(MSBuildExtensionsPath32)\\Microsoft\\VC\\v170\\'))",
	VCTargetsPath14:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath14)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V140\\'))",
	VCTargetsPath12:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath12)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V120\\'))",
	VCTargetsPath11:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath11)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\V110\\'))",
	VCTargetsPath10:				"$([MSBuild]::ValueOrDefault('$(VCTargetsPath10)','$(MSBuildProgramFiles32)\\MSBuild\\Microsoft.Cpp\\v4.0\\'))",
	AndroidTargetsPath:				"$(MSBuildExtensionsPath32)\\Microsoft\\MDD\\Android\\V150\\",
	iOSTargetsPath:					"$(MSBuildExtensionsPath32)\\Microsoft\\MDD\\iOS\\V150\\",
//	VSToolsPath:					"$(MSBuildProgramFiles32)\\MSBuild\\Microsoft\\VisualStudio\\v$(VisualStudioVersion)",
	LangID:							"$([MSBuild]::GetLangId())",
	//windows only properties
	MSBuildFrameworkToolsPath:		"$(SystemRoot)\\Microsoft.NET\\Framework\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPath32:	"$(SystemRoot)\\Microsoft.NET\\Framework\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPath64:	"$(SystemRoot)\\Microsoft.NET\\Framework64\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsPathArm64:	"$(SystemRoot)\\Microsoft.NET\\FrameworkArm64\\v$(MSBuildRuntimeVersion)\\",
	MSBuildFrameworkToolsRoot:		"$(SystemRoot)\\Microsoft.NET\\Framework\\",

	FrameworkSDKRoot:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8', 'InstallationFolder', null, RegistryView.Registry32))",
	SDK35ToolsPath:					"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\Windows\\v8.0A\\WinSDK-NetFx35Tools-x86', 'InstallationFolder', null, RegistryView.Registry32))",
	SDK40ToolsPath:					"$([MSBuild]::ValueOrDefault($([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8.1\\WinSDK-NetFx40Tools-x86', 'InstallationFolder', null, RegistryView.Registry32)), $([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\NETFXSDK\\4.8\\WinSDK-NetFx40Tools-x86', 'InstallationFolder', null, RegistryView.Registry32))))",
	WindowsSDK80Path:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Microsoft SDKs\\Windows\\v8.1', 'InstallationFolder', null, RegistryView.Registry32))",
	WindowsKitsRoot:				"$([MSBuild]::GetRegistryValueFromView('HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', 'KitsRoot10', null, RegistryView.Registry32, RegistryView.Default))",
};

function getPropertyGroup(file?: xml.Element, condition?: string) {
	const elements = file?.firstElement();
	if (!elements)
		return;

	condition = condition ?? '';
	for (const i of elements.children) {
		if (xml.isElement(i) && i.name === 'PropertyGroup' && i.attributes.Condition === condition)
			return i;
	}
	
	const i = new xml.Element('PropertyGroup', condition ? {Condition: condition} : {});
	elements.add(i);
	return i;
}

function addPropertySetting(file: xml.Element|undefined, name: string, value: string, condition: string | undefined) : xml.Element | undefined {
	let loc: xml.Element | undefined;

	const d = getPropertyGroup(file, condition);
	if (d) {
		for (const i of d.children) {
			if (xml.isElement(i) && i.name === name) {
				loc = i;
				break;
			}
		}
		if (value === '<inherit>') {
			utils.array.remove(d.children, loc);
			return;

		} else if (loc) {
			loc.setText(value);
		} else {
			loc = new xml.Element(name, undefined, [value]);
			d.add(loc);
		}
	}
	return loc as xml.Element;
}

function getItemGroup(root: xml.Element, condition?: string) {
	for (const g of root.elements.ItemGroup) {
		if (!g.attributes.Label && g.attributes.condition === condition)
			return g;
	}
	const g = new xml.Element('ItemGroup', condition ? {condition} : undefined);
	root.children.push(g);
	return g;
}

async function getExtAssoc(pp: Items) {
	const ext_assoc:	Record<string, string> = {};
	const content:		Record<string, string> = {};

	await Promise.all(pp.entries.map(i => XMLCache.get(i.data.fullPath).then(doc => {
		const root			= doc?.firstElement();
		const FileExtension	= root?.elements.FileExtension;
		const ContentType	= root?.elements.ContentType;
		if (ContentType) {
			for (const i of ContentType)
				content[i.attributes.Name] = i.attributes.ItemType;
		}
		if (FileExtension) {
			for (const i of FileExtension) {
				const itemtype = content[i.attributes.ContentType];
				for (const j of i.attributes.Name.split(';'))
					ext_assoc[j] = itemtype;
			}
		}
	})));
	return ext_assoc;
}

export abstract class MsBuildBase extends Project {
	raw_xml?:	xml.Element;
	user_xml?:	xml.Element;
	items: 		Record<string, Items> 	= {};
	imports:	Imports					= {all:[]};	//currently parsed imports
	ext_assoc	= new utils.Lazy(async () => getExtAssoc(this.items.PropertyPageSchema));
	
	settings_ready			= new utils.DeferredPromise<void>();
	protected project_dirty	= 0;
	private user_dirty		= 0;

	constructor(container: ProjectContainer, type:string, name:string, fullpath: string, guid: string) {
		super(container, type, name, fullpath, guid);
		this.ready		= this.load();
		xml_load(fullpath + ".user").then(doc => this.user_xml = doc);

		container.watch(fullpath, () => {
			this.ready = this.load();
		});
		container.watch(fullpath + ".user", () => {
			xml_load(fullpath + ".user").then(doc => this.user_xml = doc);
		});
	}

	get root() {
		return this.raw_xml?.firstElement();
	}

	protected isMain(loc: xml.Element) : boolean {
		while (loc.parent)
			loc = loc.parent;
		return loc === this.raw_xml;
	}
	isLocal(loc: xml.Element) : boolean {
		while (loc.parent)
			loc = loc.parent;
		return loc === this.raw_xml || loc === this.user_xml;
	}
	protected async rawLoad(fullpath: string) {
		this.items		= MakeItemsProxy({});
		this.imports 	= {all:[]};
		await xml_load(fullpath).then(xml => this.raw_xml = xml);
	}

	protected async rawSave(fullpath: string) {
		const root = this.root;
		if (!root)
			return;

		//organise item definitions by condition
		const definitions: Record<string, Record<string, any>> = {};
		for (const i in this.items) {
			for (const d of this.items[i].definitions) {
				if (d.source && this.isMain(d.source)) {
					if (!(d.condition in definitions))
						definitions[d.condition] = {};
					definitions[d.condition][i] = d.elements;
				}
			}
		}

		const config	= this.items.ProjectConfiguration;
		const element	= new xml.Element('?xml', this.raw_xml?.attributes, [
			new xml.Element('Project', root.attributes, [
				new xml.Element("ItemGroup", {Label: 'ProjectConfigurations'}, config.entries.map(e => new xml.Element('ProjectConfiguration', {Include: e.name}, e.elements))),

				...root.allElements().filter(i => i.name == 'PropertyGroup' || i.name == 'Import' || i.name == 'ImportGroup'),

				...Object.keys(definitions)
					.map(i => new xml.Element('ItemDefinitionGroup', i ? {Condition: i} : {}, [
						...Object.keys(definitions[i]).map(j => new xml.Element(j, {}, definitions[i][j]))
					])),

				...Object.values(this.items)
					.filter(i => i.mode == ItemMode.File || i.name === 'ProjectReference')
					.map(i => ({name: i.name, entries: i.entries.filter(e => e.source && this.isMain(e.source))}))
					.filter(i => i.entries.length)
					.map(i => new xml.Element("ItemGroup", {}, i.entries.map(e => new xml.Element(i.name, {Include: e.data.relativePath}, e.elements))))
			])
		]);

		return xml_save(fullpath, element);
	}

	protected addItem(name: string) {
		return this.items[name] ??= new Items(name, getItemMode(name));
	}

	protected async import(importPath: string, props: PropertyContext, label = '') {
		return evaluateImport(importPath, props, label, this.imports);
	}

	protected async readImportedItems(props: PropertyContext) {
		for (const i of this.imports.all) {
			const root = (await XMLCache.get(i))?.firstElement();
			const prev = props.currentPath();
			props.setPath(i);
			await readItems(root?.allElements()||[], props, this.items, false);
			props.setPath(prev);
		}
	}

	validConfig(config: ProjectConfiguration) {
		return !('ProjectConfiguration' in this.items)
			|| !!this.items.ProjectConfiguration.entries.find(i => i.data.Configuration === config.Configuration && i.data.Platform === config.Platform);
	}

	configurationList() : string[] {
		return 'ProjectConfiguration' in this.items
			? [...new Set(this.items.ProjectConfiguration.entries.map(i => i.data.Configuration))]
			: super.configurationList();
	}
	platformList() : string[] {
		return 'ProjectConfiguration' in this.items
			? [...new Set(this.items.ProjectConfiguration.entries.map(i => i.data.Platform))]
			: super.platformList();
	}

	async removeConfiguration(name: string) {
		const configs = this.items.ProjectConfiguration;
		if (configs) {
			await utils.async.map(Object.values(this.items), async i => await i.removeConditionals('$(Configuration)', name));
			configs.entries = configs.entries.filter(e => e.data.Configuration !== name);
			this.project_dirty = 1;
		}
	}
	async removePlatform(name: string) {
		const configs = this.items.ProjectConfiguration;
		if (configs) {
			await utils.async.map(Object.values(this.items), async i => await i.removeConditionals('$(Platform)', name));
			configs.entries = configs.entries.filter(e => e.data.Platform !== name);
			this.project_dirty = 1;
		}
	}
	async copyConfiguration(to: string, from: string) {
		const configs = this.items.ProjectConfiguration;
		if (!configs)
			return;

		const list		= [...new Set(configs.entries.map(i => i.data.Configuration))];
		if (list.find(i => i === from) && !list.find(i => i === to)) {
			await utils.async.map(Object.values(this.items), async i => await i.copyConditionals('$(Configuration)', from, to));
			for (const i of this.platformList())
				configs.includePlain(`${to}|${i}`, undefined, {Configuration: to, Platform: i});
			this.project_dirty = 1;
		}
	}
	async copyPlatform(to: string, from: string) {
		const configs = this.items.ProjectConfiguration;
		if (!configs)
			return;

		const list		= [...new Set(configs.entries.map(i => i.data.Platform))];
		if (list.find(i => i === from) && !list.find(i => i === to)) {
			await utils.async.map(Object.values(this.items), async i => await i.copyConditionals('$(Platform)', from, to));
			for (const i of this.configurationList())
				configs.includePlain(`${i}|${to}`, undefined, {Configuration: i, Platform: to});
			this.project_dirty = 1;
		}
	}

	protected async makeProjectProps(globals: Properties) {
		const props = new PropertyContext;
		props.items = this.items;
		props.makeLocal(this.root?.attributes.TreatAsLocalPropertys?.split(';') ?? []);

		// environment variables
		props.addDirect(Object.fromEntries(Object.keys(process.env).filter(k => /^[A-Za-z_]\w+$/.test(k)).map(k => [k, process.env[k]??''])));

		props.addDirect(globals);
		props.makeGlobal(Object.keys(globals));
		props.makeGlobal(['SolutionDir']);
		props.setPath(this.fullpath);

		const parsed = path.parse(this.fullpath);
		props.addDirect({
			FullPath:					this.fullpath,
			FileName:					parsed.name,
			Sdk:						this.root?.attributes.Sdk ?? '',
			SolutionDir:				this.container.baseDir + path.sep,
			MSBuildProjectFullPath:		this.fullpath,
			MSBuildProjectDirectory:	parsed.dir + path.sep,
			MSBuildProjectFile:			parsed.base,
			MSBuildProjectName:			parsed.name,
			MSBuildProjectExtension:	parsed.ext,
		});

		await props.add(await utils.async.mapObject(MSBuildProperties, async ([k, v]) => [k, await v]));
		return props;
	}

	async postload(props: PropertyContext) {
		await readItems(this.root?.allElements()??[], props, this.items, true);
		await this.readImportedItems(props);
		this.settings_ready.resolve();

		if ('ProjectReference' in this.items) {
			for (const i of this.items.ProjectReference.entries || [])
				this.addDependency(Project.getFromId(i.data.Project));
		}
	}

	addSetting(source: string, name: string, value: string, condition: string | undefined, item: string|undefined, persist: string, revert: boolean) : xml.Element | undefined {
		let file: xml.Element | undefined;
		if (persist === 'UserFile') {
			this.user_dirty += revert ? -1 : 1;
			file = this.user_xml;
		} else if (persist === 'ProjectFile') {
			this.project_dirty += revert ? -1 : 1;
			file = this.raw_xml;
		}

		if (source) {
			const items = this.items[source];
			return items.addSetting(name, value, condition, item ? items.getEntry(item) : undefined);
		} else {
			return addPropertySetting(file, name, value, condition);
		}
	}

	async getSettings(globals : Properties) {
		const props = await this.makeProjectProps(globals);
		const imports : Imports 	= {all:[]};

		await evaluatePropsAndImports(
			[
				...this.root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			imports
		);
		return props.properties;
	}

	async evaluateProps(globals: Properties): Promise<PropertiesWithOrigins> {
		await this.ready;
		await this.settings_ready;

		const props = await this.makeProjectProps(globals);
		const modified: Origins	= {};
		await evaluatePropsAndImports(
			[
				...this.root?.allElements()??[],
				...this.user_xml?.firstElement()?.allElements()??[]
			],
			props,
			undefined,
			modified
		);

		return Object.assign(props, { origins: modified });
	}

	async load() {
		await this.rawLoad(this.fullpath);

		const root 	= this.root;
		if (root?.name == 'Project') {
			const solution	= this.container as Solution;
			const props		= await this.makeProjectProps(solution.globals());
			await evaluatePropsAndImports(this.root!.allElements(), props, this.imports);
			await this.postload(props);
			console.log(`loaded ${this.fullpath}`);
		}
	}

	async save() {
		await Promise.all([
			this.project_dirty && ((this.project_dirty = 0), this.rawSave(this.fullpath)),
			this.user_dirty && ((this.user_dirty = 0), xml_save(this.fullpath + ".user", this.user_xml!))
		]);
	}

	removeEntry(entry: ProjectItemEntry): boolean {
		for (const i in this.items) {
			const item = this.items[i];
			const index = item.entries.indexOf(entry as XMLProjectItemEntry);
			if (index !== -1) {
				item.entries.splice(index, 1);
				return true;
			}
		}
		return false;
	}
	getFolders(view: string) : Promise<FolderTree> {
		return this.ready.then(() => {
			const	foldertree = new FolderTree;
			if (view == 'items') {
				for (const i in this.items) {
					if (this.items[i].entries.find(i => i.data.fullPath)) {
						const folder = foldertree.root.addFolder(i);
						folder.entries = this.items[i].entries;
					}
				}
			} else {
				const allfiles : Record<string, XMLProjectItemEntry> = {};
				for (const i of Object.values(this.items)) {
					if (i.name == 'Folder') {
						for (const j of i.entries)
							foldertree.addDirectory(j.data.relativePath);

					} else if (i.mode === ItemMode.File) {
						for (const entry of i.entries)
							allfiles[entry.data.fullPath] = entry;
					}
				}
				for (const entry of Object.values(allfiles)) {
					if (entry.data.relativePath) {
						let p = entry.source;
						if (!p) {
							console.log("nope");
						} else {
							while (p.parent)
								p = p.parent;
							if (p === this.raw_xml)
								foldertree.add(entry.data.relativePath, entry);
						}
					}
				}
			}
			return foldertree;
		});
	}

}


//-----------------------------------------------------------------------------
//	Concrete Project Types
//-----------------------------------------------------------------------------

export class MsBuildProject extends MsBuildBase {
	async load() {
		await this.rawLoad(this.fullpath);
		const root 	= this.root;
		if (root?.name == 'Project') {
			const solution	= this.container as Solution;
			const globals	= solution.globals();

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
			const props = await this.makeProjectProps(globals);
			await evaluatePropsAndImports(this.root!.allElements(), props, this.imports);
			await this.postload(props);
		}
	}
}


function ManagedProjectMaker(language: string) {
	return class P extends MsBuildBase {
		async load() {
			await this.rawLoad(this.fullpath);
			const root 	= this.root;
			if (root?.name == 'Project') {
				const solution	= this.container as Solution;
				const props 	= await this.makeProjectProps(solution.globals());
				await evaluatePropsAndImports(this.root!.allElements(), props, this.imports);
				await this.import(`${solution.installDir}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
				await super.postload(props);
			}
		}
	};
}

function CPSProjectMaker(language: string, ext: string) {
	return class P extends MsBuildBase {
		async getSdk() {
			return await Locations.getSdkPath(this.root!.attributes.Sdk ?? 'Microsoft.NET.Sdk', path.join(this.container.installDir, 'MSBuild', 'Sdks')) ?? '';
		}
		async load() {
			await this.rawLoad(this.fullpath);

			const root 	= this.root;
			if (root?.name == 'Project') {
				const solution	= this.container as Solution;
				const props		= await this.makeProjectProps({...solution.globals(), language});
				const sdkPath	= await this.getSdk();
				await this.import(path.join(sdkPath, 'Sdk', 'Sdk.props'), props);

				await this.addItem('Compile').includeFiles(this.fullpath, `**\\*.${ext}`, undefined, root);
				await this.addItem('EmbeddedResource').includeFiles(this.fullpath, '**\\*.resx', undefined, root);
				const None = this.addItem('None');
				await None.includeFiles(this.fullpath, `**\\*`, '**\\*.user;**\\*.*proj;**\\*.sln;**\\*.vssscc', root);
				None.removeFiles(this.fullpath,  `**\\*.${ext};**/*.resx`);

				await evaluatePropsAndImports(this.root!.allElements(), props, this.imports);
				await this.import(path.join(sdkPath, 'Sdk', 'Sdk.targets'), props);
				//await this.import(`${solution.vs?.Path}\\MSBuild\\Microsoft\\VisualStudio\\Managed\\Microsoft.${language}.DesignTime.targets`, props);
				super.postload(props);
			}
		}

		async evaluateProps(globals: Properties) : Promise<PropertiesWithOrigins> {
			const props 	= await this.makeProjectProps({...globals, language});
			const sdkPath	= await this.getSdk();
			const origins: Origins	= {};

			await evaluateImport(path.join(sdkPath, 'Sdk', 'Sdk.props'), props);
			await evaluatePropsAndImports(
				this.root?.allElements()??[],
				props,
				undefined,
				origins
			);
			await evaluateImport(path.join(sdkPath, 'Sdk', 'Sdk.targets'), props);
			return Object.assign(props, { origins });
		}
	};
}

export class AndroidProject extends MsBuildBase {
	projectDir = '';

	async postload(props: PropertyContext) {
		await super.postload(props);
		const gradle 	= this.items.GradlePackage;//.getDefinition('ProjectDirectory');
		const result 	= await gradle.evaluate(new PropertyContext);
		this.projectDir = path.join(path.dirname(this.fullpath), (await result.metadata.ProjectDirectory) as string);
	}
}

async function readDirectory(dirname: string): Promise<Folder> {
	return fs.promises.readdir(dirname, { withFileTypes: true }).catch(() => [] as fs.Dirent[]).then(async files => {
		const folder = new Folder(path.basename(dirname));
		folder.folders = await Promise.all(files.filter(i => i.isDirectory()).map(async i => readDirectory(path.join(dirname, i.name))));
		folder.entries = files.filter(i => i.isFile()).map(i => FileEntry(path.join(dirname, i.name)));
		return folder;
	});
}

export class ESProject extends MsBuildBase {
	folders: Promise<FolderTree>;

	constructor(container: ProjectContainer, type:string, name:string, fullpath: string, guid: string) {
		super(container, type, name, fullpath, guid);
		this.folders = readDirectory(path.dirname(this.fullpath)).then(f => new FolderTree(f));
	}
}

//-----------------------------------------------------------------------------
//	Filters
//-----------------------------------------------------------------------------

class FilterTree extends FolderTree {
	dirty = false;
}

async function loadFilterTree(fullPath : string, allfiles: Record<string, ProjectItemEntry>, removeEntry: (entry: ProjectItemEntry) => boolean): Promise<FilterTree> {
	class Filter extends Folder {
		get name() { return this._name; }
		set name(name : string) {
			filtertree.dirty = true;
			super._name = name;
		}
		add(item : ProjectItemEntry) {
			filtertree.dirty = true;
			super.add(item);
		}
		addFolder(name : string) {
			filtertree.dirty = true;
			const folder = new Filter(name);
			this.folders.push(folder);
			return folder;
		}
		remove(item : ProjectItemEntry) {
			filtertree.dirty = true;
			removeEntry(item);
			super.remove(item);
		}
		removeFolder(item : Folder) {
			filtertree.dirty = true;
			for (const entry of item.entries)
				removeEntry(entry);
			super.removeFolder(item);
		}
	}

	const basePath		= path.dirname(fullPath);
	const content		= await fs.promises.readFile(fullPath, "utf-8").catch(() => '');
	const document		= xml.parse(content);
	const filtertree	= new FilterTree(new Filter(''));
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

	filtertree.dirty = false;
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
	private filtertree: Promise<FilterTree>;

	constructor(container: ProjectContainer, type:string, name:string, fullpath: string, guid: string) {
		super(container, type, name, fullpath, guid);
		this.filtertree		= this.loadFilters(this.fullpath + ".filters");
		container.watch(this.fullpath + ".filters", () => {
			this.filtertree = this.loadFilters(this.fullpath + ".filters");
		});
	}

	private async loadFilters(fullPath : string): Promise<FilterTree> {
		return this.ready.then(() => {
			const allfiles : Record<string, ProjectItemEntry> = {};
			for (const i of Object.values(this.items)) {
				if (i.mode === ItemMode.File) {
					//if (i.definitions.length)
						for (const entry of i.entries) {
							if (entry.source && this.isLocal(entry.source))
								allfiles[entry.data.fullPath] = entry;
						}
				}
			}
			return loadFilterTree(fullPath, allfiles, this.removeEntry.bind(this));
		});
	}

	async addFile(name: string, filepath: string) {
		const ext_assoc		= await this.ext_assoc.value;
		const ext			= path.extname(name);
		const ContentType	= ext_assoc[ext];
		if (ContentType) {
			const group = getItemGroup(this.root!);
			if (group) {
				++this.project_dirty;
				const item	= this.items[ContentType];
				const x		= new xml.Element(ContentType, {Include: name});
				group.add(x);
				return item.includeFile(this.fullpath, filepath, x);
			}
		}
	}

	async save() {
		const tree = await this.filtertree;
		await Promise.all([
			super.save(),
			tree.dirty && ((tree.dirty = false), saveFilterTree(tree, this.fullpath + ".filters"))
		]);
	}

	async getFolders(view:string) : Promise<FolderTree> {
		return (view === 'filter' && await this.filtertree) || super.getFolders(view);
	}
}

//-----------------------------------------------------------------------------
//	register known guids
//-----------------------------------------------------------------------------

Project.addKnown({
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
/*C#*/											 	"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}": {make: CPSProjectMaker('CSharp', 'cs'),	type:"CS", ext:"csproj"},
/*C# (.Net Core)*/								 	"{9A19103F-16F7-4668-BE54-9A1E7A4F7556}": {make: CPSProjectMaker('CSharp', 'cs'), 	type:"CS"},
/*C++*/												"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}": {make: VCProject, 						type:"CPP", ext:"vcxproj"},
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
/*F#*/											 	"{F2A71F9B-5D33-465A-A702-920D77279786}": {make: ManagedProjectMaker('FSharp'), 	type:"FS", ext:"fsproj"},
/*F# (CPS)*/ 										"{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}": {make: CPSProjectMaker('FSharp', 'fs'),	type:"FS"},
/*J#*/											 	"{E6FDF86B-F3D1-11D4-8576-0002A516ECE8}": {make: MsBuildProject, 					type:"JS"},
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
/*VB.NET*/										 	"{F184B08F-C81C-45F6-A57F-5ABD9991F28F}": {make: ManagedProjectMaker('VisualBasic'),	type:"VB", ext:"vbproj"},
/*VB.NET (CPS)*/								 	"{778DAE3C-4631-46EA-AA77-85C1314464D9}": {make: CPSProjectMaker('VisualBasic', 'vb'),	type:"VB"},
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


/*'Javascript Application Project Files'*/			"{54A90642-561A-4BB1-A94E-469ADEE60C69}": {make: ESProject,		type:"TS", ext:"esproj"},
/*Android Packaging Projects'*/						"{39E2626F-3545-4960-A6E8-258AD8476CE5}": {make: AndroidProject, ext:"androidproj"},
});
