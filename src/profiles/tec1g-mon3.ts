/**
 * The tec1g-mon3 matrix8x8 profile: the CPU is the display controller.
 * ScanFrame shows one full frame with fixed row dwell (servicing sound
 * and the seven-segment HUD once per row), then blanks the matrix; all
 * game work runs in the blank window. Render blocks write the
 * framebuffer the scanner reads. Modeled on the corpus Tetro/Pacmo
 * shared layer (0BSD).
 */

import type { GlimmerProgram, ShapeColor, ShapeDecl } from '../model.js';
import { bin8 } from '../emit.js';
import {
  emitMon3ApiEquates,
  emitMon3HeldStorage,
  emitMon3KeyCodeEquates,
  emitMon3LcdEquates,
  emitMon3LcdOps,
  emitMon3TextData,
  emitTec1gPollBindings,
} from './mon3-input.js';
import type { Profile, ProfileContext } from './types.js';

function emitShapeResources(
  shapes: ShapeDecl[],
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit('; --- shape resources ---');
  emit('; Table format: width, height, colour, then left-aligned row masks.');
  for (const shape of shapes) {
    emit(`Shape_${shape.name}:`);
    op(`.db     ${shape.width}, ${shape.height}, ${shapeColorSymbol(shape.color)}`);
    for (const row of shape.rows) {
      op(`.db     ${bin8(shapeRowMask(row))}`);
    }
    emit();
  }
}

function shapeColorSymbol(color: ShapeColor): string {
  return `COLOR_${color.toUpperCase()}`;
}

