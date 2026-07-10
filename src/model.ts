/**
 * Glimmer program model.
 *
 * A Glimmer program is the structured source that the generator turns into
 * AZM: state cells, pulses, timing widgets, input bindings, resources,
 * and blocks whose bodies are plain Z80 fragments.
 *
 * See docs/glimmer.md for the full design rationale.
 */

export type CellType = 'byte' | 'word';

export interface StateDecl {
  name: string;
  type: CellType;
  /**
   * Present when the cell is typed with a declared layout type
   * (state Name : TypeName). Storage is a typed `.ds`; `type` and
   * `initial` do not apply.
   */
  typeName?: string;
  /** Present for arrays: state Name : byte[N] or TypeName[N]. */
  length?: number;
  initial: number;
  changedOnStart: boolean;
  line: number;
}

/** One field of a layout type; mirrors an AZM `.type` field. */
export interface TypeFieldDecl {
  name: string;
  /**
   * Field type as written: 'byte' | 'word' | 'addr', a positive byte
   * count, or a type expression (TypeName or TypeName[N]).
   */
  type: string;
  line: number;
}

/**
 * A layout type, compiled to an AZM Book 0 `.type` record (or
 * `.typealias` for the alias form). Glimmer names the layout; AZM owns
 * the type system — `sizeof`, `offset`, and layout casts work on these
 * in verbatim block bodies.
 */
export interface TypeDecl {
  name: string;
  /** Alias form (type Name = Expr) — emitted as `.typealias`. */
  alias?: string;
  fields: TypeFieldDecl[];
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

/** Non-blocking matrix-profile sound cue: row-tick duration + pitch divider. */
export interface SoundDecl {
  name: string;
  len: number;
  div: number;
  line: number;
}

export type ShapeColor = 'red' | 'green' | 'blue' | 'yellow' | 'cyan' | 'magenta' | 'white';

/** Matrix-profile pixel art. Rows use X for set pixels and . for empty pixels. */
export interface ShapeDecl {
  name: string;
  color: ShapeColor;
  rows: string[];
  width: number;
  height: number;
  line: number;
}

export type CurvePreset =
  'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'sine' | 'overshoot' | 'anticipation';

/** Build-time byte lookup table for ramp-driven motion or envelopes. */
export interface CurveDecl {
  name: string;
  preset: CurvePreset;
  steps: number;
  from: number;
  to: number;
  line: number;
}

/** Built-in cell: increments every frame; usable in `on` when needed. */
export const FRAME_COUNT = 'FrameCount';

/**
 * Built-in cell holding the active card, present when a program
 * declares cards. Writable (usually via `goto`), triggerable in `on`;
 * its generated enum is `Card` (`Card.Splash`, ...).
 */
export const CURRENT_CARD = 'CurrentCard';

/**
 * A card: a screen/mode in the HyperCard sense — exactly one is active.
 * A `card` line starts a section; blocks after it belong to that card
 * until the next card line or end of file.
 */
export interface CardDecl {
  name: string;
  line: number;
}

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
  /** 1-based source line of the first body line (the line after `begin`). */
  bodyLine: number;
  /** Source file the block was declared in (set when units are merged). */
  file?: string;
  /** Card whose section the block was declared in; dispatch is gated on it. */
  card?: string;
  /** True for `enter` blocks: runs once when CurrentCard becomes `card`. */
  enter?: boolean;
  /** Card transition after the block runs (`goto` in the header). */
  goto?: string;
}

/**
 * A callable helper block (sketch proposal P5): no triggers, no
 * dispatch — a named routine that effects call with ordinary `call`.
 * Emitted as a public `@Name:` boundary; AZM infers its register
 * contract like any other routine.
 */
export interface RoutineDecl {
  name: string;
  /** Raw Z80 body lines, verbatim between begin/end. */
  body: string[];
  line: number;
  /** 1-based source line of the first body line (the line after `begin`). */
  bodyLine: number;
  /** Source file the routine was declared in (set when units are merged). */
  file?: string;
}

export interface GlimmerProgram {
  name: string;
  /** Platform profile, e.g. 'tec1g-mon3'. Null = generic v0 profile. */
  platform: string | null;
  /** Display profile, e.g. 'matrix8x8'. Requires a platform. */
  display: string | null;
  types: TypeDecl[];
  states: StateDecl[];
  pulses: PulseDecl[];
  timers: TimerDecl[];
  ramps: RampDecl[];
  sounds: SoundDecl[];
  curves: CurveDecl[];
  shapes: ShapeDecl[];
  bindings: Binding[];
  effects: EffectDecl[];
  routines: RoutineDecl[];
  cards: CardDecl[];
  imports: ImportDecl[];
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
  /** Source file the diagnostic belongs to (multi-file programs). */
  file?: string;
}

/** An AZM module brought into the generated program via .import. */
export interface ImportDecl {
  path: string;
  line: number;
}
