/**
 * The tec1g-mon3 tms9918 profile (TEC-Deck video card): a display you
 * write to. The VDP renders autonomously from its own VRAM; the
 * generated loop paces on the vblank status flag, and a commit phase
 * flushes shadow tables to VRAM at the top of each frame — render
 * blocks write ordinary memory (the name-table and sprite-attribute
 * shadows) and never touch VDP timing. Idioms from the corpus VDP
 * demos (corpus/tms9918): register-table init, address-then-stream
 * writes through the data port.
 *
 * First-slice contracts:
 * - Graphics I, canonical VRAM layout (pattern $0000, name $0800,
 *   sprite attrs $1B00, colour $2000, sprite patterns $3800).
 * - Sprites use contiguous slots from 0; VdpInit hides all 32 (Y=$D1,
 *   which also terminates sprite processing at the first unused slot).
 * - Name-table dirty tracking is per row (24 bits); a NamePut marks
 *   its row, commit streams only dirty rows.
 * - Pattern/colour uploads (tiles, sprite patterns) are one-time init
 *   work: call the Vdp* routines from an enter block, with the tables
 *   in an imported AZM module.
 */

import type { GlimmerProgram, SpriteDecl, TileDecl, VdpColor } from '../model.js';
import { bin8 } from '../emit.js';
import type { Profile, ProfileContext } from './types.js';

const VC_NAME: Record<VdpColor, string> = {
  transparent: 'VC_TRANSPARENT',
  black: 'VC_BLACK',
  medgreen: 'VC_MEDGREEN',
  lightgreen: 'VC_LIGHTGREEN',
  darkblue: 'VC_DARKBLUE',
  lightblue: 'VC_LIGHTBLUE',
  darkred: 'VC_DARKRED',
  cyan: 'VC_CYAN',
  medred: 'VC_MEDRED',
  lightred: 'VC_LIGHTRED',
  darkyellow: 'VC_DARKYELLOW',
  lightyellow: 'VC_LIGHTYELLOW',
  darkgreen: 'VC_DARKGREEN',
  magenta: 'VC_MAGENTA',
  gray: 'VC_GRAY',
  white: 'VC_WHITE',
};

function rowMask(row: string): number {
  let mask = 0;
  for (let col = 0; col < row.length; col += 1) {
    if (row[col] === 'X') mask |= 0x80 >> col;
  }
  return mask;
}

/**
 * Graphics I colours patterns in groups of eight, so tiles are grouped
 * by their (fg, bg) pair. Tile index 0 stays the blank tile; the first
 * pair's tiles fill group 0 from index 1, and its background is the
 * screen background for empty cells. A pair whose group is full spills
 * into a new group.
 */
export function assignTileIndexes(tiles: readonly TileDecl[]): {
  indexes: Map<string, number>;
  groups: Array<{ fg: VdpColor; bg: VdpColor }>;
} {
  const indexes = new Map<string, number>();
  const groups: Array<{ fg: VdpColor; bg: VdpColor }> = [];
  const groupFill: number[] = [];
  for (const tile of tiles) {
    let group = -1;
    for (let g = 0; g < groups.length; g += 1) {
      const capacity = g === 0 ? 7 : 8; // group 0 loses index 0 to blank
      if (
        groups[g]?.fg === tile.fg &&
        groups[g]?.bg === tile.bg &&
        (groupFill[g] ?? 0) < capacity
      ) {
        group = g;
        break;
      }
    }
    if (group === -1) {
      groups.push({ fg: tile.fg, bg: tile.bg });
      groupFill.push(0);
      group = groups.length - 1;
    }
    const position = (groupFill[group] ?? 0) + (group === 0 ? 1 : 0);
    indexes.set(tile.name, group * 8 + position);
    groupFill[group] = (groupFill[group] ?? 0) + 1;
  }
  return { indexes, groups };
}
import {
  emitMon3ApiEquates,
  emitMon3HeldStorage,
  emitMon3KeyCodeEquates,
  emitMon3LcdEquates,
  emitMon3LcdOps,
  emitMon3TextData,
  emitTec1gPollBindings,
} from './mon3-input.js';

