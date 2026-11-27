import type { Problem } from '../types';

/* Level 4 "Debugger & Extender" problems (author slice a2). */
const problems: Problem[] = [
  {
    id: "l4-a-ts-dst-scheduler",
    title: "The Stand-up That Moved an Hour",
    level: 4,
    rating: 2350,
    lang: "typescript",
    domain: "scheduler",
    companies: ["google","atlassian","microsoft","canva"],
    tags: ["timezones","dst","date-arithmetic","two-bugs"],
    summary: "A 09:00 New York job fires at 10:00 after the clocks change, and the Monday job runs on Sunday night.",
    context: `You've joined the team behind **cron-lite**, the in-process scheduler that fires reminders and reports for every customer workspace.

Two tickets landed the Monday after US daylight saving started:

* *"Our 09:00 stand-up reminder arrived at 10:00 today and yesterday."* (America/New_York)
* *"Our Mon/Wed 21:00 digest arrived on **Sunday** and **Tuesday** evenings."*

Read \`README.md\` first: it states the product contract for wall-clock times, gaps and overlaps. The repo deliberately carries its own tiny zone table (\`src/tz/rules.ts\`), so nothing depends on the host machine's time zone.`,
    persona: "confident-intern",
    files: [
      {
        path: "README.md",
        content: `# cron-lite: in-process job scheduler

Jobs are defined by a **recurrence rule** in a **named time zone**:

\`\`\`ts
{ freq: 'daily', interval: 1, at: '09:00', zone: 'America/New_York' }
{ freq: 'weekly', interval: 1, at: '21:00', zone: 'America/New_York', byWeekday: [1, 3] } // Mon + Wed
\`\`\`

## Contract (agreed with product)

* \`at\` is a **wall-clock** time in the job's zone. A 09:00 job runs at 09:00 local
  time every day, in winter and in summer.
* \`byWeekday\` uses 0 = Sunday ... 6 = Saturday and refers to the **local** date in the job's zone.
* \`interval\` = run every N days (daily) or every N weeks (weekly, interval must be 1 for now).
* **Gaps** (spring forward, e.g. 02:30 does not exist): run at the same instant the clock
  would show if it had not jumped, i.e. shifted forward by the gap (02:30 -> 03:30).
  The *next* day the job is back at 02:30.
* **Overlaps** (fall back, e.g. 01:30 happens twice): run once, at the **first** occurrence.

We do not use the host time zone database: \`src/tz/rules.ts\` holds a small, fixed rule table
so behaviour is identical on every machine.

## Layout

| file | role |
|------|------|
| \`src/tz/rules.ts\` | zone rule table + DST transition instants for a year |
| \`src/tz/zone.ts\` | \`offsetAt\`, \`utcToLocal\`, \`localToUtc\` (gap / overlap resolution) |
| \`src/time/localdate.ts\` | wall-clock date arithmetic (no zones) |
| \`src/time/format.ts\` | \`formatInZone\` for logs and the UI |
| \`src/scheduler/recurrence.ts\` | first / next occurrence of a rule |
| \`src/scheduler/validate.ts\` | rule validation |
| \`src/scheduler/store.ts\` | in-memory job store |
| \`src/scheduler/clock.ts\` | \`Clock\` + \`FakeClock\` |
| \`src/scheduler/scheduler.ts\` | \`Scheduler\`: register, upcoming, tick |
`,
        language: "markdown",
      },
      {
        path: "src/scheduler/scheduler.ts",
        content: `import { JobStore } from './store';
import { Clock } from './clock';
import { RecurrenceRule, firstOccurrence, nextOccurrence } from './recurrence';
import { validateRule } from './validate';
import { LocalDate } from '../time/localdate';

export class Scheduler {
  constructor(private store: JobStore, private clock: Clock) {}

  register(id: string, rule: RecurrenceRule, from: LocalDate): void {
    validateRule(rule);
    this.store.put({ id, rule, nextRunUtc: firstOccurrence(rule, from), runs: [] });
  }

  /** The next \`count\` run instants of a job, starting with its pending one. */
  upcoming(id: string, count: number): number[] {
    const job = this.store.get(id);
    const out: number[] = [];
    let t = job.nextRunUtc;
    for (let i = 0; i < count; i++) {
      out.push(t);
      t = nextOccurrence(job.rule, t);
    }
    return out;
  }

  /** Run every job that is due at the clock's current time. Returns ids in run order. */
  tick(): string[] {
    const now = this.clock.now();
    const ran: string[] = [];
    for (const job of this.store.all()) {
      while (job.nextRunUtc <= now) {
        job.runs.push(job.nextRunUtc);
        ran.push(job.id);
        job.nextRunUtc = nextOccurrence(job.rule, job.nextRunUtc);
      }
    }
    return ran;
  }

  history(id: string): number[] {
    return [...this.store.get(id).runs];
  }
}
`,
      },
      {
        path: "src/scheduler/recurrence.ts",
        content: `import { localToUtc } from '../tz/zone';
import { LocalDate, addDays, atTime } from '../time/localdate';

export type Freq = 'daily' | 'weekly';

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  at: string; // "HH:MM" wall-clock time in \`zone\`
  zone: string;
  byWeekday?: number[]; // weekly only, 0 = Sunday
}

const DAY_MS = 24 * 60 * 60 * 1000;

function runsOn(rule: RecurrenceRule, utcMs: number): boolean {
  if (rule.freq !== 'weekly' || !rule.byWeekday) return true;
  return rule.byWeekday.includes(new Date(utcMs).getUTCDay());
}

/** First occurrence on or after the local date \`from\`. */
export function firstOccurrence(rule: RecurrenceRule, from: LocalDate): number {
  let day = from;
  for (let i = 0; i < 8; i++) {
    const utc = localToUtc(rule.zone, atTime(day, rule.at));
    if (runsOn(rule, utc)) return utc;
    day = addDays(day, 1);
  }
  throw new Error('rule never fires');
}

/** The occurrence after \`prevUtc\` (which must itself be an occurrence of \`rule\`). */
export function nextOccurrence(rule: RecurrenceRule, prevUtc: number): number {
  if (rule.freq === 'daily') {
    return prevUtc + rule.interval * DAY_MS;
  }
  let t = prevUtc;
  for (let i = 0; i < 7; i++) {
    t += DAY_MS;
    if (runsOn(rule, t)) return t;
  }
  throw new Error('rule never fires');
}
`,
      },
      {
        path: "src/tz/zone.ts",
        content: `import { getZone, dstWindow } from './rules';
import { LocalDateTime, toFieldMs, fromFieldMs } from '../time/localdate';

const MIN = 60_000;

/** UTC offset (minutes east) in effect at the instant \`utcMs\`. */
export function offsetAt(zoneName: string, utcMs: number): number {
  const zone = getZone(zoneName);
  const w = dstWindow(zone, new Date(utcMs).getUTCFullYear());
  if (w && utcMs >= w.startUtc && utcMs < w.endUtc) return zone.dstOffsetMin as number;
  return zone.stdOffsetMin;
}

/** Wall-clock fields shown in \`zoneName\` at the instant \`utcMs\`. */
export function utcToLocal(zoneName: string, utcMs: number): LocalDateTime {
  return fromFieldMs(utcMs + offsetAt(zoneName, utcMs) * MIN);
}

/**
 * The instant at which the wall clock in \`zoneName\` shows \`local\`.
 *  - overlap (time happens twice): the EARLIER instant
 *  - gap (time never happens): shifted forward by the length of the gap
 */
export function localToUtc(zoneName: string, local: LocalDateTime): number {
  const zone = getZone(zoneName);
  const asUtc = toFieldMs(local);
  const offsets = zone.dstOffsetMin === null ? [zone.stdOffsetMin] : [zone.stdOffsetMin, zone.dstOffsetMin];
  const candidates = offsets
    .map((off) => asUtc - off * MIN)
    .filter((utc) => toFieldMs(utcToLocal(zoneName, utc)) === asUtc)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0];
  // Gap: interpret with the offset that was in effect just before the transition.
  const before = offsetAt(zoneName, asUtc - 24 * 60 * MIN);
  return asUtc - before * MIN;
}
`,
      },
      {
        path: "src/tz/rules.ts",
        content: `/**
 * A tiny, fixed time zone rule table. Offsets are minutes EAST of UTC.
 * DST (when present) starts on the nth Sunday of \`start.month\` at \`start.atMin\`
 * minutes after local midnight (standard time) and ends on the nth Sunday of
 * \`end.month\` at \`end.atMin\` minutes after local midnight (daylight time).
 */
export interface Transition {
  month: number; // 1-12
  nth: number; // 1 = first Sunday, 2 = second Sunday, ...
  atMin: number; // minutes after local midnight
}

export interface ZoneRule {
  name: string;
  stdOffsetMin: number;
  dstOffsetMin: number | null;
  start?: Transition;
  end?: Transition;
}

export const ZONES: Record<string, ZoneRule> = {
  UTC: { name: 'UTC', stdOffsetMin: 0, dstOffsetMin: null },
  'Asia/Kolkata': { name: 'Asia/Kolkata', stdOffsetMin: 330, dstOffsetMin: null },
  'America/New_York': {
    name: 'America/New_York',
    stdOffsetMin: -300,
    dstOffsetMin: -240,
    start: { month: 3, nth: 2, atMin: 120 },
    end: { month: 11, nth: 1, atMin: 120 },
  },
};

export function getZone(name: string): ZoneRule {
  const z = ZONES[name];
  if (!z) throw new Error(\`unknown zone \${name}\`);
  return z;
}

/** Day of month of the nth Sunday of (year, month). */
export function nthSunday(year: number, month: number, nth: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return firstSunday + (nth - 1) * 7;
}

export interface DstWindow {
  startUtc: number; // first instant of daylight time
  endUtc: number; // first instant back on standard time
}

/** UTC instants at which DST starts and ends in \`year\`, or null for zones without DST. */
export function dstWindow(zone: ZoneRule, year: number): DstWindow | null {
  if (zone.dstOffsetMin === null || !zone.start || !zone.end) return null;
  const s = zone.start;
  const e = zone.end;
  const startLocal = Date.UTC(year, s.month - 1, nthSunday(year, s.month, s.nth)) + s.atMin * 60_000;
  const endLocal = Date.UTC(year, e.month - 1, nthSunday(year, e.month, e.nth)) + e.atMin * 60_000;
  return {
    startUtc: startLocal - zone.stdOffsetMin * 60_000,
    endUtc: endLocal - zone.dstOffsetMin * 60_000,
  };
}
`,
      },
      {
        path: "src/time/localdate.ts",
        content: `/** Wall-clock date/time with no zone attached. month is 1-12. */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/** Encode wall-clock fields as if they were UTC (only for arithmetic / comparison). */
export function toFieldMs(l: LocalDateTime): number {
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
}

export function fromFieldMs(ms: number): LocalDateTime {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** Calendar arithmetic on the wall-clock date: 23-hour and 25-hour days do not exist here. */
export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Sunday ... 6 = Saturday, for the wall-clock date. */
export function weekdayOf(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function atTime(d: LocalDate, hhmm: string): LocalDateTime {
  const [hour, minute] = parseHHMM(hhmm);
  return { year: d.year, month: d.month, day: d.day, hour, minute };
}

export function dateOf(l: LocalDateTime): LocalDate {
  return { year: l.year, month: l.month, day: l.day };
}

export function parseHHMM(hhmm: string): [number, number] {
  const m = /^([01]\\d|2[0-3]):([0-5]\\d)$/.exec(hhmm);
  if (!m) throw new Error(\`bad time \${hhmm}\`);
  return [Number(m[1]), Number(m[2])];
}

export const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');
`,
      },
      {
        path: "src/time/format.ts",
        content: `import { offsetAt, utcToLocal } from '../tz/zone';
import { pad } from './localdate';

/** e.g. "2026-03-08 09:00 -04:00 (Sun)" */
export function formatInZone(zoneName: string, utcMs: number): string {
  const l = utcToLocal(zoneName, utcMs);
  const off = offsetAt(zoneName, utcMs);
  const sign = off < 0 ? '-' : '+';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(l.year, l.month - 1, l.day)).getUTCDay()];
  return \`\${l.year}-\${pad(l.month)}-\${pad(l.day)} \${pad(l.hour)}:\${pad(l.minute)} \${sign}\${pad(Math.floor(Math.abs(off) / 60))}:\${pad(Math.abs(off) % 60)} (\${dow})\`;
}

export function formatUtc(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}
`,
      },
      {
        path: "src/scheduler/validate.ts",
        content: `import { RecurrenceRule } from './recurrence';
import { getZone } from '../tz/rules';
import { parseHHMM } from '../time/localdate';

export function validateRule(rule: RecurrenceRule): void {
  getZone(rule.zone); // throws for unknown zones
  parseHHMM(rule.at);
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new Error('interval must be a positive integer');
  }
  if (rule.freq === 'weekly') {
    if (rule.interval !== 1) throw new Error('weekly rules support interval 1 only');
    if (!rule.byWeekday || rule.byWeekday.length === 0) throw new Error('weekly rules need byWeekday');
    if (rule.byWeekday.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new Error('byWeekday values are 0..6');
    }
  } else if (rule.byWeekday) {
    throw new Error('byWeekday is only valid for weekly rules');
  }
}
`,
      },
      {
        path: "src/scheduler/store.ts",
        content: `import { RecurrenceRule } from './recurrence';

export interface Job {
  id: string;
  rule: RecurrenceRule;
  nextRunUtc: number;
  runs: number[];
}

export class JobStore {
  private jobs = new Map<string, Job>();

  put(job: Job): void {
    this.jobs.set(job.id, job);
  }

  get(id: string): Job {
    const j = this.jobs.get(id);
    if (!j) throw new Error(\`no job \${id}\`);
    return j;
  }

  all(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.nextRunUtc - b.nextRunUtc || a.id.localeCompare(b.id));
  }
}
`,
      },
      {
        path: "src/scheduler/clock.ts",
        content: `export interface Clock {
  now(): number;
}

export class FakeClock implements Clock {
  constructor(private t: number) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
`,
      },
      {
        path: "src/main.ts",
        content: `import { Scheduler } from './scheduler/scheduler';
import { JobStore } from './scheduler/store';
import { FakeClock } from './scheduler/clock';
import { formatInZone } from './time/format';

const zone = 'America/New_York';
const s = new Scheduler(new JobStore(), new FakeClock(0));
s.register('standup', { freq: 'daily', interval: 1, at: '09:00', zone }, { year: 2026, month: 3, day: 6 });

for (const t of s.upcoming('standup', 4)) {
  console.log(formatInZone(zone, t));
}
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "predict",
        title: "Reproduce the ticket",
        prompt: "Run `src/main.ts` in your head. A daily 09:00 New York job is registered starting **Fri 6 March 2026**; US DST starts at 02:00 on **Sun 8 March 2026**. What does it print?",
        entry: "src/main.ts",
        focusFile: "src/main.ts",
        options: [
          `2026-03-06 09:00 -05:00 (Fri)
2026-03-07 09:00 -05:00 (Sat)
2026-03-08 09:00 -04:00 (Sun)
2026-03-09 09:00 -04:00 (Mon)`,
          `2026-03-06 09:00 -05:00 (Fri)
2026-03-07 09:00 -05:00 (Sat)
2026-03-08 10:00 -04:00 (Sun)
2026-03-09 10:00 -04:00 (Mon)`,
          `2026-03-06 09:00 -05:00 (Fri)
2026-03-07 09:00 -05:00 (Sat)
2026-03-08 08:00 -04:00 (Sun)
2026-03-09 08:00 -04:00 (Mon)`,
          `2026-03-06 09:00 -05:00 (Fri)
2026-03-07 09:00 -05:00 (Sat)
2026-03-08 10:00 -04:00 (Sun)
2026-03-09 09:00 -04:00 (Mon)`,
        ],
        answer: `2026-03-06 09:00 -05:00 (Fri)
2026-03-07 09:00 -05:00 (Sat)
2026-03-08 10:00 -04:00 (Sun)
2026-03-09 10:00 -04:00 (Mon)`,
        hints: [
          "Only the first occurrence goes through `localToUtc`. How are the later ones computed?",
          "Sat 09:00 EST is 14:00Z. Add exactly 24 hours and convert 14:00Z back using the summer offset of -04:00.",
        ],
        explanation: `\`firstOccurrence\` resolves the wall-clock time correctly (09:00 EST = 14:00Z). After that, \`nextOccurrence\` just adds \`24 * 60 * 60 * 1000\` ms to the **UTC instant**. Sunday 8 March is only 23 hours long in New York, so 14:00Z on Sunday is **10:00 EDT**, and every later run stays an hour late: once the error is baked into the UTC instant, adding 24h preserves it forever (until November, when it snaps back).

The lesson: "one day later" is a *calendar* operation on the local date, not "+86 400 000 ms".`,
        timeLimitSec: 360,
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace job registration",
        prompt: "Order the steps executed by `scheduler.register(id, rule, from)` for a **weekly** rule whose first candidate day matches.",
        items: [
          "Scheduler.register",
          "validateRule checks zone, time and interval",
          "firstOccurrence(rule, from)",
          "atTime builds the wall-clock LocalDateTime",
          "localToUtc tries the standard and daylight offsets",
          "utcToLocal / offsetAt round-trip each candidate",
          "runsOn filters by weekday",
          "JobStore.put stores nextRunUtc",
        ],
        hints: [
          "`firstOccurrence` converts to UTC *before* it checks the weekday. Is that order a hint about the second ticket?",
        ],
        explanation: "`register` validates, then `firstOccurrence` builds `atTime(day, rule.at)`, converts it with `localToUtc` (which keeps only the candidate offsets that round-trip through `utcToLocal`/`offsetAt`), and only **then** asks `runsOn` whether the day matches. Because `runsOn` receives a UTC instant it calls `getUTCDay()`, the weekday in London, not New York. 21:00 EST on Monday is 02:00Z on **Tuesday**, which is why the Mon/Wed digest drifted onto other days.",
        timeLimitSec: 360,
        focusFile: "src/scheduler/scheduler.ts",
      },
      {
        id: "s3",
        kind: "find-bug",
        title: "Root cause of the 10:00 stand-up",
        prompt: "Click the line that makes the daily job drift by an hour after a DST change, then pick the root cause.",
        file: "src/scheduler/recurrence.ts",
        lines: [35],
        options: [
          "Days are stepped by a fixed 24h on the UTC timeline, but local days can be 23 or 25 hours long",
          "`DAY_MS` is off by a factor of 60",
          "`offsetAt` uses the wrong DST start rule for New York",
          "`interval` should be multiplied by 7 for daily rules",
        ],
        correct: 0,
        hints: ["The zone code is fine: the very first occurrence is right."],
        explanation: "Line 35 adds a fixed duration to an instant. That is the right model for \"every 24 hours\" but the wrong model for \"every day at 09:00\". The weekly branch (line 39) has the same flaw. The fix is to step the **local date** (`addDays`) and re-resolve `rule.at` through `localToUtc` each time.",
        timeLimitSec: 240,
        focusFile: "src/scheduler/recurrence.ts",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Fix both DST tickets",
        prompt: `There are **two bugs** in \`src/scheduler/recurrence.ts\`. Make the scheduler honour the README contract:

* runs keep their **wall-clock** time across DST changes (daily, every-N-days and weekly rules),
* \`byWeekday\` refers to the **local** weekday in the job's zone,
* gap: \`02:30\` on spring-forward day runs at 03:30, and the *next* day is back at 02:30,
* overlap: \`01:30\` on fall-back day runs once, at the first 01:30.

A visible failing test:

\`\`\`
✗ weekly Mon+Wed 21:00 New York uses the local weekday
  Expected: [ '2026-03-02 21:00 -05:00 (Mon)', ... ]
  Received: [ '2026-03-01 21:00 -05:00 (Sun)', ... ]
\`\`\``,
        editable: ["src/scheduler/recurrence.ts"],
        tests: [
          {
            path: "tests/scheduler.test.ts",
            content: `import { Scheduler } from '../src/scheduler/scheduler';
import { JobStore } from '../src/scheduler/store';
import { FakeClock } from '../src/scheduler/clock';
import { formatInZone } from '../src/time/format';

const NY = 'America/New_York';

function upcoming(rule: any, from: any, n: number, zone = rule.zone): string[] {
  const s = new Scheduler(new JobStore(), new FakeClock(0));
  s.register('j', rule, from);
  return s.upcoming('j', n).map((t) => formatInZone(zone, t));
}

test('daily 09:00 stays at 09:00 across spring forward', () => {
  expect(upcoming({ freq: 'daily', interval: 1, at: '09:00', zone: NY }, { year: 2026, month: 3, day: 6 }, 5)).toEqual([
    '2026-03-06 09:00 -05:00 (Fri)',
    '2026-03-07 09:00 -05:00 (Sat)',
    '2026-03-08 09:00 -04:00 (Sun)',
    '2026-03-09 09:00 -04:00 (Mon)',
    '2026-03-10 09:00 -04:00 (Tue)',
  ]);
});

test('daily 09:00 stays at 09:00 across fall back', () => {
  expect(upcoming({ freq: 'daily', interval: 1, at: '09:00', zone: NY }, { year: 2026, month: 10, day: 31 }, 3)).toEqual([
    '2026-10-31 09:00 -04:00 (Sat)',
    '2026-11-01 09:00 -05:00 (Sun)',
    '2026-11-02 09:00 -05:00 (Mon)',
  ]);
});

test('every 2 days keeps wall-clock time', () => {
  expect(upcoming({ freq: 'daily', interval: 2, at: '07:15', zone: NY }, { year: 2026, month: 3, day: 5 }, 4)).toEqual([
    '2026-03-05 07:15 -05:00 (Thu)',
    '2026-03-07 07:15 -05:00 (Sat)',
    '2026-03-09 07:15 -04:00 (Mon)',
    '2026-03-11 07:15 -04:00 (Wed)',
  ]);
});

test('gap: 02:30 on spring-forward day runs at 03:30, then back to 02:30', () => {
  expect(upcoming({ freq: 'daily', interval: 1, at: '02:30', zone: NY }, { year: 2026, month: 3, day: 7 }, 4)).toEqual([
    '2026-03-07 02:30 -05:00 (Sat)',
    '2026-03-08 03:30 -04:00 (Sun)',
    '2026-03-09 02:30 -04:00 (Mon)',
    '2026-03-10 02:30 -04:00 (Tue)',
  ]);
});

test('overlap: 01:30 on fall-back day runs once, at the first 01:30', () => {
  expect(upcoming({ freq: 'daily', interval: 1, at: '01:30', zone: NY }, { year: 2026, month: 10, day: 31 }, 3)).toEqual([
    '2026-10-31 01:30 -04:00 (Sat)',
    '2026-11-01 01:30 -04:00 (Sun)',
    '2026-11-02 01:30 -05:00 (Mon)',
  ]);
});

test('weekly Mon+Wed 21:00 New York uses the local weekday', () => {
  expect(
    upcoming({ freq: 'weekly', interval: 1, at: '21:00', zone: NY, byWeekday: [1, 3] }, { year: 2026, month: 3, day: 1 }, 5),
  ).toEqual([
    '2026-03-02 21:00 -05:00 (Mon)',
    '2026-03-04 21:00 -05:00 (Wed)',
    '2026-03-09 21:00 -04:00 (Mon)',
    '2026-03-11 21:00 -04:00 (Wed)',
    '2026-03-16 21:00 -04:00 (Mon)',
  ]);
});

test('weekly Friday 08:00 Kolkata (east of UTC) uses the local weekday', () => {
  expect(
    upcoming({ freq: 'weekly', interval: 1, at: '03:00', zone: 'Asia/Kolkata', byWeekday: [5] }, { year: 2026, month: 3, day: 1 }, 2),
  ).toEqual(['2026-03-06 03:00 +05:30 (Fri)', '2026-03-13 03:00 +05:30 (Fri)']);
});

test('tick runs due jobs once each and reschedules on wall-clock time', () => {
  const clock = new FakeClock(Date.UTC(2026, 2, 7, 0, 0));
  const s = new Scheduler(new JobStore(), clock);
  s.register('report', { freq: 'daily', interval: 1, at: '09:00', zone: NY }, { year: 2026, month: 3, day: 7 });
  expect(s.tick()).toEqual([]);
  clock.set(Date.UTC(2026, 2, 9, 0, 0)); // Mon 00:00Z = Sun 20:00 EDT
  expect(s.tick()).toEqual(['report', 'report']);
  expect(s.history('report').map((t) => formatInZone(NY, t))).toEqual([
    '2026-03-07 09:00 -05:00 (Sat)',
    '2026-03-08 09:00 -04:00 (Sun)',
  ]);
});
`,
          },
        ],
        solution: {
          "src/scheduler/recurrence.ts": `import { localToUtc, utcToLocal } from '../tz/zone';
import { LocalDate, addDays, atTime, dateOf, weekdayOf } from '../time/localdate';

export type Freq = 'daily' | 'weekly';

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  at: string; // "HH:MM" wall-clock time in \`zone\`
  zone: string;
  byWeekday?: number[]; // weekly only, 0 = Sunday
}

/** Weekday filtering is about the LOCAL calendar date, never the UTC one. */
function runsOn(rule: RecurrenceRule, day: LocalDate): boolean {
  if (rule.freq !== 'weekly' || !rule.byWeekday) return true;
  return rule.byWeekday.includes(weekdayOf(day));
}

/** First occurrence on or after the local date \`from\`. */
export function firstOccurrence(rule: RecurrenceRule, from: LocalDate): number {
  let day = from;
  for (let i = 0; i < 8; i++) {
    if (runsOn(rule, day)) return localToUtc(rule.zone, atTime(day, rule.at));
    day = addDays(day, 1);
  }
  throw new Error('rule never fires');
}

/** The occurrence after \`prevUtc\` (which must itself be an occurrence of \`rule\`). */
export function nextOccurrence(rule: RecurrenceRule, prevUtc: number): number {
  // Step on the wall-clock calendar, then re-resolve rule.at in the zone.
  // Note: take the DATE of the previous run, not its time - a gap-shifted run
  // (02:30 -> 03:30) must not drag later runs to 03:30.
  let day = dateOf(utcToLocal(rule.zone, prevUtc));
  const step = rule.freq === 'daily' ? rule.interval : 1;
  for (let i = 0; i < 8; i++) {
    day = addDays(day, step);
    if (runsOn(rule, day)) return localToUtc(rule.zone, atTime(day, rule.at));
  }
  throw new Error('rule never fires');
}
`,
        },
        hints: [
          "`src/time/localdate.ts` already has `addDays`, `weekdayOf`, `dateOf` and `atTime`.",
          "Convert the previous run to local time, take its **date**, step the date, then call `localToUtc(zone, atTime(day, rule.at))`.",
          "Do not reuse the previous run's local *time*: after a gap shift it is 03:30, but the next day must be 02:30 again.",
        ],
        explanation: `Two fixes, both "do calendar logic in the local calendar":

1. **Stepping**: \`nextOccurrence\` takes \`dateOf(utcToLocal(zone, prevUtc))\`, adds \`interval\` days (or walks day by day for weekly), and resolves \`atTime(day, rule.at)\` with \`localToUtc\`. Using \`rule.at\` rather than the previous run's local time matters after a gap: the 03:30 run on 8 March must not turn every later run into 03:30.
2. **Weekday**: \`runsOn\` must look at the local date (\`weekdayOf(day)\`), not \`new Date(utc).getUTCDay()\`. For New York evenings the UTC date is already tomorrow; for Kolkata early mornings it is still yesterday.

The overlap rule comes for free because \`localToUtc\` already returns the earliest candidate. A good test matrix for any scheduler: both transitions, a time inside the gap, a time inside the overlap, a zone west and east of UTC, and a fixed-offset zone.`,
        timeLimitSec: 1200,
        focusFile: "src/scheduler/recurrence.ts",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "A \"minimal\" fix from the assistant",
        prompt: "A teammate asked the assistant for a smaller fix that keeps the UTC arithmetic. Review it against the README contract.",
        persona: "confident-intern",
        request: "Can you fix the daily DST drift without rewriting nextOccurrence? Keep it small.",
        aiReply: `Sure! We just need to compensate for the offset change between the two instants:

\`\`\`ts
if (rule.freq === 'daily') {
  const naive = prevUtc + rule.interval * DAY_MS;
  const delta = offsetAt(rule.zone, prevUtc) - offsetAt(rule.zone, naive);
  return naive + delta * 60_000;
}
\`\`\`

Spring forward: offsets -300 → -240, delta = -60 min, so we pull the run back one hour to 09:00 EDT. Fall back works the same way in reverse. Two lines, no calendar maths needed. 🚀`,
        options: [
          "Accept: it handles both transitions for any time of day",
          "Reject: for a 02:30 job, the run on spring-forward day lands at 01:30 EST instead of 03:30 EDT, and every later run then stays at 01:30",
          "Reject: `delta` has the wrong sign, so 09:00 jobs move to 08:00 after spring forward",
          "Reject: `offsetAt` throws for instants after the DST end",
        ],
        correct: 1,
        hints: [
          "Try it on a time that does not exist: daily 02:30, previous run Sat 7 March 02:30 EST (07:30Z).",
          "naive = Sun 07:30Z, which is after the 07:00Z transition. What is `delta`, and what local time is the result?",
        ],
        explanation: `For 09:00 jobs the patch works (that's why it looks convincing). Now take a 02:30 job: prev = 07:30Z Sat. naive = 07:30Z Sun, already on EDT, so delta = -300 - (-240) = -60 min and the result is **06:30Z = 01:30 EST**. The contract says 03:30 EDT. Worse, the state is still carried as a UTC instant: next day prev = 06:30Z (EST) and naive = 06:30Z Mon (EDT), so delta is again -60 and the job settles at **01:30 forever**. The patch also leaves the weekly branch and the UTC-weekday bug untouched.

Offset-compensation hacks keep failing near transitions because they infer the *local intent* from instants. Carry the intent (local date + \`rule.at\`) and resolve it each time.`,
        timeLimitSec: 420,
        focusFile: "src/scheduler/recurrence.ts",
      },
    ],
  },
  {
    id: "l4-a-py-invoice-split",
    title: "The Cent That Went to the Wrong Person",
    level: 4,
    rating: 2150,
    lang: "python",
    domain: "payments",
    companies: ["stripe","atlassian","canva","goldman"],
    tags: ["money","rounding","largest-remainder","two-bugs","negative-numbers"],
    summary: "Invoice splitting charges the leftover cent to the wrong person, and credit notes blow up the ledger.",
    context: `You're on the **Billing** team. Group trips are settled by splitting an invoice between participants by integer *shares* (Alice stayed two nights, so she has weight 2).

Finance's rule, from \`billing/allocation.py\`: the parts must sum **exactly** to the invoice total, each part must be within one cent of its exact share, leftover cents go to the **largest fractional remainders** (ties to the earlier participant), and refunds mirror charges.

Two complaints this week: Bob says he paid a cent that should have been Alice's, and every **credit note** (refund) fails to post with \`LedgerImbalance\`.`,
    persona: "confident-intern",
    files: [
      {
        path: "main.py",
        content: `from billing.invoice import Invoice
from billing.ledger import Ledger, LedgerImbalance
from billing.money import to_cents
from billing.service import SplitService

svc = SplitService(Ledger())
shares = {"alice": 2, "bob": 1, "carol": 1}

trip = (
    Invoice("INV-1")
    .add("Hotel", to_cents("129.99"), 3, "standard")
    .add("Dinner", to_cents("87.45"), 1, "food")
    .add("Taxi", to_cents("23.10"), 1, "exempt")
)
print(svc.settle(trip, shares))

refund = Invoice("CN-1").add("Dinner refund", to_cents("87.45"), -1, "food")
try:
    print(svc.settle(refund, {"alice": 1, "bob": 1, "carol": 1}))
except LedgerImbalance as e:
    print(f"LedgerImbalance: {e}")
`,
      },
      {
        path: "billing/__init__.py",
        content: "",
      },
      {
        path: "billing/allocation.py",
        content: `def allocate(total_cents: int, weights: list) -> list:
    """Split total_cents into integer parts proportional to weights (largest remainder method).

    Guarantees (finance relies on every one of these):
      * sum(result) == total_cents, always
      * each part is within 1 cent of its exact share total_cents * w / sum(weights)
      * leftover cents go to the parts with the LARGEST fractional remainder;
        ties go to the earlier party
      * sign symmetry: allocate(-t, w) == [-x for x in allocate(t, w)]
    """
    if not weights or any(w < 0 for w in weights) or sum(weights) == 0:
        raise ValueError("weights must be non-negative and not all zero")
    wsum = sum(weights)
    exact = [total_cents * w / wsum for w in weights]
    parts = [int(x) for x in exact]
    leftover = total_cents - sum(parts)
    by_remainder = sorted(range(len(weights)), key=lambda i: exact[i] - parts[i])
    for i in by_remainder[:leftover]:
        parts[i] += 1
    return parts
`,
      },
      {
        path: "billing/split.py",
        content: `from billing.allocation import allocate
from billing.invoice import Invoice


def split_invoice(invoice: Invoice, shares: dict) -> dict:
    """Who owes what. \`shares\` maps participant -> integer weight (insertion order matters for ties)."""
    names = list(shares)
    parts = allocate(invoice.total, [shares[n] for n in names])
    return dict(zip(names, parts))


def split_lines(invoice: Invoice, shares: dict) -> list:
    """Itemised view for the PDF: one allocation per line. Display only - never post this."""
    names = list(shares)
    weights = [shares[n] for n in names]
    rows = []
    for line in invoice.lines:
        rows.append((line.description, dict(zip(names, allocate(line.total, weights)))))
    return rows
`,
      },
      {
        path: "billing/service.py",
        content: `from billing.ledger import Ledger
from billing.split import split_invoice
from billing.report import render_split


class SplitService:
    """Entry point used by the API: split, post to the ledger, render."""

    def __init__(self, ledger: Ledger):
        self.ledger = ledger

    def settle(self, invoice, shares: dict) -> str:
        split = split_invoice(invoice, shares)
        self.ledger.post_split(invoice, split)
        return render_split(invoice, split)
`,
      },
      {
        path: "billing/ledger.py",
        content: `from billing.invoice import Invoice


class LedgerImbalance(Exception):
    pass


class Ledger:
    """Double-entry: every posting batch must sum to zero."""

    def __init__(self):
        self.entries = []  # (doc_id, account, cents)

    def post_split(self, invoice: Invoice, split: dict) -> None:
        owed = sum(split.values())
        if owed != invoice.total:
            raise LedgerImbalance(f"{invoice.id} split {owed} != total {invoice.total}")
        for name, cents in split.items():
            self.entries.append((invoice.id, f"receivable:{name}", cents))
        self.entries.append((invoice.id, "revenue", -invoice.total))

    def balance(self, account: str) -> int:
        return sum(c for _, a, c in self.entries if a == account)
`,
      },
      {
        path: "billing/invoice.py",
        content: `from dataclasses import dataclass, field

from billing.tax import tax_for


@dataclass(frozen=True)
class LineItem:
    description: str
    unit_cents: int
    qty: int  # negative on credit notes
    category: str = "standard"

    @property
    def net(self) -> int:
        return self.unit_cents * self.qty

    @property
    def tax(self) -> int:
        return tax_for(self.net, self.category)

    @property
    def total(self) -> int:
        return self.net + self.tax


@dataclass
class Invoice:
    id: str
    lines: list = field(default_factory=list)

    def add(self, description: str, unit_cents: int, qty: int = 1, category: str = "standard") -> "Invoice":
        self.lines.append(LineItem(description, unit_cents, qty, category))
        return self

    @property
    def total(self) -> int:
        return sum(line.total for line in self.lines)

    @property
    def is_credit_note(self) -> bool:
        return self.total < 0
`,
      },
      {
        path: "billing/tax.py",
        content: `from decimal import Decimal, ROUND_HALF_UP

RATES = {
    "standard": Decimal("0.10"),
    "food": Decimal("0.05"),
    "exempt": Decimal("0"),
}


def tax_for(net_cents: int, category: str) -> int:
    """Tax on a line, rounded half-up (away from zero for negatives) to whole cents."""
    if category not in RATES:
        raise KeyError(f"unknown tax category {category!r}")
    return int((Decimal(net_cents) * RATES[category]).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
`,
      },
      {
        path: "billing/money.py",
        content: `"""Money is always an int number of cents inside the billing package."""
from decimal import Decimal, ROUND_HALF_UP


def to_cents(amount: str) -> int:
    """Parse a decimal string ("129.99", "-23.1") into integer cents, half-up."""
    d = Decimal(amount)
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def fmt(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    c = abs(cents)
    return f"{sign}\${c // 100}.{c % 100:02d}"
`,
      },
      {
        path: "billing/report.py",
        content: `from billing.money import fmt


def render_split(invoice, split: dict) -> str:
    out = [f"{invoice.id} total {fmt(invoice.total)}"]
    for name, cents in split.items():
        out.append(f"  {name} {fmt(cents)}")
    return "\\n".join(out)
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "predict",
        title: "Reproduce both complaints",
        prompt: "What does `main.py` print? (Hotel 3 × $129.99 at 10%, Dinner $87.45 at 5%, Taxi $23.10 exempt; tax rounds half-up per line.)",
        entry: "main.py",
        focusFile: "main.py",
        options: [
          `INV-1 total $543.89
  alice $271.95
  bob $135.97
  carol $135.97
CN-1 total -$91.82
  alice -$30.61
  bob -$30.61
  carol -$30.60`,
          `INV-1 total $543.89
  alice $271.94
  bob $135.98
  carol $135.97
LedgerImbalance: CN-1 split -9179 != total -9182`,
          `INV-1 total $543.89
  alice $271.94
  bob $135.98
  carol $135.97
LedgerImbalance: CN-1 split -9180 != total -9182`,
          `INV-1 total $543.88
  alice $271.94
  bob $135.97
  carol $135.97
LedgerImbalance: CN-1 split -9179 != total -9182`,
        ],
        answer: `INV-1 total $543.89
  alice $271.94
  bob $135.98
  carol $135.97
LedgerImbalance: CN-1 split -9179 != total -9182`,
        hints: [
          "Line totals: hotel 38997 + 3900 tax, dinner 8745 + 437 tax, taxi 2310. Total 54389 cents.",
          "Exact shares are 27194.5, 13597.25, 13597.25. One leftover cent. Which index comes first when sorting remainders ascending?",
          "For the refund: int(-3060.67) is -3060 (truncation toward zero), so leftover = -9182 - (-9180) = -2. What is `[0, 1, 2][:-2]`?",
        ],
        explanation: `**INV-1**: total 54389, weights 2:1:1. \`int()\` gives 27194, 13597, 13597 (sum 54388), so one cent is left over. Remainders are 0.5, 0.25, 0.25. The sort is **ascending**, so index 1 (Bob, 0.25) gets the cent instead of Alice (0.5).

**CN-1**: total -9182 split three ways. \`int(-3060.67)\` truncates **toward zero** to -3060, so the parts sum to -9180 and \`leftover\` is **-2**. \`by_remainder[:-2]\` doesn't mean "no items": it means "all but the last two", so one party gets **+1**, pushing the sum to -9179. The ledger's balance check rejects the posting.`,
        timeLimitSec: 600,
      },
      {
        id: "s2",
        kind: "find-bug",
        title: "Bob's extra cent",
        prompt: "Click the line responsible for Bob being charged Alice's leftover cent, then pick the root cause.",
        file: "billing/allocation.py",
        lines: [17],
        options: [
          "Remainders are sorted ascending, so leftover cents go to the SMALLEST remainders",
          "`int()` rounds 27194.5 down instead of up",
          "`split_invoice` passes the weights in a different order from the names",
          "Tax is rounded half-up instead of half-even",
        ],
        correct: 0,
        hints: ["The docstring says leftover cents go to the LARGEST remainder."],
        explanation: "Line 17 sorts by remainder ascending. It needs `reverse=True` or a key of `-remainder`, with the index as a tie-breaker so ties go to the earlier party. Python's sort is stable even with `reverse=True`, but an explicit `(-rem, i)` key states the intent.",
        timeLimitSec: 240,
        focusFile: "billing/allocation.py",
      },
      {
        id: "s3",
        kind: "code",
        task: "fix",
        title: "Make allocate() honour its contract",
        prompt: `There are **two bugs** in \`billing/allocation.py\`. Fix \`allocate\` so every guarantee in its docstring holds, including for **negative totals** (credit notes).

\`\`\`
Traceback (most recent call last):
  File "billing/service.py", line 14, in settle
    self.ledger.post_split(invoice, split)
  File "billing/ledger.py", line 17, in post_split
    raise LedgerImbalance(f"{invoice.id} split {owed} != total {invoice.total}")
billing.ledger.LedgerImbalance: CN-1 split -9179 != total -9182
\`\`\``,
        editable: ["billing/allocation.py"],
        tests: [
          {
            path: "tests/test_allocation.py",
            content: `from fractions import Fraction

from billing.allocation import allocate
from billing.invoice import Invoice
from billing.ledger import Ledger
from billing.service import SplitService
from billing.split import split_invoice


def test_extra_cent_goes_to_largest_remainder():
    assert allocate(100, [1, 2]) == [33, 67]
    assert allocate(54389, [2, 1, 1]) == [27195, 13597, 13597]
    assert allocate(10, [3, 3, 4]) == [3, 3, 4]
    assert allocate(7, [1, 1, 5]) == [1, 1, 5]
    assert allocate(5, [1, 3, 6]) == [1, 1, 3]


def test_ties_go_to_earlier_party():
    assert allocate(100, [1, 1, 1]) == [34, 33, 33]
    assert allocate(2, [1, 1, 1]) == [1, 1, 0]


def test_negative_totals_are_symmetric():
    assert allocate(-100, [1, 1, 1]) == [-34, -33, -33]
    assert allocate(-9182, [1, 1, 1]) == [-3061, -3061, -3060]
    assert allocate(-100, [1, 2]) == [-33, -67]


def test_properties_hold_for_many_inputs():
    weight_sets = [[1], [1, 1], [2, 1, 1], [3, 0, 7], [5, 5, 5, 5, 1], [1, 2, 3, 4, 5, 6], [97, 3]]
    for weights in weight_sets:
        wsum = sum(weights)
        for total in list(range(-250, 251)) + [999_999, -1_000_001]:
            parts = allocate(total, weights)
            assert sum(parts) == total, (total, weights, parts)
            for p, w in zip(parts, weights):
                assert abs(Fraction(p) - Fraction(total * w, wsum)) < 1, (total, weights, parts)
            assert allocate(-total, weights) == [-p for p in parts], (total, weights)


def test_zero_weight_gets_nothing():
    assert allocate(101, [1, 0, 1]) == [51, 0, 50]


def test_bad_weights_rejected():
    for bad in ([], [0, 0], [1, -1]):
        try:
            allocate(100, bad)
            assert False, f"expected ValueError for {bad}"
        except ValueError:
            pass


def test_credit_note_posts_balanced():
    ledger = Ledger()
    svc = SplitService(ledger)
    refund = Invoice("CN-1").add("Dinner refund", 8745, -1, "food")
    svc.settle(refund, {"alice": 1, "bob": 1, "carol": 1})
    assert ledger.balance("revenue") == 9182
    assert ledger.balance("receivable:alice") == -3061
    assert ledger.balance("receivable:carol") == -3060


def test_split_invoice_respects_share_order():
    inv = Invoice("INV-9").add("Room", 1001, 1, "exempt")
    assert split_invoice(inv, {"x": 1, "y": 1}) == {"x": 501, "y": 500}
    assert split_invoice(inv, {"y": 1, "x": 1}) == {"y": 501, "x": 500}
`,
          },
        ],
        solution: {
          "billing/allocation.py": `def allocate(total_cents: int, weights: list) -> list:
    """Split total_cents into integer parts proportional to weights (largest remainder method).

    Guarantees (finance relies on every one of these):
      * sum(result) == total_cents, always
      * each part is within 1 cent of its exact share total_cents * w / sum(weights)
      * leftover cents go to the parts with the LARGEST fractional remainder;
        ties go to the earlier party
      * sign symmetry: allocate(-t, w) == [-x for x in allocate(t, w)]
    """
    if not weights or any(w < 0 for w in weights) or sum(weights) == 0:
        raise ValueError("weights must be non-negative and not all zero")
    if total_cents < 0:
        return [-p for p in allocate(-total_cents, weights)]
    wsum = sum(weights)
    parts, rems = [], []
    for w in weights:
        q, r = divmod(total_cents * w, wsum)  # exact integer arithmetic, no floats
        parts.append(q)
        rems.append(r)
    leftover = total_cents - sum(parts)  # 0 <= leftover < len(weights)
    by_remainder = sorted(range(len(weights)), key=lambda i: (-rems[i], i))
    for i in by_remainder[:leftover]:
        parts[i] += 1
    return parts
`,
        },
        hints: [
          "Bug 1 is the sort direction. Bug 2 only appears when `total_cents < 0`.",
          "The docstring gives you the easiest fix for negatives: allocate the absolute value and negate the result.",
          "For the positive path, `divmod(total_cents * w, wsum)` gives an exact integer floor and remainder, with no float error.",
        ],
        explanation: `**Bug 1** (line 17): sort remainders descending, with ties going to the lower index: \`key=lambda i: (-rems[i], i)\`.

**Bug 2** (lines 15/18): \`int()\` truncates toward zero, so for negative totals the parts sum to *more* than the total and \`leftover\` is negative. A negative slice bound silently means "all but the last k". The cleanest fix uses the sign-symmetry guarantee: \`if total_cents < 0: return [-p for p in allocate(-total_cents, weights)]\`.

While you're there, replace float division with \`divmod(total_cents * w, wsum)\`. Integers keep the remainders exact, so ties really are ties, and the code stays correct for totals beyond 2^53 cents. In money code, a negative \`leftover\` should be impossible by construction, so assert it.`,
        timeLimitSec: 900,
        focusFile: "billing/allocation.py",
      },
      {
        id: "s4",
        kind: "mcq",
        title: "After the fix",
        prompt: "With a correct `allocate`, what does the refund block of `main.py` print for CN-1 (−$91.82 split 1:1:1)?",
        options: [
          "alice -$30.61, bob -$30.61, carol -$30.60",
          "alice -$30.60, bob -$30.61, carol -$30.61",
          "alice -$30.61, bob -$30.60, carol -$30.61",
          "alice -$30.60, bob -$30.60, carol -$30.62",
        ],
        correct: [0],
        hints: ["Sign symmetry: work out allocate(9182, [1, 1, 1]) and negate it."],
        explanation: "9182 = 3 × 3060 + 2. The two leftover cents go to the two earliest parties (all remainders tie), giving [3061, 3061, 3060]. Negating gives [-3061, -3061, -3060]. Refunds mirror the original charge exactly, which is what customers (and auditors) expect when an invoice is fully credited.",
        timeLimitSec: 240,
        focusFile: "billing/allocation.py",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "\"Just plug the difference\"",
        prompt: "Review the assistant's proposed replacement for `allocate` against the docstring.",
        persona: "confident-intern",
        request: "allocate() is buggy. Can you replace it with something simpler that always sums to the total?",
        aiReply: `Largest-remainder is overkill. Round each share and let the last participant absorb the rounding difference:

\`\`\`python
def allocate(total_cents, weights):
    wsum = sum(weights)
    parts = [round(total_cents * w / wsum) for w in weights]
    parts[-1] += total_cents - sum(parts)
    return parts
\`\`\`

Sum is exact by construction, negatives work because \`round\` is symmetric, and it's 4 lines. ✅`,
        options: [
          "Accept: the sum is exact and negatives are handled",
          "Reject: the last party absorbs the accumulated error, which can exceed 1 cent (100 split 6 ways gives the last person 15), and a zero-weight last party can be charged (101 over [1, 1, 0] gives [50, 50, 1])",
          "Reject: `round` returns a float in Python 3, so the parts are not integers",
          "Reject: it raises ZeroDivisionError for a single participant",
        ],
        correct: 1,
        hints: [
          "Try total 100 with six equal weights. What is round(16.67)?",
          "Python 3 `round(50.5)` is 50 (banker's rounding).",
        ],
        explanation: `The sum *is* exact, but that's only one of the four guarantees. With six equal shares each \`round(16.67)\` is 17, the sum is 102, and the last person pays **15**, 1.67 cents off their exact share. The error grows with the number of participants. With \`[1, 1, 0]\` and 101, banker's rounding gives 50, 50, 0 and the plug charges the **zero-weight** guest 1 cent. The leftover is also never given to the largest remainder.

\`round(x)\` with one argument does return an \`int\` in Python 3, so that option is a distractor. Rounding each share and plugging the difference is a classic AI suggestion that passes a "sum equals total" test and fails the fairness properties finance actually cares about.`,
        timeLimitSec: 420,
        focusFile: "billing/allocation.py",
      },
    ],
  },
  {
    id: "l4-a-ts-matching-engine",
    title: "Losing Your Place in the Queue",
    level: 4,
    rating: 2300,
    lang: "typescript",
    domain: "orderbook",
    companies: ["jane-street","citadel","hrt","optiver","jpmorgan"],
    tags: ["price-time-priority","fifo","order-book","two-bugs"],
    summary: "Market makers complain they lose queue priority after a partial fill, while upsized orders jump the queue.",
    context: `You've joined the exchange-simulation team. **minimatch** is the reference matching engine that the trading desks use to back-test strategies, so it has to follow the exchange rulebook exactly. The rules are in \`README.md\` section 4.

A market-making desk filed this:

> *"Our resting offers get partially filled and then we stop getting fills at that price until everyone behind us is done. Meanwhile a competitor keeps **increasing** their resting size and still trades ahead of us."*

Both are price-time priority violations.`,
    persona: "agent-mode",
    files: [
      {
        path: "README.md",
        content: `# minimatch: a single-instrument limit order book

## Matching rules (exchange rulebook, section 4)

1. **Price-time priority.** An incoming (taker) order trades against the best opposite price
   first. Within one price level, resting (maker) orders fill in the order they **arrived**.
2. **Trade price** is the resting order's price.
3. A resting order that is **partially filled keeps its place** in the queue.
4. **Amendments**
   * reducing quantity keeps time priority;
   * increasing quantity **loses** time priority (the order goes to the back of its level);
   * changing price loses time priority and may trade immediately (treated as cancel + new order,
     for the remaining quantity only).
   * reducing quantity to or below the already-filled quantity cancels the order.
5. Prices have a tick size of 0.01; quantities are positive integers.

## Layout

| file | role |
|------|------|
| \`src/engine/engine.ts\` | \`MatchingEngine\`: submit, cancel, amend |
| \`src/engine/matcher.ts\` | crosses a taker against the opposite side |
| \`src/engine/validation.ts\` | order validation |
| \`src/orderbook/book.ts\` | \`OrderBook\`: both sides + id index |
| \`src/orderbook/bookSide.ts\` | sorted price levels for one side |
| \`src/orderbook/priceLevel.ts\` | FIFO queue of orders at one price |
| \`src/feed/publisher.ts\` | market-data / execution report feed |
`,
        language: "markdown",
      },
      {
        path: "src/engine/engine.ts",
        content: `import { OrderBook } from '../orderbook/book';
import { Publisher } from '../feed/publisher';
import { Amendment, NewOrder, Order, Trade } from '../types';
import { match } from './matcher';
import { onTick, validateOrder } from './validation';

export class MatchingEngine {
  readonly book = new OrderBook();
  private seq = 0;
  private tradeSeq = 0;

  constructor(readonly feed: Publisher = new Publisher()) {}

  submit(n: NewOrder): Trade[] {
    validateOrder(n, (id) => this.book.has(id));
    const order: Order = { ...n, remaining: n.qty, seq: ++this.seq };
    return this.execute(order);
  }

  cancel(id: string): boolean {
    const o = this.book.cancel(id);
    if (o) this.feed.publish({ type: 'cancelled', id });
    return !!o;
  }

  /** See README section 4 for the priority rules. */
  amend(id: string, change: Amendment): Trade[] {
    const o = this.book.get(id);
    if (change.price !== undefined && change.price !== o.price) {
      if (!onTick(change.price) || change.price <= 0) throw new Error('bad price');
      this.book.cancel(id);
      const moved: Order = { ...o, price: change.price, seq: ++this.seq };
      if (change.qty !== undefined) {
        moved.remaining = change.qty - (o.qty - o.remaining);
        moved.qty = change.qty;
        if (moved.remaining <= 0) return [];
      }
      return this.execute(moved);
    }
    if (change.qty !== undefined && change.qty !== o.qty) {
      if (!Number.isInteger(change.qty) || change.qty <= 0) throw new Error('bad qty');
      const filled = o.qty - o.remaining;
      if (change.qty <= filled) {
        this.cancel(id);
        return [];
      }
      o.qty = change.qty;
      o.remaining = change.qty - filled;
      this.feed.publish({ type: 'amended', id, qty: o.qty, price: o.price });
    }
    return [];
  }

  private execute(order: Order): Trade[] {
    const trades = match(this.book, order, () => ++this.tradeSeq);
    for (const t of trades) this.feed.publish({ type: 'trade', trade: t });
    if (order.remaining > 0) {
      this.book.rest(order);
      this.feed.publish({ type: 'rested', id: order.id, price: order.price, remaining: order.remaining });
    }
    return trades;
  }
}
`,
      },
      {
        path: "src/engine/matcher.ts",
        content: `import { OrderBook } from '../orderbook/book';
import { Order, Trade } from '../types';

export function crosses(taker: Order, levelPrice: number): boolean {
  return taker.side === 'buy' ? taker.price >= levelPrice : taker.price <= levelPrice;
}

/** Match \`taker\` against the opposite side of the book. Mutates both taker and makers. */
export function match(book: OrderBook, taker: Order, nextTradeSeq: () => number): Trade[] {
  const opp = book.opposite(taker.side);
  const trades: Trade[] = [];
  while (taker.remaining > 0) {
    const level = opp.best();
    if (!level || !crosses(taker, level.price)) break;
    const maker = level.peek()!;
    const qty = Math.min(taker.remaining, maker.remaining);
    trades.push({
      seq: nextTradeSeq(),
      buyId: taker.side === 'buy' ? taker.id : maker.id,
      sellId: taker.side === 'sell' ? taker.id : maker.id,
      price: level.price,
      qty,
      takerSide: taker.side,
    });
    taker.remaining -= qty;
    maker.remaining -= qty;
    level.dequeue();
    if (maker.remaining > 0) {
      level.enqueue(maker);
    } else {
      book.forget(maker.id);
    }
    if (level.isEmpty) opp.removeLevel(level);
  }
  return trades;
}
`,
      },
      {
        path: "src/engine/validation.ts",
        content: `import { NewOrder } from '../types';

const TICK = 0.01;

export function onTick(price: number): boolean {
  return Math.abs(Math.round(price / TICK) * TICK - price) < 1e-9;
}

export function validateOrder(o: NewOrder, exists: (id: string) => boolean): void {
  if (!o.id) throw new Error('id required');
  if (exists(o.id)) throw new Error(\`duplicate order id \${o.id}\`);
  if (o.side !== 'buy' && o.side !== 'sell') throw new Error('side must be buy or sell');
  if (!Number.isInteger(o.qty) || o.qty <= 0) throw new Error('qty must be a positive integer');
  if (!(o.price > 0) || !onTick(o.price)) throw new Error('price must be positive and on tick');
}
`,
      },
      {
        path: "src/orderbook/book.ts",
        content: `import { Order, Side } from '../types';
import { BookSide } from './bookSide';
import { PriceLevel } from './priceLevel';

export class OrderBook {
  readonly bids = new BookSide('buy');
  readonly asks = new BookSide('sell');
  private index = new Map<string, Order>();

  sideOf(side: Side): BookSide {
    return side === 'buy' ? this.bids : this.asks;
  }

  opposite(side: Side): BookSide {
    return side === 'buy' ? this.asks : this.bids;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  get(id: string): Order {
    const o = this.index.get(id);
    if (!o) throw new Error(\`unknown order \${id}\`);
    return o;
  }

  levelOf(o: Order): PriceLevel {
    const level = this.sideOf(o.side).find(o.price);
    if (!level) throw new Error(\`no level for \${o.id}\`);
    return level;
  }

  /** Put an order at the BACK of its price level. */
  rest(o: Order): void {
    this.sideOf(o.side).levelFor(o.price).enqueue(o);
    this.index.set(o.id, o);
  }

  /** Forget a fully filled order (it has already been dequeued by the matcher). */
  forget(id: string): void {
    this.index.delete(id);
  }

  cancel(id: string): Order | undefined {
    const o = this.index.get(id);
    if (!o) return undefined;
    const side = this.sideOf(o.side);
    const level = this.levelOf(o);
    level.remove(id);
    if (level.isEmpty) side.removeLevel(level);
    this.index.delete(id);
    return o;
  }

  /** Resting orders at a price, front of queue first. */
  queueAt(side: Side, price: number): string[] {
    return this.sideOf(side).find(price)?.orders.map((o) => o.id) ?? [];
  }
}
`,
      },
      {
        path: "src/orderbook/bookSide.ts",
        content: `import { Side } from '../types';
import { PriceLevel } from './priceLevel';

/** Price levels for one side, kept sorted best-first (bids: high→low, asks: low→high). */
export class BookSide {
  private levels: PriceLevel[] = [];

  constructor(readonly side: Side) {}

  /** true if price a is strictly better than price b for this side */
  private better(a: number, b: number): boolean {
    return this.side === 'buy' ? a > b : a < b;
  }

  best(): PriceLevel | undefined {
    return this.levels[0];
  }

  find(price: number): PriceLevel | undefined {
    return this.levels.find((l) => l.price === price);
  }

  /** Get or create the level for \`price\`, keeping best-first order (binary search). */
  levelFor(price: number): PriceLevel {
    let lo = 0;
    let hi = this.levels.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const p = this.levels[mid].price;
      if (p === price) return this.levels[mid];
      if (this.better(p, price)) lo = mid + 1;
      else hi = mid;
    }
    const level = new PriceLevel(price);
    this.levels.splice(lo, 0, level);
    return level;
  }

  removeLevel(level: PriceLevel): void {
    const i = this.levels.indexOf(level);
    if (i !== -1) this.levels.splice(i, 1);
  }

  depth(n: number): { price: number; qty: number; orders: number }[] {
    return this.levels.slice(0, n).map((l) => ({ price: l.price, qty: l.totalQty, orders: l.orders.length }));
  }
}
`,
      },
      {
        path: "src/orderbook/priceLevel.ts",
        content: `import { Order } from '../types';

/** FIFO queue of resting orders at a single price. Front = highest time priority. */
export class PriceLevel {
  readonly orders: Order[] = [];

  constructor(readonly price: number) {}

  enqueue(o: Order): void {
    this.orders.push(o);
  }

  peek(): Order | undefined {
    return this.orders[0];
  }

  dequeue(): Order | undefined {
    return this.orders.shift();
  }

  remove(id: string): Order | undefined {
    const i = this.orders.findIndex((o) => o.id === id);
    if (i === -1) return undefined;
    return this.orders.splice(i, 1)[0];
  }

  get totalQty(): number {
    return this.orders.reduce((s, o) => s + o.remaining, 0);
  }

  get isEmpty(): boolean {
    return this.orders.length === 0;
  }
}
`,
      },
      {
        path: "src/feed/publisher.ts",
        content: `import { Trade } from '../types';

export type FeedEvent =
  | { type: 'trade'; trade: Trade }
  | { type: 'rested'; id: string; price: number; remaining: number }
  | { type: 'cancelled'; id: string }
  | { type: 'amended'; id: string; qty: number; price: number };

/** Collects execution reports. Production fans these out over multicast. */
export class Publisher {
  readonly events: FeedEvent[] = [];

  publish(e: FeedEvent): void {
    this.events.push(e);
  }

  trades(): Trade[] {
    return this.events.filter((e): e is { type: 'trade'; trade: Trade } => e.type === 'trade').map((e) => e.trade);
  }
}

export function fmtTrade(t: Trade): string {
  return \`T\${t.seq} \${t.buyId}<-\${t.sellId} \${t.qty}@\${t.price.toFixed(2)}\`;
}
`,
      },
      {
        path: "src/types.ts",
        content: `export type Side = 'buy' | 'sell';

export interface NewOrder {
  id: string;
  trader: string;
  side: Side;
  price: number;
  qty: number;
}

export interface Order extends NewOrder {
  remaining: number;
  /** Time priority: lower seq = earlier. Assigned by the engine. */
  seq: number;
}

export interface Trade {
  seq: number;
  buyId: string;
  sellId: string;
  price: number;
  qty: number;
  takerSide: Side;
}

export interface Amendment {
  price?: number;
  qty?: number;
}
`,
      },
      {
        path: "src/main.ts",
        content: `import { MatchingEngine } from './engine/engine';
import { fmtTrade } from './feed/publisher';

const eng = new MatchingEngine();
eng.submit({ id: 'S1', trader: 'alice', side: 'sell', price: 100.5, qty: 10 });
eng.submit({ id: 'S2', trader: 'bob', side: 'sell', price: 100.5, qty: 10 });
eng.submit({ id: 'S3', trader: 'carol', side: 'sell', price: 100.25, qty: 3 });

eng.submit({ id: 'B1', trader: 'dave', side: 'buy', price: 100.5, qty: 7 });
eng.submit({ id: 'B2', trader: 'erin', side: 'buy', price: 101, qty: 12 });

for (const t of eng.feed.trades()) console.log(fmtTrade(t));
console.log('queue@100.50', eng.book.queueAt('sell', 100.5).join(','));
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "trace",
        title: "Trace a marketable buy",
        prompt: "A buy order arrives that crosses the best ask, partially fills, and has quantity left over. Order the steps executed.",
        items: [
          "MatchingEngine.submit",
          "validateOrder",
          "MatchingEngine.execute",
          "match(): opp.best() returns the best ask level",
          "crosses(taker, level.price)",
          "Trade recorded at the resting level price",
          "book.rest(order) enqueues the remainder at the back of its level",
          "feed.publish 'rested'",
        ],
        hints: [
          "`execute` publishes trades before it rests the remainder.",
          "Trades are pushed inside `match`, and the feed sees them afterwards.",
        ],
        explanation: "`submit` validates, assigns `seq`, and delegates to `execute`. `match` walks the opposite side best-first (`BookSide` keeps levels sorted with a binary-search insert), checks `crosses`, and prices each trade at the **maker's** level price (rule 2). Any remainder rests at the back of its own level, then the feed publishes `rested`.",
        timeLimitSec: 360,
        focusFile: "src/engine/engine.ts",
      },
      {
        id: "s2",
        kind: "predict",
        title: "Reproduce the desk complaint",
        prompt: "Predict the output of `src/main.ts`.",
        entry: "src/main.ts",
        focusFile: "src/main.ts",
        options: [
          `T1 B1<-S3 3@100.25
T2 B1<-S1 4@100.50
T3 B2<-S1 6@100.50
T4 B2<-S2 6@100.50
queue@100.50 S2`,
          `T1 B1<-S3 3@100.25
T2 B1<-S1 4@100.50
T3 B2<-S2 10@100.50
T4 B2<-S1 2@100.50
queue@100.50 S1`,
          `T1 B1<-S1 7@100.50
T2 B2<-S3 3@100.25
T3 B2<-S1 3@100.50
T4 B2<-S2 6@100.50
queue@100.50 S2`,
          `T1 B1<-S3 3@100.25
T2 B1<-S1 4@100.50
T3 B2<-S2 10@101.00
T4 B2<-S1 2@101.00
queue@100.50 S1`,
        ],
        answer: `T1 B1<-S3 3@100.25
T2 B1<-S1 4@100.50
T3 B2<-S2 10@100.50
T4 B2<-S1 2@100.50
queue@100.50 S1`,
        hints: [
          "S3 (100.25) is the best ask even though it arrived last.",
          "After T2, S1 has 6 left. Follow `level.dequeue()` and the branch after it.",
        ],
        explanation: "B1 first takes the best price (S3 at 100.25, 3 lots), then 4 lots from S1 at 100.50. S1 has 6 left, but the matcher **dequeues it and enqueues it again at the back**, behind S2. B2 then fills S2 completely (10) before returning to S1 (2). Trades print at the maker's price, so 101.00 never appears. Under the rulebook, T3 should be `B2<-S1 6` and T4 `B2<-S2 6`.",
        timeLimitSec: 420,
      },
      {
        id: "s3",
        kind: "find-bug",
        title: "Where is priority lost?",
        prompt: "Click the line where a partially filled maker loses its time priority.",
        file: "src/engine/matcher.ts",
        lines: [29,27],
        options: [
          "The maker is removed and re-appended to the back of the level after a partial fill",
          "Trades are priced at the level price instead of the taker price",
          "`crosses` uses >= instead of >",
          "Empty levels are removed before the maker is forgotten",
        ],
        correct: 0,
        hints: ["After a partial fill, which order is at the front of the level?"],
        explanation: "Lines 27-29: `dequeue()` followed by `enqueue(maker)` rotates the queue. A partially filled maker should stay at the front. Only a **fully** filled maker should be dequeued (and forgotten). Note that if the maker still has quantity left, the taker must be exhausted (`qty = min(...)`), so the loop ends anyway and nothing is lost by leaving the maker in place.",
        timeLimitSec: 240,
        focusFile: "src/engine/matcher.ts",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Restore price-time priority",
        prompt: `There are **two bugs**, one per desk complaint. Make the engine follow README section 4:

* a partially filled resting order keeps its place;
* \`amend\` that **increases** quantity sends the order to the back of its level (and gives it a new \`seq\`), while a decrease keeps its place.

You may edit \`src/engine/matcher.ts\` and \`src/engine/engine.ts\`.`,
        editable: ["src/engine/matcher.ts","src/engine/engine.ts"],
        tests: [
          {
            path: "tests/engine.test.ts",
            content: `import { MatchingEngine } from '../src/engine/engine';
import { fmtTrade } from '../src/feed/publisher';

const sell = (id: string, price: number, qty: number) => ({ id, trader: id.toLowerCase(), side: 'sell' as const, price, qty });
const buy = (id: string, price: number, qty: number) => ({ id, trader: id.toLowerCase(), side: 'buy' as const, price, qty });
const fills = (e: MatchingEngine) => e.feed.trades().map(fmtTrade);

test('partially filled maker keeps its place in the queue', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 100.5, 10));
  e.submit(sell('S2', 100.5, 10));
  e.submit(sell('S3', 100.25, 3));
  e.submit(buy('B1', 100.5, 7));
  e.submit(buy('B2', 101, 12));
  expect(fills(e)).toEqual([
    'T1 B1<-S3 3@100.25',
    'T2 B1<-S1 4@100.50',
    'T3 B2<-S1 6@100.50',
    'T4 B2<-S2 6@100.50',
  ]);
  expect(e.book.queueAt('sell', 100.5)).toEqual(['S2']);
});

test('several small takers drain the first maker before the second (bid side)', () => {
  const e = new MatchingEngine();
  e.submit(buy('B1', 50, 5));
  e.submit(buy('B2', 50, 5));
  for (let i = 0; i < 4; i++) e.submit(sell('X' + i, 49.99, 2));
  expect(fills(e)).toEqual(['T1 B1<-X0 2@50.00', 'T2 B1<-X1 2@50.00', 'T3 B1<-X2 1@50.00', 'T4 B2<-X2 1@50.00', 'T5 B2<-X3 2@50.00']);
  expect(e.book.queueAt('buy', 50)).toEqual(['B2']);
});

test('better price beats earlier time', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 10.02, 5));
  e.submit(sell('S2', 10.01, 5));
  e.submit(buy('B', 10.05, 6));
  expect(fills(e)).toEqual(['T1 B<-S2 5@10.01', 'T2 B<-S1 1@10.02']);
});

test('reducing quantity keeps priority', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 20, 10));
  e.submit(sell('S2', 20, 10));
  e.amend('S1', { qty: 4 });
  expect(e.book.queueAt('sell', 20)).toEqual(['S1', 'S2']);
  e.submit(buy('B', 20, 6));
  expect(fills(e)).toEqual(['T1 B<-S1 4@20.00', 'T2 B<-S2 2@20.00']);
});

test('increasing quantity loses priority', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 20, 10));
  e.submit(sell('S2', 20, 10));
  e.submit(sell('S3', 20, 10));
  e.amend('S1', { qty: 15 });
  expect(e.book.queueAt('sell', 20)).toEqual(['S2', 'S3', 'S1']);
  e.submit(buy('B', 20, 12));
  expect(fills(e)).toEqual(['T1 B<-S2 10@20.00', 'T2 B<-S3 2@20.00']);
});

test('upsizing a partially filled order counts filled quantity and goes to the back', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 20, 10));
  e.submit(sell('S2', 20, 10));
  e.submit(buy('B1', 20, 4));
  e.amend('S1', { qty: 12 });
  expect(e.book.get('S1').remaining).toBe(8);
  expect(e.book.queueAt('sell', 20)).toEqual(['S2', 'S1']);
});

test('amending down to the filled quantity cancels', () => {
  const e = new MatchingEngine();
  e.submit(sell('S1', 20, 10));
  e.submit(buy('B1', 20, 4));
  expect(e.amend('S1', { qty: 4 })).toEqual([]);
  expect(e.book.has('S1')).toBe(false);
});

test('price change loses priority and can trade immediately', () => {
  const e = new MatchingEngine();
  e.submit(buy('B1', 99, 5));
  e.submit(buy('B2', 99, 5));
  e.submit(sell('S1', 100, 3));
  const t = e.amend('S1', { price: 99 });
  expect(t.map(fmtTrade)).toEqual(['T1 B1<-S1 3@99.00']);
  e.amend('B1', { price: 98 });
  e.amend('B1', { price: 99 });
  expect(e.book.queueAt('buy', 99)).toEqual(['B2', 'B1']);
});
`,
          },
        ],
        solution: {
          "src/engine/matcher.ts": `import { OrderBook } from '../orderbook/book';
import { Order, Trade } from '../types';

export function crosses(taker: Order, levelPrice: number): boolean {
  return taker.side === 'buy' ? taker.price >= levelPrice : taker.price <= levelPrice;
}

/** Match \`taker\` against the opposite side of the book. Mutates both taker and makers. */
export function match(book: OrderBook, taker: Order, nextTradeSeq: () => number): Trade[] {
  const opp = book.opposite(taker.side);
  const trades: Trade[] = [];
  while (taker.remaining > 0) {
    const level = opp.best();
    if (!level || !crosses(taker, level.price)) break;
    const maker = level.peek()!;
    const qty = Math.min(taker.remaining, maker.remaining);
    trades.push({
      seq: nextTradeSeq(),
      buyId: taker.side === 'buy' ? taker.id : maker.id,
      sellId: taker.side === 'sell' ? taker.id : maker.id,
      price: level.price,
      qty,
      takerSide: taker.side,
    });
    taker.remaining -= qty;
    maker.remaining -= qty;
    if (maker.remaining === 0) {
      // fully filled: leave the queue. A partially filled maker stays at the FRONT.
      level.dequeue();
      book.forget(maker.id);
    }
    if (level.isEmpty) opp.removeLevel(level);
  }
  return trades;
}
`,
          "src/engine/engine.ts": `import { OrderBook } from '../orderbook/book';
import { Publisher } from '../feed/publisher';
import { Amendment, NewOrder, Order, Trade } from '../types';
import { match } from './matcher';
import { onTick, validateOrder } from './validation';

export class MatchingEngine {
  readonly book = new OrderBook();
  private seq = 0;
  private tradeSeq = 0;

  constructor(readonly feed: Publisher = new Publisher()) {}

  submit(n: NewOrder): Trade[] {
    validateOrder(n, (id) => this.book.has(id));
    const order: Order = { ...n, remaining: n.qty, seq: ++this.seq };
    return this.execute(order);
  }

  cancel(id: string): boolean {
    const o = this.book.cancel(id);
    if (o) this.feed.publish({ type: 'cancelled', id });
    return !!o;
  }

  /** See README section 4 for the priority rules. */
  amend(id: string, change: Amendment): Trade[] {
    const o = this.book.get(id);
    if (change.price !== undefined && change.price !== o.price) {
      if (!onTick(change.price) || change.price <= 0) throw new Error('bad price');
      this.book.cancel(id);
      const moved: Order = { ...o, price: change.price, seq: ++this.seq };
      if (change.qty !== undefined) {
        moved.remaining = change.qty - (o.qty - o.remaining);
        moved.qty = change.qty;
        if (moved.remaining <= 0) return [];
      }
      return this.execute(moved);
    }
    if (change.qty !== undefined && change.qty !== o.qty) {
      if (!Number.isInteger(change.qty) || change.qty <= 0) throw new Error('bad qty');
      const filled = o.qty - o.remaining;
      if (change.qty <= filled) {
        this.cancel(id);
        return [];
      }
      if (change.qty > o.qty) {
        // Increasing size loses time priority: move to the back of the level.
        const level = this.book.levelOf(o);
        level.remove(id);
        o.seq = ++this.seq;
        level.enqueue(o);
      }
      o.qty = change.qty;
      o.remaining = change.qty - filled;
      this.feed.publish({ type: 'amended', id, qty: o.qty, price: o.price });
    }
    return [];
  }

  private execute(order: Order): Trade[] {
    const trades = match(this.book, order, () => ++this.tradeSeq);
    for (const t of trades) this.feed.publish({ type: 'trade', trade: t });
    if (order.remaining > 0) {
      this.book.rest(order);
      this.feed.publish({ type: 'rested', id: order.id, price: order.price, remaining: order.remaining });
    }
    return trades;
  }
}
`,
        },
        hints: [
          "Matcher: only `dequeue()` when `maker.remaining === 0`.",
          "Engine: in the quantity branch of `amend`, compare `change.qty` with `o.qty`. `PriceLevel.remove` + `enqueue` moves an order to the back.",
          "Keep `remaining = change.qty - filled` in both cases. Filled quantity is history and cannot be re-opened.",
        ],
        explanation: `**Matcher**: dequeue (and \`forget\`) only fully filled makers. A partial fill leaves the maker at the head of the queue.

**Engine**: an upsize is economically a new order for the extra quantity, so it must not keep the queue position earned by the smaller order. Otherwise anyone could rest 1 lot early and then "upsize" to jump the queue. Remove the order from its level, assign \`o.seq = ++this.seq\` and \`enqueue\` it at the back. Downsizes keep their place because they only *reduce* what the queue owes them.

Interviewers like this one because both bugs pass a naive "all quantity eventually trades" test: totals are right, only **who** trades **when** is wrong. Your tests have to assert the order of fills.`,
        timeLimitSec: 1200,
        focusFile: "src/engine/engine.ts",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Agent-mode refactor of amend",
        prompt: "The assistant (agent mode) proposes simplifying `amend`. Review the diff.",
        persona: "agent-mode",
        request: "amend() is getting complicated. Simplify it using the existing cancel/submit paths.",
        aiReply: `I've refactored \`amend\` to reuse the battle-tested paths, so priority is handled automatically by \`submit\`:

\`\`\`ts
amend(id: string, change: Amendment): Trade[] {
  const o = this.book.get(id);
  this.cancel(id);
  return this.submit({
    id: o.id,
    trader: o.trader,
    side: o.side,
    price: change.price ?? o.price,
    qty: change.qty ?? o.qty,
  });
}
\`\`\`

Also deleted 25 lines of special cases. All existing tests pass ✅`,
        options: [
          "Accept: cancel + submit is how most exchanges implement amend",
          "Reject: every amend loses priority (even decreases), and the new order is submitted for the full `qty`, so already-filled quantity is re-opened and can trade again",
          "Reject: `submit` will throw because the id still exists in the book",
          "Reject: it only breaks price changes, which can now trade immediately",
        ],
        correct: 1,
        hints: [
          "What `remaining` does the re-submitted order get if 4 of 10 lots were already filled?",
          "Rule 4: does reducing quantity keep priority?",
        ],
        explanation: "`submit` sets `remaining = qty`. If S1 (10 lots) has already filled 4 and someone amends the price, the new order offers **10** lots again, so the trader can be filled for 14 in total. That is a real financial loss, not a style issue. It also violates rule 4: a downsize now goes to the back of the queue. `cancel` *does* delete the id first, so `submit` does not throw. And trading immediately on a price change is correct behaviour. \"All existing tests pass\" only shows the tests never covered amend after a partial fill.",
        timeLimitSec: 420,
        focusFile: "src/engine/engine.ts",
      },
    ],
  },
];

export default problems;
