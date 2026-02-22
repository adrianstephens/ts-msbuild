export class Version {
	parts: number[];
	constructor(...parts: number[]) { this.parts = parts; }
	get major()		{ return this.parts[0] ?? 0; }
	get minor()		{ return this.parts[1] ?? 0; }
	get build()		{ return this.parts[2] ?? 0; }
	get revision() 	{ return this.parts[3] ?? 0; }
	
	toString() {
		return this.parts.join('.');
	}
	compare(b: Version) 				{
		const n = Math.min(this.parts.length, b.parts.length);
		for (let i = 0; i < n; i++) {
			const x = this.parts[i] ?? 0;
			const y = b.parts[i] ?? 0;
			if (x !== y)
				return x - y;
		}
		return this.parts.length - b.parts.length;
	}
	between(a?: Version, b?: Version)	{
		return (!a || this.compare(a) >= 0) && (!b || this.compare(b) < 0);
	}

	static parse(v?: string) {
		if (v !== undefined) {
			const parts = v.split('.').map(i => +i);
			if (parts.length >= 2 && parts.every(i => i == i))
				return new Version(...parts);
		}
	}

	static parse2(v: string) {
		if (v[0] == 'v' || v[0] == 'V')
			v = v.substring(1);

		const parts = v.split('.').map(i => +i);
		//if (parts.every(i => i == i))
		return new Version(...parts);
	}
}
