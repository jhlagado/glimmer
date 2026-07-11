/**
 * MON-3 keypad input, shared by every TEC-1G profile regardless of
 * display: _scanKeys polling (rising edges from the carry flag, held
 * autorepeat from the zero flag), the API and key-code equates, and
 * the held-binding scratch cells.
 */

import type { Binding, GlimmerProgram } from '../model.js';
import { TEC1G_KEY_CODES } from '../model.js';
import { hex } from '../emit.js';

export function emitMon3ApiEquates(emit: (line?: string) => void): void {
  emit(`${'ApiScanKeys'.padEnd(17)} .equ 16`);
  emit(`${'ApiRandom'.padEnd(17)} .equ 49   ; A = random byte, destroys B`);
}

export function emitMon3KeyCodeEquates(
  program: GlimmerProgram,
  emit: (line?: string) => void,
): void {
  const usedKeys = [...new Set(program.bindings.map((b) => b.key))].filter((k) => k !== 'any');
  if (usedKeys.length > 0) {
    emit('; --- MON-3 key codes ---');
    for (const key of usedKeys) {
      emit(`${key.padEnd(17)} .equ ${hex(TEC1G_KEY_CODES.get(key) ?? 0, 2)}`);
    }
    emit();
  }
}

/** LCD equates, string data, and the lcd_row op — emitted when the
 * program declares text resources. The LCD is board hardware, shared
 * by every TEC-1G display profile. */
export function emitMon3LcdEquates(emit: (line?: string) => void): void {
  emit('; --- MON-3 LCD (board hardware) ---');
  emit(`${'ApiStringToLcd'.padEnd(17)} .equ 13   ; HL = string; destroys A,HL`);
  emit(`${'ApiCharToLcd'.padEnd(17)} .equ 14   ; A = character`);
  emit(`${'ApiCommandToLcd'.padEnd(17)} .equ 15   ; B = instruction byte`);
  emit(`${'LcdRow1'.padEnd(17)} .equ $80`);
  emit(`${'LcdRow2'.padEnd(17)} .equ $C0`);
  emit(`${'LcdRow3'.padEnd(17)} .equ $94`);
  emit(`${'LcdRow4'.padEnd(17)} .equ $D4`);
  emit();
}

export function emitMon3TextData(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  if (program.texts.length === 0) return;
  emit('; --- text resources (zero-terminated LCD strings) ---');
  for (const text of program.texts) {
    emit(`${text.name}:`);
    op(`.db     "${text.value}", 0`);
  }
  emit();
}

export function emitMon3LcdOps(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  if (program.texts.length === 0) return;
  emit();
  emit('; Position the LCD cursor at a row command, then write a string.');
  emit('op lcd_row(msg imm16, row imm8)');
  op('ld      b,row');
  op('ld      c,ApiCommandToLcd');
  op('rst     $10');
  op('ld      hl,msg');
  op('ld      c,ApiStringToLcd');
  op('rst     $10');
  emit('end');
}

export function emitMon3HeldStorage(emit: (line?: string) => void, heldBindings: Binding[]): void {
  if (heldBindings.length > 0) {
    emit(`${'Glim_HeldKey:'.padEnd(17)} .db $FF`);
    emit(`${'Glim_HeldCount:'.padEnd(17)} .db 0`);
  }
}

/**
 * tec1g-mon3 input polling via MON-3 _scanKeys (RST $10, C=16):
 * Z = key pressed (code in A), carry = new press. Rising bindings fire on
 * new presses only. Held bindings also autorepeat: the first press fires
 * and arms Glim_HeldKey/Glim_HeldCount; while the same key stays down,
 * the counter reloads and refires every `period` frames.
 */
export function emitTec1gPollBindings(
  program: GlimmerProgram,
  hasHeld: boolean,
  emit: (line?: string) => void,
  op: (text: string) => void,
  raiseChanged: (cellName: string) => void,
): void {
  emit('; --- input polling (MON-3 _scanKeys) ---');
  emit('.routine');
  emit('GlimPollBindings:');
  if (program.bindings.length === 0) {
    op('ret');
    emit();
    return;
  }
  op('ld      c,ApiScanKeys');
  op('rst     $10');
  if (hasHeld) {
    op('jr      z,_keydown');
    op('ld      a,$FF                ; no key: disarm autorepeat');
    op('ld      (Glim_HeldKey),a');
    op('ret');
    emit('_keydown:');
    op('ld      b,a                  ; B = key code (DE unsafe: matrix kbd)');
    op('jr      c,_newpress');
    op('ld      a,(Glim_HeldKey)     ; held: autorepeat armed for this key?');
    op('cp      b');
    op('ret     nz');
    op('ld      a,(Glim_HeldCount)');
    op('dec     a');
    op('ld      (Glim_HeldCount),a');
    op('ret     nz');
    for (const binding of program.bindings) {
      if (binding.edge !== 'held' || binding.key === 'any') continue;
      const tag = `${binding.target}_${binding.key}`;
      op('ld      a,b');
      op(`cp      ${binding.key}`);
      op(`jr      nz,_held_${tag}`);
      op(`ld      a,${binding.period}`);
      op('ld      (Glim_HeldCount),a');
      op('ld      a,1');
      op(`ld      (${binding.target}),a`);
      raiseChanged(binding.target);
      op('ret');
      emit(`_held_${tag}:`);
    }
    op('ret');
    emit('_newpress:');
  } else {
    op('ret     nz                   ; no key pressed');
    op('ret     nc                   ; key held, not a new press');
    op('ld      b,a                  ; B = key code (DE unsafe: matrix kbd)');
  }
  for (const binding of program.bindings) {
    if (binding.key !== 'any') continue;
    // any-key fires on every new press, alongside any named binding.
    op(`ld      a,1                  ; any key`);
    op(`ld      (${binding.target}),a`);
    raiseChanged(binding.target);
  }
  for (const binding of program.bindings) {
    if (binding.key === 'any') continue;
    const tag = `${binding.target}_${binding.key}`;
    op('ld      a,b');
    op(`cp      ${binding.key}`);
    op(`jr      nz,_new_${tag}`);
    if (binding.edge === 'held') {
      op('ld      a,b                  ; arm autorepeat');
      op('ld      (Glim_HeldKey),a');
      op(`ld      a,${binding.period}`);
      op('ld      (Glim_HeldCount),a');
    }
    op('ld      a,1');
    op(`ld      (${binding.target}),a`);
    raiseChanged(binding.target);
    op('ret');
    emit(`_new_${tag}:`);
  }
  op('ret');
  emit();
}
