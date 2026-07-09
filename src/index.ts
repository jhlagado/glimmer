/**
 * Glimmer public API.
 *
 * Glimmer is a preprocessor for AZM: it compiles a structured program
 * (state cells, pulses, timing widgets, resources, bindings and Z80 blocks)
 * into a single generated AZM source file.
 */

export type {
  Binding,
  CellType,
  CurveDecl,
  CurvePreset,
  EffectDecl,
  EffectPhase,
  GlimmerDiagnostic,
  GlimmerProgram,
  KeyBinding,
  Phase,
  PulseDecl,
  RampDecl,
  ShapeColor,
  ShapeDecl,
  SoundDecl,
  StateDecl,
  TimerDecl,
} from './model.js';
export { EFFECT_PHASES, PHASES } from './model.js';
export {
  assembleProgram,
  parseGlimmer,
  parseUnit,
  type ParsedUnit,
  type ParseResult,
} from './parse.js';
export { loadGlimmerProgram, type LoadOptions } from './load.js';
export { generateAzm, type GenerateOptions, type GenerateResult } from './generate.js';
export {
  computeBlockMappings,
  rewriteD8Map,
  type BlockLineMapping,
  type BlockMappingsResult,
  type D8Map,
} from './build.js';

import type { GlimmerDiagnostic } from './model.js';
import { generateAzm, type GenerateOptions } from './generate.js';
import { parseGlimmer } from './parse.js';

export interface CompileResult {
  /** Generated AZM source, or null when diagnostics contain errors. */
  source: string | null;
  diagnostics: GlimmerDiagnostic[];
}

/** Compile Glimmer meta-source text to AZM source text. */
export function compileToAzm(glimSource: string, options: GenerateOptions = {}): CompileResult {
  const parsed = parseGlimmer(glimSource);
  if (parsed.program === null) {
    return { source: null, diagnostics: parsed.diagnostics };
  }
  const generated = generateAzm(parsed.program, options);
  if (generated.diagnostics.length > 0) {
    return { source: null, diagnostics: generated.diagnostics };
  }
  return { source: generated.source, diagnostics: [] };
}
