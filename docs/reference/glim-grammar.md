# Glim Grammar Reference

Grammar for the `.glim` format: the implemented v0 language first, then
the proposed constructs from `sketches/`, clearly separated. The parser
(`src/parse.ts`) is the final authority for the implemented section.

The purpose of this document is evaluation: every symbol and keyword
should justify itself here. If a rule is hard to state, the syntax is
too complex.

## Design rules

The syntax budget is deliberately small:

1. **Every statement starts with a keyword.** A reader can always tell
   what a line is from its first word. There is no punctuation-led
   syntax.
2. **Three symbols, one meaning each.**

   | Symbol | Meaning       | Read it as    | Appears in                    |
   | ------ | ------------- | ------------- | ----------------------------- |
   | `:`    | has type      | "is a"        | `state Count : byte`          |
   | `=`    | initial value | "starting at" | `state Count : byte = 0`      |
   | `->`   | fires         | "fires"       | `bind key KEY_2 rising -> Up` |

   `->` always points from an event source to the pulse it fires. It
   never means assignment, never means a function, never appears in a
   declaration of data. If a future construct wants an arrow with a
   different meaning, it must use a different spelling.

3. **Commas only separate name lists** (`on DotX, DotY`).
4. **`;` starts a comment**, as in AZM — one comment convention across
   both languages.
5. **Everything between `begin` and `end` is verbatim AZM.** No Glim
   syntax exists inside a body; anything that looks like sugar there is
   an AZM op or routine that Glimmer emitted from a declaration.
6. **Line-oriented, no nesting.** Indentation is not significant; it is
   style. The only multi-line construct is the effect (header lines,
   then one body).

A reading test for the whole language: every declaration should read
aloud as an English sentence.

```
state DotY : byte = 3 changed
;  "DotY is a byte, starting at 3, changed."

bind key KEY_2 rising -> Up
;  "Binding: key 2, on a new press, fires Up."

effect MoveUp
    on Up
    updates DotY
;  "Effect MoveUp, on Up, updates DotY."

render DrawDot
    on DotX, DotY
;  "Render DrawDot: on DotX and DotY."

compute DifficultyCurve
    on Score
    updates Gravity
;  "Compute DifficultyCurve: on Score, updates Gravity."
```

A block declaration answers three questions: the **keyword** is
**when** in the frame it runs (`compute` blocks first, then `effect`
blocks, then `render` blocks), `on` is **why** it runs (the trigger —
the one line that cannot be inferred, because the body never mentions
it), and `updates` is **what** it changes (the outward contract that
propagates change flags to later blocks). Each keyword carries its
constraints: a `render` block takes no `updates` (it depicts state); a
`compute` block requires `updates` (computing state is its purpose).
`on` and `updates` are always explicit.

## Implemented grammar (v0)

