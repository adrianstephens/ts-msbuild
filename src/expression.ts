/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as registry from '@isopodlabs/registry';
import * as utils from '@isopodlabs/utilities';
import { Version } from './Version';
import * as Locations from './Locations';
import {search, exists } from './index';

//-----------------------------------------------------------------------------
//	StaticFunctions
//-----------------------------------------------------------------------------

type StringFunction = (...params: string[]) => any;

export class StaticFunctions {
	static classes : Record<string, Record<string, StringFunction>> = {};//Record<string, StringFunction>> = {};

	static register<T extends StaticFunctions>(name: string, obj: new (...args: any[]) => T) {

		const proto = obj.prototype as any;
		Object.getOwnPropertyNames(obj.prototype).forEach(k => {
			if (typeof proto[k] === 'function' && k !== 'constructor')
				proto[k.toUpperCase()] = proto[k];
		});

		const obj2 = obj as any;//unknown as StaticFunctions;
		Object.getOwnPropertyNames(obj).forEach(k => {
			if (typeof obj2[k] === 'function' && k !== 'prototype')
				obj2[k.toUpperCase()] = obj2[k].bind(obj);
		});
	
		StaticFunctions.classes[name.toUpperCase()] = obj2;
	}

	static run(name: string, func: string, ...params: string[]) {
		name = name.toUpperCase();
		if (name.startsWith('SYSTEM.'))
			name = name.slice(7);
		const c = this.classes[name];
		if (!c)
			throw new Error(`Class ${name} not found`);
		const f = c[func.toUpperCase()];
		if (!f)
			throw new Error(`Function ${func} not found in class ${name}`);
	
		return f(...params);
	}
}

export class ReExpand {
	constructor(public value: string) {}
}

//-----------------------------------------------------------------------------
//	Environment .NET class
//-----------------------------------------------------------------------------

