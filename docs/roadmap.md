# Glimmer Roadmap

Working document, 2026-07-06. Complements the design spec in
[glimmer.md](glimmer.md).

## The contract

Glimmer's essential contract is:

```
.glim file in  →  generated .asm (AZM) file out
```

Everything else — assembling, debug maps, emulation — belongs to AZM and
Debug80. Glimmer does not need to invoke AZM to be useful: the user (or a
build task, or Debug80 itself) runs `azm counter.main.asm` and gets `.hex`,
`.bin`, and a `.d8.json` Debug80 map. Keeping the generated AZM as the
canonical interface also serves the transparency principle: the user can
always read what Glimmer wrote.

Invoking AZM from Glimmer is a _convenience_, not a requirement, and it is
nearly free when we want it: `@jhlagado/azm` exposes a programmatic compile
API, it is already a dependency of this repo, and the test suite already
calls it. A `glimmer build` that goes glim → asm → hex/bin/d8 is roughly an
afternoon of work whenever it becomes worth having.

The long-term exception: source-level debugging of `.glim` files in Debug80
will eventually need a Glimmer-level map (glim line ↔ generated asm line),
analogous to how `.d8.json` maps asm lines to addresses. That is the point
where Glimmer becomes "a format used by Debug80" rather than a standalone
preprocessor. See "Debug80 integration and source mapping" below.

## The corpus

`corpus/` holds real TEC-1G programs copied into this repo as reference
source and as adaptation material: `corpus/tetro/` (the Tetro + Pacmo game
suite) and `corpus/tms9918/` (the three VDP demos). The central experiment
is rewriting them in the Glimmer paradigm to shake out the format's
shortcomings. The headline acceptance test:

**`tetro.glim` generates an AZM file that assembles into a playable
Tetro.**

Every feature milestone below should be checked against the corpus: if the
games do something Glimmer cannot express, that is a format bug.

The first pass of that experiment exists: `sketches/` contains
aspirational `.glim` drafts of Tetro (`sketches/tetro.glim`) and an
interactive TMS9918 program (`sketches/sprite-chase.glim`). They do not
compile; they define the target. The format proposals they raised —
P1 platform/display declarations, P2 array state, P3 cards, P4 held
bindings + timers, P5 routines, P6 resources, P7 word semantics,
P8 profile services, P9 curves and ramps — are catalogued in
`sketches/README.md` and map onto the milestones: P1/P8 land in
v0.1–v0.2, P4 in v0.2, P2/P6/P9 in v0.3, P5 in v0.4, structured
AZM-backed data in v0.5, P3 in v0.6, and P7 remains future word-cell
semantics work.

## What v0 does today

A single-file `.glim` program compiles to one AZM file:

- `program`, `state` (byte/word scalars, byte arrays, initial value,
  `changed`), `pulse`
- `bind key <KEY> rising -> <Pulse>`
- blocks — `compute` (derive), `effect` (logic), `render` — with `on`
  triggers, `updates`, and a verbatim Z80 body with block-local `_label`
  namespacing
- four change-flag banks (max 32 cells), generated polling/dispatch/cleanup glue
- placeholder `API_*` equates; CounterToy assembles end to end

The compiler pipeline shape (parse → validate → generate, diagnostics with
line numbers, round-trip assembly test) is the part that is "complete". The
_model_ is deliberately narrow.

## What Tetro and Pacmo teach us

The two real TEC-1G games (~/projects/tetro) are the target profile, and
they reshape the runtime model in one important way:

**On this hardware, the CPU is the display controller.** There are no
interrupts. The main loop is:

```asm
MainLoop:
    CALL ScanFrame      ; scan all 8 matrix rows with fixed dwell;
                        ; sound + 7-seg HUD serviced once per row tick
    CALL LogicTick      ; ALL game work runs while the matrix is blank
    JR   MainLoop
```

The spec's `poll → effects → flush` loop assumed a display you write to
(as the TMS9918 will be). The 8x8 RGB matrix is instead a display you
_are_: fixed row dwell keeps brightness uniform, and the entire game
budget is the inter-frame blanking period. Glimmer's "the runtime owns the
loop" principle fits perfectly — but the generated loop for this profile
must be scan-driven, with effect phases running inside the blank window.

Other concrete facts to build against:

