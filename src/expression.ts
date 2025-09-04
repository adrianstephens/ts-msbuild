
//import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as registry from @isopodlabs/registry';
import * as utils from '@isopodlabs/utilities';
import {Version, version_compare, extendVersion} from './Version';
import * as Locations from './Locations';
//import {Extension, log, loadTextFile} from '../extension';

type StringFunction = (...params: string[])=>any;

export class StaticFunctions {
	[key:string]: StringFunction;

	static classes : Record<string, Record<string, StringFunction>> = {};

	static register(name: string, obj: typeof StaticFunctions) {
		const proto = obj.prototype;
		Object.getOwnPropertyNames(obj.prototype).forEach(k => {
			if (typeof obj.prototype[k] === 'function' && k !== 'constructor')
				proto[k.toUpperCase()] = obj.prototype[k];
		});

		const obj2 = obj as unknown as StaticFunctions;
		Object.getOwnPropertyNames(obj).forEach(k => {
			if (typeof obj2[k] === 'function' && k !== 'prototype')
				proto[k.toUpperCase()] = obj2[k].bind(obj);
		});
	
		StaticFunctions.classes[name.toUpperCase()] = proto;
	}

	static run(name: string, func: string, ...params:string[]) {
		name = name.toUpperCase();
		if (name.startsWith('SYSTEM.'))
			name = name.slice(7);
		const c = this.classes[name];
		if (c) {
			func 	= func.toUpperCase();
			return c[func](...params);
		}
		throw new Error(`Class ${name} not found`);
	}
}

class Environment extends StaticFunctions {
	static {
		StaticFunctions.register('Environment', this);
	}
//	public CommandLine(...params: string[])			{ return 'CommandLine'; }
	public ExpandEnvironmentVariables(s : string)	{ return utils.replace(s, /%(.*?)%/g, m => process.env[m[1]] || ''); }
	public static GetEnvironmentVariable(s: string)	{ return process.env[s]; }
	public GetEnvironmentVariables()				{ return process.env; }
	public static GetFolderPath(folder: string) {
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
//	public GetLogicalDrives(...params: string[])			{ return 'GetLogicalDrives'; }
//	public Is64BitOperatingSystem(...params: string[])		{ return 'Is64BitOperatingSystem'; }
	public Is64BitProcess(...params: string[])				{ return true; }
//	public MachineName(...params: string[])					{ return 'MachineName'; }
//	public NewLine(...params: string[])						{ return 'NewLine'; }
//	public OSVersion(...params: string[])					{ return 'OSVersion'; }
//	public ProcessorCount(...params: string[])				{ return 'ProcessorCount'; }
//	public StackTrace(...params: string[])					{ return 'StackTrace'; }
//	public SystemDirectory(...params: string[])				{ return 'SystemDirectory'; }
//	public SystemPageSize(...params: string[])				{ return 'SystemPageSize'; }
//	public TickCount(...params: string[])					{ return 'TickCount'; }
//	public UserDomainName(...params: string[])				{ return 'UserDomainName'; }
//	public UserInteractive(...params: string[])				{ return 'UserInteractive'; }
//	public UserName(...params: string[])					{ return 'UserName'; }
//	public Version(...params: string[])						{ return 'Version'; }
//	public WorkingSet(...params: string[])					{ return 'WorkingSet'; }
}

function IsNullOrWhiteSpace(value?: string) 	{ return !value || value.trim().length === 0 || value.replace(/\s/g, "").length === 0; }
function fix_quotes(value: string)				{ return value.replace(/^\s*'?|'?\s*$/g, ''); }
function get_boolean(value: any) : boolean		{ return value && (typeof(value) != 'string' || value.toLowerCase() !== 'false'); }

function escape(unescapedString: string) { 
	[...unescapedString].map(char => {
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
		hash1 = ((hash1 << 5) + hash1 + (hash1 >> 27)) ^ (src[i + 0] + (src[1 + 1] << 16));
		if (i + 2 < src.length)
			hash2 = ((hash2 << 5) + hash2 + (hash2 >> 27)) ^ (src[i + 2] + (src[1 + 3] << 16));
	}

	return hash1 + (hash2 * 1566083941);
}

class StringFunctions {
	[key:string]: any;//StringFunction;
	constructor(private value: string) {}

	public IndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.indexOf(params[0]);
			case 2: return this.value.indexOf(params[0], +params[1]);
			case 3: return this.value.substring(0, +params[1] + +params[2]).indexOf(params[0], +params[1]);
		}
	}
	public Substring(...params: string[]) 	{ return params.length == 1 ? this.value.substring(+params[0]) : this.value.substring(+params[0], +params[0] + +params[1]); }
	public CompareTo(...params: string[]) 	{ return this.value < params[0] ? -1 : this.value > params[0] ? 1 : 0; }
	public EndsWith(...params: string[]) 	{ return this.value.endsWith(params[0]); }
	public IndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return utils.firstOf(this.value, params[0]);
			case 2: return utils.firstOf(this.value.substring(+params[1]), params[0]) + +params[1];
			case 3: return utils.firstOf(this.value.substring(+params[1], +params[1] + +params[2]), params[0]) + +params[1];
		}
	}
	public IsNullOrEmpty() 		{ return !this.value; }
	public IsNullOrWhiteSpace() { return IsNullOrWhiteSpace(this.value); }
	public LastIndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.lastIndexOf(params[0]);
			case 2: return this.value.lastIndexOf(params[0], +params[1]);
			case 3: return this.value.substring(+params[1] - +params[2]).lastIndexOf(params[0], +params[1]);
		}
	}
	public LastIndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return utils.lastOf(this.value, params[0]);
			case 2: return utils.lastOf(this.value.substring(0, +params[1]), params[0]);
			case 3: {
				const start = Math.max(+params[1] - +params[2], 0);
				return utils.lastOf(this.value.substring(start, +params[1]), params[0]) + start;
			}
		}
	}
	public PadLeft(len: number, char = ' ') 		{ return this.value.padStart(len, char); }
	public PadRight(len: number, char = ' ')		{ return this.value.padEnd(len, char); }
	public Remove(a:string, b?:string) 				{ return this.value.substring(0, +a) + (b ? this.value.substring(+a + +b) : ""); }
	public Replace(from:string, to:string) 			{ return this.value.replace(from, to); }
	public StartsWith(param: string)				{ return this.value.startsWith(param); }
	public ToLower() 								{ return this.value.toLowerCase(); }
	public ToLowerInvariant()						{ return this.value.toLowerCase(); }
	public ToUpper() 								{ return this.value.toUpperCase(); }
	public ToUpperInvariant()						{ return this.value.toUpperCase(); }
	public Trim() 									{ return this.value.trim(); }
	public TrimEnd() 								{ return this.value.trimEnd(); }
	public TrimStart() 								{ return this.value.trimStart(); }
	public Split(param: string) 					{ return this.value.split(param); }
	public Contains(param: string) 					{ return this.value.includes(param); }
}