class Environment extends StaticFunctions {
	static {
		StaticFunctions.register('Environment', this);
	}
//	public CommandLine(...params: string[])			{ return 'CommandLine'; }
	static ExpandEnvironmentVariables(s : string)	{ return utils.replace(s, /%(.*?)%/g, m => process.env[m[1]] || ''); }
	static GetEnvironmentVariable(s: string)			{ return process.env[s]; }
	static GetEnvironmentVariables()					{ return process.env; }
	static GetFolderPath(folder: string) {
		const env = process.env;
		switch (folder.split('.')[1]) {//SpecialFolder.xxx
			default:						return '??';
			case 'AdminTools':				return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Administrative Tools`;
			case 'ApplicationData':			return `${env.APPDATA}`;
			case 'CDBurning':				return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\Burn\\Burn`;
			case 'CommonAdminTools':		return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs\\Administrative Tools`;
			case 'CommonApplicationData':	return `${env.ALLUSERSPROFILE}`;
			case 'CommonDesktopDirectory': 	return `${env.PUBLIC}\\Desktop`;
			case 'CommonDocuments':			return `${env.PUBLIC}\\Documents`;
			case 'CommonMusic':				return `${env.PUBLIC}\\Music`;
			case 'CommonPictures':			return `${env.PUBLIC}\\Pictures`;
			case 'CommonProgramFiles':		return `${env.ProgramFiles}\\Common Files`;
			case 'CommonProgramFilesX86':	return `${env['ProgramFiles(x86)']}\\Common Files`;
			case 'CommonPrograms':			return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs`;
			case 'CommonStartMenu':			return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu`;
			case 'CommonStartup':			return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
			case 'CommonTemplates':			return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Templates`;
			case 'CommonVideos':			return `${env.PUBLIC}\\Videos`;
			case 'Cookies':					return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Cookies`;
			case 'Desktop':					return `${env.USERPROFILE}\\Desktop`;
			case 'Favorites':				return `${env.USERPROFILE}\\Favorites`;
			case 'Fonts':					return `${env.WINDIR}\\Fonts`;
			case 'History':					return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\History`;
			case 'InternetCache':			return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\INetCache`;
			case 'LocalApplicationData':	return `${env.LOCALAPPDATA}`;
			case 'MyDocuments':				return `${env.USERPROFILE}\\Documents`;
			case 'MyMusic':					return `${env.USERPROFILE}\\Music`;
			case 'MyPictures':				return `${env.USERPROFILE}\\Pictures`;
			case 'MyVideos':				return `${env.USERPROFILE}\\Videos`;
			case 'ProgramFiles':			return `${env.ProgramFiles}`;
			case 'ProgramFilesX86':			return `${env['ProgramFiles(x86)']}`;
			case 'Programs':				return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`;
			case 'Recent':					return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Recent`;
			case 'SendTo':					return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\SendTo`;
			case 'StartMenu':				return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu`;
			case 'Startup':					return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
			case 'System':					return `${env.WINDIR}\\System32`;
			case 'SystemX86':				return `${env.WINDIR}\\SysWOW64`;
			case 'Templates':				return `${env.APPDATA}\\Microsoft\\Windows\\Templates`;
			case 'UserProfile':				return `${env.USERPROFILE}`;
			case 'Windows':					return `${env.WINDIR}`;
		}
	}
//	public Is64BitOperatingSystem(...params: string[])		{ return 'Is64BitOperatingSystem'; }
	Is64BitProcess(...params: string[])						{ return true; }
//	public NewLine(...params: string[])						{ return 'NewLine'; }
//	public StackTrace(...params: string[])					{ return 'StackTrace'; }
//	public SystemDirectory(...params: string[])				{ return 'SystemDirectory'; }
//	public SystemPageSize(...params: string[])				{ return 'SystemPageSize'; }
//	public TickCount(...params: string[])					{ return 'TickCount'; }
//	public UserDomainName(...params: string[])				{ return 'UserDomainName'; }
//	public UserInteractive(...params: string[])				{ return 'UserInteractive'; }
//	public Version(...params: string[])						{ return 'Version'; }
//	public WorkingSet(...params: string[])					{ return 'WorkingSet'; }
	static GetLogicalDrives()						{ return []; }
	static MachineName()							{ return process.env.COMPUTERNAME || 'Unknown'; }
	static OSVersion()								{ return process.platform + ' ' + process.version; }
	static ProcessorCount() 						{ return os.cpus().length; }
	static UserName()								{ return process.env.USERNAME || process.env.USER || 'Unknown'; }
}

//-----------------------------------------------------------------------------
//	String .NET class
//-----------------------------------------------------------------------------

function IsNullOrWhiteSpace(value?: string) 	{ return !value || value.trim().length === 0 || value.replace(/\s/g, "").length === 0; }

export class NETString extends StaticFunctions {
	[key: string]: any;
	static {StaticFunctions.register('String', this); }
	static Concat(param0: string, param1: string) 	{ return param0 + param1; }
	static Copy(param: string) 						{ return param; }
	static IsNullOrEmpty(param: string) 			{ return param.length === 0; }
	static IsNullOrWhiteSpace(param: string) 		{ return IsNullOrWhiteSpace(param); }
	static new(param: string) 						{ return param; }
	static Format(format: string, ...params: string[]) {
		//{index[,alignment][:formatString]}
		const re = /{(\d+)(,[+-]?\d+)?(:\w+)}/g;
		let m: RegExpExecArray | null;
		let result = '';
		let i = 0;
		while ((m = re.exec(format))) {
			let param		= params[parseInt(m[1], 10)];
			if (m[3]) {
				//const format 	= m[3].substring(1);
			}
			if (m[2]) {
				const alignment = parseInt(m[2].substring(2), 10);
				param = alignment < 0 ? param.padEnd(-alignment, ' ') : param.padStart(alignment, ' ');
			}
			result += params[0].substring(i, re.lastIndex) + param;
			i = re.lastIndex;
		}
		return result + params[0].substring(i);
	}
	static Compare(a: string, b: string) { return a.localeCompare(b); }
	static CompareOrdinal(a: string, b: string) { return a.localeCompare(b); }
	static Join(sep: string, ...params: string[]) { return params.join(sep); }
	static Insert(str: string, idx: number, val: string) { return str.slice(0, idx) + val + str.slice(idx); }
	static Remove(str: string, start: number, count?: number) { return count ? str.slice(0, start) + str.slice(start + count) : str.slice(0, start); }
	static HasExtension(str: string) { return /\.[^./\\]+$/.test(str); }

	constructor(private value: string) { super();}

	Length() { return this.value.length; }
	IndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.indexOf(params[0]);
			case 2: return this.value.indexOf(params[0], +params[1]);
			case 3: return this.value.substring(0, +params[1] + +params[2]).indexOf(params[0], +params[1]);
		}
	}
	Substring(...params: string[]) 	{ return params.length == 1 ? this.value.substring(+params[0]) : this.value.substring(+params[0], +params[0] + +params[1]); }
	CompareTo(...params: string[]) 	{ return this.value < params[0] ? -1 : this.value > params[0] ? 1 : 0; }
	EndsWith(...params: string[]) 	{ return this.value.endsWith(params[0]); }
	IndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return utils.firstOf(this.value, params[0]);
			case 2: return utils.firstOf(this.value.substring(+params[1]), params[0]) + +params[1];
			case 3: return utils.firstOf(this.value.substring(+params[1], +params[1] + +params[2]), params[0]) + +params[1];
		}
	}
	IsNullOrEmpty() 		{ return !this.value; }
	IsNullOrWhiteSpace() 	{ return IsNullOrWhiteSpace(this.value); }
	LastIndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.lastIndexOf(params[0]);
			case 2: return this.value.lastIndexOf(params[0], +params[1]);
			case 3: return this.value.substring(+params[1] - +params[2]).lastIndexOf(params[0], +params[1]);
		}
	}
	LastIndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return utils.lastOf(this.value, params[0]);
			case 2: return utils.lastOf(this.value.substring(0, +params[1]), params[0]);
			case 3: {
				const start = Math.max(+params[1] - +params[2], 0);
				return utils.lastOf(this.value.substring(start, +params[1]), params[0]) + start;
			}
		}
	}
	PadLeft(len: number, char = ' ') 		{ return this.value.padStart(len, char); }
	PadRight(len: number, char = ' ')		{ return this.value.padEnd(len, char); }
	Remove(a: string, b?: string) 			{ return this.value.substring(0, +a) + (b ? this.value.substring(+a + +b) : ""); }
	Replace(from: string, to: string) 		{ return this.value.replace(from, to); }
	StartsWith(param: string)				{ return this.value.startsWith(param); }
	ToLower() 								{ return this.value.toLowerCase(); }
	ToLowerInvariant()						{ return this.value.toLowerCase(); }
	ToUpper() 								{ return this.value.toUpperCase(); }
	ToUpperInvariant()						{ return this.value.toUpperCase(); }
	Trim() 									{ return this.value.trim(); }
	TrimEnd() 								{ return this.value.trimEnd(); }
	TrimStart() 							{ return this.value.trimStart(); }
	Split(param: string) 					{ return this.value.split(param); }
	Contains(param: string) 				{ return this.value.includes(param); }
}

//-----------------------------------------------------------------------------
//	GUID, Boolean, Int32, Double, DateTime, DateTimeOffset, TimeSpan .NET classes
//-----------------------------------------------------------------------------

class Guid extends StaticFunctions {
	static {StaticFunctions.register('Guid', this); }
	constructor(private parts: number[]) { super();}

	static NewGuid(...params: string[])		{
		switch (params.length) {
			case 1: return this.Parse(params[0]);
			case 11: return new this([...params.map(p => parseInt(p, 16))]);
			default: return new this([0,0,0,0,0,0,0,0,0,0,0]);
		}
	}
	static Parse(param: string) 		{ 
		const m = /^\s*{?([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{2})([0-9a-fA-F]{2})-?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})}?/.exec(param);
		return m ? new this(m.slice(1).map(p => parseInt(p, 16))) : null;
	}
	static TryParse(param: string)		{ return this.Parse(param); }
	ToString()		{
		return `${this.parts[0].toString().padStart(8, '0')}-${this.parts[1].toString().padStart(4, '0')}-${this.parts[2].toString().padStart(4, '0')}-${this.parts.slice(3, 5).map(p => p.toString().padStart(2, '0')).join('')}-${this.parts.slice(5).map(p => p.toString().padStart(2, '0')).join('')}`;
	}
}

// System.Boolean
class NETBoolean extends StaticFunctions {
	static { StaticFunctions.register('Boolean', this); }
	constructor(private value: boolean) { super();}
	static Parse(param: string) 			{ return new this(param?.toLowerCase() === 'true'); }
	static TryParse(param: string)			{ return this.Parse(param); }
	ToString()								{ return this.value ? 'True' : 'False'; }
}

// System.Int32, System.Double, etc.
class NETInt32 extends StaticFunctions {
	static { StaticFunctions.register('Int32', this); }
	constructor(private value: number) { super();}
	static Parse(param: string)				{ return new this(parseInt(param, 10)); }
	static TryParse(param: string)			{ return !isNaN(parseInt(param, 10)); }
	ToString()								{ return this.value.toString(); }
}
class NETDouble extends StaticFunctions {
	static { StaticFunctions.register('Double', this); }
	constructor(private value: number) { super();}
	static Parse(param: string)				{ return new this(parseFloat(param)); }
	static TryParse(param: string)			{ return !isNaN(parseFloat(param)); }
	ToString()								{ return this.value.toString(); }
}

// System.DateTime
class NETDateTime extends StaticFunctions {
	static { StaticFunctions.register('DateTime', this); }
	constructor(private value: Date) 		{ super();}
	static Now()							{ return new this(new Date()); }
	static UtcNow()							{ return new this(new Date()); }
	static Today()							{ const d = new Date(); d.setHours(0,0,0,0); return new this(d); }
	static Parse(param: string)				{ return new this(new Date(param)); }
	static TryParse(param: string)			{ return !isNaN(Date.parse(param)); }
	ToString()								{ return this.value.toISOString(); }
}

// System.DateTimeOffset (stub)
class NETDateTimeOffset extends StaticFunctions {
	static { StaticFunctions.register('DateTimeOffset', this); }
	constructor(private value: Date) { super(); }
	static Now()							{ return new this(new Date()); }
	static UtcNow()							{ return new this(new Date()); }
	static Parse(param: string)				{ return new this(new Date(param)); }
	static TryParse(param: string)			{ return !isNaN(Date.parse(param)); }
	ToString()								{ return this.value.toISOString(); }
}

// System.TimeSpan (stub)
class NETTimeSpan extends StaticFunctions {
	static { StaticFunctions.register('TimeSpan', this); }
	constructor(private value: Number) 		{ super(); }
	static FromSeconds(s: string)			{ return new this(Number(s) * 1000); }
	static FromMinutes(m: string) 			{ return new this(Number(m) * 60000); }
	static FromHours(h: string)				{ return new this(Number(h) * 3600000); }
	ToString()								{ return this.value + 'ms'; }
}

//-----------------------------------------------------------------------------
//	.NET class
//-----------------------------------------------------------------------------

class NETVersion extends StaticFunctions {
	static {StaticFunctions.register('Version', this); }
	constructor(public inner?: Version) { super();}

	static New(param: string)			{ return new this(Version.parse(param)); }
	static Parse(param: string) 		{ return new this(Version.parse(param)); }

	ToString(x: number) { 
		return this.inner ? this.inner.parts.slice(x).join('.') : '';
	}
}

class NETConvert extends StaticFunctions {
	static {StaticFunctions.register('Convert', this); }
	static ToUInt32(...params: string[])	{ return 'ToUInt32'; }
}

class NETReflection_Assembly extends StaticFunctions {
	static {StaticFunctions.register('Reflection.Assembly', this); }
	static LoadFile(...params: string[]) {}
}

class NET_Text_RegularExpressions_Regex extends StaticFunctions {
	static { StaticFunctions.register('Text.RegularExpressions.Regex', this); }
	static Match(input: string, pattern: string, flags?: string)	{ return (new RegExp(pattern, flags || '')).exec(input); }
	static Matches(input: string, pattern: string, flags?: string)	{ return Array.from(input.matchAll(new RegExp(pattern, (flags || '') + 'g'))); }
	static Replace(input: string, pattern: string, replacement: string, flags?: string) { return input.replace(new RegExp(pattern, flags || ''), replacement); }
	static Split(input: string, pattern: string, flags?: string)	{ return input.split(new RegExp(pattern, flags || '')); }
	static IsMatch(input: string, pattern: string, flags?: string)	{ return (new RegExp(pattern, flags || '')).test(input); }
}

class NETGlobalization_CultureInfo extends StaticFunctions {
	static {StaticFunctions.register('Globalization.CultureInfo', this); }
	static CurrentUICulture(...params: string[]) { return 'CurrentUICulture'; }
}

class NETRuntime_InteropServices_RuntimeInformation extends StaticFunctions {
	static {StaticFunctions.register('Runtime.InteropServices.RuntimeInformation', this); }
	static ProcessArchitecture(...params: string[]) { return 'ProcessArchitecture'; }
}

//-----------------------------------------------------------------------------
//	IO .NET classes
//-----------------------------------------------------------------------------

class NET_IO_Directory extends StaticFunctions {
	static { StaticFunctions.register('IO.Directory', this); }
	static GetDirectories(dir: string, pattern: string)	{ return search(path.join(dir, pattern), undefined, false); }
	static GetFiles(dir: string, pattern: string)			{ return search(path.join(dir, pattern), undefined, true); }
//	static GetLastAccessTime(...params: string[])		{ return 'GetLastAccessTime'; }
	static GetLastWriteTime(a: string)					{ return fs.promises.stat(a).then(stat => stat?.mtime); }
	static GetParent(a: string)							{ return path.dirname(a); }
}
		
class NET_IO_File extends StaticFunctions {
	static { StaticFunctions.register('IO.File', this); }
	static Exists(a: string)							{ return exists(a); }
	static GetAttributes(a: string)						{ return fs.promises.stat(a); }
	static GetCreationTime(a: string)					{ return fs.promises.stat(a).then(stat => stat?.ctime); }
	static GetLastAccessTime(a: string)					{ return fs.promises.stat(a).then(stat => stat?.mtime); }
	static GetLastWriteTime(a: string)					{ return fs.promises.stat(a).then(stat => stat?.mtime); }
	static ReadAllText(a: string)						{ return fs.promises.readFile(a, 'utf8'); }
}

class NET_IO_Path extends StaticFunctions {
	static { StaticFunctions.register('IO.Path', this); }
	static ChangeExtension(a: string, b: string)		{ const parsed = path.parse(a); parsed.ext = b; return path.format(parsed); }
	static Combine(...params: string[])					{ return path.join(...params); }
	static GetDirectoryName(a: string)					{ return path.dirname(a); }
	static GetExtension(a: string)						{ return path.extname(a); }
	static GetFileName(a: string)						{ return path.basename(a); }
	static GetFileNameWithoutExtension(a: string)		{ return path.parse(a).name; }
	static GetFullPath(a: string, b?: string)			{ return path.resolve(b ? b : process.cwd(), a); }
	static GetPathRoot(a: string)						{ return path.parse(a).root; }
	static IsPathRooted(a: string)						{ return !!path.parse(a).root; }
	static HasExtension(a: string)						{ return /\.[^./\\]+$/.test(a); }
	static GetTempPath()								{ return process.env.TEMP || '/tmp'; }
	static DirectorySeparatorChar()						{ return path.sep; }
}

class NET_OperatingSystem extends StaticFunctions {
	static { StaticFunctions.register('OperatingSystem', this); }
	static IsOSPlatform(param: string) {
		param = param.toLowerCase();
		switch (param) {
			case 'windows': return process.platform === 'win32';
			case 'macos':	return process.platform === 'darwin';
			default:		return process.platform === param;
		}
	}
	static IsOSPlatformVersionAtLeast(platform: string, ...parts: number[])	{
		return this.IsOSPlatform(platform) && Version.parse2(process.version)!.compare(new Version(...parts)) >= 0;
	}
	static IsLinux()										{ return process.platform === 'linux'; }
	static IsFreeBSD()										{ return process.platform === 'freebsd'; }
	static IsFreeBSDVersionAtLeast(...parts: number[])		{ return this.IsOSPlatformVersionAtLeast('freebsd', ...parts); }
	static IsMacOS()										{ return process.platform === 'darwin'; }
	static IsMacOSVersionAtLeast(...parts: number[])		{ return this.IsOSPlatformVersionAtLeast('macos', ...parts); }
	static IsWindows()										{ return process.platform === 'win32'; }
	static IsWindowsVersionAtLeast(...parts: number[])		{ return this.IsOSPlatformVersionAtLeast('windows', ...parts); }
}

class NET_Microsoft_VisualStudio_Telemetry_TelemetryService extends StaticFunctions {
	static { StaticFunctions.register('Microsoft.VisualStudio.Telemetry.TelemetryService', this); }
	constructor(private params: string[]) { super(); }
	static DefaultSession(...params: string[])	{ return new this(['default', ...params]); }
}

class NET_Security_Principal_WindowsIdentity extends StaticFunctions {
	static { StaticFunctions.register('Security.Principal.WindowsIdentity', this); }
	constructor(private params: string[]) { super(); }
	static GetCurrent(...params: string[])	{ return new this(['current', ...params]); }
}

//-----------------------------------------------------------------------------
//	Microsoft.Build.Utilities.ToolLocationHelper
//-----------------------------------------------------------------------------

async function GetMatchingPlatformSDK(Identifier: string, VersionString: string, diskRoots: string[], registryRoot: string) {
	const version	= Version.parse(VersionString);
	const SDKs		= await Locations.RetrieveTargetPlatformList(diskRoots, registryRoot);
	return  SDKs.find(platform => utils.insensitive.compare(platform.platform, Identifier) == 0 && version && platform.version.compare(version) == 0)
		??	SDKs.find(platform => platform.Platforms && Locations.MakeSDKKey(Identifier, VersionString) in platform.Platforms);
}

class NET_Microsoft_Build_Utilities_ToolLocationHelper extends StaticFunctions {
	static { StaticFunctions.register('Microsoft.Build.Utilities.ToolLocationHelper', this); }
	static defaultRegistryRoot = "SOFTWARE\\MICROSOFT\\Microsoft SDKs";	

	static async FindRootFolderWhereAllFilesExist(possibleRoots: string, relativeFilePaths: string)	{
		if (possibleRoots) {
			const files = relativeFilePaths.split(';');
			for (const root of possibleRoots.split(';')) {
				if (await Promise.all(files.map(f => exists(path.join(root, f)))))
					return root;
			}
		}
	}
	
	static async GetPlatformSDKDisplayName(Identifier: string, Version: string, diskRoots?: string, registryRoot?: string) {
		const sdk = await GetMatchingPlatformSDK(Identifier, Version, diskRoots?.split(';') ?? await Locations.sdkRoots, registryRoot ?? this.defaultRegistryRoot);
		return (await sdk?.manifest)?.attributes.DisplayName ?? `${Identifier} ${Version}`;
	}

	static async GetPlatformSDKLocation(Identifier: string, Version: string, diskRoots?: string, registryRoot?: string) {
		const sdk = await GetMatchingPlatformSDK(Identifier, Version, diskRoots?.split(';') ?? await Locations.sdkRoots, registryRoot ?? this.defaultRegistryRoot);
		return sdk?._path ?? '';
	}
	
	static async GetLatestSDKTargetPlatformVersion(sdkIdentifier: string, sdkVersion: string, ...sdkRoots: string[]) : Promise<Version|undefined> {
		const version = Version.parse(sdkVersion);
		if (version) {
			if (sdkRoots.length == 0)
				sdkRoots = await Locations.sdkRoots;
			const SDKs	= await Locations.RetrieveTargetPlatformList(sdkRoots, this.defaultRegistryRoot);
			const platforms: string[] = [];
			for (const sdk of SDKs) {
		        if (utils.insensitive.compare(sdk.platform, sdkIdentifier) == 0 && sdk.version.compare(version) == 0 && sdk.Platforms) {
		            // Extract versions from nested structure: identifier -> versions -> SDKDirectory
		            for (const versionsRecord of Object.values(sdk.Platforms.entries))
		                platforms.push(...Object.keys(versionsRecord));
		        }
			}
			return platforms.map(i => Version.parse(i)).filter(i => !!i).reduce((acc, v) => v.compare(acc) > 0 ? v : acc, new Version);
		}
	}

	static async GetFoldersInVSInstallsAsString(minVersionString?: string, maxVersionString?: string, subFolder?: string) {
		const instances = await Locations.vsInstances;
		if (!instances)
			return '';
		
		const minVersion = Version.parse(minVersionString), maxVersion = Version.parse(maxVersionString);
		let folders = instances.all
			.filter(i => (!minVersion || i.Version.compare(minVersion) >= 0) && (!maxVersion || i.Version.compare(maxVersion) < 0))
			.sort((a, b) => a.Version.compare(b.Version))
			.map(i => i.Path);
		
		if (subFolder)
			folders = folders.map(i => path.join(i, subFolder));
		return folders.join(';');
	}

	//Returns the path to mscorlib and system.dll
	static GetPathToStandardLibraries(targetFrameworkIdentifier: string, targetFrameworkVersion: string, targetFrameworkProfile: string, platformTarget?: string, targetFrameworkRootPath?: string, targetFrameworkFallbackSearchPaths?: string) {
		return "path to mscorlib and system.dll";
	}
	
}

//-----------------------------------------------------------------------------
//	MSBuild .NET class
//-----------------------------------------------------------------------------

//eg. 'net5.0-windows7.0'
//eg. 'net5.0-windows'
//eg. 'net5.0'
function ParseTargetFramework(key: string) {
	const m		= /^\s*(\w+?)([\d.]+)(\s*-\s*(\w+?)([\d.]+)?)?/.exec(key);
	if (m)
		return {
			framework_id: m[1],
			framework_ver: m[2],
			platform_id: m[3],
			platform_ver: m[4],
		};
}

function extendVersion(v: string|undefined, wanted_parts: number) {
	if (v === undefined)
		v = '0';

	const parts = v.split('.');
	return parts.length < wanted_parts
		? v + '.0'.repeat(wanted_parts - parts.length)
		: parts.slice(0, wanted_parts).join('.');
}
function version_compare(a: string, b: string) {
	return Version.parse2(a).compare(Version.parse2(b));
}
function escape(unescapedString: string) { 
	return [...unescapedString].map(char => {
		const code = char.charCodeAt(0);
		return code >= 32 && code <= 126 ? char : `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
	}).join('');
}

