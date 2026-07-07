/**
 * Glimmer program model.
 *
 * A Glimmer program is the structured source that the generator turns into
 * AZM: state cells, pulses, input bindings, and effects whose bodies are
 * plain Z80 fragments (snippets of real assembly, one per effect).
 *
 * See docs/glimmer.md for the full design rationale.
 */

export type CellType = 'byte' | 'word';

export interface StateDecl {
  name: string;
  type: CellType;
  initial: number;
  changedOnStart: boolean;
  line: number;
}

export interface PulseDecl {
  name: string;
  line: number;
}

/** v0 supports rising-edge key bindings onto pulses. */
export interface KeyBinding {
  kind: 'key';
  key: string;
  edge: 'rising';
  target: string;
  line: number;
}

export type Binding = KeyBinding;

export const PHASES = ['input', 'derive', 'logic', 'render', 'commit', 'cleanup'] as const;

export type Phase = (typeof PHASES)[number];

/** Phases that user effects may declare (input/commit/cleanup are runtime-owned). */
export const EFFECT_PHASES = ['derive', 'logic', 'render'] as const;

export type EffectPhase = (typeof EFFECT_PHASES)[number];

export interface EffectDecl {
  name: string;
  phase: EffectPhase;
  /** State/pulse names whose change flags trigger this effect ("on" clauses). */
  depends: string[];
  /** State names marked changed after this effect runs ("updates" clauses). */
  updates: string[];
  /** Raw Z80 body lines, verbatim between begin/end. */
  body: string[];
  line: number;
}

export interface GlimmerProgram {
  name: string;
  /** Platform profile, e.g. 'tec1g-mon3'. Null = generic v0 profile. */
  platform: string | null;
  /** Display profile, e.g. 'matrix8x8'. Requires a platform. */
  display: string | null;
  states: StateDecl[];
  pulses: PulseDecl[];
  bindings: Binding[];
  effects: EffectDecl[];
}

/** MON-3 _scanKeys key codes for the tec1g-mon3 platform. */
export const TEC1G_KEY_CODES: ReadonlyMap<string, number> = new Map([
  ...Array.from({ length: 16 }, (_, i): [string, number] => [
    `KEY_${i.toString(16).toUpperCase()}`,
    i,
  ]),
  ['KEY_PLUS', 0x10],
  ['KEY_MINUS', 0x11],
  ['KEY_GO', 0x12],
  ['KEY_AD', 0x13],
]);

export interface GlimmerDiagnostic {
  /** 1-based source line, or 0 for file-level diagnostics. */
  line: number;
  message: string;
}
