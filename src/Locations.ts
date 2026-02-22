import * as path from 'path';
import * as utils from '@isopodlabs/utilities';
import * as insensitive from '@isopodlabs/utilities/insensitive';
import * as xml from '@isopodlabs/xml';
import * as registry from '@isopodlabs/registry';
import { Version } from './Version';
import { XMLCache, readDirectory, directories, exists, exec } from './index';


/*
export function files(entries:  fs.Dirent[], glob?: string|Glob) {
	if (glob) {
		const include = typeof glob === 'string' ? new Glob(glob) : glob;
		return entries.filter(e => e.isFile() && include.test(e.name)).map(e => e.name);
	} else {
		return entries.filter(e => e.isFile()).map(e => e.name);
	}
}
*/
export function MakeSDKKey(identifier:string, version:string) {
	return `${identifier}, Version=${version}`;
}

export function ParseSDKKey(key: string) {
	const parts		= key.split(',');
	const version	= parts.find(p => p.trim().startsWith('Version='));
	return {
		identifier: parts[0].trim(),
		version: version ? version.split('=')[1] : undefined
	};
}

export const langID	 = registry.HKCU.subkey('Control Panel\\International').then(i => parseInt(i.values['Locale'] ?? '0409', 16));

export async function dotnet(args: string[]) {
	return exec('dotnet', args);
}

export async function getDotNet(): Promise<string> {
	const roots = [process.env.DOTNET_ROOT];
	switch (process.platform) {
		case 'win32':
			roots.push(
				path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet'),
				path.join(process.env['ProgramFiles(86)'] || 'C:\\Program Files (x86)', 'dotnet')
			);
			break;
		default:
			roots.push('/usr/share/dotnet', '/usr/local/share/dotnet');
			break;
	}
	for (const root of roots) {
		if (root && await exists(root))
			return root;
	}
	return '';
}

/**
 * Returns the path to a specific named SDK (e.g., "Microsoft.NET.Sdk").
 * Uses dotnet --list-sdks to discover SDK versions and their base paths.
 * Searches {basePath}/{version}/Sdks/{sdkName} for the named SDK.
 */
export async function getSdkPath(sdkName: string, sdks?: string, targetVersion?: Version): Promise<string|undefined> {
	if (sdks) {
		const sdkDir = path.join(sdks, sdkName);
		if (await exists(sdkDir))
			return sdkDir;
	}

	let candidates;
	try {
		const output = await dotnet(['--list-sdks']);
		candidates = output.split('\n').map(line => {
			const match = /^(.+?) \[(.+)\]/.exec(line);
			if (match) {
				const version = Version.parse(match[1]);
				if (version)
					return {version, base: path.join(match[2], match[1])};
			}
		}).filter((e): e is {version: Version, base: string} => e !== null);

	} catch (_e) {
		const root = await getDotNet();
		candidates = directories(await readDirectory(path.join(root, 'sdk'))).map(dir => {
			const version = Version.parse(dir);
			if (version)
				return {base: path.join(root, 'sdk', dir), version};
		});
	}

	for (const candidate of candidates) {
		if (!candidate || (targetVersion && candidate.version.compare(targetVersion) < 0))
			continue;
		const sdkDir = path.join(candidate.base, 'Sdks', sdkName);
		if (await exists(sdkDir))
			return sdkDir;
	}
}

export async function getMSBuildRuntimeVersion(): Promise<string> {
	// Try dotnet CLI first (cross-platform)
	try {
		const version = (await dotnet(['--version'])).trim();
		if (version)
			return version;
	} catch (_e) {
		// Fallback for legacy .NET Framework (Windows-only)
		if (process.platform === 'win32') {
			const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework');
			if (await exists(framework)) {
				const versions = directories(await readDirectory(framework)).filter(dir => dir[0] === 'v').map(dir => Version.parse(dir.substring(1))!);
				if (versions.length)
					return utils.max(versions).toString();
			}
			return '4.0.30319'; // Default legacy fallback
		}
	}
	// If all else fails, return a generic fallback
	return '6.0.0';
}

class Manifest {
	public readonly attributes: Record<string, string>;
	public ApiContracts: Record<string, string> = {};// name -> version
	