```text
program-file    ::= line*
line            ::= blank-line | comment-line | statement

statement       ::= program-decl
                  | platform-decl
                  | display-decl
                  | type-decl
                  | state-decl
                  | pulse-decl
                  | timer-decl
                  | ramp-decl
                  | sound-decl
                  | curve-decl
                  | shape-decl
                  | sprite-decl
                  | tile-decl
                  | text-decl
                  | bind-decl
                  | block-decl
                  | routine-decl
                  | card-decl

program-decl    ::= "program" identifier

part-decl       ::= "part" string
                  ; entry file only. Merge semantics, not inclusion:
                  ; the named .glim file's declarations join the same
                  ; program and namespace. Paths resolve relative to
                  ; the entry file. Parts may not declare program,
                  ; platform, display, or parts.

import-decl     ::= "import" string
                  ; brings a hand-written AZM module (@ exports public,
                  ; plain labels private) into the generated program.
                  ; Emitted in a dedicated section outside every
                  ; execution path, because import bytes land at the
                  ; directive.
platform-decl   ::= "platform" platform-name        ; "tec1g-mon3"
display-decl    ::= "display" display-name          ; "matrix8x8" | "tms9918"

type-decl       ::= "type" identifier newline
                    type-field*
                    "end"
                  | "type" identifier "=" type-expr    ; alias (.typealias)
type-field      ::= identifier ":" field-type
field-type      ::= "byte" | "word" | "addr"
                  | number                             ; byte count
                  | type-expr
type-expr       ::= identifier ( "[" number "]" )?
                  ; compiles to an AZM Book 0 .type record; sizeof/offset/
                  ; layout casts work on the name in block bodies.
                  ; Recursive layouts are rejected.

state-decl      ::= "state" identifier ":" cell-type
                    ( "=" number )? ( "changed" )?
                  | "state" identifier ":" array-type ( "changed" )?
                  | "state" identifier ":" type-expr ( "changed" )?
cell-type       ::= "byte" | "word"
array-type      ::= "byte" "[" number "]"
                  ; arrays and typed state: one change flag for the whole
                  ; cell; no initializer (storage is zero-filled).

pulse-decl      ::= "pulse" identifier

text-decl       ::= "text" identifier string
                  ; tec1g platform (any display): a zero-terminated LCD
                  ; string. The generated lcd_row op positions the
                  ; cursor and writes it: lcd_row Msg, LcdRow1. LcdRow1..4
                  ; and the MON-3 LCD call equates come with it.

bind-decl       ::= "bind" "key" key-name trigger "->" identifier
trigger         ::= "rising"
                  | "held" "period" number          ; tec1g-mon3 only
key-name        ::= identifier | "any"              ; validated per platform;
                                                    ; any = every new press,
                                                    ; rising only, tec1g

timer-decl      ::= "timer" identifier ":" cell-type "=" number
                    "->" identifier ( "once" )?
                  ; oscillator: the cell is the writable period, a hidden
                  ; countdown reloads from it after each fire. once: the
                  ; cell is the countdown; fires once, rearmed by writing.

ramp-decl       ::= "ramp" identifier ":" "byte" "steps" number
                    "->" identifier
                  ; monostable progress counter: steps each frame, marks
                  ; its cell changed each step, fires the pulse at
                  ; steps-1, idles there; retriggered by writing the cell.

card-decl       ::= "card" identifier
                  ; starts a section: blocks after it belong to that
                  ; card until the next card line or end of file. No
                  ; closing keyword. Generates a Card enum and the
                  ; built-in CurrentCard cell (first card = start card).

routine-decl    ::= "routine" identifier newline
                    "begin" newline
                    z80-body
                    "end"
                  ; callable helper: no triggers, no dispatch. Emitted
                  ; as .routine followed by Name:; body falls through
                  ; and the generator appends ret.

sound-decl      ::= "sound" identifier "len" number "div" number
                  ; non-blocking low-frequency matrix-profile cue.
                  ; len is row ticks; div is the speaker divider.

curve-decl      ::= "curve" identifier preset "steps" number
                    ( "from" number "to" number )?
                  ; build-time byte lookup table. Presets: linear,
                  ; ease_in, ease_out, ease_in_out, sine, overshoot,
                  ; anticipation.
preset          ::= identifier

shape-decl      ::= "shape" identifier "color" color-name
                    ( shape-row+ | rot-group+ )
                    "end"
                  ; matrix-profile bitmap resource. Rows are rectangular
                  ; quoted strings, 1..8 wide by 1..8 high, using X for a
                  ; lit pixel and . for an empty pixel. Plain rows: a
                  ; single bitmap drawn with ShapeDraw. Rotation groups:
                  ; the piece-engine form.
rot-group       ::= "rot" digit shape-row* newline shape-row*
                  | "rot" digit "=" "rot" digit   ; alias of an earlier
                                                  ; distinct rotation
                  ; rot0..rot3, declared in order, 1..4 rows each (padded
                  ; to a 4-row frame). Rotations beyond those declared
                  ; cycle (r mod declared-count): I declares two, O one,
                  ; S/Z three plus rot3 = rot1. Compiles to
                  ; ShapeRot_<Name>_<k> bitmaps and the shared
                  ; ShapeRotPtrTable / ShapeRotRightTbl /
                  ; ShapeRotColorTbl + ShapeId_<Name> equates,
                  ; indexed by id*4 + rotation.
sprite-decl     ::= "sprite" identifier "color" vdp-color
                    shape-row+     ; exactly 8 rows of 8
                    "end"
                  ; tms9918 profile. Declaration order is the sprite
                  ; slot and pattern number; the name compiles to the
                  ; slot equate, so the generated op takes it directly:
                  ;   sprite_at Player, PlayerX, PlayerY
                  ; Patterns and colours upload once (LoadResourcesVram).
                  ; At most 31 sprites; slot 31 stays hidden.

tile-decl       ::= "tile" identifier "color" vdp-color "on" vdp-color
                    shape-row+     ; exactly 8 rows of 8
                    "end"
                  ; tms9918 profile. The name compiles to the tile index
                  ; equate; tile_at <Name>, col, row places it, or use
                  ; NamePut for computed positions. Graphics I colours
                  ; patterns in groups of 8: tiles group by (fg, bg)
                  ; pair; the first pair's background is the screen
                  ; background for empty cells.
vdp-color       ::= "transparent" | "black" | "medgreen" | "lightgreen"
                  | "darkblue" | "lightblue" | "darkred" | "cyan"
                  | "medred" | "lightred" | "darkyellow" | "lightyellow"
                  | "darkgreen" | "magenta" | "gray" | "white"

shape-row       ::= string
color-name      ::= "red" | "green" | "blue" | "yellow" | "cyan"
                  | "magenta" | "white"

block-decl      ::= block-kind identifier
                    block-header*
                    ( "begin" newline azm-line* )?  ; body optional with goto
                    "end"
block-kind      ::= "compute" | "effect" | "render" | "enter"
                  ; the keyword is the phase: compute=derive,
                  ; effect=logic, render=render. enter=logic, runs once
                  ; on entry to the enclosing card, before the card's
                  ; other blocks; takes no "on" (entry is the trigger).
block-header    ::= "on" name-list                  ; not on enter
                  | "updates" name-list             ; not on render
                  | "goto" identifier               ; card transition after
                                                    ; the block runs; not
                                                    ; on render
name-list       ::= identifier ( "," identifier )*

identifier      ::= [A-Za-z_][A-Za-z0-9_]*
number          ::= decimal | "$" hex | "0x" hex | "%" binary
```

