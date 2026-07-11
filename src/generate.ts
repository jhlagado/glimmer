/**
 * AZM code generator.
 *
 * Turns a GlimmerProgram into a single generated AZM source file:
 * API equates, change-flag constants, state storage, the runtime loop,
 * binding polling, timer/ramp ticking, phase dispatch, wrapped user
 * blocks, frame rollover, and the profile library.
 *
 * Change-flag rollover: raises go to RaisedN (visible to later phases
 * this frame, merged at phase boundaries) or NextN (deferred to next
 * frame) depending on whether any consumer's phase has already run —
 * computed per block at compile time, so every raise is delivered
 * exactly once and declaration order is never semantic.
 */

import type {
  CurveDecl,
  CurvePreset,
  EffectDecl,
  GlimmerDiagnostic,
  GlimmerProgram,
} from './model.js';
import { EFFECT_PHASES, CURRENT_CARD, FRAME_COUNT } from './model.js';
import { bin8, hex } from './emit.js';
import { profileFor } from './profiles/index.js';
import type { ProfileContext } from './profiles/types.js';

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
const MAX_CHANGE_FLAG_BANKS = 4;
const CHANGE_FLAGS_PER_BANK = 8;

const PHASE_NUM: Record<string, number> = { derive: 0, logic: 1, render: 2 };

interface ChangeFlagInfo {
  bank: number;
  bit: number;
}

type BankedMasks = Map<number, string[]>;

function chgConst(cellName: string): string {
  return `CHG_${cellName.toUpperCase()}`;
}