function shapeRowMask(row: string): number {
  let mask = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === 'X') mask |= 0x80 >> i;
  }
  return mask;
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
    emit('.routine');
    emit(`Snd_${sound.name}:`);
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
function emitMatrixLibrary(
  hasShapes: boolean,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit('; --- matrix8x8 profile library ---');
  emit();
  emit('; Scan all 8 rows with fixed dwell, then blank the matrix so');
  emit('; block work never changes visible row brightness. Sound and the');
  emit('; seven-segment HUD are serviced once per row (8 ticks per frame).');
  emit('.routine clobbers A,BC,DE,HL');
  emit('ScanFrame:');
  op('ld      hl,Framebuffer');
  op('ld      c,%00000001          ; row select mask');
  emit('_row:');
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
  emit('_dwell:');
  op('djnz    _dwell');
  op('rlc     c');
  op('jr      nc,_row      ; carry after 8th rotate');
  op('xor     a');
  op('out     (PortRow),a          ; matrix blank on return');
  op('ret');
  emit();
  emit('; Convert x (0-7, 0 = leftmost) to the matrix bit convention.');
  emit('.routine in A out A clobbers B');
  emit('MxMask:');
  op('or      a');
  op('ld      b,a');
  op('ld      a,%10000000');
  op('ret     z');
  emit('_loop:');
  op('srl     a');
  op('djnz    _loop');
  op('ret');
  emit();
  emit('; Set one pixel. B = x (0-7), C = y (0-7), A = colour bits');
  emit('; (COLOR_RED/GREEN/BLUE, OR-combined). ORs into the framebuffer.');
  emit('.routine in A,B,C clobbers A,B,DE,HL');
  emit('FbPlot:');
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
  op('jr      nc,_green');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  emit('_green:');
  op('inc     hl');
  op('srl     d');
  op('jr      nc,_blue');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  emit('_blue:');
  op('inc     hl');
  op('srl     d');
  op('ret     nc');
  op('ld      a,(hl)');
  op('or      b');
  op('ld      (hl),a');
  op('ret');
  emit();
  if (hasShapes) {
    emit('; Draw a shape resource. HL = Shape_<Name>, B = x, C = y.');
    emit('; No clipping: keep the whole shape inside the 8x8 matrix.');
    emit('.routine in B,C,HL clobbers A,BC,DE,HL');
    emit('ShapeDraw:');
    op('ld      (ShapePtr),hl');
    op('ld      a,b');
    op('ld      (ShapeBaseX),a');
    op('ld      a,c');
    op('ld      (ShapeBaseY),a');
    op('ld      a,(hl)');
    op('ld      (ShapeWidth),a');
    op('inc     hl');
    op('ld      a,(hl)');
    op('ld      (ShapeHeight),a');
    op('inc     hl');
    op('ld      a,(hl)');
    op('ld      (ShapeColor),a');
    op('inc     hl');
    op('ld      (ShapePtr),hl');
    op('xor     a');
    op('ld      (ShapeRowIndex),a');
    emit('_row:');
    op('ld      a,(ShapeRowIndex)');
    op('ld      b,a');
    op('ld      a,(ShapeHeight)');
    op('cp      b');
    op('ret     z');
    op('ld      hl,(ShapePtr)');
    op('ld      a,(hl)');
    op('ld      (ShapeRowMask),a');
    op('inc     hl');
    op('ld      (ShapePtr),hl');
    op('xor     a');
    op('ld      (ShapeColIndex),a');
    emit('_col:');
    op('ld      a,(ShapeColIndex)');
    op('ld      b,a');
    op('ld      a,(ShapeWidth)');
    op('cp      b');
    op('jr      z,_nextrow');
    op('ld      a,(ShapeRowMask)');
    op('bit     7,a');
    op('jr      z,_skip');
    op('ld      a,(ShapeBaseX)');
    op('ld      b,a');
    op('ld      a,(ShapeColIndex)');
    op('add     a,b');
    op('ld      b,a');
    op('ld      a,(ShapeBaseY)');
    op('ld      c,a');
    op('ld      a,(ShapeRowIndex)');
    op('add     a,c');
    op('ld      c,a');
    op('ld      a,(ShapeColor)');
    op('call    FbPlot');
    emit('_skip:');
    op('ld      a,(ShapeRowMask)');
    op('add     a,a');
    op('ld      (ShapeRowMask),a');
    op('ld      a,(ShapeColIndex)');
    op('inc     a');
    op('ld      (ShapeColIndex),a');
    op('jr      _col');
    emit('_nextrow:');
    op('ld      a,(ShapeRowIndex)');
    op('inc     a');
    op('ld      (ShapeRowIndex),a');
    op('jr      _row');
    emit();
  }
  emit('; Clear the whole framebuffer.');
  emit('.routine clobbers A,B,HL');
  emit('FbClear:');
  op('ld      hl,Framebuffer');
  op('ld      b,32');
  op('xor     a');
  emit('_loop:');
  op('ld      (hl),a');
  op('inc     hl');
  op('djnz    _loop');
  op('ret');
  emit();
  emit('; (Re)start a sound cue. A = duration in row ticks (8 per frame),');
  emit('; C = divider half-period; smaller is higher pitch.');
  emit('.routine in A,C clobbers A');
  emit('SndStart:');
  op('ld      (SoundTimer),a');
  op('ld      a,c');
  op('ld      (SndDivReload),a');
  op('ld      (SndDivCount),a');
  op('xor     a');
  op('ld      (SpeakerPort),a');
  op('ret');
  emit();
  emit('; Tick the speaker state machine once per row scan.');
  emit('.routine clobbers A');
  emit('SndService:');
  op('ld      a,(SoundTimer)');
  op('or      a');
  op('ret     z');
  op('dec     a');
  op('ld      (SoundTimer),a');
  op('jr      nz,_active');
  op('xor     a');
  op('ld      (SpeakerPort),a');
  op('ld      (SndDivCount),a');
  op('ret');
  emit('_active:');
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
  emit('.routine clobbers A,BC,DE,HL');
  emit('HudScanDig:');
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
  op('jr      c,_save');
  op('xor     a');
  emit('_save:');
  op('ld      (HudScanIndex),a');
  op('ret');
  emit();
  emit('; Zero all six HUD digits.');
  emit('.routine clobbers A,B,HL');
  emit('HudBlankDig:');
  op('ld      hl,HudSegBuffer');
  op('ld      b,6');
  op('xor     a');
  emit('_loop:');
  op('ld      (hl),a');
  op('inc     hl');
  op('djnz    _loop');
  op('ret');
  emit();
  emit('; Encode HL as decimal into the HUD: slot 0 shows 0, slots 1-5');
  emit('; the 10000..1 digits.');
  emit('.routine in HL out BC,HL clobbers A,DE');
  emit('HudWriteU16:');
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
  emit('.routine in HL,DE,BC out BC,HL clobbers A,DE');
  emit('HudDecDigit:');
  op('xor     a');
  emit('_loop:');
  op('push    af');
  op('ld      a,h');
  op('cp      d');
  op('jr      c,_done');
  op('jr      nz,_sub');
  op('ld      a,l');
  op('cp      e');
  op('jr      c,_done');
  emit('_sub:');
  op('pop     af');
  op('or      a');
  op('sbc     hl,de');
  op('inc     a');
  op('jr      _loop');
  emit('_done:');
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
}