export const tec1gTms9918Profile: Profile = {
  name: 'tec1g-mon3/tms9918',
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
    emit();
    emit('; --- TMS9918 (TEC-Deck): data/control ports, Graphics I VRAM map ---');
    emit(`${'VDP_DATA'.padEnd(17)} .equ $BE`);
    emit(`${'VDP_CONTROL'.padEnd(17)} .equ $BF`);
    emit(`${'VRAM_PATTERN'.padEnd(17)} .equ $0000`);
    emit(`${'VRAM_NAME'.padEnd(17)} .equ $0800`);
    emit(`${'VRAM_SPRITE_ATTR'.padEnd(17)} .equ $1B00`);
    emit(`${'VRAM_COLOR'.padEnd(17)} .equ $2000`);
    emit(`${'VRAM_SPRITE_PAT'.padEnd(17)} .equ $3800`);
    emit();
    emit('; --- TMS9918 colour codes ---');
    const colours: Array<[string, number]> = [
      ['VC_TRANSPARENT', 0],
      ['VC_BLACK', 1],
      ['VC_MEDGREEN', 2],
      ['VC_LIGHTGREEN', 3],
      ['VC_DARKBLUE', 4],
      ['VC_LIGHTBLUE', 5],
      ['VC_DARKRED', 6],
      ['VC_CYAN', 7],
      ['VC_MEDRED', 8],
      ['VC_LIGHTRED', 9],
      ['VC_DARKYELLOW', 10],
      ['VC_LIGHTYELLOW', 11],
      ['VC_DARKGREEN', 12],
      ['VC_MAGENTA', 13],
      ['VC_GRAY', 14],
      ['VC_WHITE', 15],
    ];
    for (const [name, value] of colours) {
      emit(`${name.padEnd(17)} .equ ${value}`);
    }
    emit();
    if (program.texts.length > 0) {
      emitMon3LcdEquates(emit);
    }
    emitMon3KeyCodeEquates(program, emit);
  },
  emitInputStorage({ emit, heldBindings }: ProfileContext): void {
    emitMon3HeldStorage(emit, heldBindings);
  },
  emitServiceStorage({ emit }: ProfileContext): void {
    emit(`${'NameShadow:'.padEnd(17)} .ds 768, 0       ; 32x24 name table shadow`);
    emit(`${'NameDirtyRows:'.padEnd(17)} .db 0, 0, 0      ; 24 dirty-row bits`);
    emit(`${'SpriteShadow:'.padEnd(17)} .ds 128, 0       ; 32 x (y, x, pattern, colour)`);
    emit(`${'SpriteDirty:'.padEnd(17)} .db 0`);
  },
  emitDataTables(ctx: ProfileContext): void {
    const { program, emit, op } = ctx;
    emitMon3TextData(program, emit, op);
    if (program.tiles.length > 0) {
      const { groups } = assignTileIndexes(program.tiles);
      if (groups.length > 32) {
        const over = program.tiles[program.tiles.length - 1];
        ctx.diagnostic(
          over?.line ?? 0,
          `Too many tile colour pairs: ${groups.length} groups of 8 patterns, the Graphics I colour table holds 32. Reuse (fg, bg) pairs.`,
        );
        return;
      }
    }
    emitVdpResourceTables(program, emit, op);
    emit('; --- VDP register init (value, then index|$80, via the control port) ---');
    emit('VdpRegInitTbl:');
    op('.db     $00, $C0, $02, $80, $00, $36, $07, $01');
    op('; Graphics I; display on, 16K; name $0800; colour $2000;');
    op('; pattern $0000; sprite attrs $1B00; sprite patterns $3800;');
    op('; backdrop black');
    emit();
  },
  emitLoopInit({ program, op }: ProfileContext): void {
    op('call    VdpInit');
    if (program.sprites.length > 0 || program.tiles.length > 0) {
      op('call    LoadResourcesVram');
    }
  },
  emitFrameStart({ op }: ProfileContext): void {
    op('call    VdpWaitVBlank        ; pace on the status-register flag');
    op('call    GlimCommit           ; flush shadows in the blank window');
    op('call    GlimPollBindings');
  },
  emitFrameEnd(): void {},
  emitPollBindings({ program, emit, op, raiseChanged, heldBindings }: ProfileContext): void {
    emitTec1gPollBindings(program, heldBindings.length > 0, emit, op, raiseChanged);
  },
  emitTail({ program, emit, op }: ProfileContext): void {
    emit();
    emitCommit(emit, op);
    emit();
    emitVdpLibrary(emit, op);
    if (program.sprites.length > 0 || program.tiles.length > 0) {
      emit();
      emitVdpResourceRuntime(program, emit, op);
    }
    emitMon3LcdOps(program, emit, op);
  },
};

