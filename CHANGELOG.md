# Changelog

Versions are tagged in git and published to npm as `@jhlagado/glimmer`
(0.4.0 is the first broadly usable published version).

## 0.5.3 - 2026-07-11

Patch release on the latest AZM 0.3 line.

- Requires `@jhlagado/azm` ^0.3.4.
- AZM 0.3.4 adds an opt-in case-insensitive symbol lookup mode. Glimmer
  continues to use AZM's strict, case-sensitive default; generated and
  user-written symbol spelling therefore retains its existing contract.
- Includes the 0.5.2 source, contract-audit, CLI-symlink, documentation,
  and regenerated-output changes in Git history. Version 0.5.2 was
  published from that working state before it was committed.

## 0.5.2 - 2026-07-11

Patch release for the installed command-line entry point, AZM 0.3.3, and
the documentation pass that closes the contract-seed park note.

- Requires `@jhlagado/azm` ^0.3.3. Explicit profile-library `.routine`
  clauses now pass AZM's body-vs-declaration check (flag clobbers that
  were silently under-declared under 0.3.2 are listed as
  `carry,zero,sign,parity,halfCarry`, not `F`).
- The npm `glimmer` bin now recognises direct invocation through the
  package manager's symlink. Version 0.5.1 could exit successfully
  without running the CLI because `process.argv[1]` named the symlink
  while `import.meta.url` named its resolved target.
- The regression runs from TypeScript source on every test run; it no
  longer depends on a pre-existing `dist/` directory.
- The specification, manual, engineering reference, and roadmap now
  describe the shipped `.routine` contract model and native Debug80
  workflow consistently.
- Sketches are documented as design history (P1–P9 landed or closed).
  AZM 0.3.3's body check clears the old park note; Glimmer's next
  language phase is source-level contract _syntax_ only.
- npm package archives (`*.tgz`) are treated as generated artifacts.

## 0.5.1 - 2026-07-11

Review pass over the AZM 0.3 migration. 0.5.0 was tagged but never
published; 0.5.1 is the publish target.

- Example-library contracts are audited-accurate. AZM 0.3 trusts
  `.routine` clauses and treats unlisted registers as preserved, so the
  clauses transcribed from the old `;!` comments (which under-declared
  clobbers on eleven routines) were silent miscompilation approvals.
  snake-lib.asm also still had plain internal labels truncating its
  `.routine` regions — now owner-local `_name` labels.
- `glimmer build` contract-checks imported units at the same strength
  as the check stage (`registerContracts: 'error'` on the assembly
  pass; files without an in-file `.contracts` directive were previously
  skipped by the build stage entirely). Regression-tested.
- Contract policy lives on the Profile seam (`contractPolicy`,
  `registerContractsProfile`) instead of platform if/elses in the
  generator and build pipeline.
- Shared `emitRoutine`/`blockEntryLabel` helpers own the
  directive/label pairing and the block-label naming contract.
- GlimCommit's checker-appeasing register define shrank to `ld b,d`
  (tms9918 binaries are +1 byte vs 0.4.0, down from +2) and its comment
  says it exists for AZM's stale-register analysis.
- Leading-underscore rejection covers card and type-field names.
- CLI help and messages no longer describe the removed contract
  injection; CLAUDE.md's canonical-output and examples-gitignored
  bullets corrected.

## 0.5.0 - 2026-07-11 (tagged, not published)

The AZM 0.3 migration: Glimmer generates and consumes AZM 0.3.2 syntax
and metadata, removing Debug80's need for a nested legacy AZM.

- Requires `@jhlagado/azm` ^0.3.2 (was ^0.2.17).
- Generated register contracts use the `.routine` directive (explicit
  in/out/clobbers clauses for the curated profile library, bare
  `.routine` inference for user blocks and routines) under an in-file
  `.contracts strict` policy on the TEC-1G profiles (`.contracts
audit` on the generic placeholder profile, whose API equates have no
  bodies to analyse). The legacy `;!` comments and `; expects` notes
  are gone, from generated output and from the example libraries.
- The 0.3 declaration model in generated output: no `@` markers in the
  root program (plain `Name:` is already non-local; `@` remains what it
  now is — export syntax for `.import`ed units), internal runtime
  entries renamed from `__X` to `GlimX` (`__` is AZM-reserved), and
  every internal branch label is an owner-local `_name` label. Block
  bodies keep using `_name` for their own labels; a plain label in a
  body is now file-level and truncates the block's routine boundary.