function emitHudTables(emit: (line?: string) => void, op: (text: string) => void): void {
  emit('; --- HUD data tables ---');
  emit('HudMaskTbl:');
  op('.db     $20, $10, $08, $04, $02, $01');
  emit('HudGlyphTbl:');
  op('.db     $EB, $28, $CD, $AD, $2E, $A7, $E7, $29');
  op('.db     $EF, $2F, $6F, $E6, $C3, $EC, $C7, $47');
  emit();
}

/**
 * Rotational shapes compile to the corpus piece-engine tables: 4-row
 * bitmaps per distinct rotation (padded with empty rows), a pointer
 * table of 4 entries per shape (aliases repeat pointers), a
 * right-bound table, a colour table, and a ShapeId_<Name> equate per
 * shape in declaration order.
 */
function emitRotationalShapeResources(
  shapes: ShapeDecl[],
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  emit('; --- rotational shape resources ---');
  emit('; Table layout matches the corpus piece engine: index a shape by');
  emit('; ShapeId_<Name>, a rotation entry by id*4 + rotation.');
  for (const shape of shapes) {
    shape.rotations?.distinct.forEach((rotation, index) => {
      emit(`ShapeRot_${shape.name}_${index}:`);
      for (let row = 0; row < 4; row += 1) {
        const mask =
          rotation.rows[row] === undefined ? 0 : shapeRowMask(rotation.rows[row] as string);
        op(`.db     ${bin8(mask)}`);
      }
    });
  }
  emit('ShapeRotPtrTable:');
  for (const shape of shapes) {
    const map = shape.rotations?.map ?? [0, 0, 0, 0];
    op(`.dw     ${map.map((k) => `ShapeRot_${shape.name}_${k}`).join(', ')}`);
  }
  emit('ShapeRotRightTbl:');
  for (const shape of shapes) {
    const rotations = shape.rotations;
    if (rotations === undefined) continue;
    op(`.db     ${rotations.map.map((k) => rotations.distinct[k]?.right ?? 0).join(',')}`);
  }
  emit('ShapeRotColorTbl:');
  for (const shape of shapes) {
    op(`.db     ${shapeColorSymbol(shape.color)}`);
  }
  shapes.forEach((shape, id) => {
    emit(`${`ShapeId_${shape.name}`.padEnd(17)} .equ ${id}`);
  });
  emit(`${'ShapeRotCount'.padEnd(17)} .equ ${shapes.length}`);
  emit();
}

