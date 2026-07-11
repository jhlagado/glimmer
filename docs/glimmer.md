# Glimmer

**A scaffolding framework for Z80 programs: real assembly in small blocks,
reactive state, and generated glue.**

## 1. What Glimmer Is

Glimmer is a preprocessor and project format for the AZM assembler. A
Glimmer program is a `.glim` file: declarations of state, input bindings,
and effects, wrapped around small blocks of real Z80 assembly. The Glimmer
compiler turns that file into one readable AZM source file. AZM assembles
it into HEX, BIN, and Debug80 `.d8.json` map artifacts, ready for the
emulator, the debugger, or hardware.

```text
.glim source
-> Glimmer compiler
-> generated AZM source
-> AZM assembler
-> HEX / BIN / .d8.json artifacts
-> Debug80 / emulator / hardware
```

Glimmer is the project name. `Glim` is an acceptable short form, and
`.glim` is the source-file extension. Glimmer is a separate project from
TecMate/TECM8, which is ongoing and somewhat different.

The idea is a reimagined 1980s approach to programming a small computer.
The classic 1980s answer was BASIC: approachable, interactive, and a long
way from the machine. Glimmer starts from the other end. The programming
language is Z80 assembly — the real instruction set, real registers, real
flags — and Glimmer supplies the scaffolding around it: the main loop,
state management, input polling, display glue, and the wiring that
connects a keypress to your code and your code to the screen. You write
the behaviour; the framework builds the program around it.

Games are the first target because a game exercises everything at once:
input, timing, graphics, state, rules, sound, and performance. A runtime
that carries a game carries tools and utilities as a matter of course, so
the same model serves both.

The first hardware target is the TEC-1G single-board computer running
MON-3. The v0 implementation is working today: `.glim` programs compile,
assemble, and run on the TEC-1G's 8x8 RGB LED matrix under Debug80.

This document describes the programming model, the implemented v0
language, the runtime that Glimmer generates, and the direction of travel.
Companion documents cover the details:

- [Glim Grammar Reference](reference/glim-grammar.md) — the formal grammar
  and syntax design rules.
- [Roadmap](roadmap.md) — milestones, platform findings, and open
  questions.
- [Glimmer Manual](manual/index.md) — the user-facing manual draft.

## 2. The Programming Model

Glimmer programs are reactive. The mental model is:

```text
something changed
dependent block runs
output updates
```

Input changes state. Changed state triggers the blocks that depend on it.
Those blocks change more state, which triggers rendering. Every frame, the
generated runtime polls inputs, runs the effects whose triggers changed,
and clears the change flags. The chain from keypress to pixel is a set of
declarations you can read at a glance.

### 2.1 The Framework Owns The Loop, You Own The Behaviour

The generated runtime owns the mechanics of every frame:

- Input polling and edge detection.
- Change tracking.
- Deciding which effects run, and in which phase.
- Display scanout or flushing, per the selected display profile.
- End-of-frame cleanup.

Your blocks own the behaviour: move this dot, apply this rule, redraw this
value. Each block is a few lines of Z80 with one job. The framework calls
it at the right moment, for the reason you declared.

### 2.2 Real Z80, Visible Everywhere

The generated output is ordinary AZM source. Every equate, dispatch
routine, and wrapped block is in one file you can open, read, assemble,
and step through in Debug80 at source level. When you want to know what a
declaration costs, the answer is in the generated file, in the same
assembly language you write yourself. Glimmer adds no macro layer of its
own: callable conveniences are AZM `op` definitions and routines, emitted
into the generated source where you can see them.

### 2.3 One Polled Loop

The runtime polls. One loop services the keypad, state updates, effect
dispatch, and the display. Polling suits the hardware, keeps timing
visible, and means the whole program is one thread of control you can
follow instruction by instruction. Profiles may use interrupts internally
where the hardware benefits — a vertical-blank tick, for example — while
the programming model you work in stays a polled frame.

## 3. The Language

