# Glimmer

Glimmer is a preprocessor and project format for AZM. Its initial purpose is to
help us learn how to build a practical Z80 game engine while keeping real Z80
assembly visible.

The first target is game writing for the TEC-1G. The format should also leave
room for other Z80 systems as Debug80 expands its supported platforms.

Longer term, Glimmer is expected to become a Debug80-facing format: a structured
way to describe blocks, state records, bindings, effects, resources, and
generated AZM glue for interactive Z80 programs.

Documentation:

- [Glimmer Interactive Runtime Specification](docs/glimmer.md) — the design foundation
- [Roadmap](docs/roadmap.md) — milestones and platform findings
- [Glim Grammar Reference](docs/reference/glim-grammar.md) — formal grammar and syntax design rules
- [Glimmer Engineering Manual](docs/codebase/) — codebase reference, kept current with the source
- [Glimmer Manual](docs/manual/) — user manual for the first publishable line

The project is game-first because games exercise timing, input, graphics,
sprites, state, sound, packaging, and performance. It is not intended to be
game-only.

## Status

Version 0.5.3 is the current release line. Glimmer targets AZM 0.3.4,
generates explicit `.routine` boundaries under an in-file `.contracts`
policy, and is integrated into Debug80 as a native `.glim` source format.
The repository's default Debug80 target builds and debugs
`examples/tetro.glim` directly.

The language: scalar, array, and typed state (layout types compiled to
AZM `.type` records), pulses, timers and ramps, held/rising key
bindings, compute/effect/render blocks with verbatim Z80 bodies,
callable routines, cards (screens/modes with `enter` blocks and `goto`
navigation), sound cues, curve tables, matrix shapes, multi-file
programs (`part`), and hand-written AZM module imports.

The toolchain: `glimmer build` generates AZM, checks its declared and
inferred register contracts, assembles to `.hex`/`.bin`/`.d8.json`, and
rewrites the Debug80 map so **breakpoints and stepping land in your `.glim`
source** for block bodies while generated glue stays in readable AZM. The
same pipeline is a programmatic API (`@jhlagado/glimmer/build`) shaped like
AZM's compile API and consumed by Debug80's native Glimmer backend.

Version 0.4.0 completed the data story: pieces, sprites, tiles, and
LCD messages are declarations — `shape` rotation groups generate the
corpus piece-engine tables, `sprite`/`tile` resources generate patterns,
colour groups, and the VRAM upload, `text` brings the LCD slice — and
the generated `sprite_at`/`tile_at`/`lcd_row` AZM ops keep every piece
of sugar visible in the generated file. Tetro and sprite-chase play the
corpus feature set with only irreducible engine code hand-written.

Version 0.3.0 added the second display: `display tms9918` (the
TEC-Deck VDP) generates a vblank-paced loop with a commit phase that
flushes shadow tables to VRAM — proving the profile architecture on two
opposite display models (the matrix the CPU _is_, the VDP the CPU
_writes to_) — and build errors inside block bodies are now reported at
the `.glim` line, the same way breakpoints resolve there.

Examples, smallest first: `counter.glim` (generic profile),
`dot.glim`, `slide.glim`, `trail.glim` (TEC-1G matrix profile
features), then the games — `snake.glim`, `tetro.glim`, and
`sprite-chase.glim` (TMS9918). The repo's `debug80.json` carries a
target for each.

## Getting Started

Glimmer requires Node.js 20 or newer.

```sh
npm ci
npm run build
node dist/src/cli.js build examples/counter.glim   # asm + hex + bin + d8 map
```

The plain command stops at generated, contract-checked AZM
(`node dist/src/cli.js examples/counter.glim`); `build` continues
through assembly and the source-level debug map.

The generated AZM is readable: API equates, change-flag constants,
state storage, the runtime loop, binding polling, phase dispatch, wrapped user
blocks, and frame cleanup, in that order. Inspect
`examples/counter.main.asm` after building to see the whole runtime.

## The Meta-Source Format (v0)

```
program CounterToy

state Count : byte = 0 changed

pulse IncPressed

bind key KEY_1 rising -> IncPressed

effect ApplyIncrement
    on IncPressed
    updates Count
begin
    ld hl,Count
    inc (hl)
    ld a,(hl)
    cp 10
    jr c,_done
    xor a
    ld (hl),a
_done:
end
```

Block bodies land in the generated file byte-for-byte verbatim; AZM
scopes `_name` labels to the block's entry label, so every block can
have its own `_done` (the leading underscore is AZM's local-label
syntax — block-internal branch targets must use it). Blocks run when any of their `on` cells changed; `updates`
cells are marked changed after the block runs.

## Development

```sh
npm run typecheck
npm run lint
npm test          # includes a round trip that assembles generated AZM

# The generated file declares its contract policy and routine boundaries.
# The CLI checks them with AZM automatically; --no-check stops after
# generation. Manual assembly uses the same MON-3 register profile:
npx azm --reg-profile mon3 examples/dot.main.asm
npm run format:check
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
