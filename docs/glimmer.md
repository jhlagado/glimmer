# Glimmer Interactive Runtime Specification

**Z80 fragments, reactive state, and game-first application creation**

## 1. Purpose Of This Document

This document defines the conceptual and technical foundation for a Z80-based
interactive software creation system called Glimmer.

Glimmer is the project name. `Glim` is an acceptable short form, and `.glim` is
the source-file extension.

Glimmer is a separate project from TecMate/TECM8, which is ongoing and somewhat
different.

The project began as a way to replace BASIC with something more suitable for
writing performant games on a Z80/TMS9918-class machine. It has since widened
into a broader idea:

> Build a compact 8-bit interactive-program runtime where games are the first
> and most demanding profile, but not the only possible kind of software.

The central idea is:

- User-visible programming language: real Z80 assembly.
- Source format: `.glim` meta-source.
- Project structure: small named fragments, or snippets of Z80.
- Runtime model: polling loop, state records, dirty bits, and generated glue.
- Creative model: resources, state, bindings, effects, and packaged output.

The current v0 implementation compiles a single `.glim` file into one readable
generated AZM source file. AZM then assembles that file into HEX, BIN, and
Debug80 `.d8.json` map artifacts. Later versions can add structured project
records and Debug80-native `.glim` source mapping without changing this
transparency contract.

This document is intended for a coding agent to use as a planning foundation.
It is not a final implementation spec. Syntax, memory layout, and naming can
change. The core philosophy should remain stable.

## 2. Philosophical Motivation

### 2.1 BASIC Was Not The Right Abstraction For Games

Many 1980s home computers shipped with BASIC because it was small, interactive,
and approachable. BASIC was good for teaching programming, experimenting, and
simple utilities.

However, BASIC was not ideal for performant games.

Typical problems:

- Too slow for frame-critical game logic.
- Poor fit for tiles, sprites, animation, collision, and frame timing.
- Encouraged unstructured "POKE", "PEEK", and "CALL" programming.
- Forced users to reinvent game loops, input, collision, animation, and
  drawing.
- Made larger programs hard to structure.
- Distributed programs as listings rather than compact runnable packages.

BASIC democratized access to programming, but it did not necessarily
democratize making good games.

This project asks:

> If designing an 8-bit game computer today, knowing what we now know, what
> should replace BASIC?

The answer proposed here is not a high-level language, and not simply "here is
an assembler." The answer is a structured environment where real Z80 code is
written in small, named, meaningful fragments and stitched together by a
runtime.

### 2.2 The User Should Learn The Machine

The project should not hide the machine behind a thick abstraction.

The user should learn:

- Registers.
- Flags.
- Conditionals.
- Loops.
- Indexed memory.
- Data tables.
- Calls and returns.
- State variables.
- Input polling.
- Display updates.
- Performance constraints.
- Hardware APIs.

The visible programming language should be Z80 assembly.

However, the user should not have to start by writing an entire game engine or
application runtime from scratch.

The machine should provide:

- A runtime loop.
- State management.
- Display/input/file/sound APIs.
- Asset/resource handling.
- Generated glue code.
- A small editor model.
- Debugger/build support.

The educational goal is:

> Teach machine code by letting the user modify meaningful behaviour inside a
> working interactive system.

### 2.3 Games Are The First Stress Test

Games remain the first target because they force the system to be honest.

A game needs:

- Input.
- Timing.
- Graphics.
- Sprites.
- State.
- Collision/rules.
- Sound.
- Display updating.
- Packaging.
- Performance discipline.

If the runtime can handle simple games, it can probably handle many non-game
interactive tools.

The reverse is not true. A simple menu utility runtime may not be strong enough
to handle games.

Therefore:

> Build the system game-first, but do not make it game-only.

### 2.4 Avoid A Desktop GUI Fantasy

This system is not trying to turn a TEC-1G-class machine into a modern desktop
platform.

It should not imply:

- Windows.
- Mouse-first UI.
- Object-oriented GUI framework.
- General event bus.
- Heap-heavy widgets.
- Dynamic component tree.
- Desktop application architecture.

The appropriate 8-bit model is much plainer:

```text
poll inputs
update state
run small routines
update changed display regions
repeat
```

This is closer to a game loop, a monitor, a card system, or a small interactive
appliance than to a modern desktop GUI.

## 3. Core Design Statement

The design can be summarized as:

> Glimmer programs are built from named one-screen Z80 fragments connected by
> state variables, bindings, effects, resources, and a compact polling-based
> runtime.