/** Pattern data and name equates for sprite/tile resources. */
function emitVdpResourceTables(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  const sprites: readonly SpriteDecl[] = program.sprites;
  const tiles: readonly TileDecl[] = program.tiles;
  if (sprites.length === 0 && tiles.length === 0) return;
  emit('; --- VDP resources ---');
  emit('; A sprite name is its slot (and pattern number); a tile name is');
  emit('; its pattern index. Patterns upload once via LoadResourcesVram.');
  if (sprites.length > 0) {
    emit('GlimSpritePats:');
    for (const sprite of sprites) {
      for (const row of sprite.rows) {
        op(`.db     ${bin8(rowMask(row))}`);
      }
    }
    sprites.forEach((sprite, slot) => {
      emit(`${sprite.name.padEnd(17)} .equ ${slot}   ; sprite slot + pattern`);
    });
  }
  if (tiles.length > 0) {
    const { indexes } = assignTileIndexes(tiles);
    emit('GlimTilePats:');
    for (const tile of tiles) {
      emit(`; tile ${tile.name} -> index ${indexes.get(tile.name)}`);
      for (const row of tile.rows) {
        op(`.db     ${bin8(rowMask(row))}`);
      }
    }
    for (const tile of tiles) {
      emit(`${tile.name.padEnd(17)} .equ ${indexes.get(tile.name)}   ; tile index`);
    }
  }
  emit();
}

/** The one-time upload routine and the sprite_at/tile_at ops. */
function emitVdpResourceRuntime(
  program: GlimmerProgram,
  emit: (line?: string) => void,
  op: (text: string) => void,
): void {
  const sprites: readonly SpriteDecl[] = program.sprites;
  const tiles: readonly TileDecl[] = program.tiles;
  emit('; --- VDP resource runtime ---');
  emit('; Ops are AZM op definitions (one macro system, owned by AZM):');
  emit('; bodies invoke them as ordinary statements and they expand inline.');
  emit('op sprite_at(slot imm8, xcell imm16, ycell imm16)');
  op('ld      a,(xcell)');
  op('ld      d,a');
  op('ld      a,(ycell)');
  op('ld      e,a');
  op('ld      a,slot');
  op('call    SpriteSet');
  emit('end');
  if (tiles.length > 0) {
    emit();
    emit('op tile_at(tile imm8, col imm8, row imm8)');
    op('ld      a,tile');
    op('ld      d,col');
    op('ld      e,row');
    op('call    NamePut');
    emit('end');
  }
  emit();
  emit('; Upload sprite/tile patterns and the colour groups; assign each');
  emit("; sprite slot's pattern and colour in the shadow. Called once from");
  emit('; the loop init, after VdpInit.');
  emit('.routine clobbers A,BC,DE,HL,F');
  emit('LoadResourcesVram:');
  if (sprites.length > 0) {
    op('ld      hl,VRAM_SPRITE_PAT');
    op('call    VdpSetAddrWrite');
    op('ld      hl,GlimSpritePats');
    op(`ld      bc,${sprites.length * 8}`);
    op('call    VdpWriteBlock');
    sprites.forEach((sprite, slot) => {
      op(`ld      a,${slot}                  ; ${sprite.name}`);
      op(`ld      d,${slot}`);
      op(`ld      e,${VC_NAME[sprite.color]}`);
      op('call    SpriteInit');
    });
  }
  if (tiles.length > 0) {
    const { indexes, groups } = assignTileIndexes(tiles);
    for (const tile of tiles) {
      const index = indexes.get(tile.name) ?? 0;
      op(`ld      hl,VRAM_PATTERN + ${index * 8}   ; ${tile.name}`);
      op('call    VdpSetAddrWrite');
      op(`ld      hl,GlimTilePats + ${tiles.indexOf(tile) * 8}`);
      op('ld      bc,8');
      op('call    VdpWriteBlock');
    }
    groups.forEach((group, g) => {
      op(`ld      hl,VRAM_COLOR + ${g}`);
      op('call    VdpSetAddrWrite');
      op(`ld      a,${VC_NAME[group.fg]} * 16 + ${VC_NAME[group.bg]}`);
      op('out     (VDP_DATA),a');
    });
  }
  op('ret');
}

