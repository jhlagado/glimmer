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

Invoking AZM from Glimmer is a _convenience_, not a requirement, and
`glimmer build` (landed 2026-07-09) provides it: glim → annotated asm →
`.hex`/`.bin`/`.d8.json` in one command, with the debug map rewritten so
block-body lines step in `.glim` source. The plain `glimmer` command still
stops at generated AZM, which remains the canonical interface.

The long-term exception: source-level debugging of `.glim` files in Debug80
will eventually need a Glimmer-level map (glim line ↔ generated asm line),
analogous to how `.d8.json` maps asm lines to addresses. That is the point
where Glimmer becomes "a format used by Debug80" rather than a standalone
preprocessor. See "Debug80 integration and source mapping" below.

## The corpus

`corpus/` holds real TEC-1G programs copied into this repo as reference
source and adaptation material: `corpus/tetro/` (Tetro + Pacmo) and
`corpus/tms9918/` (three VDP demos). They are pressure tests, not first
publish blockers.

The first pass of that experiment exists in `sketches/`: aspirational
`.glim` drafts of Tetro (`sketches/tetro.glim`) and an interactive TMS9918
program (`sketches/sprite-chase.glim`). They define future shape. First
publish only needs the smaller proof already in `examples/`.

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

## First publish line

First publish means Glimmer is useful as a small, Debug80-friendly Z80
game framework. It does not mean Glimmer can express every future game or
every platform profile. The line is:

- the CLI is stable enough to generate AZM from `.glim`
- generated AZM assembles and passes the AZM register-contract workflow
- examples are small, readable, and Debug80-ready
- documentation explains the implemented language, not the whole dream
- the package builds cleanly and can be installed

Anything that does not serve that line moves after first publish.

## Delivered core

**TEC-1G platform profile. ✅ Landed 2026-07-06.**
`platform tec1g-mon3` + `display matrix8x8` generate MON-3/port equates,
`_scanKeys` rising-edge polling, a scan-driven loop (whole frame with
fixed dwell, effects in the blank window), a 32-byte framebuffer, and a
minimal profile library (ScanFrame, MxMask, FbPlot, FbClear). The repo
debug80.json carries a `dot` target. Example: `examples/dot.glim` — the
deliberately bare-bones input-to-pixel program (keypad-moved dot,
edge-clamped). The generic profile remains the default.

**Change-flag rollover. ✅ Landed 2026-07-07.**
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
possible by construction.

**Lint backlog.** ~~Plain labels inside blocks collide globally~~ —
resolved upstream 2026-07-09: AZM 0.2.17 scopes plain labels to their
enclosing `@` routine, so block labels are local by construction and
Glimmer's `_label` renaming was removed (bodies are now byte-for-byte
verbatim). Still open: the "body updates a declared cell not listed in
`updates`" warning.

