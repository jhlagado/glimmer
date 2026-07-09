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

import type { EffectDecl } from './model.js';

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

/**
 * Locate every block body in the final generated asm text. The asm is
 * scanned as written to disk — after AZM contract injection — so line
 * numbers agree with the `.d8.json` produced from that same file. Bodies
 * are verified verbatim; a block that does not match is skipped with a
 * warning rather than mapped wrongly.
 */
export function computeBlockMappings(
  asmText: string,
  effects: readonly EffectDecl[],
  entryGlimFile: string,
  glimFileKey: (declaredFile: string | undefined) => string = (file): string =>
    file ?? entryGlimFile,
): BlockMappingsResult {
  const lines = asmText.split('\n');
  const mappings: BlockLineMapping[] = [];
  const warnings: string[] = [];

  for (const effect of effects) {
    const label = `@Glim_${effect.name}:`;
    const labelIndex = lines.findIndex((line) => line.trimEnd() === label);
    if (labelIndex === -1) {
      warnings.push(`block ${effect.name}: label ${label} not found in generated asm.`);
      continue;
    }
    // Contract comments are injected adjacent to @ labels; skip any that
    // landed between the label and the verbatim body.
    let start = labelIndex + 1;
    while (start < lines.length && (lines[start] ?? '').startsWith(';!')) start += 1;

    const matches = effect.body.every((bodyLine, k) => lines[start + k] === bodyLine);
    if (!matches) {
      warnings.push(`block ${effect.name}: body is not verbatim at ${label}; not mapped.`);
      continue;
    }
    if (effect.body.length === 0) continue;
    mappings.push({
      name: effect.name,
      asmLine: start + 1,
      lineCount: effect.body.length,
      glimFile: glimFileKey(effect.file),
      glimLine: effect.bodyLine,
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
