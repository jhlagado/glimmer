/**
 * AZM code generator.
 *
 * Turns a GlimmerProgram into a single generated AZM source file:
 * API equates, change-flag constants, state storage, the runtime loop,
 * binding polling, timer/ramp ticking, phase dispatch, wrapped user
 * blocks, frame rollover, and the profile library.
 *
 * Change-flag rollover: raises go to Raised0 (visible to later phases
 * this frame, merged at phase boundaries) or Next0 (deferred to next
 * frame) depending on whether any consumer's phase has already run —
 * computed per block at compile time, so every raise is delivered
 * exactly once and declaration order is never semantic.
 */

import type { CurveDecl, CurvePreset, EffectDecl, GlimmerDiagnostic, GlimmerProgram } from './model.js';
import { EFFECT_PHASES, FRAME_COUNT, TEC1G_KEY_CODES } from './model.js';

export interface GenerateOptions {
  /** Assembly origin for the generated program. Default: $4000. */
  org?: number;
  /** Base address for the placeholder system API jump table. Default: $8000. */
  apiBase?: number;
}

export interface GenerateResult {
  source: string;
  diagnostics: GlimmerDiagnostic[];
}

const DEFAULT_ORG = 0x4000;
const DEFAULT_API_BASE = 0x8000;

/** Placeholder system API entries for the generic profile. */
const API_NAMES = ['API_ReadKeys', 'API_DrawChar', 'API_FlushDisplay', 'API_InitDisplay'];

const PHASE_NUM: Record<string, number> = { derive: 0, logic: 1, render: 2 };