Or more mechanically:

```text
resources
+ state declarations
+ input/control bindings
+ effect declarations
+ named Z80 fragments
+ generated glue
+ runtime APIs
= generated AZM source
= runnable interactive program
```

The user writes Z80.

The system supplies the structure.

## 4. Key Principles

### 4.1 The Runtime Owns The Loop

The user should not normally write the entire main loop.

The runtime owns:

- Polling.
- Phase ordering.
- Input state.
- Dirty state tracking.
- Calling effect routines.
- Display flushing.
- Frame cleanup.
- Resource loading.
- System APIs.

The user supplies small routines at named points.

### 4.2 The User Owns Behaviour

User routines define behaviour:

- Increment this value.
- Move this actor.
- Update this sprite.
- React to this state change.
- Redraw this field.
- Render the next chunk of a computation.
- Save this document.
- Change this screen/card.

The system should avoid forcing the user to write boilerplate for common
runtime mechanics.

### 4.3 One-Screen Fragments Are A Feature

The TMS9918 display is typically constrained to around 32 columns by 24 lines in
text-oriented modes. This is not merely a limitation; it should shape the
programming model.

The preferred unit of code is a fragment, also called a snippet: a short named
routine that ideally fits on one screen.

This supports:

- Fast editing on constrained hardware.
- Less scrolling.
- Clearer routines.
- Better pedagogy.
- Smaller file operations.
- Direct jumping between fragments.
- Dependency navigation.
- Routine-level assembly/debugging.

A normal programming session should feel like:

```text
choose fragment
edit small Z80 routine
assemble/check
run/test
jump to related fragment
```

Not:

```text
open giant source file
scroll
search
edit
scroll more
```

### 4.4 Real Z80 Should Remain Visible

The system may provide conveniences, but it should not conceal the generated
assembly.

The user should be able to inspect:

- Their fragment source.
- Expanded/generated AZM.
- Generated labels.
- Generated wrappers.
- Final assembled AZM artifacts.
- Debug80 map.
- Machine code, if desired.

The educational promise depends on transparency.

### 4.5 Reactive State, Not GUI Callbacks

The system should avoid making the primary model "onclick handlers" or
desktop-style events.

Instead, use:

- State cells.
- Dirty bits.
- Pulses.
- Bindings.
- Effects.
- Phases.

A button, key, joystick input, timer, or slider should normally change state.
Dependent routines run because state became dirty.

The mental model is:

```text
something changed
dependent routine runs
output updates
```

Not:

```text
a widget called my event handler
```

### 4.6 Polling Is Natural

The system is likely to be polled rather than interrupt-driven for most
user-level behaviour.

This fits the hardware and the teaching model.

A polling loop can handle:

- Keyboard matrix.
- Joystick.
- Timers.
- Serial status.
- File/status flags.
- Dirty display regions.
- State updates.
- Cooperative long-running tasks.

Interrupts may exist at the system level, especially for timing or sound, but
the user-facing programming model should not depend on users understanding
interrupt-driven GUI events.

## 5. Terminology

The following terms are proposed. Names can change, but the concepts are
important.

### 5.1 Program / Project

A complete Glimmer software unit.

Contains:

- State declarations.
- Routine fragments.
- Resources/assets.
- Bindings.
- Effects.
- Build metadata.
- Package metadata.

### 5.2 Profile

A profile is a domain-specific layer over the same runtime.

Possible profiles:

- Game profile.
- Card/screen app profile.
- Utility profile.
- Music/art profile.
- Teaching/demo profile.
- Development-tool profile.

The runtime should support games first, but the underlying model should not be
game-only.

### 5.3 State Cell

A named variable managed by the runtime.

Example:

```text
state Count : byte
state Score : word = 0 dirty_on_start
state PlayerX : byte
```

State cells can be marked dirty when changed.

### 5.4 Pulse

A one-frame or one-cycle state cell used to represent a transient command or
input.

Example:

```text
IncPressed
FirePressed
SaveRequested
RenderStepRequested
```

A pulse is set by input or code, consumed by effects, then cleared
automatically.

### 5.5 Binding

A declarative link between an input/control and a state cell or pulse.

Examples:

```text
bind key KEY_1 rising -> IncPressed
```

Bindings generate polling/update code.

The implemented v0 binding form is rising-edge key input onto a pulse. Future
profiles may add held bindings, timers, joysticks, sliders, and other controls,
but `->` remains a pulse-firing arrow rather than an assignment operator.

