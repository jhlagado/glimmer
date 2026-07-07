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

/**
 * Key bindings onto pulses. `rising` fires on the frame the key is first
 * pressed; `held` also autorepeats every `period` frames while held
 * (tec1g-mon3 profile only).
 */
export interface KeyBinding {
  kind: 'key';
  key: string;
  edge: 'rising' | 'held';
  /** Autorepeat period in frames; present only when edge is 'held'. */
  period?: number;
  target: string;
  line: number;
}

export type Binding = KeyBinding;

/**
 * A timer counts down once per frame and fires its pulse.
 * Oscillator form: the cell is the (writable) period; a hidden countdown
 * reloads from it after each fire. `once` form: the cell IS the countdown;
 * it fires once when it reaches zero and stays idle until rewritten.
 */
export interface TimerDecl {
  name: string;
  type: CellType;
  initial: number;
  target: string;
  once: boolean;
  line: number;
}

/**
 * A ramp is a monostable progress counter: while its cell is below
 * steps-1 it increments once per frame, marking the cell changed each
 * step, and fires its pulse on reaching steps-1. Idle at steps-1;
 * retriggered by writing the cell (usually to 0).
 */
export interface RampDecl {
  name: string;
  steps: number;
  target: string;
  line: number;
}

/** Built-in cell: increments every frame; usable in `on` when needed. */
export const FRAME_COUNT = 'FrameCount';

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
  timers: TimerDecl[];
  ramps: RampDecl[];
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