class StringStatic extends StaticFunctions {
	static {StaticFunctions.register('String', this); }
	static Concat(param0: string, param1: string) 	{ return param0 + param1; }
	static Copy(param: string) 						{ return param; }
	static IsNullOrEmpty(param: string) 			{ return param.length === 0; }
	static IsNullOrWhiteSpace(param: string) 		{ return IsNullOrWhiteSpace(param); }
	static new(param: string) 						{ return param; }
	static Format(format:string, ...params: string[]) {
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
}

class Guid extends StaticFunctions {
	static {StaticFunctions.register('Guid', this); }
	static NewGuid(...params: string[]) 	{ return 'NewGuid'; }
}

class Convert extends StaticFunctions {
	static {StaticFunctions.register('Convert', this); }
	static ToUInt32(...params: string[])	{ return 'ToUInt32'; }
}
class VersionStatic extends StaticFunctions {
	static {StaticFunctions.register('Version', this); }
	static New(param: string)			{ return Version.parse(param); }
	static Parse(param: string) 		{ return Version.parse(param); }
}

class Reflection_Assembly extends StaticFunctions {
	static {StaticFunctions.register('Reflection.Assembly', this); }
	static LoadFile(...params: string[]) {}
}

class Globalization_CultureInfo extends StaticFunctions {
	static {StaticFunctions.register('Globalization.CultureInfo', this); }
	static CurrentUICulture(...params: string[]) { return 'CurrentUICulture'; }
}

class Runtime_InteropServices_RuntimeInformation extends StaticFunctions {
	static {StaticFunctions.register('Runtime.InteropServices.RuntimeInformation', this); }
	static ProcessArchitecture(...params: string[]) { return 'ProcessArchitecture'; }
}

class Text_RegularExpressions_Regex extends StaticFunctions {
	static {StaticFunctions.register('Text.RegularExpressions.Regex', this); }
	static Match(...params: string[]) 		{ return 'Match'; }
	static Replace(...params: string[]) 	{ return 'Replace'; }
	static Split(...params: string[])		{ return 'Split'; }
}

class IO_Directory extends StaticFunctions {
	static { StaticFunctions.register('IO.Directory', this); }
	static GetDirectories(dir:string, pattern:string)	{ return fs.search(path.join(dir, pattern), undefined, vscode.FileType.Directory); }
	static GetFiles(dir:string, pattern:string)			{ return fs.search(path.join(dir, pattern), undefined, vscode.FileType.File); }
//	static GetLastAccessTime(...params: string[])		{ return 'GetLastAccessTime'; }
	static GetLastWriteTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	static GetParent(a: string)							{ return path.dirname(a); }
}
		
class IO_File extends StaticFunctions {
	static { StaticFunctions.register('IO.File', this); }
	static Exists(a: string)							{ return fs.exists(a); }
	static GetAttributes(a: string)						{ return fs.getStat(a); }
	static GetCreationTime(a: string)					{ return fs.getStat(a).then(stat => stat?.ctime); }
	static GetLastAccessTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	static GetLastWriteTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	static ReadAllText(a: string)						{ return loadTextFile(a); }
}

class IO_Path extends StaticFunctions {
	static { StaticFunctions.register('IO.Path', this); }
	static ChangeExtension(a: string, b: string)	{ const parsed = path.parse(a); parsed.ext = b; return path.format(parsed); }
	static Combine(...params: string[])				{ return path.join(...params); }
	static GetDirectoryName(a: string)				{ return path.dirname(a); }
	static GetExtension(a: string)					{ return path.extname(a); }
	static GetFileName(a: string)					{ return path.basename(a); }
	static GetFileNameWithoutExtension(a: string)	{ return path.parse(a).name; }
	static GetFullPath(a: string, b?:string)		{ return path.resolve(b ? b : process.cwd(), a); }
	static GetPathRoot(a: string)					{ return path.parse(a).root; }
	static IsPathRooted(a: string)					{ return !!path.parse(a).root; }
}

class OperatingSystem extends StaticFunctions {
	static { StaticFunctions.register('OperatingSystem', this); }
	static IsOSPlatform(param: string) {
		param = param.toLowerCase();
		switch (param) {
			case 'windows': return process.platform === 'win32';
			case 'macos':	return process.platform === 'darwin';
			default:		return process.platform === param;
		}
	}
//	static IsOSPlatformVersionAtLeast(...params: string[])	{ return 'IsOSPlatformVersionAtLeast'; }
	static IsLinux()										{ return process.platform === 'linux'; }
	static IsFreeBSD()										{ return process.platform === 'freebsd'; }
//	static IsFreeBSDVersionAtLeast(...params: string[])		{ return 'IsFreeBSDVersionAtLeast'; }
	static IsMacOS()										{ return process.platform === 'darwin'; }
//	static IsMacOSVersionAtLeast(...params: string[])		{ return 'IsMacOSVersionAtLeast'; }
	static IsWindows()										{ return process.platform === 'win32'; }
//	static IsWindowsVersionAtLeast(...params: string[])		{ return 'IsWindowsVersionAtLeast'; }
}


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

class MSBuild extends StaticFunctions {
	static { StaticFunctions.register('MSBuild', this); }
	static Add(a:string, b:string)							{ return +a + +b; }
	static Subtract(a:string, b:string)						{ return +a - +b; }
	static Multiply(a:string, b:string)						{ return +a * +b; }
	static Divide(a:string, b:string)					 	{ return +a / +b; }
	static Modulo(a:string, b:string)					 	{ return +a % +b; }
	static BitwiseOr(a:string, b:string)					{ return +a | +b; }
	static BitwiseAnd(a:string, b:string)				 	{ return +a & +b; }
	static BitwiseXor(a:string, b:string)				 	{ return +a ^ +b; }
	static BitwiseNot(a:string, b:string)				 	{ return ~+a; }
	static EnsureTrailingSlash(a: string)					{ return a && !a.endsWith(path.sep) ? a + path.sep : a; }
	static MakeRelative(a:string, b:string)					{ return path.relative(a, b); }
	static ValueOrDefault(a:string, b:string)			 	{ return a || b ; }
	static VersionEquals(a:string, b:string)				{ return version_compare(a, b) === 0; }
	static VersionGreaterThan(a:string, b:string)		 	{ return version_compare(a, b) > 0; }
	static VersionGreaterThanOrEquals(a:string, b:string) 	{ return version_compare(a, b) >= 0; }
	static VersionLessThan(a:string, b:string)				{ return version_compare(a, b) < 0; }
	static VersionLessThanOrEquals(a:string, b:string)		{ return version_compare(a, b) <= 0; }
	static VersionNotEquals(a:string, b:string)				{ return version_compare(a, b) !== 0; }
	static DoesTaskHostExist(...params: string[])			{ return 'DoesTaskHostExist'; }
	static async GetRegistryValue(key: string, value?:string)	{ return (await registry.getKey(key)).values[value??'']; }
	static async GetRegistryValueFromView(key:string, item:string, defaultValue:string, ...views: string[]) {
		if (views.length == 0)
			return (await registry.getKey(key)).values[item];
		for (const view of views) {
			const found = (await registry.getKey(key, view == 'RegistryView.Registry32' ? '32' : '64')).values[item];
			if (found)
				return found;
		}
	}
	static StableStringHash(a: string)						{ return getHashCode(a); }
//	static TargetFramework(...params: string[])				{ return 'TargetFramework'; }
//	static TargetPlatform(...params: string[])				{ return 'TargetPlatform'; }
	static async GetPathOfFileAbove(filename: string, startingDirectory: string) {
		const dir = await this.GetDirectoryNameOfFileAbove(startingDirectory, filename);
		return dir ? path.join(dir, filename) : '';
	}
	static async GetDirectoryNameOfFileAbove(startingDirectory: string, filename: string)	{
		while (!await fs.exists(path.join(startingDirectory, filename))) {
			const parent = path.dirname(startingDirectory);
			if (parent === startingDirectory)
				return '';
			startingDirectory = parent;
		}
		return path.join(startingDirectory, filename);
	}
	static IsOSPlatform(param: string)						{ return OperatingSystem.IsOSPlatform(param); }
	static IsOSUnixLike()									{ return process.platform != 'win32'; }
	static NormalizePath(...params: string[])				{ return path.resolve(...params); }
	static NormalizeDirectory(...params: string[])			{ return path.resolve(...params) + '\\'; }
	static Escape(unescapedString: string)					{ return escape(unescapedString); }
	static Unescape(escapedString: string)					{ return unescapeAll(escapedString); }
//	static ConvertToBase64(...params: string[])				{ return 'ConvertToBase64'; }
//	static ConvertFromBase64(...params: string[])			{ return 'ConvertFromBase64'; }

