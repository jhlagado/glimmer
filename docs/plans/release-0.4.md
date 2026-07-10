# Release 0.4 Work Plan — Resources and Parity

Prepared 2026-07-11. 0.2 completed the language's control structures;
0.3 proved the profile architecture on two opposite displays. 0.4
finishes the **data story**: the sketches' resource declarations become
real on both profiles, the first Glimmer-emitted AZM `op`s appear, and
the two flagship games reach corpus parity — so that what remains
hand-written in any example is genuinely irreducible engine code. It is
also the developer-experience line displaced from the original 0.3
draft: contract seeds land here.

Runs alongside John's Debug80 integration phase and the pending
playtests of Tetro (matrix) and sprite-chase (VDP); playtest findings
fold into this release's scope as they arrive.

## The line

0.4 is done when: a piece, a sprite, a tile, and an LCD message are all
declarations, not hand-written tables; `sprite_at` and `lcd_row` exist
as visible AZM `op`s in the generated file (the P6/P8 ground rule
exercised: one macro system, owned by AZM); Tetro matches the corpus
game feature-for-feature; and a routine can declare its register
interface and have AZM verify it.

## 1. Contract seeds from source — BLOCKED on an AZM design decision

Investigated 2026-07-11; pass-through alone would be worse than
nothing. Empirically (AZM 0.2.17):

- A deliberately **wrong** declared contract (`preserves B` on a body
  that destroys B) passes `--rc error` *and* `--rc strict` silently:
  declared contracts replace inference in `buildSummaries` and are
  trusted — callers are proven against them, but a routine's body is
  never verified against its own declaration.
- The `--contracts` annotation pass (which Glimmer always runs)
  **overwrites** the seed with the inferred contract, so a seed would
  not even survive into the annotated file.
- AZM's inference is usage-informed (a clobbered register a caller
  never reads may be omitted from the annotation), so verification
  needs the raw body-effect summary (`RoutineSummary.mayWrite` /
  `preserved`), not the annotate text.

**AZM proposal for John** (two parts): (a) verify a declared `;!`
contract against the routine's own body-effect summary — error when
the body may write a register the declaration preserves or omits
(treating unmentioned-as-preserved, matching how callers already read
declarations); (b) make annotation respect a declared contract that
verifies, instead of overwriting it. With those in an AZM release,
the Glimmer side is a small pass-through (header `;!` lines emitted
above the `@` label; the sketch syntax) and lands in the next Glimmer
release. Until then this item is parked, not dropped.

## 2. Multi-rotation shapes (matrix) — ✅ landed 2026-07-11

The sketch syntax: `shape PieceT color magenta` with `rot0`..`rot3`
row groups generates the row bitmaps, the pointer/rotation table, the
right-bound table, and the colour entry. Tetro's seven pieces become
seven declarations and tetro-lib.asm loses its data section — the
collision/lock/clear engine is what legitimately remains. Rotation
aliases (I has two distinct rotations, O has one) come from repeating
a `rotN` group or omitting it (omitted = same as rot0's cycle;
settle the exact rule when writing the grammar entry). As landed:
rotations declare in order, `rotN = rotM` aliases an earlier distinct
one, and undeclared rotations cycle (r mod declared count) — the
generated tables reproduce the corpus piece data byte-for-byte, and
tetro-lib.asm's data section is gone (SetCurPiece reads the generated
ShapeRot* tables).

## 3. Sprite and tile resources (VDP) — ✅ landed 2026-07-11

The sketch's `sprite Name color <vc>` and `tile Name color <fg> on
<bg>` declarations, with 8x8 `"..XX...."` rows:

- **Patterns** compile to `.db` tables; a generated
  `LoadResourcesVram` routine uploads them once, called from `VdpInit`
  (no more hand-written chase-lib upload).
- **Sprites** get slots in declaration order and a generated
  `sprite_at <Name>, x, y` **AZM `op`** (expanding to the SpriteSet
  call with the slot constant) plus generated `SpriteInit` calls for
  pattern/colour at init. Slot discipline (contiguous from 0, Y=$D1
  terminator) becomes generated truth instead of a documented contract.
- **Tiles** get pattern indexes from 1 (0 stays blank) and a
  `tile_at <Name>, col, row` op over NamePut. Graphics I colours groups
  of 8 patterns: the generator assigns tiles to colour groups by their
  (fg, bg) pair and emits the colour-table init — a declared design
  constraint to document (too many distinct colour pairs in one group
  is a diagnostic, not a silent wrong colour).
- sprite-chase drops chase-lib.asm entirely. As landed: a resource
  name compiles to its slot/index equate (so `sprite_at Player, ...`
  needs no extra naming), sprite slot setup happens inside
  LoadResourcesVram, and colour groups spill to a new group when full
  rather than erroring (31-sprite limit is a diagnostic).

## 4. Text resources and the LCD slice — ✅ landed 2026-07-11

`text MsgPaused "PAUSED"` emits the null-terminated `.db` string. The
tec1g platform (both displays — the LCD is board hardware, not display
hardware) grows an LCD service slice over the MON-3 calls the AZM
contract profile already models (`_stringToLcd` 13, `_charToLcd` 14,
`_commandToLcd` 15): an `lcd_row msg, row` op and LcdRow equates.
Corpus LCD script tables stay out — ops compose in bodies.

## 5. `bind key any rising -> Pulse` — ✅ landed 2026-07-11

The corpus "press any key" pattern (splash exit, game-over restart),
currently approximated with GO. Matrix and VDP profiles share the
MON-3 poll, so this lands once in mon3-input.

## 6. Game parity — the acceptance tests grow up

- **Tetro**: line-clear flash (`ClearMask` + `ClearHold` timer),
  next-piece preview (LCD via text resources, matching the corpus),
  paused/running/game-over LCD messages, the game-over key gate (the
  enter-rearms-a-once-timer pattern, documented), pieces as
  multi-rotation shapes.
- **sprite-chase**: sprites/tiles as declarations, `sprite_at` in the
  render bodies as the sketch wrote them, a proper tile border.
- Both remain strict-clean and snapshot-covered; playtest findings from
  0.2/0.3 get fixed here.

## 7. P7 word semantics — document and close

Word cells store, flag, and compare correctly (Tetro's Score). 0.4
closes P7 in the spec as deliberately narrow: no word-aware widgets
until a real program needs one.

## Explicitly out (the 0.5 horizon)

`.glim` libraries and the namespace story, generated-output module
splitting, per-block assemble/check, further platforms/display modes
(Graphics II, NMI pacing), richer text (LCD scripts), Pacmo.

## Coordination tracks (not in this package)

- **Debug80**: John's integration phase (AZM bump, GlimmerBackend,
  `.glim` grammar + breakpoints contribution). Item 1's seeds surface
  there as verified interfaces in hovers/contract reports.
- **AZM**: the declared-contract verification pair from item 1 (verify
  seeds against the body-effect summary; annotation respects verified
  seeds) is now the top ask, ahead of the post-injection map/line-offset
  fix and the `.loc` source-origin directive. If op expansion interacts
  poorly with the d8 map (ops expand inline), that becomes an AZM
  finding from item 3.

## Order

~~Contract seeds~~ (parked on AZM) → multi-rotation shapes → Tetro data-section shrink →
sprite/tile resources + ops → sprite-chase shrink → text/LCD + any-key
→ Tetro full parity → P7 closure → polish (CHANGELOG, version 0.4.0,
tag). Resources before parity so the games consume declarations, not
the other way around; seeds first because they immediately harden every
routine the resource work touches.
