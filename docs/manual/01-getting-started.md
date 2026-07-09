---
layout: default
title: 'Chapter 1 - Getting Started'
parent: 'Glimmer Manual'
nav_order: 1
---

[Manual](index.md) | [The Glimmer Format ->](02-glim-format.md)

# Chapter 1 - Getting Started

Glimmer requires Node.js 20 or newer.

From a checkout:

```sh
npm ci
npm run build
node dist/src/cli.js examples/counter.glim
```

This compiles the CounterToy example to `examples/counter.main.asm` — a
single, readable AZM source file. By default, the CLI also runs AZM in register
contract mode and injects AZM's inferred `;!` contracts into that file.
Skip that with `--no-check` when you only want generation.

When you want the whole toolchain in one step — HEX, binary, and a
Debug80 map — use `build`:

```sh
node dist/src/cli.js build examples/counter.glim
```

This generates the AZM, injects contracts, assembles with AZM, and then
rewrites the `.d8.json` Debug80 map so lines inside your `begin`/`end`
block bodies are attributed to the `.glim` file itself: a breakpoint set
in Glimmer source resolves, and stepping through your own code stays in
the `.glim` file. Generated glue (dispatch, timers, the profile library)
stays attributed to the generated `.asm` — stepping into it drops you
into readable assembly, which is the transparency principle at work.

You can still assemble manually when you prefer — the generated AZM is
an ordinary AZM program:

```sh
npx azm examples/counter.main.asm
```

The `;!` comments above each routine are register contracts — each
routine's true register effects, inferred and injected by AZM as part
of the Glimmer build (the same checking Debug80 applies). Contract
errors in your blocks fail the build with the offending call site
named. Full `--rc strict` checking uses AZM's monitor profile, because
the TEC-1G examples call MON-3 through `RST $10`:
`azm --rc strict --reg-profile mon3 <file>`.

## Your first program

CounterToy is the smallest complete Glimmer program: one state cell, two
key bindings, and three effects.

Press key 1 to increment a counter, key 2 to decrement it, and the counter
is redrawn whenever it changes — not because a handler was called, but
because the `Count` cell was marked _changed_ and the `DrawCount` effect
depends on it. That reactive chain — input sets a pulse, a logic effect
updates
state, a render effect redraws what changed — is the whole programming
model in miniature.

Open the generated `counter.main.asm` and read it. Glimmer's promise is that
the generated assembly is never hidden: every equate, dispatch routine,
and wrapped block is ordinary AZM you can inspect, step through, and
learn from.