- **Input** is MON-3 `_scanKeys` (`LD C,16 / RST 0x10`): Z = key held,
  Carry = new press. So `rising` bindings map directly onto the carry flag
  (no PrevKeys shadow needed), and real games also need a `held` binding
  kind with an autorepeat period (Tetro's MoveCooldown/MovePeriod/
  DropPeriod pattern) plus edge-only actions (rotation).
- **System calls**: MON-3 exposes ~58 RST 10H APIs (keys, LCD, 7-seg,
  beep/playNote/playTune, random, joystick, serial). These are the real
  replacements for the v0 `API_*` placeholder equates.
- **Hardware ports** (shared/constants.asm): digits 0x01, segs 0x02, LCD
  inst 0x04 / data 0x84, matrix row 0x05, red 0x06, green 0xF8, blue 0xF9;
  speaker on bit 7 of the digit latch.
- **Framebuffer contract**: front + back buffers, 8 rows x 4 bytes
  (R, G, B, aux), draw primitives (`FbSetCell`, `FbOrRow`, `MxMask`).
- **Resources in practice**: piece rotation bitmaps, colour tables, LCD
  script tables, tune tables — all `.db`/`.dw` ROM data. This is what the
  spec's resource concept compiles to.
- **Modes**: splash / running / paused / line-clear / game-over, dispatched
  from flags each frame — the spec's card/screen concept in the wild.
- **Memory layout**: user code at 0x4000 under MON-3; debug80.json targets
  with tec1g platform, bundled MON-3 ROM, appStart 16384.

## Milestones

Version numbers below (v0.1, v0.2, ...) are milestone labels for
sequencing work, not releases. npm publishing is a separate, later
decision: nothing ships to the registry until the project reaches a
minimum feature set and documentation level.

Each milestone keeps the round-trip test green (generated AZM must
assemble) and adds one example program that exercises the new ground.

**v0.1 — TEC-1G platform profile. ✅ Landed 2026-07-06 (first slice).**
`platform tec1g-mon3` + `display matrix8x8` generate MON-3/port equates,
`_scanKeys` rising-edge polling, a scan-driven loop (whole frame with
fixed dwell, effects in the blank window), a 32-byte framebuffer, and a
minimal profile library (ScanFrame, MxMask, FbPlot, FbClear). The repo
debug80.json carries a `dot` target. Example: `examples/dot.glim` — the
deliberately bare-bones input-to-pixel program (keypad-moved dot,
edge-clamped). The generic profile remains the default.

**Change-flag rollover. ✅ Fixed in v0.2 (the design note below was the
defect report).**
v0 clears all change flags at frame end, so a backward dependency —
logic updating a cell that a derive effect (or an earlier-declared
effect in the same phase) triggers on — is dropped, not deferred: the
earlier effect never fires. Two-line reproduction: logic `updates
Score`, `effect DifficultyCurve derive / on Score` — DifficultyCurve
never runs. Fix is the spec's CurrentDirty/NextDirty split: cleanup
rolls undispatched flags into the next frame instead of clearing them.
With rollover, backward edges work with a one-frame delay, and cycles
become bounded cross-frame feedback (one step per frame) rather than
lost updates. Stability guarantees that hold either way: every effect
runs at most once per frame; the frame is a single forward pass; frame
cost is bounded by effect count — no within-frame circularity is
possible by construction. Also: since `on`/`updates` declare the whole
dataflow graph, potential cycles are statically detectable — add a
compile-time cycle report (informational, not an error: cross-frame
feedback is legitimate).

**Lint backlog.** A plain (non-underscore) label defined inside a block
passes through verbatim and is global — two blocks defining `Loop:`
collide at assembly with an error pointing at generated code. Add a
Glimmer diagnostic suggesting `_loop`. Likewise the planned
"body updates a declared cell not listed in `updates`" warning.

**v0.2 — Matrix runtime, second slice. ✅ Landed 2026-07-07.**
`held period N` bindings (first press fires, then autorepeats;
tec1g-mon3); the timing widget family — `timer` (oscillator: writable
period cell + hidden countdown), `timer ... once` (one-shot countdown,
rearmed by writing), `ramp` (progress counter: steps each frame, cell
marked changed each step, completion pulse, idles at terminal,
retriggered by writing); built-in `FrameCount` (flag bit allocated only
when used); change-flag rollover (Raised0/Next0: raises whose consumers
are all later deliver same-frame at phase boundaries, raises any of
whose consumers already ran defer whole to next frame — exactly-once,
declaration order never semantic); per-row sound + seven-segment HUD
service in the scan loop with SndStart/HudWriteU16/HudBlankDig library
routines. Example: `examples/slide.glim` — press GO, a dot slides
across over 64 frames driven by a ramp through a compute block, a timer
blinks it, arrival beeps and bumps a HUD counter; `examples/dot.glim`
movement is now held-autorepeat. Both pass `--rc strict
--reg-profile mon3`. Remaining growth path: trail-drawing mode, then
snake.

