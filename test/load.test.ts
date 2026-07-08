import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '@jhlagado/azm/compile';

import { depsReport } from '../src/cli.js';
import { generateAzm } from '../src/generate.js';
import { loadGlimmerProgram } from '../src/load.js';
import { parseGlimmer } from '../src/parse.js';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-load-'));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return dir;
}

const ENTRY = `program Duo

state Count : byte = 0 changed

part "blocks.glim"
`;

const BLOCKS = `pulse Tick

timer Beat : byte = 4 -> Tick

effect Bump
    on Tick
    updates Count
begin
    ld hl,Count
    inc (hl)
end
`;

describe('loadGlimmerProgram', () => {
  it('merges parts into one program and namespace', () => {
    const dir = project({ 'duo.glim': ENTRY, 'blocks.glim': BLOCKS });
    const { program, diagnostics } = loadGlimmerProgram(path.join(dir, 'duo.glim'));
    expect(diagnostics).toEqual([]);
    expect(program?.name).toBe('Duo');
    expect(program?.states.map((s) => s.name)).toEqual(['Count']);
    expect(program?.pulses.map((p) => p.name)).toEqual(['Tick']);
    expect(program?.effects.map((e) => e.name)).toEqual(['Bump']);
  });

  it('enforces the shared namespace across files, with file-tagged diagnostics', () => {
    const dir = project({
      'duo.glim': ENTRY,
      'blocks.glim': `pulse Count\n${BLOCKS.replace('pulse Tick', 'pulse Tick2')}`,
    });
    const { program, diagnostics } = loadGlimmerProgram(path.join(dir, 'duo.glim'));
    expect(program).toBeNull();
    const dup = diagnostics.find((d) => d.message.includes('Duplicate name "Count"'));
    expect(dup?.file).toBe('blocks.glim');
  });

  it('keeps program/platform/display/part declarations entry-only', () => {
    const dir = project({
      'duo.glim': ENTRY,
      'blocks.glim': `program Impostor\nplatform tec1g-mon3\npart "more.glim"\n${BLOCKS}`,
    });
    const { diagnostics } = loadGlimmerProgram(path.join(dir, 'duo.glim'));
    const messages = diagnostics.map((d) => `${d.file}: ${d.message}`).join('\n');
    expect(messages).toContain('blocks.glim: Only the entry file declares the program name');
    expect(messages).toContain('blocks.glim: Only the entry file declares the platform');
    expect(messages).toContain('blocks.glim: Only the entry file declares parts');
  });

  it('reports missing part files against the part line', () => {
    const dir = project({ 'duo.glim': ENTRY });
    const { diagnostics } = loadGlimmerProgram(path.join(dir, 'duo.glim'));
    expect(diagnostics.map((d) => d.message).join('\n')).toContain(
      'Cannot read part "blocks.glim"',
    );
  });

  it('rejects part declarations in single-file parsing', () => {
    const { program, diagnostics } = parseGlimmer(ENTRY);
    expect(program).toBeNull();
    expect(diagnostics.map((d) => d.message).join('\n')).toContain(
      'part declarations need file loading',
    );
  });
});

describe('import statement', () => {
  it('emits imported modules outside every execution path and assembles', async () => {
    const dir = project({
      'app.glim': `program App

import "lib/double.asm"

state Value : byte = 1 changed
pulse Go
bind key KEY_1 rising -> Go

effect DoubleUp
    on Go
    updates Value
begin
    ld a,(Value)
    call Double
    ld (Value),a
end

render Show
    on Value
begin
    ld a,(Value)
    call API_DrawChar
end
`,
      'lib/double.asm': `;! in A; out A
@Double:
        add     a,a
        ret
`,
    });
    const { program, diagnostics } = loadGlimmerProgram(path.join(dir, 'app.glim'));
    expect(diagnostics).toEqual([]);
    const generated = generateAzm(program!);
    expect(generated.diagnostics).toEqual([]);
    expect(generated.source).toContain('.import "lib/double.asm"');
    // The import section sits after the frame rollover's ret.
    expect(generated.source.indexOf('.import')).toBeGreaterThan(
      generated.source.indexOf('@__EndFrame:'),
    );

    const entry = path.join(dir, 'app.main.asm');
    writeFileSync(entry, generated.source);
    const assembled = await compile(entry, { emitBin: true, emitHex: false, emitD8m: false });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('depsReport', () => {
  it('lists raisers and triggers per cell', () => {
    const dir = project({ 'duo.glim': ENTRY, 'blocks.glim': BLOCKS });
    const { program } = loadGlimmerProgram(path.join(dir, 'duo.glim'));
    const report = depsReport(program!);
    expect(report).toContain('program Duo');
    expect(report).toContain('Count : state byte');
    expect(report).toContain('raised by: Bump');
    expect(report).toContain('Tick : pulse');
    expect(report).toContain('raised by: timer Beat');
    expect(report).toContain('triggers:  Bump (logic)');
  });
});
