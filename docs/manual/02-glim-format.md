---
layout: default
title: 'Chapter 2 - The Glimmer Format'
parent: 'Glimmer Manual'
nav_order: 2
---

[<- Getting Started](01-getting-started.md) | [Manual](index.md)

# Chapter 2 - The Glimmer Format

A `.glim` file is line-oriented. Comments start with `;`. Inside effect
bodies, lines are passed to the generated AZM verbatim.

## program

```
program CounterToy
```

Names the program. Required, once per file.

## platform and display

```
platform tec1g-mon3
display matrix8x8
```

Optional, but declared together when used. They select the profile the
runtime is generated for.

Without them, the generic profile is used: placeholder API addresses,
suitable for tests and for reading the generated structure.

With `tec1g-mon3` + `matrix8x8`, the output targets the real TEC-1G under
MON-3: input is polled through the MON-3 `_scanKeys` API, key names are
MON-3 key codes (`KEY_0`..`KEY_F`, `KEY_PLUS`, `KEY_MINUS`, `KEY_GO`,
`KEY_AD`), and the generated loop is scan-driven — every frame the runtime
scans the whole 8x8 RGB matrix from a framebuffer with fixed row dwell,
then runs your effects while the matrix is blank. The generated file also
contains a small profile library your blocks can call: `FbClear`,
`FbPlot` (B = x, C = y, A = colour bits), and `MxMask`.

See `examples/dot.glim` for the complete minimal program: a white dot
moved with keys 2/4/6/8, stopping at every edge.

## state

```
state Count : byte = 0 changed
state Score : word = 0
```

Declares a state cell managed by the runtime. Types are `byte` and `word`.
The initial value is optional and defaults to 0. The `changed` modifier marks the cell
as already changed at startup so dependent effects run on the first
frame.

## pulse

```
pulse IncPressed
```

Declares a one-frame transient cell. Pulses are set by bindings or code,
consumed by effects, and cleared automatically at the end of every frame.

## bind

```
bind key KEY_1 rising -> IncPressed
```

Declares an input binding. In the current version the only form is a
rising-edge key binding onto a pulse: the pulse fires on the frame the key
is first pressed, not while it is held.

## timer and ramp

```
timer Blink : byte = 12 -> BlinkTick
timer Gate : word = 384 -> GateOpen once
ramp Travel : byte steps 64 -> Arrived
```

Timing widgets count once per frame and fire pulses.

A `timer` is an oscillator: its cell is the period — writable like any
state, so `updates Blink` changes the speed from the next cycle — and a
hidden countdown fires the pulse and reloads each time it runs out. With
`once` the cell is the countdown itself: it fires a single time when it
reaches zero and stays idle until your code writes it again.

A `ramp` is a progress counter for motion: each frame it steps toward
`steps - 1`, marking its cell changed at every step so `compute` and
`render` blocks can follow it, and fires its pulse on arrival. It idles
at the terminal value; writing the cell (usually to 0) starts it moving
again. Timer cells carry no change flag — trigger on the pulse; ramp
cells do, because the journey is the point.

The built-in `FrameCount` cell increments every frame and may be used
in `on` for blocks that run continuously.

## bind ... held

```
bind key KEY_4 held period 8 -> Left
```

A `held` binding fires on the first press like `rising`, then
autorepeats every `period` frames while the key stays down — the
standard movement pattern for action games. Available on the
tec1g-mon3 platform, where MON-3's `_scanKeys` reports held keys
directly.

## compute, effect, render

```
effect ApplyIncrement
    on IncPressed
    updates Count
begin
    ld hl,Count
    inc (hl)
    ld a,(hl)
    cp 10
    jr c,_done
    xor a
    ld (hl),a
_done:
end
```

A block is a named piece of Z80 with a declared reason to run. Its
declaration answers three different questions:

- The **keyword** — **when** in the frame it runs. Every frame executes
  the phases in a fixed order: `compute` blocks first (state computed
  from other state), then `effect` blocks (ordinary game logic, like
  `ApplyIncrement` above), then `render` blocks (state drawn to the
  display). The keyword also enforces the block's nature: `render`
  takes no `updates` clause, and `compute` requires one.
- `on` — **why** it runs. This is the trigger: the effect runs when any
  listed cell changed this frame. This is the one line that cannot
  be inferred — notice the body above never mentions `IncPressed` at
  all. The connection between the pulse and the code exists only here.
- `updates` — **what** it changes. After the effect runs, each listed
  state cell is marked changed, which is what triggers downstream effects
  (here, a render effect `on Count`). It is the effect's outward
  contract: a reader can trace the program's dataflow from `on` and
  `updates` lines alone, without reading any Z80.

`on` and `updates` are always explicit — why an effect runs and what it
changes are never implied. The body between `begin` and `end` is real
AZM assembly. AZM can stack instructions on one line, but Glimmer examples
prefer one instruction per line because it is easier to read and teach.

Labels using a single leading underscore are local to the block. Glimmer
rewrites them into globally unique labels in the generated output, so every
block can have its own `_done`.

Block bodies fall through — do not end them with `ret`. The generated
wrapper appends the change-flag bookkeeping and the `ret`.

## Sound and the seven-segment display

On the matrix profile, the generated scan loop services a speaker and
the six-digit seven-segment display once per scanned row (8 ticks per
frame). Blocks drive them through library routines:

- `SndStart` — A = duration in row ticks, C = divider (smaller is
  higher pitch); the tone plays out in the background.
- `HudWriteU16` — HL = value, shown as five decimal digits.
- `HudBlankDig` — clear the display.

## How changes travel between frames

Delivery of changes is exactly-once. A block's `updates` land the same
frame for blocks in later phases (compute -> effect -> render), and
roll over to the next frame when a depending block's phase has already
run — including blocks in the same phase, so the order you declare
blocks in never affects behaviour.

## Current limits

This is an early alpha. The present version supports at most 8 state and
pulse cells per program (one change-flag byte), one binding kind, and
placeholder system API addresses. See the
[roadmap](../roadmap.md) for what comes next.
