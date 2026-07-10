# Release 0.3 Work Plan — The Second Display

Prepared 2026-07-10; restructured the same day (John's call): 0.3
derisks the profile architecture instead of polishing developer
experience. The TMS9918 is the headline, because the second display is
what forces the answer to the roadmap's biggest open question — **how a
profile parameterizes the generated loop** — and that answer should
exist before more profiles, more games, and the Debug80 integration
harden around a single-profile assumption.

The developer-experience items originally drafted for 0.3 (contract
seeds, the P6 resource remainder, Tetro corpus parity, P7 closure) move
to the 0.4 horizon. One exception rides along: **diagnostics
re-attributed to `.glim` lines** — small, orthogonal to the
architecture work, and immediately useful while playtesting.

## Why the matrix and the VDP force the design

The two displays are opposites, which is exactly their value:

- **matrix8x8** is a display you *are*: the CPU is the display
  controller, `ScanFrame` burns the frame budget scanning rows, and all
  game work runs in the blank window. Render blocks write a
  framebuffer the scanner reads continuously. There is no commit phase.
- **TMS9918** is a display you *write to*: the VDP renders
  autonomously; the program paces itself on vblank (status register
  $BF, or frame-timed delay), and display changes are VRAM writes that
  should land in the blank window. The spec's original
  `poll → logic → render → commit` loop fits it directly — render
  blocks write shadow state, a commit phase flushes it to VRAM.

A profile is therefore not a cosmetic equate-set: it owns the loop
skeleton, the pacing policy, the render target (framebuffer vs
shadows+commit), the profile library, and the resource compilation
targets. That is the abstraction 0.3 extracts.

## Phase A — extract the profile seam (no behaviour change)

`src/generate.ts` currently branches on `isTec1g` throughout. Extract a
`Profile` abstraction that owns:

- equates and port constants
- state/service storage the runtime needs (framebuffer vs VRAM shadows)
- the main-loop skeleton (scan-driven vs vblank-paced) and which phases
  exist (`commit` becomes real for the first time)
- input polling (both profiles use MON-3 `_scanKeys`; the seam still
  belongs to the profile)
- the profile library (ScanFrame/FbPlot/... vs VDP helpers) and any
  library-owned per-frame services (sound, HUD)
- resource compilation hooks (what `shape`/`sound` mean per display)

Working hypothesis from the corpus (roadmap open question): **one loop
skeleton with profile-supplied phases and per-profile pacing policies,
shared primitives in profile libraries.** Phase A proves or amends it.

Acceptance: pure refactor — the generic and tec1g-mon3 profiles
regenerate **byte-identical** output for every example (test-enforced),
with the profile boundary explicit in the code.

## Phase B — the tms9918 profile, first slice

`display tms9918` (Graphics I first; mode selection syntax can wait).
Target facts (debug80 emulates all of this:
src/platforms/tec1g/tms9918.ts):

- data port $BE, control port $BF; 16 KiB VRAM; NMI optional — first
  slice polls the status register's vblank flag (reading $BF clears it)
- canonical VRAM layout from the demos: pattern $0000, name $0800,
  sprite attributes $1B00, colour $2000, sprite patterns $3800
- register init from an 8-byte (value, index|$80) table
- `SetWriteAddress` (low, then high|$40) + streamed `OUT ($BE)` fills
  and copies

Generated loop: wait-for-vblank → commit (flush dirty shadows to VRAM
in the blank window) → poll → phases. Profile library: VdpSetAddr,
VdpFill, VdpWriteBlock, register-table init.

Render model, first slice: **sprite-attribute shadow + name-table
shadow with dirty tracking**. Render blocks write the shadows (ordinary
memory — verbatim Z80, testable, no VDP timing concerns in user code);
the commit phase flushes what changed. The name table is 32x24 — the
dirty-region idea from the roadmap can start coarse (dirty row-ranges
or a whole-table flag) and refine later.

Resources: `shape` on tms9918 compiles to sprite patterns; tile
patterns/colour tables can start as hand-written imported modules
(snake-lib precedent) rather than blocking the slice on new resource
syntax.

## Phase C — sprite-chase.glim, the acceptance test

The sketch made interactive: a player-steered sprite chasing a target
over a tile background — the VDP demos plus the missing dynamics. It
must assemble strict-clean (mon3 profile still governs the RST calls)
and play under Debug80's TMS9918 emulation. Like snake and tetro before
it, its findings feed fixes before the release.

## Phase D — riders

- **Diagnostics land in `.glim`**: `buildGlimmerProgram` re-attributes
  AZM diagnostics inside block/routine bodies to their `.glim`
  file/line via the existing `computeBlockMappings` ranges; glue
  diagnostics stay on the generated asm. CLI and API both.
- Docs: profile chapter in the spec (the two loop models side by side),
  manual section for the tms9918 profile, engineering-manual update for
  the Profile seam, roadmap open-questions section rewritten with the
  answers Phase A/B produced.

## Explicitly out (now the 0.4 horizon)

Contract seeds from source; multi-rotation shapes, text resources and
the LCD slice, `bind key any`; Tetro corpus parity (flash, preview,
messages, key gate); P7 word-semantics closure; `.glim` libraries,
module splitting, per-block checks.

## Order

Phase A (seam extraction, byte-identical gate) → Phase B (profile +
library + commit loop) → Phase C (sprite-chase) → Phase D (diagnostics
rider + docs). A first: the refactor gate keeps the risk contained —
if the seam is wrong, we find out while outputs must not change, not
while a new platform is half-built on top of it.