A `.glim` file is line-oriented. Every statement starts with a keyword.
Three symbols carry the whole syntax, each with one meaning:

| Symbol | Meaning       | Read it as    | Example                       |
| ------ | ------------- | ------------- | ----------------------------- |
| `:`    | has type      | "is a"        | `state Count : byte`          |
| `=`    | initial value | "starting at" | `state Count : byte = 0`      |
| `->`   | fires         | "fires"       | `bind key KEY_2 rising -> Up` |

`;` starts a comment, as in AZM. Every declaration reads aloud as an
English sentence: `state DotY : byte = 3` is "DotY is a byte, starting
at 3."

### 3.1 Program, Platform, Display

```text
program Dot

platform tec1g-mon3
display matrix8x8
```

`program` names the program. `platform` and `display` select the profile
the runtime is generated for — the hardware equates, the input mechanism,
and the shape of the main loop. Without them, Glimmer generates a generic
runtime with placeholder API addresses, useful for tests and for reading
the generated structure on its own.

### 3.2 State Cells

```text
state Count : byte = 0 changed
state Score : word = 0
state Trail : byte[8] changed
```

A state cell is a named variable managed by the runtime. Types are `byte`
and `word`. The initial value defaults to 0. The `changed` modifier
marks the cell as already changed when the program starts, so effects
that depend on it run on the first frame — the standard way to get an
initial draw.

Word cells are deliberately narrow (P7, closed 2026-07-11): they
store (`.dw`), carry an ordinary change flag, load into HL, and compare
with 16-bit arithmetic in bodies — Tetro's `Score` is the worked
example — and `timer ... : word` gives long countdowns. No runtime
widget beyond that is word-aware (ramps and curves are byte-valued by
design) until a real program needs one.

`byte[N]` declares byte array state. It emits initialized storage
(`.ds N, 0`), has one change flag for the whole array name, and is legal
in both `on` and `updates`. Glimmer does not add indexing syntax:
blocks index arrays with ordinary Z80.

#### Layout types

```text
type Point
    x : byte
    y : byte
end

type Piece
    origin : Point
    rows : 4
    color : byte
end

type Bag = Piece[7]

state Cursor : Point changed
state Pieces : Piece[7]
```

A `type` declaration names a memory layout. Glimmer names it; AZM owns
the type system — the declaration compiles to an AZM Book 0 `.type`
record (or `.typealias` for the `type Name = Expr` alias form), so
`sizeof`, `offset`, and layout casts work on these names in block
bodies as ordinary AZM:

```asm
    ld hl,Cursor + offset(Point, y)
    ld a,sizeof(Piece)
```

Field types are `byte`, `word`, `addr`, a byte count (`rows : 4`), or
another type (`origin : Point`, `cells : Point[4]`). State declared
with a type name — scalar or array — reserves zero-filled typed storage
(`.ds Point, 0`, `.ds Piece[7], 0`), takes no initializer, and carries
one change flag for the whole cell, exactly like byte arrays. Recursive
layouts are rejected at parse time.

### 3.3 Pulses

```text
pulse IncPressed
pulse FirePressed
```

A pulse is a one-frame cell that represents a transient command: a
keypress, a timer firing, a request raised by code. Pulses are set by
bindings or by your blocks, consumed by effects in the same frame, and
cleared automatically at frame end.

### 3.4 Bindings

```text
bind key KEY_1 rising -> IncPressed
```

A binding connects an input event to the pulse it fires. `rising` fires on
the frame the key is first pressed. The `->` arrow always points from an
event source to a pulse. Bindings compile to the polling code in the
generated runtime; on the TEC-1G profile that code reads the keypad
through MON-3's `_scanKeys` API, whose flags distinguish a new press from
a held key directly.

The TEC-1G profile also supports `held period N` bindings for
autorepeat movement. Future input sources, such as joystick bindings,
will extend the same shape.

### 3.5 Blocks: Compute, Effect, Render

