#!/usr/bin/env node
/**
 * Glimmer CLI.
 *
 *   glimmer <entry.glim> [-o output.asm] [--org <addr>]
 *
 * Compiles Glimmer meta-source to a generated AZM source file, ready for the
 * AZM assembler: `glimmer counter.glim && azm counter.main.asm`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import type { GlimmerProgram } from './model.js';
import { computeBlockMappings, rewriteD8Map, type D8Map } from './build.js';
import { generateAzm } from './generate.js';
import { loadGlimmerProgram } from './load.js';
import { parseNumber } from './parse.js';

const require = createRequire(import.meta.url);

function usage(): string {
  return [
    'Usage: glimmer [options] <entry.glim>',
    '       glimmer build [options] <entry.glim>',
    '',
    'The default command compiles .glim to a generated AZM source file.',
    'build also assembles it with AZM (.hex, .bin, .d8.json) and rewrites',
    'the Debug80 map so block-body lines step in the .glim source.',
    '',
    'Options:',
    '  -o, --output <file>   Output AZM path (default: <entry>.main.asm, the Debug80 entry-point convention)',
    '  --org <addr>          Assembly origin, e.g. $4000 (default: $4000)',
    '  --no-check            Skip the AZM contract-inject/check step (not with build)',
    '  --deps                Print the dependency report (writers/readers per cell) and exit',
    '  -V, --version         Print package version',
    '  -h, --help            Print this help',
  ].join('\n');
}

/**
 * Run AZM over the generated file with the same parameters Debug80 uses
 * (--contracts --rc error, plus the mon3 profile for MON-3 programs).
 * AZM infers register contracts for every @ routine and injects them
 * into the file as ;! comments — Glimmer emits the boundaries, AZM
 * supplies the truth. Returns AZM's exit code.
 */
function annotateAndCheck(outPath: string, isTec1g: boolean): number {
  const azmCli = require.resolve('@jhlagado/azm/cli');
  const args = [azmCli, '--contracts', '--rc', 'error'];
  if (isTec1g) args.push('--reg-profile', 'mon3');
  args.push(outPath);
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  return run.status ?? 1;
}

/**
 * Assemble the final annotated file into .hex/.bin/.d8.json. This is a
 * second AZM pass: contract injection edits the file on disk, so the map
 * must be produced from the file as it now stands or its line numbers
 * would be offset by the injected ;! lines.
 */
function assembleArtifacts(outPath: string): number {
  const azmCli = require.resolve('@jhlagado/azm/cli');
  const run = spawnSync(process.execPath, [azmCli, outPath], { encoding: 'utf8' });
  if (run.status !== 0) {
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
  }
  return run.status ?? 1;
}

/**
 * Rewrite the emitted .d8.json so segments inside block bodies step in
 * the .glim source while generated glue stays on the generated asm.
 */
function rewriteDebugMap(outPath: string, entry: string, program: GlimmerProgram): number {
  const d8Path = outPath.replace(/\.asm$/, '.d8.json');
  const outDir = path.dirname(outPath);
  const entryDir = path.dirname(entry);
  const asmKey = path.basename(outPath);

  const asmText = readFileSync(outPath, 'utf8');
  const glimFileKey = (declared: string | undefined): string =>
    path.relative(outDir, path.resolve(entryDir, declared ?? path.basename(entry))) ||
    path.basename(entry);
  const { mappings, warnings } = computeBlockMappings(
    asmText,
    program.effects,
    path.basename(entry),
    glimFileKey,
  );
  for (const warning of warnings) {
    console.error(`warning: ${warning}`);
  }

  const map = JSON.parse(readFileSync(d8Path, 'utf8')) as D8Map;
  const { moved } = rewriteD8Map(map, asmKey, mappings);
  writeFileSync(d8Path, `${JSON.stringify(map, null, 2)}\n`);
  console.log(
    `Wrote ${d8Path} (${moved} block segment${moved === 1 ? '' : 's'} attributed to .glim source)`,
  );
  return 0;
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
      kind: `state ${s.type}${s.length !== undefined ? `[${s.length}]` : ''}`,
    })),
    ...program.pulses.map((pu) => ({ name: pu.name, kind: 'pulse' })),
    ...program.timers.map((t) => ({ name: t.name, kind: t.once ? 'timer once' : 'timer' })),
    ...program.ramps.map((r) => ({ name: r.name, kind: 'ramp' })),
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

export function main(argv: string[]): number {
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

  if (deps) {
    console.log(depsReport(loaded.program));
    return 0;
  }

  const generated = generateAzm(loaded.program, org === undefined ? {} : { org });
  if (generated.diagnostics.length > 0) {
    for (const diagnostic of generated.diagnostics) {
      const where = diagnostic.line > 0 ? `${entry}:${diagnostic.line}` : entry;
      console.error(`${where}: ${diagnostic.message}`);
    }
    return 1;
  }

  // Debug80 recognizes entry points named main.asm or <name>.main.asm;
  // the generated file is a program entry, so it follows the convention.
  const outPath =
    output ??
    path.join(path.dirname(entry), `${path.basename(entry, path.extname(entry))}.main.asm`);
  writeFileSync(outPath, generated.source);

  if (check) {
    const isTec1g = loaded.program.platform === 'tec1g-mon3';
    const status = annotateAndCheck(outPath, isTec1g);
    if (status !== 0) {
      console.error(`AZM contract check failed for ${outPath}.`);
      return status;
    }
    console.log(`Wrote ${outPath} (register contracts injected by AZM)`);
    if (!build) return 0;

    // build: assemble the annotated file (hex/bin/d8.json), then point
    // block-body map segments back at the .glim source.
    const assembleStatus = assembleArtifacts(outPath);
    if (assembleStatus !== 0) {
      console.error(`AZM assembly failed for ${outPath}.`);
      return assembleStatus;
    }
    return rewriteDebugMap(outPath, entry, loaded.program);
  }
  console.log(`Wrote ${outPath}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