Semantic constraints enforced after parsing:

- exactly one `program`; `platform` and `display` at most once, and only
  together
- all declared names — states, pulses, timers, ramps, sounds, curves,
  shapes, and blocks — share one namespace and must be unique (every name
  projects into one flat AZM symbol space)
- names may not collide with generated or profile symbols: the `Glim`,
  `Snd_`, `Curve_`, `Shape_`, `CHG_`, and `__` prefixes and the
  runtime/profile names (`Changed0`, `MainLoop`, `Framebuffer`, the
  library routines) are reserved, so the diagnostic lands on the `.glim` line; AZM's
  global-uniqueness check remains the backstop
- `bind` targets must be declared pulses
- `on` names must be flag-carrying cells; `updates` names must be
  writable runtime cells; a byte array is one flag-carrying cell
- every block needs at least one `on` trigger
- `render` blocks take no `updates`; `compute` blocks require `updates`
- timer and ramp targets must be declared pulses; timer cells carry no
  change flag (trigger on the pulse), so they may appear in `updates`
  but not `on`; ramp cells may appear in both
- byte array state uses `byte[N]`, where `N` is 1 to 256; arrays have no
  initializer, word arrays are not implemented, and indexing is ordinary
  Z80 in block bodies
- sound cues require `platform tec1g-mon3` with `display matrix8x8`;
  `len` and `div` are byte values from 1 to 255
- curve resources have `steps` from 2 to 256; `from` and `to` are byte
  values from 0 to 255 and default to `0` and `steps - 1`
- shape resources require `platform tec1g-mon3` with `display matrix8x8`;
  they are rectangular 1..8 by 1..8 bitmaps using `X` and `.`, and their
  colour is one of `red`, `green`, `blue`, `yellow`, `cyan`, `magenta`,
  or `white`