```text
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

A block declaration is a named piece of Z80 with a declared reason to
run, and it answers three questions:

- The **keyword** — **when** in the frame it runs. `compute` blocks run
  first (state computed from other state), then `effect` blocks
  (ordinary game logic), then `render` blocks (state turned into
  pixels), so state settles before anything draws. Each keyword
  enforces its nature: a `render` block takes no `updates` clause — it
  depicts the world; a `compute` block requires one — producing state
  is its purpose.
- `on` — **why** it runs: the effect runs when any listed cell changed
  this frame. This line carries information found nowhere else — the
  block above never mentions `IncPressed`.
- `updates` — **what** it changes: the state cells this block mutates.
  Glimmer marks them changed after the block runs, which is what triggers
  the effects that depend on them. Glimmer reads the declaration, never
  the Z80, so the two levels stay separate: the assembly does the work,
  the header tells the framework about it.

The body between `begin` and `end` is the block: verbatim AZM assembly.
Blocks fall through — the generated wrapper appends the change
propagation and the final `ret`.

### 3.6 Blocks And Local Labels

The block is Glimmer's unit of code: a short, named piece of Z80 with one
job. Labels that begin with an underscore are local to their block by
convention:

```asm
    jr c,_done
    xor a
    ld (hl),a
_done:
```

The body passes into the generated file byte-for-byte verbatim. Locality
is AZM's doing, not a rewrite: every block compiles under a
`Glim_<Name>:` entry label, and AZM (0.3+) scopes `_name` labels to the
nearest preceding non-local label, so every block can have its own
`_done`. The leading underscore is AZM's local-label syntax, not just a
style convention: a plain label in a body is a file-level symbol (and
truncates the block's routine boundary), so block-internal branch
targets must use `_name`.

(`$` stays out of generated names: in AZM it is the current-address
operator and the hexadecimal prefix. Label privacy at file granularity is
AZM's `.import` mechanism: plain declarations in an imported unit are
private to it, and `@Name:` exports Name — the `@` is declaration
syntax only, never part of the lookup name.)

Style: one instruction per line. AZM's backslash stacking
(`ld a,(hl) \ inc hl`) remains available for dense passages, and single
instructions read better in examples and teaching material.

### 3.7 Routines

```text
routine ClampX
begin
    cp 8
    ret c
    ld a,7
end
```

A routine is a callable helper: a named piece of Z80 with no triggers
and no dispatch. Blocks call it with ordinary `call ClampX`. It compiles
to a public `@ClampX:` boundary — AZM infers and injects its register
contract like any other routine, and its plain labels are local to it.
The body falls through like a block body; the generator appends the
`ret` (conditional early returns like `ret c` are fine).

### 3.8 Cards

```text
card Splash

effect Start
    on GoPressed
    goto Playing
end

card Playing

enter SetupPlaying
    updates Score
begin
    xor a
    ld (Score),a
end

effect Advance
    on Tick
    updates Score
begin
    ...
