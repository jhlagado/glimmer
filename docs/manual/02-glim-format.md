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
`FbPlot` (B = x, C = y, A = colour bits), `ShapeDraw` when shapes are
declared, and `MxMask`.

See `examples/dot.glim` for the complete minimal program: a white dot
moved with keys 2/4/6/8, stopping at every edge.

## state

```
state Count : byte = 0 changed
state Score : word = 0
state Trail : byte[8] changed
```

Declares a state cell managed by the runtime. Types are `byte` and `word`.
The initial value is optional and defaults to 0. The `changed` modifier marks the cell
as already changed at startup so dependent effects run on the first
frame.

`byte[N]` declares byte array state. The generator emits `.ds N, 0`, the
whole array has one change flag, and the array name is legal in `on` and
`updates`. Indexing is ordinary Z80 inside blocks:

```asm
ld hl,Trail
ld a,(DotY)
ld e,a
ld d,0
add hl,de
ld (hl),%10000000
```

Array initializers and word arrays are not implemented yet.

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
rising-edge key binding onto a pulse for the generic profile: the pulse
fires on the frame the key is first pressed, not while it is held. The
TEC-1G matrix profile also supports held bindings, described below.

## part and import

```
part "trail-blocks.glim"
import "lib/double.asm"
```

Programs grow across files with `part`: the entry file declares
`program`, `platform`, and `display`, and each part contributes cells,
resources, bindings, and blocks to the same program and namespace —
the compilation unit is the project, files are storage. Paths resolve
relative to the entry file, and diagnostics name the file they come
from.

`import` brings a hand-written AZM module into the program: its `@`
labels become callable from any block, and its plain labels stay
private to the module. Glimmer places the `.import` where the module's
bytes land outside every execution path.

`glimmer --deps entry.glim` prints the program's dependency report:
for every cell, who raises it and which blocks it triggers — the
reactive graph, straight from the declarations.

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

## sound

```
sound Arrive len 24 div 3
sound Click len 2 div 10
```

Declares a non-blocking sound cue for the `tec1g-mon3` + `matrix8x8`
profile. Glimmer generates a callable routine for each cue:

```asm
call Snd_Arrive
```

The cue uses the matrix scan service, so `len` is measured in row ticks
(8 ticks is about one matrix frame with the current fixed dwell), and
`div` is the speaker divider: smaller values are higher pitch. This is
for low-frequency beeps and clicks, not music. Only one cue is active at
a time; starting a new cue replaces the current one.

## curve

```
curve SlideX ease_out steps 64 from 0 to 7
```

Declares a build-time byte table. The compiler computes the values and
emits a page-aligned AZM table named `Curve_<Name>`:

```asm
Curve_SlideX:
    .db ...
```

Curves are usually driven by ramps. A block reads the ramp cell and indexes
the generated table with ordinary Z80:

```asm
ld a,(Travel)
ld e,a
ld d,0
ld hl,Curve_SlideX
add hl,de
ld a,(hl)
```

Presets are `linear`, `ease_in`, `ease_out`, `ease_in_out`, `sine`,
`overshoot`, and `anticipation`. `from` and `to` are byte values; when
omitted they default to `0` and `steps - 1`.

## shape

```
shape Dot color green
  "XX"
  "XX"
end
```

Declares a small pixel-art resource for the `tec1g-mon3` + `matrix8x8`
profile. Rows are quoted strings using `X` for a lit pixel and `.` for
an empty pixel. The current matrix form is rectangular, 1 to 8 pixels
wide and 1 to 8 rows high.

Glimmer emits a table named `Shape_<Name>` and includes `ShapeDraw` when
at least one shape exists:

```asm
ld hl,Shape_Dot
ld b,3           ; x
ld c,2           ; y
call ShapeDraw
```

Colours are `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`, and
`white`, mapped to the profile `COLOR_*` constants. `ShapeDraw` ORs
the shape into the framebuffer and does no clipping; keep the whole
shape inside the 8x8 matrix.

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
frame). Blocks normally start sound through generated `Snd_<Name>` cue
routines, and may drive the HUD through library routines:

- `Snd_<Name>` — generated from `sound <Name> len <N> div <N>`; starts a
  low-frequency, non-blocking cue over the scan service.
- `SndStart` — lower-level helper used by generated sound cues; A =
  duration in row ticks, C = divider.
- `ShapeDraw` — generated when shapes exist; HL = `Shape_<Name>`, B =
  x, C = y. It draws into the framebuffer with no clipping.
- `HudWriteU16` — HL = value, shown as five decimal digits.
- `HudBlankDig` — clear the display.

## How changes travel between frames

Delivery of changes is exactly-once. A block's `updates` land the same
frame for blocks in later phases (compute -> effect -> render), and
roll over to the next frame when a depending block's phase has already
run — including blocks in the same phase, so the order you declare
blocks in never affects behaviour.

## Current limits

This is an early alpha. The present version supports at most 32 state,
pulse, ramp, and FrameCount flag cells per program (four change-flag
banks), a small TEC-1G matrix sound-cue backend rather than music,
byte-valued curve tables, 1..8 by 1..8 matrix shape resources, byte
arrays up to 256 entries, and placeholder system API addresses in the
generic profile. See the [roadmap](../roadmap.md) for what comes next.