function unescapeAll(escapedString: string, trim = false): string {
	if (trim)
		escapedString = escapedString.trim();
	return utils.replace(escapedString, /%([0-9A-Fa-f][0-9A-Fa-f])/g, m => String.fromCharCode(parseInt(m[1], 16)));
}

function getHashCode(s: string) {
	let hash1 = (5381 << 16) + 5381;
	let hash2 = hash1;

	const src = [...s].map(char => char.charCodeAt(0));
	for (let i = 0; i < src.length; i += 4) {
		hash1 = ((hash1 << 5) + hash1 + (hash1 >> 27)) ^ (src[i + 0] + (src[i + 1] << 16));
		if (i + 2 < src.length)
			hash2 = ((hash2 << 5) + hash2 + (hash2 >> 27)) ^ (src[i + 2] + (src[i + 3] << 16));
	}

	return hash1 + (hash2 * 1566083941);
}


class NET_MSBuild extends StaticFunctions {
	static { StaticFunctions.register('MSBuild', this); }
	static Add(a: string, b: string)						{ return +a + +b; }
	static Subtract(a: string, b: string)					{ return +a - +b; }
	static Multiply(a: string, b: string)					{ return +a * +b; }
	static Divide(a: string, b: string)					 	{ return +a / +b; }
	static Modulo(a: string, b: string)					 	{ return +a % +b; }
	static BitwiseOr(a: string, b: string)					{ return +a | +b; }
	static BitwiseAnd(a: string, b: string)				 	{ return +a & +b; }
	static BitwiseXor(a: string, b: string)				 	{ return +a ^ +b; }
	static BitwiseNot(a: string, b: string)				 	{ return ~+a; }
	static EnsureTrailingSlash(a: string)					{ return a && !a.endsWith(path.sep) ? a + path.sep : a; }
	static MakeRelative(a: string, b: string)				{ return path.relative(a, b); }
	static ValueOrDefault(a: string, b: string)			 	{ return a || b ; }