export const tec1gMatrixProfile: Profile = {
  name: 'tec1g-mon3/matrix8x8',
  headerNote(): string[] {
    return [
      ';',
      '; Register contracts are declared with .routine and checked by',
      '; AZM at strict strength (mon3 register profile) during the',
      '; Glimmer build.',
    ];
  },
  emitEquates({ program, emit }: ProfileContext): void {
    emit('; --- TEC-1G / MON-3 platform ---');
    emitMon3ApiEquates(emit);
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
    emit(`${'COLOR_YELLOW'.padEnd(17)} .equ COLOR_RED + COLOR_GREEN`);
    emit(`${'COLOR_CYAN'.padEnd(17)} .equ COLOR_GREEN + COLOR_BLUE`);
    emit(`${'COLOR_MAGENTA'.padEnd(17)} .equ COLOR_RED + COLOR_BLUE`);
    emit(`${'COLOR_WHITE'.padEnd(17)} .equ $07`);
    emit();
    if (program.texts.length > 0) {
      emitMon3LcdEquates(emit);
    }
    emitMon3KeyCodeEquates(program, emit);
  },
  emitInputStorage({ emit, heldBindings }: ProfileContext): void {
    emitMon3HeldStorage(emit, heldBindings);
  },
  emitServiceStorage({ program, emit }: ProfileContext): void {
    const plainShapes = program.shapes.filter((s) => s.rotations === undefined);
    emit(`${'Framebuffer:'.padEnd(17)} .ds 32           ; 8 rows x R,G,B,aux`);
    emit(`${'SpeakerPort:'.padEnd(17)} .db 0`);
    emit(`${'SoundTimer:'.padEnd(17)} .db 0`);
    emit(`${'SndDivReload:'.padEnd(17)} .db 0`);
    emit(`${'SndDivCount:'.padEnd(17)} .db 0`);
    emit(`${'HudScanIndex:'.padEnd(17)} .db 0`);
    emit(`${'HudSegBuffer:'.padEnd(17)} .ds 6`);
    if (plainShapes.length > 0) {
      emit(`${'ShapePtr:'.padEnd(17)} .dw 0`);
      emit(`${'ShapeBaseX:'.padEnd(17)} .db 0`);
      emit(`${'ShapeBaseY:'.padEnd(17)} .db 0`);
      emit(`${'ShapeWidth:'.padEnd(17)} .db 0`);
      emit(`${'ShapeHeight:'.padEnd(17)} .db 0`);
      emit(`${'ShapeColor:'.padEnd(17)} .db 0`);
      emit(`${'ShapeRowMask:'.padEnd(17)} .db 0`);
      emit(`${'ShapeRowIndex:'.padEnd(17)} .db 0`);
      emit(`${'ShapeColIndex:'.padEnd(17)} .db 0`);
    }
  },
  emitDataTables({ program, emit, op }: ProfileContext): void {
    emitMon3TextData(program, emit, op);
    const plainShapes = program.shapes.filter((s) => s.rotations === undefined);
    const rotShapes = program.shapes.filter((s) => s.rotations !== undefined);
    if (plainShapes.length > 0) {
      emitShapeResources(plainShapes, emit, op);
    }
    if (rotShapes.length > 0) {
      emitRotationalShapeResources(rotShapes, emit, op);
    }
    emitHudTables(emit, op);
  },
  emitLoopInit({ op }: ProfileContext): void {
    op('call    FbClear');
    op('call    HudBlankDig');
  },
  emitFrameStart({ op }: ProfileContext): void {
    op('call    ScanFrame            ; show one full frame, then blank');
    op('call    GlimPollBindings     ; game work runs in the blank window');
  },
  emitFrameEnd(): void {},
  emitPollBindings({ program, emit, op, raiseChanged, heldBindings }: ProfileContext): void {
    emitTec1gPollBindings(program, heldBindings.length > 0, emit, op, raiseChanged);
  },
  emitTail({ program, emit, op }: ProfileContext): void {
    if (program.sounds.length > 0) {
      emit();
      emitSoundCues(program, emit, op);
    }
    emit();
    emitMatrixLibrary(
      program.shapes.some((s) => s.rotations === undefined),
      emit,
      op,
    );
    emitMon3LcdOps(program, emit, op);
  },
};
