---
layout: default
title: 'Chapter 2 - The Compile Pipeline'
parent: 'Glimmer Engineering Manual'
nav_order: 2
---

[<- Orientation and Repository Layout](01-orientation-and-repository-layout.md) | [Manual](index.md)

# Chapter 2 - The Compile Pipeline

The pipeline is three stages behind one entry point:

```
compileToAzm(text)          src/index.ts
  parseGlimmer(text)        src/parse.ts    -> GlimmerProgram | diagnostics
  generateAzm(program)      src/generate.ts -> AZM source | diagnostics
```

The programmatic entry point is `buildGlimmerProgram(entryPath, options)`
in `src/build.ts`, exported as `@jhlagado/glimmer/build`. It runs the
whole chain in process — no child processes, no printing; artifacts are
written to disk and everything else comes back as values, mirroring how
Debug80 consumes AZM's `@jhlagado/azm/compile` API. Its `stage` option
selects depth: `'generate'` writes the AZM source only; `'check'` also
runs AZM's register-contract checking without assembling (the generated
file declares `.contracts` policy; the mon3 register profile is applied
for MON-3 programs, and inferred output candidates are accepted for user
routines); `'build'` (default) instead assembles in a single AZM pass
into `.hex`, `.bin`, and `.d8.json` — contract checking rides along, and
since AZM 0.3 never rewrites the file, the map's line numbers agree with
the source exactly as generated — and rewrites the map. Diagnostics come back AZM-shaped (`severity`, absolute
`sourceName`, `line`/`column`, `code`), Glimmer parse errors included, so
a host reports both through one path.

For the map rewrite, `computeBlockMappings` anchors each block at its
`Glim_<Name>:` label in the generated asm text and verifies the body is
byte-for-byte verbatim; `rewriteD8Map` moves the matching segments onto
the `.glim` file (entry or part, from `EffectDecl.file` and `bodyLine`)
so Debug80 steps block bodies in Glimmer source while generated glue
stays on the generated asm. Blocks that fail verification are skipped
with a warning, never mapped wrongly.

The CLI (`src/cli.ts`) is a thin shell over this API: the default
command is stage `'check'` (`--no-check` drops to `'generate'`), and
`glimmer build` is stage `'build'`. It prints diagnostics as
`file:line:col: [code] severity: message` and writes the output next to
the entry file as `<name>.main.asm` — Debug80's entry-point naming
convention — unless `-o` overrides it.

## The program model

`src/model.ts` defines the model the parser produces and the generator
consumes:

- `TypeDecl` — a layout type compiled to an AZM Book 0 `.type` record
  (or `.typealias` for the alias form); fields are byte/word/addr, byte
  counts, or type expressions, validated (unknown references, recursion)
  at parse time
- `StateDecl` — named byte/word scalar state, byte array state with
  `length`, or typed state with `typeName` (typed `.ds` storage, no
  initializer); scalars carry an initial value, all state can set
  `changedOnStart`
- `PulseDecl` — one-frame transient cell, cleared by frame cleanup
- `TimerDecl` — oscillator or one-shot countdown that fires a pulse
- `RampDecl` — byte progress counter that marks itself changed and fires
  a pulse at the terminal step
- `SoundDecl` — low-frequency non-blocking matrix-profile cue, emitted as
  a generated `Snd_<Name>` wrapper over `SndStart`
- `CurveDecl` — build-time byte lookup table emitted as a page-aligned
  `Curve_<Name>` data table
- `RoutineDecl` — callable helper block: no triggers, no dispatch;
  emitted as a bare `.routine` boundary followed by an ordinary entry
  label, body verbatim, ret appended
- `CardDecl` — a screen/mode; `card` lines start sections, blocks carry
  `card`/`enter`/`goto` fields, and the generator emits the `Card`
  enum, the `CurrentCard` cell, card-gated dispatch, and the
  `GlimPrevCard` edge detector for enter blocks
- `ShapeDecl` — matrix-profile bitmap resource emitted as a `Shape_<Name>`
  row table and drawn through `ShapeDraw`
- `KeyBinding` — `bind key <KEY> rising -> <Pulse>` or, on TEC-1G,
  `bind key <KEY> held period <N> -> <Pulse>`
- `EffectDecl` — the shared model for `compute`, `effect`, and `render`
  blocks: name, phase (`derive` | `logic` | `render`), `on`
  trigger cells (stored as `depends`), `updates` cells, and a verbatim
  Z80 body captured between `begin` and `end`