	static VersionEquals(a: string, b: string)				{ return version_compare(a, b) === 0; }
	static VersionGreaterThan(a: string, b: string)		 	{ return version_compare(a, b) > 0; }
	static VersionGreaterThanOrEquals(a: string, b: string) { return version_compare(a, b) >= 0; }
	static VersionLessThan(a: string, b: string)			{ return version_compare(a, b) < 0; }
	static VersionLessThanOrEquals(a: string, b: string)	{ return version_compare(a, b) <= 0; }
	static VersionNotEquals(a: string, b: string)			{ return version_compare(a, b) !== 0; }

	static async GetRegistryValue(key: string, value?: string)	{ return (await registry.getKey(key)).values[value??'']; }
	static async GetRegistryValueFromView(key: string, item: string, defaultValue: string, ...views: string[]) {
		if (views.length == 0)
			return (await registry.getKey(key)).values[item];
		for (const view of views) {
			const found = (await registry.getKey(key, view == 'RegistryView.Registry32' ? '32' : '64')).values[item];
			if (found)
				return found;
		}
	}
	static SubstringByAsciiChars(input: string, start: number, length: number) {
		return [...input].slice(start, start + length).join('');
	}
	static StableStringHash(a: string)						{ return getHashCode(a); }
	static async GetPathOfFileAbove(filename: string, startingDirectory: string) {
		const dir = await this.GetDirectoryNameOfFileAbove(startingDirectory, filename);
		return dir ? path.join(dir, filename) : '';
	}
	static async GetDirectoryNameOfFileAbove(startingDirectory: string, filename: string)	{
		while (!await exists(path.join(startingDirectory, filename))) {
			const parent = path.dirname(startingDirectory);
			if (parent === startingDirectory)
				return '';
			startingDirectory = parent;
		}
		return path.join(startingDirectory, filename);
	}
	static IsOSPlatform(param: string)						{ return NET_OperatingSystem.IsOSPlatform(param); }
	static IsOSUnixLike()									{ return process.platform != 'win32'; }
	static NormalizePath(...params: string[])				{ return path.resolve(...params); }
	static NormalizeDirectory(...params: string[])			{ return path.resolve(...params) + '\\'; }
	static Escape(unescapedString: string)					{ return escape(unescapedString); }
	static Unescape(escapedString: string)					{ return unescapeAll(escapedString); }

