# Release 0.2 Work Plan — Completing the Language

Prepared 2026-07-10. This is a **release plan**, not a single roadmap
milestone: package 0.2.0 is the language-complete line that makes
Glimmer worth integrating into Debug80 as a first-class type and worth
documenting fully. It absorbs the roadmap's remaining language
milestones (structured data, cards, routines).

**Versioning decision (2026-07-10):** package versions and roadmap
milestone labels are separate namespaces. Package releases stay
sequential and small (0.1.0 → 0.2.0); roadmap milestones drop their
version-shaped names and go by feature names ("structured data",
"cards") to end the collision. We do not run the package version up to
match old milestone numbers.

## The line

0.2.0 is done when the language can express Tetro — the headline
acceptance test — and the surface is stable enough to write the user
manual against without expecting rewrites. `sketches/tetro.glim` stops
being aspirational and becomes `examples/` (or the seed of an external
games repo).

Already in the release since 0.1.0: verbatim block bodies (AZM 0.2.17
routine-scoped labels), the real MON-3 `_random`, `glimmer build` with
glim-attributed debug maps, and the programmatic
`@jhlagado/glimmer/build` API with AZM-shaped diagnostics.

## 1. Structured data via AZM layouts (was roadmap "v0.5")

Lean on AZM Book 0 layout types — Glimmer names things, AZM owns the
type system.

- **`type` declarations** in `.glim`, emitted as AZM `.type` blocks in
  the data section. Fields are byte/word/arrays; nested named types per
  AZM's rules.
- **Typed state**: `state Pieces : Piece[7]` and `state Cursor : Point`
  emit typed `.ds` reservations. Change-flag semantics unchanged: one
  flag per declared cell, arrays included (per byte-array precedent).
- **Body access** is already-working AZM: `sizeof`, `offset`,
  layout-cast expressions in verbatim bodies. The work is declaration
  syntax + generation + docs, not body syntax.
- Evidence: snake's `Body + index` address arithmetic repeated five
  times; Tetro's piece/rotation/colour tables.

## 2. Cards (was roadmap "v0.6", sketch proposal P3)

Screens/modes as first-class sections — replaces the `Alive`-guard
boilerplate snake exposed and Tetro's flag dispatch.

- **`card Name` section lines**: everything after a `card` line belongs
  to that card until the next one; no closing keyword, no nesting.
  Declarations before the first `card` are global (always dispatched).
- **Built-in `CurrentCard` cell** plus a generated card enum; a card's
  effects dispatch only while it is active.
- **`enter` effects** run once on card entry (triggered by
  `CurrentCard` changing).
- **`goto Playing` in the block header** (beside `on`/`updates`):
  unconditional card transition once the block runs; `begin` body
  optional, so header-only routing blocks close directly with `end`.

## 3. Routines (sketch proposal P5)

`routine Name` blocks: callable helpers with no triggers and no
dispatch — collision checks, geometry. Emitted as `@Glim_<Name>` (or
`@<Name>`?) with a `ret`, contracts inferred/injected by AZM like every
other routine. Snake worked around this with a hand-written imported
module; the language should not force that.

- Open point: pass `;!` contract seeds through from `.glim` source
  (roadmap register-contracts note) or leave inference to AZM.

## 4. Small language/tooling items riding along

- **Lint**: warn when a block body writes a declared cell not listed in
  `updates` (last lint-backlog item; keeps `--deps` honest).
- **Text resources** (P6 remainder — LCD strings) **only if Tetro
  demands them**; otherwise they wait.
- Explicitly out: word change-flag semantics (P7, deferred), TMS9918
  profile, `.glim` libraries, generated-output module splitting.

## 5. Validation and release polish

- **`tetro.glim` is the acceptance test**: adapt it from the sketch as
  the constructs land; it must assemble strict-clean and play under
  Debug80. Findings feed fixes before the release, not after.
- README refresh (status section still describes the 0.1.0 line),
  CHANGELOG.md started (0.1.0 back-filled), package description fixed
  ("routine cards" → what actually ships), manuals updated per
  construct as it lands.
- Docs pass at the end: the user manual describes the complete
  language; this is the release that unblocks serious documentation
  work.

## Order

Structured data → routines (small) → cards → tetro.glim adaptation →
lint + polish → docs pass. Each construct moves from sketch to
`examples/` as it becomes real, with sketches/README.md proposals
marked as landed.

## Status — 2026-07-10: complete, pending playtest

All items landed the same day: structured data, routines, cards (with
edge-triggered enters and the conditional-navigation pattern the Tetro
adaptation forced), tetro.glim (first cut: instant clear, no LCD, no
preview, no key gate), the updates-mismatch warning (diagnostics grew a
severity), CHANGELOG/README/description, version 0.2.0. Remaining
before John calls the release: play Tetro under Debug80 (behavioral
validation beyond strict-clean assembly) and an editorial pass over the
manual.