	static AreFeaturesEnabled(version: string)			{ return true; }

	static GetMSBuildExtensionsPath()		{ return path.join(this.GetVsInstallRoot(), 'MSBuild'); }
	static GetMSBuildSDKsPath()				{ return process.env.MSBuildSDKsPath ?? path.join(this.GetVsInstallRoot(), "MSBuild", "Sdks"); }
	static GetProgramFiles32()				{ return process.env["ProgramFiles(x86)"] ?? ''; }
	static GetToolsDirectory32()			{ return path.join(this.GetVsInstallRoot(), 'MSBuild', 'Current', 'Bin'); }
	static GetToolsDirectory64()			{ return path.join(this.GetVsInstallRoot(), 'MSBuild', 'Current', 'Bin', 'amd64'); }
	static GetCurrentToolsDirectory()		{ return this.GetToolsDirectory64(); }
	static GetVsInstallRoot()				{ return Extension.vsdir; }
	static IsRunningFromVisualStudio()		{ return false; }

	static GetTargetFrameworkIdentifier(targetFramework: string) 					{ return ParseTargetFramework(targetFramework)?.framework_id; }
	static GetTargetFrameworkVersion(targetFramework: string, versionPartCount = 2)	{ return extendVersion(ParseTargetFramework(targetFramework)?.framework_ver, versionPartCount); }
	static GetTargetPlatformIdentifier(targetFramework: string)						{ return ParseTargetFramework(targetFramework)?.platform_id; }
	static GetTargetPlatformVersion(targetFramework:string, versionPartCount = 2)	{ return extendVersion(ParseTargetFramework(targetFramework)?.platform_ver, versionPartCount); }
	static IsTargetFrameworkCompatible(targetFrameworkTarget:string, targetFrameworkCandidate: string)	{
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
}

class Microsoft_VisualStudio_Telemetry_TelemetryService extends StaticFunctions {
	static { StaticFunctions.register('Microsoft.VisualStudio.Telemetry.TelemetryService', this); }
	static DefaultSession(...params: string[])	{ return 'DefaultSession'; }
}

class Security_Principal_WindowsIdentity extends StaticFunctions {
	static { StaticFunctions.register('Security.Principal.WindowsIdentity', this); }
	static GetCurrent(...params: string[])	{ return 'GetCurrent'; }
}

class Microsoft_Build_Utilities_ToolLocationHelper extends StaticFunctions {
	static { StaticFunctions.register('Microsoft.Build.Utilities.ToolLocationHelper', this); }
	static defaultRegistryRoot = "SOFTWARE\\MICROSOFT\\Microsoft SDKs";


