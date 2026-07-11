import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '@jhlagado/azm/compile';

import { compileToAzm } from '../src/index.js';
import { generateAzm } from '../src/generate.js';
import { loadGlimmerProgram } from '../src/load.js';
import { parseGlimmer } from '../src/parse.js';

const counterToy = readFileSync(path.join(import.meta.dirname, '../examples/counter.glim'), 'utf8');

describe('generateAzm', () => {
  it('generates the expected structure for CounterToy', () => {
    const { program } = parseGlimmer(counterToy);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);

    // Change flags: states first, then pulses, in declaration order.
    expect(source).toContain('CHG_COUNT_BIT     .equ 0');
    expect(source).toContain('CHG_INCPRESSED_BIT .equ 1');
    expect(source).toContain('CHG_DECPRESSED_BIT .equ 2');

    // Count starts changed, so DrawCount runs on the first frame.
    expect(source).toContain('Changed0:         .db %00000001');

    // Runtime loop calls only the phases that have effects.
    expect(source).toContain('call    GlimRunLogicEffects');
    expect(source).toContain('call    GlimRunRenderEffects');
    expect(source).not.toContain('GlimRunDeriveEffects');

    // Block-local labels pass through verbatim; AZM scopes them to the
    // enclosing @Glim_<Effect> routine.
    expect(source).toContain('_done:');
    expect(source).toContain('jr nz,_not_zero');

    // updates Count marks the change flag after the user body.
    expect(source).toContain('or      CHG_COUNT');
  });

  it('emits multiple change-flag banks', async () => {
    const states = Array.from({ length: 9 }, (_, i) =>
      i === 8 ? `state S${i} : byte changed` : `state S${i} : byte`,
    ).join('\n');
    const sourceText = [
      'program Big',
      states,
      'pulse Tick',
      'pulse Late',
      'timer Beat : byte = 2 -> Late',
      'ramp Travel : byte steps 4 -> Late',
      'bind key KEY_1 rising -> Tick',
      'effect TouchHigh',
      'on S0, S8',
      'updates S8',
      'begin',
      '    ld a,1',
      '    ld (S8),a',
      'end',
      'compute FollowHigh',
      'on S8',
      'updates S0',
      'begin',
      '    xor a',
      '    ld (S0),a',
      'end',
      'render DrawHigh',
      'on S8',
      'begin',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('CHG_S8_BIT        .equ 0');
    expect(source).toContain('CHG_TICK_BIT      .equ 1');
    expect(source).toContain('CHG_LATE_BIT      .equ 2');
    expect(source).toContain('CHG_TRAVEL_BIT    .equ 3');
    expect(source).toContain('Changed0:         .db %00000000');
    expect(source).toContain('Changed1:         .db %00000001');
    expect(source).toContain('Raised1:          .db 0');
    expect(source).toContain('Next1:            .db 0');
    expect(source).toContain('GlimDep_TouchHigh__B0 .equ CHG_S0');
    expect(source).toContain('GlimDep_TouchHigh__B1 .equ CHG_S8');
    expect(source).toContain('GlimDep_DrawHigh__B1 .equ CHG_S8');
    expect(source).toContain('jr      nz,_run_TouchHigh');
    expect(source).toContain('ld      a,(Changed1)');
    expect(source).toContain('and     GlimDep_DrawHigh__B1');
    expect(source).toContain('ld      a,(Changed1)');
    expect(source).toContain('or      CHG_TICK');
    expect(source).toContain('ld      (Changed1),a');
    expect(source).toContain('or      CHG_TRAVEL');
    expect(source).toContain('ld      a,(Raised1)');
    expect(source).toContain('or      CHG_S8');
    expect(source).toContain('ld      (Raised1),a');
    expect(source).toContain(
      'ld      a,(Next1)            ; a consumer already ran: defer to next frame',
    );
    expect(source).toContain('or      CHG_S8');
    expect(source).toContain('ld      (Next1),a');
    expect(source).toContain('ld      a,(Next1)            ; deferred raises become next frame');
    expect(source).toContain('ld      (Changed1),a');

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-banks-'));
    const entry = path.join(dir, 'banks.asm');
    writeFileSync(entry, source);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('rejects more than 32 tracked cells', () => {
    const decls = Array.from({ length: 33 }, (_, i) => `state S${i} : byte`).join('\n');
    const { program } = parseGlimmer(`program Big\n${decls}\n`);
    const { source, diagnostics } = generateAzm(program!);
    expect(source).toBe('');
    expect(diagnostics[0]?.message).toContain('Change flags are full');
  });

  it('uses collision-free dependency mask names across banks', async () => {
    const states = Array.from({ length: 9 }, (_, i) => `state S${i} : byte`).join('\n');
    const sourceText = [
      'program P',
      states,
      'effect Foo',
      'on S8',
      'begin',
      'end',
      'effect Foo_1',
      'on S0',
      'begin',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-bank-names-'));
    const entry = path.join(dir, 'bank-names.asm');
    writeFileSync(entry, source);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('deduplicates repeated dependency and update masks', () => {
    const sourceText = [
      'program P',
      'state A : byte',
      'state B : byte',
      'effect Repeat',
      'on A, A',
      'updates B, B',
      'begin',
      '    ld a,1',
      '    ld (B),a',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('GlimDep_Repeat__B0 .equ CHG_A');
    expect(source).not.toContain('CHG_A + CHG_A');
    expect(source).not.toContain('CHG_B + CHG_B');
  });

  it('emits byte array storage as one flag-carrying cell', () => {
    const sourceText = [
      'program P',
      'state Board : byte[8] changed',
      'pulse Tick',
      'effect TouchBoard',
      'on Tick',
      'updates Board',
      'begin',
      '    ld hl,Board',
      '    inc (hl)',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('CHG_BOARD_BIT     .equ 0');
    expect(source).toContain('CHG_BOARD         .equ %00000001');
    expect(source).toContain('Board:            .ds 8, 0   ; byte array');
    expect(source).toContain('Changed0:         .db %00000001');
    expect(source).toContain('or      CHG_BOARD');
  });
});

describe('verbatim block bodies', () => {
  it('emits block-local labels untouched; AZM scopes them to the @ routine', () => {
    const sourceText = [
      'program Twins',
      'state N : byte',
      'pulse Go',
      'bind key KEY_1 rising -> Go',
      'effect A',
      'on Go',
      'updates N',
      'begin',
      '    jr _done',
      '_done:',
      'end',
      'effect B',
      'on Go',
      'updates N',
      'begin',
      '    jr _done',
      '_done:',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    // Both blocks keep their _done labels verbatim — no Glim_ renaming.
    expect(source.match(/^_done:$/gm)).toHaveLength(2);
    expect(source).toContain('jr _done');
    expect(source).not.toContain('Glim_A__done');
    expect(source).not.toContain('Glim_A_done');
  });
});

describe('tec1g-mon3 matrix8x8 profile', () => {
  const dot = readFileSync(path.join(import.meta.dirname, '../examples/dot.glim'), 'utf8');

  it('generates the scan-driven runtime for the Dot example', () => {
    const { program, diagnostics: parseDiags } = parseGlimmer(dot);
    expect(parseDiags).toEqual([]);
    expect(program?.platform).toBe('tec1g-mon3');
    expect(program?.display).toBe('matrix8x8');

    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);

    // MON-3 input, not the generic placeholder API.
    expect(source).toContain('rst     $10');
    expect(source).not.toContain('API_ReadKeys');
    expect(source).not.toContain('PrevKeys');

    // Scan-driven loop: frame first, game work in the blank window.
    expect(source).toContain('call    ScanFrame');
    expect(source).toContain('ScanFrame:');
    expect(source).toContain('Framebuffer:');

    // Profile library present for user code to call.
    expect(source).toContain('FbPlot:');
    expect(source).toContain('FbClear:');
  });

  it('rejects unknown MON-3 keys', () => {
    const bad = dot.replace(
      'bind key KEY_2 held period 8 -> Up',
      'bind key KEY_TURBO rising -> Up',
    );
    const { program, diagnostics } = parseGlimmer(bad);
    expect(program).toBeNull();
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('Unknown tec1g-mon3 key');
  });

  it('generated Dot source assembles and passes strict register contracts', async () => {
    const result = compileToAzm(dot);
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain('Glim_DrawDot:');
    // Contracts are declared in-source: strict policy plus a .routine
    // boundary per callable; the legacy ;! comments are gone.
    expect(result.source).toContain('.contracts strict');
    expect(result.source).toMatch(/\.routine\nGlim_DrawDot:/);
    expect(result.source).not.toContain(';!');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-dot-'));
    const entry = path.join(dir, 'dot.asm');
    writeFileSync(entry, result.source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'strict',
      registerContractsProfile: 'mon3',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(assembled.artifacts.find((a) => a.kind === 'bin')).toBeDefined();
  });
});

describe('v0.2 runtime (slide example)', () => {
  const slide = readFileSync(path.join(import.meta.dirname, '../examples/slide.glim'), 'utf8');

  it('emits non-blocking sound cue wrappers for the matrix profile', () => {
    const sourceText = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Arrive len 24 div 3',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('Snd_Arrive:');
    expect(source).toContain('ld      a,24');
    expect(source).toContain('ld      c,3');
    expect(source).toContain('jp      SndStart');
  });

  it('emits build-time curve tables', () => {
    const sourceText = [
      'program P',
      'curve Linear linear steps 8',
      'curve SlideX ease_out steps 8 from 0 to 7',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('; --- curve resources ---');
    expect(source).toContain('.align  256');
    expect(source).toContain('Curve_Linear:');
    expect(source).toContain('.db     0, 1, 2, 3, 4, 5, 6, 7');
    expect(source).toContain('Curve_SlideX:');
    expect(source).toContain('.db     0, 2, 3, 5, 6, 6, 7, 7');
  });

  it('emits matrix shape resources and ShapeDraw support', () => {
    const sourceText = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'shape Dot color green',
      '  "XX"',
      '  ".X"',
      'end',
    ].join('\n');
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('; --- shape resources ---');
    expect(source).toContain('Shape_Dot:');
    expect(source).toContain('.db     2, 2, COLOR_GREEN');
    expect(source).toContain('.db     %11000000');
    expect(source).toContain('.db     %01000000');
    expect(source).toContain('ShapePtr:');
    expect(source).toContain('ShapeDraw:');
    expect(source).toContain('call    FbPlot');
  });

  it('generates rollover, timer, ramp, and service machinery', () => {
    const { program, diagnostics: parseDiags } = parseGlimmer(slide);
    expect(parseDiags).toEqual([]);
    const { source, diagnostics } = generateAzm(program!);
    expect(diagnostics).toEqual([]);

    // Rollover: StartSlide (logic) rewinds Travel, whose consumer
    // TrackDot (compute/derive) already ran — the raise must defer.
    expect(source).toContain('or      CHG_TRAVEL');
    expect(source).toContain('ld      (Next0),a');
    // Same-frame path: Twinkle (logic) updates Visible for render.
    expect(source).toContain('ld      (Raised0),a');
    expect(source).toContain('GlimMergeRaised:');
    // End of frame rolls deferred raises over instead of clearing.
    expect(source).toContain('ld      a,(Next0)            ; deferred raises become next frame');

    // Timer: hidden countdown reloading from the writable period cell.
    expect(source).toContain('Glim_Blink_cnt:');
    expect(source).toContain('ld      a,(Blink)       ; reload from period cell');
    // Ramp: idle at terminal, completion pulse.
    expect(source).toContain('Travel:           .db 63   ; ramp progress, idle at terminal');
    expect(source).toContain('ld      (Arrived),a');
    // Curve: Travel maps through an ease-out table.
    expect(source).toContain('Curve_SlideX:');
    expect(source).toContain('ld hl,Curve_SlideX');
    // Shape: DrawDot uses a generated 2x2 resource.
    expect(source).toContain('Shape_Dot:');
    expect(source).toContain('ld hl,Shape_Dot');
    expect(source).toContain('call ShapeDraw');

    // Sound + HUD serviced per scan row; library present.
    expect(source).toContain('Snd_Arrive:');
    expect(source).toContain('call Snd_Arrive');
    expect(source).toContain('call    SndService');
    expect(source).toContain('call    HudScanDig');
    expect(source).toContain('SndStart:');
    expect(source).toContain('HudWriteU16:');
  });

  it('generates held-binding autorepeat for the Dot example', () => {
    const dotSrc = readFileSync(path.join(import.meta.dirname, '../examples/dot.glim'), 'utf8');
    const { program } = parseGlimmer(dotSrc);
    const { source } = generateAzm(program!);
    expect(source).toContain('Glim_HeldKey:');
    expect(source).toContain('_newpress:');
    expect(source).toContain('ld      (Glim_HeldCount),a');
  });

  it('generated Slide source assembles and passes strict register contracts', async () => {
    const result = compileToAzm(slide);
    expect(result.diagnostics).toEqual([]);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-slide-'));
    const entry = path.join(dir, 'slide.asm');
    writeFileSync(entry, result.source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'strict',
      registerContractsProfile: 'mon3',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(assembled.artifacts.find((a) => a.kind === 'bin')).toBeDefined();
  });

  it('generated Trail source assembles and passes strict register contracts', async () => {
    // Trail is a multi-file program (entry + part) since v0.4: load it.
    const loaded = loadGlimmerProgram(path.join(import.meta.dirname, '../examples/trail.glim'));
    expect(loaded.diagnostics).toEqual([]);
    const result = generateAzm(loaded.program!);
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain('Trail:            .ds 8, 0   ; byte array');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-trail-'));
    const entry = path.join(dir, 'trail.asm');
    writeFileSync(entry, result.source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'strict',
      registerContractsProfile: 'mon3',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(assembled.artifacts.find((a) => a.kind === 'bin')).toBeDefined();
  });
});

describe('CLI pipeline (generate + AZM contract check)', () => {
  it('declares .routine boundaries in the written file', async () => {
    const { main } = await import('../src/cli.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-cli-'));
    const entry = path.join(dir, 'dot.glim');
    writeFileSync(entry, readFileSync(path.join(import.meta.dirname, '../examples/dot.glim')));
    const status = await main([entry]);
    expect(status).toBe(0);
    const out = readFileSync(path.join(dir, 'dot.main.asm'), 'utf8');
    // Each block wrapper is a declared routine boundary; AZM infers
    // its contract from the body under .contracts strict.
    expect(out).toMatch(/\.routine\nGlim_MoveUp:/);
  });

  // Regression: npm installs expose the CLI through a .bin symlink, so
  // argv[1] is the symlink while import.meta.url is the resolved real
  // file. The entry guard must compare after realpath resolution, or
  // `npx glimmer` exits 0 having done nothing.
  it('runs when invoked through a bin-style symlink', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-bin-'));
    const link = path.join(dir, 'glimmer');
    symlinkSync(path.join(import.meta.dirname, '../src/cli.ts'), link);
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', link, '--help'], {
      encoding: 'utf8',
    });
    expect(stdout).toContain('Usage: glimmer');
  });
});

describe('structured data (layout types)', () => {
  const typedProgram = [
    'program Typed',
    'type Point',
    '    x : byte',
    '    y : byte',
    'end',
    'type Piece',
    '    origin : Point',
    '    rows : 4',
    '    color : byte',
    'end',
    'type Bag = Piece[7]',
    'state Cursor : Point changed',
    'state Pieces : Piece[7]',
    'state Score : byte',
    'pulse Go',
    'bind key KEY_1 rising -> Go',
    'effect MovePoint',
    '    on Go',
    '    updates Cursor',
    'begin',
    '    ld hl,Cursor + offset(Point, y)',
    '    inc (hl)',
    '    ld a,sizeof(Piece)',
    '    ld (Score),a',
    'end',
    'render Show',
    '    on Cursor',
    'begin',
    '    ld a,(Cursor)',
    'end',
  ].join('\n');

  it('emits .type records, .typealias, and typed .ds storage', () => {
    const { source, diagnostics } = compileToAzm(typedProgram);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('Point .type');
    expect(source).toContain('    x             .byte');
    expect(source).toContain('    origin        .field Point');
    expect(source).toContain('    rows          .field 4');
    expect(source).toContain('.endtype');
    expect(source).toContain('Bag               .typealias Piece[7]');
    expect(source).toContain('Cursor:           .ds Point, 0   ; typed state');
    expect(source).toContain('Pieces:           .ds Piece[7], 0   ; typed state');
    // Typed cells carry ordinary change flags.
    expect(source).toContain('CHG_CURSOR');
  });

  it('assembles with AZM: sizeof/offset resolve against the emitted layouts', async () => {
    const { source, diagnostics } = compileToAzm(typedProgram);
    expect(diagnostics).toEqual([]);

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-typed-'));
    const entry = path.join(dir, 'typed.asm');
    writeFileSync(entry, source!);
    const assembled = await compile(entry, { emitBin: true, emitHex: false, emitD8m: false });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('routines', () => {
  const routineProgram = [
    'program R',
    'state X : byte changed',
    'routine ClampX',
    'begin',
    '    cp 8',
    '    ret c',
    '    ld a,7',
    'end',
    'render Draw',
    '    on X',
    'begin',
    '    ld a,(X)',
    '    call ClampX',
    '    ld (X),a',
    'end',
  ].join('\n');

  it('emits routines as declared boundaries with verbatim bodies', () => {
    const { source, diagnostics } = compileToAzm(routineProgram);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('; --- routine ClampX ---');
    expect(source).toMatch(/\.routine\nClampX:\n    cp 8\n    ret c\n    ld a,7\n        ret/);
  });

  it('assembles with AZM and passes contract inference', async () => {
    const { source, diagnostics } = compileToAzm(routineProgram);
    expect(diagnostics).toEqual([]);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-routine-'));
    const entry = path.join(dir, 'routine.asm');
    writeFileSync(entry, source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'error',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('cards', () => {
  const cardProgram = [
    'program Modal',
    'state Score : byte',
    'pulse Go',
    'bind key KEY_1 rising -> Go',
    'card Splash',
    'effect Launch',
    '    on Go',
    '    goto Playing',
    'end',
    'card Playing',
    'enter SetupPlaying',
    '    updates Score',
    'begin',
    '    xor a',
    '    ld (Score),a',
    'end',
    'effect Advance',
    '    on Go',
    '    updates Score',
    'begin',
    '    ld hl,Score',
    '    inc (hl)',
    'end',
    'render Draw',
    '    on Score',
    'begin',
    '    ld a,(Score)',
    'end',
  ].join('\n');

  it('emits the enum, the built-in cell, card gates, and goto transitions', () => {
    const { source, diagnostics } = compileToAzm(cardProgram);
    expect(diagnostics).toEqual([]);
    // Enum and the built-in cell, starting in the first card, changed.
    expect(source).toContain('Card              .enum Splash, Playing');
    expect(source).toContain(
      'CurrentCard:      .db Card.Splash   ; writable next card, starts changed',
    );
    expect(source).toContain('GlimActiveCard:   .db Card.Splash');
    expect(source).toContain('CHG_CURRENTCARD');
    // Card gates in dispatch.
    expect(source).toContain('cp      Card.Splash');
    expect(source).toContain('cp      Card.Playing');
    expect(source).toMatch(
      /ld {6}a,\(GlimActiveCard\)\n {8}cp {6}Card\.Splash\n {8}jr {6}nz,_skip_Launch/,
    );
    // goto: transition after the (empty) body.
    expect(source).toMatch(
      /Glim_Launch:\n {8}ld {6}a,Card\.Playing {6}; goto Playing\n {8}ld {6}\(CurrentCard\),a/,
    );
    // Enter block gated on its card, triggered by CurrentCard's flag.
    expect(source).toContain('; --- enter block SetupPlaying ---');
  });

  it('never leaks same-frame triggers into a goto destination card', () => {
    // Splash's Launch fires on Go and gotos Playing; Playing's Advance
    // also fires on Go. Advance must not run in the same frame: gates
    // test GlimActiveCard, latched once at frame start, while the goto
    // writes CurrentCard (the next-card register).
    const { source } = compileToAzm(cardProgram);
    // The latch sits in the main loop, before any dispatch.
    const loop = source!.indexOf('MainLoop:');
    const latch = source!.indexOf('ld      (GlimActiveCard),a', loop);
    const firstDispatch = source!.indexOf('GlimRun', loop);
    expect(latch).toBeGreaterThan(loop);
    expect(latch).toBeLessThan(firstDispatch);
    // No dispatch gate reads the live CurrentCard cell.
    const dispatchRegion = source!.slice(firstDispatch, source!.indexOf('; --- logic block'));
    expect(dispatchRegion).not.toContain('ld      a,(CurrentCard)');
    expect(dispatchRegion).toContain('ld      a,(GlimActiveCard)');
  });

  it('dispatches enter blocks before other effects in their phase', () => {
    const { source } = compileToAzm(cardProgram);
    const dispatch = source!.indexOf('GlimRunLogicEffects:');
    const setup = source!.indexOf('_skip_SetupPlaying', dispatch);
    const advance = source!.indexOf('_skip_Advance', dispatch);
    expect(setup).toBeGreaterThan(dispatch);
    expect(advance).toBeGreaterThan(setup);
  });

  it('assembles with AZM', async () => {
    const { source, diagnostics } = compileToAzm(cardProgram);
    expect(diagnostics).toEqual([]);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-cards-'));
    const entry = path.join(dir, 'cards.asm');
    writeFileSync(entry, source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'error',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('text resources, lcd_row, and any-key', () => {
  const lcdProgram = [
    'program L',
    'platform tec1g-mon3',
    'display matrix8x8',
    'text Msg "HI"',
    'state S : byte',
    'pulse AnyKey',
    'pulse Go',
    'bind key any rising -> AnyKey',
    'bind key KEY_GO rising -> Go',
    'effect Greet',
    '    on AnyKey',
    '    updates S',
    'begin',
    '    lcd_row Msg, LcdRow1',
    '    ld a,1',
    '    ld (S),a',
    'end',
  ].join('\n');

  it('emits the string, the LCD equates, the op, and any-key raising', () => {
    const { source, diagnostics } = compileToAzm(lcdProgram);
    expect(diagnostics).toEqual([]);
    expect(source).toContain('.db     "HI", 0');
    expect(source).toContain('ApiStringToLcd    .equ 13');
    expect(source).toContain('op lcd_row(msg imm16, row imm8)');
    // any-key raises before named-key dispatch, without a ret.
    const poll = source!.indexOf('GlimPollBindings:');
    const anyRaise = source!.indexOf('ld      (AnyKey),a', poll);
    const named = source!.indexOf('cp      KEY_GO', poll);
    expect(anyRaise).toBeGreaterThan(poll);
    expect(anyRaise).toBeLessThan(named);
  });

  it('assembles with AZM under the mon3 contract profile', async () => {
    const { source } = compileToAzm(lcdProgram);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-lcd-'));
    const entry = path.join(dir, 'lcd.asm');
    writeFileSync(entry, source!);
    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'error',
      registerContractsProfile: 'mon3',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('0.4 review regressions', () => {
  it('rejects more than 32 tile colour groups instead of corrupting VRAM', () => {
    const rows = Array.from({ length: 8 }, () => '  "XXXXXXXX"');
    const colours = [
      'transparent',
      'black',
      'medgreen',
      'lightgreen',
      'darkblue',
      'lightblue',
      'darkred',
      'cyan',
      'medred',
      'lightred',
      'darkyellow',
      'lightyellow',
      'darkgreen',
      'magenta',
      'gray',
      'white',
    ];
    // 33 distinct (fg, bg) pairs -> 33 colour groups -> tile index 256.
    const tiles: string[] = [];
    let n = 0;
    for (const fg of colours) {
      for (const bg of colours) {
        if (fg === bg || n >= 33) continue;
        tiles.push(`tile T${n} color ${fg} on ${bg}`, ...rows, 'end');
        n += 1;
      }
    }
    const sourceText = ['program P', 'platform tec1g-mon3', 'display tms9918', ...tiles].join(
      String.fromCharCode(10),
    );
    const { program, diagnostics: parseDiags } = parseGlimmer(sourceText);
    expect(parseDiags).toEqual([]);
    const { diagnostics } = generateAzm(program!);
    expect(diagnostics.map((d) => d.message).join(' ')).toContain('Too many tile colour pairs');
  });

  it('does not emit a key equate for the any pseudo-key', () => {
    const { source, diagnostics } = compileToAzm(
      [
        'program P',
        'platform tec1g-mon3',
        'display matrix8x8',
        'pulse A',
        'bind key any rising -> A',
        'effect E',
        '    on A',
        'begin',
        '    nop',
        'end',
      ].join(String.fromCharCode(10)),
    );
    expect(diagnostics).toEqual([]);
    expect(source).not.toMatch(/^any\s+\.equ/m);
  });

  it('keeps semicolons inside text strings', () => {
    const { program, diagnostics } = parseGlimmer(
      [
        'program P',
        'platform tec1g-mon3',
        'display matrix8x8',
        'text Msg "READY; GO"  ; trailing note',
      ].join(String.fromCharCode(10)),
    );
    expect(diagnostics).toEqual([]);
    expect(program?.texts[0]?.value).toBe('READY; GO');
  });
});

describe('AZM round trip', () => {
  it('generated CounterToy source assembles cleanly with AZM', async () => {
    const result = compileToAzm(counterToy);
    expect(result.diagnostics).toEqual([]);
    expect(result.source).not.toBeNull();

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-azm-'));
    const entry = path.join(dir, 'counter.asm');
    writeFileSync(entry, result.source!);

    const assembled = await compile(entry, {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
    });
    const errors = assembled.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);

    const bin = assembled.artifacts.find((artifact) => artifact.kind === 'bin');
    expect(bin).toBeDefined();
  });
});
