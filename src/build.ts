/**
 * `glimmer build`: the Option A debug-map rewrite.
 *
 * AZM's `.d8.json` map attributes address ranges to generated-asm lines.
 * Glimmer wrote those lines, so it knows which came from `.glim` block
 * bodies: every block compiles under an `@Glim_<Name>:` entry label and
 * its body is copied byte-for-byte verbatim (the label-anchored mapping
 * contract). This module re-attributes body segments to their `.glim`
 * source, leaving generated glue attributed to the generated `.asm` —
 * stepping lands in Glimmer source for user code and drops into readable
 * generated AZM for glue.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { compile } from '@jhlagado/azm/compile';

import type { EffectDecl, GlimmerDiagnostic, GlimmerProgram, RoutineDecl } from './model.js';
import { generateAzm } from './generate.js';
import { loadGlimmerProgram } from './load.js';

/** One block body's position in the final (annotated) generated asm. */
export interface BlockLineMapping {
  /** Effect the mapping belongs to (diagnostics only). */
  name: string;
  /** 1-based line of the first body line in the generated asm. */
  asmLine: number;
  /** Number of body lines. */
  lineCount: number;
  /** Map key of the .glim file the body came from. */
  glimFile: string;
  /** 1-based line of the first body line in that .glim file. */
  glimLine: number;
}

export interface BlockMappingsResult {
  mappings: BlockLineMapping[];
  /** Blocks that could not be anchored (label missing or body mismatch). */
  warnings: string[];
}

/** Anything with a verbatim body anchored at a generated @ label. */
export interface MappableBlock {
  /** The @-label line that anchors the body, without the colon. */
  label: string;
  name: string;
  body: readonly string[];
  bodyLine: number;
  file?: string;
}

/** Effects anchor at @Glim_<Name>, routines at their own @<Name>. */
export function mappableBlocks(
  effects: readonly EffectDecl[],
  routines: readonly RoutineDecl[] = [],
): MappableBlock[] {
  return [
    ...effects.map((effect) => ({
      label: `@Glim_${effect.name}`,
      name: effect.name,
      body: effect.body,
      bodyLine: effect.bodyLine,
      ...(effect.file !== undefined ? { file: effect.file } : {}),
    })),
    ...routines.map((routine) => ({
      label: `@${routine.name}`,
      name: routine.name,
      body: routine.body,
      bodyLine: routine.bodyLine,
      ...(routine.file !== undefined ? { file: routine.file } : {}),
    })),
  ];
}

/**
 * Locate every block body in the final generated asm text. The asm is
 * scanned as written to disk — after AZM contract injection — so line
 * numbers agree with the `.d8.json` produced from that same file. Bodies
 * are verified verbatim; a block that does not match is skipped with a
 * warning rather than mapped wrongly.
 */
export function computeBlockMappings(
  asmText: string,
  blocks: readonly MappableBlock[],
  entryGlimFile: string,
  glimFileKey: (declaredFile: string | undefined) => string = (file): string =>
    file ?? entryGlimFile,
): BlockMappingsResult {
  const lines = asmText.split('\n');
  const mappings: BlockLineMapping[] = [];
  const warnings: string[] = [];

  for (const block of blocks) {
    const label = `${block.label}:`;
    const labelIndex = lines.findIndex((line) => line.trimEnd() === label);
    if (labelIndex === -1) {
      warnings.push(`block ${block.name}: label ${label} not found in generated asm.`);
      continue;
    }
    // Contract comments are injected adjacent to @ labels; skip any that
    // landed between the label and the verbatim body.
    let start = labelIndex + 1;
    while (start < lines.length && (lines[start] ?? '').startsWith(';!')) start += 1;

    const matches = block.body.every((bodyLine, k) => lines[start + k] === bodyLine);
    if (!matches) {
      warnings.push(`block ${block.name}: body is not verbatim at ${label}; not mapped.`);
      continue;
    }
    if (block.body.length === 0) continue;
    mappings.push({
      name: block.name,
      asmLine: start + 1,
      lineCount: block.body.length,
      glimFile: glimFileKey(block.file),
      glimLine: block.bodyLine,
    });
  }

  return { mappings, warnings };
}

interface D8Segment {
  line?: number;
  [key: string]: unknown;
}

interface D8FileEntry {
  segments?: D8Segment[];
  symbols?: unknown[];
  [key: string]: unknown;
}

/** The subset of the d8-debug-map format the rewrite touches. */
export interface D8Map {
  files?: Record<string, D8FileEntry>;
  fileList?: string[];
  [key: string]: unknown;
}