/** The commit phase: dirty shadows stream to VRAM at frame start. */
function emitCommit(emit: (line?: string) => void, op: (text: string) => void): void {
  emit('; --- commit: flush dirty shadows to VRAM ---');
  emit('.routine clobbers A,BC,DE,HL,F');
  emit('GlimCommit:');
  op('ld      a,(SpriteDirty)');
  op('or      a');
  op('jr      z,_names');
  op('xor     a');
  op('ld      (SpriteDirty),a');
  op('ld      hl,VRAM_SPRITE_ATTR');
  op('call    VdpSetAddrWrite');
  op('ld      hl,SpriteShadow');
  op('ld      bc,128');
  op('call    VdpWriteBlock');
  emit('_names:');
  op('ld      b,0                  ; define B: only C is live across row commits');
  op('ld      d,0                  ; D = dirty-row group 0..2');
  emit('_group:');
  op('ld      hl,NameDirtyRows');
  op('ld      a,l');
  op('add     a,d');
  op('ld      l,a');
  op('ld      a,h');
  op('adc     a,0');
  op('ld      h,a');
  op('ld      a,(hl)');
  op('or      a');
  op('jr      z,_next');
  op('ld      (hl),0               ; consume the group');
  op('ld      c,a                  ; C = dirty bits, rows D*8 .. D*8+7');
  op('ld      e,0                  ; E = bit within the group');
  emit('_bits:');
  op('srl     c');
  op('jr      nc,_nbit');
  op('push    de');
  op('push    bc');
  op('ld      a,d');
  op('add     a,a');
  op('add     a,a');
  op('add     a,a');
  op('add     a,e                  ; row = group*8 + bit');
  op('call    CommitNameRow');
  op('pop     bc');
  op('pop     de');
  emit('_nbit:');
  op('inc     e');
  op('ld      a,e');
  op('cp      8');
  op('jr      c,_bits');
  emit('_next:');
  op('inc     d');
  op('ld      a,d');
  op('cp      3');
  op('jr      c,_group');
  op('ret');
}

