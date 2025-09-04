
import * as utils from '@isopodlabs/utilities';

export class Version {
	constructor(public major = 0, public minor = 0, public patch = 0) {}
	toString() 							{ return `${this.major}.${this.minor}.${this.patch}`; }
	compare(b: Version) 				{ return utils.compare(this.major, b.major) || utils.compare(this.minor, b.minor); }
	between(a?: Version, b?:Version)	{ return (!a || this.compare(a) >= 0) && (!b || this.compare(b) < 0); }

	static parse(v?: string) {
		if (v !== undefined) {
			const parts = v.split('.').map(i => +i);
			if (parts.length >= 2 && parts.every(i => i == i))
				return new Version(parts[0], parts[1], parts[2]??0);
		}
	}

	static parse2(version: string) {
		if (version.length && (version[0] == 'v' || version[0] == 'V'))
			version = version.substring(1);

		if (version.indexOf('.') == -1)
			version += ".0";

		return this.parse(version);
	}
}

export function extendVersion(v: string|undefined, wanted_parts: number) {
	if (v === undefined)
		v = '0';

	const parts = v.split('.');
	return parts.length < wanted_parts
		? v + '.0'.repeat(wanted_parts - parts.length)
		: parts.slice(0, wanted_parts).join('.');
}

export function version_compare(a: string, b: string) {
	a = a.substring(a.startsWith('v') || a.startsWith('v') ? 1 : 0, utils.firstOf(a, '+-'));
	b = b.substring(b.startsWith('v') || b.startsWith('v') ? 1 : 0, utils.firstOf(b, '+-'));
	const a1 = a.split('.');
	const b1 = b.split('.');

	const n = Math.min(a1.length, b1.length);
	for (let i = 0; i < n; i++) {
		const x = parseInt(a1[i], 10);
		const y = parseInt(b1[i], 10);
		if (x !== y)
			return x - y;
	}
	return a1.length - b1.length;
/*
	const re = /v?(\d+\.)+(\d+)/i
	if (a.startsWith('v') || a.startsWith('v'))
		a = a.substring(1)
	if (b.startsWith('v') || b.startsWith('v'))
		b = b.substring(1)
*/
}

export function sortByVersion<T>(map: Record<string, T>) : [Version, T][] {
	const sorted = [...Object.entries(map)].sort((a, b) => version_compare(b[0], a[0]));
	return sorted.map(i => [Version.parse(i[0])!, i[1]]);
}

