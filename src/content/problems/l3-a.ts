import type { Problem } from '../types';

/**
 * Level 3 "Module Navigator" — slice A, part 1.
 * NOTE: code lives in template literals, so backticks are escaped as \` and `${` as \${.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 1. TypeScript — booking API (Express/Mongo-style layering)
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-ts-booking-cancel-ghost',
    title: 'Hotel Bookings: The Ghost Reservation',
    level: 3,
    rating: 1540,
    lang: 'typescript',
    domain: 'booking',
    companies: ['atlassian', 'amazon', 'uber'],
    tags: ['tracing', 'middleware', 'dependency-injection', 'event-bus', 'repository-pattern'],
    summary: 'A cancelled booking still blocks the room. Navigate router → middleware → controller → service → repo to find out why.',
    context:
      'You have just joined the team that owns the hotel booking API (an Express/Mongo-style service, stubbed in memory here). The front desk reports that after a guest **cancels**, nobody else can book that room for those nights. Your lead asks you to get familiar with the request path first, then fix it.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# booking-api

Express-style booking service. The HTTP layer and Mongo collections are replaced by
small in-memory stand-ins so the whole thing runs in a single process.

## Layout

| Path | Responsibility |
| --- | --- |
| \`src/app.ts\` | Composition root: builds repos, service, controller, router; wires middleware and subscribers |
| \`src/http/router.ts\` | Tiny router: route matching, middleware chain, error → status mapping |
| \`src/middleware/*.ts\` | \`accessLogger\` (records every response), \`requireUser\` (reads \`x-user\` header) |
| \`src/controllers/bookingController.ts\` | Request shape validation, maps service results to HTTP responses |
| \`src/services/bookingService.ts\` | Business rules: availability, stay length, pricing, events |
| \`src/services/pricing.ts\` | Nightly rates, weekend surcharge |
| \`src/services/notifier.ts\` | Subscribes to booking events and "sends" emails |
| \`src/repos/*.ts\` | Mongo-like collections (\`find(filter)\`, \`insertOne\`, \`updateOne\`) |
| \`src/errors.ts\` | Typed errors carrying an HTTP status |

## Endpoints

- \`POST /bookings\` \`{ roomId, checkIn, checkOut }\` (dates are \`YYYY-MM-DD\`, checkOut exclusive)
- \`POST /bookings/:id/cancel\` (only the guest who made it)
- \`GET /bookings/mine\` — **all** of the caller's bookings, including cancelled ones (the app shows history)

Cancelling is a soft delete: the document stays with \`status: 'cancelled'\`.
`,
      },
      {
        path: 'src/config.ts',
        content: `export const config = {
  currency: 'USD',
  weekendSurchargePct: 20,
  maxNights: 14,
  rates: { standard: 100, deluxe: 180 } as Record<string, number>,
};
`,
      },
      {
        path: 'src/errors.ts',
        content: `export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) { super(400, message); }
}

export class ForbiddenError extends AppError {
  constructor(message: string) { super(403, message); }
}

export class NotFoundError extends AppError {
  constructor(what: string) { super(404, what + ' not found'); }
}

export class ConflictError extends AppError {
  constructor(message: string) { super(409, message); }
}

export function errorToResponse(e: unknown): { status: number; body: { error: string } } {
  if (e instanceof AppError) return { status: e.status, body: { error: e.message } };
  return { status: 500, body: { error: 'internal error' } };
}
`,
      },
      {
        path: 'src/http/router.ts',
        content: `import { errorToResponse } from '../errors';

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: any;
  params: Record<string, string>;
  user?: string;
}
export interface Response { status: number; body: unknown }
export type Handler = (req: Request) => Response;
export type Middleware = (req: Request, next: () => Response) => Response;

interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  private middleware: Middleware[] = [];

  use(mw: Middleware): void {
    this.middleware.push(mw);
  }

  add(method: string, path: string, handler: Handler): void {
    const keys: string[] = [];
    const source = path.replace(/:([a-zA-Z]+)/g, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp('^' + source + '$'), keys, handler });
  }

  handle(raw: { method: string; path: string; headers?: Record<string, string>; body?: any }): Response {
    const route = this.routes.find((r) => r.method === raw.method && r.pattern.test(raw.path));
    if (!route) return { status: 404, body: { error: 'no route' } };
    const match = route.pattern.exec(raw.path)!;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = match[i + 1]));
    const req: Request = { method: raw.method, path: raw.path, headers: raw.headers ?? {}, body: raw.body, params };

    let i = 0;
    const next = (): Response => {
      const mw = this.middleware[i++];
      if (!mw) return route.handler(req);
      try {
        return mw(req, next);
      } catch (e) {
        return errorToResponse(e);
      }
    };
    return next();
  }
}
`,
      },
      {
        path: 'src/middleware/accessLogger.ts',
        content: `import type { Middleware } from '../http/router';

export function accessLogger(lines: string[]): Middleware {
  return (req, next) => {
    const res = next();
    lines.push(\`\${req.method} \${req.path} -> \${res.status}\`);
    return res;
  };
}
`,
      },
      {
        path: 'src/middleware/requireUser.ts',
        content: `import type { Middleware } from '../http/router';

export const requireUser: Middleware = (req, next) => {
  const user = req.headers['x-user'];
  if (!user) return { status: 401, body: { error: 'login required' } };
  req.user = user;
  return next();
};
`,
      },
      {
        path: 'src/controllers/bookingController.ts',
        content: `import type { Request, Response } from '../http/router';
import { BookingService } from '../services/bookingService';

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export class BookingController {
  constructor(private service: BookingService) {}

  create = (req: Request): Response => {
    const { roomId, checkIn, checkOut } = req.body ?? {};
    if (typeof roomId !== 'string' || !ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
      return { status: 400, body: { error: 'roomId, checkIn and checkOut are required' } };
    }
    const booking = this.service.create(req.user!, roomId, checkIn, checkOut);
    return { status: 201, body: booking };
  };

  cancel = (req: Request): Response => {
    const booking = this.service.cancel(req.user!, req.params.id);
    return { status: 200, body: booking };
  };

  mine = (req: Request): Response => {
    return { status: 200, body: this.service.listFor(req.user!) };
  };
}
`,
      },
      {
        path: 'src/services/pricing.ts',
        content: `import { config } from '../config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' -> whole days since the epoch (UTC). */
export function toDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return toDay(checkOut) - toDay(checkIn);
}

/** Friday and Saturday nights carry the weekend surcharge. */
export function isWeekendNight(day: number): boolean {
  const dow = new Date(day * DAY_MS).getUTCDay();
  return dow === 5 || dow === 6;
}

export function quote(roomType: string, checkIn: string, checkOut: string): number {
  const base = config.rates[roomType];
  if (base === undefined) throw new Error('unknown room type ' + roomType);
  const surcharge = (base * config.weekendSurchargePct) / 100;
  let total = 0;
  for (let day = toDay(checkIn); day < toDay(checkOut); day++) {
    total += isWeekendNight(day) ? base + surcharge : base;
  }
  return total;
}
`,
      },
      {
        path: 'src/services/bookingService.ts',
        content: `import { config } from '../config';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { EventBus } from '../events/bus';
import { BookingDoc, BookingRepo } from '../repos/bookingRepo';
import { RoomRepo } from '../repos/roomRepo';
import { nightsBetween, quote, toDay } from './pricing';

export class BookingService {
  constructor(
    private bookings: BookingRepo,
    private rooms: RoomRepo,
    private bus: EventBus,
  ) {}

  create(guest: string, roomId: string, checkIn: string, checkOut: string): BookingDoc {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundError('room ' + roomId);
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1 || nights > config.maxNights) {
      throw new ValidationError('stay must be 1-' + config.maxNights + ' nights');
    }
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new ConflictError('room unavailable');
    const total = quote(room.type, checkIn, checkOut);
    const booking = this.bookings.insertOne({ roomId, guest, checkIn, checkOut, total, status: 'confirmed' });
    this.bus.emit('booking.created', booking);
    return booking;
  }

  cancel(guest: string, id: string): BookingDoc {
    const booking = this.bookings.findById(id);
    if (!booking) throw new NotFoundError('booking ' + id);
    if (booking.guest !== guest) throw new ForbiddenError('not your booking');
    if (booking.status === 'cancelled') return booking;
    this.bookings.updateOne(id, { status: 'cancelled' });
    const updated: BookingDoc = { ...booking, status: 'cancelled' };
    this.bus.emit('booking.cancelled', updated);
    return updated;
  }

  isAvailable(roomId: string, checkIn: string, checkOut: string): boolean {
    const start = toDay(checkIn);
    const end = toDay(checkOut);
    return this.bookings
      .find({ roomId })
      .every((b) => end <= toDay(b.checkIn) || start >= toDay(b.checkOut));
  }

  listFor(guest: string): BookingDoc[] {
    return this.bookings.find({ guest });
  }
}
`,
      },
      {
        path: 'src/services/notifier.ts',
        content: `import { EventBus } from '../events/bus';
import type { BookingDoc } from '../repos/bookingRepo';

export class Notifier {
  readonly sent: string[] = [];

