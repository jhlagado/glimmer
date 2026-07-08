import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseGlimmer } from '../src/parse.js';

const counterToy = readFileSync(path.join(import.meta.dirname, '../examples/counter.glim'), 'utf8');

describe('parseGlimmer', () => {
  it('parses the CounterToy example', () => {
    const { program, diagnostics } = parseGlimmer(counterToy);
    expect(diagnostics).toEqual([]);
    expect(program).not.toBeNull();
    expect(program?.name).toBe('CounterToy');
    expect(program?.states).toEqual([
      expect.objectContaining({ name: 'Count', type: 'byte', initial: 0, changedOnStart: true }),
    ]);
    expect(program?.pulses.map((p) => p.name)).toEqual(['IncPressed', 'DecPressed']);
    expect(program?.bindings).toEqual([
      expect.objectContaining({ kind: 'key', key: 'KEY_1', target: 'IncPressed' }),
      expect.objectContaining({ kind: 'key', key: 'KEY_2', target: 'DecPressed' }),
    ]);
    expect(program?.effects.map((e) => e.name)).toEqual([
      'ApplyIncrement',
      'ApplyDecrement',
      'DrawCount',
    ]);
    const draw = program?.effects[2];
    expect(draw?.phase).toBe('render');
    expect(draw?.depends).toEqual(['Count']);
    expect(draw?.body.join('\n')).toContain('call API_DrawChar');
  });

  it('reports a missing program declaration', () => {
    const { program, diagnostics } = parseGlimmer('pulse Fire\n');
    expect(program).toBeNull();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Missing program') }),
    );
  });

  it('reports an unterminated body', () => {
    const source = ['program P', 'pulse Go', 'effect E', 'on Go', 'begin', 'ret'].join('\n');
    const { diagnostics } = parseGlimmer(source);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('missing end') }),
    );
  });

  it('rejects extra words on a block declaration line', () => {
    const source = [
      'program P',
      'pulse Go',
      'effect E teleport',
      'on Go',
      'begin',
      'ret',
      'end',
    ].join('\n');
    const { diagnostics } = parseGlimmer(source);
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('takes a single name');
  });

  it('maps block keywords to phases and enforces their constraints', () => {
    const good = [
      'program P',
      'state A : byte',
      'state B : byte',
      'compute C',
      'on A',
      'updates B',
      'begin',
      'end',
      'render D',
      'on B',
      'begin',
      'end',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(good);
    expect(diagnostics).toEqual([]);
    expect(program?.effects[0]?.phase).toBe('derive');
    expect(program?.effects[1]?.phase).toBe('render');

    const renderUpdates = [
      'program P',
      'state A : byte',
      'render D',
      'on A',
      'updates A',
      'begin',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(renderUpdates)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('render D cannot update state cells');

    const computeNoUpdates = [
      'program P',
      'state A : byte',
      'compute C',
      'on A',
      'begin',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(computeNoUpdates)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('compute C must declare updates');
  });

  it('reports an undeclared dependency', () => {
    const source = ['program P', 'effect E', 'phase logic', 'on Ghost', 'begin', 'ret', 'end'].join(
      '\n',
    );
    const { diagnostics } = parseGlimmer(source);
    expect(diagnostics.map((d) => d.message).join('\n')).toContain('undeclared cell "Ghost"');
  });

  it('rejects a binding onto an undeclared pulse', () => {
    const source = ['program P', 'bind key KEY_1 rising -> Nope'].join('\n');
    const { diagnostics } = parseGlimmer(source);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('not a declared pulse') }),
    );
  });

  it('rejects duplicate names across the shared namespace', () => {
    const source = ['program P', 'state X : byte', 'pulse X'].join('\n');
    const { diagnostics } = parseGlimmer(source);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Duplicate name "X"') }),
    );

    const effectClash = [
      'program P',
      'state Draw : byte',
      'pulse Go',
      'effect Draw',
      'on Go',
      'begin',
      'end',
    ].join('\n');
    expect(parseGlimmer(effectClash).diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Duplicate name "Draw"') }),
    );
  });

  it('parses timers, ramps, and held bindings', () => {
    const source = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'pulse Tick',
      'pulse DoneP',
      'pulse Fire',
      'timer Blink : byte = 12 -> Tick',
      'timer Gate : word = 384 -> DoneP once',
      'ramp Travel : byte steps 64 -> Fire',
      'bind key KEY_4 held period 8 -> Tick',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.timers).toEqual([
      expect.objectContaining({ name: 'Blink', type: 'byte', initial: 12, once: false }),
      expect.objectContaining({ name: 'Gate', type: 'word', initial: 384, once: true }),
    ]);
    expect(program?.ramps).toEqual([
      expect.objectContaining({ name: 'Travel', steps: 64, target: 'Fire' }),
    ]);
    expect(program?.bindings[0]).toEqual(
      expect.objectContaining({ edge: 'held', period: 8, target: 'Tick' }),
    );
  });

  it('validates timer and ramp semantics', () => {
    const timerInOn = [
      'program P',
      'pulse Tick',
      'timer Blink : byte = 12 -> Tick',
      'effect E',
      'on Blink',
      'begin',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(timerInOn)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('timer cells carry no change flag');

    const heldGeneric = ['program P', 'pulse Go', 'bind key KEY_1 held period 8 -> Go'].join('\n');
    expect(
      parseGlimmer(heldGeneric)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Held bindings require platform tec1g-mon3');

    const frameCount = [
      'program P',
      'state X : byte',
      'compute C',
      'on FrameCount',
      'updates X',
      'begin',
      'end',
    ].join('\n');
    expect(parseGlimmer(frameCount).diagnostics).toEqual([]);
  });

  it('parses matrix sound cue resources', () => {
    const source = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Arrive len 24 div 3',
      'sound Click len 2 div 10',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.sounds).toEqual([
      expect.objectContaining({ name: 'Arrive', len: 24, div: 3 }),
      expect.objectContaining({ name: 'Click', len: 2, div: 10 }),
    ]);
  });

  it('parses curve resources', () => {
    const source = [
      'program P',
      'curve SlideX ease_out steps 64 from 0 to 7',
      'curve Linear linear steps 8',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.curves).toEqual([
      expect.objectContaining({
        name: 'SlideX',
        preset: 'ease_out',
        steps: 64,
        from: 0,
        to: 7,
      }),
      expect.objectContaining({
        name: 'Linear',
        preset: 'linear',
        steps: 8,
        from: 0,
        to: 7,
      }),
    ]);
  });

  it('validates curve resource semantics', () => {
    const unknownPreset = ['program P', 'curve Move elastic steps 8 from 0 to 7'].join('\n');
    expect(
      parseGlimmer(unknownPreset)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Curve Move: unknown preset "elastic"');

    const badSteps = ['program P', 'curve Move ease_out steps 1 from 0 to 7'].join('\n');
    expect(
      parseGlimmer(badSteps)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Curve Move: steps must be between 2 and 256');

    const malformedFrom = ['program P', 'curve Move ease_out steps 8 from $1G to 7'].join('\n');
    expect(
      parseGlimmer(malformedFrom)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Curve Move: from/to values must be bytes between 0 and 255');

    const duplicate = ['program P', 'state Move : byte', 'curve Move linear steps 8'].join('\n');
    expect(parseGlimmer(duplicate).diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Duplicate name "Move"') }),
    );
  });

  it('validates sound cue semantics', () => {
    const genericSound = ['program P', 'sound Beep len 24 div 3'].join('\n');
    expect(
      parseGlimmer(genericSound)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Sound cues require platform tec1g-mon3 with display matrix8x8');

    const badLen = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Beep len 0 div 3',
    ].join('\n');
    expect(
      parseGlimmer(badLen)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Sound Beep: len must be between 1 and 255 row ticks');

    const badDiv = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Beep len 24 div 0',
    ].join('\n');
    expect(
      parseGlimmer(badDiv)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Sound Beep: div must be between 1 and 255');

    const malformedLen = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Beep len $1G div 3',
    ].join('\n');
    expect(
      parseGlimmer(malformedLen)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Sound Beep: len must be between 1 and 255 row ticks');

    const malformedDiv = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'sound Beep len 24 div %102',
    ].join('\n');
    expect(
      parseGlimmer(malformedDiv)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Sound Beep: div must be between 1 and 255');

    const duplicate = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'pulse Beep',
      'sound Beep len 24 div 3',
    ].join('\n');
    expect(parseGlimmer(duplicate).diagnostics).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining('Duplicate name "Beep"') }),
    );
  });

  it('rejects reserved names', () => {
    const source = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'state Framebuffer : byte',
      'pulse GlimTick',
      'sound Snd_Beep len 24 div 3',
      'curve Curve_Move linear steps 8',
    ].join('\n');
    const { diagnostics } = parseGlimmer(source);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('Reserved name "Framebuffer"');
    expect(messages).toContain('Reserved name "GlimTick"');
    expect(messages).toContain('Reserved name "Snd_Beep"');
    expect(messages).toContain('Reserved name "Curve_Move"');
  });
});
