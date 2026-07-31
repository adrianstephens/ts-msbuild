import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import * as xml from '@isopodlabs/xml';
import * as utils from '@isopodlabs/utilities';
import { PropertyContext, Items, ItemMode, evaluatePropsAndImports } from './MsBuild';
import { XMLCache, exists, search } from './index';

//-----------------------------------------------------------------------------
//	Types
//-----------------------------------------------------------------------------

export interface ExecuteOptions {
	targets?:	string[];					// targets to build (default: DefaultTargets)
	output?:	(msg: string) => void;		// capture stdout/stderr
	dryRun?:	boolean;					// print commands without running
}

interface TaskContext {
	props:		PropertyContext;
	output:		(msg: string) => void;
	dryRun:		boolean;
}

interface TaskResult { outputs?: Record<string, string>; success: boolean }
type TaskFn = (params: Record<string, string>, ctx: TaskContext) => Promise<TaskResult>;

//-----------------------------------------------------------------------------
//	Built-in Tasks
//-----------------------------------------------------------------------------

const builtinTasks: Record<string, TaskFn> = {

	Message: async ({ Text = '', Importance = 'normal' }, { output }) => {
		if (Importance.toLowerCase() !== 'low')
			output(Text + '\n');
		return { success: true };
	},

	Warning: async ({ Text = '', Code }, { output }) => {
		output(`WARNING${Code ? ' ' + Code : ''}: ${Text}\n`);
		return { success: true };
	},

	Error: async ({ Text = '', Code }, { output }) => {
		output(`ERROR${Code ? ' ' + Code : ''}: ${Text}\n`);
		return { success: false };
	},

	MakeDir: async ({ Directories }, { output, dryRun }) => {
		const dirs = Directories.split(';').map(d => d.trim()).filter(Boolean);
		for (const dir of dirs) {
			output(`MakeDir: ${dir}\n`);
			if (!dryRun)
				await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
		}
		return { success: true };
	},

	RemoveDir: async ({ Directories }, { output, dryRun }) => {
		const dirs = Directories.split(';').map(d => d.trim()).filter(Boolean);
		for (const dir of dirs) {
			output(`RemoveDir: ${dir}\n`);
			if (!dryRun)
				await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
		return { success: true };
	},

	Delete: async ({ Files }, { output, dryRun }) => {
		const files = Files.split(';').map(f => f.trim()).filter(Boolean);
		for (const file of files) {
			output(`Delete: ${file}\n`);
			if (!dryRun)
				await fs.promises.unlink(file).catch(() => {});
		}
		return { success: true };
	},

	Copy: async ({ SourceFiles, DestinationFolder, DestinationFiles, OverwriteReadOnlyFiles }, { output, dryRun }) => {
		const sources = SourceFiles.split(';').map(f => f.trim()).filter(Boolean);
		const overwrite = OverwriteReadOnlyFiles?.toLowerCase() === 'true';
		const copiedFiles: string[] = [];

		if (DestinationFiles) {
			const dests = DestinationFiles.split(';').map(f => f.trim()).filter(Boolean);
			for (let i = 0; i < sources.length; i++) {
				const dest = dests[i];
				if (!dest)
					continue;
				output(`Copy: ${sources[i]} -> ${dest}\n`);
				if (!dryRun) {
					await fs.promises.mkdir(path.dirname(dest), { recursive: true }).catch(() => {});
					if (overwrite)
						await fs.promises.chmod(dest, 0o666).catch(() => {});
					await fs.promises.copyFile(sources[i], dest);
					copiedFiles.push(dest);
				}
			}
		} else if (DestinationFolder) {
			await fs.promises.mkdir(DestinationFolder, { recursive: true }).catch(() => {});
			for (const src of sources) {
				const dest = path.join(DestinationFolder, path.basename(src));
				output(`Copy: ${src} -> ${dest}\n`);
				if (!dryRun) {
					if (overwrite)
						await fs.promises.chmod(dest, 0o666).catch(() => {});
					await fs.promises.copyFile(src, dest);
					copiedFiles.push(dest);
				}
			}
		}
		return { success: true, outputs: { CopiedFiles: copiedFiles.join(';') } };
	},

	Move: async ({ SourceFiles, DestinationFolder, DestinationFiles }, { output, dryRun }) => {
		const sources = SourceFiles.split(';').map(f => f.trim()).filter(Boolean);
		if (DestinationFiles) {
			const dests = DestinationFiles.split(';').map(f => f.trim()).filter(Boolean);
			for (let i = 0; i < sources.length; i++) {
				const dest = dests[i];
				if (!dest)
					continue;
				output(`Move: ${sources[i]} -> ${dest}\n`);
				if (!dryRun) {
					await fs.promises.mkdir(path.dirname(dest), { recursive: true }).catch(() => {});
					await fs.promises.rename(sources[i], dest);
				}
			}
		} else if (DestinationFolder) {
			for (const src of sources) {
				const dest = path.join(DestinationFolder, path.basename(src));
				output(`Move: ${src} -> ${dest}\n`);
				if (!dryRun) {
					await fs.promises.mkdir(DestinationFolder, { recursive: true }).catch(() => {});
					await fs.promises.rename(src, dest);
				}
			}
		}
		return { success: true };
	},

	WriteLinesToFile: async ({ File, Lines, Overwrite, WriteOnlyWhenDifferent }, { output, dryRun }) => {
		const content = Lines.split(';').join('\n') + '\n';
		output(`WriteLinesToFile: ${File}\n`);
		if (!dryRun) {
			if (WriteOnlyWhenDifferent?.toLowerCase() === 'true') {
				const existing = await fs.promises.readFile(File, 'utf8').catch(() => null);
				if (existing === content)
					return { success: true };
			}
			await fs.promises.mkdir(path.dirname(File), { recursive: true }).catch(() => {});
			const flag = Overwrite?.toLowerCase() === 'false' ? 'a' : 'w';
			await fs.promises.writeFile(File, content, { flag });
		}
		return { success: true };
	},

	ReadLinesFromFile: async ({ File }, _ctx) => {
		const content = await fs.promises.readFile(File, 'utf8').catch(() => '');
		return { success: true, outputs: { Lines: content.split('\n').filter(Boolean).join(';') } };
	},

	Exec: async ({ Command, WorkingDirectory, IgnoreExitCode }, { output, dryRun }) => {
		output(`Exec: ${Command}\n`);
		if (dryRun)
			return { success: true };
		return new Promise(resolve => {
			child_process.exec(Command, { cwd: WorkingDirectory || process.cwd() }, (err, stdout, stderr) => {
				if (stdout)
					output(stdout);
				if (stderr)
					output(stderr);
				const success = !err || IgnoreExitCode?.toLowerCase() === 'true';
				resolve({ success });
			});
		});
	},

	Touch: async ({ Files, AlwaysCreate }, { output, dryRun }) => {
		const fileList = Files.split(';').map(f => f.trim()).filter(Boolean);
		for (const file of fileList) {
			output(`Touch: ${file}\n`);
			if (!dryRun) {
				if (AlwaysCreate?.toLowerCase() === 'true')
					await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
				const now = new Date();
				await fs.promises.utimes(file, now, now).catch(async () => {
					await fs.promises.writeFile(file, '');
				});
			}
		}
		return { success: true };
	},

	FindInList: async ({ List, ItemSpecToFind }, _ctx) => {
		const items = List.split(';').map(i => i.trim());
		const found = items.find(i => i === ItemSpecToFind) ?? '';
		return { success: true, outputs: { ItemFound: found } };
	},

	CreateItem: async ({ Include }, _ctx) => {
		return { success: true, outputs: { Include } };
	},

	CreateProperty: async ({ Value }, _ctx) => {
		return { success: true, outputs: { Value } };
	},

	CallTarget: async ({ Targets }, ctx) => {
		// handled specially in executeTarget — this is a fallback
		ctx.output(`CallTarget: ${Targets}\n`);
		return { success: true };
	},

	MSBuild: async ({ Projects, Targets: tgts, Properties }, { output, dryRun }) => {
		output(`MSBuild: ${Projects} [${tgts || 'default'}]\n`);
		if (!dryRun) {
			const projectFiles = Projects.split(';').map(p => p.trim()).filter(Boolean);
			for (const proj of projectFiles) {
				const extraProps: Record<string, string> = {};
				if (Properties) {
					for (const kv of Properties.split(';')) {
						const [k, v] = kv.split('=');
						if (k)
							extraProps[k.trim()] = (v ?? '').trim();
					}
				}
				await execute(proj, { targets: tgts?.split(';').map(t => t.trim()).filter(Boolean), output });
			}
		}
		return { success: true };
	},
};

//-----------------------------------------------------------------------------
//	Task execution
//-----------------------------------------------------------------------------

async function runTask(element: xml.Element, ctx: TaskContext): Promise<boolean> {
	const name = element.name;

	// Evaluate all attributes as properties
	const params: Record<string, string> = {};
	for (const [k, v] of Object.entries(element.attributes)) {
		if (k !== 'Condition')
			params[k] = await ctx.props.substitute(v);
	}

	const taskFn = builtinTasks[name];
	if (!taskFn) {
		ctx.output(`[skipped unknown task: ${name}]\n`);
		return true;
	}

	const result = await taskFn(params, ctx);

	// Write task outputs back as properties / items
	if (result.outputs) {
		for (const [k, v] of Object.entries(result.outputs))
			ctx.props.addDirect({ [k]: v });
	}

	// Handle <Output> child elements
	for (const child of element.allElements()) {
		if (child.name !== 'Output')
			continue;
		const taskParam	= child.attributes.TaskParameter;
		const propName	= child.attributes.PropertyName;
		const itemName	= child.attributes.ItemName;
		const value		= result.outputs?.[taskParam] ?? params[taskParam] ?? '';
		if (propName)
			ctx.props.addDirect({ [propName]: value });
		if (itemName) {
			const items = ctx.props.items[itemName] ??= new Items(itemName, ItemMode.Text);
			for (const v of value.split(';').filter(Boolean))
				items.includePlain(v);
		}
	}

	return result.success;
}

//-----------------------------------------------------------------------------
//	Target execution
//-----------------------------------------------------------------------------

async function executeTarget(
	name: string,
	targets: Map<string, xml.Element>,
	ctx: TaskContext,
	built: Set<string>
): Promise<boolean> {
	if (built.has(name))
		return true;
	built.add(name);

	const element = targets.get(name.toLowerCase());
	if (!element) {
		// not an error — targets from imported .targets files may not be present
		return true;
	}

	if (!await ctx.props.checkConditional(element.attributes.Condition))
		return true;

	// Run DependsOnTargets first
	const depends = element.attributes.DependsOnTargets
		? await ctx.props.substitute(element.attributes.DependsOnTargets)
		: '';
	for (const dep of depends.split(';').map(s => s.trim()).filter(Boolean)) {
		if (!await executeTarget(dep, targets, ctx, built))
			return false;
	}

	// Incremental build: skip if all outputs are up-to-date
	if (element.attributes.Inputs && element.attributes.Outputs) {
		const inputs	= (await ctx.props.substitute(element.attributes.Inputs)).split(';').map(s => s.trim()).filter(Boolean);
		const outputs	= (await ctx.props.substitute(element.attributes.Outputs)).split(';').map(s => s.trim()).filter(Boolean);
		if (inputs.length && outputs.length) {
			const inputTimes	= await Promise.all(inputs.map(f => fs.promises.stat(f).then(s => s.mtimeMs).catch(() => Infinity)));
			const outputTimes	= await Promise.all(outputs.map(f => fs.promises.stat(f).then(s => s.mtimeMs).catch(() => 0)));
			const newestInput	= Math.max(...inputTimes);
			const oldestOutput	= Math.min(...outputTimes);
			if (newestInput <= oldestOutput) {
				ctx.output(`Target ${name}: skipped (up-to-date)\n`);
				return true;
			}
		}
	}

	ctx.output(`Target ${name}:\n`);

	for (const child of element.allElements()) {
		if (!await ctx.props.checkConditional(child.attributes.Condition))
			continue;

		if (child.name === 'PropertyGroup') {
			for (const e of child.allElements()) {
				if (await ctx.props.checkConditional(e.attributes.Condition))
					await ctx.props.set(e.name, e.firstText() || '', true);
			}
		} else if (child.name === 'ItemGroup') {
			for (const item of child.allElements()) {
				if (!await ctx.props.checkConditional(item.attributes.Condition))
					continue;
				const items = ctx.props.items[item.name] ??= new Items(item.name, ItemMode.File);
				if (item.attributes.Include) {
					const include = await ctx.props.substitute(item.attributes.Include);
					items.includePlain(include, item);
				}
				if (item.attributes.Remove) {
					const remove = await ctx.props.substitute(item.attributes.Remove);
					items.removeFiles('', remove);
				}
			}
		} else if (child.name === 'CallTarget') {
			const callTargets = (await ctx.props.substitute(child.attributes.Targets || '')).split(';').map(s => s.trim()).filter(Boolean);
			for (const t of callTargets) {
				if (!await executeTarget(t, targets, ctx, built))
					return false;
			}
		} else if (child.name === 'OnError') {
			// handled below
		} else {
			if (!await runTask(child, ctx)) {
				// run OnError targets
				const onError = element.allElements().find(e => e.name === 'OnError');
				if (onError) {
					const errTargets = (await ctx.props.substitute(onError.attributes.ExecuteTargets || '')).split(';').map(s => s.trim()).filter(Boolean);
					for (const t of errTargets)
						await executeTarget(t, targets, ctx, new Set(built));
				}
				return false;
			}
		}
	}
	return true;
}

//-----------------------------------------------------------------------------
//	Collect all targets from a project and its imports
//-----------------------------------------------------------------------------

async function collectTargets(projectPath: string, props: PropertyContext, targets: Map<string, xml.Element>, visited = new Set<string>()) {
	if (visited.has(projectPath))
		return;
	visited.add(projectPath);

	const doc	= await XMLCache.get(projectPath);
	const root	= doc?.firstElement();
	if (!root)
		return;

	for (const element of root.allElements()) {
		if (element.name === 'Target') {
			const name = element.attributes.Name;
			if (name && !targets.has(name.toLowerCase()))
				targets.set(name.toLowerCase(), element);

		} else if (element.name === 'Import' || element.name === 'ImportGroup') {
			const imports = element.name === 'Import' ? [element] : element.allElements().filter(e => e.name === 'Import');
			for (const imp of imports) {
				if (!await props.checkConditional(imp.attributes.Condition))
					continue;
				const raw = imp.attributes.Project;
				if (!raw)
					continue;
				const resolved = await props.substitute_path(raw);
				const currentDir = path.dirname(projectPath);
				const files = await utils.async.map(
					resolved.split(';').filter(Boolean),
					r => search(path.resolve(currentDir, r))
				).then(r => r.flat());
				for (const f of files)
					await collectTargets(f, props, targets, visited);
			}
		}
	}
}

//-----------------------------------------------------------------------------
//	Public API
//-----------------------------------------------------------------------------

export async function execute(projectPath: string, options: ExecuteOptions = {}): Promise<boolean> {
	const output	= options.output ?? (msg => process.stdout.write(msg));
	const dryRun	= options.dryRun ?? false;

	const doc	= await XMLCache.get(projectPath);
	const root	= doc?.firstElement();
	if (!root || root.name !== 'Project') {
		output(`Error: ${projectPath} is not a valid MSBuild project\n`);
		return false;
	}

	// Build a minimal PropertyContext
	const props = new PropertyContext({
		...Object.fromEntries(Object.keys(process.env).filter(k => /^[A-Za-z_]\w+$/.test(k)).map(k => [k, process.env[k] ?? ''])),
	});
	const parsed = path.parse(projectPath);
	props.addDirect({
		MSBuildProjectFullPath:		projectPath,
		MSBuildProjectDirectory:	parsed.dir + path.sep,
		MSBuildProjectFile:			parsed.base,
		MSBuildProjectName:			parsed.name,
		MSBuildProjectExtension:	parsed.ext,
	});
	props.setPath(projectPath);

	// Evaluate properties and imports
	await evaluatePropsAndImports(root.allElements(), props);

	// Collect all targets (including from imports)
	const targets = new Map<string, xml.Element>();
	await collectTargets(projectPath, props, targets);

	// Determine which targets to run
	let targetNames = options.targets ?? [];
	if (!targetNames.length) {
		const defaultTargets = root.attributes.DefaultTargets as string ?? root.attributes.InitialTargets ?? '';
		targetNames = defaultTargets.split(';').map(s => s.trim()).filter(Boolean);
	}
	if (!targetNames.length) {
		output('No targets specified and no DefaultTargets found\n');
		return false;
	}

	// Run InitialTargets first
	const initialTargets = (root.attributes.InitialTargets as string ?? '').split(';').map(s => s.trim()).filter(Boolean);
	const built = new Set<string>();
	const ctx: TaskContext = { props, output, dryRun };

	for (const t of initialTargets) {
		if (!await executeTarget(t, targets, ctx, built))
			return false;
	}

	for (const t of targetNames) {
		if (!await executeTarget(t, targets, ctx, built))
			return false;
	}

	return true;
}