### 5.6 Effect

A named routine that runs when one or more trigger cells are dirty.

Example:

```text
effect DrawScore
phase render
on Score
begin
    ld hl,(Score)
    call DrawScore_Z80
end
```

The routine body is Z80.

### 5.7 Phase

A phase is an ordering group in the runtime loop.

The user-declarable v0 effect phases are:

- Derive.
- Logic.
- Render.

`logic` is the default. Runtime-owned phases such as input, commit, cleanup, or
profile-specific scan/display phases are generated by the selected profile.
Phases prevent chaotic execution ordering.

### 5.8 Fragment / Snippet

A small named Z80 code fragment.

It is the primary editing unit.

A fragment has:

- Name.
- Kind.
- Phase or hook metadata.
- Dependencies.
- Writes list.
- Z80 body.
- Local labels.
- Generated wrapper.
- Source mapping.

### 5.9 Resource

A non-code data item.

Examples:

- Sprite.
- Tile.
- Tilemap.
- Screen/card layout.
- Font.
- Sound effect.
- Music pattern.
- Text block.
- File template.
- Palette/colour table.
- Numeric lookup table.

### 5.10 Hook

A named routine slot in a profile.

Game hooks might include:

```text
Actor_Init
Actor_Update
Actor_Touch
Room_Enter
Room_Tick
```

Card/app hooks might include:

```text
Card_Open
Card_Draw
Command_Run
Field_Changed
Screen_Tick
```

Hooks can be implemented as effects or direct runtime calls.

## 6. Hardware And Environment Assumptions

The target machine is conceptually:

- Z80 CPU.
- First target: TEC-1G under MON-3.
- Current implemented display profile: 8x8 RGB matrix.
- Future display profile: TMS9918-style VDP.
- 32-column by 24-line text-oriented display constraints where relevant.
- Tile/sprite graphics on video profiles.
- Limited RAM.
- Limited or slow filesystem/storage.
- Keyboard/keypad/joystick input.
- Possibly PSG-style sound.
- Possibly SD-card or TEC-FS-like storage.

Important implications:

- Text editing must respect a small display.
- Source files should not be enormous monolithic files.
- File access may be slow.
- Fragments should be small.
- Display updates should be dirty-region based where possible.
- Runtime structures should avoid large dynamic allocation.
- Generated code should be inspectable and reasonably compact.
- User routines should return quickly.
- Long computations should be chunked cooperatively.

### 6.1 Current Profiles

The generic profile is the default. It exists to keep the generated structure
easy to read and test: placeholder API equates, `PrevKeys` edge detection, a
flush-style loop, and no hardware-specific library.

The implemented hardware profile is:

```text
platform tec1g-mon3
display matrix8x8
```

This profile targets the TEC-1G under MON-3 and the 8x8 RGB matrix. It emits
MON-3 key codes, `_scanKeys` polling through `RST $10`, matrix port equates, a
32-byte framebuffer, a scan-driven loop, and a small visible profile library:
`ScanFrame`, `MxMask`, `FbPlot`, and `FbClear`.

The next major display profile under discussion is TMS9918. That profile is a
written-to display, so it is expected to use the more conventional
poll/logic/render/commit shape.

## 7. Source Model

### 7.1 The Project Is Not One Giant Source File

The long-term project should be stored as structured records, not primarily as a
single large file.

The current v0 implementation is deliberately simpler: one `.glim` file
contains the declarations and effect bodies for a program, and the compiler
generates one AZM file beside it.

Conceptual structure:

```text
Project
|-- manifest
|-- state declarations
|-- bindings
|-- effects
|-- fragments
|   |-- ApplyIncrement
|   |-- ApplyDecrement
|   |-- DrawCount
|   |-- PlayerUpdate
|   `-- RenderNextChunk
|-- resources
|   |-- sprites
|   |-- tiles
|   |-- maps
|   |-- cards/screens
|   `-- sounds
`-- build outputs
```

Each fragment can be loaded, edited, assembled, and saved independently.

This suits slow storage and small screens.

### 7.2 Build Output May Be One Generated AZM File

Although the source project is structured, the build process may generate a
single AZM file or module set.

Pipeline:

```text
.glim source
-> Glimmer compiler
-> generated AZM source
-> AZM assembler
-> HEX/BIN/.d8.json artifacts
-> Debug80/emulator/hardware
```

Generated AZM should include:

- Runtime API symbols.
- State storage.
- Dirty bits.
- Binding code.
- Phase dispatch code.
- Generated wrappers.
- User fragments.
- Cleanup code.
- Symbol/debug metadata.

### 7.3 Fragment-Local Labels

Fragments should support local labels.

For example, inside `ApplyIncrement`:

```asm
    jr c,.done
    xor a \ ld (hl),a
