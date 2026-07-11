/**
 * The generic v0 profile: placeholder API equates, PrevKeys edge
 * detection on one input byte, poll -> phases -> flush.
 */

import type { GlimmerProgram } from '../model.js';
import { hex } from '../emit.js';
import type { Profile, ProfileContext } from './types.js';

/** Placeholder system API entries for the generic profile. */
const API_NAMES = ['API_ReadKeys', 'API_DrawChar', 'API_FlushDisplay', 'API_InitDisplay'];

/** Generic-profile polling: PrevKeys edge detection on a key byte. */
function emitPollBindings(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
  raiseChanged: (cellName: string) => void,
): void {
  emit('; --- input polling ---');
  emit('.routine');
  emit('GlimPollBindings:');
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
    op(`jr      z,_skip_${binding.target}_${binding.key}`);
    op('ld      a,1');
    op(`ld      (${binding.target}),a`);
    raiseChanged(binding.target);
    emit(`_skip_${binding.target}_${binding.key}:`);
  }
  op('ret');
  emit();
}

export const genericProfile: Profile = {
  name: 'generic',
  headerNote(): string[] {
    return [];
  },
  emitEquates({ emit, keyBit, apiBase }: ProfileContext): void {
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
  },
  emitInputStorage({ emit }: ProfileContext): void {
    emit(`${'PrevKeys:'.padEnd(17)} .db 0`);
  },
  emitServiceStorage(): void {},
  emitDataTables(): void {},
  emitLoopInit({ op }: ProfileContext): void {
    op('call    API_InitDisplay');
  },
  emitFrameStart({ op }: ProfileContext): void {
    op('call    GlimPollBindings');
  },
  emitFrameEnd({ op }: ProfileContext): void {
    op('call    API_FlushDisplay');
  },
  emitPollBindings({ program, emit, op, raiseChanged }: ProfileContext): void {
    emitPollBindings(program, emit, op, raiseChanged);
  },
  emitTail(): void {},
};
