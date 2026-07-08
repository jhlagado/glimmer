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
                  | state-decl
                  | pulse-decl
                  | timer-decl
                  | ramp-decl
                  | sound-decl
                  | curve-decl
                  | bind-decl
                  | block-decl

program-decl    ::= "program" identifier
platform-decl   ::= "platform" platform-name        ; "tec1g-mon3"
display-decl    ::= "display" display-name          ; "matrix8x8"

state-decl      ::= "state" identifier ":" cell-type
                    ( "=" number )? ( "changed" )?
cell-type       ::= "byte" | "word"

pulse-decl      ::= "pulse" identifier

bind-decl       ::= "bind" "key" key-name trigger "->" identifier
trigger         ::= "rising"
                  | "held" "period" number          ; tec1g-mon3 only
key-name        ::= identifier                      ; validated per platform

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

sound-decl      ::= "sound" identifier "len" number "div" number
                  ; non-blocking low-frequency matrix-profile cue.
                  ; len is row ticks; div is the speaker divider.

curve-decl      ::= "curve" identifier preset "steps" number
                    ( "from" number "to" number )?
                  ; build-time byte lookup table. Presets: linear,
                  ; ease_in, ease_out, ease_in_out, sine, overshoot,
                  ; anticipation.
preset          ::= identifier

block-decl      ::= block-kind identifier
                    block-header*
                    "begin" newline
                    azm-line*
                    "end"
block-kind      ::= "compute" | "effect" | "render"
                  ; the keyword is the phase: compute=derive,
                  ; effect=logic, render=render
block-header    ::= "on" name-list
                  | "updates" name-list             ; not on render
name-list       ::= identifier ( "," identifier )*

identifier      ::= [A-Za-z_][A-Za-z0-9_]*
number          ::= decimal | "$" hex | "0x" hex | "%" binary
```

Semantic constraints enforced after parsing:

- exactly one `program`; `platform` and `display` at most once, and only
  together
- all declared names — states, pulses, timers, ramps, sounds, and blocks —
  share one namespace and must be unique (every name projects into one flat
  AZM symbol space)
- names may not collide with generated or profile symbols: the `Glim`,
  `Snd_`, `CHG_`, and `__` prefixes and the runtime/profile names
  (`Changed0`, `MainLoop`, `Framebuffer`, the library routines) are
  reserved, so the diagnostic lands on the `.glim` line; AZM's
  global-uniqueness check remains the backstop
- `bind` targets must be declared pulses
- `on` names must be flag-carrying cells; `updates` names must be
  writable runtime cells
- every block needs at least one `on` trigger
- `render` blocks take no `updates`; `compute` blocks require `updates`
- timer and ramp targets must be declared pulses; timer cells carry no
  change flag (trigger on the pulse), so they may appear in `updates`
  but not `on`; ramp cells may appear in both
- sound cues require `platform tec1g-mon3` with `display matrix8x8`;
  `len` and `div` are byte values from 1 to 255
- curve resources have `steps` from 2 to 256; `from` and `to` are byte
  values from 0 to 255 and default to `0` and `steps - 1`
- the built-in `FrameCount` may appear in `on`; it increments every
  frame and occupies a flag bit only when used
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

## Proposed grammar (sketches — not implemented)

From `sketches/tetro.glim` and `sketches/sprite-chase.glim`. Each
proposal is held to the same symbol rules. (Timers, ramps, and held
bindings graduated to the implemented grammar in v0.2.)

```text
routine-decl    ::= "routine" identifier
                    contract-comment?
                    "begin" newline azm-line* "end"

part-decl       ::= "part" string
                  ; merge semantics, not inclusion: the named file's
                  ; declarations join the same program and namespace.
                  ; Only the entry file declares program/platform/display.

import-decl     ::= "import" string
                  ; brings an AZM module (.asm with @ exports) into the
                  ; generated program. Emitted in a dedicated section:
                  ; AZM import names are order-independent, but bytes
                  ; land at the directive, so it never sits in a block.

card-decl       ::= "card" identifier
                  ; a section header with no closing keyword: the card
                  ; contains every following declaration until the next
                  ; card-decl or end of file.
enter-effect    ::= "enter" effect-decl

shape-decl      ::= "shape" identifier "color" color-name
                    rotation-row* "end"
text-decl       ::= "text" identifier string
sprite-decl     ::= "sprite" identifier "color" color-name
                    pixel-row* "end"
tile-decl       ::= "tile" identifier "color" color-name
                    ( "on" color-name )? pixel-row* "end"
```

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
  writes through pointers. A future lint should warn when a body
  visibly updates a declared cell that is not listed.

- **Uniqueness is Glimmer's job; AZM is the backstop (2026-07-07).**
  Block-local `_labels` are Glim syntax, compiled away into globally
  unique `Glim_<Effect>_<label>` names — the generated file contains
  only globally unique labels, so Glimmer does not depend on any future
  AZM local-symbol scoping. The rewrite stays even if AZM gains it: the
  qualified name carries the block's identity into the symbol map and
  the debugger, and it is part of the label-anchored mapping contract.

- **Cards are sections, not blocks (2026-07-06).** `card <Name>` starts
  a section that runs to the next `card` line or end of file — no
  closing keyword. `end` therefore keeps a single meaning: it only ever
  terminates a `begin` body ("end of assembly"). The language stays
  nesting-free (rule 6) even with cards.

Open syntax questions to settle before implementing:

- **`->` vs a word.** `bind key KEY_2 rising fires Up` reads aloud
  better; `->` is more scannable and matches the dataflow diagrams.
  Current position: keep `->`, precisely because it has exactly one
  meaning. Revisit if user testing shows confusion.