**Matrix runtime. ✅ Landed 2026-07-07.**
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
--reg-profile mon3`.

**Resources and scale. ✅ Landed 2026-07-08.** (Work plan:
[plans/v0.3.md](plans/v0.3.md).) Declarative resources compiled to data
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
flag-carrying cells. Landed examples are `counter.glim`, `dot.glim`,
`slide.glim`, and `trail.glim`.

**Project structure, first slice. ✅ Landed 2026-07-08**
(plan: [plans/v0.4.md](plans/v0.4.md)): `part "file.glim"` merges
declarations into one program/namespace with file-tagged diagnostics
(`examples/trail.glim` + `trail-blocks.glim`); `import "module.asm"`
brings AZM modules in, emitted outside every execution path;
`glimmer --deps` prints the writers/readers report per cell. Deferred
within the milestone: generated output as `.import` modules (file-layout
decision pending), per-block assemble/check, `.glim` libraries.

**Snake. ✅ Landed 2026-07-08, not a publish blocker.**
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
- **AZM profile gap:** ~~the mon3 profile did not model call 49~~ —
  closed 2026-07-09: AZM 0.2.17 models `_random` (out A, destroys B),
  the generator emits `ApiRandom .equ 49`, and snake's food placement
  uses the real call.
- The contract pipeline caught two genuine bugs while writing snake: a
  `jr` past the ±128 range in the long step block, and the
  read-after-RST liveness issue above. The checked build earns its
  keep.

## Remaining before first publish

These are the items that still matter before drawing the line:

1. **Clean build and package.** `npm run build`, `npm run typecheck`,
   `npm run lint`, and the test suite pass; package metadata and exported
   files are correct.
2. **Debug80-ready workflow.** Generated `<name>.main.asm`, `.hex`, `.bin`,
   and `.d8.json` examples are current. `debug80.json` points at useful
   targets. The first-publish docs explain how to build and run through
   Debug80.
3. **D8/Glim source mapping, first cut. ✅ Landed 2026-07-09.**
   `glimmer build <entry.glim>` generates, injects contracts, assembles
   (`.hex`/`.bin`/`.d8.json`), and rewrites the map (Option A): segments
   inside block bodies are re-attributed to their `.glim` file (entry or
   part) using the label-anchored contract — `@Glim_<Name>:` plus
   byte-for-byte verbatim bodies — while generated glue stays attributed
   to the generated `.asm`. Assembly runs as a second AZM pass over the
   annotated file so map lines match the file on disk (a single
   `--contracts` pass would produce a map offset by the injected `;!`
   lines — worth fixing in AZM eventually).
4. **Docs winnow.** The manual and roadmap describe the shipped core.
   TMS9918, Tetro/Pacmo, cards, structured data, libraries, and richer
   resources move to post-publish tracks.
5. **Known-quality cleanup.** Fix lint, remove accidental generated or
   local files from the working tree, and keep only intentional examples.

## The 0.2 release line (2026-07-10)

The publish decision moved: the 0.1 line is complete but stays
unpublished. Package 0.2.0 is the release worth integrating into
Debug80 and documenting fully — the language-complete line. It absorbs
the remaining language milestones below (structured data, cards,
routines), validated by `tetro.glim` as the acceptance test. Work plan:
[plans/release-0.2.md](plans/release-0.2.md).

Versioning note: package versions and roadmap milestones are separate
namespaces now. Milestones go by feature names, not version-shaped
labels (the old "v0.5"/"v0.6" names are retired); package releases stay
sequential.

## Remaining language milestones (in the 0.2 release)

- **Cards and header-level navigation.** Cards are optional modal
  sections for screens/modes. `goto Playing` belongs in the block header,
  beside `on` and `updates`, and is unconditional once the block runs.
  `begin` opens an optional verbatim AZM body, so header-only routing
  blocks may close directly with `end`.
- **Structured data via AZM layouts. ✅ Landed 2026-07-10.** `type`
  declarations compile to AZM Book 0 `.type` records (`type Name = Expr`
  to `.typealias`); typed state (`state Cursor : Point`,
  `state Pieces : Piece[7]`) reserves typed `.ds` storage with one
  change flag per cell, byte-array style. `sizeof`/`offset`/layout casts
  work in bodies as ordinary AZM. Recursive layouts and unknown type
  references are parse-time diagnostics.
- **Routines (sketch P5).** `routine Name` callable helper blocks — no
  triggers, no dispatch; snake's hand-written imported module is the
  workaround this removes.

## After the 0.2 release

These are important, but they are not blockers:

- **Better `.glim` debug maps.** The first cut landed with
  `glimmer build` (see above). Remaining depth: a `.glim` TextMate
  grammar in Debug80, native `.glim` targets in debug80.json, and the
  AZM `.loc`-style source-origin directive (Option B) once the UX has
  proven itself.
- **Generated-output module splitting.** Move stable generated sections
  toward AZM `.import` modules when file layout and debugging tradeoffs
  are clear.
- **Per-block assemble/check and dataflow diagnostics.** Useful editor
  features, not first-publish requirements.
- **`.glim` libraries.** Reusable pulse/effect/resource kits need a
  namespace story beyond `part`.
- **TMS9918 profile and larger games.** The VDP profile, richer sprite
  and tile resources, and Tetro/Pacmo-scale game profiles are
  post-publish expansion work.

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

## Post-publish platform note: TMS9918

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

The goal: set a breakpoint in a `.glim` file, press F5, and step through
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

- **Option A — Glimmer composes. ✅ Implemented 2026-07-09 as
  `glimmer build`** (`src/build.ts`). Compiles `.glim` → `.asm`, runs AZM
  (contract injection, then a second pass over the annotated file for
  `.hex`/`.bin`/`.d8.json`), then rewrites the map: segments inside user
  blocks are re-attributed to the `.glim` file (entry or part), while
  generated glue stays attributed to the `.asm`. The anchor is Option D's
  contract — `@Glim_<Name>:` labels plus byte-for-byte verbatim bodies —
  with each body text-verified before mapping, so a drifted block is
  skipped with a warning rather than mapped wrongly. No changes to AZM or
  Debug80's map reader; stepping lands in `.glim` for user code and drops
  into readable generated AZM for glue — the transparency principle
  working as intended.
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
  begins at `@Glim_<Effect>:`, the `.d8.json` map records symbols with
  addresses, and block bodies are copied into the generated file
  byte-for-byte verbatim (since AZM 0.2.17 scopes labels to `@` routines,
  no renaming happens at all). So a tool holding the `.glim`, the
  generated `.asm`, and the `.d8.json` can reconstruct the full mapping
  with zero extra metadata: the symbol gives the block's start, and body
  line k after the label corresponds to body line k after `begin`.
  Block-level mapping ("which effect is the PC in?") needs only the
  `.d8.json` and the convention. This depends on two promises the
  generator now makes — stable `Glim_*` naming and verbatim bodies —
  which should be treated as a contract once anything relies on them.

The build-orchestration question ("how does Debug80 know to run Glimmer?")
starts simple: a debug80.json target's `sourceFile` points at the
generated `.asm`, and Glimmer runs as a pre-build step or watch task.
Native `.glim` targets in debug80.json — where Debug80 invokes Glimmer
itself, as it already invokes its bundled AZM — is the eventual form of
"Glimmer as a Debug80-native type". The API for that exists (2026-07-10):
`buildGlimmerProgram(entryPath, options)` on the `@jhlagado/glimmer/build`
subpath runs the whole chain in process with AZM-shaped diagnostics and
returns artifact paths — the exact mirror of the `@jhlagado/azm/compile`
API Debug80's AzmBackend already consumes, so a GlimmerBackend is a
sibling implementation selected by the `.glim` extension. Debug80-side
prerequisites: bump its bundled AZM (0.2.15) to ^0.2.17 — new Glimmer
output needs bit-index equates and routine-scoped labels to assemble —
and add a `glim` language contribution (grammar + the `breakpoints`
list, or breakpoints cannot be set in `.glim` files at all).

## Open questions

- How does a profile parameterize the generated loop — template per
  profile, or one loop skeleton with profile-supplied phases? (Tetro and
  Pacmo suggest per-profile ScanFrame policies with shared primitives.)
- Where does the boundary sit between generated glue and a static runtime
  include shipped with the profile (ScanTick, FbSetCell, sound service are
  library-shaped, not generated-shaped)?
- How far should Glimmer go with generated runtime glue before moving
  stable profile services into AZM `.import` libraries?