function hex(value: number, digits: number): string {
  return `$${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}

function bin8(value: number): string {
  return `%${value.toString(2).padStart(8, '0')}`;
}

function chgConst(cellName: string): string {
  return `CHG_${cellName.toUpperCase()}`;
}

/**
 * Namespace block-local labels ("_done") into ordinary globally unique
 * AZM labels ("Glim_ApplyIncrement_done"). Only labels defined inside the
 * block are rewritten. Line count is always preserved (part of the
 * label-anchored mapping contract).
 */
export function namespaceLocalLabels(body: string[], effectName: string): string[] {
  const localNames = new Set<string>();
  for (const line of body) {
    const def = /^\s*_([A-Za-z][A-Za-z0-9_]*):/.exec(line);
    if (def) localNames.add(def[1] as string);
  }
  if (localNames.size === 0) return body;
  return body.map((line) =>
    line.replace(
      /(^|[^A-Za-z0-9_])_([A-Za-z][A-Za-z0-9_]*)/g,
      (whole, prefix: string, name: string) =>
        localNames.has(name) ? `${prefix}Glim_${effectName}_${name}` : whole,
    ),
  );
}

export function generateAzm(
  program: GlimmerProgram,
  options: GenerateOptions = {},
): GenerateResult {
  const diagnostics: GlimmerDiagnostic[] = [];
  const org = options.org ?? DEFAULT_ORG;
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const isTec1g = program.platform === 'tec1g-mon3';

  // Flag-carrying cells: states, pulses, ramps, then FrameCount if any
  // block triggers on it. One change-flag byte in v0.2: at most 8.
  const frameCountUsed = program.effects.some((e) => e.depends.includes(FRAME_COUNT));
  const trackedCells = [
    ...program.states.map((s) => s.name),
    ...program.pulses.map((p) => p.name),
    ...program.ramps.map((r) => r.name),
    ...(frameCountUsed ? [FRAME_COUNT] : []),
  ];
  if (trackedCells.length > 8) {
    diagnostics.push({
      line: 0,
      message: `Changed0 is full: ${trackedCells.length} flag-carrying cells declared (states, pulses, ramps${frameCountUsed ? ', FrameCount' : ''}), v0 supports at most 8.`,
    });
    return { source: '', diagnostics };
  }
  const chgBit = new Map(trackedCells.map((name, index) => [name, index]));

  // Generic profile: key bits are assigned in order of first appearance.
  const keyBit = new Map<string, number>();
  if (!isTec1g) {
    for (const binding of program.bindings) {
      if (!keyBit.has(binding.key)) keyBit.set(binding.key, keyBit.size);
    }
    if (keyBit.size > 8) {
      diagnostics.push({
        line: 0,
        message: `Too many distinct keys: ${keyBit.size}, v0 supports at most 8 (one input byte).`,
      });
      return { source: '', diagnostics };
    }
  }

  // Rollover masks. For each flag, the earliest consumer phase decides
  // whether a raise from phase P is deliverable this frame (all consumers
  // strictly later) or defers whole to next frame (some consumer at or
  // before P — including same-phase, so declaration order is never
  // semantic). Uniform per raise: exactly-once delivery.
  const minConsumerPhase = new Map<string, number>();
  for (const effect of program.effects) {
    const p = PHASE_NUM[effect.phase] as number;
    for (const dep of effect.depends) {
      const prev = minConsumerPhase.get(dep);
      if (prev === undefined || p < prev) minConsumerPhase.set(dep, p);
    }
  }
  const raiseMasks = (effect: EffectDecl): { now: string[]; next: string[] } => {
    const p = PHASE_NUM[effect.phase] as number;
    const now: string[] = [];
    const next: string[] = [];
    for (const target of effect.updates) {
      if (!chgBit.has(target)) continue; // timer period cells carry no flag
      const consumer = minConsumerPhase.get(target);
      if (consumer !== undefined && consumer <= p) next.push(chgConst(target));
      else now.push(chgConst(target));
    }
    return { now, next };
  };
  const anySameFrameRaise = program.effects.some((e) => raiseMasks(e).now.length > 0);

  const effectsByPhase = new Map(
    EFFECT_PHASES.map((phase) => [phase, program.effects.filter((e) => e.phase === phase)]),
  );
  const hasPhase = (phase: string): boolean =>
    (effectsByPhase.get(phase as (typeof EFFECT_PHASES)[number]) ?? []).length > 0;

  const heldBindings = program.bindings.filter((b) => b.edge === 'held');
  const hasTick = program.timers.length > 0 || program.ramps.length > 0 || frameCountUsed;

  const out: string[] = [];
  const emit = (line = ''): void => {
    out.push(line);
  };
  const op = (text: string): void => {
    emit(`        ${text}`);
  };
  const raise = (mask: string, target: string): void => {
    op(`ld      a,(${target})`);
    op(`or      ${mask}`);
    op(`ld      (${target}),a`);
  };

  emit(`; Generated by Glimmer from program ${program.name}.`);
  emit('; Do not edit: regenerate from the Glimmer source.');
  if (isTec1g) {
    emit(';');
    emit('; Register contracts (the ;! comments) are inferred and injected');
    emit('; by AZM during the Glimmer build, using the same parameters');
    emit('; Debug80 uses: --contracts --rc error --reg-profile mon3.');
  }
  emit();
  op(`.org    ${hex(org, 4)}`);
  emit();

  if (isTec1g) {
    emit('; --- TEC-1G / MON-3 platform ---');
    emit(`${'ApiScanKeys'.padEnd(17)} .equ 16`);
    emit(`${'PortDigits'.padEnd(17)} .equ $01`);
    emit(`${'PortSegs'.padEnd(17)} .equ $02`);
    emit(`${'PortRow'.padEnd(17)} .equ $05`);
    emit(`${'PortRed'.padEnd(17)} .equ $06`);
    emit(`${'PortGreen'.padEnd(17)} .equ $F8`);
    emit(`${'PortBlue'.padEnd(17)} .equ $F9`);
    emit(`${'SpeakerBit'.padEnd(17)} .equ $80`);
    emit(`${'ScanDwellPeriod'.padEnd(17)} .equ 255`);
    emit(`${'COLOR_RED'.padEnd(17)} .equ $01`);
    emit(`${'COLOR_GREEN'.padEnd(17)} .equ $02`);
    emit(`${'COLOR_BLUE'.padEnd(17)} .equ $04`);
    emit(`${'COLOR_WHITE'.padEnd(17)} .equ $07`);
    emit();
    const usedKeys = [...new Set(program.bindings.map((b) => b.key))];
    if (usedKeys.length > 0) {
      emit('; --- MON-3 key codes ---');
      for (const key of usedKeys) {
        emit(`${key.padEnd(17)} .equ ${hex(TEC1G_KEY_CODES.get(key) ?? 0, 2)}`);
      }
      emit();
    }
  } else {
    emit('; --- system API (placeholder addresses) ---');
    API_NAMES.forEach((name, index) => {
      emit(`${name.padEnd(17)} .equ ${hex(apiBase + index * 3, 4)}`);
    });
    emit();
    if (keyBit.size > 0) {
      emit('; --- key bits ---');
      for (const [key, bit] of keyBit) {
        emit(`${`${key}_BIT`.padEnd(17)} .equ ${bit}`);
      }
      emit();
    }
  }

  emit('; --- change flags ---');
  for (const [name, bit] of chgBit) {
    emit(`${`${chgConst(name)}_BIT`.padEnd(17)} .equ ${bit}`);
  }
  for (const [name, bit] of chgBit) {
    emit(`${chgConst(name).padEnd(17)} .equ ${bin8(1 << bit)}`);
  }
  emit();

  emit('; --- block trigger masks ---');
  for (const effect of program.effects) {
    const mask = effect.depends.map(chgConst).join(' + ');
    emit(`${`GlimDep_${effect.name}`.padEnd(17)} .equ ${mask}`);
  }
  emit();

  emit('; --- state storage ---');
  for (const state of program.states) {
    const directive = state.type === 'word' ? '.dw' : '.db';
    emit(`${`${state.name}:`.padEnd(17)} ${directive} ${state.initial}`);
  }
  for (const pulse of program.pulses) {
    emit(`${`${pulse.name}:`.padEnd(17)} .db 0`);
  }
  for (const timer of program.timers) {
    const directive = timer.type === 'word' ? '.dw' : '.db';
    if (timer.once) {
      emit(`${`${timer.name}:`.padEnd(17)} ${directive} ${timer.initial}   ; one-shot countdown`);
    } else {
      emit(`${`${timer.name}:`.padEnd(17)} ${directive} ${timer.initial}   ; period (writable)`);
      emit(`${`Glim_${timer.name}_cnt:`.padEnd(17)} ${directive} ${timer.initial}`);
    }
  }
  for (const ramp of program.ramps) {
    emit(`${`${ramp.name}:`.padEnd(17)} .db ${ramp.steps - 1}   ; ramp progress, idle at terminal`);
  }
  if (frameCountUsed) {
    emit(`${`${FRAME_COUNT}:`.padEnd(17)} .db 0`);
  }
  if (!isTec1g) {
    emit(`${'PrevKeys:'.padEnd(17)} .db 0`);
  }
  if (isTec1g && heldBindings.length > 0) {
    emit(`${'Glim_HeldKey:'.padEnd(17)} .db $FF`);
    emit(`${'Glim_HeldCount:'.padEnd(17)} .db 0`);
  }
  const initialChanged = program.states
    .filter((state) => state.changedOnStart)
    .map((state) => 1 << (chgBit.get(state.name) as number))
    .reduce((acc, mask) => acc | mask, 0);
  emit(`${'Changed0:'.padEnd(17)} .db ${bin8(initialChanged)}   ; flags dispatch tests`);
  emit(`${'Raised0:'.padEnd(17)} .db 0   ; raises for later phases this frame`);
  emit(`${'Next0:'.padEnd(17)} .db 0   ; raises deferred to next frame`);
  if (isTec1g) {
    emit(`${'Framebuffer:'.padEnd(17)} .ds 32           ; 8 rows x R,G,B,aux`);
    emit(`${'SpeakerPort:'.padEnd(17)} .db 0`);
    emit(`${'SoundTimer:'.padEnd(17)} .db 0`);
    emit(`${'SndDivReload:'.padEnd(17)} .db 0`);
    emit(`${'SndDivCount:'.padEnd(17)} .db 0`);
    emit(`${'HudScanIndex:'.padEnd(17)} .db 0`);
    emit(`${'HudSegBuffer:'.padEnd(17)} .ds 6`);
  }
  emit();

  emit('; --- runtime loop ---');
  emit('@Start:');
  if (isTec1g) {
    op('call    FbClear');
    op('call    HudBlankDig');
    emit('MainLoop:');
    op('call    ScanFrame            ; show one full frame, then blank');
    op('call    __PollBindings       ; game work runs in the blank window');
  } else {
    op('call    API_InitDisplay');
    emit('MainLoop:');
    op('call    __PollBindings');
  }
  if (hasTick) {
    op('call    __TickTimers');
  }
  if (hasPhase('derive')) {
    op('call    __RunDeriveEffects');
    if (anySameFrameRaise && (hasPhase('logic') || hasPhase('render'))) {
      op('call    __MergeRaised');
    }
  }
  if (hasPhase('logic')) {
    op('call    __RunLogicEffects');
    if (anySameFrameRaise && hasPhase('render')) {
      op('call    __MergeRaised');
    }
  }
  if (hasPhase('render')) {
    op('call    __RunRenderEffects');
  }
  if (!isTec1g) {
    op('call    API_FlushDisplay');
  }
  op('call    __EndFrame');
  op('jp      MainLoop');
  emit();

  if (isTec1g) {
    emitTec1gPollBindings(program, heldBindings.length > 0, emit, op, raise);
  } else {
    emitPollBindings(program, emit, op);
  }

  if (hasTick) {
    emitTickTimers(program, frameCountUsed, emit, op, raise);
  }

  for (const phase of EFFECT_PHASES) {
    const effects = effectsByPhase.get(phase) ?? [];
    if (effects.length === 0) continue;
    emit(`; --- ${phase} phase dispatch ---`);
    emit(`@__Run${capitalize(phase)}Effects:`);
    for (const effect of effects) {
      op('ld      a,(Changed0)');
      op(`and     GlimDep_${effect.name}`);
      op(`jr      z,GlimSkip_${effect.name}`);
      op(`call    Glim_${effect.name}`);
      emit(`GlimSkip_${effect.name}:`);
    }
    op('ret');
    emit();
  }

  if (anySameFrameRaise && (hasPhase('logic') || hasPhase('render'))) {
    emit('; --- phase boundary: deliver same-frame raises ---');
    emit('@__MergeRaised:');
    op('ld      a,(Changed0)');
    op('ld      b,a');
    op('ld      a,(Raised0)');
    op('or      b');
    op('ld      (Changed0),a');
    op('xor     a');
    op('ld      (Raised0),a');
    op('ret');
    emit();
  }

  for (const effect of program.effects) {
    emitBlockWrapper(effect, raiseMasks(effect), emit, op);
  }

  emit('; --- frame rollover ---');
  emit('@__EndFrame:');
  op('xor     a');
  for (const pulse of program.pulses) {
    op(`ld      (${pulse.name}),a`);
  }
  op('ld      (Raised0),a');
  op('ld      a,(Next0)            ; deferred raises become next frame');
  op('ld      (Changed0),a');
  op('xor     a');
  op('ld      (Next0),a');
  op('ret');

  if (program.curves.length > 0) {
    emit();
    emitCurveResources(program.curves, emit, op);
  }

  if (isTec1g) {
    if (program.sounds.length > 0) {
      emit();
      emitSoundCues(program, emit, op);
    }
    emit();
    emitMatrixLibrary(emit, op);
  }

  return { source: `${out.join('\n')}\n`, diagnostics };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * tec1g-mon3 input polling via MON-3 _scanKeys (RST $10, C=16):
 * Z = key pressed (code in A), carry = new press. Rising bindings fire on
 * new presses only. Held bindings also autorepeat: the first press fires
 * and arms Glim_HeldKey/Glim_HeldCount; while the same key stays down,
 * the counter reloads and refires every `period` frames.
 */
function emitTec1gPollBindings(
  program: GlimmerProgram,
  hasHeld: boolean,
  emit: (line?: string) => void,
  op: (text: string) => void,
  raise: (mask: string, target: string) => void,
): void {
  emit('; --- input polling (MON-3 _scanKeys) ---');
  emit('@__PollBindings:');
  if (program.bindings.length === 0) {
    op('ret');
    emit();
    return;
  }
  op('ld      c,ApiScanKeys');
  op('rst     $10');
  if (hasHeld) {
    op('jr      z,__PollKeyDown');
    op('ld      a,$FF                ; no key: disarm autorepeat');
    op('ld      (Glim_HeldKey),a');
    op('ret');
    emit('__PollKeyDown:');
    op('ld      b,a                  ; B = key code (DE unsafe: matrix kbd)');
    op('jr      c,__PollNewPress');
    op('ld      a,(Glim_HeldKey)     ; held: autorepeat armed for this key?');
    op('cp      b');
    op('ret     nz');
    op('ld      a,(Glim_HeldCount)');
    op('dec     a');
    op('ld      (Glim_HeldCount),a');
    op('ret     nz');
    for (const binding of program.bindings) {
      if (binding.edge !== 'held') continue;
      const tag = `${binding.target}_${binding.key}`;
      op('ld      a,b');
      op(`cp      ${binding.key}`);
      op(`jr      nz,__HeldNext_${tag}`);
      op(`ld      a,${binding.period}`);
      op('ld      (Glim_HeldCount),a');
      op('ld      a,1');
      op(`ld      (${binding.target}),a`);
      raise(chgConst(binding.target), 'Changed0');
      op('ret');
      emit(`__HeldNext_${tag}:`);
    }
    op('ret');
    emit('__PollNewPress:');
  } else {
    op('ret     nz                   ; no key pressed');
    op('ret     nc                   ; key held, not a new press');
    op('ld      b,a                  ; B = key code (DE unsafe: matrix kbd)');
  }
  for (const binding of program.bindings) {
    const tag = `${binding.target}_${binding.key}`;
    op('ld      a,b');
    op(`cp      ${binding.key}`);
    op(`jr      nz,__NewNext_${tag}`);
    if (binding.edge === 'held') {
      op('ld      a,b                  ; arm autorepeat');
      op('ld      (Glim_HeldKey),a');
      op(`ld      a,${binding.period}`);
      op('ld      (Glim_HeldCount),a');
    }
    op('ld      a,1');
    op(`ld      (${binding.target}),a`);
    raise(chgConst(binding.target), 'Changed0');
    op('ret');
    emit(`__NewNext_${tag}:`);
  }
  op('ret');
  emit();
}

/** Generic-profile polling: PrevKeys edge detection on a key byte. */
function emitPollBindings(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit('; --- input polling ---');
  emit('@__PollBindings:');
  if (program.bindings.length === 0) {
    op('ret');
    emit();
    return;
  }
  op('call    API_ReadKeys');
  op('ld      b,a');
  emit();
  op('ld      a,(PrevKeys)          ; rising edge = now AND NOT before');
  op('cpl');
  op('and     b');
  op('ld      c,a');
  emit();
  op('ld      a,b');
  op('ld      (PrevKeys),a');
  emit();
  for (const binding of program.bindings) {
    op(`bit     ${binding.key}_BIT,c`);
    op(`jr      z,__NoPulse_${binding.target}_${binding.key}`);
    op('ld      a,1');
    op(`ld      (${binding.target}),a`);
    op('ld      a,(Changed0)');
    op(`or      ${chgConst(binding.target)}`);
    op('ld      (Changed0),a');
    emit(`__NoPulse_${binding.target}_${binding.key}:`);
  }
  op('ret');
  emit();
}

/**
 * Per-frame timing widgets. Runs in the input segment, before any phase,
 * so every raise lands in Changed0 and is seen by all phases this frame.
 */
function emitTickTimers(
  program: GlimmerProgram,
  frameCountUsed: boolean,
  emit: (line?: string) => void,
  op: (text: string) => void,
  raise: (mask: string, target: string) => void,
): void {
  emit('; --- timers, ramps, frame counter ---');
  emit('@__TickTimers:');
  if (frameCountUsed) {
    op(`ld      a,(${FRAME_COUNT})`);
    op('inc     a');
    op(`ld      (${FRAME_COUNT}),a`);
    raise(chgConst(FRAME_COUNT), 'Changed0');
  }
  for (const timer of program.timers) {
    const skip = `__TimerNext_${timer.name}`;
    if (timer.once) {
      if (timer.type === 'word') {
        op(`ld      hl,(${timer.name})`);
        op('ld      a,h');
        op('or      l');
        op(`jr      z,${skip}            ; idle`);
        op('dec     hl');
        op(`ld      (${timer.name}),hl`);
        op('ld      a,h');
        op('or      l');
        op(`jr      nz,${skip}`);
      } else {
        op(`ld      a,(${timer.name})`);
        op('or      a');
        op(`jr      z,${skip}            ; idle`);
        op('dec     a');
        op(`ld      (${timer.name}),a`);
        op(`jr      nz,${skip}`);
      }
    } else {
      if (timer.type === 'word') {
        op(`ld      hl,(Glim_${timer.name}_cnt)`);
        op('dec     hl');
        op(`ld      (Glim_${timer.name}_cnt),hl`);
        op('ld      a,h');
        op('or      l');
        op(`jr      nz,${skip}`);
        op(`ld      hl,(${timer.name})      ; reload from period cell`);
        op(`ld      (Glim_${timer.name}_cnt),hl`);
      } else {
        op(`ld      a,(Glim_${timer.name}_cnt)`);
        op('dec     a');
        op(`ld      (Glim_${timer.name}_cnt),a`);
        op(`jr      nz,${skip}`);
        op(`ld      a,(${timer.name})       ; reload from period cell`);
        op(`ld      (Glim_${timer.name}_cnt),a`);
      }
    }
    op('ld      a,1');
    op(`ld      (${timer.target}),a`);
    raise(chgConst(timer.target), 'Changed0');
    emit(`${skip}:`);
  }
  for (const ramp of program.ramps) {
    const skip = `__RampNext_${ramp.name}`;
    op(`ld      a,(${ramp.name})`);
    op(`cp      ${ramp.steps - 1}`);
    op(`jr      nc,${skip}           ; idle at terminal`);
    op('inc     a');
    op(`ld      (${ramp.name}),a`);
    raise(chgConst(ramp.name), 'Changed0');
    op(`ld      a,(${ramp.name})`);
    op(`cp      ${ramp.steps - 1}`);
    op(`jr      nz,${skip}`);
    op('ld      a,1                  ; arrived: fire completion');
    op(`ld      (${ramp.target}),a`);
    raise(chgConst(ramp.target), 'Changed0');
    emit(`${skip}:`);
  }
  op('ret');
  emit();
}

function emitBlockWrapper(
  effect: EffectDecl,
  masks: { now: string[]; next: string[] },
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit(`; --- ${effect.phase} block ${effect.name} ---`);
  emit(`@Glim_${effect.name}:`);
  for (const line of namespaceLocalLabels(effect.body, effect.name)) {
    emit(line);
  }
  if (masks.now.length > 0) {
    op('ld      a,(Raised0)          ; deliver to later phases this frame');
    op(`or      ${masks.now.join(' + ')}`);
    op('ld      (Raised0),a');
  }
  if (masks.next.length > 0) {
    op('ld      a,(Next0)            ; a consumer already ran: defer to next frame');
    op(`or      ${masks.next.join(' + ')}`);
    op('ld      (Next0),a');
  }
  op('ret');
  emit();
}

function emitCurveResources(
  curves: CurveDecl[],
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit('; --- curve resources ---');
  for (const curve of curves) {
    op('.align  256');
    emit(`Curve_${curve.name}:`);
    const values = buildCurveValues(curve);
    for (let i = 0; i < values.length; i += 16) {
      op(`.db     ${values.slice(i, i + 16).join(', ')}`);
    }
    emit();
  }
}

function buildCurveValues(curve: CurveDecl): number[] {
  return Array.from({ length: curve.steps }, (_, index) => {
    const t = curve.steps === 1 ? 1 : index / (curve.steps - 1);
    const eased = ease(curve.preset, t);
    return clampByte(Math.round(curve.from + eased * (curve.to - curve.from)));
  });
}

function ease(preset: CurvePreset, t: number): number {
  switch (preset) {
    case 'linear':
      return t;
    case 'ease_in':
      return t * t;
    case 'ease_out':
      return 1 - (1 - t) * (1 - t);
    case 'ease_in_out':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'sine':
      return (1 - Math.cos(Math.PI * t)) / 2;
    case 'overshoot': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    }
    case 'anticipation': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return c3 * t * t * t - c1 * t * t;
    }
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function emitSoundCues(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  if (program.sounds.length === 0) return;
  emit('; --- sound cues ---');
  emit('; Non-blocking matrix-profile cues. len is row ticks; div is the');
  emit('; speaker divider. Starting a cue replaces the currently active cue.');
  for (const sound of program.sounds) {
    emit(`@Snd_${sound.name}:`);
    op(`ld      a,${sound.len}`);
    op(`ld      c,${sound.div}`);
    op('jp      SndStart');
    emit();
  }
}

/**
 * Matrix profile library: whole-frame scanout with fixed row dwell plus
 * per-row sound and seven-segment HUD service, framebuffer helpers, the
 * speaker divider state machine, and HUD formatting. Modeled on the
 * corpus Tetro/Pacmo shared layer (0BSD).
 */
function emitMatrixLibrary(emit: (line?: string) => void, op: (text: string) => void): void {
  emit('; --- matrix8x8 profile library ---');
  emit();
  emit('; Scan all 8 rows with fixed dwell, then blank the matrix so');
  emit('; block work never changes visible row brightness. Sound and the');
  emit('; seven-segment HUD are serviced once per row (8 ticks per frame).');
  emit(';! clobbers  A,BC,DE,HL');
  emit('@ScanFrame:');
  op('ld      hl,Framebuffer');
  op('ld      c,%00000001          ; row select mask');
  emit('ScanFrameRow:');
  op('xor     a');
  op('out     (PortRow),a          ; blank before changing colour data');
  op('ld      a,(hl)');
  op('out     (PortRed),a');
  op('inc     hl');
  op('ld      a,(hl)');
  op('out     (PortGreen),a');
  op('inc     hl');
  op('ld      a,(hl)');
  op('out     (PortBlue),a');
  op('inc     hl');
  op('inc     hl                   ; skip aux byte');
  op('ld      a,c');
  op('out     (PortRow),a          ; enable row');
  op('push    bc');
  op('push    hl');
  op('call    SndService');
  op('call    HudScanDig');
  op('pop     hl');
  op('pop     bc');
  op('ld      b,ScanDwellPeriod');
  emit('ScanFrameDwell:');
  op('djnz    ScanFrameDwell');
  op('rlc     c');
  op('jr      nc,ScanFrameRow      ; carry after 8th rotate');
  op('xor     a');
  op('out     (PortRow),a          ; matrix blank on return');
  op('ret');
  emit();
  emit('; Convert x (0-7, 0 = leftmost) to the matrix bit convention.');
  emit(';! in A; out A; clobbers B');
  emit('@MxMask:');
  op('or      a');
  op('ld      b,a');
  op('ld      a,%10000000');
  op('ret     z');
  emit('MxMaskLp:');
  op('srl     a');
  op('djnz    MxMaskLp');
  op('ret');
  emit();
  emit('; Set one pixel. B = x (0-7), C = y (0-7), A = colour bits');
  emit('; (COLOR_RED/GREEN/BLUE, OR-combined). ORs into the framebuffer.');
  emit(';! in A,B,C; clobbers A,B,DE,HL');
  emit('@FbPlot:');
  op('ld      d,a                  ; D = colour bits');
  op('ld      a,c');
  op('add     a,a');
  op('add     a,a                  ; y * 4');
  op('ld      e,a');
  op('ld      a,b');
  op('call    MxMask               ; A = pixel mask');
  op('ld      b,a');
  op('ld      hl,Framebuffer');
  op('ld      a,l');
  op('add     a,e');
  op('ld      l,a');
  op('ld      a,h');
  op('adc     a,0');
  op('ld      h,a');
  op('srl     d');
  op('jr      nc,FbPlotGrn');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  emit('FbPlotGrn:');
  op('inc     hl');
  op('srl     d');
  op('jr      nc,FbPlotBlu');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  emit('FbPlotBlu:');
  op('inc     hl');
  op('srl     d');
  op('ret     nc');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  op('ret');
  emit();
  emit('; Clear the whole framebuffer.');
  emit(';! clobbers  A,B,HL');
  emit('@FbClear:');
  op('ld      hl,Framebuffer');
  op('ld      b,32');
  op('xor     a');
  emit('FbClearLp:');
  op('ld      (hl),a');
  op('inc     hl');
  op('djnz    FbClearLp');
  op('ret');
  emit();
  emit('; (Re)start a sound cue. A = duration in row ticks (8 per frame),');
  emit('; C = divider half-period; smaller is higher pitch.');
  emit(';! in A,C; clobbers A');
  emit('@SndStart:');
  op('ld      (SoundTimer),a');
  op('ld      a,c');
  op('ld      (SndDivReload),a');
  op('ld      (SndDivCount),a');
  op('xor     a');
  op('ld      (SpeakerPort),a');
  op('ret');
  emit();
  emit('; Tick the speaker state machine once per row scan.');
  emit(';! clobbers A');
  emit('@SndService:');
  op('ld      a,(SoundTimer)');
  op('or      a');
  op('ret     z');
  op('dec     a');
  op('ld      (SoundTimer),a');
  op('jr      nz,SndActive');
  op('xor     a');
  op('ld      (SpeakerPort),a');
  op('ld      (SndDivCount),a');
  op('ret');
  emit('SndActive:');
  op('ld      a,(SndDivCount)');
  op('dec     a');
  op('ld      (SndDivCount),a');
  op('ret     nz');
  op('ld      a,(SndDivReload)');
  op('ld      (SndDivCount),a');
  op('ld      a,(SpeakerPort)');
  op('xor     SpeakerBit');
  op('ld      (SpeakerPort),a');
  op('ret');
  emit();
  emit('; Strobe one seven-segment digit and advance the scan index.');
  emit(';! clobbers A,BC,DE,HL');
  emit('@HudScanDig:');
  op('ld      a,(HudScanIndex)');
  op('ld      c,a');
  op('ld      a,(SpeakerPort)');
  op('out     (PortDigits),a       ; digits off; keep speaker bit');
  op('ld      a,c');
  op('ld      l,a');
  op('ld      h,0');
  op('ld      de,HudSegBuffer');
  op('add     hl,de');
  op('ld      a,(hl)');
  op('out     (PortSegs),a');
  op('ld      a,c');
  op('ld      l,a');
  op('ld      h,0');
  op('ld      de,HudMaskTbl');
  op('add     hl,de');
  op('ld      a,(hl)');
  op('ld      b,a');
  op('ld      a,(SpeakerPort)');
  op('or      b');
  op('out     (PortDigits),a');
  op('ld      a,c');
  op('inc     a');
  op('cp      6');
  op('jr      c,HudScanSave');
  op('xor     a');
  emit('HudScanSave:');
  op('ld      (HudScanIndex),a');
  op('ret');
  emit();
  emit('; Zero all six HUD digits.');
  emit(';! clobbers A,B,HL');
  emit('@HudBlankDig:');
  op('ld      hl,HudSegBuffer');
  op('ld      b,6');
  op('xor     a');
  emit('HudBlankLp:');
  op('ld      (hl),a');
  op('inc     hl');
  op('djnz    HudBlankLp');
  op('ret');
  emit();
  emit('; Encode HL as decimal into the HUD: slot 0 shows 0, slots 1-5');
  emit('; the 10000..1 digits.');
  emit(';! in HL; out BC,HL; clobbers A,DE');
  emit('@HudWriteU16:');
  op('ld      a,(HudGlyphTbl)');
  op('ld      (HudSegBuffer),a');
  op('ld      bc,HudSegBuffer + 1');
  op('ld      de,10000');
  op('call    HudDecDigit');
  op('ld      de,1000');
  op('call    HudDecDigit');
  op('ld      de,100');
  op('call    HudDecDigit');
  op('ld      de,10');
  op('call    HudDecDigit');
  op('ld      de,1');
  op('call    HudDecDigit');
  op('ret');
  emit();
  emit('; One decimal place value: count DE out of HL, emit the glyph.');
  emit(';! in HL,DE,BC; out BC,HL; clobbers A,DE');
  emit('@HudDecDigit:');
  op('xor     a');
  emit('HudDecLp:');
  op('push    af');
  op('ld      a,h');
  op('cp      d');
  op('jr      c,HudDecDone');
  op('jr      nz,HudDecSub');
  op('ld      a,l');
  op('cp      e');
  op('jr      c,HudDecDone');
  emit('HudDecSub:');
  op('pop     af');
  op('or      a');
  op('sbc     hl,de');
  op('inc     a');
  op('jr      HudDecLp');
  emit('HudDecDone:');
  op('pop     af');
  op('push    hl');
  op('push    bc');
  op('ld      l,a');
  op('ld      h,0');
  op('ld      de,HudGlyphTbl');
  op('add     hl,de');
  op('ld      a,(hl)');
  op('pop     bc');
  op('ld      (bc),a');
  op('inc     bc');
  op('pop     hl');
  op('ret');
  emit();
  emit('HudMaskTbl:');
  op('.db     $20, $10, $08, $04, $02, $01');
  emit('HudGlyphTbl:');
  op('.db     $EB, $28, $CD, $AD, $2E, $A7, $E7, $29');
  op('.db     $EF, $2F, $6F, $E6, $C3, $EC, $C7, $47');
}
