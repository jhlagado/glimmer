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

  it('parses byte array state', () => {
    const source = ['program P', 'state Board : byte[8] changed'].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.states).toEqual([
      {
        name: 'Board',
        type: 'byte',
        length: 8,
        initial: 0,
        changedOnStart: true,
        line: 2,
      },
    ]);
  });

  it('validates byte array state semantics', () => {
    expect(parseGlimmer('program P\nstate Board : byte[0]').diagnostics[0]?.message).toContain(
      'State Board: array length must be between 1 and 256',
    );
    expect(parseGlimmer('program P\nstate Board : byte[$1G]').diagnostics[0]?.message).toContain(
      'State Board: array length must be between 1 and 256',
    );
    expect(parseGlimmer('program P\nstate Words : word[4]').diagnostics[0]?.message).toContain(
      'State Words: only byte arrays are supported',
    );
    expect(parseGlimmer('program P\nstate Board : byte[8] = 1').diagnostics[0]?.message).toContain(
      'State Board: array state takes no initializer',
    );
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

  it('parses matrix shape resources', () => {
    const source = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'shape Dot color green',
      '  "XX"',
      '  ".X"',
      'end ; comment allowed on resource terminators',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.shapes).toEqual([
      {
        name: 'Dot',
        color: 'green',
        rows: ['XX', '.X'],
        width: 2,
        height: 2,
        line: 4,
      },
    ]);
  });

  it('validates shape resource semantics', () => {
    const genericShape = ['program P', 'shape Dot color green', '  "X"', 'end'].join('\n');
    expect(
      parseGlimmer(genericShape)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Shape resources require platform tec1g-mon3 with display matrix8x8');

    const badColor = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'shape Dot color orange',
      '  "X"',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(badColor)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Shape Dot: unknown color "orange"');

    const ragged = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'shape Dot color green',
      '  "XX"',
      '  "X"',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(ragged)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Shape Dot: all rows must have width 2');

    const wide = [
      'program P',
      'platform tec1g-mon3',
      'display matrix8x8',
      'shape Dot color green',
      '  "XXXXXXXXX"',
      'end',
    ].join('\n');
    expect(
      parseGlimmer(wide)
        .diagnostics.map((d) => d.message)
        .join('\n'),
    ).toContain('Shape Dot: width and height must be between 1 and 8');
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
      'state Changed1 : byte',
      'state Raised2 : byte',
      'state Next3 : byte',
      'pulse GlimTick',
      'sound Snd_Beep len 24 div 3',
      'curve Curve_Move linear steps 8',
      'shape Shape_Dot color green',
      '  "X"',
      'end',
    ].join('\n');
    const { diagnostics } = parseGlimmer(source);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('Reserved name "Framebuffer"');
    expect(messages).toContain('Reserved name "Changed1"');
    expect(messages).toContain('Reserved name "Raised2"');
    expect(messages).toContain('Reserved name "Next3"');
    expect(messages).toContain('Reserved name "GlimTick"');
    expect(messages).toContain('Reserved name "Snd_Beep"');
    expect(messages).toContain('Reserved name "Curve_Move"');
    expect(messages).toContain('Reserved name "Shape_Dot"');
  });

  it('parses layout types, aliases, and typed state', () => {
    const source = [
      'program P',
      'type Point',
      '    x : byte',
      '    y : byte',
      'end',
      'type Piece',
      '    origin : Point',
      '    rows : 4',
      '    color : byte',
      'end',
      'type Pieces = Piece[7]',
      'state Cursor : Point changed',
      'state Bag : Piece[7]',
      'pulse Go',
      'bind key KEY_1 rising -> Go',
      'effect E',
      '    on Go',
      '    updates Cursor',
      'begin',
      '    nop',
      'end',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.types.map((t) => t.name)).toEqual(['Point', 'Piece', 'Pieces']);
    expect(program?.types[1]?.fields).toMatchObject([
      { name: 'origin', type: 'Point' },
      { name: 'rows', type: '4' },
      { name: 'color', type: 'byte' },
    ]);
    expect(program?.types[2]?.alias).toBe('Piece[7]');
    expect(program?.states[0]).toMatchObject({
      name: 'Cursor',
      typeName: 'Point',
      changedOnStart: true,
    });
    expect(program?.states[1]).toMatchObject({ name: 'Bag', typeName: 'Piece', length: 7 });
  });

  it('parses routines and rejects triggers on them', () => {
    const source = [
      'program P',
      'routine Clamp',
      'begin',
      '    cp 8',
      '    ret c',
      '    ld a,7',
      'end',
      'routine Bad',
      '    on Go',
      'begin',
      'end',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('Routine Bad takes no "on"');
    expect(program).toBeNull();
    const ok = parseGlimmer(
      ['program P', 'routine Clamp', 'begin', '    cp 8', 'end'].join('\n'),
    );
    expect(ok.diagnostics).toEqual([]);
    expect(ok.program?.routines[0]).toMatchObject({ name: 'Clamp', bodyLine: 4 });
  });

  it('parses card sections, enter blocks, and goto headers', () => {
    const source = [
      'program P',
      'state Score : byte',
      'pulse Go',
      'bind key KEY_1 rising -> Go',
      'effect Global',
      '    on Go',
      'begin',
      '    nop',
      'end',
      'card Splash',
      'effect Start',
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
      'render Draw',
      '    on Score',
      'begin',
      '    nop',
      'end',
    ].join('\n');
    const { program, diagnostics } = parseGlimmer(source);
    expect(diagnostics).toEqual([]);
    expect(program?.cards.map((c) => c.name)).toEqual(['Splash', 'Playing']);
    const byName = new Map(program!.effects.map((e) => [e.name, e]));
    expect(byName.get('Global')?.card).toBeUndefined();
    // Header-only routing block: goto with no begin, empty body.
    expect(byName.get('Start')).toMatchObject({ card: 'Splash', goto: 'Playing', body: [] });
    // goto folds into updates so dataflow machinery sees it.
    expect(byName.get('Start')?.updates).toContain('CurrentCard');
    // enter: card entry is the trigger.
    expect(byName.get('SetupPlaying')).toMatchObject({ card: 'Playing', enter: true });
    expect(byName.get('SetupPlaying')?.depends).toEqual(['CurrentCard']);
    expect(byName.get('Draw')?.card).toBe('Playing');
  });

  it('rejects card misuse', () => {
    const source = [
      'program P',
      'pulse Go',
      'enter Early',
      'begin',
      'end',
      'card Splash',
      'effect Bad',
      '    on Go',
      '    goto Nowhere',
      'end',
      'enter WithOn',
      '    on Go',
      'begin',
      'end',
      'render Router',
      '    on Go',
      '    goto Splash',
      'begin',
      'end',
      'state CurrentCard : byte',
    ].join('\n');
    const { diagnostics } = parseGlimmer(source);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('enter Early must be inside a card section');
    expect(messages).toContain('goto target "Nowhere" is not a declared card');
    expect(messages).toContain('enter WithOn takes no "on"');
    expect(messages).toContain('render Router cannot goto');
    expect(messages).toContain('Reserved name "CurrentCard"');
  });

  it('rejects bad type declarations and typed-state misuse', () => {
    const source = [
      'program P',
      'type Empty',
      'end',
      'type NoEnd',
      '    x : byte',
      'type Loop',
      '    self : Loop',
      'end',
      'type Dup',
      '    a : byte',
      '    a : word',
      'end',
      'state S : Missing',
      'state T : Point = 3',
      'type Point',
      '    x : byte',
      'end',
    ].join('\n');
    const { diagnostics } = parseGlimmer(source);
    const messages = diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('Type Empty has no fields');
    expect(messages).toContain('missing end');
    expect(messages).toContain('recursive');
    expect(messages).toContain('duplicate field "a"');
    expect(messages).toContain('unknown type "Missing"');
    expect(messages).toContain('typed state takes no initializer');
  });
});