/** Map a .glim field type to its AZM layout-field directive. */
function fieldDirective(fieldType: string): string {
  if (fieldType === 'byte') return '.byte';
  if (fieldType === 'word') return '.word';
  if (fieldType === 'addr') return '.addr';
  return `.field ${fieldType}`;
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
  // block triggers on it. v0.3 allocates up to four 8-bit banks.
  const frameCountUsed = program.effects.some((e) => e.depends.includes(FRAME_COUNT));
  const hasCards = program.cards.length > 0;
  const trackedCells = [
    ...program.states.map((s) => s.name),
    ...program.pulses.map((p) => p.name),
    ...program.ramps.map((r) => r.name),
    ...(hasCards ? [CURRENT_CARD] : []),
    ...(frameCountUsed ? [FRAME_COUNT] : []),
  ];
  const maxTrackedCells = MAX_CHANGE_FLAG_BANKS * CHANGE_FLAGS_PER_BANK;
  if (trackedCells.length > maxTrackedCells) {
    diagnostics.push({
      line: 0,
      message: `Change flags are full: ${trackedCells.length} flag-carrying cells declared (states, pulses, ramps${frameCountUsed ? ', FrameCount' : ''}), v0.3 supports at most ${maxTrackedCells}.`,
    });
    return { source: '', diagnostics };
  }
  const bankCount = Math.max(1, Math.ceil(trackedCells.length / CHANGE_FLAGS_PER_BANK));
  const bankIndexes = Array.from({ length: bankCount }, (_, bank) => bank);
  const chgInfo = new Map(
    trackedCells.map((name, index): [string, ChangeFlagInfo] => [
      name,
      { bank: Math.floor(index / CHANGE_FLAGS_PER_BANK), bit: index % CHANGE_FLAGS_PER_BANK },
    ]),
  );
  const flagInfo = (name: string): ChangeFlagInfo => chgInfo.get(name) as ChangeFlagInfo;
  const bankLabel = (kind: 'Changed' | 'Raised' | 'Next', bank: number): string => `${kind}${bank}`;
  const depMaskName = (effect: EffectDecl, bank: number): string =>
    `GlimDep_${effect.name}__B${bank}`;
  const addBankMask = (banked: BankedMasks, bank: number, mask: string): void => {
    const masks = banked.get(bank);
    if (masks === undefined) {
      banked.set(bank, [mask]);
      return;
    }
    if (!masks.includes(mask)) masks.push(mask);
  };
  const groupMasksByBank = (names: string[]): BankedMasks => {
    const grouped: BankedMasks = new Map();
    for (const name of names) {
      const info = chgInfo.get(name);
      if (info === undefined) continue;
      addBankMask(grouped, info.bank, chgConst(name));
    }
    return grouped;
  };
  const sortedMaskEntries = (masks: BankedMasks): Array<[number, string[]]> =>
    [...masks.entries()].sort(([a], [b]) => a - b);

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
  const raiseMasks = (effect: EffectDecl): { now: BankedMasks; next: BankedMasks } => {
    const p = PHASE_NUM[effect.phase] as number;
    const now: BankedMasks = new Map();
    const next: BankedMasks = new Map();
    for (const target of effect.updates) {
      const info = chgInfo.get(target);
      if (info === undefined) continue; // timer period cells carry no flag
      const consumer = minConsumerPhase.get(target);
      const masks = consumer !== undefined && consumer <= p ? next : now;
      addBankMask(masks, info.bank, chgConst(target));
    }
    return { now, next };
  };
  const anySameFrameRaise = program.effects.some((e) => raiseMasks(e).now.size > 0);

  // Enter blocks run before the card's other effects in their phase, so
  // entry setup is visible to the rest of the frame.
  const effectsByPhase = new Map(
    EFFECT_PHASES.map((phase) => [
      phase,
      [
        ...program.effects.filter((e) => e.phase === phase && e.enter === true),
        ...program.effects.filter((e) => e.phase === phase && e.enter !== true),
      ],
    ]),
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
  const raiseChanged = (cellName: string): void => {
    const info = flagInfo(cellName);
    raise(chgConst(cellName), bankLabel('Changed', info.bank));
  };
  const profile = profileFor(program);
  const ctx: ProfileContext = {
    program,
    emit,
    op,
    raiseChanged,
    heldBindings,
    keyBit,
    apiBase,
    diagnostic: (line, message) => {
      diagnostics.push({ line, message });
    },
  };

  emit(`; Generated by Glimmer from program ${program.name}.`);
  emit('; Do not edit: regenerate from the Glimmer source.');
  for (const line of profile.headerNote()) {
    emit(line);
  }
  emit();
  op(`.org    ${hex(org, 4)}`);
  emit();
  if (isTec1g) {
    emit('; Register contracts are declared with .routine and checked at');
    emit('; strict strength over this whole generated file.');
    op('.contracts strict');
  } else {
    emit('; The generic profile calls placeholder API addresses with no');
    emit('; bodies to analyse, so contracts audit instead of failing.');
    op('.contracts audit');
  }
  emit();

  profile.emitEquates(ctx);

  emit('; --- change flags ---');
  for (const [name, info] of chgInfo) {
    emit(`${`${chgConst(name)}_BIT`.padEnd(17)} .equ ${info.bit}`);
  }
  for (const [name, info] of chgInfo) {
    emit(`${chgConst(name).padEnd(17)} .equ ${bin8(1 << info.bit)}`);
  }
  emit();

  emit('; --- block trigger masks ---');
  for (const effect of program.effects) {
    for (const [bank, masks] of sortedMaskEntries(groupMasksByBank(effect.depends))) {
      emit(`${depMaskName(effect, bank).padEnd(17)} .equ ${masks.join(' + ')}`);
    }
  }
  emit();

  if (hasCards) {
    emit('; --- cards ---');
    emit('; Exactly one card is active; CurrentCard holds it. Blocks in a');
    emit("; card's section dispatch only while it is active.");
    emit(`${'Card'.padEnd(17)} .enum ${program.cards.map((card) => card.name).join(', ')}`);
    emit();
  }

  if (program.types.length > 0) {
    emit('; --- layout types ---');
    emit('; AZM owns the type system: sizeof, offset, and layout casts');
    emit('; work on these names in block bodies.');
    for (const type of program.types) {
      if (type.alias !== undefined) {
        emit(`${type.name.padEnd(17)} .typealias ${type.alias}`);
        continue;
      }
      emit(`${type.name} .type`);
      for (const field of type.fields) {
        emit(`    ${field.name.padEnd(13)} ${fieldDirective(field.type)}`);
      }
      emit('.endtype');
    }
    emit();
  }

  emit('; --- state storage ---');
  for (const state of program.states) {
    if (state.typeName !== undefined) {
      const typeExpr =
        state.length !== undefined ? `${state.typeName}[${state.length}]` : state.typeName;
      emit(`${`${state.name}:`.padEnd(17)} .ds ${typeExpr}, 0   ; typed state`);
      continue;
    }
    if (state.length !== undefined) {
      emit(`${`${state.name}:`.padEnd(17)} .ds ${state.length}, 0   ; byte array`);
      continue;
    }
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
  if (hasCards) {
    const first = program.cards[0]?.name as string;
    emit(
      `${`${CURRENT_CARD}:`.padEnd(17)} .db Card.${first}   ; writable next card, starts changed`,
    );
    emit(`${'GlimActiveCard:'.padEnd(17)} .db Card.${first}   ; frame-latched card all gates test`);
    emit(
      `${'GlimPrevCard:'.padEnd(17)} .db $FF          ; enter edge detector ($FF = before any card)`,
    );
  }
  if (frameCountUsed) {
    emit(`${`${FRAME_COUNT}:`.padEnd(17)} .db 0`);
  }
  profile.emitInputStorage(ctx);
  const initialChanged = Array.from({ length: bankCount }, () => 0);
  for (const state of program.states) {
    if (!state.changedOnStart) continue;
    const info = flagInfo(state.name);
    initialChanged[info.bank] = (initialChanged[info.bank] ?? 0) | (1 << info.bit);
  }
  if (hasCards) {
    // CurrentCard starts changed: the first card's enter blocks run on
    // the first frame.
    const info = flagInfo(CURRENT_CARD);
    initialChanged[info.bank] = (initialChanged[info.bank] ?? 0) | (1 << info.bit);
  }
  for (const bank of bankIndexes) {
    emit(
      `${`${bankLabel('Changed', bank)}:`.padEnd(17)} .db ${bin8(initialChanged[bank] ?? 0)}   ; flags dispatch tests`,
    );
  }
  for (const bank of bankIndexes) {
    emit(
      `${`${bankLabel('Raised', bank)}:`.padEnd(17)} .db 0   ; raises for later phases this frame`,
    );
  }
  for (const bank of bankIndexes) {
    emit(`${`${bankLabel('Next', bank)}:`.padEnd(17)} .db 0   ; raises deferred to next frame`);
  }
  profile.emitServiceStorage(ctx);
  emit();

  // Data tables live here, ahead of the code: plain labels are
  // file-level under AZM 0.3, but keeping every shared table above the
  // first routine keeps the layout readable and the map stable.
  if (program.curves.length > 0) {
    emitCurveResources(program.curves, emit, op);
  }
  profile.emitDataTables(ctx);

  emit('; --- runtime loop ---');
  emit('Start:');
  profile.emitLoopInit(ctx);
  emit('MainLoop:');
  profile.emitFrameStart(ctx);
  if (hasCards) {
    op(`ld      a,(${CURRENT_CARD})    ; latch: card transitions land at`);
    op('ld      (GlimActiveCard),a  ; frame start, never mid-frame');
  }
  if (hasTick) {
    op('call    GlimTickTimers');
  }
  if (hasPhase('derive')) {
    op('call    GlimRunDeriveEffects');
    if (anySameFrameRaise && (hasPhase('logic') || hasPhase('render'))) {
      op('call    GlimMergeRaised');
    }
  }
  if (hasPhase('logic')) {
    op('call    GlimRunLogicEffects');
    if (anySameFrameRaise && hasPhase('render')) {
      op('call    GlimMergeRaised');
    }
  }
  if (hasPhase('render')) {
    op('call    GlimRunRenderEffects');
  }
  profile.emitFrameEnd(ctx);
  op('call    GlimEndFrame');
  op('jp      MainLoop');
  emit();

  profile.emitPollBindings(ctx);

  if (hasTick) {
    emitTickTimers(program, frameCountUsed, emit, op, raiseChanged);
  }

  for (const phase of EFFECT_PHASES) {
    const effects = effectsByPhase.get(phase) ?? [];
    if (effects.length === 0) continue;
    emit(`; --- ${phase} phase dispatch ---`);
    emit('.routine');
    emit(`GlimRun${capitalize(phase)}Effects:`);
    let pendingPrevSync = effects.some((e) => e.enter === true);
    for (const effect of effects) {
      if (pendingPrevSync && effect.enter !== true) {
        // All enters for this phase have dispatched: remember the card
        // they saw, so only genuine transitions re-run them.
        op('ld      a,(GlimActiveCard)');
        op('ld      (GlimPrevCard),a');
        pendingPrevSync = false;
      }
      if (effect.card !== undefined) {
        // Card gate against the frame-latched card: a goto (or a
        // conditional CurrentCard write) earlier in this frame must not
        // let the destination card's blocks run before its enters.
        op('ld      a,(GlimActiveCard)');
        op(`cp      Card.${effect.card}`);
        op(`jr      nz,_skip_${effect.name}`);
      }
      if (effect.enter === true && effect.card !== undefined) {
        // Edge gate: enter runs on a transition into the card, not on
        // every CurrentCard mark (conditional navigation writes the
        // cell without switching cards).
        op('ld      a,(GlimPrevCard)');
        op(`cp      Card.${effect.card}`);
        op(`jr      z,_skip_${effect.name}`);
      }
      const depMasks = sortedMaskEntries(groupMasksByBank(effect.depends));
      if (depMasks.length === 1) {
        const [bank] = depMasks[0] as [number, string[]];
        op(`ld      a,(${bankLabel('Changed', bank)})`);
        op(`and     ${depMaskName(effect, bank)}`);
        op(`jr      z,_skip_${effect.name}`);
        op(`call    Glim_${effect.name}`);
        emit(`_skip_${effect.name}:`);
        continue;
      }
      for (const [bank] of depMasks) {
        op(`ld      a,(${bankLabel('Changed', bank)})`);
        op(`and     ${depMaskName(effect, bank)}`);
        op(`jr      nz,_run_${effect.name}`);
      }
      op(`jr      _skip_${effect.name}`);
      emit(`_run_${effect.name}:`);
      op(`call    Glim_${effect.name}`);
      emit(`_skip_${effect.name}:`);
    }
    if (pendingPrevSync) {
      op('ld      a,(GlimActiveCard)');
      op('ld      (GlimPrevCard),a');
    }
    op('ret');
    emit();
  }

  if (anySameFrameRaise && (hasPhase('logic') || hasPhase('render'))) {
    emit('; --- phase boundary: deliver same-frame raises ---');
    emit('.routine');
    emit('GlimMergeRaised:');
    for (const bank of bankIndexes) {
      op(`ld      a,(${bankLabel('Changed', bank)})`);
      op('ld      b,a');
      op(`ld      a,(${bankLabel('Raised', bank)})`);
      op('or      b');
      op(`ld      (${bankLabel('Changed', bank)}),a`);
    }
    op('xor     a');
    for (const bank of bankIndexes) {
      op(`ld      (${bankLabel('Raised', bank)}),a`);
    }
    op('ret');
    emit();
  }

  for (const effect of program.effects) {
    emitBlockWrapper(effect, raiseMasks(effect), emit, op);
  }

  for (const routine of program.routines) {
    emit(`; --- routine ${routine.name} ---`);
    emit('.routine');
    emit(`${routine.name}:`);
    // Verbatim body, same contract as blocks: falls through, the
    // wrapper appends the ret; the bare .routine has AZM infer the
    // register contract from the body.
    for (const line of routine.body) {
      emit(line);
    }
    op('ret');
    emit();
  }

  emit('; --- frame rollover ---');
  emit('.routine');
  emit('GlimEndFrame:');
  op('xor     a');
  for (const pulse of program.pulses) {
    op(`ld      (${pulse.name}),a`);
  }
  for (const bank of bankIndexes) {
    op(`ld      (${bankLabel('Raised', bank)}),a`);
  }
  for (const bank of bankIndexes) {
    op(`ld      a,(${bankLabel('Next', bank)})            ; deferred raises become next frame`);
    op(`ld      (${bankLabel('Changed', bank)}),a`);
  }
  op('xor     a');
  for (const bank of bankIndexes) {
    op(`ld      (${bankLabel('Next', bank)}),a`);
  }
  op('ret');

  if (program.imports.length > 0) {
    emit();
    emit('; --- imported AZM modules ---');
    emit('; Import names resolve program-wide; bytes land here, outside');
    emit("; every execution path. @ labels are the modules' public API.");
    const importPaths = [...new Set(program.imports.map((imp) => imp.path))];
    for (const importPath of importPaths) {
      op(`.import "${importPath}"`);
    }
  }

  profile.emitTail(ctx);

  return { source: `${out.join('\n')}\n`, diagnostics };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Per-frame timing widgets. Runs in the input segment, before any phase,
 * so every raise lands in its target cell's ChangedN bank and is seen by
 * all phases this frame.
 */
function emitTickTimers(
  program: GlimmerProgram,
  frameCountUsed: boolean,
  emit: (line?: string) => void,
  op: (text: string) => void,
  raiseChanged: (cellName: string) => void,
): void {
  emit('; --- timers, ramps, frame counter ---');
  emit('.routine');
  emit('GlimTickTimers:');
  if (frameCountUsed) {
    op(`ld      a,(${FRAME_COUNT})`);
    op('inc     a');
    op(`ld      (${FRAME_COUNT}),a`);
    raiseChanged(FRAME_COUNT);
  }
  for (const timer of program.timers) {
    const skip = `_next_${timer.name}`;
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
    raiseChanged(timer.target);
    emit(`${skip}:`);
  }
  for (const ramp of program.ramps) {
    const skip = `_next_${ramp.name}`;
    op(`ld      a,(${ramp.name})`);
    op(`cp      ${ramp.steps - 1}`);
    op(`jr      nc,${skip}           ; idle at terminal`);
    op('inc     a');
    op(`ld      (${ramp.name}),a`);
    raiseChanged(ramp.name);
    op(`ld      a,(${ramp.name})`);
    op(`cp      ${ramp.steps - 1}`);
    op(`jr      nz,${skip}`);
    op('ld      a,1                  ; arrived: fire completion');
    op(`ld      (${ramp.target}),a`);
    raiseChanged(ramp.target);
    emit(`${skip}:`);
  }
  op('ret');
  emit();
}

function emitBlockWrapper(
  effect: EffectDecl,
  masks: { now: BankedMasks; next: BankedMasks },
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit(`; --- ${effect.enter === true ? 'enter' : effect.phase} block ${effect.name} ---`);
  emit('.routine');
  emit(`Glim_${effect.name}:`);
  // The body is emitted byte-for-byte verbatim. Under AZM 0.3, _name
  // labels are local to the block's entry label, so two blocks may
  // both define _done without colliding; plain labels in a body are
  // file-level and would truncate the routine. Verbatim bodies are
  // part of the label-anchored source-mapping contract.
  for (const line of effect.body) {
    emit(line);
  }
  if (effect.goto !== undefined) {
    op(`ld      a,Card.${effect.goto}      ; goto ${effect.goto}`);
    op(`ld      (${CURRENT_CARD}),a`);
  }
  for (const [bank, bankMasks] of [...masks.now.entries()].sort(([a], [b]) => a - b)) {
    op(`ld      a,(Raised${bank})          ; deliver to later phases this frame`);
    op(`or      ${bankMasks.join(' + ')}`);
    op(`ld      (Raised${bank}),a`);
  }
  for (const [bank, bankMasks] of [...masks.next.entries()].sort(([a], [b]) => a - b)) {
    op(`ld      a,(Next${bank})            ; a consumer already ran: defer to next frame`);
    op(`or      ${bankMasks.join(' + ')}`);
    op(`ld      (Next${bank}),a`);
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
