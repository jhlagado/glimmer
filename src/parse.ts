/**
 * Parser for the Glimmer meta-source format (.glim).
 *
 * The format is line-oriented. Top-level statements:
 *
 *   program <Name>
 *   platform <name>          (optional; currently tec1g-mon3)
 *   display <name>           (optional; currently matrix8x8, needs platform)
 *   state <Name> : <byte|word> [= <value>] [changed]
 *   pulse <Name>
 *   timer <Name> : <byte|word> = <N> -> <PulseName> [once]
 *   ramp <Name> : byte steps <N> -> <PulseName>
 *   bind key <KEY_NAME> rising -> <PulseName>
 *   bind key <KEY_NAME> held period <N> -> <PulseName>   (tec1g only)
 *   compute <Name>   |  effect <Name>  |  render <Name>
 *       on <Cell>[, <Cell>...]           (the keyword is the phase:
 *       updates <Cell>[, <Cell>...]       compute=derive, effect=logic,
 *   begin                                 render=render; render blocks
 *       ...verbatim Z80 block body...     take no updates)
 *   end
 *
 * Comments start with ';' outside z80 bodies. Bodies are kept verbatim.
 */

import type {
  Binding,
  EffectDecl,
  EffectPhase,
  GlimmerDiagnostic,
  GlimmerProgram,
  PulseDecl,
  RampDecl,
  StateDecl,
  TimerDecl,
} from './model.js';
import { FRAME_COUNT, TEC1G_KEY_CODES } from './model.js';

const PLATFORMS = ['tec1g-mon3'];
const DISPLAYS = ['matrix8x8'];