end
```

A card is a screen or mode in the HyperCard sense: exactly one is
active. A `card` line starts a section — everything after it belongs to
that card until the next `card` line or end of file. There is no
closing keyword, so the language stays nesting-free; declarations
before the first `card` are global. Repeating a card name re-enters its
section (including from a part).

Cards generate an AZM enum (`Card .enum Splash, Playing`) and a
built-in state cell `CurrentCard`, initialized to the first card and
marked changed so the first card's `enter` blocks run on frame one.
Blocks in a card's section dispatch only while that card is active —
this is the flag-dispatch boilerplate cards absorb.

Card transitions land at frame boundaries, never mid-frame:
`CurrentCard` is the writable *next card* register, and every dispatch
gate tests a frame-latched copy (`GlimActiveCard`, latched once at the
top of the loop). A `goto` earlier in a frame therefore cannot leak
that frame's triggers into the destination card's blocks — the old
card's blocks finish their frame, and the destination activates at the
next frame start, with its `enter` blocks (delivered by the deferred
`CurrentCard` flag) running first.

`enter` blocks run once on card entry, and entry is edge-triggered:
the runtime keeps a previous-card shadow (`GlimPrevCard`) and an enter
block runs only when `CurrentCard`'s flag is delivered *and* the card
actually changed to its card. A block that marks `CurrentCard` changed
without switching cards cannot re-run enters. Enter blocks take
`updates` (and `goto`) but no `on`, and dispatch before the card's
other blocks in their phase.

`goto Playing` in a block header is an unconditional transition once
the block runs: the generated wrapper stores `Card.Playing` into
`CurrentCard` after the body, and the change propagates through the
ordinary flag machinery (a goto is an update of `CurrentCard`, and the
dependency report shows it). `begin` is optional when `goto` is
present, so header-only routing blocks close directly with `end`.

**Conditional navigation** is a conditional write: when a transition
depends on a runtime test, the block declares `updates CurrentCard`
and its body stores the card enum value on the branch that leaves —

```asm
    call SpawnPiece
    jr nc,_done
    ld a,Card.GameOver     ; blocked spawn: the game ends
    ld (CurrentCard),a
_done:
```

This is safe precisely because enters are edge-triggered: the
unconditional change-mark from `updates` cannot re-run them on frames
where the card did not change.

## 4. Terminology

One word, one meaning — the vocabulary follows the same discipline as the
symbols.

- **Block** — the unit of code: the Z80 between `begin` and `end`. Small,
  named, one job.
- **Card** — a screen or mode of the running program, in the HyperCard
  sense: Splash, Playing, GameOver. Exactly one card is active at a time,
  tracked by a built-in `CurrentCard` state cell. Cards are a planned
  construct; the design is in the sketches and roadmap.
- **State cell** — a named byte or word variable managed by the runtime.
- **Pulse** — a one-frame cell carrying a transient command.
- **Binding** — a declared connection from an input event to a pulse.
- **Compute / Effect / Render** — the three block declarations; the
  keyword is the phase. Why a block runs is `on`; what it changes is
  `updates` (never present on render).
- **Phase** — an ordering group within the frame: derive, logic, render.
  Input, commit, and cleanup phases belong to the generated runtime.
- **Profile** — the platform and display selection that shapes the
  generated runtime: equates, input mechanism, loop skeleton, and a small
  library of visible helper routines.
- **Resource** — a declared non-code asset compiled to generated routines
  or data tables. v0.3 implements matrix sound cues, curve tables, and
  matrix shape bitmaps; richer sprite, tile, and text resources remain in
  the sketches and roadmap.
- **Timer** — a countdown cell that fires a pulse. Implemented in
  oscillator form (reloads from a writable period cell) and one-shot
  form.
- **Ramp** — a byte progress counter that advances once per frame, marks
  itself changed while moving, and fires a pulse on arrival.

## 5. The Generated Runtime

### 5.1 The Frame

Every generated program is one loop. The generic profile's shape:

```asm
Start:
    call API_InitDisplay
MainLoop:
    call GlimPollBindings
    call GlimTickTimers
    call GlimRunDeriveEffects
    call GlimRunLogicEffects
    call GlimMergeRaised
    call GlimRunRenderEffects
    call API_FlushDisplay
    call GlimEndFrame
    jp MainLoop
```

A helper is generated only when the program needs it. A program with no
timers, ramps, or `FrameCount` gets no `GlimTickTimers`; a program with no
compute blocks gets no derive dispatcher; `GlimMergeRaised` appears only
when same-frame propagation across later phases is possible. The frame
reads top to bottom: poll, tick runtime widgets, run what changed, show it,
roll frame state forward, repeat.

Display profiles specialize the shape. On the TEC-1G matrix profile the
CPU is also the display controller, so the loop leads with the scanout:

```asm
MainLoop:
    call ScanFrame            ; show one full frame, then blank
    call GlimPollBindings     ; game work runs in the blank window
    call GlimTickTimers
    call GlimRunDeriveEffects
    call GlimRunLogicEffects
    call GlimMergeRaised
    call GlimRunRenderEffects
    call GlimEndFrame
    jp MainLoop