- `.glim` declared names may no longer start with `_` (AZM 0.3 reserves
  the leading underscore for local-label syntax); the parser rejects
  them with a pointed diagnostic.
- `glimmer build` is a single AZM pass: contract checking rides the
  assembly (policy and boundaries are declared in the generated file),
  nothing rewrites the file, and the debug map's line numbers agree
  with the source exactly as generated. User-routine output candidates
  are accepted via the compile API (`acceptRegisterOutputCandidates`).
- Binary output is byte-identical to 0.4.0 for six of the seven
  examples; sprite-chase gains two bytes (an explicit `ld b,0` in
  GlimCommit so no stale register flows into its save/restore loop —
  found by AZM 0.3's stricter analysis).
- Imported AZM modules called from generated code must declare
  `.routine` contracts (strict code cannot prove a call into a
  contract-less unit); tetro-lib.asm and snake-lib.asm show the form.

## 0.4.0 - 2026-07-11 (published to npm)

The resources-and-parity line: the sketches' data declarations are
real on both profiles, the first Glimmer-emitted AZM ops appear, and
the flagship games reach corpus parity (strict-clean; Debug80
playtests pending).

- Multi-rotation shapes: `rot0`..`rot3` groups (with `rotN = rotM`
  aliases and cycling defaults) compile to the corpus piece-engine
  tables — ShapeRot bitmaps, pointer/right-bound/colour tables, and
  ShapeId equates. Tetro's pieces are seven declarations; its library
  lost its whole data section.
- Sprite and tile resources (tms9918): 8x8 declarations compile to
  pattern tables, slot/index equates (a resource name IS its equate),
  colour groups by (fg, bg) pair, and a generated LoadResourcesVram.
  sprite_at and tile_at are AZM op definitions emitted into the
  generated file; sprite-chase is pure declarations and chase-lib.asm
  is gone.
- Text resources and the LCD slice: `text Name "STRING"` emits the
  zero-terminated string; declaring any text brings LcdRow1..4, the
  MON-3 LCD call equates, and the lcd_row op (both TEC-1G profiles —
  the LCD is board hardware).
- `bind key any rising -> Pulse`: fires on every new press, before and
  alongside named bindings; rising-only and TEC-1G-only by diagnostic.
- Tetro at corpus parity: line-clear flash (ClearMask + an idle-start
  once timer), LCD messages on every card, the NEXT piece preview, and
  the gated any-key restart (conditional navigation off the gate).
- `timer ... = 0 -> Pulse once` is legal: an idle countdown armed by
  writing the cell.
- The debug-map/diagnostic line matching is per-line and tolerant of
  AZM's injected annotations (`;!` contracts and `; expects` call-site
  notes), so annotated bodies keep full .glim attribution.
- P7 word semantics documented and closed as deliberately narrow.
- Parked pending an AZM change: `;!` contract seeds from block/routine
  headers (AZM currently trusts declared contracts without verifying
  them against the body, and annotation overwrites them — proposal
  recorded in the 0.4 plan).

## 0.3.0 - 2026-07-11

The second-display line: the profile architecture derisked while it is
cheap to change, exercised by `examples/sprite-chase.glim` on the
TEC-Deck TMS9918 (assembles strict-clean; Debug80 playtest pending).

- Extracted the profile seam (`src/profiles/`): a profile owns equates,
  input/display storage, data tables, the loop skeleton, polling, and
  the library tail; the reactive core is profile-independent. Gated by
  a byte-identical output snapshot suite — the extraction changed zero
  bytes of generated output.
- Added `display tms9918` (TEC-Deck): a vblank-paced loop with a real
  commit phase — render blocks write name-table and sprite-attribute
  shadows through `NamePut`/`SpriteSet`/`SpriteInit`, and `__Commit`
  streams dirty rows and the sprite table to VRAM in the blank window.
  Profile library: `VdpInit` (register table, colour/pattern/name
  clears, sprites hidden), `VdpSetAddrWrite`, `VdpWriteBlock`,
  `VdpFill`, `VdpWaitVBlank`; `VC_*` colour equates. MON-3 keypad input
  is shared by both TEC-1G profiles.
