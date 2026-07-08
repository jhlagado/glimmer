/**
 * Multi-file program loading.
 *
 * The entry file declares the program, platform, and display, and names
 * its parts (`part "input.glim"`). Every part contributes declarations
 * to the same program and namespace — merge semantics, not textual
 * inclusion. Part paths resolve relative to the entry file's directory.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ParseResult, ParsedUnit } from './parse.js';
import { assembleProgram, parseUnit } from './parse.js';

export interface LoadOptions {
  /** Override file reading (tests). Receives an absolute path. */
  readFile?: (absPath: string) => string;
}

export function loadGlimmerProgram(entryPath: string, options: LoadOptions = {}): ParseResult {
  const read = options.readFile ?? ((absPath: string) => readFileSync(absPath, 'utf8'));
  const entryDir = path.dirname(entryPath);
  const entryName = path.basename(entryPath);

  let entrySource: string;
  try {
    entrySource = read(path.resolve(entryPath));
  } catch (cause) {
    return {
      program: null,
      diagnostics: [{ line: 0, message: `Cannot read ${entryPath}: ${(cause as Error).message}` }],
    };
  }

  const entryUnit = parseUnit(entrySource, { kind: 'entry', file: entryName });
  const units: ParsedUnit[] = [entryUnit];
  const seen = new Set<string>();

  for (const part of entryUnit.parts) {
    if (!part.path.endsWith('.glim')) {
      entryUnit.diagnostics.push({
        line: part.line,
        message: `Part "${part.path}" must be a .glim file.`,
        file: entryName,
      });
      continue;
    }
    const absPart = path.resolve(entryDir, part.path);
    if (seen.has(absPart)) {
      entryUnit.diagnostics.push({
        line: part.line,
        message: `Part "${part.path}" is declared more than once.`,
        file: entryName,
      });
      continue;
    }
    seen.add(absPart);
    let partSource: string;
    try {
      partSource = read(absPart);
    } catch (cause) {
      entryUnit.diagnostics.push({
        line: part.line,
        message: `Cannot read part "${part.path}": ${(cause as Error).message}`,
        file: entryName,
      });
      continue;
    }
    units.push(parseUnit(partSource, { kind: 'part', file: part.path }));
  }

  return assembleProgram(units);
}