	public async FindRootFolderWhereAllFilesExist(possibleRoots: string, relativeFilePaths: string)	{
		if (possibleRoots) {
			const files = relativeFilePaths.split(';');
			for (const root of possibleRoots.split(';')) {
				if (await Promise.all(files.map(f => fs.stat_reject(path.join(root, f)))).then(()=>true).catch(()=>false))
					return root;
			}
		}
	}
	
	static async GetPlatformSDKDisplayName(Identifier: string, Version: string, diskRoots?: string, registryRoot?: string) {
		const sdk = await Locations.GetMatchingPlatformSDK(Identifier, Version, diskRoots?.split(';') ?? await Locations.sdkRoots.value, registryRoot ?? this.defaultRegistryRoot);
		return (await sdk?.manifest)?.attributes.DisplayName ?? `${Identifier} ${Version}`;
	}

	static async GetPlatformSDKLocation(Identifier: string, Version: string, diskRoots?: string, registryRoot?: string) {
		const sdk = await Locations.GetMatchingPlatformSDK(Identifier, Version, diskRoots?.split(';') ??  await Locations.sdkRoots.value, registryRoot ?? this.defaultRegistryRoot);
		return sdk?._path ?? '';
	}
	
	static async GetLatestSDKTargetPlatformVersion(sdkIdentifier: string, sdkVersion: string, ...sdkRoots: string[]) : Promise<Version|undefined> {
		const version = Version.parse(sdkVersion);
		if (version) {
			if (sdkRoots.length == 0)
				sdkRoots = await Locations.sdkRoots.value;
			const SDKs		= await Locations.RetrieveTargetPlatformList(sdkRoots, this.defaultRegistryRoot);
			const platforms: string[] = [];
			for (const sdk of SDKs) {
				if (insensitive.compare(sdk.platform, sdkIdentifier) == 0 && sdk.version.compare(version) == 0 && sdk.Platforms)
					utils.arrayAppend(platforms, Object.keys(sdk.Platforms));
			}
			return platforms.map(i => Version.parse(i)).filter(i => !!i).reduce((acc, v) => v.compare(acc) > 0 ? v : acc, new Version);
		}
	}

