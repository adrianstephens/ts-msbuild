import * as path from 'path';
import * as utils from '@isopodlabs/utilities';
import {insensitive} from '@isopodlabs/utilities';
import {Version, sortByVersion} from './Version';
import * as xml from '@isopodlabs/xml';
import * as registry from '@isopodlabs/registry';
import * as child_process from 'child_process';
import { XMLCache, exists, directories, readDirectory } from './index';


export let vsdir	 = process.env.vsdir ?? '';
if (!vsdir) GetFoldersInVSInstalls().then(vs => {
	if (vs.length)
		vsdir = vs.at(-1)!;
});

export function getSdkPath() {
	const version	= '8.0.302';
	return `${process.env.ProgramFiles}\\dotnet\\sdk\\${version}\\Sdks\\Microsoft.NET.Sdk\\Sdk`;
}


interface KeyVersion {
	key:		string;
	version:	Version;
}
interface RegKeyVersion {
	key:		registry.Key;
	version:	Version;
}

interface VisualStudioInstance {
	Name: 		string;
	Path: 		string;
	Version:	Version;
}

export function MakeSDKKey(identifier:string, version:string) {
	return `${identifier}, Version=${version}`;
}

async function PowerShell(command: string) {
	return new Promise<string>(
		resolve => child_process.execFile('powershell.exe', ['-Command', command], (_error, stdout) => resolve(stdout))
	);
}


export const assemblyFolders = new utils.Lazy(async ()=> {

	async function FoldersFromRegistryKey(baseKey: registry.Key) {
		return utils.asyncReduce(Object.values(baseKey), async (directories, product) => {
			const folder = (await product).values['']?.toString();
			if (folder && await exists(folder))
				directories[product.name] = folder;
			return directories;
		}, {} as Record<string, string>);
	}
	
	async function FoldersFromRegistryKey2(key: string) {
		return {
			hkcu: await FoldersFromRegistryKey(await registry.HKCU.subkey(key)),
			hklm: await FoldersFromRegistryKey(await registry.HKLM.subkey(key)),
		};
	}

	return utils.merge(
		await FoldersFromRegistryKey2("SOFTWARE\\Microsoft\\.NETFramework\\AssemblyFolders"),
		await FoldersFromRegistryKey2("SOFTWARE\\Microsoft\\VisualStudio\\8.0\\AssemblyFolders")
	);
});


function MatchingPlatformExists(platform: string, platformValue?: string) {
	if (platformValue) {
		for (const p of platformValue.split(';')) {
			if (utils.insensitive.compare(p, platform) == 0)
				return true;
		}
	}
	return false;
}

function IsVersionInsideRange(v: Version|undefined, keyPlatform: registry.Values) {
	if (v) {
		const minVersion = Version.parse2(keyPlatform.MinOSVersion);
		if (minVersion && v.compare(minVersion) < 0)
			return false;

		const maxVersion = Version.parse2(keyPlatform.MaxOSVersion);
		if (maxVersion && v.compare(maxVersion) > 0)
			return false;
	}
	return true;
}