**v0.3 — Resources and scale.** (Work plan: [plans/v0.3.md](plans/v0.3.md).) Declarative resources compiled to data
tables. Sound cues landed first: `sound Name len N div N` emits a
non-blocking `Snd_<Name>` wrapper over the matrix scan service for
low-frequency beeps and clicks. Curves landed next: `curve Name ease_out
steps N from A to B` emits page-aligned byte tables computed at build
time and driven by v0.2 ramps. Shapes are now implemented for the
matrix profile: `shape Name color green` emits row-bitmaps and
`ShapeDraw` renders them at B,C with no clipping. Byte array state has
also landed: `state Trail : byte[8]` emits `.ds 8, 0` and carries one
change flag for the whole array, demonstrated by `examples/trail.glim`.
Multiple change-flag bytes are now in place too: category order (states,
pulses, ramps, then `FrameCount`) fills up to four banks
(`Changed0`..`Changed3` plus matching `Raised` and `Next` banks), for 32
flag-carrying cells. Remaining scale work: later tunes/LCD text/scripts,
richer sprite/tile resources for non-matrix profiles, and word-state
change semantics. Landed examples are `counter.glim`, `dot.glim`,
`slide.glim`, and `trail.glim`.

**v0.4 — Project structure. ✅ First slice landed 2026-07-08**
(plan: [plans/v0.4.md](plans/v0.4.md)): `part "file.glim"` merges
declarations into one program/namespace with file-tagged diagnostics
(`examples/trail.glim` + `trail-blocks.glim`); `import "module.asm"`
brings AZM modules in, emitted outside every execution path;
`glimmer --deps` prints the writers/readers report per cell. Deferred
within the milestone: generated output as `.import` modules (file-layout
decision pending), per-block assemble/check, `.glim` libraries.

**Snake — the growth path's capstone — landed 2026-07-08:**
`examples/snake.glim` + `snake-rules.glim` (a part) + `snake-lib.asm`
(an imported hand-written module) is the first complete game in
Glimmer: ring-buffer body in array state, wrap-around movement, food,
growth, speedup via the writable timer period, eat/die sounds, score on
the HUD, GO to start and restart. Written with nothing beyond shipped
features — the v0.3 acceptance claim, now validated. Findings feed the
next milestones:

- **Cards evidence (v0.6):** the `Alive` guard opens StepSnake and
  StartGame — exactly the flag-dispatch boilerplate cards exist to
  absorb.
- **Structured-data evidence (v0.5):** the `Body + index` address
  arithmetic repeats five times across the game and its library; AZM
  layout types would name it once.
- **AZM profile gap:** the mon3 register-contract profile models calls
  13-16, 18, 54 but not 49 (`_random`: out A, destroys B) — snake mixes
  game state for food placement instead. A one-entry addition to AZM's
  profiles.ts unlocks the real call.
- The contract pipeline caught two genuine bugs while writing snake: a
  `jr` past the ±128 range in the long step block, and the
  read-after-RST liveness issue above. The checked build earns its
  keep.

Original scope: multi-file programs with merge semantics,
not textual inclusion: the entry file declares program/platform/display
and names its parts (`part "input.glim"`), and every part contributes
declarations to one program with one shared namespace — the compilation
unit is the project, files are storage. Alongside `part`, a Glimmer
`import "keyboard.asm"` statement brings an AZM module into the
generated program: AZM's `.import` is name-wise order-independent
(exports callable from any block, forward references resolve
program-wide; `@` labels public, plain labels private to the unit;
repeats idempotent) but emits the module's bytes at the import point —
so Glimmer places the directive in a dedicated section of the generated
file where bytes land safely, never inside a block's execution path.
`.include` remains available verbatim inside bodies for data tables,
where bytes at that exact spot are the intent. Also in this milestone:
per-block assemble/check, dependency listing (writers/readers of each
cell) as CLI output, and generated output moving to `.import` + `@`
exports so block privacy is real rather than naming-convention-deep.
Deferred beyond v0.4: `.glim` libraries (reusable pulse/effect/resource
kits) — they need a namespace story that `part` deliberately avoids.