/** VDP access primitives + the shadow-writing service routines. */
function emitVdpLibrary(emit: (line?: string) => void, op: (text: string) => void): void {
  emit('; --- tms9918 profile library ---');
  emit();
  emit('; Set the VRAM write address (low byte, then high|$40).');
  emit('.routine in HL clobbers A');
  emit('VdpSetAddrWrite:');
  op('ld      a,l');
  op('out     (VDP_CONTROL),a');
  op('ld      a,h');
  op('or      $40');
  op('out     (VDP_CONTROL),a');
  op('ret');
  emit();
  emit('; Stream BC bytes from HL to the data port (address already set).');
  emit('.routine in HL,BC clobbers A,BC,HL,F');
  emit('VdpWriteBlock:');
  emit('_loop:');
  op('ld      a,(hl)');
  op('out     (VDP_DATA),a');
  op('inc     hl');
  op('dec     bc');
  op('ld      a,b');
  op('or      c');
  op('jr      nz,_loop');
  op('ret');
  emit();
  emit('; Fill BC bytes of VRAM at HL with E.');
  emit('.routine in HL,BC,E clobbers A,BC,F');
  emit('VdpFill:');
  op('call    VdpSetAddrWrite');
  emit('_loop:');
  op('ld      a,e');
  op('out     (VDP_DATA),a');
  op('dec     bc');
  op('ld      a,b');
  op('or      c');
  op('jr      nz,_loop');
  op('ret');
  emit();
  emit('; Wait for the vblank flag (reading the status register clears it).');
  emit('.routine clobbers A,F');
  emit('VdpWaitVBlank:');
  emit('_wait:');
  op('in      a,(VDP_CONTROL)');
  op('and     $80');
  op('jr      z,_wait');
  op('ret');
  emit();
  emit('; Position sprite slot A at D=x, E=y (shadow write; commit flushes).');
  emit('.routine in A,D,E clobbers A,HL,F');
  emit('SpriteSet:');
  op('add     a,a');
  op('add     a,a                  ; slot*4');
  op('ld      l,a');
  op('ld      h,0');
  op('push    de');
  op('ld      de,SpriteShadow');
  op('add     hl,de');
  op('pop     de');
  op('ld      (hl),e               ; y');
  op('inc     hl');
  op('ld      (hl),d               ; x');
  op('ld      a,1');
  op('ld      (SpriteDirty),a');
  op('ret');
  emit();
  emit('; Assign sprite slot A its pattern number D and colour E.');
  emit('.routine in A,D,E clobbers A,HL,F');
  emit('SpriteInit:');
  op('add     a,a');
  op('add     a,a');
  op('ld      l,a');
  op('ld      h,0');
  op('push    de');
  op('ld      de,SpriteShadow');
  op('add     hl,de');
  op('pop     de');
  op('inc     hl');
  op('inc     hl');
  op('ld      (hl),d               ; pattern');
  op('inc     hl');
  op('ld      (hl),e               ; colour');
  op('ld      a,1');
  op('ld      (SpriteDirty),a');
  op('ret');
  emit();
  emit('; Put tile A at column D, row E of the name-table shadow and mark');
  emit('; the row dirty.');
  emit('.routine in A,D,E clobbers A,BC,HL,F');
  emit('NamePut:');
  op('ld      c,a                  ; C = tile index');
  op('ld      l,e');
  op('ld      h,0');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl                ; row*32');
  op('ld      a,d');
  op('add     a,l');
  op('ld      l,a');
  op('ld      a,h');
  op('adc     a,0');
  op('ld      h,a                  ; + column');
  op('ld      a,c');
  op('ld      bc,NameShadow');
  op('add     hl,bc');
  op('ld      (hl),a');
  op('ld      a,e');
  op('and     %00000111');
  op('ld      b,a                  ; bit index within the group');
  op('ld      a,%00000001');
  op('inc     b');
  emit('_shift:');
  op('dec     b');
  op('jr      z,_mask');
  op('add     a,a');
  op('jr      _shift');
  emit('_mask:');
  op('ld      c,a                  ; C = row bit mask');
  op('ld      a,e');
  op('rrca');
  op('rrca');
  op('rrca');
  op('and     %00000011');
  op('ld      e,a');
  op('ld      d,0');
  op('ld      hl,NameDirtyRows');
  op('add     hl,de');
  op('ld      a,(hl)');
  op('or      c');
  op('ld      (hl),a');
  op('ret');
  emit();
  emit('; Flush one shadow name-table row (A = row 0..23) to VRAM.');
  emit('.routine in A clobbers A,BC,DE,HL,F');
  emit('CommitNameRow:');
  op('ld      l,a');
  op('ld      h,0');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl');
  op('add     hl,hl                ; row*32');
  op('push    hl');
  op('ld      de,VRAM_NAME');
  op('add     hl,de');
  op('call    VdpSetAddrWrite');
  op('pop     hl');
  op('ld      de,NameShadow');
  op('add     hl,de');
  op('ld      bc,32');
  op('call    VdpWriteBlock');
  op('ret');
  emit();
  emit('; One-time VDP init: registers from the table, colour table to');
  emit('; white-on-black, pattern and name tables cleared, all sprites');
  emit('; hidden (Y=$D1 also terminates sprite processing at the first');
  emit('; unused slot — use contiguous slots from 0).');
  emit('.routine clobbers A,BC,DE,HL,F');
  emit('VdpInit:');
  op('ld      hl,VdpRegInitTbl');
  op('ld      b,8');
  op('ld      c,0');
  emit('_regs:');
  op('ld      a,(hl)');
  op('out     (VDP_CONTROL),a');
  op('ld      a,c');
  op('or      $80');
  op('out     (VDP_CONTROL),a');
  op('inc     hl');
  op('inc     c');
  op('djnz    _regs');
  op('ld      hl,VRAM_COLOR        ; colour: white on black for all groups');
  op('ld      bc,32');
  op('ld      e,$F1');
  op('call    VdpFill');
  op('ld      hl,VRAM_PATTERN');
  op('ld      bc,2048');
  op('ld      e,0');
  op('call    VdpFill');
  op('ld      hl,VRAM_NAME');
  op('ld      bc,768');
  op('ld      e,0');
  op('call    VdpFill');
  op('ld      hl,SpriteShadow      ; hide all 32 sprites');
  op('ld      b,32');
  emit('_hide:');
  op('ld      (hl),$D1');
  op('inc     hl');
  op('inc     hl');
  op('inc     hl');
  op('inc     hl');
  op('djnz    _hide');
  op('ld      a,1');
  op('ld      (SpriteDirty),a      ; first commit publishes the hidden table');
  op('ret');
}