/**
 * Move the generated-asm segments that fall inside block bodies onto
 * their `.glim` files. Mutates and returns the map. Glue segments and
 * symbols stay attributed to the generated asm.
 */
export function rewriteD8Map(
  map: D8Map,
  asmFileKey: string,
  mappings: readonly BlockLineMapping[],
): { moved: number } {
  const asmEntry = map.files?.[asmFileKey];
  if (asmEntry?.segments === undefined || mappings.length === 0) return { moved: 0 };

  const kept: D8Segment[] = [];
  const movedByFile = new Map<string, D8Segment[]>();
  let moved = 0;

  for (const segment of asmEntry.segments) {
    const line = segment.line;
    const mapping =
      typeof line === 'number'
        ? mappings.find((m) => line >= m.asmLine && line < m.asmLine + m.lineCount)
        : undefined;
    if (mapping === undefined || typeof line !== 'number') {
      kept.push(segment);
      continue;
    }
    const glimSegments = movedByFile.get(mapping.glimFile) ?? [];
    glimSegments.push({ ...segment, line: mapping.glimLine + (line - mapping.asmLine) });
    movedByFile.set(mapping.glimFile, glimSegments);
    moved += 1;
  }

  if (moved === 0) return { moved };
  asmEntry.segments = kept;
  map.files ??= {};
  for (const [glimFile, segments] of movedByFile) {
    const existing = map.files[glimFile];
    if (existing === undefined) {
      map.files[glimFile] = { segments, symbols: [] };
    } else {
      existing.segments = [...(existing.segments ?? []), ...segments];
    }
    if (map.fileList !== undefined && !map.fileList.includes(glimFile)) {
      map.fileList.push(glimFile);
    }
  }
  return { moved };
}

/**
 * Diagnostic shape shared with AZM (severity, absolute sourceName,
 * line/column) so a host like Debug80 can report Glimmer and AZM
 * problems through one path.
 */
export interface BuildDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** Absolute path of the file the diagnostic points at. */
  sourceName: string;
  line?: number;
  column?: number;
  code?: string;
}

export interface GlimmerBuildOptions {
  /** Output AZM path (default: `<entry>.main.asm` beside the entry). */
  outputPath?: string;
  /** Assembly origin (default $4000). */
  org?: number;
  /**
   * How far to take the build:
   * - 'generate' — write the AZM source only;
   * - 'check' — also run AZM contract inference/checking and inject
   *   the `;!` contracts (the plain CLI command);
   * - 'build' (default) — also assemble `.hex`/`.bin`/`.d8.json` and
   *   rewrite the debug map to step block bodies in `.glim` source.
   */
  stage?: 'generate' | 'check' | 'build';
}

export interface GlimmerBuildArtifacts {
  asm: string;
  hex?: string;
  bin?: string;
  d8?: string;
}

export interface GlimmerBuildResult {
  diagnostics: BuildDiagnostic[];
  /** Absolute paths of the files written; absent when the build failed. */
  artifacts?: GlimmerBuildArtifacts;
  /** Debug-map segments re-attributed to `.glim` source. */
  mappedSegments?: number;
  /** Non-fatal notes (e.g. blocks the map rewrite skipped). */
  warnings: string[];
}

function hasErrors(diagnostics: readonly BuildDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function fromGlimmerDiagnostics(
  diagnostics: readonly GlimmerDiagnostic[],
  entryPath: string,
): BuildDiagnostic[] {
  const entryDir = path.dirname(entryPath);
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity ?? 'error',
    message: diagnostic.message,
    sourceName:
      diagnostic.file === undefined
        ? path.resolve(entryPath)
        : path.resolve(entryDir, diagnostic.file),
    ...(diagnostic.line > 0 ? { line: diagnostic.line } : {}),
    code: 'GLIM',
  }));
}

interface AzmDiagnosticLike {
  severity?: string;
  message?: string;
  sourceName?: string;
  line?: number;
  column?: number;
  code?: string;
}

function fromAzmDiagnostics(diagnostics: readonly AzmDiagnosticLike[]): BuildDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
    message: diagnostic.message ?? 'unknown AZM diagnostic',
    sourceName: diagnostic.sourceName ?? '',
    ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
    ...(diagnostic.column !== undefined ? { column: diagnostic.column } : {}),
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
  }));
}

/**
 * Compile a `.glim` program end to end, in process: generate AZM, have
 * AZM infer and inject register contracts (checked at `--rc error`
 * strength, mon3 profile for MON-3 programs), assemble the annotated
 * file to `.hex`/`.bin`/`.d8.json`, and rewrite the debug map so block
 * bodies step in `.glim` source.
 *
 * This is the API a host (the CLI, Debug80) calls — it writes the
 * artifact files but never prints; all reporting comes back as values.
 */