**v0.5 — Structured data.** Byte arrays stay deliberately simple:
`state Trail : byte[8]` is still just one flag-carrying storage block,
emitted as initialized AZM storage. The next data step is structured
state backed by AZM Book 0 layout types: Glimmer records/aliases should
generate ordinary AZM `.type`, `.typealias`, typed `.ds`, `sizeof`, and
`offset` forms rather than inventing a parallel layout system. Candidate
syntax is intentionally deferred, but the target use cases are clear:
actor/entity arrays, sprite attribute tables, board cells, and packed
profile resources that Debug80 can inspect through AZM's existing symbol
and source-map artifacts. Runtime indexing remains explicit Z80 address
arithmetic; AZM layouts provide sizes, offsets, storage declarations, and
debuggable structure, not hidden runtime code. This should land before
large Tetro/Pacmo rewrites so game code does not grow a pile of manual
offset constants.

**v0.6 — Game profile.** Hooks and phases shaped by Tetro/Pacmo: actor
update, collision, mode/card dispatch (splash/running/paused/game-over as
first-class screens). Cards are optional sections for modal screens; only
one card is active at a time. Navigation is a block-header consequence,
not inline assembly: `goto Playing` sits beside `on` and `updates`, and
means "if this block runs, switch cards after its body." Because
`begin` marks the start of verbatim AZM, the AZM body is optional:
header-only routing blocks close with `end` and do not need an empty
`begin`/`end` pair. Blocks that both prepare state and navigate still use
`begin`/`end` for the Z80 setup body, and the declared `goto` remains
unconditional once the block runs. At this point rebuilding a recognizable
slice of Tetro in Glimmer is the acceptance test.

**Register contracts.** AZM formalizes register interfaces (`;!` in/
out/clobbers/preserves on `@` routine boundaries) and proves callers
against them — catching clobbered-loop-counter bugs at assemble time.
Glimmer now leans on this: every generated routine is a bare `@`
boundary, and the CLI drives AZM with Debug80's parameters
(`--contracts --rc error --reg-profile mon3`) so AZM infers and injects
each routine's true contract into the generated file — Glimmer supplies
boundaries, AZM supplies truth. Output passes `--rc strict
--reg-profile mon3` (test-enforced). Next steps: map contract
diagnostics to `.glim` lines via label-anchored mapping; pass `;!`
contracts on `routine` blocks through from `.glim` source; let profiles
ship `.asmi` interfaces for monitor APIs. The payoff for Glimmer users:
blocks call library and monitor routines constantly, and contracts turn
register collisions — the classic Z80 bug — into build-time errors.