export async function FindAssemblyEx(
	registryKeyRoot:		string,
	targetVersionString:	string,
	registryKeySuffix:		string,
	osVersion?:				Version,
	platform?:				string,
	targeting64bit			= true,
) {
	const targetVersion = Version.parse2(targetVersionString);

	async function FindDirectories(baseKey: registry.Key) {
		const additionalToleratedKeys: string[] = [];
	
		const map: Record<string, string[]> = {};
		for (const s of Object.keys(baseKey)) {
			if (s && (s[0] == 'v' || s[0] == 'V')) {
				let v = Version.parse2(s);
				if (!v) {
					if (insensitive.compare(s, targetVersionString) == 0)
						additionalToleratedKeys.push(s);
				} else {
					if (v.patch > 255)
						v = new Version(v.major, v.minor);
					if (v && (targetVersion ? v.compare(targetVersion) <= 0 : insensitive.compare(s, targetVersionString) == 0)) {
						const key = v.toString();
						if (key in map)
							map[key].push(s);
						else
							map[key] = [s];
					}
				}
			}
		}
	
		const versionStrings: KeyVersion[] = [];
		for (const [version, frameworkList] of sortByVersion(map))
			utils.arrayAppend(versionStrings, frameworkList.sort(utils.reverse_compare).map(s => ({key: s, version})));
		utils.arrayAppend(versionStrings, additionalToleratedKeys.map(k => ({key:k, version:targetVersion ?? new Version(0, 0)})));
	
		const componentKeys: RegKeyVersion[] = [];
		for (const versionString of versionStrings) {
			const fullVersionKey	= await baseKey[versionString.key][registryKeySuffix];
			utils.arrayAppend(componentKeys, Object.keys(fullVersionKey)
				.sort(utils.reverse_compare)
				.map(i => ({key: fullVersionKey[i], version: versionString.version}))
			);
		}
	
		const directoryKeys: RegKeyVersion[] = [];
		for (const componentKey of componentKeys) {
			utils.arrayAppend(directoryKeys, Object.keys(componentKey.key)
				.map(i => componentKey.key[i])
				.sort(utils.reverse_compare)
				.map(i => ({key: i, version: componentKey.version}))
			);
			directoryKeys.push(componentKey);
		}
	
		const directoryNames: Record<string, RegKeyVersion> = {};
		for (const directoryKey of directoryKeys) {
			if (platform || osVersion) {
				const keyPlatform = await directoryKey.key.values;
				if (Object.keys(keyPlatform).length) {
					if (platform && !MatchingPlatformExists(platform, keyPlatform.Platform))
						continue;
	
					if (osVersion && !IsVersionInsideRange(osVersion, keyPlatform))
						continue;
				}
			}
	
			const directoryName = await directoryKey.key.values[''];
			if (directoryName)
				directoryNames[directoryName] = directoryKey;
		}
	}
	

	const dirs		= FindDirectories(await registry.view_default.HKEY_CURRENT_USER.subkey(registryKeyRoot));
	const dirs64	= FindDirectories(await registry.view64.HKEY_LOCAL_MACHINE.subkey(registryKeyRoot));
	const dirs32	= FindDirectories(await registry.view32.HKEY_LOCAL_MACHINE.subkey(registryKeyRoot));

	return targeting64bit
		? {...dirs, ...dirs64, ...dirs32}
		: {...dirs, ...dirs32, ...dirs64};
}

class ApiContract {
	constructor(public Name: string, public Version: string) {}
}

class Manifest {
	public readonly attributes: Record<string, string>;
	public ApiContracts: ApiContract[] = [];
	
	constructor(x: xml.Element) {
		this.attributes = x.attributes;
//TargetPlatform  		="UAP"
//TargetPlatformMinVersion="10.0.16299.0"
//TargetPlatformVersion   ="10.0.16299.0"
//SDKType 				="Platform"
//DisplayName 			="Windows Desktop Extensions for the UWP"
//AppliesTo   			="WindowsAppContainer"
//MinVSVersion			="14.0"
//ProductFamilyName   	="Windows.Desktop"
//SupportsMultipleVersion ="Error"
//TargetFramework 		=".NETCore, version=v4.5.3;"
//SupportPrefer32Bit  	="True"
//MoreInfo				="http://go.microsoft.com/fwlink/?LinkId=517639">
		this.ApiContracts	= utils.mapIterable(x.elements.ContainedApiContracts?.elements.ApiContract,
			e => new ApiContract(e.attributes.name, e.attributes.version)
		);
	}
	static async load(Path: string) : Promise<Manifest|undefined> {
		const x		= await XMLCache.get(Path);
		const root	= x?.firstElement();
		if (root?.name == 'ApplicationPlatform' || root?.name == 'FileList')
			return new Manifest(root);
	}
}

class SDKDirectory {
	private _manifest?: 	Promise<Manifest|undefined>;
	get directory()	{ return path.dirname(this._path); }
	get manifest() 	{ return this._manifest ??= Manifest.load(this._path); }
	constructor(private _path: string) {}
}

class SDKDirectories {
	public entries	= insensitive.Record({} as Record<string, Record<string, SDKDirectory>>);

	async Add(directory: string, key: string, version: string, manifest: string) {
		if (!(key in this.entries))
			this.entries[key] = {};

		if (!(version in this.entries[key])) {
			const manifest_path = path.join(directory, manifest);
			if (await exists(manifest_path))
				this.entries[key][version] = new SDKDirectory(manifest_path);
		}
	}

	async Gather(root: string, manifest: string) {
		return utils.asyncMap(directories(await readDirectory(root)), async i =>
			utils.asyncMap(directories(await readDirectory(path.join(root, i))), async j =>
				Version.parse(j) && this.Add(path.join(root, i, j), i, j, manifest)
			)
		);
	}
}