```

`ScanFrame` drives all eight matrix rows with a fixed per-row dwell, which
keeps brightness uniform however much work the frame does, and leaves the
matrix blank while effects run.

### 5.2 Change Flags

Change tracking is a flag bit per cell — the mechanism known
traditionally as dirty bits. Glimmer allocates up to four change-flag
bytes, so a program declares up to 32 flag-carrying cells: states,
pulses, ramps, and `FrameCount` when used. Bank assignment is by category:
all states first, then pulses, then ramps, then `FrameCount`, filling
`Changed0`, then `Changed1`, up to `Changed3`.

```asm
CHG_COUNT      .equ %00000001
CHG_INCPRESSED .equ %00000010
CHG_DECPRESSED .equ %00000100

Changed0:      .db CHG_COUNT  ; cells marked changed begin set
```

Each effect gets dependency masks built from its `on` list, and the phase
dispatcher tests only the banks the effect depends on:

```asm
    ld a,(Changed0)
    and GlimDep_DrawCount__B0
    jr z,_skip_DrawCount
    call Glim_DrawCount
_skip_DrawCount:
```

### 5.3 Update Propagation

`updates` compiles to change propagation in the block's wrapper:

```asm
Glim_ApplyIncrement:
    ; the block, byte-for-byte verbatim
    ld hl,Count
    inc (hl)

    ; generated: updates Count
    ld a,(Raised0)          ; deliver to later phases this frame
    or CHG_COUNT
    ld (Raised0),a

    ret