.done:
```

During code generation, local labels should be namespaced into ordinary,
globally unique AZM labels:

```asm
    jr c,FX_ApplyIncrement_done
    xor a \ ld (hl),a
FX_ApplyIncrement_done:
```

This avoids collisions between fragments.

Note on separators: `$` is not user-facing label syntax in AZM. It is reserved
for the current assembly address (`$ - TableStart`) and hexadecimal literals
(`$4000`). Generated labels therefore use a plain underscore separator and must
be globally unique across the assembled program. Label privacy, when needed,
comes from AZM's `.import` mechanism: `@Name:` labels are public exports and
plain labels are private to the imported source unit. Future AZM may internally
qualify private labels, but that is an implementation detail, not source syntax.

Fragment bodies fall through. They should not end with `ret`; the generated
wrapper appends dirty-bit propagation and the final `ret`.

## 8. One-Screen Fragment Editor

### 8.1 Basic Editor Philosophy

The primary editor should be card-based, not file-scroll-based.

A fragment should ideally fit on one TMS9918 page.

Possible layout:

```text
ApplyIncrement LOGIC
D:IncPressed W:Count
------------------------------
ld hl,Count \ inc (hl)
ld a,(hl) \ cp 10 \ jr c,.done
xor a \ ld (hl),a
.done:
------------------------------
A:asm B:run C:deps D:exit
err:
>
```

The editor should make it easy to:

- Select a fragment.
- Edit a fragment.
- Assemble/check current fragment.
- Jump to dependencies.
- Jump to writers/readers.
- See errors.
- Exit quickly.

### 8.2 Backslash Instruction Stacking

AZM currently supports a backslash delimiter for stacking multiple instructions
on one line when labels are not required before each instruction.

Example:

```asm
ld hl,Count \ inc (hl)
ld a,(hl) \ cp 10 \ ret c
xor a \ ld (hl),a \ ret
```

This is valuable because a 32-column display can show more program logic on one
page.

Style guidance:

- Stack straight-line instructions.
- Keep labels visible.
- Avoid over-stacking complex branch logic.
- Prefer clarity over maximum density.

### 8.3 Soft One-Screen Limit

A normal fragment should have a soft limit:

```text
fits on one 32x24 screen
```

If a fragment is too long, the editor can warn:

```text
Fragment exceeds one-screen style.
Consider splitting into helper fragment.
```

This should not necessarily be a hard error, but the system should encourage
small fragments.

### 8.4 Fragment Browser

The editor should include a fragment browser.

Example:

```text
FRAGMENTS
> ApplyIncrement
  ApplyDecrement
  DrawCount
  PlayerUpdate
  MoveLeft
  MoveRight
  CheckWall
```

Filters:

- All.
- Input.
- Logic.
- Render.
- Game.
- Card.
- Utility.
- Dirty writers.
- Dirty readers.

### 8.5 Dependency View

Because the system is reactive, navigation by dependency is important.

From `DrawCount`:

```text
DrawCount
on:
  Count

Count is written by:
  ApplyIncrement
  ApplyDecrement
```

From `ApplyIncrement`:

```text
ApplyIncrement
writes:
  Count

triggered by:
  IncPressed

causes:
  DrawCount
```

This helps the user understand the program without opening a long file.

## 9. Reactive Runtime Model

### 9.1 Basic Loop

The runtime loop should be simple and inspectable.

Conceptual loop:

```asm
MainLoop:
    call __PollBindings
    call __RunDeriveEffects
    call __RunLogicEffects
    call __RunRenderEffects
    call __CommitOutputs
    call __ClearFrameState
    jp MainLoop
```

A game profile may add frame synchronization and actor systems.

A card/app profile may add screen/card dispatch.

But the core shape remains:

```text
poll
update state
run dependent routines
draw/commit changes
cleanup
repeat
```

The implemented `tec1g-mon3` + `matrix8x8` profile already specializes this
shape: the runtime calls `ScanFrame` first to display one whole matrix frame
with fixed row dwell, then polls MON-3 keys and runs user effects while the
matrix is blank. The generic profile keeps the simpler flush-style loop shown
above.

### 9.2 State Cells And Dirty Bits

Each state cell has:

- ID.
- Name.
- Address.
- Size.
- Flags.
- Dirty bit position.
- Possibly initial value.

Small systems may use one dirty byte. Larger systems may use multiple dirty
bytes.

Example:

```asm
D_COUNT      .equ %00000001
D_INCPRESSED .equ %00000010
D_DECPRESSED .equ %00000100

