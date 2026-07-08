import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '@jhlagado/azm/compile';

import { compileToAzm } from '../src/index.js';
import { generateAzm, namespaceLocalLabels } from '../src/generate.js';
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
    expect(source).toContain('call    __RunLogicEffects');
    expect(source).toContain('call    __RunRenderEffects');
    expect(source).not.toContain('__RunDeriveEffects');

    // Block-local labels are namespaced per effect.
    expect(source).toContain('Glim_ApplyIncrement_done:');
    expect(source).toContain('Glim_ApplyDecrement_done:');
    expect(source).toContain('jr nz,Glim_ApplyDecrement_not_zero');

    // updates Count marks the change flag after the user body.
    expect(source).toContain('or      CHG_COUNT');
  });

  it('rejects more than 8 tracked cells in v0', () => {
    const decls = Array.from({ length: 9 }, (_, i) => `state S${i} : byte`).join('\n');
    const { program } = parseGlimmer(`program Big\n${decls}\n`);
    const { source, diagnostics } = generateAzm(program!);
    expect(source).toBe('');
    expect(diagnostics[0]?.message).toContain('Changed0 is full');
  });
});

describe('namespaceLocalLabels', () => {
  it('rewrites only labels defined in the block', () => {
    const body = ['    jr c,_done', '_done:', '    .db 1 ; directive, not a label'];
    expect(namespaceLocalLabels(body, 'E')).toEqual([
      '    jr c,Glim_E_done',
      'Glim_E_done:',
      '    .db 1 ; directive, not a label',
    ]);
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
    expect(source).toContain('@ScanFrame:');
    expect(source).toContain('Framebuffer:');

    // Profile library present for user code to call.
    expect(source).toContain('@FbPlot:');
    expect(source).toContain('@FbClear:');
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
    expect(result.source).toContain('@Glim_DrawDot:');
    // Contracts are AZM's job: the generator emits bare @ boundaries and
    // the header says who injects the ;! comments.
    expect(result.source).toContain('--contracts --rc error --reg-profile mon3');
    expect(result.source).not.toContain(';! clobbers A,BC,DE,HL,IX,IY');
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
    expect(source).toContain('@Snd_Arrive:');
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
    expect(source).toContain('@__MergeRaised:');
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

    // Sound + HUD serviced per scan row; library present.
    expect(source).toContain('@Snd_Arrive:');
    expect(source).toContain('call Snd_Arrive');
    expect(source).toContain('call    SndService');
    expect(source).toContain('call    HudScanDig');
    expect(source).toContain('@SndStart:');
    expect(source).toContain('@HudWriteU16:');
  });

  it('generates held-binding autorepeat for the Dot example', () => {
    const dotSrc = readFileSync(path.join(import.meta.dirname, '../examples/dot.glim'), 'utf8');
    const { program } = parseGlimmer(dotSrc);
    const { source } = generateAzm(program!);
    expect(source).toContain('Glim_HeldKey:');
    expect(source).toContain('__PollNewPress:');
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
});

describe('CLI pipeline (generate + AZM contract injection)', () => {
  it('injects inferred contracts into the written file', async () => {
    const { main } = await import('../src/cli.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-cli-'));
    const entry = path.join(dir, 'dot.glim');
    writeFileSync(entry, readFileSync(path.join(import.meta.dirname, '../examples/dot.glim')));
    const status = main([entry]);
    expect(status).toBe(0);
    const out = readFileSync(path.join(dir, 'dot.main.asm'), 'utf8');
    // AZM inferred a tight contract for a movement block — far tighter
    // than any guess Glimmer could safely make.
    expect(out).toMatch(/;![^\n]*clobbers[^\n]*\n@Glim_MoveUp:/);
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