```

The v0.2 rule is exactly-once delivery. If every consumer of an updated
cell is in a later phase, the wrapper raises into that cell's `RaisedN`
bank and `GlimMergeRaised` makes it visible this frame. If any consumer
already ran or is in the same phase, the wrapper raises into that cell's
`NextN` bank; `GlimEndFrame` then makes it visible next frame. Declaration
order inside a phase is never semantic. Comparing old and new values
remains a future optimization.

### 5.4 Frame Cleanup

The generated `GlimEndFrame` clears pulse storage, drops consumed
same-frame raises, rolls each `NextN` into its matching `ChangedN`, and
clears `NextN`.
A pulse lives for exactly one frame; a change triggers its dependents
exactly once, either later in the current frame or in the next frame.

## 6. Platform: The TEC-1G

The TEC-1G is a Z80 single-board computer running the MON-3 monitor.
MON-3 provides the system API — keypad scanning, LCD, seven-segment
display, sound, serial — through `RST $10` calls. Glimmer programs load
at `$4000` and use these calls through generated equates.

Two displays matter to Glimmer:

- **The 8x8 RGB LED matrix** — implemented today as
  `display matrix8x8`. The CPU drives the matrix directly, row by row,
  so the generated loop is scan-shaped: one full frame of scanout, then
  effects in the blanking window. The profile emits the port equates,
  MON-3 key codes, a 32-byte framebuffer (8 rows of red, green, blue, and
  an aux byte), and a small visible library: `ScanFrame`, `FbClear`,
  `FbPlot`, optional `ShapeDraw`, and `MxMask`.
- **The TMS9918 VDP** — implemented as `display tms9918` (the TEC-Deck
  card, data port `$BE`, control port `$BF`). The VDP is a written-to
  display: it renders autonomously from its own 16 KiB of VRAM, so the
  generated loop takes the conventional commit shape, paced by the
  vertical-blank status flag — wait for vblank, **commit** (flush dirty
  shadows to VRAM in the blank window), poll, then the effect phases.
  Render blocks never touch VDP timing: they write ordinary memory —
  the name-table shadow (32x24, per-row dirty tracking) and the
  sprite-attribute shadow — through `NamePut`, `SpriteSet`, and
  `SpriteInit`, and `GlimCommit` streams what changed. The profile
  library carries the VDP access primitives (`VdpSetAddrWrite`,
  `VdpWriteBlock`, `VdpFill`, `VdpWaitVBlank`) for one-time uploads of
  patterns and colours (call them from an enter block, tables in an
  imported module). Sprites use contiguous slots from 0 (`VdpInit`
  hides all 32 with Y=$D1, which also terminates sprite processing at
  the first unused slot). Debug80 emulates the chip fully.

The two displays are architectural opposites — the matrix is a display
the CPU *is*, the VDP a display the CPU *writes to* — and both compile
from the same language: a profile owns the loop skeleton, pacing, the
render target, its library, and its resource meanings, while the
reactive core (state, flags, dispatch, rollover) is profile-independent.

One consequence of card gating worth knowing on any profile: a
card-gated block never sees change flags raised while its card was
inactive (the frame consumes them). When a card's renders depend on
cells that changed earlier, re-raise them on entry with an `enter`
block's `updates` list.

Debug80 is the development environment for both: it assembles through
AZM, runs the TEC-1G platform emulation, and gives source-level
breakpoints and stepping through the `.d8.json` map. The repository's
`debug80.json` carries ready targets for every matrix and VDP example.

Reference material for the platform lives in this repository:
`corpus/tetro` (two complete matrix games, Tetro and Pacmo) and
`corpus/tms9918` (three VDP demonstration programs). The corpus is the
benchmark for the format — each Glimmer feature is measured against what
these real programs need.

## 7. Source Model

A v0 program is one `.glim` file; the compiler generates one AZM file
beside it. The generated file has a fixed, readable order:

1. Header comment and `.org`.
2. Platform equates (ports, API calls, key codes) or generic
   placeholders.
3. Change-flag constants and per-block trigger masks.
4. State storage: cells, pulses, timers, ramps, runtime bytes, framebuffer.
5. The runtime loop.
6. Input polling.
7. Timer/ramp/frame-count ticking when needed.
8. Phase dispatchers and phase-boundary merge helpers.
9. The wrapped blocks.
10. Frame rollover.
11. Generated curve tables, shape tables, and sound cue wrappers.
12. The profile library.

The long-term source model grows into structured project records —
manifest, declarations, blocks, and resources as separately editable
pieces — with the generated output moving to AZM's `.import` modules for
real label privacy. Card-aware structure, resources, and Debug80-native
`.glim` source mapping build on the same pipeline. The roadmap holds the
sequence.

## 8. Example: Counter Toy

The smallest complete program: one state cell, two pulses, two bindings,
three effects.

Behaviour:

- Press `KEY_1`: increment `Count` (wraps at 10).
- Press `KEY_2`: decrement `Count` (wraps to 9).
- Whenever `Count` changes: redraw it.

```text
program CounterToy

state Count : byte = 0 changed

pulse IncPressed
pulse DecPressed

bind key KEY_1 rising -> IncPressed
bind key KEY_2 rising -> DecPressed

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

effect ApplyDecrement
    on DecPressed
    updates Count
begin
    ld hl,Count
    ld a,(hl)
    or a
    jr nz,_not_zero
    ld a,9
    ld (hl),a
    jr _done
_not_zero:
    dec (hl)
_done:
end

render DrawCount
    on Count
begin
    ld a,(Count)
    add a,'0'
    ld b,10
    ld c,5
    call API_DrawChar
end
```

The reactive chain is the whole program: `KEY_1` fires `IncPressed`;
`ApplyIncrement` runs because `IncPressed` changed and updates `Count`;
`DrawCount` runs in the render phase because `Count` changed. Nothing
calls anything by name across that chain — the declarations connect it.

The generated AZM follows the order in section 7. Selected pieces, as the
compiler emits them today — the storage and constants:

```asm
CHG_COUNT_BIT     .equ 0
CHG_INCPRESSED_BIT .equ 1
CHG_DECPRESSED_BIT .equ 2

CHG_COUNT         .equ %00000001
CHG_INCPRESSED    .equ %00000010
CHG_DECPRESSED    .equ %00000100