class TargetPlatformSDK {
	public	_path?: 		string;
	private	_manifest?: 	Promise<Manifest|undefined>;
	public	ExtensionSDKs	= new SDKDirectories;
	public	Platforms 		= new SDKDirectories;

	constructor(public platform: string, public version: Version) {}
	public	get manifest() 		{ return this._manifest ??= this._path ? Manifest.load(path.join(this._path, 'SDKManifest.xml')) : undefined; }
}

const cachedTargetPlatforms: 	Record<string, Promise<TargetPlatformSDK[]>> = {};

export const vsInstances = new utils.Lazy<Promise<VisualStudioInstance[]>>(() => PowerShell("Get-CimInstance -Namespace root/cimv2/vs -ClassName MSFT_VSInstance").then(
	stdout => {
		const re = /^(\w+)\s*:\s*(.*)\r?/;
		const curr: [string, string][] = [];
		const all:	Record<string, string>[] = [];

		for (const line of stdout.split('\n')) {
			const m = re.exec(line);
			if (m) {
				curr.push([m[1], m[2]]);
			} else if (curr.length) {
				all.push(Object.fromEntries(curr));
				curr.length = 0;
			}
		}

		return all.map(i => ({
			Name: i.Caption,
			Path: i.InstallLocation,
			Version: Version.parse(i.Version)
		} as VisualStudioInstance));
	},
	_error => [] as VisualStudioInstance[]
));

function GatherVersionStrings(targetVersion: Version|undefined, versions: string[]) {
	const map: Record<string, string[]> = {};
	for (const i of versions) {
		const v = Version.parse2(i);
		if (v && (!targetVersion || v.compare(targetVersion) <= 0)) {
			const	key	= v.toString();
			const	list = map[key];
			if (list) {
				if (!list.includes(i))
					list.push(i);
			} else {
				map[key] = [i];
			}
		}
	}
	return map;
}

function SortVersionStrings(targetVersion: Version|undefined, versions: string[]) {
	return sortByVersion(GatherVersionStrings(targetVersion, versions));
}

async function GatherSDKListFromDirectory(platform: string, fullpath: string, platformSDKs: Record<string, TargetPlatformSDK>) {
	const sortedVersions = SortVersionStrings(undefined, directories(await readDirectory(fullpath)));

	return utils.asyncMap(sortedVersions, async i => {
		const	SDKplatform	= insensitive.compare(platform, 'Windows Kits') == 0 && i[0].major == 10 ? 'Windows' : platform;
		const	key		= MakeSDKKey(SDKplatform, i[0].toString());
		let		SDK:	TargetPlatformSDK | undefined;

		for (const version of i[1]) {
			const Path 			= path.join(fullpath, version);
			const has_manifest	= await exists(path.join(Path, "SDKManifest.xml"));

			if (!SDK && !(SDK = platformSDKs[key]))
				SDK = platformSDKs[key] = new TargetPlatformSDK(SDKplatform, i[0]);

			if (!SDK._path && has_manifest) {
				SDK._path = Path;
				await SDK.Platforms.Gather(Path, "Platform.xml");
				await SDK.ExtensionSDKs.Gather(path.join(Path, "Extension SDKs"), "ExtensionSDK.xml");
			}
		}
	});
}

async function GatherSDKListFromRegistry(platform: string, baseKey: registry.Key, platformSDKs: Record<string, TargetPlatformSDK>) {
	const sortedVersions = SortVersionStrings(undefined, utils.mapIterable(baseKey, i => i.name));

	return utils.asyncMap(sortedVersions, async i => {
		const	key	= MakeSDKKey(platform, i[0].toString());
		let		SDK: TargetPlatformSDK | undefined;

		for (const version of i[1]) {
			const reg			= await baseKey[version];
			const Path			= reg.values[''] ?? reg.values["InstallationFolder"];
			const has_manifest	= Path && (await exists(path.join(Path, "SDKManifest.xml")) || insensitive.String(Path).indexOf("Windows Kits") >= 0);

			if (!SDK && !(SDK = platformSDKs[key]))
				SDK = platformSDKs[key] = new TargetPlatformSDK(platform, i[0]);

			if (!SDK._path && has_manifest) {
				SDK._path = Path;
				await SDK.Platforms.Gather(Path, "Platform.xml");

				const ExtensionSDKs = SDK.ExtensionSDKs;
				await utils.asyncMap(await reg.ExtensionSDKs, async (sdk: registry.KeyPromise) => {
					utils.asyncMap(await sdk, async sdkVersion => {
						if (Version.parse(sdkVersion.name)) {
							const directoryName = (await sdkVersion).values[''];
							if (directoryName)
								await ExtensionSDKs.Add(directoryName, sdk.name, sdkVersion.name, "ExtensionSDK.xml");
						}
					});
				});
			}
		}
	});
}