export interface ParseResult {
  program: GlimmerProgram | null;
  diagnostics: GlimmerDiagnostic[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATE_RE =
  /^state\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(byte|word)(?:\s*=\s*(\S+))?(\s+changed)?$/;
const BIND_KEY_RE =
  /^bind\s+key\s+([A-Za-z_][A-Za-z0-9_]*)\s+(rising|held\s+period\s+\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/;
const TIMER_RE =
  /^timer\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(byte|word)\s*=\s*(\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)(\s+once)?$/;
const RAMP_RE =
  /^ramp\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*byte\s+steps\s+(\S+)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/;

function stripComment(line: string): string {
  const semi = line.indexOf(';');
  return semi >= 0 ? line.slice(0, semi) : line;
}

export function parseNumber(text: string): number | null {
  let value: number;
  if (text.startsWith('$')) {
    value = Number.parseInt(text.slice(1), 16);
  } else if (/^0x/i.test(text)) {
    value = Number.parseInt(text.slice(2), 16);
  } else if (text.startsWith('%')) {
    value = Number.parseInt(text.slice(1), 2);
  } else if (/^[0-9]+$/.test(text)) {
    value = Number.parseInt(text, 10);
  } else {
    return null;
  }
  return Number.isNaN(value) ? null : value;
}

export function parseGlimmer(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const diagnostics: GlimmerDiagnostic[] = [];
  const error = (line: number, message: string): void => {
    diagnostics.push({ line, message });
  };

  let programName: string | null = null;
  let platform: string | null = null;
  let display: string | null = null;
  const states: StateDecl[] = [];
  const pulses: PulseDecl[] = [];
  const timers: TimerDecl[] = [];
  const ramps: RampDecl[] = [];
  const bindings: Binding[] = [];
  const effects: EffectDecl[] = [];

  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const text = stripComment(lines[i] ?? '').trim();
    i += 1;
    if (text === '') continue;

    if (text.startsWith('program ')) {
      const name = text.slice('program '.length).trim();
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid program name "${name}".`);
      } else if (programName !== null) {
        error(lineNo, 'Duplicate program declaration.');
      } else {
        programName = name;
      }
      continue;
    }

    if (text.startsWith('platform ')) {
      const name = text.slice('platform '.length).trim();
      if (!PLATFORMS.includes(name)) {
        error(lineNo, `Unknown platform "${name}". Supported: ${PLATFORMS.join(', ')}.`);
      } else if (platform !== null) {
        error(lineNo, 'Duplicate platform declaration.');
      } else {
        platform = name;
      }
      continue;
    }

    if (text.startsWith('display ')) {
      const name = text.slice('display '.length).trim();
      if (!DISPLAYS.includes(name)) {
        error(lineNo, `Unknown display "${name}". Supported: ${DISPLAYS.join(', ')}.`);
      } else if (display !== null) {
        error(lineNo, 'Duplicate display declaration.');
      } else {
        display = name;
      }
      continue;
    }

    if (text.startsWith('state ')) {
      const match = STATE_RE.exec(text);
      if (!match) {
        error(lineNo, `Invalid state declaration: "${text}".`);
        continue;
      }
      const [, name, type, initialText, changedFlag] = match;
      let initial = 0;
      if (initialText !== undefined) {
        const parsed = parseNumber(initialText);
        if (parsed === null) {
          error(lineNo, `Invalid initial value "${initialText}" for state ${name}.`);
          continue;
        }
        initial = parsed;
      }
      states.push({
        name: name as string,
        type: type as StateDecl['type'],
        initial,
        changedOnStart: changedFlag !== undefined,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('pulse ')) {
      const name = text.slice('pulse '.length).trim();
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid pulse name "${name}".`);
        continue;
      }
      pulses.push({ name, line: lineNo });
      continue;
    }

    if (text.startsWith('timer ')) {
      const match = TIMER_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid timer declaration: "${text}". Expected: timer <Name> : <byte|word> = <N> -> <Pulse> [once].`,
        );
        continue;
      }
      const initial = parseNumber(match[3] as string);
      if (initial === null || initial < 1) {
        error(lineNo, `Timer ${match[1]}: period must be a number of at least 1.`);
        continue;
      }
      timers.push({
        name: match[1] as string,
        type: match[2] as TimerDecl['type'],
        initial,
        target: match[4] as string,
        once: match[5] !== undefined,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('ramp ')) {
      const match = RAMP_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid ramp declaration: "${text}". Expected: ramp <Name> : byte steps <N> -> <Pulse>.`,
        );
        continue;
      }
      const steps = parseNumber(match[2] as string);
      if (steps === null || steps < 2 || steps > 256) {
        error(lineNo, `Ramp ${match[1]}: steps must be between 2 and 256.`);
        continue;
      }
      ramps.push({
        name: match[1] as string,
        steps,
        target: match[3] as string,
        line: lineNo,
      });
      continue;
    }

    if (text.startsWith('bind ')) {
      const match = BIND_KEY_RE.exec(text);
      if (!match) {
        error(
          lineNo,
          `Invalid binding: "${text}". Expected: bind key <KEY> rising -> <Pulse>, or bind key <KEY> held period <N> -> <Pulse>.`,
        );
        continue;
      }
      const trigger = match[2] as string;
      if (trigger === 'rising') {
        bindings.push({
          kind: 'key',
          key: match[1] as string,
          edge: 'rising',
          target: match[3] as string,
          line: lineNo,
        });
      } else {
        const period = parseNumber(trigger.replace(/^held\s+period\s+/, ''));
        if (period === null || period < 1 || period > 255) {
          error(lineNo, `Held binding period must be between 1 and 255.`);
          continue;
        }
        bindings.push({
          kind: 'key',
          key: match[1] as string,
          edge: 'held',
          period,
          target: match[3] as string,
          line: lineNo,
        });
      }
      continue;
    }

    const blockMatch = /^(effect|compute|render)\s+(.*)$/.exec(text);
    if (blockMatch) {
      // Block declarations: the keyword is the phase.
      //   compute X  — derive phase; state computed from other state
      //   effect Y   — logic phase; ordinary game/app behaviour
      //   render Z   — render phase; state depicted, never updated
      const keyword = blockMatch[1] as 'effect' | 'compute' | 'render';
      const phase: EffectPhase =
        keyword === 'compute' ? 'derive' : keyword === 'render' ? 'render' : 'logic';
      const parts = (blockMatch[2] ?? '').trim().split(/\s+/);
      const name = parts[0] ?? '';
      if (!IDENT.test(name)) {
        error(lineNo, `Invalid ${keyword} name "${name}".`);
      }
      if (parts.length > 1) {
        error(
          lineNo,
          `${keyword} takes a single name; unexpected "${parts[1]}". (Phase modifiers were replaced by the compute/render keywords.)`,
        );
      }
      const depends: string[] = [];
      const updates: string[] = [];

      // Header lines until the begin body opens.
      let sawBody = false;
      while (i < lines.length) {
        const headerLineNo = i + 1;
        const header = stripComment(lines[i] ?? '').trim();
        i += 1;
        if (header === '') continue;
        if (header === 'begin') {
          sawBody = true;
          break;
        }
        if (header.startsWith('on ')) {
          depends.push(...splitNames(header.slice('on '.length)));
          continue;
        }
        if (header.startsWith('updates ')) {
          updates.push(...splitNames(header.slice('updates '.length)));
          continue;
        }
        error(headerLineNo, `Unexpected line in ${keyword} ${name}: "${header}".`);
      }

      if (!sawBody) {
        error(lineNo, `${keyword} ${name} has no begin...end body.`);
        continue;
      }

      // Body lines are verbatim until a line containing only "end".
      const body: string[] = [];
      let sawEnd = false;
      while (i < lines.length) {
        const raw = lines[i] ?? '';
        i += 1;
        if (raw.trim() === 'end') {
          sawEnd = true;
          break;
        }
        body.push(raw);
      }
      if (!sawEnd) {
        error(lineNo, `${keyword} ${name}: missing end.`);
        continue;
      }

      if (depends.length === 0) {
        error(lineNo, `${keyword} ${name} has no "on" triggers; it would never run.`);
        continue;
      }
      // The keyword carries its constraints.
      if (keyword === 'render' && updates.length > 0) {
        error(
          lineNo,
          `render ${name} cannot update state cells: render blocks depict state. Use effect or compute.`,
        );
        continue;
      }
      if (keyword === 'compute' && updates.length === 0) {
        error(
          lineNo,
          `compute ${name} must declare updates: computing state is a compute block's purpose.`,
        );
        continue;
      }
      effects.push({ name, phase, depends, updates, body, line: lineNo });
      continue;
    }

    error(lineNo, `Unknown statement: "${text}".`);
  }

  if (programName === null) {
    error(0, 'Missing program declaration.');
  }
  if (display !== null && platform === null) {
    error(0, `display ${display} requires a platform declaration.`);
  }
  if (platform !== null && display === null) {
    error(0, `platform ${platform} currently requires a display declaration.`);
  }
  if (platform === 'tec1g-mon3') {
    for (const binding of bindings) {
      if (!TEC1G_KEY_CODES.has(binding.key)) {
        error(
          binding.line,
          `Unknown tec1g-mon3 key "${binding.key}". Known keys: KEY_0..KEY_F, KEY_PLUS, KEY_MINUS, KEY_GO, KEY_AD.`,
        );
      }
    }
  } else {
    for (const binding of bindings) {
      if (binding.edge === 'held') {
        error(binding.line, 'Held bindings require platform tec1g-mon3.');
      }
    }
  }

  validateReferences({ states, pulses, timers, ramps, bindings, effects }, diagnostics);

  if (diagnostics.length > 0 || programName === null) {
    return { program: null, diagnostics };
  }
  return {
    program: {
      name: programName,
      platform,
      display,
      states,
      pulses,
      timers,
      ramps,
      bindings,
      effects,
    },
    diagnostics,
  };
}

