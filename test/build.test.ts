import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

    const status = main(['build', entry]);
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

    const status = main(['build', entry]);
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
    expect(main(['build', '--no-check', entry])).toBe(1);
  });
});
