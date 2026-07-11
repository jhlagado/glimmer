import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
      'lib/double.asm': `.routine in A out A
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
      generated.source.indexOf('GlimEndFrame:'),
    );

    const entry = path.join(dir, 'app.main.asm');
    writeFileSync(entry, generated.source);
    const assembled = await compile(entry, { emitBin: true, emitHex: false, emitD8m: false });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('tetro (the acceptance test)', () => {
  it('loads with part + import, uses cards and a routine module, assembles strict-clean', async () => {
    const entry = path.join(import.meta.dirname, '../examples/tetro.glim');
    const { program, diagnostics } = loadGlimmerProgram(entry);
    expect(diagnostics).toEqual([]);
    expect(program?.imports.map((imp) => imp.path)).toEqual(['tetro-lib.asm']);
    expect(program?.cards.map((card) => card.name)).toEqual([
      'Splash',
      'Playing',
      'Paused',
      'GameOver',
    ]);

    const generated = generateAzm(program!);
    expect(generated.diagnostics).toEqual([]);
    expect(generated.source).toContain('Card              .enum Splash, Playing, Paused, GameOver');
    expect(generated.source).toContain('GlimPrevCard:');
    // Pieces are shape declarations now: the corpus tables are generated.
    expect(generated.source).toContain('ShapeRotPtrTable:');
    expect(generated.source).toContain('.db     2,0,2,0');
    expect(generated.source).toContain('ShapeId_PieceI    .equ 0');
    expect(generated.source).toContain('ShapeId_PieceL    .equ 6');
    expect(generated.source).toContain(
      '.dw     ShapeRot_PieceS_0, ShapeRot_PieceS_1, ShapeRot_PieceS_2, ShapeRot_PieceS_1',
    );
    // Enter edge gate: SetupPlaying (StartRound) must not re-run on the
    // conditional CurrentCard writes from ApplyGravity.
    expect(generated.source).toMatch(
      /ld {6}a,\(GlimPrevCard\)\n {8}cp {6}Card\.Playing\n {8}jr {6}z,_skip_StartRound/,
    );

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-tetro-'));
    writeFileSync(path.join(dir, 'tetro.main.asm'), generated.source);
    writeFileSync(
      path.join(dir, 'tetro-lib.asm'),
      readFileSync(path.join(import.meta.dirname, '../examples/tetro-lib.asm')),
    );
    const assembled = await compile(path.join(dir, 'tetro.main.asm'), {
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

describe('sprite-chase (the tms9918 acceptance test)', () => {
  it('loads, uses the vdp profile loop and commit phase, assembles strict-clean', async () => {
    const entry = path.join(import.meta.dirname, '../examples/sprite-chase.glim');
    const { program, diagnostics } = loadGlimmerProgram(entry);
    expect(diagnostics).toEqual([]);
    expect(program?.display).toBe('tms9918');

    const generated = generateAzm(program!);
    expect(generated.diagnostics).toEqual([]);
    // The written-to display: vblank pacing, then commit, then poll.
    expect(generated.source).toContain('call    VdpWaitVBlank');
    expect(generated.source).toMatch(
      /call {4}VdpWaitVBlank.*\n.*call {4}GlimCommit.*\n.*call {4}GlimPollBindings/,
    );
    expect(generated.source).toContain('GlimCommit:');
    expect(generated.source).toContain('NameShadow:');
    expect(generated.source).toContain('SpriteShadow:');
    // Resources are declarations: slot/index equates, generated upload,
    // and the sprite_at/tile_at ops (the first Glimmer-emitted AZM ops).
    expect(generated.source).toContain('Player            .equ 0   ; sprite slot + pattern');
    expect(generated.source).toContain('Target            .equ 1   ; sprite slot + pattern');
    expect(generated.source).toContain('Pip               .equ 1   ; tile index');
    expect(generated.source).toContain('op sprite_at(slot imm8, xcell imm16, ycell imm16)');
    expect(generated.source).toContain('LoadResourcesVram:');
    expect(generated.source).toContain('call    LoadResourcesVram');

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-chase-'));
    writeFileSync(path.join(dir, 'sprite-chase.main.asm'), generated.source);
    const assembled = await compile(path.join(dir, 'sprite-chase.main.asm'), {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'strict',
      registerContractsProfile: 'mon3',
    });
    expect(assembled.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('snake (first complete game)', () => {
  it('loads multi-file with import, uses two flag banks, assembles strict-clean', async () => {
    const entry = path.join(import.meta.dirname, '../examples/snake.glim');
    const { program, diagnostics } = loadGlimmerProgram(entry);
    expect(diagnostics).toEqual([]);
    expect(program?.imports.map((imp) => imp.path)).toEqual(['snake-lib.asm']);

    const generated = generateAzm(program!);
    expect(generated.diagnostics).toEqual([]);
    // 6 states + 6 pulses = 12 flags: the second bank is in use.
    expect(generated.source).toContain('Changed1:');
    expect(generated.source).toContain('.import "snake-lib.asm"');

    const dir = mkdtempSync(path.join(os.tmpdir(), 'glimmer-snake-'));
    writeFileSync(path.join(dir, 'snake.main.asm'), generated.source);
    writeFileSync(
      path.join(dir, 'snake-lib.asm'),
      readFileSync(path.join(import.meta.dirname, '../examples/snake-lib.asm')),
    );
    const assembled = await compile(path.join(dir, 'snake.main.asm'), {
      emitBin: true,
      emitHex: false,
      emitD8m: false,
      registerContracts: 'strict',
      registerContractsProfile: 'mon3',
    });
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