	static IsRunningFromVisualStudio()						{ return false; }
	static AreFeaturesEnabled(version: string)				{ return true; }
	static GetProgramFiles32()								{ return process.env["ProgramFiles(x86)"] ?? ''; }

	static GetTargetFrameworkIdentifier(targetFramework: string) 					{ return ParseTargetFramework(targetFramework)?.framework_id; }
	static GetTargetFrameworkVersion(targetFramework: string, versionPartCount = 2)	{ return extendVersion(ParseTargetFramework(targetFramework)?.framework_ver, versionPartCount); }
	static GetTargetPlatformIdentifier(targetFramework: string)						{ return ParseTargetFramework(targetFramework)?.platform_id; }
	static GetTargetPlatformVersion(targetFramework: string, versionPartCount = 2)	{ return extendVersion(ParseTargetFramework(targetFramework)?.platform_ver, versionPartCount); }

	static IsTargetFrameworkCompatible(targetFrameworkTarget: string, targetFrameworkCandidate: string)	{
		const target 	= ParseTargetFramework(targetFrameworkTarget);
		const candidate	= ParseTargetFramework(targetFrameworkCandidate);
		if (!target || !candidate)
			return false;
		if (target.framework_id !== candidate.framework_id
		||	(target.framework_ver && candidate.framework_ver && target.framework_ver!== candidate.framework_ver)
		)
			return false;
		if ((target.platform_id && candidate.platform_id && target.platform_id!== candidate.platform_id)
		||	(target.platform_ver && candidate.platform_ver && target.platform_ver!== candidate.platform_ver)
		)
			return false;
		return true;
	}
	static async GetLangId() { return parseInt(await this.GetRegistryValue("HKEY_CURRENT_USER\\Control Panel\\International", "Locale"), 16); }