- the built-in `FrameCount` may appear in `on`; it increments every
  frame and occupies a flag bit only when used
- flag-carrying cells are allocated by category order — states, then
  pulses, then ramps, then `FrameCount` — into up to four banks:
  `Changed0`/`Raised0`/`Next0` through
  `Changed3`/`Raised3`/`Next3`; the current cap is 32 cells
- `end` terminates a body when it is the only word on the line

## The dataflow, in one paragraph

`bind` turns an input event into a pulse; timers and ramps fire pulses
on their own schedule. A cell being marked changed is what makes blocks
run: a block runs in its phase when any `on` cell changed, and after it
runs its `updates` cells are marked changed. Delivery is exactly-once:
a raise whose consumers are all in later phases lands the same frame; a
raise any of whose consumers already ran (an earlier or equal phase)
rolls over whole to the next frame. Declaration order is never
semantic. Pulses clear at the end of every frame; deferred raises
become the next frame's changes. That is the whole model; `->` is its
only symbol.

## Deferred extensions

The old sketches proposed routines, cards, navigation, rotational shapes,
text, sprites, and tiles; all now appear in the implemented grammar above.
Remaining syntax is deliberately unsettled until a program requires it:
source-level clauses for AZM routine contracts, namespaced `.glim`
libraries, and richer platform-specific resources and bindings.

## Settled syntax decisions (2026-07-06)

- **"Card" means a screen/mode, HyperCard-sense — only that.** A card is
  a mode the running program is in (Splash, Playing, GameOver); exactly
  one is active, tracked by the built-in `CurrentCard` state cell. The
  unit of code is a **block** (informally, a snippet) — never a
  "routine card". One word, one meaning, like the symbols.

- **The block keyword is the phase (2026-07-07):** `compute X`
  (derive), `effect Y` (logic), `render Z`. The first word carries both
  what a declaration is and when it runs, and each keyword enforces its
  constraints (render cannot update; compute must). "Block" is the
  umbrella term in prose. Lineage acknowledged: this is Vue's shape —
  state=data, compute=computed, effect=watch, render=template. This
  replaced phase modifiers on the effect line, which had replaced the
  `phase` header line.
- **`on` replaced `depends`.** Shorter, reads aloud naturally.
- **Bindings target pulses only.** No direct-bind-to-effect shortcut:
  `->` always fires a pulse, preserving its single meaning. Minimal
  programs pay a little pulse plumbing; the model stays uniform.
- **`updates` replaced `writes` (2026-07-07),** and the change-tracking
  vocabulary is **changed** (the `changed` state modifier, `Changed0`,
  `CHG_*` masks) with "dirty bits" acknowledged once as the traditional name.
  `updates` reads intuitively ("on Up, updates DotY") and names the
  clause's real job: notifying Glimmer of mutation without it reading
  the Z80. The clause stays explicit even where a static scan of the
  body could infer it: it is the effect's outward contract and covers
  writes through pointers. The compiler warns when a direct store visibly
  updates a declared cell that is not listed; pointer writes remain beyond
  that intentionally narrow lint.

- **Uniqueness is Glimmer's job; AZM is the backstop.** Declared Glimmer
  names share one validated namespace. Block-internal labels use AZM
  0.3's `_name` owner-local syntax and bodies are emitted verbatim under
  stable `Glim_<Block>:` entry labels; no label rewriting occurs.

- **Cards are sections, not blocks (2026-07-06).** `card <Name>` starts
  a section that runs to the next `card` line or end of file — no
  closing keyword. `end` therefore keeps a single meaning: it only ever
  terminates a `begin` body ("end of assembly"). The language stays
  nesting-free (rule 6) even with cards.

One syntax question remains deliberately open:

- **`->` vs a word.** `bind key KEY_2 rising fires Up` reads aloud
  better; `->` is more scannable and matches the dataflow diagrams.
  Current position: keep `->`, precisely because it has exactly one
  meaning. Revisit if user testing shows confusion.