- `GlimmerDiagnostic` — `{ line, message }`, line 0 for file-level issues

## Parsing

`parseGlimmer` is line-oriented. Comments start with `;` outside bodies;
block bodies are kept verbatim. Blocks declare as `compute` / `effect` /
`render` — the keyword is the phase (derive/logic/render) and enforces
kind constraints (`render` takes no `updates`; `compute` requires it).
Header lines accumulate `on` and `updates` until a line reading `begin`
opens the body, which runs until a line containing only `end`.

After the statement pass, `validateReferences` checks duplicate declared
names, reserved runtime/profile symbols, binding targets (must be declared
pulses), timer/ramp targets, sound cue profile constraints, curve preset
and byte-range constraints, byte-array length constraints, `on` triggers,
and `updates` targets. `on` accepts flag-carrying cells: states, pulses,
ramps, and the built-in `FrameCount`. `updates` accepts writable runtime
cells: states, timers, and ramps. Timer cells carry no change flag, so
blocks trigger on the timer's pulse rather than the timer cell. Byte arrays
are whole-state cells: one change flag for the array name, ordinary Z80
indexing in the body. Parsing returns a program only when there are no
diagnostics.

## Generation

`generateAzm` emits one AZM file in a fixed order: header, `.org`,
profile/API equates, key constants, change-flag constants, per-block
trigger masks, state/timer/ramp storage, the runtime loop,
`GlimPollBindings`, optional `GlimTickTimers`, per-phase dispatch
routines, optional `GlimMergeRaised`, wrapped user blocks,
`GlimEndFrame`, generated
curve tables, generated shape tables, generated sound cue wrappers, and
any profile library.

Everything platform/display-specific sits behind the Profile seam
(`src/profiles/`): a profile supplies the equates, input and
display-service storage, file-level data tables, the loop skeleton
(init; frame start = pacing policy + optional commit + the poll call;
frame end), the `GlimPollBindings` implementation, and the resource
wrappers + library tail. Three instances exist — `generic`,
`tec1g-mon3/matrix8x8` (scan-driven: the CPU is the display), and
`tec1g-mon3/tms9918` (vblank-paced with a commit phase flushing
name-table and sprite shadows to VRAM) — with MON-3 keypad input shared
by both TEC-1G profiles (`mon3-input.ts`). The reactive core (flags,
timers, dispatch, wrappers, rollover) is profile-independent. A
snapshot suite pins the generated output for every example byte-for-
byte, so seam refactors are provably behaviour-free and deliberate
generator changes carry their output diff in the same commit.

Notable constraints the generator honours:

- **Change-flag banks.** States, then pulses, then ramps, then
  `FrameCount` when used are assigned into up to four 8-bit banks, at most
  32 flag-carrying cells; exceeding it is a diagnostic, not a truncation.
- **Block-local labels.** Bodies are emitted byte-for-byte verbatim.
  AZM (>= 0.3) scopes `_name` labels to the nearest preceding non-local
  label, so every block can define its own `_done` with no rewriting —
  the `_` prefix is AZM's local-label syntax, and a plain label in a
  body is file-level (and truncates the block's `.routine` boundary).
  Verbatim bodies are part of the label-anchored source-mapping
  contract. `$` is never used in generated names: it is AZM's
  current-address operator and hex prefix, not label syntax; `__` names
  are AZM-reserved and never generated.
- **Fall-through bodies.** Block bodies must not `ret`; the generated
  wrapper appends `updates` change-marking and the final `ret`.
- **Register contracts are declared in-source.** The generated file
  opens with `.contracts strict` (TEC-1G profiles; the generic
  placeholder profile audits instead, since its API equates have no
  bodies to analyse) and every callable gets a `.routine` boundary:
  explicit clauses for the curated profile library, bare `.routine`
  (AZM infers from the body) for user blocks and routines. User-routine
  output candidates are accepted via the compile API's
  `acceptRegisterOutputCandidates` — a routine's outputs are whatever
  its body produces. AZM 0.3 never rewrites the file, so the
  label-anchored mapping contract (label -> body line offsets) holds
  trivially. Generated output passes strict checking under
  `--reg-profile mon3`; round-trip tests enforce this.

## The runtime

- **Rollover** (`ChangedN`/`RaisedN`/`NextN`): flag-carrying cells are
  allocated by category order (states, pulses, ramps, FrameCount) into up
  to four banks. Block updates
  raise into the target cell's `RaisedN` when every consumer is in a later
  phase (merged into `ChangedN` at phase boundaries by `GlimMergeRaised`) or
  into `NextN` when any consumer's phase already ran (rolled into
  `ChangedN` by `GlimEndFrame`). The now/next split is computed per block
  at compile time from the `on`/`updates` graph — exactly-once delivery,
  declaration order never semantic.