	//static DoesTaskHostExist(...params: string[]);
	//static TargetFramework(...params: string[]);
	//static TargetPlatform(...params: string[]);
	//static ConvertToBase64(...params: string[]);
	//static ConvertFromBase64(...params: string[]);
	//static GetMSBuildSDKsPath()			{ return process.env.MSBuildSDKsPath ?? path.join(this.GetVsInstallRoot(), "MSBuild", "Sdks"); }
	//static GetVsInstallRoot();
	static GetMSBuildExtensionsPath()		{ return new ReExpand("$(VsInstallRoot)\\MSBuild"); }
	static GetToolsDirectory32()			{ return new ReExpand("$(VsInstallRoot)\\MSBuild\\Current\\Bin"); }
	static GetToolsDirectory64()			{ return new ReExpand("$(VsInstallRoot)\\MSBuild\\Current\\Bin\\amd64"); }
	static GetCurrentToolsDirectory()		{ return this.GetToolsDirectory64(); }
}

//-----------------------------------------------------------------------------
//	expression
//-----------------------------------------------------------------------------

function fix_quotes(value: string) {
	return value.replace(/^\s*'?|'?\s*$/g, '');
}

export function get_params(value: string, start = 0, depth = 1) : [number, string[]] {
	const params: string[] = [];
	let i = start;
	while (depth && i < value.length) {
		switch (value.charAt(i++)) {
			case '(':
				depth++;
				break;
			case ')':
				if (--depth == 0)
					params.push(fix_quotes(value.substring(start, i - 1)));
				break;
			case ',':
				if (depth == 1) {
					params.push(fix_quotes(value.substring(start, i - 1)));
					start = i;
				}
				break;
		}
	}
	return [i, params];
}