- Added `examples/sprite-chase.glim` + `chase-lib.asm`: corner a
  fleeing target, score pips on the top tile row; one-time VRAM upload
  from a Boot card's enter block.
- AZM diagnostics that fall inside block or routine bodies are now
  re-attributed to the `.glim` file and line (build API and CLI) —
  errors land where breakpoints do; generated-glue diagnostics stay on
  the generated asm.
- Documented: card-gated blocks never see change flags raised while
  their card was inactive; re-raise on entry with an enter block's
  `updates`.
- Fixed: a `goto` (or conditional `CurrentCard` write) could leak the
  same frame's triggers into the destination card's blocks. Dispatch
  gates now test `GlimActiveCard`, latched once per frame; card
  transitions land at frame boundaries only, with the destination's
  enter blocks running first.

## 0.2.0 - 2026-07-10

The language-complete line: everything Tetro needs, exercised by
`examples/tetro.glim` written on shipped constructs only (assembles
strict-clean; Debug80 playtest pending).

### Language

- Added layout types: `type Name ... end` compiles to an AZM Book 0
  `.type` record, `type Name = Expr` to `.typealias`; typed state
  (`state Cursor : Point`, `state Pieces : Piece[7]`) reserves
  zero-filled typed `.ds` storage with one change flag per cell.
  `sizeof`/`offset`/layout casts work in bodies as ordinary AZM.
- Added routines: `routine Name begin...end` callable helpers with no
  triggers and no dispatch, emitted as public `@Name:` boundaries with
  AZM-inferred register contracts.
- Added cards: `card Name` section lines, a generated `Card` enum, the
  built-in `CurrentCard` cell, card-gated block dispatch, `enter`
  blocks (edge-triggered: they run only on a genuine transition into
  their card), and `goto` in block headers with optional bodies.
  Conditional navigation — a body writing `CurrentCard` under
  `updates CurrentCard` — is a supported pattern.
- Block bodies are emitted byte-for-byte verbatim: AZM >= 0.2.17 scopes
  plain labels to their `@` routine, so the `Glim_<Block>_<label>`
  renaming is gone and `_label` is a style convention.
- Added a lint warning (diagnostics now carry a severity; warnings
  never fail the build) when a body stores directly into a
  flag-carrying cell missing from `updates`.

### Toolchain

- Added `glimmer build <entry.glim>`: generate, inject/check register
  contracts, assemble (`.hex`/`.bin`/`.d8.json`), and rewrite the
  Debug80 map so block and routine bodies step in `.glim` source while
  generated glue stays on the generated asm.
- Added the programmatic build API: `buildGlimmerProgram(entry,
{stage, outputPath, org})` on the `@jhlagado/glimmer/build` subpath —
  in-process, no printing, AZM-shaped diagnostics ({severity, absolute
  sourceName, line, column, code}) — mirroring the
  `@jhlagado/azm/compile` API Debug80 consumes. The CLI is a thin shell
  over it; plain `glimmer` no longer emits assembly artifacts as a side
  effect (artifacts belong to `build`).
- Generated tec1g programs get an `ApiRandom .equ 49` equate; snake's
  food placement uses the real MON-3 `_random` call now that AZM's mon3
  contract profile models it.

### Examples

- `examples/tetro.glim` — the headline acceptance test: falling pieces,
  held-key movement, rotation with wall checks, locking, line clear and
  collapse with corpus scoring, a difficulty curve, and splash / pause /
  game-over cards. Piece tables and the collision engine live in a
  hand-written imported module, adapted from corpus/tetro (0BSD).

Requires `@jhlagado/azm` >= 0.2.17 (routine-scoped labels, bit-index
equates, the mon3 `_random` contract).

## 0.1.0 - 2026-07-08

First complete line (tagged, not published): a small, Debug80-friendly
Z80 game framework. Single- and multi-file `.glim` programs (parts,
AZM module imports) with scalar/array state, pulses, timers, ramps,
held/rising key bindings, compute/effect/render blocks, sound cues,
curve tables, and matrix shapes, compiled to readable AZM for the
TEC-1G/MON-3 matrix profile (generic profile default); four change-flag
banks with exactly-once rollover; register contracts inferred and
injected by AZM; `examples/snake.glim` as the first complete game.
