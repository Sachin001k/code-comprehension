import type { Problem } from '../types';

const problems: Problem[] = [
  // ───────────────────────────── 1. Booking cancellation (TS, feature) ─────────────────────────────
  {
    id: 'l4-a-ts-booking-cancellation',
    title: 'Booking Service: Cancellation & Refunds',
    level: 4,
    rating: 1950,
    lang: 'typescript',
    domain: 'booking',
    companies: ['atlassian', 'uber', 'amazon', 'canva'],
    tags: ['feature', 'existing-patterns', 'boundaries', 'optimistic-locking', 'money'],
    summary: 'Ship POST /bookings/:id/cancel with tiered refunds, following the patterns the team already uses for change fees.',
    context: `You joined the **stays** team last week. Product has signed off ticket **PROJ-412**: guests can cancel a booking and get a refund that depends on how close to check-in they cancel. The full rules are in \`docs/CANCELLATION_SPEC.md\`.

The team already ships *date changes* with tiered **change fees** (\`src/policy/rules.ts\`). Your tech lead's only review comment on the ticket: *"Cancellation should look like it was written by the same person who wrote modifyDates."*`,
    persona: 'confident-intern',
    files: [
      {
        path: 'docs/CANCELLATION_SPEC.md',
        language: 'markdown',
        content: `# PROJ-412: Guest cancellation

Endpoint: \`POST /bookings/:id/cancel\` (no body).

Check-in time is **15:00 UTC** on the \`checkIn\` date. "Hours before check-in" is
measured from the server clock to that instant.

## Refund tiers (same boundary convention as change fees: a tier applies when
## hoursBefore >= its threshold)

| hours before check-in | refund of the ROOM CHARGE |
|-----------------------|---------------------------|
| >= 168 (7 days)       | 100%                      |
| >= 48                 | 50%                       |
| > 0                   | 0%                        |

- Only the room charge is refundable. The service fee and any change fees are **never** refunded.
- Percentages are applied in integer cents and rounded **down** (guest never gets a fraction of a cent more than owed).
- Cancelling at or after check-in time is rejected: 409 INVALID_STATE.
- Cancelling a booking that is not \`confirmed\` is rejected: 409 INVALID_STATE.
- Unknown id: 404.

## Effects of a successful cancellation
1. Booking \`status\` becomes \`cancelled\`, \`refundedCents\` records the refund. The room is free again.
2. A ledger \`refund\` entry is written for the refund amount (skip the entry when the refund is 0).
3. Event \`{ type: 'booking.cancelled', bookingId, refundCents }\` is published.
4. Response: \`200 { booking, refundCents }\`.
`,
      },
      {
        path: 'src/errors.ts',
        content: `export type ErrorCode = 'NOT_FOUND' | 'VALIDATION' | 'INVALID_STATE';

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  INVALID_STATE: 409,
};
`,
      },
      {
        path: 'src/domain/booking.ts',
        content: `export type BookingStatus = 'confirmed' | 'cancelled';

export interface Booking {
  id: string;
  guestId: string;
  roomId: string;
  /** YYYY-MM-DD. Guests check in at CHECK_IN_HOUR_UTC on this date. */
  checkIn: string;
  nights: number;
  roomChargeCents: number;
  serviceFeeCents: number;
  changeFeesCents: number;
  refundedCents: number;
  status: BookingStatus;
  /** Optimistic-locking version. Every save must increment it by exactly 1. */
  version: number;
}

export const CHECK_IN_HOUR_UTC = 15;
const DAY_MS = 86_400_000;

export function checkInInstant(b: Pick<Booking, 'checkIn'>): number {
  const [y, m, d] = b.checkIn.split('-').map(Number);
  return Date.UTC(y, m - 1, d, CHECK_IN_HOUR_UTC);
}

export function checkOutInstant(b: Pick<Booking, 'checkIn' | 'nights'>): number {
  // check-out is 11:00 on the last day, i.e. 20h after a check-in instant
  return checkInInstant(b) + (b.nights - 1) * DAY_MS + 20 * 3_600_000;
}

export function paidCents(b: Booking): number {
  return b.roomChargeCents + b.serviceFeeCents + b.changeFeesCents;
}
`,
      },
      {
        path: 'src/domain/clock.ts',
        content: `export interface Clock {
  now(): number;
}

export class FixedClock implements Clock {
  constructor(private ms: number) {}
  now(): number {
    return this.ms;
  }
  set(iso: string): void {
    this.ms = Date.parse(iso);
  }
}
`,
      },
      {
        path: 'src/policy/pricing.ts',
        content: `import { DomainError } from '../errors';

export const SERVICE_FEE_CENTS = 500;
const WEEKLY_DISCOUNT = 0.9;

export function quoteRoomCharge(nights: number, nightlyRateCents: number): number {
  if (!Number.isInteger(nights) || nights < 1) {
    throw new DomainError('VALIDATION', 'nights must be a positive integer');
  }
  if (!Number.isInteger(nightlyRateCents) || nightlyRateCents <= 0) {
    throw new DomainError('VALIDATION', 'nightlyRateCents must be a positive integer');
  }
  const gross = nights * nightlyRateCents;
  return nights >= 7 ? Math.round(gross * WEEKLY_DISCOUNT) : gross;
}
`,
      },
      {
        path: 'src/policy/rules.ts',
        content: `import { Booking, checkInInstant } from '../domain/booking';
import { DomainError } from '../errors';

const HOUR_MS = 3_600_000;

/** Hours from nowMs until check-in. Zero or negative once the stay has started. */
export function hoursUntilCheckIn(b: Booking, nowMs: number): number {
  return (checkInInstant(b) - nowMs) / HOUR_MS;
}

export function assertConfirmed(b: Booking): void {
  if (b.status !== 'confirmed') {
    throw new DomainError('INVALID_STATE', 'booking ' + b.id + ' is ' + b.status);
  }
}

export function assertNotStarted(b: Booking, nowMs: number): number {
  const h = hoursUntilCheckIn(b, nowMs);
  if (h <= 0) throw new DomainError('INVALID_STATE', 'stay has already started');
  return h;
}

export interface ChangeFeeTier {
  minHoursBefore: number;
  feeCents: number;
}

/** Most generous first. The first tier with hoursBefore >= minHoursBefore wins. */
export const CHANGE_FEE_TIERS: ChangeFeeTier[] = [
  { minHoursBefore: 168, feeCents: 0 },
  { minHoursBefore: 48, feeCents: 2500 },
  { minHoursBefore: 0, feeCents: 5000 },
];

export function changeFeeCents(b: Booking, nowMs: number): number {
  const h = assertNotStarted(b, nowMs);
  const tier = CHANGE_FEE_TIERS.find((t) => h >= t.minHoursBefore);
  return tier ? tier.feeCents : CHANGE_FEE_TIERS[CHANGE_FEE_TIERS.length - 1].feeCents;
}
`,
      },
      {
        path: 'src/payments/ledger.ts',
        content: `export type EntryKind = 'charge' | 'refund';

export interface LedgerEntry {
  seq: number;
  bookingId: string;
  kind: EntryKind;
  cents: number;
  memo: string;
}

export class Ledger {
  private entries: LedgerEntry[] = [];
  private seq = 0;

  charge(bookingId: string, cents: number, memo: string): LedgerEntry {
    return this.append(bookingId, 'charge', cents, memo);
  }

  refund(bookingId: string, cents: number, memo: string): LedgerEntry {
    if (cents > this.netFor(bookingId)) throw new Error('refund exceeds net charges');
    return this.append(bookingId, 'refund', cents, memo);
  }

  netFor(bookingId: string): number {
    let net = 0;
    for (const e of this.entries) {
      if (e.bookingId !== bookingId) continue;
      net += e.kind === 'charge' ? e.cents : -e.cents;
    }
    return net;
  }

  forBooking(bookingId: string): LedgerEntry[] {
    return this.entries.filter((e) => e.bookingId === bookingId).map((e) => ({ ...e }));
  }

  private append(bookingId: string, kind: EntryKind, cents: number, memo: string): LedgerEntry {
    if (!Number.isInteger(cents) || cents <= 0) throw new Error('invalid amount: ' + cents);
    const e = { seq: ++this.seq, bookingId, kind, cents, memo };
    this.entries.push(e);
    return { ...e };
  }
}
`,
      },
      {
        path: 'src/repo/bookingRepo.ts',
        content: `import { Booking, checkInInstant, checkOutInstant } from '../domain/booking';
import { DomainError } from '../errors';

export class BookingRepo {
  private rows = new Map<string, Booking>();
  private n = 0;

  nextId(): string {
    this.n += 1;
    return 'bk_' + String(this.n).padStart(4, '0');
  }

  /** Returns a copy. Mutating it does nothing until you save(). */
  get(id: string): Booking {
    const b = this.rows.get(id);
    if (!b) throw new DomainError('NOT_FOUND', 'booking ' + id + ' not found');
    return { ...b };
  }

  insert(b: Booking): void {
    if (this.rows.has(b.id)) throw new Error('duplicate id ' + b.id);
    this.rows.set(b.id, { ...b });
  }

  /** Optimistic locking: the saved row must carry version = stored version + 1. */
  save(b: Booking): void {
    const cur = this.rows.get(b.id);
    if (!cur) throw new DomainError('NOT_FOUND', 'booking ' + b.id + ' not found');
    if (b.version !== cur.version + 1) {
      throw new DomainError('INVALID_STATE', 'concurrent modification of ' + b.id);
    }
    this.rows.set(b.id, { ...b });
  }

  /** Confirmed bookings of roomId whose stay overlaps [start, end). */
  findOverlapping(roomId: string, start: number, end: number, excludeId?: string): Booking[] {
    const out: Booking[] = [];
    for (const b of this.rows.values()) {
      if (b.roomId !== roomId || b.status !== 'confirmed' || b.id === excludeId) continue;
      if (checkInInstant(b) < end && start < checkOutInstant(b)) out.push({ ...b });
    }
    return out;
  }
}
`,
      },
      {
        path: 'src/events/bus.ts',
        content: `export type DomainEvent =
  | { type: 'booking.created'; bookingId: string; paidCents: number }
  | { type: 'booking.modified'; bookingId: string; feeCents: number }
  | { type: 'booking.cancelled'; bookingId: string; refundCents: number };

type Listener = (e: DomainEvent) => void;

export class EventBus {
  readonly published: DomainEvent[] = [];
  private listeners: Listener[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  publish(e: DomainEvent): void {
    this.published.push(e);
    for (const l of this.listeners) l(e);
  }
}
`,
      },
      {
        path: 'src/service/bookingService.ts',
        content: `import { Booking, checkInInstant, checkOutInstant, paidCents } from '../domain/booking';
import { Clock } from '../domain/clock';
import { DomainError } from '../errors';
import { EventBus } from '../events/bus';
import { Ledger } from '../payments/ledger';
import { quoteRoomCharge, SERVICE_FEE_CENTS } from '../policy/pricing';
import { assertConfirmed, changeFeeCents } from '../policy/rules';
import { BookingRepo } from '../repo/bookingRepo';

export interface CreateInput {
  guestId: string;
  roomId: string;
  checkIn: string;
  nights: number;
  nightlyRateCents: number;
}

const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;

export class BookingService {
  constructor(
    private repo: BookingRepo,
    private ledger: Ledger,
    private bus: EventBus,
    private clock: Clock,
  ) {}

  get(id: string): Booking {
    return this.repo.get(id);
  }

  create(input: CreateInput): Booking {
    if (!input || !input.guestId || !input.roomId) throw new DomainError('VALIDATION', 'guestId and roomId required');
    if (!DATE_RE.test(input.checkIn)) throw new DomainError('VALIDATION', 'checkIn must be YYYY-MM-DD');
    const roomChargeCents = quoteRoomCharge(input.nights, input.nightlyRateCents);
    const b: Booking = {
      id: this.repo.nextId(),
      guestId: input.guestId,
      roomId: input.roomId,
      checkIn: input.checkIn,
      nights: input.nights,
      roomChargeCents,
      serviceFeeCents: SERVICE_FEE_CENTS,
      changeFeesCents: 0,
      refundedCents: 0,
      status: 'confirmed',
      version: 1,
    };
    if (this.repo.findOverlapping(b.roomId, checkInInstant(b), checkOutInstant(b)).length) {
      throw new DomainError('INVALID_STATE', 'room ' + b.roomId + ' is not available');
    }
    this.repo.insert(b);
    this.ledger.charge(b.id, roomChargeCents, 'room');
    this.ledger.charge(b.id, SERVICE_FEE_CENTS, 'service fee');
    this.bus.publish({ type: 'booking.created', bookingId: b.id, paidCents: paidCents(b) });
    return b;
  }

  modifyDates(id: string, newCheckIn: string): Booking {
    if (!DATE_RE.test(newCheckIn)) throw new DomainError('VALIDATION', 'checkIn must be YYYY-MM-DD');
    const b = this.repo.get(id);
    assertConfirmed(b);
    const fee = changeFeeCents(b, this.clock.now());
    const updated: Booking = {
      ...b,
      checkIn: newCheckIn,
      changeFeesCents: b.changeFeesCents + fee,
      version: b.version + 1,
    };
    if (this.repo.findOverlapping(b.roomId, checkInInstant(updated), checkOutInstant(updated), b.id).length) {
      throw new DomainError('INVALID_STATE', 'room ' + b.roomId + ' is not available');
    }
    this.repo.save(updated);
    if (fee > 0) this.ledger.charge(id, fee, 'change fee');
    this.bus.publish({ type: 'booking.modified', bookingId: id, feeCents: fee });
    return updated;
  }

  // TODO(PROJ-412): cancel(id) - see docs/CANCELLATION_SPEC.md
}
`,
      },
      {
        path: 'src/api/handlers.ts',
        content: `import { DomainError, HTTP_STATUS } from '../errors';
import { BookingService } from '../service/bookingService';

export interface Request {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
}

export interface Response {
  status: number;
  body: any;
}

export function makeHandler(service: BookingService): (req: Request) => Response {
  return function handle(req: Request): Response {
    try {
      const parts = req.path.split('/').filter(Boolean);
      if (parts[0] !== 'bookings') return { status: 404, body: { error: 'no route' } };
      if (req.method === 'POST' && parts.length === 1) {
        return { status: 201, body: service.create(req.body) };
      }
      if (req.method === 'GET' && parts.length === 2) {
        return { status: 200, body: service.get(parts[1]) };
      }
      if (req.method === 'PATCH' && parts.length === 2) {
        return { status: 200, body: service.modifyDates(parts[1], req.body && req.body.checkIn) };
      }
      // TODO(PROJ-412): POST /bookings/:id/cancel
      return { status: 404, body: { error: 'no route' } };
    } catch (e) {
      if (e instanceof DomainError) {
        return { status: HTTP_STATUS[e.code], body: { error: e.message, code: e.code } };
      }
      return { status: 500, body: { error: 'internal: ' + (e as Error).message } };
    }
  };
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { makeHandler } from './api/handlers';
import { Clock } from './domain/clock';
import { EventBus } from './events/bus';
import { Ledger } from './payments/ledger';
import { BookingRepo } from './repo/bookingRepo';
import { BookingService } from './service/bookingService';

export function buildApp(clock: Clock) {
  const repo = new BookingRepo();
  const ledger = new Ledger();
  const bus = new EventBus();
  const service = new BookingService(repo, ledger, bus, clock);
  return { handle: makeHandler(service), service, repo, ledger, bus };
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { buildApp } from './app';
import { FixedClock } from './domain/clock';

const clock = new FixedClock(Date.parse('2026-03-01T09:00:00Z'));
const app = buildApp(clock);

const created = app.handle({
  method: 'POST',
  path: '/bookings',
  body: { guestId: 'g1', roomId: 'r101', checkIn: '2026-03-10', nights: 3, nightlyRateCents: 12345 },
});
const id = created.body.id;
console.log(created.status, app.ledger.netFor(id));

clock.set('2026-03-08T15:00:00Z');
let r = app.handle({ method: 'PATCH', path: '/bookings/' + id, body: { checkIn: '2026-03-11' } });
console.log(r.status, r.body.changeFeesCents);

clock.set('2026-03-11T14:30:00Z');
r = app.handle({ method: 'PATCH', path: '/bookings/' + id, body: { checkIn: '2026-03-14' } });
console.log(r.status, r.body.changeFeesCents);

clock.set('2026-03-14T15:00:00Z');
r = app.handle({ method: 'PATCH', path: '/bookings/' + id, body: { checkIn: '2026-03-20' } });
console.log(r.status, r.body.error);

console.log(app.ledger.netFor(id));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Learn the pattern: trace a date change',
        prompt: 'Before you build cancellation, learn how the existing **date change** works. A guest sends `PATCH /bookings/bk_0001` 10 days before check-in. Order the steps as they execute.',
        items: [
          'handle() splits the path and routes PATCH to service.modifyDates',
          'repo.get returns a copy of the stored booking',
          'assertConfirmed checks the status',
          'changeFeeCents -> assertNotStarted -> hoursUntilCheckIn',
          'CHANGE_FEE_TIERS.find picks the first tier with h >= minHoursBefore',
          'repo.findOverlapping checks the new dates (excluding this booking)',
          'repo.save checks version === stored version + 1',
          'bus.publish emits booking.modified',
        ],
        hints: [
          'Start in `src/api/handlers.ts`, then read `modifyDates` top to bottom.',
          'The ledger charge is skipped here: 10 days out means the fee is 0, and `modifyDates` only charges when `fee > 0`.',
        ],
        explanation:
          'The pattern you will reuse: **load a copy -> guard state (`assertConfirmed`, `assertNotStarted`) -> compute money from a tier table -> build an updated copy with `version + 1` -> `repo.save` -> ledger side effect (only for non-zero amounts) -> publish an event**. The repo hands out copies and enforces optimistic locking, so forgetting `version: b.version + 1` makes `save` throw "concurrent modification". Errors are `DomainError`s that the handler maps to HTTP codes via `HTTP_STATUS`.',
        timeLimitSec: 360,
        focusFile: 'src/service/bookingService.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict the boundaries',
        prompt: 'The tier boundary convention will matter for refunds too. Predict exactly what `src/main.ts` prints.',
        entry: 'src/main.ts',
        answer: '201 37535\n200 2500\n200 7500\n409 stay has already started\n45035',
        options: [
          '201 37535\n200 2500\n200 7500\n409 stay has already started\n45035',
          '201 37535\n200 5000\n200 10000\n409 stay has already started\n47535',
          '201 37035\n200 2500\n200 7500\n409 stay has already started\n44535',
          '201 37535\n200 2500\n200 7500\n200 12500\n50035',
          '201 37535\n200 0\n200 5000\n409 stay has already started\n42535',
        ],
        hints: [
          'Check-in is 15:00 UTC. From 2026-03-08T15:00Z to 2026-03-10T15:00Z is exactly 48 hours.',
          'The tier test is `h >= t.minHoursBefore`, and `assertNotStarted` rejects `h <= 0`.',
        ],
        explanation:
          'Room charge 3 x 12345 = 37035, plus the 500 service fee = **37535** net. At exactly 48h before check-in, `48 >= 48` selects the 2500 tier. After moving to 03-11, the next change is 30 minutes before check-in, so h = 0.5 hits the `minHoursBefore: 0` tier (5000), total change fees **7500**. The last request is at exactly check-in time: h = 0, and `assertNotStarted` throws INVALID_STATE -> 409. Ledger net = 37535 + 2500 + 5000 = **45035**. The spec says refunds use the *same* `>=` boundaries, so a cancellation at exactly 168h gets 100%.',
        timeLimitSec: 420,
        focusFile: 'src/policy/rules.ts',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'feature',
        title: 'Implement PROJ-412',
        prompt: `Implement guest cancellation exactly as described in \`docs/CANCELLATION_SPEC.md\`:

- \`POST /bookings/:id/cancel\` -> \`200 { booking, refundCents }\`
- tiered refund of the **room charge** only, rounded down to the cent
- 409 when not confirmed or when the stay has started, 404 for unknown ids
- booking saved as \`cancelled\` with \`refundedCents\`, ledger refund entry (only when > 0), \`booking.cancelled\` event

Follow the existing patterns (tier table in \`rules.ts\`, guards, \`version + 1\`, events).`,
        editable: ['src/policy/rules.ts', 'src/service/bookingService.ts', 'src/api/handlers.ts'],
        tests: [
          {
            path: 'tests/cancel.test.ts',
            content: `import { buildApp } from '../src/app';
import { FixedClock } from '../src/domain/clock';

function setup(nights = 3, rate = 12345) {
  const clock = new FixedClock(Date.parse('2026-03-01T09:00:00Z'));
  const app = buildApp(clock);
  const r = app.handle({ method: 'POST', path: '/bookings', body: { guestId: 'g1', roomId: 'r101', checkIn: '2026-03-10', nights, nightlyRateCents: rate } });
  expect(r.status).toBe(201);
  return { app, clock, id: r.body.id as string };
}

const cancel = (app: any, id: string) => app.handle({ method: 'POST', path: '/bookings/' + id + '/cancel' });

test('full refund of room charge at exactly 7 days', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-03T15:00:00Z');
  const r = cancel(app, id);
  expect(r.status).toBe(200);
  expect(r.body.refundCents).toBe(37035);
  expect(r.body.booking.status).toBe('cancelled');
  expect(r.body.booking.refundedCents).toBe(37035);
  expect(app.ledger.netFor(id)).toBe(500);
});

test('half refund rounds down, boundary at exactly 48h', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-08T15:00:00Z');
  const r = cancel(app, id);
  expect(r.status).toBe(200);
  expect(r.body.refundCents).toBe(18517);
  expect(app.service.get(id).refundedCents).toBe(18517);
});

test('half refund just under 7 days', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-03T15:00:01Z');
  expect(cancel(app, id).body.refundCents).toBe(18517);
});

test('no refund inside 48h, and no zero ledger entry', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-08T15:00:01Z');
  const r = cancel(app, id);
  expect(r.status).toBe(200);
  expect(r.body.refundCents).toBe(0);
  expect(app.service.get(id).status).toBe('cancelled');
  expect(app.ledger.forBooking(id).filter((e: any) => e.kind === 'refund')).toHaveLength(0);
  expect(app.ledger.netFor(id)).toBe(37535);
});

test('weekly-discounted room charge is the refund base', () => {
  const { app, id } = setup(7, 10001);
  const r = cancel(app, id);
  expect(r.body.refundCents).toBe(63006);
  expect(app.ledger.netFor(id)).toBe(500);
});

test('change fees and service fee are never refunded', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-09T00:00:00Z');
  expect(app.handle({ method: 'PATCH', path: '/bookings/' + id, body: { checkIn: '2026-03-25' } }).status).toBe(200);
  clock.set('2026-03-10T00:00:00Z');
  const r = cancel(app, id);
  expect(r.body.refundCents).toBe(37035);
  expect(app.ledger.netFor(id)).toBe(500 + 5000);
});

test('ledger refund entry and event are written once', () => {
  const { app, id } = setup();
  cancel(app, id);
  const refunds = app.ledger.forBooking(id).filter((e: any) => e.kind === 'refund');
  expect(refunds).toHaveLength(1);
  expect(refunds[0].cents).toBe(37035);
  const evs = app.bus.published.filter((e: any) => e.type === 'booking.cancelled');
  expect(evs).toEqual([{ type: 'booking.cancelled', bookingId: id, refundCents: 37035 }]);
});

test('cancelling twice is a 409 and refunds only once', () => {
  const { app, id } = setup();
  expect(cancel(app, id).status).toBe(200);
  const again = cancel(app, id);
  expect(again.status).toBe(409);
  expect(again.body.code).toBe('INVALID_STATE');
  expect(app.ledger.netFor(id)).toBe(500);
});

test('cannot cancel once the stay has started', () => {
  const { app, clock, id } = setup();
  clock.set('2026-03-10T15:00:00Z');
  const r = cancel(app, id);
  expect(r.status).toBe(409);
  expect(app.service.get(id).status).toBe('confirmed');
  expect(app.ledger.netFor(id)).toBe(37535);
});

test('unknown booking is 404', () => {
  const { app } = setup();
  expect(cancel(app, 'bk_9999').status).toBe(404);
});

test('cancelled booking frees the room and cannot be modified', () => {
  const { app, id } = setup();
  cancel(app, id);
  const again = app.handle({ method: 'POST', path: '/bookings', body: { guestId: 'g2', roomId: 'r101', checkIn: '2026-03-10', nights: 2, nightlyRateCents: 9000 } });
  expect(again.status).toBe(201);
  expect(app.handle({ method: 'PATCH', path: '/bookings/' + id, body: { checkIn: '2026-04-01' } }).status).toBe(409);
});

test('existing routes still work', () => {
  const { app, id } = setup();
  expect(app.handle({ method: 'GET', path: '/bookings/' + id }).status).toBe(200);
  expect(app.handle({ method: 'DELETE', path: '/bookings/' + id }).status).toBe(404);
});
`,
          },
        ],
        solution: {
          'src/policy/rules.ts': `import { Booking, checkInInstant } from '../domain/booking';
import { DomainError } from '../errors';

const HOUR_MS = 3_600_000;

/** Hours from nowMs until check-in. Zero or negative once the stay has started. */
export function hoursUntilCheckIn(b: Booking, nowMs: number): number {
  return (checkInInstant(b) - nowMs) / HOUR_MS;
}

export function assertConfirmed(b: Booking): void {
  if (b.status !== 'confirmed') {
    throw new DomainError('INVALID_STATE', 'booking ' + b.id + ' is ' + b.status);
  }
}

export function assertNotStarted(b: Booking, nowMs: number): number {
  const h = hoursUntilCheckIn(b, nowMs);
  if (h <= 0) throw new DomainError('INVALID_STATE', 'stay has already started');
  return h;
}

export interface ChangeFeeTier {
  minHoursBefore: number;
  feeCents: number;
}

/** Most generous first. The first tier with hoursBefore >= minHoursBefore wins. */
export const CHANGE_FEE_TIERS: ChangeFeeTier[] = [
  { minHoursBefore: 168, feeCents: 0 },
  { minHoursBefore: 48, feeCents: 2500 },
  { minHoursBefore: 0, feeCents: 5000 },
];

export function changeFeeCents(b: Booking, nowMs: number): number {
  const h = assertNotStarted(b, nowMs);
  const tier = CHANGE_FEE_TIERS.find((t) => h >= t.minHoursBefore);
  return tier ? tier.feeCents : CHANGE_FEE_TIERS[CHANGE_FEE_TIERS.length - 1].feeCents;
}

export interface RefundTier {
  minHoursBefore: number;
  refundPct: number;
}

/** Most generous first. Same >= convention as CHANGE_FEE_TIERS. */
export const REFUND_TIERS: RefundTier[] = [
  { minHoursBefore: 168, refundPct: 100 },
  { minHoursBefore: 48, refundPct: 50 },
  { minHoursBefore: 0, refundPct: 0 },
];

/** Refund in cents: a percentage of the ROOM CHARGE only, rounded down. */
export function refundCents(b: Booking, nowMs: number): number {
  const h = assertNotStarted(b, nowMs);
  const tier = REFUND_TIERS.find((t) => h >= t.minHoursBefore);
  const pct = tier ? tier.refundPct : 0;
  return Math.floor((b.roomChargeCents * pct) / 100);
}
`,
          'src/service/bookingService.ts': `import { Booking, checkInInstant, checkOutInstant, paidCents } from '../domain/booking';
import { Clock } from '../domain/clock';
import { DomainError } from '../errors';
import { EventBus } from '../events/bus';
import { Ledger } from '../payments/ledger';
import { quoteRoomCharge, SERVICE_FEE_CENTS } from '../policy/pricing';
import { assertConfirmed, changeFeeCents, refundCents } from '../policy/rules';
import { BookingRepo } from '../repo/bookingRepo';

export interface CreateInput {
  guestId: string;
  roomId: string;
  checkIn: string;
  nights: number;
  nightlyRateCents: number;
}

const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;

export class BookingService {
  constructor(
    private repo: BookingRepo,
    private ledger: Ledger,
    private bus: EventBus,
    private clock: Clock,
  ) {}

  get(id: string): Booking {
    return this.repo.get(id);
  }

  create(input: CreateInput): Booking {
    if (!input || !input.guestId || !input.roomId) throw new DomainError('VALIDATION', 'guestId and roomId required');
    if (!DATE_RE.test(input.checkIn)) throw new DomainError('VALIDATION', 'checkIn must be YYYY-MM-DD');
    const roomChargeCents = quoteRoomCharge(input.nights, input.nightlyRateCents);
    const b: Booking = {
      id: this.repo.nextId(),
      guestId: input.guestId,
      roomId: input.roomId,
      checkIn: input.checkIn,
      nights: input.nights,
      roomChargeCents,
      serviceFeeCents: SERVICE_FEE_CENTS,
      changeFeesCents: 0,
      refundedCents: 0,
      status: 'confirmed',
      version: 1,
    };
    if (this.repo.findOverlapping(b.roomId, checkInInstant(b), checkOutInstant(b)).length) {
      throw new DomainError('INVALID_STATE', 'room ' + b.roomId + ' is not available');
    }
    this.repo.insert(b);
    this.ledger.charge(b.id, roomChargeCents, 'room');
    this.ledger.charge(b.id, SERVICE_FEE_CENTS, 'service fee');
    this.bus.publish({ type: 'booking.created', bookingId: b.id, paidCents: paidCents(b) });
    return b;
  }

  modifyDates(id: string, newCheckIn: string): Booking {
    if (!DATE_RE.test(newCheckIn)) throw new DomainError('VALIDATION', 'checkIn must be YYYY-MM-DD');
    const b = this.repo.get(id);
    assertConfirmed(b);
    const fee = changeFeeCents(b, this.clock.now());
    const updated: Booking = {
      ...b,
      checkIn: newCheckIn,
      changeFeesCents: b.changeFeesCents + fee,
      version: b.version + 1,
    };
    if (this.repo.findOverlapping(b.roomId, checkInInstant(updated), checkOutInstant(updated), b.id).length) {
      throw new DomainError('INVALID_STATE', 'room ' + b.roomId + ' is not available');
    }
    this.repo.save(updated);
    if (fee > 0) this.ledger.charge(id, fee, 'change fee');
    this.bus.publish({ type: 'booking.modified', bookingId: id, feeCents: fee });
    return updated;
  }

  cancel(id: string): { booking: Booking; refundCents: number } {
    const b = this.repo.get(id);
    assertConfirmed(b);
    const refund = refundCents(b, this.clock.now());
    const updated: Booking = {
      ...b,
      status: 'cancelled',
      refundedCents: b.refundedCents + refund,
      version: b.version + 1,
    };
    this.repo.save(updated);
    if (refund > 0) this.ledger.refund(id, refund, 'cancellation');
    this.bus.publish({ type: 'booking.cancelled', bookingId: id, refundCents: refund });
    return { booking: updated, refundCents: refund };
  }
}
`,
          'src/api/handlers.ts': `import { DomainError, HTTP_STATUS } from '../errors';
import { BookingService } from '../service/bookingService';

export interface Request {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: any;
}

export interface Response {
  status: number;
  body: any;
}

export function makeHandler(service: BookingService): (req: Request) => Response {
  return function handle(req: Request): Response {
    try {
      const parts = req.path.split('/').filter(Boolean);
      if (parts[0] !== 'bookings') return { status: 404, body: { error: 'no route' } };
      if (req.method === 'POST' && parts.length === 1) {
        return { status: 201, body: service.create(req.body) };
      }
      if (req.method === 'GET' && parts.length === 2) {
        return { status: 200, body: service.get(parts[1]) };
      }
      if (req.method === 'PATCH' && parts.length === 2) {
        return { status: 200, body: service.modifyDates(parts[1], req.body && req.body.checkIn) };
      }
      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'cancel') {
        return { status: 200, body: service.cancel(parts[1]) };
      }
      return { status: 404, body: { error: 'no route' } };
    } catch (e) {
      if (e instanceof DomainError) {
        return { status: HTTP_STATUS[e.code], body: { error: e.message, code: e.code } };
      }
      return { status: 500, body: { error: 'internal: ' + (e as Error).message } };
    }
  };
}
`,
        },
        hints: [
          'Mirror `CHANGE_FEE_TIERS` / `changeFeeCents` with a `REFUND_TIERS` table and a `refundCents(b, now)` function that reuses `assertNotStarted`.',
          'Mirror `modifyDates`: `repo.get` -> `assertConfirmed` -> compute -> `{ ...b, status, refundedCents, version: b.version + 1 }` -> `repo.save` -> ledger -> event.',
          'The base is `roomChargeCents`, not `paidCents(b)`. 50% of 37035 is 18517.5, so use `Math.floor`. `Ledger.append` rejects 0, so guard with `refund > 0`.',
        ],
        explanation: `A clean solution adds a \`REFUND_TIERS\` table next to \`CHANGE_FEE_TIERS\` and a \`refundCents\` function that reuses \`assertNotStarted\`, so "stay has started" means the same thing everywhere. \`cancel\` follows \`modifyDates\` step by step.

Traps the tests catch:
- **Wrong base**: refunding \`paidCents\` pays back the service fee and change fees.
- **Rounding**: \`Math.round(18517.5)\` = 18518 pays half a cent more than owed. The spec says round down.
- **Boundaries**: \`h > 168\` instead of \`>=\` gives only 50% at exactly 7 days.
- **Optimistic lock**: saving without \`version + 1\` makes \`repo.save\` throw a 409 "concurrent modification" on *every* cancel.
- **Zero refunds**: \`Ledger\` rejects non-positive amounts, so an unconditional \`ledger.refund(id, 0)\` turns a valid late cancellation into a 500.
- **Order of side effects**: guard and save *before* touching the ledger, so a rejected cancel (409) leaves no money movement.`,
        timeLimitSec: 1500,
        focusFile: 'src/service/bookingService.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the assistant\'s refund function',
        prompt: 'A teammate asked the assistant for the refund calculation before your PR landed. Review it against the spec.',
        persona: 'confident-intern',
        request: 'Write refundCents(booking, nowMs) for PROJ-412 using our tier pattern.',
        aiReply: `Here you go, it slots right into \`rules.ts\` and follows the change-fee pattern exactly:

\`\`\`ts
export const REFUND_TIERS = [
  { minHoursBefore: 168, refundPct: 100 },
  { minHoursBefore: 48, refundPct: 50 },
  { minHoursBefore: 0, refundPct: 0 },
];

export function refundCents(b: Booking, nowMs: number): number {
  const h = assertNotStarted(b, nowMs);
  const tier = REFUND_TIERS.find((t) => h >= t.minHoursBefore);
  // refund what the guest actually paid us
  return Math.floor((paidCents(b) * (tier?.refundPct ?? 0)) / 100);
}
\`\`\`

Using \`paidCents\` keeps it future-proof if we add more fee types later. Boundaries and rounding match the spec. 🚀`,
        options: [
          'Accept: tiers, boundary and rounding all match the spec',
          'Reject: `paidCents` includes the service fee and change fees, which the spec says are never refunded; the base must be `roomChargeCents`',
          'Reject: `Math.floor` should be `Math.round` so that refunds are fair to the guest',
          'Reject: `find` returns the last matching tier, so every early cancellation gets 0%',
          'Reject: `assertNotStarted` returns void, so `h` is undefined',
        ],
        correct: 1,
        hints: ['Re-read the first bullet under the refund table in the spec.', 'What does `paidCents` add up?'],
        explanation:
          '`paidCents(b)` = room charge + service fee + change fees. At the 100% tier this refunds the 500 service fee and every change fee, exactly what the spec forbids. "Future-proof" is backwards: any new fee type would *also* become refundable by default. `find` returns the **first** match (tiers are ordered most generous first), `assertNotStarted` does return the hours, and the spec explicitly says round down.',
        timeLimitSec: 300,
        focusFile: 'src/policy/rules.ts',
      },
    ],
  },
  // ───────────────────────────── 2. Log processor at scale (Python, optimise) ─────────────────────────────
  {
    id: 'l4-a-py-log-report-scale',
    title: 'Log Report: 200k Lines Before Standup',
    level: 4,
    rating: 2100,
    lang: 'python',
    domain: 'log-processor',
    companies: ['google', 'amazon', 'atlassian', 'meta'],
    tags: ['optimise', 'complexity', 'sliding-window', 'percentiles', 'behaviour-preserving'],
    summary: 'The nightly report is correct on the sample and never finishes on production volume. Make it linear-ish without changing a single number.',
    context: `You are on the **observability** team. \`logproc\` builds the nightly per-service report that SREs read at standup. It was written against a 10-line sample and its unit tests pass.

Last night production produced ~200,000 lines and the job was killed after 40 minutes. Your job: find what scales badly, then make it fast **without changing any output**: the SRE dashboards diff these numbers day over day.`,
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# logproc

\`python main.py\` prints the report for \`sample.log\`.

Line format:

    <ISO-8601 UTC, Z suffix> <LEVEL> <service> req=<request id> latency=<n>ms <free text>

Report semantics (dashboards depend on these, do not change them):

- Blank lines and lines starting with \`#\` are ignored. Lines that do not parse count as \`bad_lines\`.
- The load balancer retries requests and both attempts are logged. Only the **first** line
  per (service, request id) counts; later ones are retries and are dropped.
- \`p50\`/\`p95\` use the nearest-rank method.
- \`max_errors_60s\` (\`burst\`): the largest number of ERROR lines of a service whose timestamps fall
  in a half-open window \`[t, t + 60)\` where \`t\` is the timestamp of one of those errors.
  Input is **not** sorted by time.
- \`slowest\`: top N by latency desc, ties by earlier timestamp, then request id.
`,
      },
      {
        path: 'logproc/__init__.py',
        content: ``,
      },
      {
        path: 'logproc/model.py',
        content: `from dataclasses import dataclass

LEVELS = ("DEBUG", "INFO", "WARN", "ERROR")


@dataclass(frozen=True)
class LogRecord:
    ts: int  # epoch seconds, UTC
    level: str
    service: str
    request_id: str
    latency_ms: int
    message: str
`,
      },
      {
        path: 'logproc/timeparse.py',
        content: `import calendar


def parse_iso_utc(s):
    """'2026-05-01T10:00:07Z' -> epoch seconds. Only the Z (UTC) form is accepted."""
    if len(s) != 20 or s[10] != "T" or s[-1] != "Z":
        raise ValueError("bad timestamp: " + s)
    return calendar.timegm(
        (int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19]), 0, 0, 0)
    )
`,
      },
      {
        path: 'logproc/parser.py',
        content: `import re

from logproc.model import LogRecord
from logproc.timeparse import parse_iso_utc

LINE_RE = re.compile(r"^(\\S+) (DEBUG|INFO|WARN|ERROR) (\\S+) req=(\\S+) latency=(\\d+)ms ?(.*)$")


def parse_line(line):
    """Return a LogRecord, or None if the line is malformed."""
    m = LINE_RE.match(line.rstrip("\\n"))
    if not m:
        return None
    ts, level, service, rid, latency, msg = m.groups()
    try:
        epoch = parse_iso_utc(ts)
    except ValueError:
        return None
    return LogRecord(epoch, level, service, rid, int(latency), msg)


def parse_lines(lines):
    """Returns (records, bad_line_count). Blank lines and # comments are skipped."""
    records = []
    bad = 0
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        rec = parse_line(line)
        if rec is None:
            bad += 1
            continue
        records.append(rec)
    return records, bad
`,
      },
      {
        path: 'logproc/dedupe.py',
        content: `def drop_retries(records):
    """Keep only the first record per (service, request_id), preserving input order."""
    seen = []
    out = []
    for r in records:
        key = (r.service, r.request_id)
        if key in seen:
            continue
        seen.append(key)
        out.append(r)
    return out
`,
      },
      {
        path: 'logproc/stats.py',
        content: `import math


def percentile(sorted_values, p):
    """Nearest-rank percentile of an ascending list. None for an empty list."""
    if not sorted_values:
        return None
    k = max(1, math.ceil(p / 100 * len(sorted_values)))
    return sorted_values[k - 1]
`,
      },
      {
        path: 'logproc/bursts.py',
        content: `WINDOW_SECONDS = 60


def max_errors_in_window(records, service):
    """Largest number of ERROR records of \`service\` inside any window
    [t, t + WINDOW_SECONDS), where t is the timestamp of one of those errors.
    Records are NOT sorted by time."""
    errs = [r.ts for r in records if r.service == service and r.level == "ERROR"]
    best = 0
    for start in errs:
        count = 0
        for t in errs:
            if start <= t < start + WINDOW_SECONDS:
                count += 1
        if count > best:
            best = count
    return best
`,
      },
      {
        path: 'logproc/report.py',
        content: `from logproc.bursts import max_errors_in_window
from logproc.dedupe import drop_retries
from logproc.parser import parse_lines
from logproc.stats import percentile


def build_report(lines, top_n=3):
    records, bad = parse_lines(lines)
    records = drop_retries(records)

    report = {"bad_lines": bad, "services": {}}
    for svc in sorted({r.service for r in records}):
        rs = [r for r in records if r.service == svc]
        latencies = []
        errors = 0
        for r in rs:
            latencies.append(r.latency_ms)
            latencies.sort()  # keep sorted for percentile()
            if r.level == "ERROR":
                errors += 1
        report["services"][svc] = {
            "requests": len(rs),
            "error_rate": round(errors / len(rs), 4),
            "p50": percentile(latencies, 50),
            "p95": percentile(latencies, 95),
            "max_errors_60s": max_errors_in_window(records, svc),
        }

    slowest = sorted(records, key=lambda r: (-r.latency_ms, r.ts, r.request_id))
    report["slowest"] = [(r.request_id, r.latency_ms) for r in slowest[:top_n]]
    return report
`,
      },
      {
        path: 'logproc/report_format.py',
        content: `def format_report(rep):
    lines = ["bad_lines=%d" % rep["bad_lines"]]
    for svc, s in rep["services"].items():
        lines.append(
            "%s: n=%d err=%.2f p50=%s p95=%s burst=%d"
            % (svc, s["requests"], s["error_rate"], s["p50"], s["p95"], s["max_errors_60s"])
        )
    lines.append("slowest: " + ", ".join("%s(%d)" % (rid, ms) for rid, ms in rep["slowest"]))
    return "\\n".join(lines)
`,
      },
      {
        path: 'sample.log',
        language: 'text',
        content: `# sample from prod-eu-1, 2026-05-01
2026-05-01T10:00:00Z INFO auth req=a1 latency=40ms login ok
2026-05-01T10:00:05Z ERROR auth req=a2 latency=900ms token expired
2026-05-01T10:00:05Z ERROR auth req=a2 latency=950ms token expired
2026-05-01T10:01:05Z ERROR auth req=a3 latency=30ms bad password
2026-05-01T10:00:50Z ERROR auth req=a4 latency=35ms bad password

2026-05-01T10:00:20Z INFO cart req=c1 latency=120ms add item
2026-05-01T10:00:21Z WARN cart req=c2 latency=950ms slow db
2026-05-01T10:00:22Z INFO cart req=a1 latency=80ms view
2026-05-01T10:00:23 INFO cart req=c3 latency=10ms no zone
2026-05-01T10:00:30Z INFO cart req=c4 latency=60ms view
`,
      },
      {
        path: 'main.py',
        content: `from logproc.report import build_report
from logproc.report_format import format_report

with open("sample.log") as f:
    print(format_report(build_report(f.readlines())))
`,
      },
      {
        path: 'tests/test_report_small.py',
        content: `from logproc.report import build_report


def test_sample_counts():
    with open("sample.log") as f:
        rep = build_report(f.readlines())
    assert rep["bad_lines"] == 1
    assert rep["services"]["auth"]["requests"] == 4
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Know the semantics before you touch them',
        prompt: 'An optimisation must not change output, so first pin down what the report *means*. What does `python main.py` print?',
        entry: 'main.py',
        answer:
          'bad_lines=1\nauth: n=4 err=0.75 p50=35 p95=900 burst=2\ncart: n=4 err=0.00 p50=80 p95=950 burst=0\nslowest: c2(950), a2(900), c1(120)',
        options: [
          'bad_lines=1\nauth: n=4 err=0.75 p50=35 p95=900 burst=2\ncart: n=4 err=0.00 p50=80 p95=950 burst=0\nslowest: c2(950), a2(900), c1(120)',
          'bad_lines=1\nauth: n=4 err=0.75 p50=35 p95=900 burst=3\ncart: n=4 err=0.00 p50=80 p95=950 burst=0\nslowest: c2(950), a2(900), c1(120)',
          'bad_lines=1\nauth: n=5 err=0.80 p50=40 p95=950 burst=3\ncart: n=4 err=0.00 p50=80 p95=950 burst=0\nslowest: a2(950), c2(950), a2(900)',
          'bad_lines=1\nauth: n=4 err=0.75 p50=35 p95=900 burst=2\ncart: n=3 err=0.00 p50=120 p95=950 burst=0\nslowest: c2(950), a2(900), c1(120)',
          'bad_lines=2\nauth: n=4 err=0.75 p50=37 p95=900 burst=2\ncart: n=4 err=0.00 p50=100 p95=950 burst=0\nslowest: c2(950), a2(900), c1(120)',
        ],
        hints: [
          'The line without a `Z` matches the regex but `parse_iso_utc` rejects it. The blank line and the `#` comment are skipped, not counted as bad.',
          'Retries are keyed by (service, request id): `a1` in `cart` is a different request from `a1` in `auth`.',
          'auth errors are at :05, :50 and 1:05. Is 10:01:05 inside `[10:00:05, 10:01:05)`?',
        ],
        explanation: `- **bad_lines=1**: only the timestamp without \`Z\` fails. Blank and \`#\` lines are skipped.
- **auth**: the second \`a2\` line is a retry and is dropped, leaving a1, a2(900), a3, a4: n=4, 3 errors -> 0.75. Sorted latencies [30, 35, 40, 900]: nearest-rank p50 = rank ceil(2) = 35, p95 = rank ceil(3.8) = 4 -> 900.
- **burst=2**: windows are half-open. [10:00:05, 10:01:05) holds :05 and :50 but **not** 1:05. [10:00:50, 10:01:50) holds :50 and 1:05. Never 3.
- **cart**: \`a1\` is a new key in cart, so n=4. Sorted [60, 80, 120, 950] gives p50 = 80 and p95 = 950.
- **slowest**: the 950 ms retry of a2 was dropped, so c2(950), a2(900), c1(120).

Write these down: your fast version must reproduce every one of them.`,
        timeLimitSec: 480,
        focusFile: 'logproc/report.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Where does the time go?',
        prompt: 'With n = 200,000 lines, ~4 services and ~20% errors, which pieces of code are **super-linear in n** and need to change? Select all that apply.',
        options: [
          '`drop_retries`: `key in seen` where `seen` is a list',
          '`build_report`: `latencies.sort()` inside the per-record loop',
          '`max_errors_in_window`: nested loop over the error timestamps',
          '`parse_line`: running a regex on every line',
          '`build_report`: `[r for r in records if r.service == svc]` once per service',
          '`sorted(records, key=...)` for the slowest list',
        ],
        correct: [0, 1, 2],
        hints: [
          'List membership is a linear scan. How many scans, over a list of what size?',
          'Timsort is O(n) on already-sorted input, but how many times is it called?',
          'With S = 4 services, O(S x n) is still linear in n.',
        ],
        explanation: `- \`key in seen\` on a **list** is O(len(seen)), giving O(n^2) total (~2x10^10 tuple comparisons at 200k). Use a set.
- Re-sorting after every append: even though Timsort is O(k) on an already-sorted list, k grows to ~50k per service, giving O(n^2 / S). Sort once at the end.
- The burst check is O(E^2) per service: with ~10k errors per service that is ~10^8 comparisons each.
- Regex parsing is O(n) total, the per-service filter is O(S x n) with S constant, and one sort is O(n log n). None of these are your problem.

Always count **how many times** an operation runs, not just its cost per call.`,
        timeLimitSec: 360,
        focusFile: 'logproc/report.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'optimise',
        title: 'Make the nightly job finish',
        prompt: `Make \`build_report\` handle **200,000 lines** within the time budget (the hidden test generates them). The report must be **identical** to the current behaviour for every input, including the sample, retries keyed per service, half-open burst windows, unsorted input and the slowest-list tie-breaks.

Keep the public functions (\`drop_retries\`, \`max_errors_in_window\`, \`percentile\`, \`build_report\`) working with the same signatures: other jobs import them.`,
        editable: ['logproc/dedupe.py', 'logproc/bursts.py', 'logproc/report.py', 'logproc/stats.py'],
        timeoutMs: 8000,
        tests: [
          {
            path: 'tests/test_report_hidden.py',
            content: `from logproc.report import build_report
from logproc.bursts import max_errors_in_window
from logproc.dedupe import drop_retries
from logproc.model import LogRecord


def L(ts, level, svc, rid, lat):
    h, rem = divmod(ts, 3600)
    m, s = divmod(rem, 60)
    return "2026-05-01T%02d:%02d:%02dZ %s %s req=%s latency=%dms x" % (h, m, s, level, svc, rid, lat)


def make_lines(n=200_000):
    seed = 12345

    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed >> 16

    services = ["auth", "cart", "checkout", "search"]
    levels = ["INFO", "INFO", "INFO", "WARN", "ERROR"]
    lines = []
    prev = None
    for i in range(n):
        t = i // 3 + rnd() % 5
        if prev is not None and rnd() % 10 == 0:
            svc, rid = prev
        else:
            svc, rid = services[rnd() % 4], "r%06d" % i
        lines.append(L(t, levels[rnd() % 5], svc, rid, 1 + rnd() % 2000))
        if i % 50_000 == 0:
            lines.append("garbage line")
        prev = (svc, rid)
    return lines


def test_sample_unchanged():
    with open("sample.log") as f:
        rep = build_report(f.readlines())
    assert rep == {
        "bad_lines": 1,
        "services": {
            "auth": {"requests": 4, "error_rate": 0.75, "p50": 35, "p95": 900, "max_errors_60s": 2},
            "cart": {"requests": 4, "error_rate": 0.0, "p50": 80, "p95": 950, "max_errors_60s": 0},
        },
        "slowest": [("c2", 950), ("a2", 900), ("c1", 120)],
    }


def test_retries_are_per_service_and_keep_first():
    recs = [
        LogRecord(5, "INFO", "a", "x", 10, ""),
        LogRecord(1, "INFO", "b", "x", 20, ""),
        LogRecord(3, "ERROR", "a", "x", 30, ""),
        LogRecord(2, "INFO", "a", "y", 40, ""),
    ]
    out = drop_retries(recs)
    assert [(r.service, r.request_id, r.latency_ms) for r in out] == [("a", "x", 10), ("b", "x", 20), ("a", "y", 40)]


def test_burst_window_half_open_and_unsorted():
    recs = [LogRecord(t, "ERROR", "s", "r%d" % i, 1, "") for i, t in enumerate([160, 100, 159, 100, 220, 40])]
    recs.append(LogRecord(130, "INFO", "s", "ok", 1, ""))
    recs.append(LogRecord(120, "ERROR", "other", "o", 1, ""))
    # [100,160): 100,100,159 -> 3 ; [159,219): 159,160 -> 2 ; [160,220): 160 -> 1 (220 excluded)
    assert max_errors_in_window(recs, "s") == 3
    assert max_errors_in_window(recs, "other") == 1
    assert max_errors_in_window(recs, "nobody") == 0


def test_slowest_tie_breaks():
    lines = [L(50, "INFO", "a", "z", 500), L(10, "INFO", "b", "y", 500), L(10, "INFO", "a", "b", 500), L(1, "INFO", "a", "q", 7)]
    rep = build_report(lines, top_n=4)
    assert rep["slowest"] == [("b", 500), ("y", 500), ("z", 500), ("q", 7)]


def test_200k_lines():
    lines = make_lines()
    rep = build_report(lines)
    assert rep == EXPECTED_200K


EXPECTED_200K = {
    "bad_lines": 4,
    "services": {
        "auth": {"requests": 45031, "error_rate": 0.2013, "p50": 979, "p95": 1897, "max_errors_60s": 20},
        "cart": {"requests": 44978, "error_rate": 0.1991, "p50": 974, "p95": 1897, "max_errors_60s": 20},
        "checkout": {"requests": 45267, "error_rate": 0.2006, "p50": 985, "p95": 1896, "max_errors_60s": 21},
        "search": {"requests": 44869, "error_rate": 0.1988, "p50": 986, "p95": 1899, "max_errors_60s": 21},
    },
    "slowest": [("r005831", 2000), ("r008635", 2000), ("r011065", 2000)],
}
`,
          },
        ],
        solution: {
          'logproc/dedupe.py': `def drop_retries(records):
    """Keep only the first record per (service, request_id), preserving input order."""
    seen = set()
    out = []
    for r in records:
        key = (r.service, r.request_id)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out
`,
          'logproc/bursts.py': `WINDOW_SECONDS = 60


def max_in_window(sorted_ts):
    """Two pointers over ascending timestamps: max count in any [t, t + WINDOW)."""
    best = 0
    j = 0
    n = len(sorted_ts)
    for i in range(n):
        if j < i:
            j = i
        limit = sorted_ts[i] + WINDOW_SECONDS
        while j < n and sorted_ts[j] < limit:
            j += 1
        if j - i > best:
            best = j - i
    return best


def max_errors_in_window(records, service):
    """Largest number of ERROR records of \`service\` inside any window
    [t, t + WINDOW_SECONDS), where t is the timestamp of one of those errors.
    Records are NOT sorted by time."""
    return max_in_window(sorted(r.ts for r in records if r.service == service and r.level == "ERROR"))
`,
          'logproc/report.py': `from logproc.bursts import max_in_window
from logproc.dedupe import drop_retries
from logproc.parser import parse_lines
from logproc.stats import percentile


def build_report(lines, top_n=3):
    records, bad = parse_lines(lines)
    records = drop_retries(records)

    groups = {}
    for r in records:
        g = groups.get(r.service)
        if g is None:
            g = groups[r.service] = {"lat": [], "err_ts": []}
        g["lat"].append(r.latency_ms)
        if r.level == "ERROR":
            g["err_ts"].append(r.ts)

    report = {"bad_lines": bad, "services": {}}
    for svc in sorted(groups):
        g = groups[svc]
        latencies = sorted(g["lat"])
        n = len(latencies)
        report["services"][svc] = {
            "requests": n,
            "error_rate": round(len(g["err_ts"]) / n, 4),
            "p50": percentile(latencies, 50),
            "p95": percentile(latencies, 95),
            "max_errors_60s": max_in_window(sorted(g["err_ts"])),
        }

    slowest = sorted(records, key=lambda r: (-r.latency_ms, r.ts, r.request_id))
    report["slowest"] = [(r.request_id, r.latency_ms) for r in slowest[:top_n]]
    return report
`,
        },
        hints: [
          'Fix the three hot spots from the previous stage. Each one has a textbook O(n) or O(n log n) replacement.',
          'For bursts: sort the error timestamps once, then slide two pointers. Use `<` for the right edge so the window stays half-open.',
          'Bucket records by service in **one** pass, collecting latencies and error timestamps, then sort each bucket once.',
        ],
        explanation: `Three changes, none of which changes the output:

1. **Dedupe**: \`seen\` becomes a \`set\`, giving O(1) membership. The output list still keeps input order, so "first wins" still holds.
2. **Percentiles**: collect latencies, then \`sorted()\` once per service: O(n log n) instead of O(n^2).
3. **Bursts**: sort the error timestamps, then use a two-pointer sweep. For each left index \`i\`, move \`j\` forward while \`ts[j] < ts[i] + 60\`. \`j\` never goes backwards, so the sweep is O(E) after an O(E log E) sort. The strict \`<\` keeps the window half-open, and duplicate timestamps are counted the same way as before.

Grouping by service in one pass also removes the S x n rescans. That is not required for the budget, but it is free. The 200k-line test compares the *whole* report against the numbers the old code produces, which is how real optimisation work is checked: golden output first, speed second.`,
        timeLimitSec: 1500,
        focusFile: 'logproc/report.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'A faster burst check?',
        prompt: 'A colleague pasted this from the assistant as a drop-in replacement for `max_errors_in_window`. Review it.',
        persona: 'confident-intern',
        request: 'Make max_errors_in_window fast. Records are unsorted.',
        aiReply: `Classic binary-search trick, O(E log E):

\`\`\`python
import bisect

def max_errors_in_window(records, service):
    errs = sorted(r.ts for r in records if r.service == service and r.level == "ERROR")
    best = 0
    for i, t in enumerate(errs):
        j = bisect.bisect_right(errs, t + WINDOW_SECONDS)
        best = max(best, j - i)
    return best
\`\`\`

\`bisect_right\` finds the end of the window, so \`j - i\` is the number of errors in it. Handles duplicates too!`,
        options: [
          'Accept: it is O(E log E) and equivalent to the original',
          'Reject: `bisect_right(errs, t + 60)` counts an error at exactly t + 60, so the window becomes closed `[t, t + 60]`. It should be `bisect_left`',
          'Reject: with duplicate timestamps `enumerate` starts at the second copy and undercounts',
          'Reject: sorting the timestamps changes which error is "first", so results differ from the unsorted original',
        ],
        correct: 1,
        hints: ['What index does `bisect_right` return for a value that is present in the list?', 'Try errors at 0 and 60.'],
        explanation: `\`bisect_right(a, x)\` returns the index *after* every element equal to \`x\`, so an error at exactly \`t + 60\` is counted. With errors at 0 and 60 the original says 1 and this says 2. On the sample log, auth would jump from burst=2 to 3. \`bisect_left\` gives the first index with value >= t + 60, which matches the half-open \`[t, t + 60)\`.

Duplicates are fine: at the first copy's index \`i\`, every later copy is counted, and \`max\` keeps that. Sorting does not matter, because the window count only depends on the set of timestamps. This is the classic inclusive/exclusive boundary bug that slips through review because "it looks like the textbook".`,
        timeLimitSec: 300,
        focusFile: 'logproc/bursts.py',
      },
    ],
  },
  // ───────────────────────────── 3. LRU + TTL cache stale reads (TS) ─────────────────────────────
  {
    id: 'l4-a-ts-lru-ttl-stale',
    title: 'The Price That Would Not Update',
    level: 4,
    rating: 2050,
    lang: 'typescript',
    domain: 'cache',
    companies: ['amazon', 'canva', 'meta', 'apple'],
    tags: ['lru', 'ttl', 'cache-invalidation', 'async', 'request-coalescing', 'two-bugs'],
    summary: 'Customers see yesterday\'s prices for hours. There are two separate reasons. Find both.',
    context: `You are on the **catalog** team. The product page reads through an in-process \`LruTtlCache\` (TTL 60 s) in front of the product DB.

Two complaints arrived the same week:
1. **CAT-881**: prices changed by the *pricing batch job* (which writes the DB directly and never invalidates the cache) were still shown hours later on popular products. The TTL is 60 seconds.
2. **CAT-886**: a merchant changed a price in the admin UI (which **does** invalidate) and the old price stuck around anyway, but only on products that were being viewed at that moment.

All latency in this repo is simulated with \`ticks(n)\` (n microtask yields), so every interleaving is deterministic.`,
    persona: 'agent-mode',
    files: [
      {
        path: 'src/util/ticks.ts',
        content: `/** Simulated I/O latency: yield to the event loop n times. Deterministic (microtask based). */
export async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
`,
      },
      {
        path: 'src/cache/clock.ts',
        content: `export interface Clock {
  now(): number;
}

export class ManualClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
`,
      },
      {
        path: 'src/cache/lruList.ts',
        content: `export interface ListNode<K> {
  key: K;
  prev: ListNode<K> | null;
  next: ListNode<K> | null;
}

/** Doubly linked list of keys. Head = most recently used, tail = least recently used. */
export class LruList<K> {
  private head: ListNode<K> | null = null;
  private tail: ListNode<K> | null = null;

  pushFront(key: K): ListNode<K> {
    const n: ListNode<K> = { key, prev: null, next: null };
    this.linkFront(n);
    return n;
  }

  moveToFront(n: ListNode<K>): void {
    if (n === this.head) return;
    this.unlink(n);
    this.linkFront(n);
  }

  remove(n: ListNode<K>): void {
    this.unlink(n);
  }

  popBack(): K | undefined {
    const n = this.tail;
    if (!n) return undefined;
    this.unlink(n);
    return n.key;
  }

  keys(): K[] {
    const out: K[] = [];
    for (let n = this.head; n; n = n.next) out.push(n.key);
    return out;
  }

  private linkFront(n: ListNode<K>): void {
    n.prev = null;
    n.next = this.head;
    if (this.head) this.head.prev = n;
    this.head = n;
    if (!this.tail) this.tail = n;
  }

  private unlink(n: ListNode<K>): void {
    if (n.prev) n.prev.next = n.next;
    else this.head = n.next;
    if (n.next) n.next.prev = n.prev;
    else this.tail = n.prev;
    n.prev = n.next = null;
  }
}
`,
      },
      {
        path: 'src/cache/lruTtlCache.ts',
        content: `import { Clock } from './clock';
import { ListNode, LruList } from './lruList';

interface Entry<K, V> {
  value: V;
  expiresAt: number;
  node: ListNode<K>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

/**
 * Bounded cache. Entries expire ttlMs after they were WRITTEN (absolute TTL),
 * and the least recently used entry is evicted when full.
 */
export class LruTtlCache<K, V> {
  private map = new Map<K, Entry<K, V>>();
  private order = new LruList<K>();
  readonly stats: CacheStats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };

  constructor(private capacity: number, private ttlMs: number, private clock: Clock) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
  }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.stats.misses++;
      return undefined;
    }
    const now = this.clock.now();
    if (now >= e.expiresAt) {
      this.removeEntry(key, e);
      this.stats.expirations++;
      this.stats.misses++;
      return undefined;
    }
    this.order.moveToFront(e.node);
    e.expiresAt = now + this.ttlMs; // keep hot keys warm
    this.stats.hits++;
    return e.value;
  }

  set(key: K, value: V, ttlMs: number = this.ttlMs): void {
    const now = this.clock.now();
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = now + ttlMs;
      this.order.moveToFront(existing.node);
      return;
    }
    if (this.map.size >= this.capacity) this.evictOne();
    const node = this.order.pushFront(key);
    this.map.set(key, { value, expiresAt: now + ttlMs, node });
  }

  delete(key: K): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.removeEntry(key, e);
    return true;
  }

  /** Read without touching recency or stats. */
  peek(key: K): V | undefined {
    const e = this.map.get(key);
    return e && this.clock.now() < e.expiresAt ? e.value : undefined;
  }

  get size(): number {
    return this.map.size;
  }

  keysByRecency(): K[] {
    return this.order.keys();
  }

  private evictOne(): void {
    const key = this.order.popBack();
    if (key === undefined) return;
    this.map.delete(key);
    this.stats.evictions++;
  }

  private removeEntry(key: K, e: Entry<K, V>): void {
    this.order.remove(e.node);
    this.map.delete(key);
  }
}
`,
      },
      {
        path: 'src/cache/readThrough.ts',
        content: `import { LruTtlCache } from './lruTtlCache';

export type Loader<K, V> = (key: K) => Promise<V>;

/**
 * Read-through cache with request coalescing: concurrent misses for the same
 * key share ONE loader call.
 */
export class ReadThroughCache<K, V> {
  private inflight = new Map<K, Promise<V>>();
  loads = 0;

  constructor(private cache: LruTtlCache<K, V>, private loader: Loader<K, V>) {}

  async get(key: K): Promise<V> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.loads++;
    const p = this.loader(key).then(
      (v) => {
        this.cache.set(key, v);
        this.inflight.delete(key);
        return v;
      },
      (err) => {
        this.inflight.delete(key);
        throw err;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  /** Called after every write to the source of truth. */
  invalidate(key: K): void {
    this.cache.delete(key);
  }
}
`,
      },
      {
        path: 'src/catalog/types.ts',
        content: `export interface Product {
  id: string;
  name: string;
  priceCents: number;
  version: number;
}
`,
      },
      {
        path: 'src/catalog/db.ts',
        content: `import { ticks } from '../util/ticks';
import { Product } from './types';

export class FakeDb {
  private rows = new Map<string, Product>();
  reads = 0;
  writes = 0;

  constructor(private readLatency = 10, private writeLatency = 1) {}

  seed(p: Product): void {
    this.rows.set(p.id, { ...p });
  }

  /** The row is read when the query executes; the response arrives readLatency ticks later. */
  async get(id: string): Promise<Product> {
    this.reads++;
    const row = this.rows.get(id);
    const snapshot = row ? { ...row } : undefined;
    await ticks(this.readLatency);
    if (!snapshot) throw new Error('product ' + id + ' not found');
    return snapshot;
  }

  /** Atomic UPDATE ... SET. Bumps version. */
  async update(id: string, patch: Partial<Omit<Product, 'id' | 'version'>>): Promise<Product> {
    this.writes++;
    await ticks(this.writeLatency);
    const row = this.rows.get(id);
    if (!row) throw new Error('product ' + id + ' not found');
    const next = { ...row, ...patch, version: row.version + 1 };
    this.rows.set(id, next);
    return { ...next };
  }
}
`,
      },
      {
        path: 'src/catalog/productService.ts',
        content: `import { ReadThroughCache } from '../cache/readThrough';
import { FakeDb } from './db';
import { Product } from './types';

export class ProductService {
  constructor(private db: FakeDb, private cache: ReadThroughCache<string, Product>) {}

  getProduct(id: string): Promise<Product> {
    return this.cache.get(id);
  }

  /** Admin UI path: write, then invalidate. */
  async updatePrice(id: string, priceCents: number): Promise<Product> {
    if (!Number.isInteger(priceCents) || priceCents <= 0) throw new Error('invalid price');
    const next = await this.db.update(id, { priceCents });
    this.cache.invalidate(id);
    return next;
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { Clock } from './cache/clock';
import { LruTtlCache } from './cache/lruTtlCache';
import { ReadThroughCache } from './cache/readThrough';
import { FakeDb } from './catalog/db';
import { ProductService } from './catalog/productService';
import { Product } from './catalog/types';

export function buildCatalog(opts: { capacity: number; ttlMs: number; clock: Clock; db: FakeDb }) {
  const lru = new LruTtlCache<string, Product>(opts.capacity, opts.ttlMs, opts.clock);
  const cache = new ReadThroughCache<string, Product>(lru, (id) => opts.db.get(id));
  const service = new ProductService(opts.db, cache);
  return { lru, cache, service };
}
`,
      },
      {
        path: 'src/demo.ts',
        content: `import { buildCatalog } from './app';
import { ManualClock } from './cache/clock';
import { FakeDb } from './catalog/db';

async function main() {
  const clock = new ManualClock(0);
  const db = new FakeDb();
  db.seed({ id: 'p1', name: 'Desk lamp', priceCents: 1000, version: 1 });
  db.seed({ id: 'p2', name: 'Chair', priceCents: 500, version: 1 });
  const { service, lru } = buildCatalog({ capacity: 10, ttlMs: 1000, clock, db });

  // A: the pricing batch job writes the DB directly (no invalidation)
  await service.getProduct('p1');
  await db.update('p1', { priceCents: 1100 });
  clock.advance(600);
  await service.getProduct('p1');
  clock.advance(600);
  const a = await service.getProduct('p1');
  console.log('A', a.priceCents, lru.stats.expirations);

  // B: admin UI update while a shopper's read is in flight
  const reading = service.getProduct('p2');
  const writing = service.updatePrice('p2', 700);
  const [seenByShopper] = await Promise.all([reading, writing]);
  const next = await service.getProduct('p2');
  console.log('B', seenByShopper.priceCents, next.priceCents, db.reads);
}

main();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce both complaints',
        prompt: 'Run the demo in your head. The cache TTL is 1000 ms. What does `src/demo.ts` print?',
        entry: 'src/demo.ts',
        answer: 'A 1000 0\nB 500 500 2',
        options: [
          'A 1000 0\nB 500 500 2',
          'A 1100 1\nB 500 700 3',
          'A 1100 1\nB 500 500 2',
          'A 1000 0\nB 700 700 2',
          'A 1000 0\nB 500 700 3',
        ],
        hints: [
          'A: at t=600 the read is a hit. What does that hit do to `expiresAt`?',
          'B: the shopper\'s DB read takes its snapshot at tick 0 and returns 10 ticks later. The admin update finishes and invalidates after about 2-3 ticks. What does the shopper\'s load do when it finally resolves?',
        ],
        explanation: `**A**: \`get\` at t=600 is a hit and runs \`e.expiresAt = now + ttlMs\`, pushing expiry to 1600. At t=1200 it is still "fresh", so the old 1000 is served and nothing has expired (0). Every hit pushes expiry forward again, so a popular product **never** expires. That is CAT-881.

**B**: the shopper's load snapshots price 500. The admin update applies 700 and calls \`invalidate\`, which deletes nothing because the value is not cached yet. Then the slow load resolves and its \`.then\` calls \`cache.set('p2', 500)\`. The next read is a *hit* on the stale 500, so \`db.reads\` stays at 2. That is CAT-886: invalidation "loses" against an in-flight load.`,
        timeLimitSec: 600,
        focusFile: 'src/demo.ts',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Order the race',
        prompt: 'Put the events of scenario B (CAT-886) in the order they actually happen.',
        items: [
          'Shopper: cache miss, loader starts and FakeDb.get snapshots price 500',
          'ReadThroughCache stores the promise in `inflight`',
          'Admin: FakeDb.update writes price 700',
          'Admin: invalidate(p2) deletes nothing: p2 is not cached yet',
          'Shopper\'s load resolves and `.then` calls cache.set(p2, 500)',
          'Next reader: cache hit, returns the stale 500',
        ],
        hints: ['`invalidate` only touches `this.cache`, never `this.inflight`.', 'Read latency is 10 ticks; write latency is 1.'],
        explanation:
          'This is the classic **read / write / invalidate / stale-fill** race. A read that *started* before the write can *finish* after the invalidation and refill the cache with data from before the write. A delete-based invalidation cannot help, because there is nothing to delete yet. You need to tell the slow load "your result is outdated, don\'t store it", usually with a per-key generation (version) counter, and to stop later readers from joining the outdated in-flight promise.',
        timeLimitSec: 360,
        focusFile: 'src/cache/readThrough.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Why does a 60 s TTL last for hours?',
        prompt: 'Click the line responsible for CAT-881 (popular products never refresh), then pick the root cause.',
        file: 'src/cache/lruTtlCache.ts',
        lines: [44],
        options: [
          '`get` slides the expiry forward on every hit, turning the documented absolute TTL into an idle timeout that hot keys never reach',
          '`now >= e.expiresAt` should be `now > e.expiresAt`',
          '`moveToFront` on a hit should not happen in an LRU cache',
          '`set` on an existing key should keep the old `expiresAt`',
        ],
        correct: 0,
        hints: ['The class comment says entries expire ttlMs after they were **written**.'],
        explanation:
          'Line 44 (`e.expiresAt = now + this.ttlMs`) is a sliding expiration. That is a valid policy for *session* caches, but here it breaks the absolute-TTL contract: a product read more than once per TTL window keeps its entry forever, so writes that bypass invalidation (the batch job) are never picked up. Recency (LRU) and freshness (TTL) are separate concerns. A hit should update recency only. The boundary `>=` is correct (an entry is dead *at* expiresAt), and refreshing TTL on `set` is correct because a set is a write.',
        timeLimitSec: 300,
        focusFile: 'src/cache/lruTtlCache.ts',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix both stale-read bugs',
        prompt: `There are **two bugs**: fix CAT-881 and CAT-886.

Requirements checked by hidden tests:
- TTL is absolute from the last **write** (\`set\`). Hits update recency only. LRU order and stats must keep working.
- After \`invalidate(key)\` returns, no load that **started before** the invalidation may put its value in the cache, and **new** readers must not join that old in-flight load.
- Readers that arrive after an invalidation must still be coalesced onto **one** fresh load, even if the old load finishes while the new one is running.
- A failed load is not cached and does not block later retries.`,
        editable: ['src/cache/lruTtlCache.ts', 'src/cache/readThrough.ts'],
        tests: [
          {
            path: 'tests/cache.test.ts',
            content: `import { ManualClock } from '../src/cache/clock';
import { LruTtlCache } from '../src/cache/lruTtlCache';
import { ReadThroughCache } from '../src/cache/readThrough';
import { FakeDb } from '../src/catalog/db';
import { buildCatalog } from '../src/app';
import { ticks } from '../src/util/ticks';

function seeded() {
  const clock = new ManualClock(0);
  const db = new FakeDb();
  db.seed({ id: 'p1', name: 'Lamp', priceCents: 1000, version: 1 });
  db.seed({ id: 'p2', name: 'Chair', priceCents: 500, version: 1 });
  return { clock, db, ...buildCatalog({ capacity: 10, ttlMs: 1000, clock, db }) };
}

test('TTL is absolute from write even for hot keys', () => {
  const clock = new ManualClock(0);
  const c = new LruTtlCache<string, number>(5, 1000, clock);
  c.set('a', 1);
  for (let t = 0; t < 999; t += 111) {
    clock.advance(111);
    expect(c.get('a')).toBe(1);
  }
  clock.advance(1000 - clock.now());
  expect(c.get('a')).toBeUndefined();
  expect(c.stats.expirations).toBe(1);
});

test('set refreshes TTL and value', () => {
  const clock = new ManualClock(0);
  const c = new LruTtlCache<string, number>(5, 1000, clock);
  c.set('a', 1);
  clock.advance(800);
  c.set('a', 2);
  clock.advance(800);
  expect(c.get('a')).toBe(2);
  clock.advance(200);
  expect(c.get('a')).toBeUndefined();
});

test('LRU eviction still follows recency', () => {
  const clock = new ManualClock(0);
  const c = new LruTtlCache<string, number>(2, 1000, clock);
  c.set('a', 1);
  c.set('b', 2);
  expect(c.get('a')).toBe(1);
  c.set('c', 3);
  expect(c.get('b')).toBeUndefined();
  expect(c.keysByRecency()).toEqual(['c', 'a']);
  expect(c.stats).toEqual({ hits: 1, misses: 1, evictions: 1, expirations: 0 });
});

test('batch-job writes become visible after TTL on a hot product', async () => {
  const { clock, db, service } = seeded();
  await service.getProduct('p1');
  await db.update('p1', { priceCents: 1100 });
  for (let i = 0; i < 5; i++) {
    clock.advance(300);
    await service.getProduct('p1');
  }
  expect((await service.getProduct('p1')).priceCents).toBe(1100);
});

test('invalidation beats an in-flight load', async () => {
  const { db, service, cache } = seeded();
  const reading = service.getProduct('p2');
  await service.updatePrice('p2', 700);
  await reading;
  expect((await service.getProduct('p2')).priceCents).toBe(700);
  expect(cache.loads).toBe(2);
  expect((await service.getProduct('p2')).priceCents).toBe(700);
  expect(db.reads).toBe(2);
});

test('readers arriving after invalidation do not join the stale load', async () => {
  const { service } = seeded();
  const r1 = service.getProduct('p2');
  await service.updatePrice('p2', 700);
  const r2 = service.getProduct('p2');
  expect((await r2).priceCents).toBe(700);
  await r1;
});

test('post-invalidation readers share one fresh load even when the old load lands mid-way', async () => {
  const { db, service, cache } = seeded();
  const r1 = service.getProduct('p2');
  await service.updatePrice('p2', 700);
  const r2 = service.getProduct('p2');
  await r1;
  const r3 = service.getProduct('p2');
  const [a, b] = await Promise.all([r2, r3]);
  expect([a.priceCents, b.priceCents]).toEqual([700, 700]);
  expect(cache.loads).toBe(2);
  expect(db.reads).toBe(2);
});

test('concurrent misses are still coalesced', async () => {
  const { db, service } = seeded();
  const all = await Promise.all([service.getProduct('p1'), service.getProduct('p1'), service.getProduct('p1')]);
  expect(all.map((p) => p.priceCents)).toEqual([1000, 1000, 1000]);
  expect(db.reads).toBe(1);
});

test('failed loads are not cached and can be retried', async () => {
  const clock = new ManualClock(0);
  const lru = new LruTtlCache<string, number>(5, 1000, clock);
  let calls = 0;
  const rt = new ReadThroughCache<string, number>(lru, async () => {
    calls++;
    await ticks(2);
    if (calls === 1) throw new Error('db down');
    return 42;
  });
  await expect(rt.get('k')).rejects.toThrow('db down');
  expect(await rt.get('k')).toBe(42);
  expect(await rt.get('k')).toBe(42);
  expect(calls).toBe(2);
});
`,
          },
        ],
        solution: {
          'src/cache/lruTtlCache.ts': `import { Clock } from './clock';
import { ListNode, LruList } from './lruList';

interface Entry<K, V> {
  value: V;
  expiresAt: number;
  node: ListNode<K>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

/**
 * Bounded cache. Entries expire ttlMs after they were WRITTEN (absolute TTL),
 * and the least recently used entry is evicted when full.
 */
export class LruTtlCache<K, V> {
  private map = new Map<K, Entry<K, V>>();
  private order = new LruList<K>();
  readonly stats: CacheStats = { hits: 0, misses: 0, evictions: 0, expirations: 0 };

  constructor(private capacity: number, private ttlMs: number, private clock: Clock) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
  }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.stats.misses++;
      return undefined;
    }
    const now = this.clock.now();
    if (now >= e.expiresAt) {
      this.removeEntry(key, e);
      this.stats.expirations++;
      this.stats.misses++;
      return undefined;
    }
    this.order.moveToFront(e.node);
    this.stats.hits++;
    return e.value;
  }

  set(key: K, value: V, ttlMs: number = this.ttlMs): void {
    const now = this.clock.now();
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = now + ttlMs;
      this.order.moveToFront(existing.node);
      return;
    }
    if (this.map.size >= this.capacity) this.evictOne();
    const node = this.order.pushFront(key);
    this.map.set(key, { value, expiresAt: now + ttlMs, node });
  }

  delete(key: K): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.removeEntry(key, e);
    return true;
  }

  /** Read without touching recency or stats. */
  peek(key: K): V | undefined {
    const e = this.map.get(key);
    return e && this.clock.now() < e.expiresAt ? e.value : undefined;
  }

  get size(): number {
    return this.map.size;
  }

  keysByRecency(): K[] {
    return this.order.keys();
  }

  private evictOne(): void {
    const key = this.order.popBack();
    if (key === undefined) return;
    this.map.delete(key);
    this.stats.evictions++;
  }

  private removeEntry(key: K, e: Entry<K, V>): void {
    this.order.remove(e.node);
    this.map.delete(key);
  }
}
`,
          'src/cache/readThrough.ts': `import { LruTtlCache } from './lruTtlCache';

export type Loader<K, V> = (key: K) => Promise<V>;

/**
 * Read-through cache with request coalescing: concurrent misses for the same
 * key share ONE loader call. A per-key generation counter makes sure a load that
 * started before an invalidation can never fill the cache afterwards.
 */
export class ReadThroughCache<K, V> {
  private inflight = new Map<K, Promise<V>>();
  private generation = new Map<K, number>();
  loads = 0;

  constructor(private cache: LruTtlCache<K, V>, private loader: Loader<K, V>) {}

  async get(key: K): Promise<V> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    this.loads++;
    const gen = this.generation.get(key) ?? 0;
    const p: Promise<V> = this.loader(key).then(
      (v) => {
        if ((this.generation.get(key) ?? 0) === gen) this.cache.set(key, v);
        if (this.inflight.get(key) === p) this.inflight.delete(key);
        return v;
      },
      (err) => {
        if (this.inflight.get(key) === p) this.inflight.delete(key);
        throw err;
      },
    );
    this.inflight.set(key, p);
    return p;
  }

  /** Called after every write to the source of truth. */
  invalidate(key: K): void {
    this.generation.set(key, (this.generation.get(key) ?? 0) + 1);
    this.inflight.delete(key);
    this.cache.delete(key);
  }
}
`,
        },
        hints: [
          'Bug 1 is one line in `lruTtlCache.ts`: a hit should not change `expiresAt`.',
          'Bug 2: give each key a generation number. Capture it when a load starts, bump it in `invalidate`, and only `cache.set` if it has not changed. Also drop the key from `inflight` in `invalidate`.',
          'An old load that finishes late must not `inflight.delete(key)` a *newer* load\'s promise. Only delete if `inflight.get(key) === p`.',
        ],
        explanation: `**Bug 1 (lruTtlCache.ts)**: delete the \`expiresAt\` refresh in \`get\`. Freshness is set by writes, recency by reads.

**Bug 2 (readThrough.ts)**: \`invalidate\` must defeat loads that are already running:
1. \`generation\` per key, bumped on invalidate and captured when a load starts. A load whose generation is out of date still returns its value to the caller that asked for it (it was true when that request began) but does **not** store it.
2. \`inflight.delete(key)\` in \`invalidate\`, so new readers start a fresh load instead of joining the stale one.
3. The completion handler only removes its **own** promise (\`inflight.get(key) === p\`). Otherwise the old load, landing while the new one runs, would remove the new promise and break coalescing, causing a third DB read.

This is the same idea as the version check in optimistic concurrency, or "lease" tokens in memcache: a write must win against older reads that finish late.`,
        timeLimitSec: 1500,
        focusFile: 'src/cache/readThrough.ts',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'The agent\'s one-line fix for CAT-886',
        prompt: 'An agent opened this PR for CAT-886 only. Review it.',
        persona: 'agent-mode',
        request: 'Fix CAT-886: admin price changes sometimes do not show up.',
        aiReply: `Root cause: \`invalidate\` leaves the in-flight promise behind, so readers keep getting the old value. Fixed:

\`\`\`diff
   invalidate(key: K): void {
     this.cache.delete(key);
+    this.inflight.delete(key);
   }
\`\`\`

I ran the existing test suite: all green ✅. I also updated 3 snapshot files.`,
        options: [
          'Accept: new readers now start a fresh load, so the stale value can never be served',
          'Reject: the old load\'s `.then` still runs `cache.set(key, staleValue)` when it lands, so the stale price is cached for a full TTL anyway',
          'Reject: deleting from a Map while a promise holds a reference to it throws',
          'Reject: it should call `this.cache.set(key, undefined)` instead of delete',
        ],
        correct: 1,
        hints: ['Deleting the promise from the map does not cancel it. What does its `.then` do when it resolves?'],
        explanation:
          'Removing the promise from `inflight` helps readers that arrive *while* the old load is running. But the old load is not cancelled: when it lands, its callback does `cache.set(key, v)` with the value read before the write, and stale data is cached again for a full TTL. Also, its `this.inflight.delete(key)` can remove a *newer* load\'s promise. "Existing tests pass" proves little here because none of them covered the race, and updating snapshot files nobody asked about is a red flag in an agent PR. You need a generation check at fill time.',
        timeLimitSec: 300,
        focusFile: 'src/cache/readThrough.ts',
      },
    ],
  },
  // ───────────────────────────── 4. Payment retries double charge (Python) ─────────────────────────────
  {
    id: 'l4-a-py-payment-idempotency',
    title: 'Charged Twice for One Coffee Machine',
    level: 4,
    rating: 2200,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'amazon', 'atlassian', 'jpmorgan'],
    tags: ['idempotency', 'retries', 'webhooks', 'at-least-once', 'two-bugs'],
    summary: 'A PSP timeout plus a well-meaning retry equals a second charge. And the ledger counts some charges three times.',
    context: `You are on the **payments** team. Since the payment service provider (PSP) had a bad night with slow responses, support has two kinds of tickets:

- **PAY-301**: "My card shows **two** charges for one order." The PSP dashboard agrees: two real charges.
- **PAY-305**: finance says our internal ledger is *higher* than the PSP's own settlement report, even for orders the PSP charged only once.

The PSP is at-least-once for webhooks and supports idempotency keys: a repeated \`create_charge\` with the same key returns the original charge instead of creating a new one. \`psp/fake_psp.py\` simulates it exactly, including scripted faults.`,
    persona: 'lazy-copier',
    files: [
      {
        path: 'psp/__init__.py',
        content: ``,
      },
      {
        path: 'psp/errors.py',
        content: `class PspError(Exception):
    """Base class for everything the PSP client can raise."""


class Timeout(PspError):
    """No response in time. The charge may or may not have been created."""


class Declined(PspError):
    """The card was declined. Retrying will not help."""


class IdempotencyMismatch(PspError):
    """Same idempotency key reused with different parameters."""
`,
      },
      {
        path: 'psp/fake_psp.py',
        content: `from psp.errors import Declined, IdempotencyMismatch, Timeout


class FakePsp:
    """Deterministic stand-in for the real PSP.

    faults: one entry is consumed per create_charge call:
      "ok"                     normal
      "timeout_before_commit"  request lost on the way in: nothing happens, Timeout raised
      "timeout_after_commit"   charge IS created, but the response is lost: Timeout raised
      "decline"                card declined
    """

    def __init__(self, faults=None):
        self.faults = list(faults or [])
        self.charges = {}
        self.by_key = {}
        self.events = []
        self.calls = 0
        self._n = 0

    def create_charge(self, amount, currency, source, idempotency_key=None, metadata=None):
        self.calls += 1
        fault = self.faults.pop(0) if self.faults else "ok"
        if fault == "timeout_before_commit":
            raise Timeout("read timeout")
        if idempotency_key is not None and idempotency_key in self.by_key:
            ch = self.charges[self.by_key[idempotency_key]]
            if (ch["amount"], ch["currency"], ch["source"]) != (amount, currency, source):
                raise IdempotencyMismatch(idempotency_key)
            result = dict(ch)
        else:
            if fault == "decline":
                raise Declined("card declined")
            self._n += 1
            ch = {
                "id": "ch_%03d" % self._n,
                "amount": amount,
                "currency": currency,
                "source": source,
                "metadata": dict(metadata or {}),
            }
            self.charges[ch["id"]] = ch
            if idempotency_key is not None:
                self.by_key[idempotency_key] = ch["id"]
            self.events.append({"id": "evt_%03d" % self._n, "type": "charge.succeeded", "data": dict(ch)})
            result = dict(ch)
        if fault == "timeout_after_commit":
            raise Timeout("read timeout")
        return result
`,
      },
      {
        path: 'payments/__init__.py',
        content: ``,
      },
      {
        path: 'payments/keys.py',
        content: `class KeyFactory:
    """Idempotency keys for outgoing PSP requests."""

    def __init__(self, prefix="key"):
        self.prefix = prefix
        self._n = 0

    def new_key(self):
        """A fresh, never-before-used key."""
        self._n += 1
        return "%s-%04d" % (self.prefix, self._n)

    @staticmethod
    def for_order(order):
        """Stable key for the order's current payment attempt. The attempt number
        only changes when the customer switches payment method."""
        return "order-%s-%d" % (order.id, order.payment_attempt)
`,
      },
      {
        path: 'payments/retry.py',
        content: `from psp.errors import Timeout


class RetryPolicy:
    def __init__(self, max_attempts=3, base_delay_ms=100, sleep=None):
        self.max_attempts = max_attempts
        self.base_delay_ms = base_delay_ms
        self.retry_on = (Timeout,)
        self.delays = []
        self._sleep = sleep or (lambda ms: None)

    def backoff(self, attempt):
        """Exponential backoff after a failed attempt (1-based)."""
        if attempt >= self.max_attempts:
            return
        delay = self.base_delay_ms * (2 ** (attempt - 1))
        self.delays.append(delay)
        self._sleep(delay)
`,
      },
      {
        path: 'payments/gateway_client.py',
        content: `class GatewayClient:
    """Talks to the PSP. Retries transient failures according to the policy."""

    def __init__(self, psp, policy, keys):
        self.psp = psp
        self.policy = policy
        self.keys = keys

    def charge(self, order):
        last_error = None
        for attempt in range(1, self.policy.max_attempts + 1):
            key = self.keys.new_key()
            try:
                return self.psp.create_charge(
                    order.amount_cents,
                    order.currency,
                    order.source,
                    idempotency_key=key,
                    metadata={"order_id": order.id},
                )
            except self.policy.retry_on as e:
                last_error = e
                self.policy.backoff(attempt)
        raise last_error
`,
      },
      {
        path: 'payments/ledger.py',
        content: `class Ledger:
    """Internal record of money received. Fed ONLY by PSP webhooks."""

    def __init__(self):
        self.entries = []

    def record_payment(self, order_id, charge_id, amount_cents):
        self.entries.append({"order_id": order_id, "charge_id": charge_id, "amount": amount_cents})

    def total_for(self, order_id):
        return sum(e["amount"] for e in self.entries if e["order_id"] == order_id)
`,
      },
      {
        path: 'orders/__init__.py',
        content: ``,
      },
      {
        path: 'orders/model.py',
        content: `from dataclasses import dataclass
from typing import Optional


@dataclass
class Order:
    id: str
    amount_cents: int
    currency: str
    source: str
    status: str = "pending"
    payment_attempt: int = 0
    charge_id: Optional[str] = None


class OrderRepo:
    def __init__(self):
        self._rows = {}

    def create(self, order_id, amount_cents, currency, source):
        if order_id in self._rows:
            raise ValueError("duplicate order " + order_id)
        o = Order(order_id, amount_cents, currency, source)
        self._rows[order_id] = o
        return o

    def get(self, order_id):
        return self._rows[order_id]
`,
      },
      {
        path: 'orders/checkout.py',
        content: `from dataclasses import dataclass
from typing import Optional

from psp.errors import Declined, PspError


@dataclass
class PaymentResult:
    status: str
    charge_id: Optional[str] = None
    error: Optional[str] = None


class CheckoutService:
    def __init__(self, orders, gateway):
        self.orders = orders
        self.gateway = gateway

    def pay(self, order_id):
        """Safe to call again: the mobile app re-calls it after a 5xx."""
        order = self.orders.get(order_id)
        if order.status == "paid":
            return PaymentResult("paid", order.charge_id)
        try:
            charge = self.gateway.charge(order)
        except Declined as e:
            order.status = "declined"
            return PaymentResult("declined", error=str(e))
        except PspError as e:
            order.status = "payment_failed"
            return PaymentResult("payment_failed", error=type(e).__name__)
        order.status = "paid"
        order.charge_id = charge["id"]
        return PaymentResult("paid", charge["id"])

    def change_source(self, order_id, source):
        order = self.orders.get(order_id)
        if order.status == "paid":
            raise ValueError("order already paid")
        order.source = source
        order.payment_attempt += 1
        order.status = "pending"
`,
      },
      {
        path: 'webhooks/__init__.py',
        content: ``,
      },
      {
        path: 'webhooks/handler.py',
        content: `class WebhookHandler:
    """Applies PSP events to the ledger. The PSP delivers at-least-once, so
    events are de-duplicated by event id."""

    def __init__(self, ledger, processed=None):
        self.ledger = ledger
        self.processed = processed if processed is not None else set()

    def handle(self, event):
        if event["id"] in self.processed:
            return "duplicate"
        if event["type"] == "charge.succeeded":
            ch = event["data"]
            order_id = ch["metadata"].get("order_id", "unknown")
            self.ledger.record_payment(order_id, ch["id"], ch["amount"])
        self.processed.add(event["id"])
        return "ok"
`,
      },
      {
        path: 'webhooks/router.py',
        content: `from webhooks.handler import WebhookHandler


class Router:
    def __init__(self, ledger):
        self.ledger = ledger

    def route(self, path, body):
        if path == "/webhooks/psp":
            return WebhookHandler(self.ledger).handle(body)
        return "404"
`,
      },
      {
        path: 'app.py',
        content: `from orders.checkout import CheckoutService
from orders.model import OrderRepo
from payments.gateway_client import GatewayClient
from payments.keys import KeyFactory
from payments.ledger import Ledger
from payments.retry import RetryPolicy
from psp.fake_psp import FakePsp
from webhooks.router import Router


class App:
    def __init__(self, faults=None, max_attempts=3):
        self.psp = FakePsp(faults)
        self.orders = OrderRepo()
        self.ledger = Ledger()
        self.policy = RetryPolicy(max_attempts=max_attempts)
        self.gateway = GatewayClient(self.psp, self.policy, KeyFactory())
        self.checkout = CheckoutService(self.orders, self.gateway)
        self.router = Router(self.ledger)

    def deliver_webhooks(self):
        for ev in list(self.psp.events):
            self.router.route("/webhooks/psp", ev)
`,
      },
      {
        path: 'main.py',
        content: `from app import App

app = App(faults=["timeout_after_commit", "ok"])
app.orders.create("o1", 2599, "usd", "card_visa")
res = app.checkout.pay("o1")
print(res.status, res.charge_id)

app.deliver_webhooks()
app.router.route("/webhooks/psp", app.psp.events[0])  # PSP redelivers the first event
print(app.psp.calls, len(app.psp.charges), app.ledger.total_for("o1"))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce PAY-301 and PAY-305',
        prompt: 'The PSP times out once (after committing) and then behaves. Webhooks are delivered and the first one is delivered again. What does `main.py` print?',
        entry: 'main.py',
        answer: 'paid ch_002\n2 2 7797',
        options: ['paid ch_002\n2 2 7797', 'paid ch_001\n2 1 2599', 'paid ch_002\n2 2 5198', 'paid ch_001\n2 1 5198', 'payment_failed None\n1 1 2599'],
        hints: [
          'What key does attempt 2 send? Is it the key the PSP stored for ch_001?',
          'How long does a `WebhookHandler` (and its `processed` set) live?',
        ],
        explanation: `Attempt 1 sends \`key-0001\`. The PSP creates **ch_001** (with \`metadata.order_id = o1\`) and then the response is lost (Timeout). The retry sends \`key-0002\`, which the PSP has never seen, so it creates **ch_002**. The customer is charged twice (PAY-301), and the order points at ch_002.

Webhooks: evt_001 and evt_002 each record 2599 for o1 (5198). Then the PSP redelivers evt_001. \`Router.route\` builds a **new** \`WebhookHandler\` per request, so its \`processed\` set is always empty and the duplicate is recorded again: **7797** (PAY-305). \`psp.calls\` = 2, \`len(charges)\` = 2.

After both fixes this prints \`paid ch_001\` and \`2 1 2599\`.`,
        timeLimitSec: 540,
        focusFile: 'main.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Why does the duplicate check never fire?',
        prompt: '`WebhookHandler` clearly de-duplicates by event id, yet redelivered events are booked again. Click the line responsible and pick the root cause.',
        file: 'webhooks/router.py',
        lines: [10],
        options: [
          'A new WebhookHandler (with a new, empty `processed` set) is created for every request, so the de-dup state never outlives one event',
          '`event["id"]` should be `event["data"]["id"]`: events must be de-duplicated by charge id',
          '`processed.add` runs after the ledger write, so a crash in between double-books the event',
          'The router compares paths with `==` instead of `startswith`',
        ],
        correct: 0,
        hints: ['Where is `processed` created, and how many times?'],
        explanation:
          'The handler code is right. Its *lifetime* is wrong. `processed if processed is not None else set()` gives every new instance a fresh set, and the router creates one instance per request. De-dup state must live as long as the redelivery window: one shared handler or set in the app wiring (in production, a DB table with a unique constraint on event id). Option 3 describes a real but separate crash-safety concern and is not what happens here. Bugs like this survive review because each file looks correct on its own; the bug is in how they are wired together.',
        timeLimitSec: 300,
        focusFile: 'webhooks/router.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix PAY-301 and PAY-305',
        prompt: `There are **two bugs**. Fix both so that:

- Retries of the same payment, both inside \`GatewayClient.charge\` and when the app calls \`checkout.pay\` again after a \`payment_failed\`, can never create a second PSP charge.
- A customer who switches payment method (\`change_source\`) after a decline can still be charged with the new card.
- Different orders are never de-duplicated against each other.
- A redelivered webhook is booked in the ledger exactly once, however many requests the router serves.`,
        editable: ['payments/gateway_client.py', 'payments/keys.py', 'webhooks/router.py', 'webhooks/handler.py', 'app.py'],
        tests: [
          {
            path: 'tests/test_payments_hidden.py',
            content: `from app import App


def test_timeout_after_commit_is_not_charged_twice():
    app = App(faults=["timeout_after_commit", "ok"])
    app.orders.create("o1", 2599, "usd", "card_visa")
    res = app.checkout.pay("o1")
    assert (res.status, res.charge_id) == ("paid", "ch_001")
    assert len(app.psp.charges) == 1
    assert app.psp.calls == 2


def test_exhausted_retries_then_app_retry_reuses_charge():
    app = App(faults=["timeout_after_commit", "timeout_after_commit", "timeout_after_commit"])
    app.orders.create("o1", 1000, "usd", "card_visa")
    first = app.checkout.pay("o1")
    assert first.status == "payment_failed"
    assert len(app.psp.charges) == 1
    second = app.checkout.pay("o1")
    assert (second.status, second.charge_id) == ("paid", "ch_001")
    assert len(app.psp.charges) == 1


def test_timeout_before_commit_still_retries():
    app = App(faults=["timeout_before_commit", "ok"])
    app.orders.create("o1", 500, "usd", "card_visa")
    assert app.checkout.pay("o1").status == "paid"
    assert len(app.psp.charges) == 1
    assert app.policy.delays == [100]


def test_new_card_after_decline_can_be_charged():
    app = App(faults=["decline"])
    app.orders.create("o1", 700, "usd", "card_bad")
    assert app.checkout.pay("o1").status == "declined"
    app.checkout.change_source("o1", "card_good")
    res = app.checkout.pay("o1")
    assert (res.status, res.charge_id) == ("paid", "ch_001")
    assert app.psp.charges["ch_001"]["source"] == "card_good"


def test_different_orders_get_different_charges():
    app = App()
    app.orders.create("o1", 100, "usd", "card_visa")
    app.orders.create("o2", 100, "usd", "card_visa")
    assert app.checkout.pay("o1").charge_id == "ch_001"
    assert app.checkout.pay("o2").charge_id == "ch_002"


def test_webhook_redelivery_booked_once():
    app = App()
    app.orders.create("o1", 2599, "usd", "card_visa")
    app.orders.create("o2", 100, "usd", "card_visa")
    app.checkout.pay("o1")
    app.checkout.pay("o2")
    app.deliver_webhooks()
    app.deliver_webhooks()
    assert app.router.route("/webhooks/psp", app.psp.events[0]) == "duplicate"
    assert app.ledger.total_for("o1") == 2599
    assert app.ledger.total_for("o2") == 100
    assert len(app.ledger.entries) == 2


def test_full_incident_replay():
    app = App(faults=["timeout_after_commit", "ok"])
    app.orders.create("o1", 2599, "usd", "card_visa")
    app.checkout.pay("o1")
    app.deliver_webhooks()
    app.router.route("/webhooks/psp", app.psp.events[0])
    assert app.ledger.total_for("o1") == 2599
`,
          },
        ],
        solution: {
          'payments/gateway_client.py': `class GatewayClient:
    """Talks to the PSP. Retries transient failures according to the policy."""

    def __init__(self, psp, policy, keys):
        self.psp = psp
        self.policy = policy
        self.keys = keys

    def charge(self, order):
        # One key per logical payment, reused by every retry (and by later
        # pay() calls for the same attempt) so the PSP can de-duplicate.
        key = self.keys.for_order(order)
        last_error = None
        for attempt in range(1, self.policy.max_attempts + 1):
            try:
                return self.psp.create_charge(
                    order.amount_cents,
                    order.currency,
                    order.source,
                    idempotency_key=key,
                    metadata={"order_id": order.id},
                )
            except self.policy.retry_on as e:
                last_error = e
                self.policy.backoff(attempt)
        raise last_error
`,
          'webhooks/router.py': `from webhooks.handler import WebhookHandler


class Router:
    def __init__(self, ledger):
        self.ledger = ledger
        # one handler for the router's lifetime: its processed-set must outlive a request
        self.psp_handler = WebhookHandler(ledger)

    def route(self, path, body):
        if path == "/webhooks/psp":
            return self.psp_handler.handle(body)
        return "404"
`,
        },
        hints: [
          'Bug 1 is in `GatewayClient.charge`: which key method in `payments/keys.py` gives the same key every time for the same payment?',
          'The key must survive a *second* `pay()` call too, so a random key created once per `charge()` call is not enough.',
          'Bug 2: make the `processed` set live as long as the router (or the app), not one request.',
        ],
        explanation: `**Bug 1 (PAY-301)**: an idempotency key only works if every retry of the *same* logical operation sends the *same* key. \`new_key()\` per attempt defeats the PSP's de-dup. \`KeyFactory.for_order(order)\` is derived from (order id, payment attempt). It is stable across in-process retries **and** across later \`pay()\` calls, and it changes when the customer switches card, so the new card is not rejected as an \`IdempotencyMismatch\`.

**Bug 2 (PAY-305)**: de-dup state was scoped to a single request. Keep one handler (or one shared \`processed\` set) for the router's lifetime. In production this would be a DB table with a unique constraint on event id, written in the same transaction as the ledger row.

Lesson: with at-least-once delivery and ambiguous timeouts, **every** money-moving hop needs its own idempotency: client to PSP (keys), and PSP to us (event ids).`,
        timeLimitSec: 1200,
        focusFile: 'payments/gateway_client.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review a quick fix for PAY-301',
        prompt: 'Before your fix landed, a teammate pasted this suggestion into the PR. Review it.',
        persona: 'lazy-copier',
        request: 'Retries create duplicate charges. Fix GatewayClient.charge.',
        aiReply: `Generate the key once, outside the loop:

\`\`\`python
import uuid

def charge(self, order):
    key = str(uuid.uuid4())
    for attempt in range(1, self.policy.max_attempts + 1):
        try:
            return self.psp.create_charge(order.amount_cents, order.currency,
                                          order.source, idempotency_key=key)
        except self.policy.retry_on:
            self.policy.backoff(attempt)
\`\`\`

Now all retries share one key, so the PSP de-duplicates them. Done!`,
        options: [
          'Accept: every attempt now shares a key, which fixes PAY-301',
          'Reject: the key is still new on every `charge()` call, so when `pay()` is called again after `payment_failed` the PSP creates a second charge. It also drops the order metadata and returns None instead of raising when retries run out',
          'Reject: `uuid4` keys are too long for the PSP',
          'Reject: idempotency keys must be generated by the PSP, not the client',
        ],
        correct: 1,
        hints: ['The mobile app calls `checkout.pay` again after a 5xx. Which key does that second call send?', 'What does the function return after the last failed attempt?'],
        explanation:
          'Moving the key outside the loop fixes retries *inside one call* but not the next level up: `pay()` after `payment_failed` (3 lost responses) calls `charge()` again, gets a brand-new uuid, and charges the card again. The key must come from the business identity of the payment (`for_order`). The "lazy copy" also lost two things: `raise last_error` (the function now falls off the end and returns `None`, which crashes in `pay` on `charge["id"]` with a TypeError instead of a clean `payment_failed`), and the `metadata` the webhook handler needs for `order_id`.',
        timeLimitSec: 360,
        focusFile: 'payments/gateway_client.py',
      },
    ],
  },
  // ───────────────────────────── 5. Async job queue: missing await (JS) ─────────────────────────────
  {
    id: 'l4-a-js-job-queue-await',
    title: 'Every Job Succeeds (Allegedly)',
    level: 4,
    rating: 2150,
    lang: 'javascript',
    domain: 'concurrency',
    companies: ['atlassian', 'canva', 'meta', 'google'],
    tags: ['async-await', 'promises', 'unhandled-rejection', 'job-queue', 'two-bugs'],
    summary: 'The dashboard says 100% success, customers say emails never arrive, and the process occasionally logs an unhandled rejection.',
    context: `You are on the **platform** team that owns the in-process background job queue used for emails and image resizing.

The success-rate dashboard has said **100%** for weeks, which is suspicious. Customers report missing emails. The logs show occasional \`UnhandledPromiseRejection\` warnings, and the release script (which calls \`queue.drain()\` before shutdown) sometimes cuts off jobs that were still running.

All latency is simulated with \`ticks(n)\` (microtask yields), so every run is deterministic.`,
    persona: 'tunnel-vision',
    files: [
      {
        path: 'src/util/ticks.js',
        content: `/** Simulated latency: yield to the microtask queue n times. Deterministic. */
export async function ticks(n) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
`,
      },
      {
        path: 'src/queue/jobStore.js',
        content: `/**
 * Job records. get() returns the stored record itself (not a copy).
 * Status: queued -> running -> (done | retrying -> running ... | failed)
 */
export class JobStore {
  constructor() {
    this.jobs = new Map();
    this.n = 0;
    this.transitions = [];
  }

  create(type, payload) {
    const job = { id: 'job-' + ++this.n, type, payload, status: 'queued', attempts: 0, result: undefined, error: undefined };
    this.jobs.set(job.id, job);
    this.log(job.id, 'queued');
    return job;
  }

  get(id) {
    const j = this.jobs.get(id);
    if (!j) throw new Error('no such job ' + id);
    return j;
  }

  markRunning(id) {
    const j = this.get(id);
    j.attempts += 1;
    j.status = 'running';
    this.log(id, 'running');
  }

  markDone(id, result) {
    const j = this.get(id);
    j.status = 'done';
    j.result = result;
    this.log(id, 'done');
  }

  markRetry(id, message) {
    const j = this.get(id);
    j.status = 'retrying';
    j.error = message;
    this.log(id, 'retrying');
  }

  markFailed(id, message) {
    const j = this.get(id);
    j.status = 'failed';
    j.error = message;
    this.log(id, 'failed');
  }

  log(id, status) {
    this.transitions.push(id + ':' + status);
  }
}
`,
      },
      {
        path: 'src/queue/registry.js',
        content: `export class UnknownJobType extends Error {}

export class HandlerRegistry {
  constructor() {
    this.handlers = new Map();
  }

  /** handler: async (payload, ctx) => result */
  register(type, handler) {
    if (this.handlers.has(type)) throw new Error('duplicate handler ' + type);
    this.handlers.set(type, handler);
  }

  get(type) {
    const h = this.handlers.get(type);
    if (!h) throw new UnknownJobType(type);
    return h;
  }
}
`,
      },
      {
        path: 'src/queue/backoff.js',
        content: `/** Ticks to wait before retrying after the given (1-based) failed attempt. */
export function backoffTicks(attempt) {
  return Math.min(2 ** attempt, 32);
}
`,
      },
      {
        path: 'src/queue/jobQueue.js',
        content: `import { EventEmitter } from 'events';
import { backoffTicks } from './backoff';
import { ticks } from '../util/ticks';

export class JobQueue extends EventEmitter {
  constructor({ store, registry, concurrency = 2, maxAttempts = 3 }) {
    super();
    this.store = store;
    this.registry = registry;
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.pending = [];
    this.active = 0;
    this.drainWaiters = [];
  }

  enqueue(type, payload) {
    this.registry.get(type); // fail fast on unknown types
    const job = this.store.create(type, payload);
    this.pending.push(job.id);
    this.pump();
    return job.id;
  }

  pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      this.active++;
      this.run(id).finally(() => {
        this.active--;
        this.pump();
        this.checkDrained();
      });
    }
  }

  async run(id) {
    const job = this.store.get(id);
    const handler = this.registry.get(job.type);
    this.store.markRunning(id);
    try {
      const result = handler(job.payload, { attempt: job.attempts });
      this.store.markDone(id, result);
      this.emit('done', id, result);
    } catch (err) {
      if (job.attempts < this.maxAttempts) {
        this.store.markRetry(id, err.message);
        await ticks(backoffTicks(job.attempts));
        this.pending.push(id);
      } else {
        this.store.markFailed(id, err.message);
        this.emit('failed', id, err);
      }
    }
  }

  /** Resolves once every enqueued job has finished (done or failed). */
  drain() {
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
      this.checkDrained();
    });
  }

  checkDrained() {
    if (this.pending.length === 0) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
`,
      },
      {
        path: 'src/jobs/mailer.js',
        content: `import { ticks } from '../util/ticks';

export class FakeMailer {
  constructor() {
    this.sent = [];
  }

  async send(to, subject) {
    await ticks(3);
    if (!to.includes('@')) throw new Error('invalid address: ' + to);
    this.sent.push({ to, subject });
    return 'msg-' + this.sent.length;
  }
}
`,
      },
      {
        path: 'src/jobs/sendEmail.js',
        content: `export function makeSendEmail(mailer) {
  return async function sendEmail(payload) {
    const messageId = await mailer.send(payload.to, payload.subject || '(no subject)');
    return { messageId };
  };
}
`,
      },
      {
        path: 'src/jobs/resizeImage.js',
        content: `import { ticks } from '../util/ticks';

export async function resizeImage(payload) {
  await ticks(5);
  if (!(payload.scale > 0)) throw new Error('scale must be positive');
  return { w: Math.round(payload.w * payload.scale), h: Math.round(payload.h * payload.scale) };
}
`,
      },
      {
        path: 'src/app.js',
        content: `import { JobQueue } from './queue/jobQueue';
import { JobStore } from './queue/jobStore';
import { HandlerRegistry } from './queue/registry';
import { FakeMailer } from './jobs/mailer';
import { makeSendEmail } from './jobs/sendEmail';
import { resizeImage } from './jobs/resizeImage';

export function buildQueue({ concurrency = 2, maxAttempts = 3 } = {}) {
  const store = new JobStore();
  const registry = new HandlerRegistry();
  const mailer = new FakeMailer();
  registry.register('email', makeSendEmail(mailer));
  registry.register('resize', resizeImage);
  const queue = new JobQueue({ store, registry, concurrency, maxAttempts });
  return { queue, store, registry, mailer };
}
`,
      },
      {
        path: 'src/demo.js',
        content: `import { buildQueue } from './app';

let unhandled = 0;
if (typeof process !== 'undefined') process.on('unhandledRejection', () => unhandled++);

async function main() {
  const { queue, store, mailer } = buildQueue({ concurrency: 2 });
  const ids = [
    queue.enqueue('email', { to: 'ann@example.com', subject: 'Welcome' }),
    queue.enqueue('email', { to: 'bob-at-example.com', subject: 'Welcome' }),
    queue.enqueue('resize', { w: 800, h: 600, scale: 0.5 }),
  ];
  await queue.drain();
  for (const id of ids) {
    const j = store.get(id);
    console.log(id, j.status, j.attempts);
  }
  setTimeout(() => console.log('sent', mailer.sent.length, 'unhandled', unhandled), 0);
}

main();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What does the dashboard see?',
        prompt: 'Bob\'s address is invalid, so his email handler throws. With `maxAttempts = 3`, what does `src/demo.js` print?',
        entry: 'src/demo.js',
        answer: 'job-1 done 1\njob-2 done 1\njob-3 done 1\nsent 1 unhandled 1',
        options: [
          'job-1 done 1\njob-2 done 1\njob-3 done 1\nsent 1 unhandled 1',
          'job-1 done 1\njob-2 failed 3\njob-3 done 1\nsent 1 unhandled 0',
          'job-1 done 1\njob-2 retrying 1\njob-3 done 1\nsent 1 unhandled 0',
          'job-1 done 1\njob-2 done 1\njob-3 done 1\nsent 1 unhandled 0',
          'job-1 running 1\njob-2 running 1\njob-3 queued 0\nsent 0 unhandled 0',
        ],
        hints: [
          'An `async` function never throws synchronously: calling it returns a promise.',
          'Without `await`, can a rejection of that promise ever reach the surrounding `catch`?',
        ],
        explanation: `\`handler(job.payload)\` returns a **promise** straight away, so nothing in the \`try\` throws. The job is marked \`done\` with a pending promise as its \`result\`, and the retry branch is unreachable for async handlers. Every job is "done" after 1 attempt, which is why the dashboard says 100%.

Bob's promise rejects a few ticks later and nobody is listening, so Node reports an **unhandled rejection** (counted as 1 here). Ann's email still goes out because her promise keeps running in the background, hence \`sent 1\`. Without awaiting, "done" just means the job was *started*.`,
        timeLimitSec: 480,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Why does the release script cut jobs off?',
        prompt: '`drain()` is documented as "resolves once every enqueued job has finished". Click the line that breaks that promise and choose the root cause.',
        file: 'src/queue/jobQueue.js',
        lines: [66],
        options: [
          'It only checks that nothing is waiting in `pending`, not that `active` is 0, so drain resolves while jobs (including ones in retry backoff) are still running',
          '`drainWaiters` is reset before the waiters are called',
          '`checkDrained` should be async',
          '`drain` should reject when a job fails',
        ],
        correct: 0,
        hints: ['When the last job is shifted out of `pending`, is it finished?'],
        explanation:
          'A job leaves `pending` when it **starts**, not when it finishes. `pending.length === 0` is already true while the last jobs are running, and while a job sits in retry backoff (it is pushed back to `pending` only after the backoff). The condition must be `this.pending.length === 0 && this.active === 0`. Because `pump` calls `checkDrained` from each job\'s `.finally`, waiters are released when the last job really finishes.',
        timeLimitSec: 300,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make success mean success',
        prompt: `There are **two bugs** in \`src/queue/jobQueue.js\`. Fix both:

- A job is \`done\` only after its handler's promise **resolves**. \`result\` is the resolved value, and \`'done'\` is emitted with it.
- A rejecting handler is retried with backoff up to \`maxAttempts\` attempts, then marked \`failed\` with the error message, and \`'failed'\` is emitted once.
- Concurrency never exceeds \`concurrency\`.
- \`drain()\` resolves only when no job is waiting, running or backing off (and immediately if the queue is idle).`,
        editable: ['src/queue/jobQueue.js'],
        tests: [
          {
            path: 'tests/queue.test.js',
            content: `import { buildQueue } from '../src/app';
import { ticks } from '../src/util/ticks';

test('result is the resolved value and done is emitted after completion', async () => {
  const { queue, store, mailer } = buildQueue();
  const seen = [];
  queue.on('done', (id, result) => seen.push([id, result, mailer.sent.length]));
  const id = queue.enqueue('email', { to: 'ann@example.com' });
  await queue.drain();
  expect(store.get(id).status).toBe('done');
  expect(store.get(id).result).toEqual({ messageId: 'msg-1' });
  expect(seen).toEqual([[id, { messageId: 'msg-1' }, 1]]);
});

test('rejecting handler is retried then failed', async () => {
  const { queue, store } = buildQueue({ maxAttempts: 3 });
  const failed = [];
  queue.on('failed', (id, err) => failed.push([id, err.message]));
  const id = queue.enqueue('email', { to: 'bob-at-example.com' });
  await queue.drain();
  const j = store.get(id);
  expect(j.status).toBe('failed');
  expect(j.attempts).toBe(3);
  expect(j.error).toBe('invalid address: bob-at-example.com');
  expect(failed).toEqual([[id, 'invalid address: bob-at-example.com']]);
  expect(store.transitions.filter((t) => t.startsWith(id))).toEqual([
    id + ':queued', id + ':running', id + ':retrying', id + ':running', id + ':retrying', id + ':running', id + ':failed',
  ]);
});

test('flaky handler succeeds on the second attempt', async () => {
  const { queue, store, registry } = buildQueue();
  let calls = 0;
  registry.register('flaky', async (p, ctx) => {
    calls++;
    await ticks(2);
    if (ctx.attempt < 2) throw new Error('transient');
    return 'ok@' + ctx.attempt;
  });
  const id = queue.enqueue('flaky', {});
  await queue.drain();
  expect(store.get(id).status).toBe('done');
  expect(store.get(id).result).toBe('ok@2');
  expect(calls).toBe(2);
});

test('drain waits for running jobs', async () => {
  const { queue, store, mailer } = buildQueue({ concurrency: 2 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(queue.enqueue('email', { to: 'u' + i + '@x.io' }));
  ids.push(queue.enqueue('resize', { w: 801, h: 600, scale: 0.5 }));
  await queue.drain();
  expect(ids.map((id) => store.get(id).status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  expect(mailer.sent).toHaveLength(5);
  expect(store.get(ids[5]).result).toEqual({ w: 401, h: 300 });
});

test('drain waits for a job in retry backoff', async () => {
  const { queue, store } = buildQueue({ maxAttempts: 2 });
  const id = queue.enqueue('resize', { w: 1, h: 1, scale: 0 });
  await queue.drain();
  expect(store.get(id).status).toBe('failed');
  expect(store.get(id).attempts).toBe(2);
});

test('concurrency limit holds for async handlers', async () => {
  const { queue, registry } = buildQueue({ concurrency: 2 });
  let running = 0;
  let peak = 0;
  registry.register('probe', async () => {
    running++;
    peak = Math.max(peak, running);
    await ticks(4);
    running--;
  });
  for (let i = 0; i < 6; i++) queue.enqueue('probe', {});
  await queue.drain();
  expect(peak).toBe(2);
  expect(running).toBe(0);
});

test('drain on an idle queue resolves', async () => {
  const { queue } = buildQueue();
  await queue.drain();
  expect(queue.active).toBe(0);
});
`,
          },
        ],
        solution: {
          'src/queue/jobQueue.js': `import { EventEmitter } from 'events';
import { backoffTicks } from './backoff';
import { ticks } from '../util/ticks';

export class JobQueue extends EventEmitter {
  constructor({ store, registry, concurrency = 2, maxAttempts = 3 }) {
    super();
    this.store = store;
    this.registry = registry;
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.pending = [];
    this.active = 0;
    this.drainWaiters = [];
  }

  enqueue(type, payload) {
    this.registry.get(type); // fail fast on unknown types
    const job = this.store.create(type, payload);
    this.pending.push(job.id);
    this.pump();
    return job.id;
  }

  pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      this.active++;
      this.run(id).finally(() => {
        this.active--;
        this.pump();
        this.checkDrained();
      });
    }
  }

  async run(id) {
    const job = this.store.get(id);
    const handler = this.registry.get(job.type);
    this.store.markRunning(id);
    try {
      const result = await handler(job.payload, { attempt: job.attempts });
      this.store.markDone(id, result);
      this.emit('done', id, result);
    } catch (err) {
      if (job.attempts < this.maxAttempts) {
        this.store.markRetry(id, err.message);
        await ticks(backoffTicks(job.attempts));
        this.pending.push(id);
      } else {
        this.store.markFailed(id, err.message);
        this.emit('failed', id, err);
      }
    }
  }

  /** Resolves once every enqueued job has finished (done or failed). */
  drain() {
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
      this.checkDrained();
    });
  }

  checkDrained() {
    if (this.pending.length === 0 && this.active === 0) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      waiters.forEach((w) => w());
    }
  }
}
`,
        },
        hints: [
          'Bug 1: one missing keyword in `run`.',
          'Bug 2: `checkDrained` must also consider jobs that have left `pending` but have not finished.',
          'A job in backoff is still inside `run()`, so `active` already covers it once `run` really awaits the handler.',
        ],
        explanation: `1. \`const result = await handler(...)\`: now rejections land in the \`catch\` (retry/fail), \`result\` is the value rather than a promise, and \`run()\` (which holds the concurrency slot) lasts as long as the job.
2. \`checkDrained\` requires \`pending.length === 0 && active === 0\`.

The two bugs hid each other. With the missing await, \`run\` finished immediately, so \`active\` dropped to 0 almost at once and the broken \`drain\` looked "nearly right". Fix only the await and the release script still cuts off running jobs. Fix only drain and every job is still falsely "done".

Rule of thumb: **every promise must be awaited, returned, or explicitly handed to something that handles its rejection.** Lint rules like \`@typescript-eslint/no-floating-promises\` catch bug 1 automatically.`,
        timeLimitSec: 1200,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'A promise-chain fix',
        prompt: 'The assistant was shown only `run()` and proposed this fix for the retry bug. Review it.',
        persona: 'tunnel-vision',
        request: 'Failed jobs are never retried. Fix run() in jobQueue.js.',
        aiReply: `The handler is async, so the \`try/catch\` can't see its rejection. Use the promise chain instead:

\`\`\`js
async run(id) {
  const job = this.store.get(id);
  const handler = this.registry.get(job.type);
  this.store.markRunning(id);
  handler(job.payload, { attempt: job.attempts })
    .then((result) => {
      this.store.markDone(id, result);
      this.emit('done', id, result);
    })
    .catch(async (err) => {
      if (job.attempts < this.maxAttempts) {
        this.store.markRetry(id, err.message);
        await ticks(backoffTicks(job.attempts));
        this.pending.push(id);
      } else {
        this.store.markFailed(id, err.message);
        this.emit('failed', id, err);
      }
    });
}
\`\`\`

Retries and results now work correctly.`,
        options: [
          'Accept: the `.catch` sees the rejection, so retries and results now work',
          'Reject: `run()` does not return or await the chain, so it resolves immediately. `active` is released before the job finishes (the concurrency limit is not enforced), `drain` can resolve early, and a retried job pushed to `pending` later is not picked up until something else calls `pump()`',
          'Reject: `.catch` cannot take an async callback',
          'Reject: `markDone` must be called before the handler runs',
        ],
        correct: 1,
        hints: ['When does the promise returned by `run()` settle now?', 'Who calls `pump()` after the backoff pushes the id back?'],
        explanation:
          'The chain is right on its own, but it is a *floating* promise again: `run()` returns before the handler finishes. `pump()` relies on `run(id).finally(...)` to free the slot and to call `pump()`/`checkDrained()`. Now the slot is freed at once, so 6 probe jobs run concurrently with `concurrency: 2`. After the backoff, the retried id is pushed into `pending` with no `pump()` call: if no other job finishes later, it sits there forever. The fix is the same chain with `return` (or simply `await`). This is the classic "tunnel vision" mistake: correct in the open function, wrong in how the caller uses it.',
        timeLimitSec: 360,
        focusFile: 'src/queue/jobQueue.js',
      },
    ],
  },
  // ───────────────────────────── 6. Pagination cursor ties (Python) ─────────────────────────────
  {
    id: 'l4-a-py-cursor-pagination-ties',
    title: 'The GDPR Export Is Missing Rows',
    level: 4,
    rating: 2250,
    lang: 'python',
    domain: 'pagination',
    companies: ['meta', 'google', 'atlassian', 'canva'],
    tags: ['keyset-pagination', 'cursor', 'ties', 'tuple-ordering', 'api'],
    summary: 'Paging through the activity feed silently drops records. Only some users are affected and nobody can reproduce it locally.',
    context: `You are on the **feed** team. Legal escalated a ticket: a user's data export (built by paging through \`/feed\`) was missing activities the user could see in the app.

Three facts from triage:
- Affected users all had **bulk-imported** activities (the importer writes many rows with the *same* \`created_at\`, and imported rows get *new* ids even though their timestamps are old).
- Local dev data has unique timestamps, and every test passes.
- The feed uses cursor ("keyset") pagination, see \`docs/PAGINATION.md\`.`,
    persona: 'confident-intern',
    files: [
      {
        path: 'docs/PAGINATION.md',
        language: 'markdown',
        content: `# /feed pagination contract

- Order: newest first (\`created_at\` desc). Ties are broken by \`id\`, highest first.
- \`limit\` is clamped to 1..100 (default 20).
- \`next_cursor\` is an opaque string. It is \`None\` on the last page.
- Paging from the first page until \`next_cursor\` is \`None\` returns **every** matching
  activity **exactly once**, in feed order.
- A malformed or tampered cursor is a 400.
- Ids are assigned at insert time. Imported activities keep their original \`created_at\`,
  so id order is NOT the same as time order.
`,
      },
      {
        path: 'feed/__init__.py',
        content: ``,
      },
      {
        path: 'feed/models.py',
        content: `from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Activity:
    id: int
    user_id: str
    kind: str
    created_at: int  # epoch seconds

    def to_json(self):
        return asdict(self)
`,
      },
      {
        path: 'feed/store.py',
        content: `class Table:
    """A tiny in-memory stand-in for a SQL table."""

    def __init__(self):
        self.rows = []
        self._next_id = 1

    def insert(self, **fields):
        from feed.models import Activity

        row = Activity(id=self._next_id, **fields)
        self._next_id += 1
        self.rows.append(row)
        return row

    def query(self, where, order_by, limit):
        """SELECT * WHERE where(row) ORDER BY order_by LIMIT limit.
        order_by: list of (field, "asc" | "desc"), most significant first.
        Like a real database, rows that tie on every order_by field come back in
        no guaranteed order (here: insertion order)."""
        rows = [r for r in self.rows if where(r)]
        for field, direction in reversed(order_by):
            rows.sort(key=lambda r: getattr(r, field), reverse=(direction == "desc"))
        return rows[:limit]
`,
      },
      {
        path: 'feed/cursor.py',
        content: `import base64
import json

CURSOR_VERSION = 1


class InvalidCursor(ValueError):
    pass


def encode_cursor(position):
    """position: dict of the sort-key values of the last item on the page."""
    raw = json.dumps({"v": CURSOR_VERSION, **position}, sort_keys=True).encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor):
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except Exception:
        raise InvalidCursor("malformed cursor")
    if not isinstance(data, dict) or data.get("v") != CURSOR_VERSION:
        raise InvalidCursor("unsupported cursor")
    data.pop("v")
    return data
`,
      },
      {
        path: 'feed/repository.py',
        content: `class ActivityRepository:
    def __init__(self, table):
        self.table = table

    def add(self, user_id, kind, created_at):
        return self.table.insert(user_id=user_id, kind=kind, created_at=created_at)

    def page(self, user_id, limit, after=None, kinds=None):
        """One page of a user's activities in feed order, strictly after the
        position \`after\` (decoded cursor) if given."""

        def where(r):
            if r.user_id != user_id:
                return False
            if kinds and r.kind not in kinds:
                return False
            if after is not None and not (r.created_at < after["created_at"]):
                return False
            return True

        return self.table.query(where, order_by=[("created_at", "desc")], limit=limit)
`,
      },
      {
        path: 'feed/service.py',
        content: `from feed.cursor import decode_cursor, encode_cursor


class FeedService:
    def __init__(self, repo):
        self.repo = repo

    def list_feed(self, user_id, limit=20, cursor=None, kinds=None):
        after = decode_cursor(cursor) if cursor else None
        rows = self.repo.page(user_id, limit + 1, after=after, kinds=kinds)
        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = None
        if has_more:
            last = items[-1]
            next_cursor = encode_cursor({"created_at": last.created_at})
        return {"items": items, "next_cursor": next_cursor}
`,
      },
      {
        path: 'feed/api.py',
        content: `from feed.cursor import InvalidCursor

MAX_LIMIT = 100


def get_feed(service, user_id, params):
    """GET /feed?limit=&cursor=&kinds=a,b  ->  (status, body)"""
    try:
        limit = int(params.get("limit", 20))
    except ValueError:
        return 400, {"error": "limit must be an integer"}
    limit = max(1, min(MAX_LIMIT, limit))
    kinds = set(params["kinds"].split(",")) if params.get("kinds") else None
    try:
        page = service.list_feed(user_id, limit=limit, cursor=params.get("cursor"), kinds=kinds)
    except InvalidCursor as e:
        return 400, {"error": str(e)}
    return 200, {"items": [a.to_json() for a in page["items"]], "next_cursor": page["next_cursor"]}
`,
      },
      {
        path: 'feed/export.py',
        content: `from feed.api import get_feed


def export_all(service, user_id, page_size=50, max_pages=10_000):
    """GDPR export: walk the feed API to the end. Returns activity ids in order."""
    ids = []
    params = {"limit": page_size}
    for _ in range(max_pages):
        status, body = get_feed(service, user_id, params)
        if status != 200:
            raise RuntimeError(body["error"])
        ids.extend(item["id"] for item in body["items"])
        if body["next_cursor"] is None:
            return ids
        params = {"limit": page_size, "cursor": body["next_cursor"]}
    raise RuntimeError("export did not terminate")
`,
      },
      {
        path: 'feed/wiring.py',
        content: `from feed.repository import ActivityRepository
from feed.service import FeedService
from feed.store import Table


def build():
    repo = ActivityRepository(Table())
    return repo, FeedService(repo)
`,
      },
      {
        path: 'main.py',
        content: `from feed.api import get_feed
from feed.wiring import build

repo, service = build()
for t in [100, 200, 200, 200, 300, 400]:
    repo.add("u1", "post", t)
repo.add("u1", "import", 200)  # id 7: imported later, old timestamp
repo.add("u2", "post", 250)

params = {"limit": 2}
seen = []
while True:
    status, body = get_feed(service, "u1", params)
    ids = [a["id"] for a in body["items"]]
    print(ids)
    seen.extend(ids)
    if body["next_cursor"] is None:
        break
    params = {"limit": 2, "cursor": body["next_cursor"]}
print("total", len(seen), "of", sum(1 for r in repo.table.rows if r.user_id == "u1"))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce with ties',
        prompt: 'User `u1` has 7 activities, four of them at `created_at = 200`. Page size is 2. What does `main.py` print?',
        entry: 'main.py',
        answer: '[6, 5]\n[2, 3]\n[1]\ntotal 5 of 7',
        options: [
          '[6, 5]\n[2, 3]\n[1]\ntotal 5 of 7',
          '[6, 5]\n[7, 4]\n[3, 2]\n[1]\ntotal 7 of 7',
          '[6, 5]\n[2, 3]\n[4, 7]\n[1]\ntotal 7 of 7',
          '[6, 5]\n[2, 3]\n[2, 3]\n[2, 3]\ntotal 6 of 7',
          '[6, 5]\n[2]\n[1]\ntotal 4 of 7',
        ],
        hints: [
          'Ties keep insertion order: ids 2, 3, 4, 7 at t=200.',
          'What does the cursor after page 2 contain, and which rows satisfy `created_at < 200`?',
        ],
        explanation:
          'Page 1: [6 (400), 5 (300)], cursor `{created_at: 300}`. Page 2: rows with `created_at < 300` are 2, 3, 4, 7 (all at 200), then 1. The page takes [2, 3] and the cursor is `{created_at: 200}`. Page 3: `created_at < 200` leaves only [1]. Activities **4 and 7 are skipped**, because a cursor made only of `created_at` cannot say "part-way through the rows at 200". With unique timestamps (local dev data) this never shows up.',
        timeLimitSec: 420,
        focusFile: 'feed/repository.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Which fix actually works?',
        prompt: 'Teammates proposed fixes in the incident channel. Which one meets **every** rule in `docs/PAGINATION.md`?',
        options: [
          'Change `<` to `<=` in the repository filter',
          'Order by `(created_at desc, id desc)`, put both values in the cursor, and filter rows strictly after `(created_at, id)` in that order',
          'Switch to `OFFSET`/`LIMIT` pagination with the page number in the cursor',
          'Store timestamps in milliseconds so ties become rare',
          'Put only `id` in the cursor, order by `id desc`, and filter `id < cursor_id`',
        ],
        correct: [1],
        hints: ['Try each fix with 250 rows that share one timestamp and a page size of 20.', 'Read the last line of the pagination doc.'],
        explanation: `- \`<=\` re-reads the rows at the boundary timestamp: duplicates, and an **infinite loop** once more rows share a timestamp than fit on one page.
- OFFSET pagination skips or duplicates rows when new activities are inserted between page loads (and gets slower with depth).
- Milliseconds make ties rarer but do not remove them. The importer writes identical timestamps on purpose.
- Id-only keyset breaks the order contract: imported rows have new ids and old timestamps.
- **Composite keyset** with a unique tie-breaker is the standard answer: the sort key \`(created_at, id)\` is unique, so "strictly after the last row" is well defined.`,
        timeLimitSec: 300,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make the export complete',
        prompt: `Fix pagination so the contract in \`docs/PAGINATION.md\` holds: every matching activity exactly once, newest first, ties by id desc. This must also work with hundreds of identical timestamps and with the \`kinds\` filter. Cursors stay opaque, and bad cursors are still a 400.`,
        editable: ['feed/repository.py', 'feed/service.py', 'feed/cursor.py'],
        tests: [
          {
            path: 'tests/test_feed_hidden.py',
            content: `import base64

from feed.api import get_feed
from feed.export import export_all
from feed.wiring import build


def sample():
    repo, service = build()
    for t in [100, 200, 200, 200, 300, 400]:
        repo.add("u1", "post", t)
    repo.add("u1", "import", 200)
    repo.add("u2", "post", 250)
    return repo, service


def test_sample_export_complete_and_ordered():
    _, service = sample()
    assert export_all(service, "u1", page_size=2) == [6, 5, 7, 4, 3, 2, 1]
    assert export_all(service, "u1", page_size=3) == [6, 5, 7, 4, 3, 2, 1]
    assert export_all(service, "u1", page_size=100) == [6, 5, 7, 4, 3, 2, 1]


def test_hundreds_of_ties_terminate_without_duplicates():
    repo, service = build()
    repo.add("u1", "post", 999)
    for _ in range(250):
        repo.add("u1", "import", 500)
    repo.add("u1", "post", 1)
    ids = export_all(service, "u1", page_size=20, max_pages=100)
    assert len(ids) == 252
    assert len(set(ids)) == 252
    assert ids[0] == 1 and ids[-1] == 252
    assert ids[1:251] == list(range(251, 1, -1))


def test_kinds_filter_with_ties():
    repo, service = build()
    for i in range(10):
        repo.add("u1", "like" if i % 2 else "post", 100)
    ids = []
    params = {"limit": 2, "kinds": "like"}
    while True:
        status, body = get_feed(service, "u1", params)
        assert status == 200
        ids.extend(a["id"] for a in body["items"])
        if body["next_cursor"] is None:
            break
        params = {"limit": 2, "kinds": "like", "cursor": body["next_cursor"]}
    assert ids == [10, 8, 6, 4, 2]


def test_exactly_full_last_page_has_no_cursor():
    repo, service = build()
    for t in [5, 5, 5, 5]:
        repo.add("u1", "post", t)
    s, b1 = get_feed(service, "u1", {"limit": 2})
    s, b2 = get_feed(service, "u1", {"limit": 2, "cursor": b1["next_cursor"]})
    assert [a["id"] for a in b2["items"]] == [2, 1]
    assert b2["next_cursor"] is None


def test_bad_cursors_are_400():
    _, service = sample()
    assert get_feed(service, "u1", {"cursor": "not-base64!!"})[0] == 400
    v9 = base64.urlsafe_b64encode(b'{"v": 9, "created_at": 1, "id": 1}').decode()
    assert get_feed(service, "u1", {"cursor": v9})[0] == 400


def test_other_users_never_leak():
    _, service = sample()
    assert 8 not in export_all(service, "u1", page_size=1)
    assert export_all(service, "u2", page_size=1) == [8]
`,
          },
        ],
        solution: {
          'feed/repository.py': `class ActivityRepository:
    def __init__(self, table):
        self.table = table

    def add(self, user_id, kind, created_at):
        return self.table.insert(user_id=user_id, kind=kind, created_at=created_at)

    def page(self, user_id, limit, after=None, kinds=None):
        """One page of a user's activities in feed order (created_at desc, id desc),
        strictly after the position \`after\` (decoded cursor) if given."""

        def where(r):
            if r.user_id != user_id:
                return False
            if kinds and r.kind not in kinds:
                return False
            if after is not None:
                # strictly after in DESC order == strictly smaller composite key
                if not ((r.created_at, r.id) < (after["created_at"], after["id"])):
                    return False
            return True

        return self.table.query(where, order_by=[("created_at", "desc"), ("id", "desc")], limit=limit)
`,
          'feed/service.py': `from feed.cursor import InvalidCursor, decode_cursor, encode_cursor


class FeedService:
    def __init__(self, repo):
        self.repo = repo

    def list_feed(self, user_id, limit=20, cursor=None, kinds=None):
        after = decode_cursor(cursor) if cursor else None
        if after is not None and not (isinstance(after.get("created_at"), int) and isinstance(after.get("id"), int)):
            raise InvalidCursor("malformed cursor")
        rows = self.repo.page(user_id, limit + 1, after=after, kinds=kinds)
        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = None
        if has_more:
            last = items[-1]
            next_cursor = encode_cursor({"created_at": last.created_at, "id": last.id})
        return {"items": items, "next_cursor": next_cursor}
`,
        },
        hints: [
          'The cursor must identify a **unique** position, so it needs a tie-breaker column.',
          'The ORDER BY and the WHERE must use the same composite key, or pages will overlap or leave gaps.',
          'For a DESC/DESC order, "after (c, i)" means `created_at < c OR (created_at == c AND id < i)`. A Python tuple comparison expresses exactly that.',
        ],
        explanation: `Keyset pagination is correct only when the sort key is **unique** and the filter matches the sort exactly:

\`\`\`
ORDER BY created_at DESC, id DESC
WHERE (created_at, id) < (:c, :i)          -- row-value comparison
\`\`\`

In Python, tuple comparison is lexicographic, which is the same as \`created_at < c OR (created_at == c AND id < i)\`. The cursor now stores both values. Validating the decoded cursor's fields keeps tampered cursors a 400 rather than a 500.

Also note: before the fix the *order of tied rows* came from insertion order, which the doc forbids depending on ("no guaranteed order"). Adding \`id desc\` to ORDER BY is needed for correctness, not just cosmetics. In SQL you would back this with an index on \`(user_id, created_at DESC, id DESC)\`.`,
        timeLimitSec: 1200,
        focusFile: 'feed/repository.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the assistant\'s WHERE clause',
        prompt: 'The assistant suggests this filter for the composite cursor. ORDER BY is already `(created_at desc, id desc)`. Review it.',
        persona: 'confident-intern',
        request: 'Write the WHERE clause for our (created_at, id) cursor, newest first.',
        aiReply: `Straightforward, just require both columns to be past the cursor:

\`\`\`python
if after is not None:
    if not (r.created_at <= after["created_at"] and r.id < after["id"]):
        return False
\`\`\`

\`<=\` on \`created_at\` keeps the tied rows, and \`id <\` skips the ones we've already shown. Works for any number of ties.`,
        options: [
          'Accept: it handles ties and never repeats a row',
          'Reject: the AND also requires older rows to have a smaller id, so older rows with a larger id (e.g. imported activity 7 after cursor (300, 5)) are skipped. It must be `created_at < c OR (created_at == c AND id < i)`',
          'Reject: `<=` must be `<`, otherwise rows at the cursor timestamp are repeated',
          'Reject: comparing ids is meaningless because ids are not timestamps',
        ],
        correct: 1,
        hints: ['Evaluate it for activity 7 (created_at 200) with cursor (300, 5).'],
        explanation:
          'With cursor (300, 5): activity 7 has `200 <= 300` (true) and `7 < 5` (false), so it is filtered out, even though it is older and must appear on a later page. The rule "id smaller" may only apply **within** the tied timestamp. A row-value comparison `(created_at, id) < (c, i)` (or the expanded OR form) does that. This mistake is common because it looks right on data where ids grow with time, which is exactly the assumption the docs warn against.',
        timeLimitSec: 300,
        focusFile: 'feed/repository.py',
      },
    ],
  },
];

export default problems;