export async function EvaluateExpression(tokens: Iterable<string>, e: (op: string, a: any, b?: any) => Promise<any>) {
	const operands:		any[]		= [];
	const operators:	string[]	= [];

	const precedence: Record<string, number> = {
		'or':	1,
		'and':	2,
		'==':	3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
		'!':	4
	};

	const applyOperator = (op: string) => {
		const b = operands.pop();
		if (op === '!')
			return e(op, b);
		const a = operands.pop();
		return e(op, a, b);
	};

	let expectOperand = true;
	for (const token of tokens) {

		if (token.endsWith('(')) {
			if (!expectOperand)
				break;
			operators.push(token);
			expectOperand = true;

		} else if (token === ')') {
			if (expectOperand)
				operands.push('');

			let op;
			while ((op = operators.pop()) && !op.endsWith('('))
				operands.push(await applyOperator(op));

			if (!op)
				break;

			if (op.length > 1)
				operands.push(await e(op, operands.pop()));

			expectOperand = false;

		} else if (token === '!') {
			if (!expectOperand)
				break;
			operators.push(token);
			expectOperand = true;

		} else {
			const prec = precedence[token];
			if (prec) {
				if (expectOperand)
					operands.push('');

				let op;
				while ((op = operators.pop()) && precedence[op] !== undefined && precedence[op] >= prec)
					operands.push(await applyOperator(op));

				if (op)
					operators.push(op);

				operators.push(token);
				expectOperand = true;

			} else {
				if (!expectOperand)
					break;

				const fixed = fix_quotes(token);
				operands.push(fixed);
				expectOperand = false;
			}
		}
	}

	let op;
	while ((op = operators.pop())) {
		if (!op.endsWith('('))
			operands.push(await applyOperator(op));
	}

	return operands[0];
}