**Later.** `glimmer build` convenience (invoke AZM's compile API);
glim-level debug maps for Debug80 stepping; TMS9918 profile; editor/browser
tooling; register contracts on generated wrappers.

## The TMS9918 profile (second display target)

The TEC-Deck video card puts a TMS9918A on the TEC-1G at data port $BE /
control port $BF, and Debug80 emulates it fully
(src/platforms/tec1g/tms9918.ts): 16 KiB VRAM, Graphics I, 256x192 output,
sprites (16x16 + magnify), status register with the vblank interrupt flag,
PAL/NTSC frame timing (~80k/~67k cycles per frame), and NMI delivery when
register 1 interrupt-enable is set. Reference programs:
~/projects/debug80-tec1g-mon3/src/tms9918-{sanity,video,demo}.main.asm.

Unlike the LED matrix, this is a _written-to_ display — the spec's original
`poll → logic → render → commit` loop fits directly. The demos establish
the canonical idioms Glimmer would generate or ship as profile library
code:

- register init from an 8-byte table (value, then index|0x80, via $BF)
- `SetWriteAddress` (address low, then high|0x40) + streamed `OUT ($BE)`
  block copies and fills
- conventional VRAM layout: pattern $0000, name $0800, sprite attributes
  $1B00, colour $2000, sprite patterns $3800
- tile patterns, colour tables, and sprite patterns as ROM `.db` tables —
  exactly what Glimmer resource declarations compile to
- frame pacing via delay or the status-register vblank flag (reading $BF
  clears it); the maxed-out demo also shows sprite flicker balancing by
  rotating attribute-table emission order each frame

Two Glimmer-shaped observations. First, the name table is a 32x24 grid of
tiles — the same 32x24 the spec uses to motivate one-screen blocks;
dirty-region display updates map naturally onto name-table cell writes, so
the commit phase can flush only dirty cells. Second, the matrix profile
(v0.2) and the TMS9918 profile differ almost entirely in the generated
loop skeleton and commit phase, which is strong evidence for the
profile-parameterized loop in the open questions below.

## Debug80 integration and source mapping

The goal: set a breakpoint in `tetro.glim`, press F5, and step through
Glimmer source. Three pieces make that work, in increasing order of
coupling.

**1. `.glim` as a recognized language (no Glimmer/AZM coupling).**
Debug80 already contributes file associations, TextMate grammars, and
language configuration for `.asm`/`.z80`/`.asmi`. A `.glim` grammar is the
same mechanism, and TextMate grammars support embedded languages — so the
Glimmer grammar highlights the declarative statements itself and delegates
everything between `begin` and `end` to the existing `z80-asm` grammar.
This piece is independent of debugging and can land early.

**2. The D8 map already supports multi-file attribution.**
The `.d8.json` format (schemas/d8-debug-map.schema.json in debug80,
written by AZM) maps address ranges to `{file, line, column, kind,
confidence}` — and `files` is a _dictionary of source files_, because
`.include`/`.import` already require attributing addresses to the file
that contributed them. Debug80 resolves breakpoints and stepping through
that dictionary. So glim-level debugging does not need a new format:
it needs address segments attributed to `counter.glim` lines instead of
(or alongside) generated `counter.main.asm` lines.

**3. Producing glim-attributed maps — three options.**

- **Option A — Glimmer composes (recommended first).** `glimmer build`
  compiles `.glim` → `.asm`, invokes AZM's programmatic compile API, then
  rewrites the resulting map: Glimmer knows exactly which generated asm
  lines came from which `.glim` lines (it wrote them), so segments inside
  user blocks are re-attributed to the `.glim` file, while generated
  glue stays attributed to the `.asm`. No changes to AZM or Debug80's map
  reader; stepping lands in `.glim` for user code and drops into readable
  generated AZM for glue — which is the transparency principle working
  as intended.
- **Option B — AZM gains a source-origin directive (durable mechanism).**
  A `#line`-style directive (e.g. `.loc "tetro.glim" 42`) in generated
  source, honoured by AZM's map writer, would let AZM emit correctly
  attributed maps natively. Cleaner than post-processing, keeps one map
  producer, and generalizes to any future source-generating tool, not
  just Glimmer. This is an AZM feature proposal to raise when Option A
  has proven the UX.
- **Option C — sidecar map composed by Debug80.** A separate
  `.glim.map.json` that Debug80 merges at load time. Most moving parts,
  least aligned with the existing architecture; not recommended.
- **Option D — label-anchored mapping (no new artifacts).** The generated
  naming convention is itself debug information. Every effect's code
  begins at `Glim_<Effect>:`, the `.d8.json` map records symbols with
  addresses, and block bodies are copied into the generated file
  verbatim, line for line (local-label renaming changes text, never line
  count). So a tool holding the `.glim`, the generated `.asm`, and the
  `.d8.json` can reconstruct the full mapping with zero extra metadata:
  the symbol gives the block's start, and body line k after the label
  corresponds to body line k after `begin`. Block-level mapping
  ("which effect is the PC in?") needs only the `.d8.json` and the
  convention. This depends on two promises the generator now makes —
  stable `Glim_*` naming and verbatim, line-preserving bodies — which
  should be treated as a contract once anything relies on them.

The build-orchestration question ("how does Debug80 know to run Glimmer?")
starts simple: a debug80.json target's `sourceFile` points at the
generated `.asm`, and Glimmer runs as a pre-build step or watch task.
Native `.glim` targets in debug80.json — where Debug80 invokes Glimmer
itself, as it already invokes its bundled AZM — is the eventual form of
"Glimmer as a Debug80-native type", and Option A's `glimmer build` is
deliberately shaped so Debug80 can call it the same way it calls AZM.

## Open questions

- How does a profile parameterize the generated loop — template per
  profile, or one loop skeleton with profile-supplied phases? (Tetro and
  Pacmo suggest per-profile ScanFrame policies with shared primitives.)
- Where does the boundary sit between generated glue and a static runtime
  include shipped with the profile (ScanTick, FbSetCell, sound service are
  library-shaped, not generated-shaped)?
- How far should Glimmer go with generated runtime glue before moving
  stable profile services into AZM `.import` libraries?