export const sdkRoots = new utils.Lazy(async () => {
	const envRoots = process.env.MSBUILDSDKREFERENCEDIRECTORY;
	if (envRoots) {
		const roots = await utils.asyncFilter(envRoots.split(';').map(i => i.trim()), async i => await exists(i));
		if (roots.length)
			return roots;
	}
	const defaultRoots = [
		process.env.LOCALAPPDATA,
		process.env['ProgramFiles(x86)'] ?? process.env.ProgramFiles
	];
	return utils.asyncFilter(defaultRoots.map(i => i ? path.join(i, "Microsoft SDKs") : ''), async i => i ? await exists(i) : false);
});

export function RetrieveTargetPlatformList(diskRoots: string[], registryRoot: string) {
	const 	key			= [diskRoots.join(';'), registryRoot].join('|');
	let		collection	= cachedTargetPlatforms[key];

	if (!collection) {
		cachedTargetPlatforms[key] = collection  = (async () => {
			const sdks: Record<string, TargetPlatformSDK> = {};
			await utils.asyncMap(diskRoots, async i => 
				utils.asyncMap(directories(await readDirectory(i)), async platform =>
					GatherSDKListFromDirectory(platform, path.join(i, platform), sdks)
				)
			);

			const registryRoots = [
				registry.HKCU,
				...(process.arch === 'x64' ? [registry.view32.HKLM, registry.view64.HKLM] : [registry.HKLM]),
			];
			await utils.asyncMap(registryRoots, async i => 
				utils.asyncMap(await i.subkey(registryRoot), async platform =>
					GatherSDKListFromRegistry(platform.name, await platform, sdks)
				)
			);
			return Object.values(sdks);
		})();
	}

	return collection;
}

export async function GetMatchingPlatformSDK(Identifier: string, VersionString: string, diskRoots: string[], registryRoot: string) {
	const version	= Version.parse(VersionString);
	const SDKs		= await RetrieveTargetPlatformList(diskRoots, registryRoot);
	return  SDKs.find(platform => insensitive.compare(platform.platform, Identifier) == 0 && version && platform.version.compare(version) == 0)
		??	SDKs.find(platform => MakeSDKKey(Identifier, VersionString) in platform.Platforms);
}


export async function GetFoldersInVSInstalls(minVersion?: Version, maxVersion?: Version) { 
	const instances = await vsInstances.value;
	return instances
		.filter(i => (!minVersion || i.Version.compare(minVersion) >= 0) && (!maxVersion || i.Version.compare(maxVersion) < 0))
		.sort((a, b) => a.Version.compare(b.Version))
		.map(i => i.Path);
}

export const windowsKits = new utils.Lazy(async () => {
	const WindowsKitsRoot = (await registry.HKLM.subkey("SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots")).values['KitsRoot10'].toString();
	const SDK	= new TargetPlatformSDK('Windows', new Version(10, 0));
	SDK._path	= WindowsKitsRoot;
	await utils.parallel(
		async () => SDK.ExtensionSDKs.Gather(path.join(WindowsKitsRoot, "Extension SDKs"), "SDKManifest.xml"),
		async () => SDK.Platforms.Gather(path.join(WindowsKitsRoot, "Platforms"), "Platform.xml")
	);
	return SDK;
});

export async function GetWindowsKitVersions() {
	const registryRoots = [
		registry.HKCU,
		...(process.arch === 'x64' ? [registry.view32.HKLM, registry.view64.HKLM] : [registry.HKLM]),
	];
	const versions = await utils.asyncReduce(registryRoots,
		async (acc, i) => ({...acc, ...GatherVersionStrings(undefined, Object.keys(await i.subkey("SOFTWARE\\MICROSOFT\\Windows Kits\\Installed Roots")))}),
		{}
	);

	return sortByVersion(versions).map(i => i[0]);
}