Dirty0: .db D_COUNT
```

The current implementation uses one dirty byte, so v0 programs can declare at
most eight state and pulse cells. Multiple dirty bytes are a planned scale-up.

### 9.3 Pulses

Pulses are transient.

Example:

```text
IncPressed
DecPressed
FirePressed
SaveRequested
```

Pulses are set by bindings or routines, used by effects, then cleared.

This avoids callback-style event handlers.

### 9.4 Effects

Effects are routines that run when any of their `on` trigger cells are dirty.

Declaration:

```text
effect DrawCount
    phase render
    on Count
begin
    ld a,(Count)
    add a,'0'
    ld b,10
    ld c,5
    call API_DrawChar
end
```

Generated dispatch:

```asm
ld a,(Dirty0)
and FXDEP_DrawCount
jr z,__Skip_DrawCount
call FX_DrawCount
__Skip_DrawCount:
```

### 9.5 Writes And Dirty Propagation

Effects can declare which state cells they write.

Example:

```text
effect ApplyIncrement
    on IncPressed
    writes Count
```

Generated wrapper:

```asm
FX_ApplyIncrement:
    ; user code begins
    ld hl,Count \ inc (hl)
    ; user code ends

    ; generated because writes Count
    ld a,(Dirty0)
    or D_COUNT
    ld (Dirty0),a

    ret
```

Initial implementation should probably use the simple rule:

> If an effect declares writes X, mark X dirty after the effect runs.

Later, this may be optimized to compare old/new value.

### 9.6 CurrentDirty And NextDirty

A future implementation may need two dirty masks:

```text
CurrentDirty
NextDirty
```

Reason:

- Effects running in one phase may dirty state for a later phase.
- Some changes should take effect next frame.
- Dirty propagation can otherwise become order-sensitive.

Initial implementation may use a single dirty mask for simplicity.

The coding agent should evaluate when the second mask becomes necessary.

### 9.7 Phases

Suggested phases:

- Input.
- Derive.
- Logic.
- Render.
- Commit.
- Cleanup.

Definitions:

- `input`: poll hardware and update input state/pulses.
- `derive`: update derived state.
- `logic`: game/app logic.
- `render`: generate display changes.
- `commit`: write dirty output to VDP/sound/hardware.
- `cleanup`: clear pulses and consumed dirty bits.

User effects currently declare only `derive`, `logic`, or `render`; `logic` is
the default when no phase line is present. The other phases are runtime or
profile responsibilities.

Games may use:

- Input.
- Actor.
- Collision.
- Logic.
- Render.
- Commit.
- Cleanup.

But the general principle remains.

## 10. Example: Counter Toy

This is a minimal non-game example to prove the programming model.

### 10.1 Behaviour

- Press `KEY_1`: increment `Count`.
- Press `KEY_2`: decrement `Count`.
- Whenever `Count` changes: redraw `Count`.

### 10.2 User-Facing Meta-Source

```text
program CounterToy

state Count : byte = 0 dirty_on_start

pulse IncPressed
pulse DecPressed

bind key KEY_1 rising -> IncPressed
bind key KEY_2 rising -> DecPressed

effect ApplyIncrement
    on IncPressed
    writes Count
begin
    ld hl,Count \ inc (hl)
    ld a,(hl) \ cp 10 \ jr c,.done
    xor a \ ld (hl),a
.done:
end

effect ApplyDecrement
    on DecPressed
    writes Count
begin
    ld hl,Count
    ld a,(hl) \ or a \ jr nz,.not_zero
    ld a,9 \ ld (hl),a \ jr .done
.not_zero:
    dec (hl)
.done:
end

effect DrawCount
    phase render
    on Count
begin
    ld a,(Count) \ add a,'0'
    ld b,10 \ ld c,5
    call API_DrawChar
end
```

### 10.3 Generated Structure

The generator emits:

```asm
        .org    $4000

API_ReadKeys      .equ $8000
API_DrawChar      .equ $8003
API_FlushDisplay  .equ $8006
API_InitDisplay   .equ $8009

KEY_1_BIT         .equ 0
KEY_2_BIT         .equ 1