	static async GetFoldersInVSInstallsAsString(minVersionString?: string, maxVersionString?: string, subFolder?: string) { 
		let folders	= await Locations.GetFoldersInVSInstalls(Version.parse(minVersionString), Version.parse(maxVersionString));
		if (subFolder)
			folders = folders.map(i => path.join(i, subFolder));
		return folders.join(';');
	}
}

function get_params(value: string, start = 0) : [number, string[]] {
	const params: string[] = [];
	let i		= start;
	let depth	= 1;
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


export async function substitutor(m: RegExpExecArray, right:string, properties: Record<string, string>, leave_undefined = false): Promise<string> {
	if (m[1].startsWith('registry:')) {
		const parts		= m[1].substring(9).split('@');
		const key		= await registry.getKey(parts[0]);
		const replace	= key.values[parts[1]];
		return replace + right;
	}

	let replace = m[1].startsWith('[') ? m[1]
				: properties[m[1].toUpperCase()];
	
	if (!replace) {
		//log(`no substitute for ${m[1]}`);
		if (leave_undefined)
			return m[0] + right;
		replace = '';
	}

	if (m[2] !== ')') {
		let [close, params] = get_params(right);
		let result;

		if (m[2].startsWith('::')) {
			const clss = replace.slice(1, -1);
			const func = m[2].slice(2, -1);
			try {
				result = await StaticFunctions.run(clss, func, ...params);
			} catch (error) {
				return `unknown_${clss}::${func}()`;
			}
		} else {
			const func = m[2].substring(1, m[2].length - 1);
			try {
				result = new StringFunctions(replace)[func](params);
			} catch (error) {
				return `unknown_${func}(${replace})`;
			}
		}

		const re2 = /^\.(\w+)|\[/g;
		re2.lastIndex = close;

		let m2: RegExpExecArray | null;
		while ((m2 = re2.exec(right))) {
			if (right[re2.lastIndex] == '(') {
				//function
				const func = m[2].slice(1, -1);
				try {
					[close, params] = get_params(right, re2.lastIndex + 1);
					result 			= await result[func](params);
					re2.lastIndex	= close;
				} catch (error) {
					return `unknown_${func}()`;
				}

			} else if (m2[1]) {
				//field
				result	= result[m2[1]];
			} else {
				//index
				//result	= result[right[re2.lastIndex]];
				const exp = new ExpressionParser(right.substring(re2.lastIndex));
				const index = exp.Evaluate();
				result	= result[index];

				close = re2.lastIndex + exp.re.lastIndex;
				if (right[close] === ']')
					++close;
				else
					log('Missing closing bracket');
				re2.lastIndex = close;
			}
		}

		replace = result == undefined ? '' : result.toString();
		right	= right.substring(close + 1);//+1 for substitution closing )
	}
	return replace + right;
}

function has_trailing_slash(value: string) {
	const last = value.charAt(value.length - 1);
	return last == '/' || last == '\\';
}

class ExpressionParser {
	re 		= /\s*('.*?'|==|!=|<=|>=|[<>!()]|And|Or|Exists\(|HasTrailingSlash\(|\w+)/iy;
	next_token : string | undefined | null;

	constructor(public text: string) {
	}

	remaining() : string {
		return this.text.substring(this.re.lastIndex);
	}

	get_token0() : string | null {
		const saveIndex = this.re.lastIndex;
		const m = this.re.exec(this.text);
		if (m)
			return m[1];
		this.re.lastIndex = saveIndex;//this.text.length;
		return null;
	}
	get_token() : string | null {
		if (this.next_token !== undefined) {
			const result = this.next_token;
			this.next_token = undefined;
			return result;
		}
		return this.get_token0();
	}
	
	consume_token() {
		this.next_token = undefined;
	}
	
	peek_token() : string | null {
		if (this.next_token === undefined)
			this.next_token = this.get_token0();
		return this.next_token;
	}


	Evaluate0() : any {
		let a = this.get_token();
		switch (a) {	
			case '(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? a : undefined;
			}
			case 'Exists(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? fs.exists(a || "") : undefined;
			}
			case 'HasTrailingSlash(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? has_trailing_slash(a ?? "") : undefined;
			}
			default: return a ? fix_quotes(a) : a;
		}
	}

	Evaluate1() : any {
		const a = this.Evaluate0();
		if (a === null)
			return null;
		const token = this.get_token();
		switch (token) {
			case '==':	return a === this.Evaluate0();
			case '!=':	return a !== this.Evaluate0();
			case '<=':	return +a <= +this.Evaluate0();
			case '>=':	return +a >= +this.Evaluate0();
			case '<':	return +a < +this.Evaluate0();
			case '>':	return +a > +this.Evaluate0();
			default: this.next_token = token; return a;
		}
	}

	Evaluate2() : any {
		let a = this.Evaluate1();
		while (a !== null && this.peek_token()?.toLowerCase() == 'and') {
			this.consume_token();
			const b = this.Evaluate1();
			a = get_boolean(a) && get_boolean(b);
		}
		return a;
	}

	Evaluate3() : any {
		let a = this.Evaluate2();
		while (a !== null && this.peek_token()?.toLowerCase() == 'or') {
			this.consume_token();
			const b = this.Evaluate2();
			a = get_boolean(a) || get_boolean(b);
		}
		return a;
	}

	Evaluate() : any {
		return this.Evaluate3();
	}
}

export function Evaluate(value: string) {
	return new ExpressionParser(value).Evaluate();
}