	constructor(x: xml.Element) {
		this.attributes		= x.attributes;
		this.ApiContracts	= Object.fromEntries(utils.map(x.elements.ContainedApiContracts?.elements.ApiContract,
			e => [e.attributes.name, e.attributes.version]
		));
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

	static async FromDirectory(root: string, manifest: string) {
		const me = new SDKDirectories;
		await utils.async.map(directories(await readDirectory(root)), async i =>
			utils.async.map(directories(await readDirectory(path.join(root, i))), async j =>
				Version.parse(j) && me.Add(path.join(root, i, j), i, j, manifest)
			)
		);
		return me;
	}

	static async FromRegistry(reg: registry.Key, manifest: string) {
		const me = new SDKDirectories;
		await utils.async.map(reg, async (sdk: registry.KeyPromise) =>
			utils.async.map(await sdk, async sdkVersion => {
				if (Version.parse(sdkVersion.name)) {
					const directoryName = (await sdkVersion).values[''];
					if (directoryName)
						await me.Add(directoryName, sdk.name, sdkVersion.name, manifest);
				}
			})
		);
		return me;
	}
}

class TargetPlatformSDK {
	public	ExtensionSDKs?:	SDKDirectories;
	public	Platforms?: 	SDKDirectories;
	public	manifest = new utils.Lazy(async () => 
		this._path ? await Manifest.load(path.join(this._path, 'SDKManifest.xml')) : undefined
	);

