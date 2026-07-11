import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { D8Map } from '../src/build.js';

function copyExample(dir: string, name: string): string {
  const target = path.join(dir, name);
  writeFileSync(target, readFileSync(path.join(import.meta.dirname, '../examples', name)));
  return target;
}

function readMap(dir: string, name: string): D8Map {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as D8Map;
}

function segmentsOf(map: D8Map, file: string): Array<{ line?: number; start?: number }> {
  return (map.files?.[file]?.segments ?? []) as Array<{ line?: number; start?: number }>;
}

describe('glimmer build (d8 map rewrite)', () => {
  it('attributes block-body segments to the .glim source', async () => {
    const { main } = await import('../src/cli.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-build-'));
    const entry = copyExample(dir, 'dot.glim');

    const status = await main(['build', entry]);
    expect(status).toBe(0);

    const map = readMap(dir, 'dot.main.d8.json');
    expect(map.fileList).toContain('dot.glim');
    expect(map.fileList).toContain('dot.main.asm');

    const glimSegments = segmentsOf(map, 'dot.glim');
    expect(glimSegments.length).toBeGreaterThan(0);

    // Every glim-attributed line is a real body line: its source text is
    // the instruction the segment was assembled from (verbatim contract).
    const glimSource = readFileSync(entry, 'utf8').split('\n');
    const asmSource = readFileSync(path.join(dir, 'dot.main.asm'), 'utf8').split('\n');
    for (const segment of glimSegments) {
      const text = glimSource[(segment.line ?? 0) - 1] ?? '';
      expect(asmSource).toContain(text);
      expect(text.trim()).not.toBe('');
    }

    // Generated glue stays on the generated asm.
    expect(segmentsOf(map, 'dot.main.asm').length).toBeGreaterThan(0);
  });

  it('attributes part-declared blocks to the part file', async () => {
    const { main } = await import('../src/cli.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-build-snake-'));
    const entry = copyExample(dir, 'snake.glim');
    copyExample(dir, 'snake-rules.glim');
    copyExample(dir, 'snake-lib.asm');

    const status = await main(['build', entry]);
    expect(status).toBe(0);

    const map = readMap(dir, 'snake.main.d8.json');
    expect(map.fileList).toContain('snake-rules.glim');

    // All snake blocks live in the part; the imported hand-written
    // library keeps its own attribution untouched.
    expect(segmentsOf(map, 'snake-rules.glim').length).toBeGreaterThan(0);
    expect(segmentsOf(map, 'snake-lib.asm').length).toBeGreaterThan(0);

    const rulesSource = readFileSync(path.join(dir, 'snake-rules.glim'), 'utf8').split('\n');
    const segment = segmentsOf(map, 'snake-rules.glim')[0]!;
    expect((rulesSource[(segment.line ?? 0) - 1] ?? '').trim()).not.toBe('');
  });

  it('rejects --no-check with build', async () => {
    const { main } = await import('../src/cli.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-build-nocheck-'));
    const entry = copyExample(dir, 'dot.glim');
    expect(await main(['build', '--no-check', entry])).toBe(1);
  });
});

describe('computeBlockMappings', () => {
  it('maps every body line at its exact generated-asm line', async () => {
    const { computeBlockMappings } = await import('../src/build.js');
    const body = ['    ld a,1', '    call Helper', '    ld (X),a', '_done:', '    nop'];
    const asm = [
      '; header',
      '.routine',
      'Glim_E:',
      '    ld a,1',
      '    call Helper',
      '    ld (X),a',
      '_done:',
      '    nop',
      '        ret',
    ].join(String.fromCharCode(10));
    const { mappings, warnings } = computeBlockMappings(
      asm,
      [{ label: 'Glim_E', name: 'E', body, bodyLine: 10 }],
      'prog.glim',
    );
    expect(warnings).toEqual([]);
    expect(mappings.map((m) => [m.asmLine, m.glimLine])).toEqual([
      [4, 10],
      [5, 11],
      [6, 12],
      [7, 13],
      [8, 14],
    ]);
  });
});

describe('buildGlimmerProgram (programmatic API)', () => {
  it('builds in process and returns artifact paths, no printing needed', async () => {
    const { buildGlimmerProgram } = await import('../src/build.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-api-'));
    const entry = copyExample(dir, 'dot.glim');

    const result = await buildGlimmerProgram(entry);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.asm).toBe(path.join(dir, 'dot.main.asm'));
    expect(result.artifacts!.hex).toBe(path.join(dir, 'dot.main.hex'));
    expect(result.artifacts!.bin).toBe(path.join(dir, 'dot.main.bin'));
    expect(result.artifacts!.d8).toBe(path.join(dir, 'dot.main.d8.json'));
    expect(result.mappedSegments).toBeGreaterThan(0);

    // The generated asm declares its contracts inline; the map matches it.
    const asm = readFileSync(result.artifacts!.asm, 'utf8');
    expect(asm).toContain('.contracts strict');
    expect(asm).toContain('.routine');
    expect(asm).not.toContain(';!');
    const map = readMap(dir, 'dot.main.d8.json');
    expect(map.fileList).toContain('dot.glim');
  });

  it('stops at generation for stage generate', async () => {
    const { buildGlimmerProgram } = await import('../src/build.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-api-gen-'));
    const entry = copyExample(dir, 'dot.glim');

    const result = await buildGlimmerProgram(entry, { stage: 'generate' });
    expect(result.artifacts).toEqual({ asm: path.join(dir, 'dot.main.asm') });
    // AZM never ran: no assembly artifacts exist, and the generated
    // source already carries its .routine contract declarations.
    const asm = readFileSync(path.join(dir, 'dot.main.asm'), 'utf8');
    expect(asm).toContain('.routine');
    expect(existsSync(path.join(dir, 'dot.main.hex'))).toBe(false);
    expect(existsSync(path.join(dir, 'dot.main.d8.json'))).toBe(false);
  });

  it('reports contract violations at the .glim line that caused them', async () => {
    const { buildGlimmerProgram } = await import('../src/build.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-diag-glim-'));
    const entry = path.join(dir, 'clobber.glim');
    // B is destroyed by _random; reading it after the RST is the classic
    // register-collision bug the contract check exists to catch.
    writeFileSync(
      entry,
      [
        'program Clobber',
        'platform tec1g-mon3',
        'display matrix8x8',
        'state X : byte',
        'pulse Go',
        'bind key KEY_1 rising -> Go',
        'effect Bad',
        '    on Go',
        '    updates X',
        'begin',
        '    ld b,5',
        '    ld c,ApiRandom',
        '    rst $10',
        '    ld a,b',
        '    ld (X),a',
        'end',
      ].join('\n'),
    );

    const result = await buildGlimmerProgram(entry);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    const mapped = errors.find((d) => d.sourceName.endsWith('.glim'));
    expect(mapped).toBeDefined();
    // The body spans clobber.glim lines 11..15.
    expect(mapped!.sourceName).toBe(entry);
    expect(mapped!.line).toBeGreaterThanOrEqual(11);
    expect(mapped!.line).toBeLessThanOrEqual(15);
  });

  it('reports parse failures as AZM-shaped diagnostics', async () => {
    const { buildGlimmerProgram } = await import('../src/build.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-api-diag-'));
    const entry = path.join(dir, 'bad.glim');
    writeFileSync(entry, 'program Bad\nstate X : nonsense\n');

    const result = await buildGlimmerProgram(entry);
    expect(result.artifacts).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic.severity).toBe('error');
    expect(path.isAbsolute(diagnostic.sourceName)).toBe(true);
    expect(diagnostic.line).toBeGreaterThan(0);
  });
});