- **Timing widgets** tick in `GlimTickTimers` before any phase, raising
  directly into the target cell's `ChangedN`: oscillator timers (writable period cell +
  hidden `Glim_<name>_cnt` countdown), `once` timers (the cell is the
  countdown), ramps (step, flag the cell, fire at terminal), and
  `FrameCount` when used.
- **Held bindings** (tec1g) arm `Glim_HeldKey`/`Glim_HeldCount` on the
  new press and refire every period frames while `_scanKeys` reports
  the same key held.
- **Scan services**: `ScanFrame` calls `SndService` and `HudScanDig`
  once per row; the library adds `SndStart`, `HudWriteU16`,
  `HudBlankDig`, and the glyph/mask tables (adapted from the corpus
  shared layer, 0BSD).
- **Sound cues**: `sound Name len N div N` is implemented only for the
  matrix profile. The generator emits `Snd_Name` wrappers that load A/C
  and jump to `SndStart`; the scan service plays the cue in the background.
- **Curves**: `curve Name preset steps N from A to B` emits a page-aligned
  `Curve_Name` byte table. The compiler computes easing at build time;
  blocks index the table with ordinary Z80.
- **Shapes**: `shape Name color green` emits a `Shape_Name` table for the
  matrix profile. Rows are 1..8 by 1..8 quoted bitmaps using `X` and `.`;
  `ShapeDraw` is generated when any shape exists and draws the table from
  HL at B,C with no clipping.
- **Arrays**: `state Name : byte[N]` emits `.ds N, 0` storage and otherwise
  behaves as one state cell for `on`, `updates`, and change flags.
- **Flag banks**: more than eight flag-carrying cells allocate
  `Changed1`/`Raised1`/`Next1` and so on, capped at four banks. Dispatch
  emits bank-specific masks (`GlimDep_Name__B1`, etc.) and tests only the
  banks a block's triggers occupy.

## Multi-file loading (v0.4)

`src/load.ts` owns file composition: `loadGlimmerProgram(entryPath)`
parses the entry with `parseUnit`, resolves each `part` path relative
to the entry, parses parts in part-mode (which rejects entry-only
declarations), and hands all units to `assembleProgram` — merge into
one namespace, whole-program validation, diagnostics tagged with their
file. `parseGlimmer(text)` remains the single-file API and reports
`part` declarations as needing the loader. Imports are collected per
unit and emitted as a dedicated `.import` section after the frame
rollover. The CLI's `--deps` prints the reactive graph via
`depsReport`.

## Profiles

`generateAzm` selects a `Profile` from `program.platform` and
`program.display`:

- **Generic** (no `platform` statement): placeholder `API_*` equates,
  PrevKeys edge detection, flush-style loop. Kept for tests and for
  platform-neutral reading of the generated structure.
- **`tec1g-mon3` + `matrix8x8`**: MON-3/port equates, `_scanKeys`-based
  polling (RST $10; Z = pressed, carry = new press, so rising-edge
  bindings need no shadow byte; B holds the key code because `_scanKeys`
  may destroy DE), a scan-driven loop (`ScanFrame` shows one full frame
  with fixed row dwell, then effects run while the matrix is blank), a
  32-byte `Framebuffer` (8 rows x R,G,B,aux), and an emitted profile
  library: `ScanFrame`, `MxMask`, `FbPlot`, optional `ShapeDraw`, and
  `FbClear` — modeled on the corpus Tetro/Pacmo shared layer. Binding
  keys are validated against the MON-3 key-code table in `model.ts`
  (`TEC1G_KEY_CODES`).

## Verification

`test/parse.test.ts` covers the statement grammar and validation
diagnostics. `test/generate.test.ts` covers generated structure and the
round trip: the CounterToy example is compiled, written to a temp
directory, and assembled with the real `@jhlagado/azm` compile API; the
test fails on any AZM error diagnostic. This round trip is the guard that
keeps generated output honest against the assembler — keep it green.
