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
    const bad = dot.replace('bind key KEY_2 rising -> Up', 'bind key KEY_TURBO rising -> Up');
    const { program, diagnostics } = parseGlimmer(bad);
    expect(program).toBeNull();
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('Unknown tec1g-mon3 key');
  });

  it('generated Dot source assembles and passes strict register contracts', async () => {
    const result = compileToAzm(dot);
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain('@Glim_DrawDot:');
    expect(result.source).toContain(';! clobbers A,BC,DE,HL,IX,IY');
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