export async function buildGlimmerProgram(
  entryPath: string,
  options: GlimmerBuildOptions = {},
): Promise<GlimmerBuildResult> {
  const warnings: string[] = [];

  const loaded = loadGlimmerProgram(entryPath);
  const loadDiagnostics = fromGlimmerDiagnostics(loaded.diagnostics, entryPath);
  if (loaded.program === null) {
    return { diagnostics: loadDiagnostics, warnings };
  }
  const program: GlimmerProgram = loaded.program;

  const generated = generateAzm(program, options.org === undefined ? {} : { org: options.org });
  if (generated.diagnostics.length > 0) {
    return { diagnostics: fromGlimmerDiagnostics(generated.diagnostics, entryPath), warnings };
  }

  const asmPath = path.resolve(
    options.outputPath ??
      path.join(
        path.dirname(entryPath),
        `${path.basename(entryPath, path.extname(entryPath))}.main.asm`,
      ),
  );
  writeFileSync(asmPath, generated.source);
  const stage = options.stage ?? 'build';
  if (stage === 'generate') {
    return { diagnostics: loadDiagnostics, artifacts: { asm: asmPath }, warnings };
  }

  // Pass 1: contract inference + checking; AZM returns the annotated
  // source as an artifact and we write it back over the generated file.
  const isTec1g = program.platform === 'tec1g-mon3';
  const checked = await compile(asmPath, {
    registerContracts: 'error',
    fixRegisterContracts: true,
    ...(isTec1g ? { registerContractsProfile: 'mon3' } : {}),
    skipAssembly: true,
  });
  const checkDiagnostics = [...loadDiagnostics, ...fromAzmDiagnostics(checked.diagnostics)];
  if (hasErrors(checkDiagnostics)) {
    return { diagnostics: checkDiagnostics, warnings };
  }
  for (const artifact of checked.artifacts) {
    if (artifact.kind === 'register-contracts-annotations') {
      for (const file of artifact.files) {
        writeFileSync(file.path, file.text);
      }
    }
  }
  if (stage === 'check') {
    return { diagnostics: checkDiagnostics, artifacts: { asm: asmPath }, warnings };
  }

  // Pass 2: assemble the annotated file. A separate pass matters —
  // injection changed the file, and the map's line numbers must agree
  // with the file as it now stands on disk.
  const base = asmPath.replace(/\.asm$/, '');
  const hexPath = `${base}.hex`;
  const binPath = `${base}.bin`;
  const d8Path = `${base}.d8.json`;
  const assembled = await compile(asmPath, {
    outputType: 'hex',
    emitHex: true,
    emitBin: true,
    emitD8m: true,
    d8mInputs: { hex: path.basename(hexPath), bin: path.basename(binPath) },
  });
  const diagnostics = [...checkDiagnostics, ...fromAzmDiagnostics(assembled.diagnostics)];
  if (hasErrors(diagnostics)) {
    return { diagnostics, warnings };
  }

  // Rewrite the map against the annotated asm, then write everything.
  const asmText = readFileSync(asmPath, 'utf8');
  const entryDir = path.dirname(entryPath);
  const outDir = path.dirname(asmPath);
  const entryBase = path.basename(entryPath);
  const mappingsResult = computeBlockMappings(
    asmText,
    mappableBlocks(program.effects, program.routines),
    entryBase,
    (declared) => path.relative(outDir, path.resolve(entryDir, declared ?? entryBase)) || entryBase,
  );
  warnings.push(...mappingsResult.warnings);

  let mappedSegments = 0;
  const artifacts: GlimmerBuildArtifacts = { asm: asmPath };
  for (const artifact of assembled.artifacts) {
    if (artifact.kind === 'hex') {
      writeFileSync(hexPath, artifact.text);
      artifacts.hex = hexPath;
    } else if (artifact.kind === 'bin') {
      writeFileSync(binPath, artifact.bytes);
      artifacts.bin = binPath;
    } else if (artifact.kind === 'd8m') {
      const map = artifact.json as unknown as D8Map;
      mappedSegments = rewriteD8Map(map, path.basename(asmPath), mappingsResult.mappings).moved;
      writeFileSync(d8Path, `${JSON.stringify(map, null, 2)}\n`);
      artifacts.d8 = d8Path;
    }
  }

  return { diagnostics, artifacts, mappedSegments, warnings };
}