D_COUNT_BIT       .equ 0
D_INCPRESSED_BIT  .equ 1
D_DECPRESSED_BIT  .equ 2

D_COUNT           .equ %00000001
D_INCPRESSED      .equ %00000010
D_DECPRESSED      .equ %00000100

FXDEP_ApplyIncrement .equ D_INCPRESSED
FXDEP_ApplyDecrement .equ D_DECPRESSED
FXDEP_DrawCount   .equ D_COUNT

Count:            .db 0
IncPressed:       .db 0
DecPressed:       .db 0
PrevKeys:         .db 0
Dirty0:           .db %00000001

@Start:
    call API_InitDisplay

MainLoop:
    call __PollBindings
    call __RunLogicEffects
    call __RunRenderEffects
    call API_FlushDisplay
    call __ClearFrameState
    jp MainLoop
```

Generated binding code:

```asm
__PollBindings:
    call API_ReadKeys
    ld b,a

    ld a,(PrevKeys)          ; rising edge = now AND NOT before
    cpl
    and b
    ld c,a

    ld a,b
    ld (PrevKeys),a

    bit KEY_1_BIT,c
    jr z,__NoPulse_IncPressed
    ld a,1
    ld (IncPressed),a
    ld a,(Dirty0)
    or D_INCPRESSED
    ld (Dirty0),a
__NoPulse_IncPressed:
    bit KEY_2_BIT,c
    jr z,__NoPulse_DecPressed
    ld a,1
    ld (DecPressed),a
    ld a,(Dirty0)
    or D_DECPRESSED
    ld (Dirty0),a
__NoPulse_DecPressed:
    ret
```

Generated dispatch:

```asm
__RunLogicEffects:
    ld a,(Dirty0)
    and FXDEP_ApplyIncrement
    jr z,__Skip_ApplyIncrement
    call FX_ApplyIncrement
__Skip_ApplyIncrement:

    ld a,(Dirty0)
    and FXDEP_ApplyDecrement
    jr z,__Skip_ApplyDecrement
    call FX_ApplyDecrement

__Skip_ApplyDecrement:

    ret

__RunRenderEffects:
    ld a,(Dirty0)
    and FXDEP_DrawCount
    jr z,__Skip_DrawCount
    call FX_DrawCount
__Skip_DrawCount:

    ret
```

Wrapped user fragment:

```asm
FX_ApplyIncrement:
    ld hl,Count \ inc (hl)
    ld a,(hl) \ cp 10 \ jr c,FX_ApplyIncrement_done
    xor a \ ld (hl),a
FX_ApplyIncrement_done:

    ld a,(Dirty0)
    or D_COUNT
    ld (Dirty0),a

    ret
```

Cleanup:

```asm
__ClearFrameState:
    xor a
    ld (IncPressed),a
    ld (DecPressed),a
    ld (Dirty0),a
    ret
```

This example demonstrates:

- State declaration.
- Input binding.
- Pulse.
- Effect.
- Writes declaration.
- Dirty bit propagation.
- Generated wrapper.
- Generated dispatch.
- User-visible Z80.

## 11. Example: TEC-1G Matrix Dot

`examples/dot.glim` is the first hardware-backed vertical slice. It uses the
implemented `tec1g-mon3` + `matrix8x8` profile to move one white dot around
the TEC-1G RGB matrix with keypad keys 2, 4, 6, and 8.

The profile declaration is ordinary `.glim` source:

```text
program Dot

platform tec1g-mon3
display matrix8x8

state DotX : byte = 3
state DotY : byte = 3 dirty_on_start

pulse Up
pulse Down
pulse Left
pulse Right

bind key KEY_2 rising -> Up
bind key KEY_8 rising -> Down
bind key KEY_4 rising -> Left
bind key KEY_6 rising -> Right
```

Logic effects clamp the position at the matrix edges. A render effect redraws
the framebuffer whenever either coordinate changes:

```text
effect DrawDot
    phase render
    on DotX, DotY
begin
    call FbClear
    ld a,(DotX) \ ld b,a
    ld a,(DotY) \ ld c,a
    ld a,COLOR_WHITE
    call FbPlot
end
```

The important difference from CounterToy is not the effect syntax; it is the
profile-generated runtime. The generated AZM uses MON-3 `_scanKeys`, hardware
matrix ports, a fixed-dwell scan loop, and the visible framebuffer helpers
`FbClear`, `FbPlot`, `MxMask`, and `ScanFrame`.