GlimDep_ApplyIncrement__B0 .equ CHG_INCPRESSED
GlimDep_ApplyDecrement__B0 .equ CHG_DECPRESSED
GlimDep_DrawCount__B0 .equ CHG_COUNT

Count:            .db 0
IncPressed:       .db 0
DecPressed:       .db 0
Changed0:         .db %00000001
```

The wrapped block, body verbatim (AZM scopes `_done` to the entry label)
with the `updates` propagation appended:

```asm
Glim_ApplyIncrement:
    ld hl,Count
    inc (hl)
    ld a,(hl)
    cp 10
    jr c,_done
    xor a
    ld (hl),a
_done:

    ld a,(Raised0)
    or CHG_COUNT
    ld (Raised0),a

    ret
```

And the frame rollover:

```asm
GlimEndFrame:
    xor a
    ld (IncPressed),a
    ld (DecPressed),a
    ld (Raised0),a
    ld a,(Next0)
    ld (Changed0),a
    xor a
    ld (Next0),a
    ret
```

## 9. Example: Dot On The Matrix

`examples/dot.glim` is the first hardware program: a white dot on the
TEC-1G's RGB matrix, moved with keypad keys arranged like arrows (2 up,
8 down, 4 left, 6 right), stopping at every edge.

```text
program Dot

platform tec1g-mon3
display matrix8x8

state DotX : byte = 3
state DotY : byte = 3 changed

pulse Up
pulse Down
pulse Left
pulse Right

bind key KEY_2 held period 8 -> Up
bind key KEY_8 held period 8 -> Down
bind key KEY_4 held period 8 -> Left
bind key KEY_6 held period 8 -> Right

effect MoveUp
    on Up
    updates DotY
begin
    ld a,(DotY)
    or a
    jr z,_stop    ; at the top: stop
    dec a
    ld (DotY),a
_stop:
end

; MoveDown, MoveLeft, MoveRight clamp the other three edges.

render DrawDot
    on DotX, DotY
begin
    call FbClear
    ld a,(DotX)
    ld b,a
    ld a,(DotY)
    ld c,a
    ld a,COLOR_WHITE
    call FbPlot
end
```

The effect syntax is the same as CounterToy; the profile changes the
runtime around it. The generated file polls the keypad through MON-3
`_scanKeys`, scans the framebuffer to the matrix ports with fixed dwell,
and includes the framebuffer library the render block calls. Build it, then
run AZM when you want the HEX, binary, and Debug80 map artifacts:

```sh
glimmer examples/dot.glim     ; writes examples/dot.main.asm and injects contracts
azm examples/dot.main.asm     ; writes .hex, .bin, and .d8.json
```

Open the folder in VS Code and press F5: Debug80 loads the MON-3 ROM,
runs the program, and shows the matrix panel. Breakpoints and stepping
work in the generated AZM at source level.

## 10. Direction

The near-term sequence, feature by feature, each proven against the
corpus games:

- **Held bindings and timers** — autorepeat movement and countdown pulses,
  the two input patterns every action game uses.
- **Resources and arrays** — sound cues, curve tables, matrix shape
  tables, and byte array state are implemented. Next are richer data
  tables.
- **Scale** — four change-flag banks are implemented; word-cell change
  semantics remain future work.
- **Cards** — screens and modes as first-class sections, with `enter`
  effects and generated card dispatch.
- **Project structure** — blocks and resources as separately editable
  records, `.import`-based output, dependency listings.
- **The TMS9918 profile** — the second display, with its commit-style
  loop.
- **Debug80 integration** — `.glim` as a recognized language with syntax
  highlighting, and glim-level source maps so breakpoints land in `.glim`
  lines.

The acceptance test for the whole direction: `tetro.glim` — the corpus
Tetro game, expressed as Glimmer declarations and blocks, generating an
AZM file that assembles into a playable game. A full draft of what that
file should look like is in `sketches/tetro.glim`.