	constructor(public platform: string, public version: Version, public _path?: string) {}
}

function GatherVersionStrings(targetVersion: Version|undefined, versions: string[]): Record<string, string[]> {
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

function sortByVersion<T>(map: Record<string, T>) : [Version, T][] {
	const sorted = [...Object.entries(map)].sort((a, b) => Version.parse2(b[0]).compare(Version.parse2(a[0])));
	return sorted.map(i => [Version.parse(i[0])!, i[1]]);
}

function SortVersionStrings(targetVersion: Version|undefined, versions: string[]) {
	return sortByVersion(GatherVersionStrings(targetVersion, versions));
}

async function GatherSDKListFromDirectory(platform: string, fullpath: string, platformSDKs: Record<string, TargetPlatformSDK>) {
	const sortedVersions = SortVersionStrings(undefined, directories(await readDirectory(fullpath)));

	return utils.async.map(sortedVersions, async i => {
		if (!i[0])
			return;

		const	SDKplatform	= insensitive.compare(platform, 'Windows Kits') == 0 && i[0].major == 10 ? 'Windows' : platform;
		const	key	= MakeSDKKey(SDKplatform, i[0].toString());
		const	SDK	= platformSDKs[key] ??= new TargetPlatformSDK(SDKplatform, i[0]);

		for (const version of i[1]) {
			const Path 			= path.join(fullpath, version);
			const has_manifest	= await exists(path.join(Path, "SDKManifest.xml"));

			SDK._path ??= Path;

			if (has_manifest && !SDK.ExtensionSDKs) {
				SDK.Platforms		= await SDKDirectories.FromDirectory(path.join(Path, "Platforms"), "Platform.xml");
				SDK.ExtensionSDKs	= await SDKDirectories.FromDirectory(path.join(Path, "Extension SDKs"), "ExtensionSDK.xml");
			}
		}
	});
}

async function GatherSDKListFromRegistry(platform: string, baseKey: registry.Key, platformSDKs: Record<string, TargetPlatformSDK>) {
	const sortedVersions = SortVersionStrings(undefined, utils.map(baseKey, i => i.name));

	return utils.async.map(sortedVersions, async i => {
		const	key	= MakeSDKKey(platform, i[0].toString());
		const	SDK	= platformSDKs[key] ??= new TargetPlatformSDK(platform, i[0]);

		for (const version of i[1]) {
			const reg			= await baseKey[version];
			const Path			= (reg.values[''] ?? reg.values["InstallationFolder"])?.toString() ?? '';
			const has_manifest	= Path && (await exists(path.join(Path, "SDKManifest.xml")) || insensitive.String(Path).indexOf("Windows Kits") >= 0);

			SDK._path ??= Path;

			if (has_manifest && !SDK.ExtensionSDKs) {
				SDK.Platforms		= await SDKDirectories.FromDirectory(path.join(Path, "Platforms"), "Platform.xml");
				SDK.ExtensionSDKs	= await SDKDirectories.FromRegistry(await reg.ExtensionSDKs, "ExtensionSDK.xml");
			}
		}
	});
}

export const sdkRoots = new utils.Lazy(async () => {
	const envRoots = process.env.MSBUILDSDKREFERENCEDIRECTORY;
	if (envRoots) {
		const roots = await utils.async.filter(envRoots.split(';').map(i => i.trim()), async i => await exists(i));
		if (roots.length)
			return roots;
	}
	const defaultRoots = [
		process.env.LOCALAPPDATA,
		process.env['ProgramFiles(x86)'],
		process.env.ProgramFiles,
	];
	const folders = [
		"Microsoft SDKs",
		"Windows Kits",
		"dotnet/sdk",
	];

	return utils.async.filter(
		defaultRoots.filter(Boolean).map(i => folders.map(j => path.join(i!, j))).flat(),
		async i => await exists(i)
	);
});

const registryRoots = [
	registry.HKCU,
	...(process.arch === 'x64' ? [registry.view32.HKLM, registry.view64.HKLM] : [registry.HKLM]),
];

const cachedTargetPlatforms: 	Record<string, Promise<TargetPlatformSDK[]>> = {};

export function RetrieveTargetPlatformList(diskRoots: string[], registryRoot: string): Promise<TargetPlatformSDK[]> {
	const 	key			= [diskRoots.join(';'), registryRoot].join('|');
	let		collection	= cachedTargetPlatforms[key];

	if (!collection) {
		cachedTargetPlatforms[key] = collection  = (async () => {
			const sdks: Record<string, TargetPlatformSDK> = {};

			await utils.async.map(diskRoots, async i => 
				utils.async.map(directories(await readDirectory(i)), async platform =>
					GatherSDKListFromDirectory(platform, path.join(i, platform), sdks)
				)
			);

			await utils.async.map(registryRoots, async i => 
				utils.async.map(await i.subkey(registryRoot), async platform =>
					GatherSDKListFromRegistry(platform.name, await platform, sdks)
				)
			);
			return Object.values(sdks);
		})();
	}

	return collection;
}

// used by templates
export const WindowsKits = new utils.Lazy(async () => {
	const WindowsKitsRoots = await registry.HKLM.subkey("SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots");

	const roots: TargetPlatformSDK[] = [];
	for (const key in WindowsKitsRoots.values) {
		if (key.startsWith('KitsRoot')) {
			const root = WindowsKitsRoots.values[key].toString();
			if (await exists(root)) {
				let platform	= 'Windows';
				let version		= new Version(10, 0);
				const manifest	= await Manifest.load(path.join(root, 'SDKManifest.xml'));
				if (manifest) {
					const parts = ParseSDKKey(manifest.attributes.PlatformIdentity);
					platform = parts.identifier;
					if (parts.version)
						version = Version.parse2(parts.version) ?? version;
				}

				const sdk = new TargetPlatformSDK(platform, version, root);

				await utils.parallel(
					async () => sdk.ExtensionSDKs	= await SDKDirectories.FromDirectory(path.join(root, "Extension SDKs"), "SDKManifest.xml"),
					async () => sdk.Platforms 		= await SDKDirectories.FromDirectory(path.join(root, "Platforms"), "Platform.xml")
				);
				roots.push(sdk);
			}
		}
	}
	return roots;
	//const WindowsKitsRoot = WindowsKitsRoots.values['KitsRoot10'].toString();
	//const SDK	= new TargetPlatformSDK('Windows', new Version(10, 0));
	//SDK._path	= WindowsKitsRoot;
	//await utils.parallel(
	//	async () => SDK.ExtensionSDKs.Gather(path.join(WindowsKitsRoot, "Extension SDKs"), "SDKManifest.xml"),
	//	async () => SDK.Platforms.Gather(path.join(WindowsKitsRoot, "Platforms"), "Platform.xml")
	//);
	//return SDK;
});


export interface VisualStudioInstance {
	Name: 		string;
	Path: 		string;
	Version:	Version;
	Instance:	string;
	VCTargetsPath:	string;
}

async function Latest(folder: string) {
	const versions = SortVersionStrings(undefined, directories(await readDirectory(folder)));
	return versions.length > 0 ? path.join(folder, versions[0][1][0]) : '';
}
export const vsInstances = new utils.Lazy(() => exec('C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe', ['-format', 'json']).then(async stdout => {
	const array= JSON.parse(stdout) as any[];
	const all = await utils.async.map(array, async i => {
		const v		= Version.parse(i.installationVersion) ?? new Version(0);
		const vc	= (v && v.major >= 17) ? await Latest(path.join(i.resolvedInstallationPath, "Msbuild", "Microsoft", "VC")) : '';

		return {
			Name:		i.displayName,
			Path:		i.resolvedInstallationPath,
			Version:	v,
			Instance:	i.instanceId,
			VCTargetsPath:	vc,
		} as VisualStudioInstance;
	});
	all.sort((a, b) => b.Version.compare(a.Version));

	return {
		all,
		latest() 				{ return all[0]; },
		byVersion(ver: number) 	{ return all.find(i => i.Version.major == ver); },
		byPath(path: string)	{ return all.find(i => utils.insensitive.compare(i.Path, path) == 0); },
	};
}));