  subscribe(bus: EventBus): void {
    bus.on('booking.created', (b: BookingDoc) => this.sent.push(\`confirm \${b._id} to \${b.guest} (\${b.total})\`));
    bus.on('booking.cancelled', (b: BookingDoc) => this.sent.push(\`cancel \${b._id} to \${b.guest}\`));
  }
}
`,
      },
      {
        path: 'src/events/bus.ts',
        content: `export type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(event: string, fn: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event: string, payload: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}
`,
      },
      {
        path: 'src/repos/bookingRepo.ts',
        content: `export type BookingStatus = 'confirmed' | 'cancelled';

export interface BookingDoc {
  _id: string;
  roomId: string;
  guest: string;
  checkIn: string;
  checkOut: string;
  total: number;
  status: BookingStatus;
}

/** Mimics a Mongo collection: equality filters, copies out, soft updates. */
export class BookingRepo {
  private docs: BookingDoc[] = [];
  private seq = 0;

  find(filter: Partial<BookingDoc>): BookingDoc[] {
    return this.docs
      .filter((d) => Object.entries(filter).every(([k, v]) => (d as any)[k] === v))
      .map((d) => ({ ...d }));
  }

  findById(id: string): BookingDoc | null {
    const doc = this.docs.find((d) => d._id === id);
    return doc ? { ...doc } : null;
  }

  insertOne(doc: Omit<BookingDoc, '_id'>): BookingDoc {
    const row: BookingDoc = { _id: 'bk_' + ++this.seq, ...doc };
    this.docs.push(row);
    return { ...row };
  }

  updateOne(id: string, patch: Partial<BookingDoc>): boolean {
    const doc = this.docs.find((d) => d._id === id);
    if (!doc) return false;
    Object.assign(doc, patch);
    return true;
  }
}
`,
      },
      {
        path: 'src/repos/roomRepo.ts',
        content: `export interface Room { id: string; type: string }

export class RoomRepo {
  private byId = new Map<string, Room>();

  constructor(rooms: Room[]) {
    for (const r of rooms) this.byId.set(r.id, r);
  }

  get(id: string): Room | undefined {
    return this.byId.get(id);
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { BookingController } from './controllers/bookingController';
import { EventBus } from './events/bus';
import { Router } from './http/router';
import { accessLogger } from './middleware/accessLogger';
import { requireUser } from './middleware/requireUser';
import { BookingRepo } from './repos/bookingRepo';
import { RoomRepo } from './repos/roomRepo';
import { BookingService } from './services/bookingService';
import { Notifier } from './services/notifier';

export function buildApp() {
  const bus = new EventBus();
  const rooms = new RoomRepo([
    { id: 'r101', type: 'standard' },
    { id: 'r201', type: 'deluxe' },
  ]);
  const bookings = new BookingRepo();
  const service = new BookingService(bookings, rooms, bus);
  const controller = new BookingController(service);

  const notifier = new Notifier();
  notifier.subscribe(bus);

  const accessLog: string[] = [];
  const router = new Router();
  router.use(accessLogger(accessLog));
  router.use(requireUser);
  router.add('POST', '/bookings', controller.create);
  router.add('POST', '/bookings/:id/cancel', controller.cancel);
  router.add('GET', '/bookings/mine', controller.mine);

  return { router, notifier, accessLog, service };
}
`,
      },
      {
        path: 'demo.ts',
        content: `import { buildApp } from './src/app';

const { router, notifier, accessLog } = buildApp();

function call(user: string | null, method: string, path: string, body?: unknown) {
  const res = router.handle({ method, path, headers: user ? { 'x-user': user } : {}, body });
  return res as { status: number; body: any };
}

// 2025-03-06 is a Thursday.
const a = call('ana', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-06', checkOut: '2025-03-09' });
console.log('A', a.status, a.body.total);

const b = call('ben', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-08', checkOut: '2025-03-10' });
console.log('B', b.status);

const c = call('ben', 'POST', '/bookings/bk_1/cancel');
console.log('C', c.status);

const d = call('ana', 'POST', '/bookings/bk_1/cancel');
console.log('D', d.status, d.body.status);

const e = call('ben', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-08', checkOut: '2025-03-10' });
console.log('E', e.status);

console.log(notifier.sent.length, accessLog.length);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: who turns errors into status codes?',
        prompt:
          '`BookingService.create` throws `new ConflictError(\'room unavailable\')`. The controller has no `try/catch`. Which statements are true about how that becomes an HTTP **409**? Select all that apply.',
        options: [
          '`Router.handle` → `next()` wraps each middleware call in `try/catch` and converts the error with `errorToResponse`',
          'The error propagates up through `requireUser` (which calls `next()`) and is caught at the `try` around the `requireUser` call',
          'The controller method is invoked inside the `try` that wraps the *last* middleware, because that middleware calls `next()` which calls the handler',
          '`accessLogger` never sees the 409 because the exception skips it',
          '`ConflictError` sets its own status to 409 via `AppError`\'s constructor',
        ],
        correct: [0, 1, 2, 4],
        hints: [
          'Open `src/http/router.ts` and look at what `next()` does when there is no middleware left.',
          'The handler is called from inside `next()`, which was called from inside `requireUser`. Which `try` is innermost?',
        ],
        explanation:
          'The handler runs inside the innermost `next()` invocation, which was called by `requireUser`, which itself was called inside the `try` in `next()`. So the throw unwinds out of the handler and `requireUser` and is caught by the `try` wrapping `requireUser`, returning `{ status: 409 }` *as a normal return value* to `accessLogger`. `accessLogger` therefore **does** log `-> 409`. `ConflictError` passes 409 to `AppError`, which stores it as `status` via a TypeScript parameter property. Knowing where errors are mapped is the first thing to find in any unfamiliar service.',
        timeLimitSec: 300,
        focusFile: 'src/http/router.ts',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a successful POST /bookings',
        prompt: 'Ana books room `r101`. Put the steps in the order they **start** executing.',
        items: [
          'Router.handle matches the route and builds params',
          'accessLogger calls next()',
          'requireUser copies x-user into req.user',
          'BookingController.create validates the body shape',
          'BookingService.create looks up the room and checks the stay length',
          'BookingService.isAvailable queries BookingRepo.find',
          'quote() prices the stay, then BookingRepo.insertOne stores it',
          'EventBus emits booking.created and Notifier records the email',
          'accessLogger pushes "POST /bookings -> 201"',
        ],
        hints: [
          'Middleware runs in `use()` order — see `src/app.ts`.',
          '`accessLogger` calls `next()` *before* it logs. When does its log line get pushed?',
        ],
        explanation:
          'Middleware is registered as `accessLogger`, then `requireUser`. `accessLogger` calls `next()` first and only logs once the whole chain returns, so its log line is the very last step. Inside the service: room lookup and stay-length validation → availability → price → insert → event. The event is synchronous, so the notifier runs before the controller even returns 201.',
        timeLimitSec: 360,
        focusFile: 'src/app.ts',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce the ghost reservation',
        prompt: 'Run `demo.ts` in your head. What exactly does it print? (2025-03-06 is a Thursday.)',
        entry: 'demo.ts',
        answer: 'A 201 340\nB 409\nC 403\nD 200 cancelled\nE 409\n2 5',
        options: [
          'A 201 340\nB 409\nC 403\nD 200 cancelled\nE 409\n2 5',
          'A 201 340\nB 409\nC 403\nD 200 cancelled\nE 201\n3 5',
          'A 201 300\nB 409\nC 403\nD 200 cancelled\nE 409\n2 5',
          'A 201 340\nB 409\nC 403\nD 200 cancelled\nE 409\n2 4',
          'A 201 360\nB 409\nC 500\nD 200 cancelled\nE 409\n2 5',
        ],
        hints: [
          'Nights are 6, 7, 8 March. Which of those are Friday/Saturday nights?',
          'After D, what does `bookings.find({ roomId })` return for r101?',
          'Does a request that ends in an error still reach `accessLog`?',
        ],
        explanation:
          'A: Thu 100 + Fri 120 + Sat 120 = **340**. B overlaps the 8th → 409. C: Ben is not the owner → `ForbiddenError` → 403. D: Ana cancels → 200, status `cancelled`. E: the cancelled booking is still returned by `find({ roomId })`, and `isAvailable` does not look at `status`, so the room is still blocked → **409**: that is the bug. Only A and D emitted events (2 emails), and all 5 requests were logged, because errors are caught *inside* the chain and `accessLogger` still gets a response object.',
        timeLimitSec: 420,
        focusFile: 'demo.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'The assistant proposes a fix',
        prompt: 'You ask the assistant (which only had `bookingRepo.ts` open) to fix the bug. Should you accept its change?',
        persona: 'tunnel-vision',
        request: 'Cancelled bookings still block the room. Fix it.',
        aiReply: `Cancelled docs are soft-deleted, so the repository should simply never return them. One-line fix in \`src/repos/bookingRepo.ts\`:

\`\`\`ts
find(filter: Partial<BookingDoc>): BookingDoc[] {
  return this.docs
    .filter((d) => d.status !== 'cancelled')
    .filter((d) => Object.entries(filter).every(([k, v]) => (d as any)[k] === v))
    .map((d) => ({ ...d }));
}
\`\`\`

Now every query ignores cancelled bookings, so availability is correct everywhere. 🎯`,
        options: [
          'Accept: soft-deleted rows should be invisible to every query',
          'Reject: it fixes availability but `GET /bookings/mine` (via `listFor` → `find({ guest })`) would stop returning cancelled bookings, which the README says must be shown',
          'Reject: `cancel()` would no longer be idempotent because `findById` would return null for cancelled bookings',
          'Reject: the filter must run after the `.map` copy or it mutates stored docs',
        ],
        correct: 1,
        hints: [
          'Search the codebase for every caller of `find(`.',
          'Does `findById` go through `find`?',
        ],
        explanation:
          '`find` is shared. `BookingService.listFor` also uses it, and the README states that `/bookings/mine` returns **all** bookings including cancelled ones. Changing the repository globally silently breaks that caller. `findById` is a separate method, so idempotent cancel is unaffected, and `.filter` does not mutate anything. The fix belongs in the caller that has the business rule: `isAvailable` should ask for `{ roomId, status: \'confirmed\' }`. This is the classic "tunnel-vision" failure: correct for the one file it read, wrong for the system.',
        timeLimitSec: 300,
        focusFile: 'src/repos/bookingRepo.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix availability without breaking history',
        prompt:
          'Make cancelled bookings stop blocking the room. Confirmed overlaps must still be rejected, back-to-back stays (check-out day = next check-in day) must still be allowed, and `GET /bookings/mine` must keep returning cancelled bookings.',
        editable: ['src/services/bookingService.ts', 'src/repos/bookingRepo.ts'],
        tests: [
          {
            path: 'tests/booking.test.ts',
            content: `import { buildApp } from '../src/app';

function setup() {
  const app = buildApp();
  const call = (user: string, method: string, path: string, body?: unknown) =>
    app.router.handle({ method, path, headers: { 'x-user': user }, body }) as { status: number; body: any };
  return { ...app, call };
}

test('cancelled booking frees the room', () => {
  const { call } = setup();
  expect(call('ana', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-06', checkOut: '2025-03-09' }).status).toBe(201);
  expect(call('ana', 'POST', '/bookings/bk_1/cancel').status).toBe(200);
  const again = call('ben', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-07', checkOut: '2025-03-08' });
  expect(again.status).toBe(201);
  expect(again.body.total).toBe(120);
});

test('confirmed overlap still rejected', () => {
  const { call } = setup();
  call('ana', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-06', checkOut: '2025-03-09' });
  call('ana', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-01', checkOut: '2025-03-03' });
  call('ana', 'POST', '/bookings/bk_2/cancel');
  expect(call('ben', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-02', checkOut: '2025-03-07' }).status).toBe(409);
  expect(call('ben', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-02', checkOut: '2025-03-06' }).status).toBe(201);
  expect(call('cy', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-09', checkOut: '2025-03-10' }).status).toBe(201);
});

test('history still includes cancelled bookings', () => {
  const { call } = setup();
  call('ana', 'POST', '/bookings', { roomId: 'r101', checkIn: '2025-03-06', checkOut: '2025-03-09' });
  call('ana', 'POST', '/bookings', { roomId: 'r201', checkIn: '2025-03-06', checkOut: '2025-03-07' });
  call('ana', 'POST', '/bookings/bk_1/cancel');
  const mine = call('ana', 'GET', '/bookings/mine').body as any[];
  expect(mine).toHaveLength(2);
  expect(mine.map((b) => b.status)).toEqual(['cancelled', 'confirmed']);
});
`,
          },
        ],
        solution: {
          'src/services/bookingService.ts': `import { config } from '../config';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { EventBus } from '../events/bus';
import { BookingDoc, BookingRepo } from '../repos/bookingRepo';
import { RoomRepo } from '../repos/roomRepo';
import { nightsBetween, quote, toDay } from './pricing';

export class BookingService {
  constructor(
    private bookings: BookingRepo,
    private rooms: RoomRepo,
    private bus: EventBus,
  ) {}

  create(guest: string, roomId: string, checkIn: string, checkOut: string): BookingDoc {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundError('room ' + roomId);
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1 || nights > config.maxNights) {
      throw new ValidationError('stay must be 1-' + config.maxNights + ' nights');
    }
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new ConflictError('room unavailable');
    const total = quote(room.type, checkIn, checkOut);
    const booking = this.bookings.insertOne({ roomId, guest, checkIn, checkOut, total, status: 'confirmed' });
    this.bus.emit('booking.created', booking);
    return booking;
  }

  cancel(guest: string, id: string): BookingDoc {
    const booking = this.bookings.findById(id);
    if (!booking) throw new NotFoundError('booking ' + id);
    if (booking.guest !== guest) throw new ForbiddenError('not your booking');
    if (booking.status === 'cancelled') return booking;
    this.bookings.updateOne(id, { status: 'cancelled' });
    const updated: BookingDoc = { ...booking, status: 'cancelled' };
    this.bus.emit('booking.cancelled', updated);
    return updated;
  }

  isAvailable(roomId: string, checkIn: string, checkOut: string): boolean {
    const start = toDay(checkIn);
    const end = toDay(checkOut);
    return this.bookings
      .find({ roomId, status: 'confirmed' })
      .every((b) => end <= toDay(b.checkIn) || start >= toDay(b.checkOut));
  }

  listFor(guest: string): BookingDoc[] {
    return this.bookings.find({ guest });
  }
}
`,
        },
        hints: [
          'The repository already supports equality filters on any field.',
          'Put the business rule ("only confirmed bookings occupy a room") in the service that owns it.',
        ],
        explanation:
          'Change the availability query to `find({ roomId, status: \'confirmed\' })`. The repository stays a dumb, general query layer, and the rule about which bookings occupy a room lives in `BookingService`, the only place that needs it. `listFor` keeps its unfiltered query, so history still shows cancelled stays.',
        timeLimitSec: 600,
        focusFile: 'src/services/bookingService.ts',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 2. Python — payments API with idempotency keys
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-py-payments-idempotency',
    title: 'Payments: Whose Idempotency Key Is It?',
    level: 3,
    rating: 1720,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'amazon', 'atlassian'],
    tags: ['idempotency', 'money', 'float-precision', 'tracing', 'multi-tenant'],
    summary: 'Two merchants, one idempotency key, one very confused ledger. Trace a charge through api → idempotency → service → gateway.',
    context:
      'You are on the payments platform team. A merchant (Globex) reports that a brand-new charge request came back as a **replay** of somebody else\'s charge, and finance separately noticed that some ledger amounts are off by one cent. You have the in-process version of the charge API to investigate.',
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# payments-core

Charge API with Stripe-style **idempotency keys**.

## Request flow

\`api.PaymentsApi.post_charge(merchant_id, headers, body)\`
1. Requires an \`Idempotency-Key\` header.
2. Looks the key up in \`IdempotencyStore\`. A stored response for the **same request body** is
   replayed (\`replayed=True\`). The same key with a **different body** returns \`422 idempotency_key_reused\`.
3. Otherwise parses the amount (\`money.py\`), calls \`PaymentService.charge\` and stores the response.

Keys are chosen by merchants (usually their order id), so they are only unique **per merchant**.

## What gets stored for replay

| Outcome | Status | Stored? |
| --- | --- | --- |
| success | 201 | yes |
| card declined | 402 | yes (retrying a decline must not re-hit the card network) |
| malformed request | 400 | no (client may fix and retry with the same key) |

## Modules

- \`payments/app.py\` — composition root (dependency injection by hand)
- \`payments/api.py\` — HTTP-ish layer
- \`payments/idempotency.py\` — fingerprinting + response store with TTL
- \`payments/money.py\` — amount parsing/formatting (integer cents everywhere)
- \`payments/service.py\` — business logic: limits, fees, ledger, events
- \`payments/gateway.py\` — card network client (fake)
- \`payments/ledger.py\` — double-entry-ish merchant ledger
- \`payments/events.py\` / \`payments/receipts.py\` — event bus and a subscriber
`,
      },
      {
        path: 'payments/config.py',
        content: `from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    fee_bps: int = 290           # 2.90 %
    fee_fixed_cents: int = 30
    max_charge_cents: int = 1_000_000
    idempotency_ttl_seconds: int = 24 * 3600
`,
      },
      {
        path: 'payments/money.py',
        content: `def parse_amount(text):
    """'12.34' -> 1234 cents. Rejects empty, negative and >2 decimal places."""
    if not isinstance(text, str) or not text:
        raise ValueError("amount must be a non-empty string")
    if text.startswith("-"):
        raise ValueError("amount must be positive")
    _whole, _dot, frac = text.partition(".")
    if len(frac) > 2:
        raise ValueError("at most 2 decimal places")
    return int(float(text) * 100)


def format_cents(cents):
    return f"{cents // 100}.{cents % 100:02d}"
`,
      },
      {
        path: 'payments/idempotency.py',
        content: `import hashlib
import json


class IdempotencyConflict(Exception):
    """Same key, different request body."""


def fingerprint(body):
    raw = json.dumps(body, sort_keys=True).encode()
    return hashlib.sha256(raw).hexdigest()[:16]


class IdempotencyStore:
    def __init__(self, clock, ttl_seconds):
        self._clock = clock
        self._ttl = ttl_seconds
        self._records = {}  # key -> (fingerprint, response, created_at)

    def lookup(self, key, fp):
        """Return the stored response, None if unseen/expired, or raise on body mismatch."""
        record = self._records.get(key)
        if record is None:
            return None
        stored_fp, response, created_at = record
        if self._clock() - created_at > self._ttl:
            del self._records[key]
            return None
        if stored_fp != fp:
            raise IdempotencyConflict(key)
        return response

    def save(self, key, fp, response):
        self._records[key] = (fp, response, self._clock())
`,
      },
      {
        path: 'payments/gateway.py',
        content: `class CardDeclined(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class FakeGateway:
    """Stands in for the card network. Counts calls so tests can assert on retries."""

    def __init__(self):
        self.calls = 0
        self._seq = 0

    def charge(self, card_token, amount_cents):
        self.calls += 1
        if card_token == "tok_declined":
            raise CardDeclined("insufficient_funds")
        self._seq += 1
        return f"{self._seq:04d}"
`,
      },
      {
        path: 'payments/ledger.py',
        content: `from dataclasses import dataclass


@dataclass
class Entry:
    merchant_id: str
    gross_cents: int
    fee_cents: int
    txn: str


class Ledger:
    def __init__(self):
        self.entries = []

    def record(self, merchant_id, gross_cents, fee_cents, txn):
        self.entries.append(Entry(merchant_id, gross_cents, fee_cents, txn))

    def net_balance(self, merchant_id):
        return sum(e.gross_cents - e.fee_cents for e in self.entries if e.merchant_id == merchant_id)
`,
      },
      {
        path: 'payments/events.py',
        content: `from collections import defaultdict


class EventBus:
    def __init__(self):
        self._subs = defaultdict(list)

    def subscribe(self, topic, handler):
        self._subs[topic].append(handler)

    def publish(self, topic, payload):
        for handler in self._subs[topic]:
            handler(payload)
`,
      },
      {
        path: 'payments/receipts.py',
        content: `class ReceiptMailer:
    def __init__(self, bus):
        self.outbox = []
        bus.subscribe("charge.succeeded", self.on_charge)

    def on_charge(self, charge):
        self.outbox.append(f"receipt {charge.id} for {charge.merchant_id}")
`,
      },
      {
        path: 'payments/service.py',
        content: `from dataclasses import dataclass


@dataclass(frozen=True)
class Charge:
    id: str
    merchant_id: str
    amount_cents: int
    fee_cents: int


class PaymentService:
    def __init__(self, gateway, ledger, bus, config):
        self._gateway = gateway
        self._ledger = ledger
        self._bus = bus
        self._config = config

    def charge(self, merchant_id, card_token, amount_cents):
        if amount_cents <= 0 or amount_cents > self._config.max_charge_cents:
            raise ValueError("amount out of range")
        txn = self._gateway.charge(card_token, amount_cents)  # may raise CardDeclined
        fee = self._fee(amount_cents)
        self._ledger.record(merchant_id, amount_cents, fee, txn)
        charge = Charge(f"ch_{txn}", merchant_id, amount_cents, fee)
        self._bus.publish("charge.succeeded", charge)
        return charge

    def _fee(self, amount_cents):
        return amount_cents * self._config.fee_bps // 10_000 + self._config.fee_fixed_cents
`,
      },
      {
        path: 'payments/api.py',
        content: `from dataclasses import dataclass, field

from payments.gateway import CardDeclined
from payments.idempotency import IdempotencyConflict, fingerprint
from payments.money import format_cents, parse_amount


@dataclass
class Response:
    status: int
    body: dict = field(default_factory=dict)
    replayed: bool = False


class PaymentsApi:
    def __init__(self, service, idempotency):
        self._service = service
        self._idem = idempotency

    def post_charge(self, merchant_id, headers, body):
        key = headers.get("Idempotency-Key")
        if not key:
            return Response(400, {"error": "missing Idempotency-Key"})
        fp = fingerprint(body)
        try:
            cached = self._idem.lookup(key, fp)
        except IdempotencyConflict:
            return Response(422, {"error": "idempotency_key_reused"})
        if cached is not None:
            return Response(cached.status, cached.body, replayed=True)

        try:
            amount = parse_amount(body.get("amount"))
            charge = self._service.charge(merchant_id, body.get("card"), amount)
            response = Response(201, {"id": charge.id, "amount": format_cents(charge.amount_cents)})
        except ValueError as e:
            return Response(400, {"error": str(e)})
        except CardDeclined as e:
            response = Response(402, {"error": "card_declined", "decline_code": e.code})
        self._idem.save(key, fp, response)
        return response
`,
      },
      {
        path: 'payments/app.py',
        content: `import time
from types import SimpleNamespace

from payments.api import PaymentsApi
from payments.config import Config
from payments.events import EventBus
from payments.gateway import FakeGateway
from payments.idempotency import IdempotencyStore
from payments.ledger import Ledger
from payments.receipts import ReceiptMailer
from payments.service import PaymentService


def build_app(clock=time.time, config=None):
    config = config or Config()
    bus = EventBus()
    gateway = FakeGateway()
    ledger = Ledger()
    mailer = ReceiptMailer(bus)
    service = PaymentService(gateway, ledger, bus, config)
    store = IdempotencyStore(clock, config.idempotency_ttl_seconds)
    api = PaymentsApi(service, store)
    return SimpleNamespace(api=api, gateway=gateway, ledger=ledger, mailer=mailer, store=store)
`,
      },
      {
        path: 'demo.py',
        content: `from payments.app import build_app

app = build_app(clock=lambda: 1000.0)
api = app.api

r1 = api.post_charge("m_acme", {"Idempotency-Key": "order-1"}, {"amount": "19.99", "card": "tok_visa"})
print(r1.status, r1.body["amount"], r1.replayed)

r2 = api.post_charge("m_acme", {"Idempotency-Key": "order-1"}, {"amount": "19.99", "card": "tok_visa"})
print(r2.status, r2.body["id"], r2.replayed)

r3 = api.post_charge("m_acme", {"Idempotency-Key": "order-1"}, {"amount": "25.00", "card": "tok_visa"})
print(r3.status)

r4 = api.post_charge("m_globex", {"Idempotency-Key": "order-1"}, {"amount": "19.99", "card": "tok_visa"})
print(r4.status, r4.body["id"], r4.replayed)

r5 = api.post_charge("m_acme", {"Idempotency-Key": "order-2"}, {"amount": "5.00", "card": "tok_declined"})
r6 = api.post_charge("m_acme", {"Idempotency-Key": "order-2"}, {"amount": "5.00", "card": "tok_declined"})
print(r5.status, r6.status, r6.replayed)

print(app.gateway.calls, app.ledger.net_balance("m_acme"), app.ledger.net_balance("m_globex"))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: what is stored for replay?',
        prompt:
          'Read `payments/api.py`. For a **first-time** key, which outcomes end with `self._idem.save(...)` being called? Select all that apply.',
        options: [
          'A successful charge (201)',
          'A declined card (402)',
          'An amount with three decimal places (400)',
          'An amount above `max_charge_cents` (400)',
          'Reusing the key with a different body (422)',
        ],
        correct: [0, 1],
        hints: [
          'Look at which `except` branches `return` immediately and which fall through to `save`.',
          'Where is the over-limit check, and what exception type does it raise?',
        ],
        explanation:
          'Success and `CardDeclined` both assign `response` and fall through to `save`. Every `ValueError` (bad format from `money.py` **and** the over-limit check in `PaymentService.charge`) returns early with 400, so the client can correct the request and retry with the same key. The 422 path returns before any work. This matches the table in the README, which is always worth cross-checking against the code.',
        timeLimitSec: 300,
        focusFile: 'payments/api.py',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Predict the demo',
        prompt: 'What does `demo.py` print? Fees are 2.90% (integer division) + 30 cents.',
        entry: 'demo.py',
        answer: '201 19.98 False\n201 ch_0001 True\n422\n201 ch_0001 True\n402 402 True\n2 1911 0',
        options: [
          '201 19.98 False\n201 ch_0001 True\n422\n201 ch_0001 True\n402 402 True\n2 1911 0',
          '201 19.99 False\n201 ch_0001 True\n422\n201 ch_0002 False\n402 402 True\n3 1912 1912',
          '201 19.99 False\n201 ch_0001 True\n422\n201 ch_0001 True\n402 402 True\n2 1912 0',
          '201 19.98 False\n201 ch_0001 True\n422\n201 ch_0002 False\n402 402 False\n4 1911 1911',
        ],
        hints: [
          'What is `float("19.99") * 100` exactly, and what does `int()` do to it?',
          'The store is a dict keyed by... what? Does `merchant_id` reach it?',
          'Fee on 1998 cents: 1998 * 290 // 10000 + 30.',
        ],
        explanation:
          '`float("19.99") * 100` is `1998.9999999999998`; `int()` truncates to **1998** cents, so the response says `19.98`. r2 is a true replay. r3 reuses the key with another body → 422. r4 is from a **different merchant** but the store is keyed only by the raw key, and the body is identical, so Globex receives Acme\'s `ch_0001` as a replay: the reported bug. The decline (r5) is stored, so r6 is a replay and the gateway is not hit again. Gateway calls: r1 + r5 = 2. Acme net = 1998 − (57 + 30) = 1911; Globex never got a ledger entry.',
        timeLimitSec: 480,
        focusFile: 'demo.py',
      },
      {
        id: 's4',
        kind: 'find-bug',
        title: 'The missing cent',
        prompt: 'Finance says `"19.99"` was booked as 1998 cents. Click the line responsible and pick the root cause.',
        file: 'payments/money.py',
        lines: [10],
        options: [
          'Binary floating point cannot represent 19.99 exactly, and `int()` truncates 1998.999… down to 1998',
          '`partition(".")` drops the fractional part before conversion',
          '`format_cents` uses floor division, which loses a cent on display only',
          'The fee calculation in `service.py` rounds the gross amount down',
        ],
        correct: 0,
        hints: ['Try the arithmetic in a REPL: `float("19.99") * 100`.'],
        explanation:
          'Money must never pass through binary floats. Parse the digits directly (e.g. `int(whole) * 100 + int(frac.ljust(2, "0"))`) or use `Decimal`. `round()` would happen to work at these magnitudes but hides the real problem. `format_cents` is correct for non-negative integers, and the ledger stores whatever it is given.',
        timeLimitSec: 240,
        focusFile: 'payments/money.py',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review the cent fix',
        prompt: 'The assistant proposes a fix for the missing cent. Should you accept it?',
        persona: 'confident-intern',
        request: 'Fix parse_amount so "19.99" becomes 1999 cents.',
        aiReply: `Floats are the problem, so switch to \`Decimal\` — that's what it's for:

\`\`\`python
from decimal import Decimal

def parse_amount(text):
    """'12.34' -> 1234 cents. Rejects empty, negative and >2 decimal places."""
    if not isinstance(text, str) or not text:
        raise ValueError("amount must be a non-empty string")
    if text.startswith("-"):
        raise ValueError("amount must be positive")
    _whole, _dot, frac = text.partition(".")
    if len(frac) > 2:
        raise ValueError("at most 2 decimal places")
    return int(Decimal(text) * 100)
\`\`\`

\`Decimal("19.99") * 100 == Decimal("1999.00")\`, so this is exact. Ship it! 🚀`,
        options: [
          'Accept: Decimal arithmetic is exact for these inputs',
          'Reject: `Decimal(text) * 100` still goes through a float internally',
          'Reject: for a malformed amount like `"12,50"`, `Decimal` raises `decimal.InvalidOperation`, which is not a `ValueError`, so `post_charge` no longer returns 400 and the exception escapes the API',
          'Reject: `int()` on a Decimal rounds half-up and would overcharge',
        ],
        correct: 2,
        hints: [
          'What did `float("12,50")` raise before, and which `except` in `api.py` caught it?',
          'Check the MRO of `decimal.InvalidOperation`.',
        ],
        explanation:
          'The arithmetic is right: `Decimal("19.99") * 100` is exact. But the **error contract** changed. `float("abc")` raises `ValueError`, which `api.py` maps to 400. `Decimal("abc")` raises `decimal.InvalidOperation` (an `ArithmeticError`, not a `ValueError`), so it escapes `post_charge` as an unhandled exception. A correct version catches `InvalidOperation` and re-raises `ValueError`, or parses the digits explicitly. To review a change properly you have to follow what the *callers* expect, not just the happy path.',
        timeLimitSec: 300,
        focusFile: 'payments/api.py',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'fix',
        title: 'Scope idempotency keys per merchant',
        prompt:
          'Idempotency keys are only unique **per merchant** (see README). Fix the service so that the same key used by two merchants creates two independent charges, while replays and `422` conflicts still work within a merchant.',
        editable: ['payments/api.py', 'payments/idempotency.py'],
        tests: [
          {
            path: 'tests/test_idempotency_scope.py',
            content: `from payments.app import build_app


def _app():
    return build_app(clock=lambda: 1000.0)


def test_same_key_different_merchants_are_independent():
    app = _app()
    a = app.api.post_charge("m_acme", {"Idempotency-Key": "order-1"}, {"amount": "10.00", "card": "tok_visa"})
    g = app.api.post_charge("m_globex", {"Idempotency-Key": "order-1"}, {"amount": "10.00", "card": "tok_visa"})
    assert a.status == 201 and g.status == 201
    assert g.replayed is False
    assert a.body["id"] != g.body["id"]
    assert app.gateway.calls == 2
    assert app.ledger.net_balance("m_globex") == 1000 - (29 + 30)


def test_replay_within_merchant_still_works():
    app = _app()
    app.api.post_charge("m_acme", {"Idempotency-Key": "k"}, {"amount": "10.00", "card": "tok_visa"})
    again = app.api.post_charge("m_acme", {"Idempotency-Key": "k"}, {"amount": "10.00", "card": "tok_visa"})
    assert again.replayed is True
    assert app.gateway.calls == 1


def test_conflict_is_per_merchant():
    app = _app()
    app.api.post_charge("m_acme", {"Idempotency-Key": "k"}, {"amount": "10.00", "card": "tok_visa"})
    assert app.api.post_charge("m_acme", {"Idempotency-Key": "k"}, {"amount": "11.00", "card": "tok_visa"}).status == 422
    other = app.api.post_charge("m_globex", {"Idempotency-Key": "k"}, {"amount": "11.00", "card": "tok_visa"})
    assert other.status == 201


def test_declines_replayed_per_merchant():
    app = _app()
    app.api.post_charge("m_acme", {"Idempotency-Key": "d"}, {"amount": "5.00", "card": "tok_declined"})
    r = app.api.post_charge("m_globex", {"Idempotency-Key": "d"}, {"amount": "5.00", "card": "tok_declined"})
    assert r.status == 402 and r.replayed is False
    assert app.gateway.calls == 2
`,
          },
        ],
        solution: {
          'payments/api.py': `from dataclasses import dataclass, field

from payments.gateway import CardDeclined
from payments.idempotency import IdempotencyConflict, fingerprint
from payments.money import format_cents, parse_amount


@dataclass
class Response:
    status: int
    body: dict = field(default_factory=dict)
    replayed: bool = False


class PaymentsApi:
    def __init__(self, service, idempotency):
        self._service = service
        self._idem = idempotency

    def post_charge(self, merchant_id, headers, body):
        key = headers.get("Idempotency-Key")
        if not key:
            return Response(400, {"error": "missing Idempotency-Key"})
        scoped_key = (merchant_id, key)
        fp = fingerprint(body)
        try:
            cached = self._idem.lookup(scoped_key, fp)
        except IdempotencyConflict:
            return Response(422, {"error": "idempotency_key_reused"})
        if cached is not None:
            return Response(cached.status, cached.body, replayed=True)

        try:
            amount = parse_amount(body.get("amount"))
            charge = self._service.charge(merchant_id, body.get("card"), amount)
            response = Response(201, {"id": charge.id, "amount": format_cents(charge.amount_cents)})
        except ValueError as e:
            return Response(400, {"error": str(e)})
        except CardDeclined as e:
            response = Response(402, {"error": "card_declined", "decline_code": e.code})
        self._idem.save(scoped_key, fp, response)
        return response
`,
        },
        hints: [
          'Where is the store key built, and does that code know the merchant?',
          'Use a composite key (a tuple, or a string that cannot collide) for **both** `lookup` and `save`.',
        ],
        explanation:
          'The API layer is the only place that knows both the merchant and the client key, so build a composite key there, e.g. `(merchant_id, key)`, and use it for both `lookup` and `save`. A tuple avoids collisions that naive string concatenation can cause (`"a:b" + ":c"` vs `"a" + ":b:c"`). Forgetting to change `save` as well is the most common partial fix: the lookup would never find anything and every retry would charge the card again.',
        timeLimitSec: 600,
        focusFile: 'payments/api.py',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 3. TypeScript — token bucket rate limiter middleware
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-ts-token-bucket-gateway',
    title: 'API Gateway: Leaky Token Buckets',
    level: 3,
    rating: 1620,
    lang: 'typescript',
    domain: 'rate-limiter',
    companies: ['google', 'canva', 'stripe', 'amazon'],
    tags: ['token-bucket', 'middleware', 'config', 'multi-tenant', 'injected-clock'],
    summary: 'Expensive endpoints cost one token and tenants with two keys get double the quota. Find out where the limiter lost the plot.',
    context:
      'You own the public API gateway. The search cluster is overloaded, and capacity planning shows free-tier tenants making far more `/search` calls than their quota allows. Some tenants also seem to get twice the limit. The gateway uses a token-bucket limiter that runs as middleware.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# api-gateway

Request pipeline: \`authenticate\` → \`rateLimit\` → route handler.

## Rate limiting

- Token bucket **per tenant**: every API key belonging to a tenant draws from the same bucket.
- Bucket size and refill rate come from the tenant's plan (\`src/config.ts\` → \`PLANS\`).
- Each route has a token **cost** (\`ROUTE_COSTS\`, keyed by \`"METHOD /path"\`); unlisted routes cost \`DEFAULT_COST\`.
- Responses carry \`X-RateLimit-Limit\` and \`X-RateLimit-Remaining\` (whole tokens, rounded down).
- A 429 carries \`Retry-After\` in whole seconds (rounded up).

## Layout

| Path | Role |
| --- | --- |
| \`src/server.ts\` | Composition root and pipeline runner |
| \`src/http.ts\` | Request/Response/Middleware types |
| \`src/middleware/authenticate.ts\` | Resolves \`x-api-key\` to a client (tenant + plan) |
| \`src/middleware/rateLimit.ts\` | Computes cost, asks the limiter, writes headers |
| \`src/limiter/rateLimiter.ts\` | Picks the bucket and plan limits |
| \`src/limiter/bucketStore.ts\` | Lazily creates buckets, one per key |
| \`src/limiter/tokenBucket.ts\` | Refill + take arithmetic |
| \`src/services/apiKeys.ts\` | Key → tenant → plan lookup |
| \`src/clock.ts\` | Injectable clock (\`ManualClock\` in tests) |
`,
      },
      {
        path: 'src/config.ts',
        content: `export interface PlanLimits {
  capacity: number;
  refillPerSec: number;
}

export const PLANS: Record<string, PlanLimits> = {
  free: { capacity: 5, refillPerSec: 1 },
  pro: { capacity: 50, refillPerSec: 10 },
};

/** Token cost per route, keyed by "METHOD /path". Unlisted routes cost DEFAULT_COST. */
export const ROUTE_COSTS: Record<string, number> = {
  'GET /search': 3,
  'POST /export': 5,
};

export const DEFAULT_COST = 1;
`,
      },
      {
        path: 'src/clock.ts',
        content: `export interface Clock {
  now(): number; // milliseconds
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

export const systemClock: Clock = { now: () => Date.now() };
`,
      },
      {
        path: 'src/http.ts',
        content: `import type { Client } from './services/apiKeys';

export interface Request {
  method: string;
  path: string;
  headers: Record<string, string>;
  client?: Client;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Handler = (req: Request) => Response;
export type Middleware = (req: Request, next: () => Response) => Response;
`,
      },
      {
        path: 'src/services/apiKeys.ts',
        content: `export interface Client {
  apiKey: string;
  tenantId: string;
  plan: string;
}

export class ApiKeyService {
  private keyToTenant = new Map<string, string>();
  private tenantPlan = new Map<string, string>();

  addTenant(tenantId: string, plan: string): void {
    this.tenantPlan.set(tenantId, plan);
  }

  issueKey(apiKey: string, tenantId: string): void {
    if (!this.tenantPlan.has(tenantId)) throw new Error('unknown tenant ' + tenantId);
    this.keyToTenant.set(apiKey, tenantId);
  }

  setPlan(tenantId: string, plan: string): void {
    this.tenantPlan.set(tenantId, plan);
  }

  resolve(apiKey: string | undefined): Client | null {
    if (!apiKey) return null;
    const tenantId = this.keyToTenant.get(apiKey);
    if (!tenantId) return null;
    return { apiKey, tenantId, plan: this.tenantPlan.get(tenantId)! };
  }
}
`,
      },
      {
        path: 'src/limiter/tokenBucket.ts',
        content: `export interface TakeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(readonly capacity: number, readonly refillPerSec: number, nowMs: number) {
    this.tokens = capacity;
    this.lastRefillMs = nowMs;
  }

  private refill(nowMs: number): void {
    const elapsedSec = (nowMs - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefillMs = nowMs;
  }

  take(cost: number, nowMs: number): TakeResult {
    this.refill(nowMs);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true, remaining: Math.floor(this.tokens), retryAfterMs: 0 };
    }
    const deficit = cost - this.tokens;
    return {
      allowed: false,
      remaining: Math.floor(this.tokens),
      retryAfterMs: Math.ceil((deficit / this.refillPerSec) * 1000),
    };
  }
}
`,
      },
      {
        path: 'src/limiter/bucketStore.ts',
        content: `import type { Clock } from '../clock';
import type { PlanLimits } from '../config';
import { TokenBucket } from './tokenBucket';

/** Lazily creates one bucket per key. Buckets start full. */
export class BucketStore {
  private buckets = new Map<string, TokenBucket>();

  constructor(private clock: Clock) {}

  get(key: string, limits: PlanLimits): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(limits.capacity, limits.refillPerSec, this.clock.now());
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  size(): number {
    return this.buckets.size;
  }
}
`,
      },
      {
        path: 'src/limiter/rateLimiter.ts',
        content: `import type { Clock } from '../clock';
import type { PlanLimits } from '../config';
import type { Client } from '../services/apiKeys';
import { BucketStore } from './bucketStore';

export interface Decision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
}

export class RateLimiter {
  constructor(
    private store: BucketStore,
    private plans: Record<string, PlanLimits>,
    private clock: Clock,
  ) {}

  check(client: Client, cost: number): Decision {
    const limits = this.plans[client.plan];
    if (!limits) throw new Error('unknown plan ' + client.plan);
    const bucket = this.store.get(client.apiKey, limits);
    const result = bucket.take(cost, this.clock.now());
    return { ...result, limit: limits.capacity };
  }
}
`,
      },
      {
        path: 'src/middleware/authenticate.ts',
        content: `import type { Middleware } from '../http';
import { ApiKeyService } from '../services/apiKeys';

export function authenticate(keys: ApiKeyService): Middleware {
  return (req, next) => {
    const client = keys.resolve(req.headers['x-api-key']);
    if (!client) return { status: 401, headers: {}, body: 'invalid api key' };
    req.client = client;
    return next();
  };
}
`,
      },
      {
        path: 'src/middleware/rateLimit.ts',
        content: `import { DEFAULT_COST, ROUTE_COSTS } from '../config';
import type { Middleware } from '../http';
import { RateLimiter } from '../limiter/rateLimiter';
import { Metrics } from '../metrics';

export function rateLimit(limiter: RateLimiter, metrics: Metrics): Middleware {
  return (req, next) => {
    const cost = ROUTE_COSTS[req.path] ?? DEFAULT_COST;
    const decision = limiter.check(req.client!, cost);
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
    };
    if (!decision.allowed) {
      metrics.inc('throttled');
      headers['Retry-After'] = String(Math.ceil(decision.retryAfterMs / 1000));
      return { status: 429, headers, body: 'slow down' };
    }
    metrics.inc('allowed');
    const res = next();
    return { ...res, headers: { ...headers, ...res.headers } };
  };
}
`,
      },
      {
        path: 'src/metrics.ts',
        content: `export class Metrics {
  private counters = new Map<string, number>();

  inc(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0;
  }
}
`,
      },
      {
        path: 'src/server.ts',
        content: `import { Clock, systemClock } from './clock';
import { PLANS } from './config';
import type { Handler, Middleware, Request, Response } from './http';
import { BucketStore } from './limiter/bucketStore';
import { RateLimiter } from './limiter/rateLimiter';
import { Metrics } from './metrics';
import { authenticate } from './middleware/authenticate';
import { rateLimit } from './middleware/rateLimit';
import { ApiKeyService } from './services/apiKeys';

const routes: Record<string, Handler> = {
  'GET /search': () => ({ status: 200, headers: {}, body: 'results' }),
  'GET /items': () => ({ status: 200, headers: {}, body: 'items' }),
  'POST /export': () => ({ status: 202, headers: {}, body: 'export queued' }),
};

export function createServer(clock: Clock = systemClock) {
  const apiKeys = new ApiKeyService();
  const metrics = new Metrics();
  const store = new BucketStore(clock);
  const limiter = new RateLimiter(store, PLANS, clock);
  const pipeline: Middleware[] = [authenticate(apiKeys), rateLimit(limiter, metrics)];

  function handle(req: Request): Response {
    const route = routes[req.method + ' ' + req.path];
    if (!route) return { status: 404, headers: {}, body: 'not found' };
    let i = 0;
    const next = (): Response => (i < pipeline.length ? pipeline[i++](req, next) : route(req));
    return next();
  }

  return { handle, apiKeys, metrics, store };
}
`,
      },
      {
        path: 'demo.ts',
        content: `import { ManualClock } from './src/clock';
import { createServer } from './src/server';

const clock = new ManualClock(0);
const { handle, apiKeys, metrics, store } = createServer(clock);
apiKeys.addTenant('acme', 'free');
apiKeys.issueKey('k1', 'acme');
apiKeys.issueKey('k2', 'acme');

function hit(label: string, method: string, path: string, key?: string) {
  const res = handle({ method, path, headers: key ? { 'x-api-key': key } : {} });
  const remaining = res.headers['X-RateLimit-Remaining'] ?? '-';
  const retry = res.headers['Retry-After'] ?? '-';
  console.log(label, res.status, remaining, retry);
}

hit('a', 'GET', '/search', 'k1');
hit('b', 'GET', '/search', 'k1');
hit('c', 'POST', '/export', 'k1');
hit('d', 'GET', '/search', 'k2');
hit('e', 'GET', '/search');
hit('f', 'GET', '/items', 'k1');
hit('g', 'GET', '/items', 'k1');
hit('h', 'GET', '/items', 'k1');
clock.advance(1500);
hit('i', 'GET', '/items', 'k1');
hit('j', 'GET', '/items', 'k1');
console.log(metrics.get('throttled'), store.size());
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace an allowed GET /search',
        prompt: 'Order what happens when a valid key calls `GET /search` and is allowed through.',
        items: [
          'server.handle finds the route for "GET /search"',
          'authenticate resolves x-api-key via ApiKeyService.resolve',
          'rateLimit looks up the route cost in ROUTE_COSTS',
          'RateLimiter.check picks the plan limits and asks BucketStore for a bucket',
          'TokenBucket.take refills from elapsed time, then subtracts the cost',
          'rateLimit increments the "allowed" metric and calls next()',
          'The search handler returns 200',
          'rateLimit merges the X-RateLimit-* headers into the response',
        ],
        hints: [
          'The pipeline order is set in `createServer`.',
          'Does `rateLimit` add its headers before or after calling `next()`?',
        ],
        explanation:
          '`handle` resolves the route first (unknown routes 404 without spending tokens), then runs the middleware array in order. `rateLimit` decides **before** calling `next()`, and wraps the handler\'s response with its headers **after** it returns. Inside the limiter, the bucket refills lazily on every `take`, so there is no background timer.',
        timeLimitSec: 360,
        focusFile: 'src/server.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Run the demo',
        prompt: 'Predict exactly what `demo.ts` prints. Each line is `label status remaining retryAfter`.',
        entry: 'demo.ts',
        answer:
          'a 200 4 -\nb 200 3 -\nc 202 2 -\nd 200 4 -\ne 401 - -\nf 200 1 -\ng 200 0 -\nh 429 0 1\ni 200 0 -\nj 429 0 1\n2 2',
        options: [
          'a 200 4 -\nb 200 3 -\nc 202 2 -\nd 200 4 -\ne 401 - -\nf 200 1 -\ng 200 0 -\nh 429 0 1\ni 200 0 -\nj 429 0 1\n2 2',
          'a 200 2 -\nb 429 2 1\nc 429 2 3\nd 429 2 1\ne 401 - -\nf 200 1 -\ng 200 0 -\nh 429 0 1\ni 200 0 -\nj 429 0 1\n6 1',
          'a 200 4 -\nb 200 3 -\nc 202 2 -\nd 200 1 -\ne 401 - -\nf 200 0 -\ng 429 0 1\nh 429 0 1\ni 200 0 -\nj 429 0 1\n3 1',
          'a 200 4 -\nb 200 3 -\nc 202 2 -\nd 200 4 -\ne 401 - -\nf 200 1 -\ng 200 0 -\nh 429 0 1\ni 200 1 -\nj 200 0 -\n1 2',
        ],
        hints: [
          'What string does `rateLimit` use to index `ROUTE_COSTS`? What are the keys in `ROUTE_COSTS`?',
          'Which field of the client does `RateLimiter.check` pass to `BucketStore.get`?',
          'After 1.5 s at 1 token/s, an empty bucket has 1.5 tokens. What is left after taking 1?',
        ],
        explanation:
          '`rateLimit` looks up `ROUTE_COSTS[req.path]`, e.g. `"/search"`, but the keys are `"GET /search"`, so **every route costs 1**. a, b, c spend k1\'s bucket 5 → 2. The limiter keys buckets by `apiKey`, so k2 gets its **own** full bucket (d → 4) even though it belongs to the same tenant. e has no key → 401 from `authenticate`, with no rate-limit headers. f, g drain k1 to 0, and h is throttled: deficit 1 token / 1 per s → `Retry-After: 1`. After 1500 ms: 1.5 tokens, i takes 1 (0.5 left, shown as 0), j needs 0.5 more → 500 ms → rounded up to 1 s. Two throttles, and two buckets exist (k1 and k2).',
        timeLimitSec: 540,
        focusFile: 'demo.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Why is search so cheap?',
        prompt: 'Free tenants are doing 5 searches per burst instead of 1. Click the faulty line and pick the root cause.',
        file: 'src/middleware/rateLimit.ts',
        lines: [8],
        options: [
          'The cost lookup uses `req.path`, but `ROUTE_COSTS` is keyed by `"METHOD /path"`, so it always falls back to `DEFAULT_COST`',
          '`??` should be `||`, because a cost of 0 must fall back to the default',
          '`TokenBucket.take` refills before subtracting, so it gives away free tokens',
          '`Retry-After` is rounded up instead of down',
        ],
        correct: 0,
        hints: ['Compare the comment above `ROUTE_COSTS` with the expression that indexes it.'],
        explanation:
          'Line 8 indexes the cost map with `"/search"`, while the config (and the router in `server.ts`) use `"GET /search"`. The lookup quietly returns `undefined` and `??` substitutes 1. Bugs that cross a config/code boundary like this are invisible in either file on its own, so always check that the *key format* matches on both sides. Refilling before taking is correct token-bucket behaviour.',
        timeLimitSec: 240,
        focusFile: 'src/middleware/rateLimit.ts',
      },
      {
        id: 's4',
        kind: 'mcq',
        title: 'What happens on a plan upgrade?',
        prompt:
          'Tenant `acme` has been calling the API on the **free** plan. Support runs `apiKeys.setPlan(\'acme\', \'pro\')`. On acme\'s next request with an existing key, what is true? Select all that apply.',
        options: [
          '`X-RateLimit-Limit` reports 50',
          'The bucket can now hold up to 50 tokens',
          'The bucket still refills at 1 token/s',
          'A new bucket is created because the plan changed',
          '`RateLimiter.check` throws because the bucket and plan disagree',
        ],
        correct: [0, 2],
        hints: [
          '`resolve()` reads the plan fresh every request. Which value does `check` put in `limit`?',
          'When does `BucketStore.get` actually use the `limits` argument?',
        ],
        explanation:
          '`resolve` returns `plan: \'pro\'`, so `limits` is the pro config and `limit: limits.capacity` reports **50**. But `BucketStore.get` only uses `limits` when it *creates* a bucket; the cached `TokenBucket` keeps `capacity 5` and `refillPerSec 1` (both `readonly`). The header now lies to the client. Spotting "configuration captured at construction time" is a key cross-file reading skill, and a good follow-up ticket.',
        timeLimitSec: 300,
        focusFile: 'src/limiter/bucketStore.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Make the limiter match the README',
        prompt:
          'Fix both defects so the gateway matches the README:\n\n1. Route costs must be honoured (`GET /search` costs 3, `POST /export` costs 5).\n2. Buckets are **per tenant**: all keys of a tenant share one bucket; different tenants are independent.',
        editable: ['src/middleware/rateLimit.ts', 'src/limiter/rateLimiter.ts'],
        tests: [
          {
            path: 'tests/limiter.test.ts',
            content: `import { ManualClock } from '../src/clock';
import { createServer } from '../src/server';

function setup() {
  const clock = new ManualClock(0);
  const s = createServer(clock);
  s.apiKeys.addTenant('acme', 'free');
  s.apiKeys.addTenant('globex', 'free');
  s.apiKeys.issueKey('k1', 'acme');
  s.apiKeys.issueKey('k2', 'acme');
  s.apiKeys.issueKey('g1', 'globex');
  const hit = (method: string, path: string, key: string) => s.handle({ method, path, headers: { 'x-api-key': key } });
  return { ...s, clock, hit };
}

test('search costs 3 tokens', () => {
  const { hit } = setup();
  const first = hit('GET', '/search', 'k1');
  expect(first.status).toBe(200);
  expect(first.headers['X-RateLimit-Remaining']).toBe('2');
  const second = hit('GET', '/search', 'k1');
  expect(second.status).toBe(429);
  expect(second.headers['Retry-After']).toBe('1');
});

test('export costs 5 tokens', () => {
  const { hit, clock } = setup();
  expect(hit('POST', '/export', 'k1').status).toBe(202);
  expect(hit('GET', '/items', 'k1').status).toBe(429);
  clock.advance(1000);
  expect(hit('GET', '/items', 'k1').status).toBe(200);
});

test('keys of one tenant share a bucket', () => {
  const { hit, store } = setup();
  hit('GET', '/search', 'k1');
  const viaK2 = hit('GET', '/items', 'k2');
  expect(viaK2.headers['X-RateLimit-Remaining']).toBe('1');
  expect(store.size()).toBe(1);
});

test('tenants are independent', () => {
  const { hit } = setup();
  hit('POST', '/export', 'k1');
  const g = hit('GET', '/search', 'g1');
  expect(g.status).toBe(200);
  expect(g.headers['X-RateLimit-Remaining']).toBe('2');
});
`,
          },
        ],
        solution: {
          'src/middleware/rateLimit.ts': `import { DEFAULT_COST, ROUTE_COSTS } from '../config';
import type { Middleware } from '../http';
import { RateLimiter } from '../limiter/rateLimiter';
import { Metrics } from '../metrics';

export function rateLimit(limiter: RateLimiter, metrics: Metrics): Middleware {
  return (req, next) => {
    const cost = ROUTE_COSTS[req.method + ' ' + req.path] ?? DEFAULT_COST;
    const decision = limiter.check(req.client!, cost);
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
    };
    if (!decision.allowed) {
      metrics.inc('throttled');
      headers['Retry-After'] = String(Math.ceil(decision.retryAfterMs / 1000));
      return { status: 429, headers, body: 'slow down' };
    }
    metrics.inc('allowed');
    const res = next();
    return { ...res, headers: { ...headers, ...res.headers } };
  };
}
`,
          'src/limiter/rateLimiter.ts': `import type { Clock } from '../clock';
import type { PlanLimits } from '../config';
import type { Client } from '../services/apiKeys';
import { BucketStore } from './bucketStore';

export interface Decision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
}

export class RateLimiter {
  constructor(
    private store: BucketStore,
    private plans: Record<string, PlanLimits>,
    private clock: Clock,
  ) {}

  check(client: Client, cost: number): Decision {
    const limits = this.plans[client.plan];
    if (!limits) throw new Error('unknown plan ' + client.plan);
    const bucket = this.store.get(client.tenantId, limits);
    const result = bucket.take(cost, this.clock.now());
    return { ...result, limit: limits.capacity };
  }
}
`,
        },
        hints: [
          'Build the cost key the same way `server.ts` builds the route key.',
          'Which field of `Client` identifies the tenant rather than the key?',
        ],
        explanation:
          'Use `ROUTE_COSTS[req.method + \' \' + req.path]` so the key format matches config, and key buckets by `client.tenantId`. Both fixes are one-liners, but finding them meant reading four files: config, middleware, limiter and the API-key service. In production you would also handle the plan-upgrade issue from the previous stage, e.g. by keying buckets by `tenantId:plan` or by rebuilding the bucket when its limits differ.',
        timeLimitSec: 600,
        focusFile: 'src/middleware/rateLimit.ts',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 4. Python — feature flag evaluation with cache + exposure observers
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-py-feature-flags-cache',
    title: 'Feature Flags: Everyone Gets Bo\'s Flags',
    level: 3,
    rating: 1580,
    lang: 'python',
    domain: 'feature-flags',
    companies: ['meta', 'atlassian', 'canva', 'microsoft'],
    tags: ['caching', 'observer', 'hashing', 'rollout', 'precedence'],
    summary: 'A "quick performance win" cached flag results. Now targeting is broken and the kill switch leaks. Navigate client → cache → evaluator → bucketing.',
    context:
      'You work on the in-house feature-flag SDK. Last sprint someone added a TTL cache to `FlagClient` "to cut evaluation CPU by 90%". Since then, QA says that allow-listed users sometimes do not see their flag, and a flag rolled out to **0%** is still enabled for a few real users.',
    persona: 'outdated-docs',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# flagkit

Server-side feature flag SDK.

## Evaluation order (first match wins)

1. Flag missing → \`False\`, reason \`FLAG_NOT_FOUND\`
2. Flag disabled (kill switch) → \`False\`, \`OFF\` — even for targeted users
3. User id in \`targets\` → \`True\`, \`TARGET\`
4. Any rule matches the user's attributes → \`True\`, \`RULE_MATCH\`
5. Percentage rollout: users whose bucket (0-99) is below \`rollout\` → \`True\`, \`ROLLOUT\`
6. Otherwise → \`False\`, \`FALLTHROUGH\`

\`rollout: 0\` means nobody, \`rollout: 100\` means everybody.

## Modules

| Module | Role |
| --- | --- |
| \`flags/app.py\` | Wiring; \`reload()\` swaps config and clears the cache |
| \`flags/client.py\` | Public API: \`evaluate\`, \`is_enabled\`; caches results; notifies observers |
| \`flags/cache.py\` | TTL cache with an injected clock |
| \`flags/evaluator.py\` | Implements the evaluation order above |
| \`flags/rules.py\` | Attribute rule operators |
| \`flags/bucketing.py\` | Stable hash of \`flag_key:user_id\` into 0-99 |
| \`flags/repository.py\` | Parses raw config into \`Flag\` models |
| \`flags/analytics.py\` | Exposure log observer (feeds experiment analysis) |
`,
      },
      {
        path: 'flags/models.py',
        content: `from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rule:
    attribute: str
    op: str  # "in" | "not_in" | "ends_with"
    values: tuple


@dataclass
class Flag:
    key: str
    enabled: bool
    rollout_percent: int = 0
    targets: frozenset = frozenset()
    rules: list = field(default_factory=list)


@dataclass(frozen=True)
class Context:
    user_id: str
    attributes: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Evaluation:
    flag_key: str
    value: bool
    reason: str
`,
      },
      {
        path: 'flags/repository.py',
        content: `from flags.models import Flag, Rule


def _parse(key, spec):
    return Flag(
        key=key,
        enabled=spec.get("enabled", False),
        rollout_percent=spec.get("rollout", 0),
        targets=frozenset(spec.get("targets", [])),
        rules=[Rule(r["attr"], r["op"], tuple(r["values"])) for r in spec.get("rules", [])],
    )


class FlagRepository:
    def __init__(self, raw_config):
        self.version = 0
        self._flags = {}
        self.load(raw_config)

    def load(self, raw_config):
        self._flags = {key: _parse(key, spec) for key, spec in raw_config.items()}
        self.version += 1

    def get(self, key):
        return self._flags.get(key)
`,
      },
      {
        path: 'flags/bucketing.py',
        content: `import hashlib


def bucket(flag_key, user_id):
    """Stable bucket in [0, 99] for this user on this flag."""
    digest = hashlib.sha1(f"{flag_key}:{user_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100
`,
      },
      {
        path: 'flags/rules.py',
        content: `def matches(rule, ctx):
    actual = ctx.attributes.get(rule.attribute)
    if actual is None:
        return False
    if rule.op == "in":
        return actual in rule.values
    if rule.op == "not_in":
        return actual not in rule.values
    if rule.op == "ends_with":
        return any(str(actual).endswith(v) for v in rule.values)
    raise ValueError(f"unknown operator {rule.op}")
`,
      },
      {
        path: 'flags/evaluator.py',
        content: `from flags.bucketing import bucket
from flags.models import Evaluation
from flags.rules import matches


class Evaluator:
    def __init__(self, repository):
        self._repo = repository

    def evaluate(self, flag_key, ctx):
        flag = self._repo.get(flag_key)
        if flag is None:
            return Evaluation(flag_key, False, "FLAG_NOT_FOUND")
        if not flag.enabled:
            return Evaluation(flag_key, False, "OFF")
        if ctx.user_id in flag.targets:
            return Evaluation(flag_key, True, "TARGET")
        for rule in flag.rules:
            if matches(rule, ctx):
                return Evaluation(flag_key, True, "RULE_MATCH")
        if bucket(flag.key, ctx.user_id) <= flag.rollout_percent:
            return Evaluation(flag_key, True, "ROLLOUT")
        return Evaluation(flag_key, False, "FALLTHROUGH")
`,
      },
      {
        path: 'flags/cache.py',
        content: `class TtlCache:
    def __init__(self, clock, ttl_seconds):
        self._clock = clock
        self._ttl = ttl_seconds
        self._entries = {}  # key -> (value, expires_at)

    def get(self, key):
        entry = self._entries.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if self._clock() >= expires_at:
            del self._entries[key]
            return None
        return value

    def put(self, key, value):
        self._entries[key] = (value, self._clock() + self._ttl)

    def clear(self):
        self._entries.clear()

    def __len__(self):
        return len(self._entries)
`,
      },
      {
        path: 'flags/client.py',
        content: `class FlagClient:
    """Public SDK surface. Results are cached for a short TTL to save CPU."""

    def __init__(self, evaluator, cache):
        self._evaluator = evaluator
        self._cache = cache
        self._observers = []

    def subscribe(self, observer):
        self._observers.append(observer)

    def evaluate(self, flag_key, ctx):
        evaluation = self._cache.get(flag_key)
        if evaluation is None:
            evaluation = self._evaluator.evaluate(flag_key, ctx)
            self._cache.put(flag_key, evaluation)
        for observer in self._observers:
            observer.on_exposure(ctx, evaluation)
        return evaluation

    def is_enabled(self, flag_key, ctx):
        return self.evaluate(flag_key, ctx).value
`,
      },
      {
        path: 'flags/analytics.py',
        content: `class ExposureLog:
    """Observer: records which variant each user was exposed to."""

    def __init__(self):
        self.lines = []

    def on_exposure(self, ctx, evaluation):
        self.lines.append(f"{ctx.user_id}:{evaluation.flag_key}={evaluation.value}({evaluation.reason})")
`,
      },
      {
        path: 'flags/app.py',
        content: `import time
from types import SimpleNamespace

from flags.analytics import ExposureLog
from flags.cache import TtlCache
from flags.client import FlagClient
from flags.evaluator import Evaluator
from flags.repository import FlagRepository


def build(raw_config, clock=time.monotonic, ttl_seconds=30):
    repo = FlagRepository(raw_config)
    evaluator = Evaluator(repo)
    cache = TtlCache(clock, ttl_seconds)
    client = FlagClient(evaluator, cache)
    exposures = ExposureLog()
    client.subscribe(exposures)

    def reload(new_config):
        repo.load(new_config)
        cache.clear()

    return SimpleNamespace(client=client, exposures=exposures, cache=cache, repo=repo, reload=reload)
`,
      },
      {
        path: 'demo.py',
        content: `from flags.app import build
from flags.models import Context

CONFIG = {
    "new-checkout": {
        "enabled": True,
        "rollout": 0,
        "targets": ["u_ana"],
        "rules": [{"attr": "email", "op": "ends_with", "values": ["@corp.example"]}],
    },
    "dark-mode": {"enabled": False, "targets": ["u_ana"]},
}

app = build(CONFIG, clock=lambda: 0.0)
client = app.client

ana = Context("u_ana", {"email": "ana@gmail.com"})
bo = Context("u_bo", {"email": "bo@corp.example"})
eve = Context("u_eve", {"email": "eve@gmail.com"})
dan = Context("u_dan", {"email": "dan@gmail.com"})   # bucket("new-checkout", "u_dan") == 0

first = client.evaluate("new-checkout", bo)
print(first.reason, first.value)
second = client.evaluate("new-checkout", ana)
print(second.reason, second.value)
print(client.is_enabled("new-checkout", eve))
print(client.evaluate("dark-mode", ana).reason)

app.reload(CONFIG)
print(client.is_enabled("new-checkout", eve))
app.reload(CONFIG)
print(client.evaluate("new-checkout", dan).reason)
print(len(app.exposures.lines), len(app.cache))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace a cache-miss evaluation',
        prompt: 'With an empty cache, `client.is_enabled("new-checkout", bo)` runs. Order the steps.',
        items: [
          'FlagClient.is_enabled delegates to FlagClient.evaluate',
          'TtlCache.get returns None',
          'Evaluator.evaluate fetches the Flag from FlagRepository',
          'Kill-switch and targets checks run',
          'rules.matches checks the email ends_with rule',
          'TtlCache.put stores the Evaluation',
          'ExposureLog.on_exposure records the exposure',
          'is_enabled returns evaluation.value',
        ],
        hints: [
          'Start in `flags/client.py`.',
          'Are observers notified before or after the cache is written?',
        ],
        explanation:
          '`is_enabled` is a thin wrapper around `evaluate`. On a miss the client asks the evaluator, which applies the precedence order (missing → off → targets → rules → rollout), then the client caches the result and notifies observers on **every** call, hit or miss. Observers are attached in `app.py` through `subscribe`, which is the observer pattern: the client does not know what analytics does.',
        timeLimitSec: 300,
        focusFile: 'flags/client.py',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict the demo',
        prompt: 'What does `demo.py` print? (The comment about `u_dan`\'s bucket is true.)',
        entry: 'demo.py',
        answer: 'RULE_MATCH True\nRULE_MATCH True\nTrue\nOFF\nFalse\nROLLOUT\n6 1',
        options: [
          'RULE_MATCH True\nRULE_MATCH True\nTrue\nOFF\nFalse\nROLLOUT\n6 1',
          'RULE_MATCH True\nTARGET True\nFalse\nOFF\nFalse\nFALLTHROUGH\n6 1',
          'RULE_MATCH True\nTARGET True\nFalse\nTARGET\nFalse\nROLLOUT\n6 4',
          'RULE_MATCH True\nRULE_MATCH True\nTrue\nOFF\nTrue\nROLLOUT\n4 2',
        ],
        hints: [
          'What key does `FlagClient.evaluate` use for the cache?',
          'Which comes first in the evaluator: the kill switch or the targets?',
          'Bucket 0 with `rollout_percent` 0: what does `0 <= 0` give?',
        ],
        explanation:
          'The cache is keyed by **flag key only**. Bo\'s `RULE_MATCH` result is cached and then served to Ana (who should get `TARGET`) and to Eve (who should get `False`). `dark-mode` is disabled, and the kill switch runs before targets, so Ana gets `OFF`. After `reload` clears the cache, Eve is evaluated for real: bucket 11 is not ≤ 0 → `False`. After the second reload, Dan\'s bucket is 0 and `0 <= 0` is true → `ROLLOUT` on a 0% flag. Observers fire on every call (6 exposures), and only one cache entry exists at the end.',
        timeLimitSec: 480,
        focusFile: 'demo.py',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'The leaky kill switch',
        prompt: 'A flag at `rollout: 0` is still on for about 1% of users. Click the line responsible.',
        file: 'flags/evaluator.py',
        lines: [21],
        options: [
          '`<=` makes bucket 0 pass at 0% (and gives 101 passing values at 100%); buckets are 0-99, so it must be `<`',
          '`bucket()` uses only 8 hex digits, which skews the distribution',
          'Rules are checked before the rollout, so rule-matching users leak',
          'The kill switch should be checked after the targets',
        ],
        correct: 0,
        hints: ['Buckets range over 0..99. How many of them satisfy `b <= 0`? How many satisfy `b < 10`?'],
        explanation:
          'With buckets 0-99, `b < p` admits exactly `p` buckets, so `p`% of users. `b <= p` admits `p + 1` buckets, so 0% still lets bucket 0 (about 1% of users) through. Off-by-one errors at percentage boundaries are a classic in rollout code. 8 hex digits gives 32 bits, which is plenty for uniform mod 100. The README defines the rule order, and the evaluator follows it.',
        timeLimitSec: 240,
        focusFile: 'flags/evaluator.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the cache rewrite',
        prompt: 'You asked the assistant how to fix the caching bug. Should you accept its proposal?',
        persona: 'outdated-docs',
        request: 'The flag cache ignores the user. How should I fix FlagClient?',
        aiReply: `Hand-rolled caches are an anti-pattern; the standard library docs recommend \`functools.lru_cache\` for memoising pure functions. It keys on **all** arguments automatically, so the per-user problem disappears:

\`\`\`python
import functools

class FlagClient:
    def __init__(self, evaluator, cache):
        self._evaluator = evaluator
        self._observers = []

    @functools.lru_cache(maxsize=4096)
    def _cached(self, flag_key, ctx):
        return self._evaluator.evaluate(flag_key, ctx)

    def evaluate(self, flag_key, ctx):
        evaluation = self._cached(flag_key, ctx)
        for observer in self._observers:
            observer.on_exposure(ctx, evaluation)
        return evaluation
\`\`\`

You can delete \`TtlCache\` entirely.`,
        options: [
          'Accept: lru_cache keys on (self, flag_key, ctx), so results are per user',
          'Reject: `Context` is a frozen dataclass containing a `dict`, so hashing it for the cache key raises `TypeError`; and even if it were hashable, `reload()` only clears `TtlCache`, so config changes would never be seen',
          'Reject: observers would no longer be notified on cache hits',
          'Reject: `lru_cache` cannot decorate methods because `self` is not hashable',
        ],
        correct: 1,
        hints: [
          'What does a frozen dataclass\'s generated `__hash__` hash?',
          'Look at `reload` in `flags/app.py`. What does it invalidate?',
        ],
        explanation:
          '`lru_cache` must hash every argument. `Context` is `frozen=True`, so the generated `__hash__` hashes the tuple `(user_id, attributes)`, and `attributes` is a `dict`, so every call raises `TypeError: unhashable type: \'dict\'`. The proposal also has no TTL and nothing invalidates it: `app.reload()` clears `TtlCache`, which this change bypasses. Observers are still called in `evaluate`, and instances are hashable by identity, so those options are wrong. Advice that is "standard" in general can still clash with this codebase\'s types and lifecycle hooks.',
        timeLimitSec: 300,
        focusFile: 'flags/client.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix caching and the rollout boundary',
        prompt:
          'Fix both defects while keeping the TTL cache (it really does save CPU):\n\n1. Cached results must be specific to the evaluation context (user **and** attributes).\n2. `rollout: 0` must enable nobody and `rollout: 100` everybody.\n\n`reload()` must still invalidate everything.',
        editable: ['flags/client.py', 'flags/evaluator.py'],
        tests: [
          {
            path: 'tests/test_flags.py',
            content: `from flags.app import build
from flags.models import Context

CONFIG = {
    "new-checkout": {
        "enabled": True,
        "rollout": 0,
        "targets": ["u_ana"],
        "rules": [{"attr": "email", "op": "ends_with", "values": ["@corp.example"]}],
    },
    "everyone": {"enabled": True, "rollout": 100},
}


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_cache_is_per_user():
    app = build(CONFIG, clock=FakeClock())
    c = app.client
    assert c.evaluate("new-checkout", Context("u_bo", {"email": "bo@corp.example"})).reason == "RULE_MATCH"
    assert c.evaluate("new-checkout", Context("u_ana", {"email": "ana@gmail.com"})).reason == "TARGET"
    assert c.is_enabled("new-checkout", Context("u_eve", {"email": "eve@gmail.com"})) is False


def test_cache_respects_attributes():
    app = build(CONFIG, clock=FakeClock())
    c = app.client
    assert c.is_enabled("new-checkout", Context("u_eve", {"email": "eve@gmail.com"})) is False
    assert c.is_enabled("new-checkout", Context("u_eve", {"email": "eve@corp.example"})) is True


def test_cache_still_caches_and_expires():
    clock = FakeClock()
    app = build(CONFIG, clock=clock, ttl_seconds=30)
    ctx = Context("u_bo", {"email": "bo@corp.example"})
    app.client.evaluate("new-checkout", ctx)
    app.client.evaluate("new-checkout", Context("u_bo", {"email": "bo@corp.example"}))
    assert len(app.cache) == 1
    app.client.evaluate("new-checkout", Context("u_eve", {"email": "eve@gmail.com"}))
    assert len(app.cache) == 2
    clock.t = 31
    assert app.client.evaluate("new-checkout", ctx).reason == "RULE_MATCH"
    assert len(app.exposures.lines) == 4


def test_reload_invalidates():
    app = build(CONFIG, clock=FakeClock())
    eve = Context("u_eve", {"email": "eve@gmail.com"})
    assert app.client.is_enabled("new-checkout", eve) is False
    app.reload({"new-checkout": {"enabled": True, "rollout": 100}})
    assert app.client.is_enabled("new-checkout", eve) is True


def test_rollout_boundaries():
    app = build(CONFIG, clock=FakeClock())
    dan = Context("u_dan", {})  # bucket 0 for new-checkout
    assert app.client.evaluate("new-checkout", dan).reason == "FALLTHROUGH"
    for i in range(50):
        assert app.client.is_enabled("everyone", Context(f"user{i}", {})) is True
`,
          },
        ],
        solution: {
          'flags/client.py': `class FlagClient:
    """Public SDK surface. Results are cached for a short TTL to save CPU."""

    def __init__(self, evaluator, cache):
        self._evaluator = evaluator
        self._cache = cache
        self._observers = []

    def subscribe(self, observer):
        self._observers.append(observer)

    @staticmethod
    def _cache_key(flag_key, ctx):
        return (flag_key, ctx.user_id, tuple(sorted(ctx.attributes.items())))

    def evaluate(self, flag_key, ctx):
        key = self._cache_key(flag_key, ctx)
        evaluation = self._cache.get(key)
        if evaluation is None:
            evaluation = self._evaluator.evaluate(flag_key, ctx)
            self._cache.put(key, evaluation)
        for observer in self._observers:
            observer.on_exposure(ctx, evaluation)
        return evaluation

    def is_enabled(self, flag_key, ctx):
        return self.evaluate(flag_key, ctx).value
`,
          'flags/evaluator.py': `from flags.bucketing import bucket
from flags.models import Evaluation
from flags.rules import matches


class Evaluator:
    def __init__(self, repository):
        self._repo = repository

    def evaluate(self, flag_key, ctx):
        flag = self._repo.get(flag_key)
        if flag is None:
            return Evaluation(flag_key, False, "FLAG_NOT_FOUND")
        if not flag.enabled:
            return Evaluation(flag_key, False, "OFF")
        if ctx.user_id in flag.targets:
            return Evaluation(flag_key, True, "TARGET")
        for rule in flag.rules:
            if matches(rule, ctx):
                return Evaluation(flag_key, True, "RULE_MATCH")
        if bucket(flag.key, ctx.user_id) < flag.rollout_percent:
            return Evaluation(flag_key, True, "ROLLOUT")
        return Evaluation(flag_key, False, "FALLTHROUGH")
`,
        },
        hints: [
          'Everything the evaluator reads from the context must be part of the cache key.',
          'A dict is not hashable, but a sorted tuple of its items is.',
        ],
        explanation:
          'The cache key must cover every input that affects the result: the flag key, the user id (targets and bucketing) and the attributes (rules). `tuple(sorted(attributes.items()))` gives a hashable, order-independent key. The cache, its TTL and `reload()` invalidation all keep working because only the key changed. In the evaluator, `<` makes the percentage exact.',
        timeLimitSec: 600,
        focusFile: 'flags/client.py',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 5. JavaScript — notification fan-out over an event bus
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-js-notification-fanout',
    title: 'Notification Fan-out: The First Customer After Every Deploy',
    level: 3,
    rating: 1680,
    lang: 'javascript',
    domain: 'notifications',
    companies: ['amazon', 'meta', 'uber', 'canva'],
    tags: ['event-bus', 'observer', 'iteration-mutation', 'fault-isolation', 'async'],
    summary: 'After every deploy, exactly one customer never hears that their order shipped. Trace the event bus fan-out to find out who and why.',
    context:
      'You are on-call for the notifications service. A pattern has emerged in support tickets: right after each deploy, **one** customer reports never receiving their "order shipped" message. Every customer after that is fine. Nobody has changed the channel code in months. The only recent change was a small "first shipment after boot" metric for the SRE dashboard.',
    persona: 'lazy-copier',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# notify-svc

Domain events in, notifications out.

\`\`\`
publisher ──► EventBus ──► FirstShipmentTracker (once)
                       ├─► NotificationService ──► channels (email / sms / push)
                       └─► AuditLog
\`\`\`

- \`EventBus.publish\` awaits handlers **one at a time, in subscription order**, isolates failures
  (a throwing handler is reported through \`onHandlerError\` and the rest still run) and returns how many
  handlers completed successfully.
- \`subscribeOnce\` handlers run for the first matching event only.
- \`NotificationService\` picks channels from user preferences (default: email). **Critical** templates
  (password reset) always go to email only, whatever the preferences.
- A failing channel never blocks the other channels; failures land in the dead-letter queue.

| Path | Role |
| --- | --- |
| \`src/app.js\` | Composition root (subscription order matters!) |
| \`src/bus/eventBus.js\` | Pub/sub |
| \`src/bus/deadLetter.js\` | Dead-letter queue |
| \`src/services/notificationService.js\` | Recipient, channel and template resolution |
| \`src/services/firstShipmentTracker.js\` | SRE metric: first shipment seen after boot |
| \`src/services/auditLog.js\` | Compliance trail |
| \`src/channels/*.js\` | Email / SMS / push adapters (fakes with outboxes) |
| \`src/templates/*.js\` | Template catalog and renderer |
| \`src/users/*.js\` | User directory and channel preferences |
`,
      },
      {
        path: 'src/bus/eventBus.js',
        content: `class EventBus {
  constructor({ onHandlerError } = {}) {
    this.handlers = new Map(); // topic -> [{ name, fn }]
    this.onHandlerError = onHandlerError || (() => {});
  }

  subscribe(topic, name, fn) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, []);
    const entry = { name, fn };
    this.handlers.get(topic).push(entry);
    return () => {
      const list = this.handlers.get(topic);
      const i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    };
  }

  subscribeOnce(topic, name, fn) {
    const off = this.subscribe(topic, name, (event) => {
      off();
      return fn(event);
    });
    return off;
  }

  async publish(topic, event) {
    const list = this.handlers.get(topic) || [];
    let delivered = 0;
    for (const entry of list) {
      try {
        await entry.fn(event);
        delivered++;
      } catch (err) {
        this.onHandlerError({ topic, handler: entry.name, reason: err.message });
      }
    }
    return delivered;
  }
}

module.exports = { EventBus };
`,
      },
      {
        path: 'src/bus/deadLetter.js',
        content: `class DeadLetterQueue {
  constructor() {
    this.items = [];
  }

  add(item) {
    this.items.push({ ...item, at: this.items.length });
  }

  list() {
    return this.items.slice();
  }

  size() {
    return this.items.length;
  }
}

module.exports = { DeadLetterQueue };
`,
      },
      {
        path: 'src/templates/catalog.js',
        content: `module.exports = {
  order_shipped: 'Hi {{name}}, order {{orderId}} has shipped',
  password_reset: 'Your reset code is {{code}}',
};
`,
      },
      {
        path: 'src/templates/render.js',
        content: `function render(template, vars) {
  if (template === undefined) throw new Error('unknown template');
  return template.replace(/\\{\\{(\\w+)\\}\\}/g, (_m, key) => (vars[key] !== undefined ? String(vars[key]) : ''));
}

module.exports = { render };
`,
      },
      {
        path: 'src/users/userDirectory.js',
        content: `class UserDirectory {
  constructor() {
    this.byId = new Map();
  }

  add(user) {
    this.byId.set(user.id, user);
  }

  get(id) {
    return this.byId.get(id);
  }
}

module.exports = { UserDirectory };
`,
      },
      {
        path: 'src/users/preferences.js',
        content: `const DEFAULT_CHANNELS = ['email'];

class PreferenceStore {
  constructor() {
    this.channels = new Map();
  }

  set(userId, channels) {
    this.channels.set(userId, channels.slice());
  }

  get(userId) {
    return this.channels.get(userId) || DEFAULT_CHANNELS;
  }
}

module.exports = { PreferenceStore };
`,
      },
      {
        path: 'src/channels/channels.js',
        content: `class EmailChannel {
  constructor() {
    this.outbox = [];
  }
  async send(user, text) {
    if (!user.email) throw new Error('no email address');
    this.outbox.push('email ' + user.email + ': ' + text);
  }
}

class SmsChannel {
  constructor() {
    this.outbox = [];
  }
  async send(user, text) {
    if (!user.phone || !user.phone.startsWith('+')) throw new Error('phone must be E.164');
    this.outbox.push('sms ' + user.phone + ': ' + text);
  }
}

class PushChannel {
  constructor() {
    this.outbox = [];
  }
  async send(user, text) {
    if (!user.deviceToken) throw new Error('no device registered');
    this.outbox.push('push ' + user.deviceToken + ': ' + text);
  }
}

module.exports = { EmailChannel, SmsChannel, PushChannel };
`,
      },
      {
        path: 'src/services/notificationService.js',
        content: `const TEMPLATES = require('../templates/catalog');
const { render } = require('../templates/render');

const CRITICAL = new Set(['password_reset']);

class NotificationService {
  constructor({ users, preferences, channels, deadLetters }) {
    this.users = users;
    this.preferences = preferences;
    this.channels = channels;
    this.deadLetters = deadLetters;
  }

  register(bus) {
    bus.subscribe('order.shipped', 'notify-shipped', (e) =>
      this.notify(e.userId, 'order_shipped', { orderId: e.orderId }),
    );
    bus.subscribe('password.reset', 'notify-reset', (e) => this.notify(e.userId, 'password_reset', { code: e.code }));
  }

  channelsFor(user, templateId) {
    if (CRITICAL.has(templateId)) return ['email'];
    return this.preferences.get(user.id);
  }

  async notify(userId, templateId, vars) {
    const user = this.users.get(userId);
    if (!user) throw new Error('unknown user ' + userId);
    const text = render(TEMPLATES[templateId], { name: user.name, ...vars });
    const results = [];
    for (const name of this.channelsFor(user, templateId)) {
      try {
        await this.channels[name].send(user, text);
        results.push(name + ':ok');
      } catch (err) {
        this.deadLetters.add({ userId, channel: name, reason: err.message });
        results.push(name + ':failed');
      }
    }
    return results;
  }
}

module.exports = { NotificationService };
`,
      },
      {
        path: 'src/services/firstShipmentTracker.js',
        content: `/** SRE dashboard metric: which order was the first to ship after this process booted? */
class FirstShipmentTracker {
  constructor() {
    this.firstOrderId = null;
  }

  register(bus) {
    bus.subscribeOnce('order.shipped', 'first-shipment', (e) => {
      this.firstOrderId = e.orderId;
    });
  }
}

module.exports = { FirstShipmentTracker };
`,
      },
      {
        path: 'src/services/auditLog.js',
        content: `class AuditLog {
  constructor() {
    this.lines = [];
  }

  register(bus) {
    bus.subscribe('order.shipped', 'audit', (e) => {
      this.lines.push('shipped ' + e.orderId);
    });
  }
}

module.exports = { AuditLog };
`,
      },
      {
        path: 'src/app.js',
        content: `const { EventBus } = require('./bus/eventBus');
const { DeadLetterQueue } = require('./bus/deadLetter');
const { EmailChannel, SmsChannel, PushChannel } = require('./channels/channels');
const { UserDirectory } = require('./users/userDirectory');
const { PreferenceStore } = require('./users/preferences');
const { NotificationService } = require('./services/notificationService');
const { FirstShipmentTracker } = require('./services/firstShipmentTracker');
const { AuditLog } = require('./services/auditLog');

function buildApp() {
  const deadLetters = new DeadLetterQueue();
  const bus = new EventBus({ onHandlerError: (failure) => deadLetters.add(failure) });
  const users = new UserDirectory();
  const preferences = new PreferenceStore();
  const channels = { email: new EmailChannel(), sms: new SmsChannel(), push: new PushChannel() };

  const tracker = new FirstShipmentTracker();
  const notifications = new NotificationService({ users, preferences, channels, deadLetters });
  const audit = new AuditLog();

  // Order matters: handlers run in subscription order.
  tracker.register(bus);
  notifications.register(bus);
  audit.register(bus);

  return { bus, users, preferences, channels, deadLetters, tracker, audit, notifications };
}

module.exports = { buildApp };
`,
      },
      {
        path: 'demo.js',
        content: `const { buildApp } = require('./src/app');

async function main() {
  const app = buildApp();
  app.users.add({ id: 'u1', name: 'Ana', email: 'ana@x.io', phone: '+447700900' });
  app.users.add({ id: 'u2', name: 'Ben', email: 'ben@x.io', phone: '07700900' });
  app.preferences.set('u1', ['email', 'push']);
  app.preferences.set('u2', ['sms', 'email']);

  const n1 = await app.bus.publish('order.shipped', { userId: 'u1', orderId: 'A1' });
  const n2 = await app.bus.publish('order.shipped', { userId: 'u2', orderId: 'B7' });
  const n3 = await app.bus.publish('password.reset', { userId: 'u2', code: '9911' });
  const n4 = await app.bus.publish('order.shipped', { userId: 'u9', orderId: 'Z0' });

  console.log(n1, n2, n3, n4);
  console.log(app.channels.email.outbox.join(' | '));
  console.log(app.deadLetters.list().map((d) => d.channel || d.handler).join(','));
  console.log(app.tracker.firstOrderId, app.audit.lines.join(','));
}

main();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: failure isolation',
        prompt: 'Using the README and code, which statements are true? Select all that apply.',
        options: [
          'If the SMS channel throws for a user, email is still attempted for the same notification',
          'If `notify` throws for an unknown user, the audit handler still runs for that event',
          'A failing SMS send is reported through the bus\'s `onHandlerError`',
          'A password reset is sent by email even if the user\'s preferences are `[\'sms\']`',
          '`publish` returns the number of handlers subscribed to the topic',
        ],
        correct: [0, 1, 3],
        hints: [
          'There are two `try/catch` blocks: one in `EventBus.publish` and one in `NotificationService.notify`. Which failures reach which?',
          'Look at `channelsFor` and the `CRITICAL` set.',
        ],
        explanation:
          'Channel failures are caught **inside** `notify` (per channel), so they go straight to the dead-letter queue and `notify` resolves normally; the bus never sees them. An unknown user makes `notify` throw, which the bus catches per handler, so later handlers like audit still run and the failure is reported through `onHandlerError`. Critical templates bypass preferences. `publish` counts **successful** handlers, not subscribers. Knowing which layer owns which failure is essential before you touch a fan-out system.',
        timeLimitSec: 300,
        focusFile: 'src/services/notificationService.js',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict the demo',
        prompt: 'What does `demo.js` print?',
        entry: 'demo.js',
        answer:
          '2 2 1 1\nemail ben@x.io: Hi Ben, order B7 has shipped | email ben@x.io: Your reset code is 9911\nsms,notify-shipped\nA1 shipped A1,shipped B7,shipped Z0',
        options: [
          '2 2 1 1\nemail ben@x.io: Hi Ben, order B7 has shipped | email ben@x.io: Your reset code is 9911\nsms,notify-shipped\nA1 shipped A1,shipped B7,shipped Z0',
          '3 2 1 1\nemail ana@x.io: Hi Ana, order A1 has shipped | email ben@x.io: Hi Ben, order B7 has shipped | email ben@x.io: Your reset code is 9911\npush,sms,notify-shipped\nA1 shipped A1,shipped B7,shipped Z0',
          '2 2 1 1\nemail ben@x.io: Hi Ben, order B7 has shipped | email ben@x.io: Your reset code is 9911\nsms,notify-shipped\nA1 shipped B7,shipped Z0',
          '3 2 1 2\nemail ana@x.io: Hi Ana, order A1 has shipped | email ben@x.io: Hi Ben, order B7 has shipped | email ben@x.io: Your reset code is 9911\npush,sms\nA1 shipped A1,shipped B7,shipped Z0',
        ],
        hints: [
          'Write down the handler array for `order.shipped` after `buildApp()`. What does the `subscribeOnce` wrapper do to that array, and when?',
          'A `for...of` over an array walks by index. What happens to the index of the next element when the current one is spliced out?',
        ],
        explanation:
          'The `order.shipped` handlers are `[first-shipment, notify-shipped, audit]`. On the first event, the once-wrapper calls `off()`, which **splices index 0 out while the `for...of` is at index 0**. The array becomes `[notify-shipped, audit]` and the iterator moves on to index 1, which is now `audit`. `notify-shipped` is skipped, so Ana gets nothing (no email, and no push failure either) and `n1` is 2. After that the array is stable: Ben\'s SMS fails (no `+`) into the DLQ, his email goes out, and `n2` is 2. The reset is critical → email only. u9 is unknown, so `notify` throws and the bus reports `notify-shipped`; audit still runs.',
        timeLimitSec: 540,
        focusFile: 'src/bus/eventBus.js',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Locate the root cause',
        prompt: 'Click the line in the event bus where handler iteration goes wrong, then choose the root cause.',
        file: 'src/bus/eventBus.js',
        lines: [27, 29],
        options: [
          '`publish` iterates the live handler array; a once-handler unsubscribing itself splices the array mid-iteration, so the next handler is skipped',
          '`subscribeOnce` calls `off()` before `fn(event)`, so the tracker never records the order',
          '`await` inside `for...of` makes handlers run concurrently',
          '`indexOf(entry)` compares by value and removes the wrong handler',
        ],
        correct: 0,
        hints: ['Is `list` a copy, or the same array that `off()` splices?'],
        explanation:
          '`const list = this.handlers.get(topic)` is the **live** array, and `off()` mutates it during the loop. Removing the current element shifts every later element down one slot, so the iterator skips one. The fix is to iterate a snapshot (`[...list]`), which is the same reason Node\'s `EventEmitter` copies its listener array before emitting. Calling `off()` before `fn` is fine (the tracker still records the order), `await` in a loop is sequential, and `indexOf` compares object identity.',
        timeLimitSec: 240,
        focusFile: 'src/bus/eventBus.js',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the assistant\'s patch',
        prompt: 'The assistant suggests this patch to `eventBus.js`. Should you accept it?',
        persona: 'lazy-copier',
        request: 'Fix the skipped handler bug in EventBus.publish',
        aiReply: `Copy the array before iterating, and while we're here make it faster by running handlers in parallel:

\`\`\`js
  async publish(topic, event) {
    const list = [...(this.handlers.get(topic) || [])];
    await Promise.all(list.map((entry) => entry.fn(event)));
    return list.length;
  }
  // rest of the class unchanged
\`\`\``,
        options: [
          'Accept: the snapshot fixes the skip, and parallel delivery is faster',
          'Reject: it removes per-handler error isolation. One throwing handler (e.g. an unknown user) now rejects the whole `publish`, nothing reaches `onHandlerError`/the DLQ, and the return value counts subscribers instead of successes',
          'Reject: spreading a Map value creates a shallow copy that still aliases the handlers',
          'Reject: `Promise.all` cannot be awaited inside an async method',
        ],
        correct: 1,
        hints: ['Compare the old and new code: what happened to the `try/catch` and `delivered`?'],
        explanation:
          'The snapshot is the right idea, but the "while we\'re here" rewrite quietly drops the `try/catch` (a rejected `Promise.all` now propagates to the publisher and skips `onHandlerError`), changes the return contract from "successful handlers" to "subscribers", and breaks the README guarantee that handlers run **one at a time in order**. A shallow copy is exactly what we want: the entries are the same objects, but splicing the original no longer affects our iteration. Reject partial rewrites that hide behaviour changes behind "rest unchanged".',
        timeLimitSec: 300,
        focusFile: 'src/bus/eventBus.js',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix the fan-out',
        prompt:
          'Fix the event bus so that a handler unsubscribing itself (or being unsubscribed) during `publish` never causes another handler to be skipped. Keep the README guarantees: sequential, in subscription order, failures isolated, return value = successful handlers.',
        editable: ['src/bus/eventBus.js'],
        tests: [
          {
            path: 'tests/fanout.test.js',
            content: `const { buildApp } = require('../src/app');
const { EventBus } = require('../src/bus/eventBus');

function seed() {
  const app = buildApp();
  app.users.add({ id: 'u1', name: 'Ana', email: 'ana@x.io' });
  app.users.add({ id: 'u2', name: 'Ben', email: 'ben@x.io' });
  return app;
}

test('first shipment after boot is notified', async () => {
  const app = seed();
  const n = await app.bus.publish('order.shipped', { userId: 'u1', orderId: 'A1' });
  expect(n).toBe(3);
  expect(app.channels.email.outbox).toEqual(['email ana@x.io: Hi Ana, order A1 has shipped']);
  expect(app.tracker.firstOrderId).toBe('A1');
});

test('once handler fires only once and others keep firing', async () => {
  const app = seed();
  await app.bus.publish('order.shipped', { userId: 'u1', orderId: 'A1' });
  const n = await app.bus.publish('order.shipped', { userId: 'u2', orderId: 'B2' });
  expect(n).toBe(2);
  expect(app.tracker.firstOrderId).toBe('A1');
  expect(app.channels.email.outbox).toHaveLength(2);
  expect(app.audit.lines).toEqual(['shipped A1', 'shipped B2']);
});

test('handlers still run sequentially in order with isolation', async () => {
  const failures = [];
  const bus = new EventBus({ onHandlerError: (f) => failures.push(f.handler) });
  const seen = [];
  bus.subscribeOnce('t', 'a', () => { seen.push('a'); });
  bus.subscribeOnce('t', 'b', () => { seen.push('b'); });
  bus.subscribe('t', 'boom', () => { throw new Error('x'); });
  bus.subscribe('t', 'c', async () => { await null; seen.push('c'); });
  const n = await bus.publish('t', {});
  expect(seen).toEqual(['a', 'b', 'c']);
  expect(n).toBe(3);
  expect(failures).toEqual(['boom']);
  expect(await bus.publish('t', {})).toBe(1);
});
`,
          },
        ],
        solution: {
          'src/bus/eventBus.js': `class EventBus {
  constructor({ onHandlerError } = {}) {
    this.handlers = new Map(); // topic -> [{ name, fn }]
    this.onHandlerError = onHandlerError || (() => {});
  }

  subscribe(topic, name, fn) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, []);
    const entry = { name, fn };
    this.handlers.get(topic).push(entry);
    return () => {
      const list = this.handlers.get(topic);
      const i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    };
  }

  subscribeOnce(topic, name, fn) {
    const off = this.subscribe(topic, name, (event) => {
      off();
      return fn(event);
    });
    return off;
  }

  async publish(topic, event) {
    // Snapshot: handlers may (un)subscribe while we iterate.
    const list = [...(this.handlers.get(topic) || [])];
    let delivered = 0;
    for (const entry of list) {
      try {
        await entry.fn(event);
        delivered++;
      } catch (err) {
        this.onHandlerError({ topic, handler: entry.name, reason: err.message });
      }
    }
    return delivered;
  }
}

module.exports = { EventBus };
`,
        },
        hints: [
          'You only need to change one line.',
          'Iterate over a copy of the handler list taken when `publish` starts.',
        ],
        explanation:
          'Taking a snapshot at the start of `publish` makes the set of handlers for an event fixed at publish time, so (un)subscriptions take effect from the **next** event. Everything else (sequential `await`, per-handler `try/catch`, the success count) stays the same. The alternative of iterating backwards would break subscription order.',
        timeLimitSec: 480,
        focusFile: 'src/bus/eventBus.js',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 6. Java — URL shortener (no code stage)
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-java-url-shortener-collision',
    title: 'URL Shortener: The Hijacked Campaign Link',
    level: 3,
    rating: 1900,
    lang: 'java',
    domain: 'url-shortener',
    companies: ['google', 'amazon', 'blackrock', 'atlassian'],
    tags: ['namespaces', 'repository-pattern', 'observer', 'base62', 'tracing'],
    summary: 'Marketing\'s printed short link now redirects to someone\'s internal doc. Work out how a generated code took over a custom alias.',
    context:
      'You have joined the team behind an internal URL shortener (Java service, wired by hand). Marketing printed `sho.rt/sale` on 50,000 flyers last week. This morning that link redirects to an engineer\'s documentation page. Nobody edited the alias. You have the service code and a reproduction in `Main.java`.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# sho.rt

\`POST /links\` with body \`"<url>"\` or \`"<url> <alias>"\` returns \`201 https://sho.rt/<code>\`.
\`GET /<code>\` redirects (\`302 <url>\`) or returns 404 when unknown or expired.

## Rules

- URLs are normalised (\`UrlNormalizer\`) before storage, so \`HTTP://Example.com:80/a/\` == \`http://example.com/a\`.
- **Generated** codes are Base62 encodings of ids from \`IdGenerator\` and expire after the configured TTL.
- **Custom aliases** (3-30 chars \`[a-zA-Z0-9-]\`) never expire.
- Generated codes and aliases live in **one namespace**: a code must never point to two links.
- Shortening the same URL twice for the same owner returns the existing link.
- Every successful redirect notifies \`ClickListener\`s (observer pattern); \`AnalyticsCounter\` feeds billing.

## Layout (package \`shortener\`)

| Class | Role |
| --- | --- |
| \`Main\` | Composition root + reproduction script |
| \`LinkController\` | Parses requests, maps exceptions to 400/409 |
| \`ShortenerService\` | Business rules: aliases, dedupe, TTL, click events |
| \`LinkRepository\` / \`InMemoryLinkRepository\` | Storage by code and by (owner, url) |
| \`IdGenerator\` / \`SequenceIdGenerator\` | Numeric ids (a DB sequence in production) |
| \`Base62\` | id ⇄ code |
| \`UrlNormalizer\` | Canonical URL form |
| \`ClickListener\` / \`AnalyticsCounter\` | Redirect observers |
`,
      },
      {
        path: 'src/main/java/shortener/Main.java',
        content: `package shortener;

public final class Main {
    public static void main(String[] args) {
        long[] now = {1_000L};
        InMemoryLinkRepository repo = new InMemoryLinkRepository();
        ShortenerService service = new ShortenerService(repo, new SequenceIdGenerator(6_712_938L), () -> now[0], 60_000L);
        AnalyticsCounter analytics = new AnalyticsCounter();
        service.addListener(analytics);
        LinkController api = new LinkController(service);

        System.out.println(api.handle("POST", "/links", "mkt", "https://Shop.example.com/summer/ sale"));
        System.out.println(api.handle("POST", "/links", "ana", "http://blog.example.com:80/post/1"));
        System.out.println(api.handle("POST", "/links", "ana", "http://BLOG.example.com/post/1/"));
        System.out.println(api.handle("POST", "/links", "ben", "https://docs.example.com/a"));
        System.out.println(api.handle("POST", "/links", "ben", "https://docs.example.com/b"));
        System.out.println(api.handle("GET", "/sale", "guest", ""));
        now[0] = 70_000L;
        System.out.println(api.handle("GET", "/salc", "guest", ""));
        System.out.println(api.handle("POST", "/links", "ana", "ftp://files.example.com"));
        System.out.println(repo.count() + " " + analytics.summary());
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/Base62.java',
        content: `package shortener;

public final class Base62 {
    private static final String ALPHABET =
        "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    private Base62() {}

    public static String encode(long n) {
        if (n < 0) throw new IllegalArgumentException("negative id");
        if (n == 0) return "0";
        StringBuilder sb = new StringBuilder();
        while (n > 0) {
            sb.append(ALPHABET.charAt((int) (n % 62)));
            n /= 62;
        }
        return sb.reverse().toString();
    }

    public static long decode(String s) {
        long n = 0;
        for (char c : s.toCharArray()) {
            int digit = ALPHABET.indexOf(c);
            if (digit < 0) throw new IllegalArgumentException("bad char " + c);
            n = n * 62 + digit;
        }
        return n;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/IdGenerator.java',
        content: `package shortener;

/** Source of unique numeric ids. Production uses a DB sequence; tests use SequenceIdGenerator. */
public interface IdGenerator {
    long next();
}
`,
      },
      {
        path: 'src/main/java/shortener/SequenceIdGenerator.java',
        content: `package shortener;

public final class SequenceIdGenerator implements IdGenerator {
    private long current;

    public SequenceIdGenerator(long start) {
        this.current = start;
    }

    @Override
    public long next() {
        return current++;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/Link.java',
        content: `package shortener;

public final class Link {
    private final String code;
    private final String url;
    private final String ownerId;
    private final long createdAt;
    private final Long expiresAt; // null = never expires (custom aliases)
    private int clicks;

    public Link(String code, String url, String ownerId, long createdAt, Long expiresAt) {
        this.code = code;
        this.url = url;
        this.ownerId = ownerId;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public String getCode() { return code; }
    public String getUrl() { return url; }
    public String getOwnerId() { return ownerId; }
    public long getCreatedAt() { return createdAt; }
    public int getClicks() { return clicks; }

    public boolean isExpired(long now) {
        return expiresAt != null && now >= expiresAt;
    }

    public void recordClick() {
        clicks++;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/LinkRepository.java',
        content: `package shortener;

import java.util.Optional;

public interface LinkRepository {
    Optional<Link> findByCode(String code);

    Optional<Link> findByOwnerAndUrl(String ownerId, String url);

    void save(Link link);

    int count();
}
`,
      },
      {
        path: 'src/main/java/shortener/InMemoryLinkRepository.java',
        content: `package shortener;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class InMemoryLinkRepository implements LinkRepository {
    private final Map<String, Link> byCode = new HashMap<>();
    private final Map<String, Link> byOwnerAndUrl = new HashMap<>();

    @Override
    public Optional<Link> findByCode(String code) {
        return Optional.ofNullable(byCode.get(code));
    }

    @Override
    public Optional<Link> findByOwnerAndUrl(String ownerId, String url) {
        return Optional.ofNullable(byOwnerAndUrl.get(ownerId + " " + url));
    }

    @Override
    public void save(Link link) {
        byCode.put(link.getCode(), link);
        byOwnerAndUrl.put(link.getOwnerId() + " " + link.getUrl(), link);
    }

    @Override
    public int count() {
        return byCode.size();
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/UrlNormalizer.java',
        content: `package shortener;

public final class UrlNormalizer {
    private UrlNormalizer() {}

    /** Lower-cases scheme and host, drops default ports and a trailing slash. */
    public static String normalize(String raw) {
        String url = raw.trim();
        int schemeEnd = url.indexOf("://");
        if (schemeEnd < 0) throw new IllegalArgumentException("missing scheme");
        String scheme = url.substring(0, schemeEnd).toLowerCase();
        if (!scheme.equals("http") && !scheme.equals("https")) {
            throw new IllegalArgumentException("unsupported scheme " + scheme);
        }
        String rest = url.substring(schemeEnd + 3);
        int slash = rest.indexOf('/');
        String host = (slash < 0 ? rest : rest.substring(0, slash)).toLowerCase();
        String path = slash < 0 ? "" : rest.substring(slash);
        if (scheme.equals("http") && host.endsWith(":80")) host = host.substring(0, host.length() - 3);
        if (scheme.equals("https") && host.endsWith(":443")) host = host.substring(0, host.length() - 4);
        if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        return scheme + "://" + host + path;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/ClickListener.java',
        content: `package shortener;

public interface ClickListener {
    void onClick(Link link, long at);
}
`,
      },
      {
        path: 'src/main/java/shortener/AnalyticsCounter.java',
        content: `package shortener;

import java.util.Map;
import java.util.TreeMap;

/** Observer: counts redirects per link owner for the billing dashboard. */
public final class AnalyticsCounter implements ClickListener {
    private final Map<String, Integer> clicksByOwner = new TreeMap<>();

    @Override
    public void onClick(Link link, long at) {
        clicksByOwner.merge(link.getOwnerId(), 1, Integer::sum);
    }

    public String summary() {
        return clicksByOwner.toString();
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/ShortenerService.java',
        content: `package shortener;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

public final class ShortenerService {
    private static final Pattern ALIAS = Pattern.compile("[a-zA-Z0-9-]{3,30}");

    private final LinkRepository repo;
    private final IdGenerator ids;
    private final LongSupplier clock;
    private final long ttlMillis;
    private final List<ClickListener> listeners = new ArrayList<>();

    public ShortenerService(LinkRepository repo, IdGenerator ids, LongSupplier clock, long ttlMillis) {
        this.repo = repo;
        this.ids = ids;
        this.clock = clock;
        this.ttlMillis = ttlMillis;
    }

    public void addListener(ClickListener listener) {
        listeners.add(listener);
    }

    public Link shorten(String ownerId, String rawUrl, String alias) {
        String url = UrlNormalizer.normalize(rawUrl);
        long now = clock.getAsLong();
        if (alias != null) {
            if (!ALIAS.matcher(alias).matches()) throw new IllegalArgumentException("invalid alias");
            if (repo.findByCode(alias).isPresent()) throw new IllegalStateException("alias taken");
            Link link = new Link(alias, url, ownerId, now, null);
            repo.save(link);
            return link;
        }
        Optional<Link> existing = repo.findByOwnerAndUrl(ownerId, url);
        if (existing.isPresent()) return existing.get();
        String code = Base62.encode(ids.next());
        Link link = new Link(code, url, ownerId, now, now + ttlMillis);
        repo.save(link);
        return link;
    }

    public Optional<Link> resolve(String code) {
        Optional<Link> found = repo.findByCode(code);
        if (found.isEmpty()) return Optional.empty();
        Link link = found.get();
        long now = clock.getAsLong();
        if (link.isExpired(now)) return Optional.empty();
        link.recordClick();
        for (ClickListener listener : listeners) listener.onClick(link, now);
        return found;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/Response.java',
        content: `package shortener;

public record Response(int status, String body) {
    @Override
    public String toString() {
        return status + " " + body;
    }
}
`,
      },
      {
        path: 'src/main/java/shortener/LinkController.java',
        content: `package shortener;

public final class LinkController {
    private static final String BASE = "https://sho.rt/";
    private final ShortenerService service;

    public LinkController(ShortenerService service) {
        this.service = service;
    }

    /** POST /links body: "<url>" or "<url> <alias>".  GET /<code> redirects. */
    public Response handle(String method, String path, String userId, String body) {
        if (method.equals("POST") && path.equals("/links")) {
            String[] parts = body.trim().split(" ");
            try {
                Link link = service.shorten(userId, parts[0], parts.length > 1 ? parts[1] : null);
                return new Response(201, BASE + link.getCode());
            } catch (IllegalArgumentException e) {
                return new Response(400, e.getMessage());
            } catch (IllegalStateException e) {
                return new Response(409, e.getMessage());
            }
        }
        if (method.equals("GET") && path.length() > 1) {
            return service.resolve(path.substring(1))
                .map(link -> new Response(302, link.getUrl()))
                .orElse(new Response(404, "not found"));
        }
        return new Response(405, "method not allowed");
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: who guarantees unique codes?',
        prompt:
          'The README says a code must never point to two links. Which statement best describes where the current code enforces that?',
        options: [
          '`InMemoryLinkRepository.save` rejects a link whose code already exists',
          '`ShortenerService` checks availability only for custom aliases; generated codes are never checked, and `save` silently overwrites',
          '`SequenceIdGenerator` never repeats, and Base62 of distinct ids can never equal an alias, so uniqueness holds by construction',
          '`LinkController` maps the duplicate to a 409 via `IllegalStateException`',
        ],
        correct: [1],
        hints: [
          'Open `InMemoryLinkRepository.save`. What does `HashMap.put` do with an existing key?',
          'Can `Base62.encode(n)` produce a string that also matches the alias pattern `[a-zA-Z0-9-]{3,30}`?',
        ],
        explanation:
          'Only the alias branch calls `findByCode` before saving. Generated codes trust the sequence, which is unique **among generated codes** but knows nothing about aliases. Every Base62 code of 3+ characters is also a valid alias, so the two sources share a namespace that nobody guards. `HashMap.put` replaces the old value, so the collision is silent. The 409 path only fires for the alias check.',
        timeLimitSec: 300,
        focusFile: 'src/main/java/shortener/ShortenerService.java',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace GET /sale',
        prompt: 'Order the calls for a successful redirect.',
        items: [
          'LinkController.handle matches GET and strips the leading "/"',
          'ShortenerService.resolve calls repo.findByCode("sale")',
          'InMemoryLinkRepository looks the code up in byCode',
          'Link.isExpired(now) is checked against the injected clock',
          'Link.recordClick increments the counter',
          'AnalyticsCounter.onClick credits the link owner',
          'Optional.map builds Response(302, url) in the controller',
        ],
        hints: ['Does the listener run before or after the controller builds the response?'],
        explanation:
          '`resolve` performs the expiry check, then the click bookkeeping and the observers, all **before** returning the `Optional` that the controller maps to a 302. As a result, analytics sees every redirect, including the hijacked one, and bills it to the wrong owner (`ben`).',
        timeLimitSec: 300,
        focusFile: 'src/main/java/shortener/LinkController.java',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Run the reproduction',
        prompt:
          'Predict the output of `Main`. Useful fact: `Base62.encode(6712938) = "salc"` (consecutive ids give consecutive last characters).',
        entry: 'src/main/java/shortener/Main.java',
        answer:
          '201 https://sho.rt/sale\n201 https://sho.rt/salc\n201 https://sho.rt/salc\n201 https://sho.rt/sald\n201 https://sho.rt/sale\n302 https://docs.example.com/b\n404 not found\n400 unsupported scheme ftp\n3 {ben=1}',
        options: [
          '201 https://sho.rt/sale\n201 https://sho.rt/salc\n201 https://sho.rt/salc\n201 https://sho.rt/sald\n201 https://sho.rt/sale\n302 https://docs.example.com/b\n404 not found\n400 unsupported scheme ftp\n3 {ben=1}',
          '201 https://sho.rt/sale\n201 https://sho.rt/salc\n201 https://sho.rt/salc\n201 https://sho.rt/sald\n409 alias taken\n302 https://shop.example.com/summer\n404 not found\n400 unsupported scheme ftp\n3 {mkt=1}',
          '201 https://sho.rt/sale\n201 https://sho.rt/salc\n201 https://sho.rt/sald\n201 https://sho.rt/sale\n201 https://sho.rt/salf\n302 https://shop.example.com/summer\n302 http://blog.example.com/post/1\n400 unsupported scheme ftp\n5 {ana=1, mkt=1}',
          '201 https://sho.rt/sale\n201 https://sho.rt/salc\n201 https://sho.rt/salc\n201 https://sho.rt/sald\n201 https://sho.rt/sale\n302 https://docs.example.com/b\n302 http://blog.example.com/post/1\n400 unsupported scheme ftp\n4 {ana=1, ben=1}',
        ],
        hints: [
          'Do lines 2 and 3 normalise to the same URL for the same owner?',
          'Does a dedupe hit consume an id from the sequence?',
          'At t = 70 000 ms, is a link created at t = 1 000 with a 60 000 ms TTL still alive?',
        ],
        explanation:
          'Ana\'s two URLs normalise to `http://blog.example.com/post/1` (default port, host case and trailing slash removed), so the second call returns the existing `salc` **without** consuming an id. Ben\'s links take ids …939 → `sald` and …940 → `sale`, and `save` overwrites marketing\'s alias. `GET /sale` now redirects to Ben\'s doc and bills Ben. At t = 70 000, `salc` (expires at 61 000) is gone → 404. `ftp` fails normalisation → `IllegalArgumentException` → 400. `byCode` holds `sale`, `salc` and `sald`, so the count is 3.',
        timeLimitSec: 540,
        focusFile: 'src/main/java/shortener/Main.java',
      },
      {
        id: 's4',
        kind: 'find-bug',
        title: 'Point at the root cause',
        prompt: 'Click the line in `ShortenerService` where the hijack becomes possible, then pick the root cause.',
        file: 'src/main/java/shortener/ShortenerService.java',
        lines: [41, 43],
        options: [
          'Generated codes are taken straight from the sequence and saved without checking whether that code is already used by an alias',
          'The alias regex allows lowercase letters, which overlap with Base62',
          'The dedupe lookup ignores the owner, so Ben reuses marketing\'s link',
          '`now + ttlMillis` overflows for large clocks and makes links permanent',
        ],
        correct: 0,
        hints: ['Compare the alias branch with the generated branch: which check is missing?'],
        explanation:
          'Lines 41-43 encode the next id and save it unconditionally. The alias branch has the guard (`findByCode(...).isPresent()`), but the generated branch does not. The fix is to skip ids whose code is taken, and ideally also make the repository refuse to overwrite. Restricting the alias alphabet would only shrink the problem, and the dedupe lookup is already keyed by owner.',
        timeLimitSec: 240,
        focusFile: 'src/main/java/shortener/ShortenerService.java',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review the senior\'s patch',
        prompt: 'A senior engineer\'s assistant proposes this patch. Should you accept it?',
        persona: 'helpful-senior',
        request: 'Prevent generated codes from overwriting custom aliases.',
        aiReply: `Two small changes: skip taken codes when generating, and make the repository refuse to overwrite as a safety net.

\`\`\`java
// ShortenerService.shorten, generated branch
String code;
do {
    code = Base62.encode(ids.next());
} while (repo.findByCode(code).isPresent());
Link link = new Link(code, url, ownerId, now, now + ttlMillis);
repo.save(link);
return link;
\`\`\`

\`\`\`java
// InMemoryLinkRepository
@Override
public void save(Link link) {
    if (byCode.putIfAbsent(link.getCode(), link) != null) {
        throw new IllegalStateException("code already exists: " + link.getCode());
    }
    byOwnerAndUrl.put(link.getOwnerId() + " " + link.getUrl(), link);
}
\`\`\`

The loop terminates because ids strictly increase and there are finitely many aliases. In a multi-instance deployment you would also want a unique index on \`code\` in the database. The repository guard is the in-memory equivalent.`,
        options: [
          'Accept: it skips codes already taken and turns any remaining race into an error instead of a silent overwrite',
          'Reject: the do/while can spin forever once an alias is taken',
          'Reject: skipping ids leaves gaps, so `Base62.decode` returns the wrong id for later links',
          'Reject: `putIfAbsent` breaks custom aliases, because the alias branch saves a code that `findByCode` just confirmed is free',
        ],
        correct: 0,
        hints: [
          'Does anything in the codebase assume ids are contiguous?',
          'In the alias branch, what does `putIfAbsent` return when the key is absent?',
        ],
        explanation:
          'This patch is correct. Each iteration consumes a fresh, strictly larger id, so the loop ends after at most (number of aliases) skips. Nothing relies on contiguous ids: `decode` is a pure function of the string. In the alias branch the code was just checked as free, so `putIfAbsent` returns `null` and nothing changes. The repository guard is defence in depth: it does not prevent check-then-act races, but it turns them into a loud failure instead of silent data loss. Reviewing well includes recognising a good change and not inventing objections.',
        timeLimitSec: 300,
        focusFile: 'src/main/java/shortener/InMemoryLinkRepository.java',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 7. TypeScript — shopping cart + promotions engine
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-ts-cart-promotions',
    title: 'Promotions Engine: The Coupon That Should Not Fire',
    level: 3,
    rating: 1960,
    lang: 'typescript',
    domain: 'e-commerce',
    companies: ['amazon', 'canva', 'atlassian', 'apple'],
    tags: ['strategy-pattern', 'ordering', 'stacking-rules', 'money', 'tracing'],
    summary: 'Finance says WELCOME10 is being granted on orders well under $100. Untangle priorities, stacking and running totals across the promotions engine.',
    context:
      'You have joined the checkout team. Finance flagged that the `WELCOME10` coupon ("$10 off orders of $100 or more") is being redeemed on baskets that cost much less than $100 once other discounts are applied. The promotions engine uses a strategy-per-promotion design with priorities and stacking rules. You need to understand it before you change anything.',
    persona: 'agent-mode',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# cart-pricing

\`POST /cart/quote\` → \`CheckoutController.quote\` → \`PricingService.quote\` → \`PromotionEngine.apply\`.

## Promotion rules

1. Only promotions **active** at \`now\` are considered (\`startsAt <= now < endsAt\`).
2. Coupon promotions (\`code\` set) apply only if the shopper entered the code (case-insensitive).
3. Promotions run in **descending priority** (ties: registration order).
4. Each promotion sees the **running total**, i.e. the basket after the discounts already applied.
   Thresholds such as "orders of $100 or more" are checked against this running total.
5. At most **one non-stackable** promotion can apply; once one has applied, later non-stackable ones are skipped.
   Stackable promotions always apply.
6. A discount can never take the running total below zero.
7. Tax (\`TAX_BPS\`) is charged on the discounted total. All money is integer cents; percentages round half up.

## Layout

| Path | Role |
| --- | --- |
| \`src/app.ts\` | Wiring + seeded catalog and promotions |
| \`src/config.ts\` | Tax rate, cart limits |
| \`src/money.ts\` | Cents helpers |
| \`src/catalog/catalog.ts\` | Products |
| \`src/cart/cartService.ts\` | Cart building and validation |
| \`src/checkout/checkoutController.ts\` | Request handling, error → status |
| \`src/pricing/pricingService.ts\` | Prices lines, runs promotions, adds tax |
| \`src/promotions/types.ts\` | \`Promotion\` strategy interface and context |
| \`src/promotions/rules.ts\` | Concrete promotions |
| \`src/promotions/registry.ts\` | Registered promotions + activity window |
| \`src/promotions/engine.ts\` | Ordering, coupon gating, stacking, running total |
`,
      },
      {
        path: 'src/config.ts',
        content: `export const TAX_BPS = 800; // 8 %
export const MAX_QTY_PER_SKU = 10;
`,
      },
      {
        path: 'src/money.ts',
        content: `/** Percentage of an amount in basis points, rounded half up to whole cents. */
export function percentOf(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
`,
      },
      {
        path: 'src/catalog/catalog.ts',
        content: `export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  category: 'apparel' | 'electronics';
}

export class Catalog {
  private bySku = new Map<string, Product>();

  constructor(products: Product[]) {
    for (const p of products) this.bySku.set(p.sku, p);
  }

  get(sku: string): Product | undefined {
    return this.bySku.get(sku);
  }
}
`,
      },
      {
        path: 'src/cart/cartService.ts',
        content: `import { Catalog } from '../catalog/catalog';
import { MAX_QTY_PER_SKU } from '../config';

export class CartError extends Error {}

export interface Cart {
  lines: Map<string, number>; // sku -> qty
}

export class CartService {
  constructor(private catalog: Catalog) {}

  create(): Cart {
    return { lines: new Map() };
  }

  add(cart: Cart, sku: string, qty: number): void {
    if (!this.catalog.get(sku)) throw new CartError('unknown sku: ' + sku);
    if (!Number.isInteger(qty) || qty <= 0) throw new CartError('qty must be a positive integer');
    const next = (cart.lines.get(sku) ?? 0) + qty;
    if (next > MAX_QTY_PER_SKU) throw new CartError('max ' + MAX_QTY_PER_SKU + ' per item');
    cart.lines.set(sku, next);
  }
}
`,
      },
      {
        path: 'src/promotions/types.ts',
        content: `export interface PricedLine {
  sku: string;
  category: string;
  qty: number;
  unitCents: number;
  lineTotalCents: number;
}

export interface PromoContext {
  lines: PricedLine[];
  /** Sum of line totals before any promotion. */
  subtotalCents: number;
  /** Basket value after the promotions applied so far. */
  runningTotalCents: number;
}

export interface Adjustment {
  promoId: string;
  amountCents: number;
}

/** Strategy interface: each promotion decides its own discount. */
export interface Promotion {
  id: string;
  priority: number;
  stackable: boolean;
  code?: string;
  startsAt?: number;
  endsAt?: number;
  apply(ctx: PromoContext): Adjustment | null;
}
`,
      },
      {
        path: 'src/promotions/rules.ts',
        content: `import { percentOf, sum } from '../money';
import type { Adjustment, PromoContext, Promotion } from './types';

interface Base {
  id: string;
  priority: number;
  stackable: boolean;
  code?: string;
  startsAt?: number;
  endsAt?: number;
}

export class PercentOffCategory implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private category: string, private bps: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    const base = sum(ctx.lines.filter((l) => l.category === this.category).map((l) => l.lineTotalCents));
    if (base === 0) return null;
    return { promoId: this.id, amountCents: percentOf(base, this.bps) };
  }
}

/** "Buy 2 get 1 free": every group of (buy + free) units makes \`free\` units free. */
export class BuyXGetYFree implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private sku: string, private buy: number, private free: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    const line = ctx.lines.find((l) => l.sku === this.sku);
    if (!line) return null;
    const groups = Math.floor(line.qty / (this.buy + this.free));
    if (groups === 0) return null;
    return { promoId: this.id, amountCents: groups * this.free * line.unitCents };
  }
}

/** "$X off orders of $Y or more". */
export class ThresholdCoupon implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private minCents: number, private offCents: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    if (ctx.subtotalCents < this.minCents) return null;
    return { promoId: this.id, amountCents: this.offCents };
  }
}
`,
      },
      {
        path: 'src/promotions/registry.ts',
        content: `import type { Promotion } from './types';

export class PromotionRegistry {
  private promotions: Promotion[] = [];

  register(promo: Promotion): void {
    if (this.promotions.some((p) => p.id === promo.id)) throw new Error('duplicate promotion ' + promo.id);
    this.promotions.push(promo);
  }

  /** Promotions whose window contains \`now\` (a new array; safe to sort). */
  active(now: number): Promotion[] {
    return this.promotions.filter((p) => (p.startsAt ?? -Infinity) <= now && now < (p.endsAt ?? Infinity));
  }
}
`,
      },
      {
        path: 'src/promotions/engine.ts',
        content: `import { sum } from '../money';
import { PromotionRegistry } from './registry';
import type { Adjustment, PricedLine, PromoContext } from './types';

export interface PromotionResult {
  subtotalCents: number;
  adjustments: Adjustment[];
  totalCents: number;
}

export class PromotionEngine {
  constructor(private registry: PromotionRegistry) {}

  apply(lines: PricedLine[], codes: string[], now: number): PromotionResult {
    const subtotal = sum(lines.map((l) => l.lineTotalCents));
    const ctx: PromoContext = { lines, subtotalCents: subtotal, runningTotalCents: subtotal };
    const entered = new Set(codes.map((c) => c.toUpperCase()));
    const adjustments: Adjustment[] = [];
    let exclusiveApplied = false;

    const ordered = this.registry.active(now).sort((a, b) => b.priority - a.priority);
    for (const promo of ordered) {
      if (promo.code && !entered.has(promo.code)) continue;
      if (!promo.stackable && exclusiveApplied) continue;
      const adj = promo.apply(ctx);
      if (!adj || adj.amountCents <= 0) continue;
      const amount = Math.min(adj.amountCents, ctx.runningTotalCents);
      adjustments.push({ promoId: adj.promoId, amountCents: amount });
      ctx.runningTotalCents -= amount;
      if (!promo.stackable) exclusiveApplied = true;
    }
    return { subtotalCents: subtotal, adjustments, totalCents: ctx.runningTotalCents };
  }
}
`,
      },
      {
        path: 'src/pricing/pricingService.ts',
        content: `import { Catalog } from '../catalog/catalog';
import { Cart } from '../cart/cartService';
import { TAX_BPS } from '../config';
import { percentOf, sum } from '../money';
import { PromotionEngine } from '../promotions/engine';
import type { Adjustment, PricedLine } from '../promotions/types';

export interface Quote {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  adjustments: Adjustment[];
}

export class PricingService {
  constructor(private catalog: Catalog, private engine: PromotionEngine) {}

  quote(cart: Cart, codes: string[], now: number): Quote {
    const lines: PricedLine[] = [...cart.lines].map(([sku, qty]) => {
      const p = this.catalog.get(sku)!;
      return { sku, category: p.category, qty, unitCents: p.priceCents, lineTotalCents: p.priceCents * qty };
    });
    const promo = this.engine.apply(lines, codes, now);
    const discount = sum(promo.adjustments.map((a) => a.amountCents));
    const tax = percentOf(promo.totalCents, TAX_BPS);
    return {
      subtotalCents: promo.subtotalCents,
      discountCents: discount,
      taxCents: tax,
      totalCents: promo.totalCents + tax,
      adjustments: promo.adjustments,
    };
  }
}
`,
      },
      {
        path: 'src/checkout/checkoutController.ts',
        content: `import { CartError, CartService } from '../cart/cartService';
import { PricingService } from '../pricing/pricingService';

export interface QuoteRequest {
  items: { sku: string; qty: number }[];
  coupons?: string[];
}

export class CheckoutController {
  constructor(private carts: CartService, private pricing: PricingService, private clock: () => number) {}

  quote(req: QuoteRequest): { status: number; body: any } {
    const cart = this.carts.create();
    try {
      for (const item of req.items) this.carts.add(cart, item.sku, item.qty);
    } catch (e) {
      if (e instanceof CartError) return { status: 400, body: { error: e.message } };
      throw e;
    }
    return { status: 200, body: this.pricing.quote(cart, req.coupons ?? [], this.clock()) };
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { CartService } from './cart/cartService';
import { Catalog } from './catalog/catalog';
import { CheckoutController } from './checkout/checkoutController';
import { PricingService } from './pricing/pricingService';
import { PromotionEngine } from './promotions/engine';
import { PromotionRegistry } from './promotions/registry';
import { BuyXGetYFree, PercentOffCategory, ThresholdCoupon } from './promotions/rules';

export function buildApp(clock: () => number = () => Date.now()) {
  const catalog = new Catalog([
    { sku: 'TEE', name: 'T-shirt', priceCents: 2500, category: 'apparel' },
    { sku: 'HOODIE', name: 'Hoodie', priceCents: 6000, category: 'apparel' },
    { sku: 'SOCK', name: 'Socks', priceCents: 500, category: 'apparel' },
    { sku: 'CABLE', name: 'USB-C cable', priceCents: 1500, category: 'electronics' },
    { sku: 'HEADPHONES', name: 'Headphones', priceCents: 8999, category: 'electronics' },
  ]);

  const registry = new PromotionRegistry();
  registry.register(new BuyXGetYFree({ id: 'B2G1-SOCKS', priority: 80, stackable: true }, 'SOCK', 2, 1));
  registry.register(new PercentOffCategory({ id: 'SUMMER10', priority: 50, stackable: true }, 'apparel', 1000));
  registry.register(
    new PercentOffCategory({ id: 'FLASH15', priority: 30, stackable: false, code: 'FLASH15' }, 'electronics', 1500),
  );
  registry.register(
    new ThresholdCoupon({ id: 'WELCOME10', priority: 10, stackable: false, code: 'WELCOME10' }, 10_000, 1_000),
  );

  const engine = new PromotionEngine(registry);
  const pricing = new PricingService(catalog, engine);
  const controller = new CheckoutController(new CartService(catalog), pricing, clock);
  return { controller, registry };
}
`,
      },
      {
        path: 'demo.ts',
        content: `import { buildApp } from './src/app';

const { controller } = buildApp(() => 0);

function show(label: string, items: { sku: string; qty: number }[], coupons: string[]) {
  const res = controller.quote({ items, coupons });
  if (res.status !== 200) {
    console.log(label, res.status, res.body.error);
    return;
  }
  const q = res.body;
  const ids = q.adjustments.map((a: { promoId: string }) => a.promoId).join(',');
  console.log(label, q.subtotalCents, q.discountCents, q.taxCents, q.totalCents, ids || '-');
}

show('Q1', [{ sku: 'HOODIE', qty: 1 }, { sku: 'TEE', qty: 1 }, { sku: 'SOCK', qty: 3 }], ['welcome10']);
show('Q2', [{ sku: 'HEADPHONES', qty: 1 }, { sku: 'CABLE', qty: 2 }], ['FLASH15', 'WELCOME10']);
show('Q3', [{ sku: 'SOCK', qty: 4 }], []);
show('Q4', [{ sku: 'TEE', qty: 1 }, { sku: 'DRONE', qty: 1 }], []);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: who owns which rule?',
        prompt: 'Match README rules to code. Which statements are true? Select all that apply.',
        options: [
          'Rule 3 (descending priority) is implemented by the `sort` in `PromotionEngine.apply`',
          'Rule 5 (one non-stackable) is implemented inside each `Promotion.apply`',
          'Rule 6 (never below zero) is implemented by the `Math.min` in the engine',
          'Coupon codes are matched case-insensitively because the engine upper-cases what the shopper entered',
          'Sorting the result of `registry.active(now)` reorders the registry\'s internal array',
        ],
        correct: [0, 2, 3],
        hints: [
          'Search for `exclusiveApplied`.',
          'What does `Array.prototype.filter` return?',
        ],
        explanation:
          'Ordering, coupon gating, stacking and clamping are **engine** concerns; each strategy (`rules.ts`) only computes "how much would I discount given this context". That separation is the point of the strategy pattern. `filter` returns a new array, so sorting it is safe, as the comment in `registry.ts` says. Codes are upper-cased on the way in and compared to upper-case `code` values.',
        timeLimitSec: 300,
        focusFile: 'src/promotions/engine.ts',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a quote',
        prompt: 'Order the steps for a valid `quote` request with one coupon.',
        items: [
          'CheckoutController.quote creates an empty cart',
          'CartService.add validates each sku against the Catalog',
          'PricingService.quote builds PricedLines from catalog prices',
          'PromotionEngine.apply computes the subtotal and asks the registry for active promotions',
          'Promotions are sorted by priority and filtered by coupon code / stacking',
          'Each remaining strategy\'s apply(ctx) returns an Adjustment and the running total drops',
          'PricingService computes tax on the discounted total',
          'Controller returns 200 with the Quote',
        ],
        hints: ['The clock is read by the controller and passed down. Where is it used?'],
        explanation:
          'The controller owns request → cart conversion and error mapping. The pricing service owns money (line prices, tax). The engine owns promotion policy, and the strategies own individual discount maths. `now` is injected through the controller so tests can pin promotion windows.',
        timeLimitSec: 360,
        focusFile: 'src/checkout/checkoutController.ts',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Predict four quotes',
        prompt: 'What does `demo.ts` print? Columns: `label subtotal discount tax total promoIds`.',
        entry: 'demo.ts',
        answer:
          'Q1 10000 2500 600 8100 B2G1-SOCKS,SUMMER10,WELCOME10\nQ2 11999 1800 816 11015 FLASH15\nQ3 2000 700 104 1404 B2G1-SOCKS,SUMMER10\nQ4 400 unknown sku: DRONE',
        options: [
          'Q1 10000 2500 600 8100 B2G1-SOCKS,SUMMER10,WELCOME10\nQ2 11999 1800 816 11015 FLASH15\nQ3 2000 700 104 1404 B2G1-SOCKS,SUMMER10\nQ4 400 unknown sku: DRONE',
          'Q1 10000 1500 680 9180 B2G1-SOCKS,SUMMER10\nQ2 11999 1800 816 11015 FLASH15\nQ3 2000 700 104 1404 B2G1-SOCKS,SUMMER10\nQ4 400 unknown sku: DRONE',
          'Q1 10000 2500 600 8100 B2G1-SOCKS,SUMMER10,WELCOME10\nQ2 11999 2800 736 9935 FLASH15,WELCOME10\nQ3 2000 700 104 1404 B2G1-SOCKS,SUMMER10\nQ4 400 unknown sku: DRONE',
          'Q1 10000 2450 604 8154 B2G1-SOCKS,SUMMER10,WELCOME10\nQ2 11999 1800 816 11015 FLASH15\nQ3 2000 1200 64 864 B2G1-SOCKS,SUMMER10\nQ4 200 2500 0 200 2700 -',
        ],
        hints: [
          'Q1 order: B2G1 (80) → SUMMER10 (50) → FLASH15 (30, no code) → WELCOME10 (10). What base does SUMMER10 use: line totals or running total?',
          'Which total does `ThresholdCoupon` compare against?',
          'Q2: after FLASH15 (non-stackable) applies, what happens to WELCOME10?',
          'Q3: 4 socks with "buy 2 get 1": how many complete groups of 3?',
        ],
        explanation:
          '**Q1**: subtotal 10000. B2G1: one group of 3 socks → 500. SUMMER10 is 10% of the apparel **line totals** (10000) → 1000. WELCOME10 checks `subtotalCents` (10000 ≥ 10000) and applies 1000, even though the running total was already 8500. That is the bug. Discount 2500, tax 8% of 7500 = 600, total 8100. **Q2**: FLASH15 = 15% of 11999 = 1799.85 → 1800. It is non-stackable, so WELCOME10 is skipped. Tax round(10199 × 0.08 = 815.92) = 816. **Q3**: ⌊4/3⌋ = 1 free sock (500) + 10% of 2000 = 700; tax 104. **Q4**: `CartService.add` throws `CartError` → 400.',
        timeLimitSec: 600,
        focusFile: 'demo.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Agent-mode patch review',
        prompt: 'An agent produced a multi-file patch for the WELCOME10 ticket. Should you accept it?',
        persona: 'agent-mode',
        request: 'WELCOME10 must only apply when the discounted basket is still >= $100. Please fix.',
        aiReply: `I updated 2 files to make threshold handling robust.

**src/promotions/rules.ts**
\`\`\`diff
   apply(ctx: PromoContext): Adjustment | null {
-    if (ctx.subtotalCents < this.minCents) return null;
+    if (ctx.runningTotalCents < this.minCents) return null;
     return { promoId: this.id, amountCents: this.offCents };
   }
\`\`\`

**src/promotions/engine.ts**: apply low-priority promotions first so that small fixed coupons are evaluated against the full basket before percentage discounts shrink it. This is more predictable for shoppers.
\`\`\`diff
-    const ordered = this.registry.active(now).sort((a, b) => b.priority - a.priority);
+    const ordered = this.registry.active(now).sort((a, b) => a.priority - b.priority);
\`\`\`

All existing promotions still work. ✅`,
        options: [
          'Accept: the rules.ts change fixes the threshold, and the ordering change makes results more predictable',
          'Reject: with ascending order WELCOME10 (priority 10) runs first and sees the full 10000, so Q1 still gets the coupon; and in Q2 the non-stackable WELCOME10 would now beat FLASH15 (1000 off instead of 1800), contradicting README rule 3',
          'Reject: `runningTotalCents` is not defined on `PromoContext`',
          'Reject: the rules.ts change alone would break FLASH15',
        ],
        correct: 1,
        hints: [
          'Replay Q1 with the new order: which promotion runs first, and what is the running total at that point?',
          'Which non-stackable promotion applies first in Q2 under ascending order?',
        ],
        explanation:
          'The one-line `rules.ts` change is the correct fix on its own. The "while I was there" engine change reverses README rule 3. Under ascending order WELCOME10 runs **first**, when the running total equals the subtotal, so the bug reappears in a new form. It also changes which exclusive promotion wins: WELCOME10 now claims the single non-stackable slot before FLASH15 in Q2, so the shopper loses $8. Agent-style patches often bundle a correct fix with an unrequested behaviour change. Review each hunk against the spec.',
        timeLimitSec: 360,
        focusFile: 'src/promotions/engine.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix the threshold coupon',
        prompt:
          'Make threshold coupons respect README rule 4: the threshold is checked against the **running total** at the moment the coupon is evaluated. Do not change promotion ordering or stacking behaviour.',
        editable: ['src/promotions/rules.ts', 'src/promotions/engine.ts'],
        tests: [
          {
            path: 'tests/promotions.test.ts',
            content: `import { buildApp } from '../src/app';

const quote = (items: { sku: string; qty: number }[], coupons: string[] = []) => {
  const { controller } = buildApp(() => 0);
  const res = controller.quote({ items, coupons });
  expect(res.status).toBe(200);
  return res.body;
};
const ids = (q: any) => q.adjustments.map((a: any) => a.promoId);

test('coupon rejected when discounts push basket under threshold', () => {
  const q = quote([{ sku: 'HOODIE', qty: 1 }, { sku: 'TEE', qty: 1 }, { sku: 'SOCK', qty: 3 }], ['WELCOME10']);
  expect(ids(q)).toEqual(['B2G1-SOCKS', 'SUMMER10']);
  expect(q.discountCents).toBe(1500);
  expect(q.totalCents).toBe(9180);
});

test('coupon still applies when discounted basket stays above threshold', () => {
  const q = quote([{ sku: 'HEADPHONES', qty: 1 }, { sku: 'HOODIE', qty: 1 }], ['welcome10']);
  expect(ids(q)).toEqual(['SUMMER10', 'WELCOME10']);
  expect(q.discountCents).toBe(1600);
  expect(q.taxCents).toBe(1072);
  expect(q.totalCents).toBe(14471);
});

test('priority order and exclusivity unchanged', () => {
  const q = quote([{ sku: 'HEADPHONES', qty: 1 }, { sku: 'CABLE', qty: 2 }], ['FLASH15', 'WELCOME10']);
  expect(ids(q)).toEqual(['FLASH15']);
  expect(q.totalCents).toBe(11015);
});

test('coupon applies when no other discounts reduce the basket', () => {
  const q = quote([{ sku: 'HEADPHONES', qty: 1 }, { sku: 'CABLE', qty: 1 }], ['WELCOME10']);
  expect(ids(q)).toEqual(['WELCOME10']);
  expect(q.totalCents).toBe(9499 + 760);
});
`,
          },
        ],
        solution: {
          'src/promotions/rules.ts': `import { percentOf, sum } from '../money';
import type { Adjustment, PromoContext, Promotion } from './types';

interface Base {
  id: string;
  priority: number;
  stackable: boolean;
  code?: string;
  startsAt?: number;
  endsAt?: number;
}

export class PercentOffCategory implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private category: string, private bps: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    const base = sum(ctx.lines.filter((l) => l.category === this.category).map((l) => l.lineTotalCents));
    if (base === 0) return null;
    return { promoId: this.id, amountCents: percentOf(base, this.bps) };
  }
}

/** "Buy 2 get 1 free": every group of (buy + free) units makes \`free\` units free. */
export class BuyXGetYFree implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private sku: string, private buy: number, private free: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    const line = ctx.lines.find((l) => l.sku === this.sku);
    if (!line) return null;
    const groups = Math.floor(line.qty / (this.buy + this.free));
    if (groups === 0) return null;
    return { promoId: this.id, amountCents: groups * this.free * line.unitCents };
  }
}

/** "$X off orders of $Y or more" — measured against the running (already discounted) total. */
export class ThresholdCoupon implements Promotion {
  id: string; priority: number; stackable: boolean; code?: string; startsAt?: number; endsAt?: number;
  constructor(base: Base, private minCents: number, private offCents: number) {
    this.id = base.id; this.priority = base.priority; this.stackable = base.stackable;
    this.code = base.code; this.startsAt = base.startsAt; this.endsAt = base.endsAt;
  }

  apply(ctx: PromoContext): Adjustment | null {
    if (ctx.runningTotalCents < this.minCents) return null;
    return { promoId: this.id, amountCents: this.offCents };
  }
}
`,
        },
        hints: [
          'The engine already maintains the value you need on the context.',
          'Which field of `PromoContext` changes as promotions are applied?',
        ],
        explanation:
          'Switch `ThresholdCoupon` to `ctx.runningTotalCents`. The engine already keeps that field up to date because rule 4 was designed for it; the coupon simply read the wrong field. Ordering and stacking are untouched, which the third test guards: reversing the sort would make that test fail.',
        timeLimitSec: 600,
        focusFile: 'src/promotions/rules.ts',
      },
    ],
  },
];

export default problems;
