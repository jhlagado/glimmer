#!/usr/bin/env node
/**
 * Glimmer CLI — a thin shell over the programmatic build API
 * (src/build.ts), which is the same surface a host like Debug80 calls.
 *
 *   glimmer <entry.glim> [-o output.asm] [--org <addr>]
 *   glimmer build <entry.glim> [-o output.asm] [--org <addr>]
 *
 * The default command compiles Glimmer meta-source to a generated AZM
 * source file and runs AZM's register-contract check over it (the file
 * declares its own `.contracts` policy and `.routine` boundaries).
 * `build` continues through assembly (.hex/.bin/.d8.json) and rewrites
 * the Debug80 map so block bodies step in .glim source.
 */

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { GlimmerProgram } from './model.js';
import { buildGlimmerProgram, type BuildDiagnostic } from './build.js';
import { loadGlimmerProgram } from './load.js';
import { parseNumber } from './parse.js';

const require = createRequire(import.meta.url);

function usage(): string {
  return [
    'Usage: glimmer [options] <entry.glim>',
    '       glimmer build [options] <entry.glim>',
    '',
    'The default command compiles .glim to a generated AZM source file',
    'and register-contract checks it with AZM. build also assembles it',
    'with AZM (.hex, .bin, .d8.json) and rewrites the Debug80 map so',
    'block-body lines step in the .glim source.',
    '',
    'Options:',
    '  -o, --output <file>   Output AZM path (default: <entry>.main.asm, the Debug80 entry-point convention)',
    '  --org <addr>          Assembly origin, e.g. $4000 (default: $4000)',
    '  --no-check            Generate only; skip the AZM register-contract check (not with build)',
    '  --deps                Print the dependency report (writers/readers per cell) and exit',
    '  -V, --version         Print package version',
    '  -h, --help            Print this help',
  ].join('\n');
}

/**
 * The reactive graph as a report: for every flag-carrying cell, who
 * raises it and which blocks it triggers — the program's dataflow
 * without reading any Z80.
 */
export function depsReport(program: GlimmerProgram): string {
  const lines: string[] = [`program ${program.name}`];
  const cells: Array<{ name: string; kind: string }> = [
    ...program.states.map((s) => ({
      name: s.name,
      kind: `state ${s.typeName ?? s.type}${s.length !== undefined ? `[${s.length}]` : ''}`,
    })),
    ...program.pulses.map((pu) => ({ name: pu.name, kind: 'pulse' })),
    ...program.timers.map((t) => ({ name: t.name, kind: t.once ? 'timer once' : 'timer' })),
    ...program.ramps.map((r) => ({ name: r.name, kind: 'ramp' })),
    ...(program.cards.length > 0
      ? [
          {
            name: 'CurrentCard',
            kind: `card state (built-in; cards: ${program.cards.map((c) => c.name).join(', ')})`,
          },
        ]
      : []),
  ];
  for (const cell of cells) {
    const writers: string[] = [];
    for (const binding of program.bindings) {
      if (binding.target === cell.name) writers.push(`key ${binding.key} (${binding.edge})`);
    }
    for (const timer of program.timers) {
      if (timer.target === cell.name) writers.push(`timer ${timer.name}`);
    }
    for (const ramp of program.ramps) {
      if (ramp.target === cell.name) writers.push(`ramp ${ramp.name}`);
    }
    for (const effect of program.effects) {
      if (effect.updates.includes(cell.name)) writers.push(effect.name);
    }
    const readers = program.effects
      .filter((effect) => effect.depends.includes(cell.name))
      .map((effect) => `${effect.name} (${effect.phase})`);
    lines.push(`  ${cell.name} : ${cell.kind}`);
    lines.push(`    raised by: ${writers.length > 0 ? writers.join(', ') : '(nothing)'}`);
    lines.push(`    triggers:  ${readers.length > 0 ? readers.join(', ') : '(nothing)'}`);
  }
  return lines.join('\n');
}

function printDiagnostic(diagnostic: BuildDiagnostic): void {
  const where = [
    diagnostic.sourceName,
    ...(diagnostic.line !== undefined ? [String(diagnostic.line)] : []),
    ...(diagnostic.column !== undefined ? [String(diagnostic.column)] : []),
  ].join(':');
  const code = diagnostic.code !== undefined ? ` [${diagnostic.code}]` : '';
  console.error(`${where}:${code} ${diagnostic.severity}: ${diagnostic.message}`);
}

export async function main(argv: string[]): Promise<number> {
  let entry: string | null = null;
  let output: string | null = null;
  let org: number | undefined;
  let check = true;
  let deps = false;
  let build = false;

  if (argv[0] === 'build') {
    build = true;
    argv = argv.slice(1);
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      return 0;
    }
    if (arg === '-V' || arg === '--version') {
      const pkg = require('../../package.json') as { version: string };
      console.log(pkg.version);
      return 0;
    }
    if (arg === '-o' || arg === '--output') {
      output = argv[++i] ?? null;
      if (output === null) {
        console.error('Missing value for --output.');
        return 1;
      }
      continue;
    }
    if (arg === '--no-check') {
      check = false;
      continue;
    }
    if (arg === '--deps') {
      deps = true;
      continue;
    }
    if (arg === '--org') {
      const value = argv[++i];
      const parsed = value === undefined ? null : parseNumber(value);
      if (parsed === null) {
        console.error(`Invalid --org value: ${value ?? '(missing)'}.`);
        return 1;
      }
      org = parsed;
      continue;
    }
    if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}\n\n${usage()}`);
      return 1;
    }
    if (entry !== null) {
      console.error('Only one entry file is supported.');
      return 1;
    }
    entry = arg;
  }

  if (entry === null) {
    console.error(usage());
    return 1;
  }
  if (build && !check) {
    console.error('build always runs the AZM check; --no-check is not supported with build.');
    return 1;
  }

  if (deps) {
    const loaded = loadGlimmerProgram(entry);
    if (loaded.program === null) {
      const entryDir = path.dirname(entry);
      for (const diagnostic of loaded.diagnostics) {
        const file =
          diagnostic.file === undefined
            ? entry
            : diagnostic.file === path.basename(entry)
              ? entry
              : path.join(entryDir, diagnostic.file);
        const where = diagnostic.line > 0 ? `${file}:${diagnostic.line}` : file;
        console.error(`${where}: ${diagnostic.message}`);
      }
      return 1;
    }
    console.log(depsReport(loaded.program));
    return 0;
  }

  const result = await buildGlimmerProgram(entry, {
    ...(output !== null ? { outputPath: output } : {}),
    ...(org !== undefined ? { org } : {}),
    stage: build ? 'build' : check ? 'check' : 'generate',
  });
  for (const diagnostic of result.diagnostics) {
    printDiagnostic(diagnostic);
  }
  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`);
  }
  if (result.artifacts === undefined) {
    return 1;
  }

  const asmRelative = path.relative(process.cwd(), result.artifacts.asm);
  if (!check) {
    console.log(`Wrote ${asmRelative}`);
    return 0;
  }
  console.log(`Wrote ${asmRelative} (register contracts checked by AZM)`);
  if (build && result.artifacts.d8 !== undefined) {
    const moved = result.mappedSegments ?? 0;
    console.log(
      `Wrote ${path.relative(process.cwd(), result.artifacts.d8)} (${moved} block segment${moved === 1 ? '' : 's'} attributed to .glim source)`,
    );
  }
  return 0;
}

/**
 * True when this file is the entry script, including through the npm
 * bin symlink: argv[1] is the symlink path while import.meta.url is
 * the resolved real file, so compare after realpath resolution.
 */
function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
