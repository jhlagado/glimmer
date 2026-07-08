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
- [Glimmer Manual](docs/manual/) — user manual draft (pre-alpha, unpublished)

The project is game-first because games exercise timing, input, graphics,
sprites, state, sound, packaging, and performance. It is not intended to be
game-only.

## Status

Early v0. The current vertical slice compiles a single-file `.glim`
meta-source (program, state cells, pulses, key bindings, effects with Z80
block bodies) into one generated AZM source file, which AZM assembles into
`.hex`, `.bin`, and a `.d8.json` Debug80 map. Two examples work end to end:

- `examples/counter.glim` — CounterToy from the spec (generic profile)
- `examples/dot.glim` — a keypad-moved dot on the real TEC-1G 8x8 RGB
  matrix (`platform tec1g-mon3` + `display matrix8x8`): MON-3 `_scanKeys`
  input with held-key autorepeat, scan-driven display loop, edge-clamped
  movement.
- `examples/slide.glim` — the v0.2 runtime: a ramp slides a dot across
  the matrix through a compute block, a timer blinks it, arrival beeps
  through the speaker service and bumps a seven-segment counter.

The repo's `debug80.json` carries `dot` and `slide` targets, so after
`node dist/src/cli.js examples/<name>.glim && npx azm examples/<name>.main.asm`
they run under Debug80.

## Getting Started

Glimmer requires Node.js 20 or newer.

```sh
npm ci
npm run build
node dist/src/cli.js examples/counter.glim   # writes examples/counter.main.asm
npx azm examples/counter.main.asm            # assembles hex/bin/d8 map
```

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

Block-local labels (`_done`) are namespaced per effect into ordinary
globally unique labels in the generated output (`Glim_ApplyIncrement_done`).
Effects run when any of their `on` cells changed; `updates` cells are
marked changed after the effect runs.

## Development

```sh
npm run typecheck
npm run lint
npm test          # includes a round trip that assembles generated AZM

# Contract-checking generated output: audit/warn/error need no flags;
# full strict checking needs the MON-3 profile (the generated file says so
# in its header):
npx azm --rc strict --reg-profile mon3 examples/dot.main.asm
npm run format
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