function get_boolean(value: any) : boolean {
	return value && (typeof(value) != 'string' || value.toLowerCase() !== 'false');
}

function has_trailing_slash(value: string) {
	const last = value.charAt(value.length - 1);
	return last == '/' || last == '\\';
}

async function evalNormal(op: string, a: any, b?: any) {
	switch (op) {
		case 'exists(': return await exists(a);
		case 'hastrailingslash(': return has_trailing_slash(a ?? '');
		case '!':	return !get_boolean(a);
		case 'or':	return get_boolean(a) || get_boolean(b);
		case 'and':	return get_boolean(a) && get_boolean(b);
		case '==':	return a === b;
		case '!=':	return a !== b;
		case '<':	return +a < +b;
		case '>':	return +a > +b;
		case '<=':	return +a <= +b;
		case '>=':	return +a >= +b;
		default:	return a;
	}
}

export async function EvaluateExpressionNormal(expression: string) {
	const re = /\s*('.*?'|==|!=|<=|>=|[<>!()]|And|Or|Exists\(|HasTrailingSlash\(|-?\d+(?:\.\d+)?|\w+)/giy;
	const it = {
		[Symbol.iterator]() { return this; },
		next: () => {
			const m = re.exec(expression);
			return m ? { 
				value: m[1][0] === "'" ? m[1] : m[1].toLowerCase(),
				done: false 
			} : { done: true, value: '' };
		}
	};

	const result = await EvaluateExpression(it, evalNormal);
	const end = re.lastIndex;
	return { result, end };
}

function isUnknown(val: any) {
	return typeof val === 'string' && /[$%@]\(/.test(val);
}

//Compares a string containing unknowns ($(), @(), %()) to a normal string, treating the unknowns as wildcards that can match any substring
//returns:
// 	true: the strings *might* match
// 	false: the string definitely don't match
function compareUnknown(a: string, b: string) {
	const re = /[$%@]\(.*?\)/g;
	let ai = 0, bi = 0;
	for (const match of b.matchAll(re)) {
		const skipped = match.index - bi;
		if (a.substring(ai, ai + skipped) !== b.substring(bi, bi + skipped))
			return false;

		bi = match.index + match[0].length;
		if (bi === b.length)
			break;

		const delimiter = b[bi];
		ai = a.indexOf(delimiter, ai);
		if (ai === -1)
			return false;
	}
	return true;
}

async function evalPartial(op: string, a: any, b?: any) {
	const unkA = isUnknown(a);
	const unkB = isUnknown(b);

	if (unkA || unkB) {
		switch (op) {
			case 'or':
				if (!unkA)
					return get_boolean(a) || b;
				if (!unkB)
					return get_boolean(b) || a;
				break
			case 'and':
				if (!unkA)
					return get_boolean(a) && b;
				if (!unkB)
					return get_boolean(b) && a;
				break;
			case '==':
				if (!unkA && compareUnknown(a, String(b)))
					return true;	// maybe ==
				if (!unkB && compareUnknown(b, String(a)))
					return true;	// maybe ==
				break;
			case '!=':
				if (!unkA && !compareUnknown(a, String(b)))
					return true;	// definitely !=
				if (!unkB && !compareUnknown(b, String(a)))
					return true;	// definitely !=
				break;
		}
		return b === undefined
			? `${op}${a}`
			: `${a} ${op} ${b}`;
	}
	return evalNormal(op, a, b);
}

export async function EvaluateExpressionPartial(expression: string) {
	const re = /\s*('.*?'|\$\(.*?\)|@\(.*?\)|%\(.*?\)|==|!=|<=|>=|[<>!()]|And|Or|Exists\(|HasTrailingSlash\(|-?\d+(?:\.\d+)?|\w+)/giy;
	const tokenizer = {
		[Symbol.iterator]() { return this; },
		next: () => {
			const m = re.exec(expression);
			return m ? {
				value: m[1][0] === "'" || m[1][0] === "$" || m[1][0] === "@" || m[1][0] === "%" ? m[1] : m[1].toLowerCase(),
				done: false
			} : { done: true, value: '' };
		}
	};
	return EvaluateExpression(tokenizer, evalPartial);
}

export async function Evaluate(result: any, right: string, start: number) {
	const re2 = /\.(\w+)|\[/y;
	re2.lastIndex = start;

	let m2: RegExpExecArray | null;
	while ((m2 = re2.exec(right))) {
		if (right[re2.lastIndex] == '(') {
			//function
			const func		= m2[1].toUpperCase();
			let [close, params] = get_params(right, re2.lastIndex + 1);
			result 			= await result[func](params);
			re2.lastIndex	= close;

		} else if (m2[1]) {
			//field
			result	= result[m2[1]];

		} else {
			//index
			const {result: index, end} = await EvaluateExpressionNormal(right.substring(re2.lastIndex));
			result		= result[index];

			let close = re2.lastIndex + end;
			if (right[close] === ']')
				++close;
			else
				throw new Error('Missing closing bracket');
			re2.lastIndex = close;
		}
		start = re2.lastIndex;
	}

	return {result, end: start};
}