function splitNames(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

function validateReferences(
  parts: Pick<GlimmerProgram, 'states' | 'pulses' | 'timers' | 'ramps' | 'bindings' | 'effects'>,
  diagnostics: GlimmerDiagnostic[],
): void {
  const error = (line: number, message: string): void => {
    diagnostics.push({ line, message });
  };

  // All declared names — states, pulses, effects (and future constructs) —
  // share one namespace: they all project into one flat AZM symbol space.
  // Names that would collide with generated or profile symbols are
  // reserved so the diagnostic points at the .glim line, with AZM's
  // global-uniqueness check as the backstop.
  const declaredNames = new Set<string>();
  const declare = (name: string, line: number, kind: string): void => {
    if (declaredNames.has(name)) {
      error(line, `Duplicate name "${name}": all declared names share one namespace.`);
    }
    declaredNames.add(name);
    if (/^(Glim|CHG_|__)/.test(name) || RESERVED_NAMES.has(name)) {
      error(
        line,
        `Reserved name "${name}": it belongs to the generated runtime (${kind}s cannot use Glim*/CHG_*/__* or runtime symbols).`,
      );
    }
  };

  for (const state of parts.states) declare(state.name, state.line, 'state');
  for (const pulse of parts.pulses) declare(pulse.name, pulse.line, 'pulse');
  for (const timer of parts.timers) declare(timer.name, timer.line, 'timer');
  for (const ramp of parts.ramps) declare(ramp.name, ramp.line, 'ramp');
  for (const effect of parts.effects) declare(effect.name, effect.line, 'effect');

  // `on` accepts anything with a change flag: states, pulses, ramps, and
  // the built-in FrameCount. `updates` accepts what code may write:
  // states, timers (the period register), and ramps (retriggering).
  // Timer cells carry no flag — the pulse is the notification — so they
  // cannot appear in `on`.
  const pulseNames = new Set(parts.pulses.map((pulse) => pulse.name));
  const timerNames = new Set(parts.timers.map((timer) => timer.name));
  const onNames = new Set([
    ...parts.states.map((s) => s.name),
    ...pulseNames,
    ...parts.ramps.map((r) => r.name),
    FRAME_COUNT,
  ]);
  const updateNames = new Set([
    ...parts.states.map((s) => s.name),
    ...timerNames,
    ...parts.ramps.map((r) => r.name),
  ]);

  for (const binding of parts.bindings) {
    if (!pulseNames.has(binding.target)) {
      error(binding.line, `Binding target "${binding.target}" is not a declared pulse.`);
    }
  }
  for (const timer of parts.timers) {
    if (!pulseNames.has(timer.target)) {
      error(
        timer.line,
        `Timer ${timer.name} fires "${timer.target}", which is not a declared pulse.`,
      );
    }
  }
  for (const ramp of parts.ramps) {
    if (!pulseNames.has(ramp.target)) {
      error(ramp.line, `Ramp ${ramp.name} fires "${ramp.target}", which is not a declared pulse.`);
    }
  }

  for (const effect of parts.effects) {
    for (const dep of effect.depends) {
      if (!onNames.has(dep)) {
        const hint = timerNames.has(dep)
          ? ` (timer cells carry no change flag; trigger on the timer's pulse instead)`
          : '';
        error(effect.line, `Effect ${effect.name} triggers on undeclared cell "${dep}".${hint}`);
      }
    }
    for (const target of effect.updates) {
      if (!updateNames.has(target)) {
        error(effect.line, `Effect ${effect.name} updates undeclared state "${target}".`);
      }
    }
  }
}

/** Symbols the generated runtime and profiles own; user names must avoid them. */
const RESERVED_NAMES = new Set([
  'Changed0',
  'MainLoop',
  'Framebuffer',
  'PrevKeys',
  'ScanFrame',
  'MxMask',
  'FbPlot',
  'FbClear',
  'ScanDwellPeriod',
  'ApiScanKeys',
  'PortRow',
  'PortRed',
  'PortGreen',
  'PortBlue',
  'COLOR_RED',
  'COLOR_GREEN',
  'COLOR_BLUE',
  'COLOR_WHITE',
  'API_ReadKeys',
  'API_DrawChar',
  'API_FlushDisplay',
  'API_InitDisplay',
  'FrameCount',
  'PortDigits',
  'PortSegs',
  'SpeakerBit',
  'SpeakerPort',
  'SoundTimer',
  'SndDivReload',
  'SndDivCount',
  'SndStart',
  'SndService',
  'HudScanDig',
  'HudBlankDig',
  'HudWriteU16',
  'HudDecDigit',
  'HudSegBuffer',
  'HudScanIndex',
  'HudMaskTbl',
  'HudGlyphTbl',
]);
