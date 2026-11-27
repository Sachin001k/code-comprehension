import type { Problem } from '../types';

/**
 * Reference examples of every stage kind. Content authors: copy these shapes.
 * NOTE: code lives in template literals, so escape backticks as \` and `${` as \${ inside code.
 */
const problems: Problem[] = [
  {
    id: 'l1-js-closure-counter',
    title: 'The Counter Factory',
    level: 1,
    rating: 850,
    lang: 'javascript',
    domain: 'language-semantics',
    companies: ['google', 'generic'],
    tags: ['closures', 'scope'],
    summary: 'Two counters, one factory. Which state is shared?',
    files: [
      {
        path: 'counter.js',
        content: `function makeCounter(start) {
  let count = start;
  return {
    inc: () => ++count,
    get: () => count,
  };
}

const a = makeCounter(10);
const b = makeCounter(10);
a.inc();
a.inc();
b.inc();
console.log(a.get(), b.get());
console.log(a.inc() + b.get());
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What gets printed?',
        prompt: 'Read `counter.js` and predict **exactly** what it prints.',
        answer: '12 11\n24',
        options: ['12 11\n24', '12 12\n24', '11 11\n23', '12 11\n23'],
        hints: ['Each call to `makeCounter` creates a brand new `count` variable.', '`++count` returns the value *after* incrementing.'],
        explanation:
          'Each `makeCounter` call creates its own closure over a fresh `count`. `a` is incremented twice (12), `b` once (11). Then `a.inc()` returns 13 and `b.get()` is 11, so the sum is 24.',
        timeLimitSec: 180,
      },
    ],
  },
  {
    id: 'l2-py-inventory-fix',
    title: 'Inventory Reservations',
    level: 2,
    rating: 1350,
    lang: 'python',
    domain: 'inventory',
    companies: ['amazon', 'atlassian'],
    tags: ['mutable-default', 'debugging'],
    summary: 'Reservations leak between orders. Find and fix it.',
    context: 'Support says customers sometimes see items in their cart that **another** customer reserved.',
    persona: 'confident-intern',
    files: [
      {
        path: 'inventory/reserve.py',
        content: `def reserve(sku, qty, cart=[]):
    """Add a reservation to the cart and return the cart."""
    if qty <= 0:
        raise ValueError("qty must be positive")
    cart.append((sku, qty))
    return cart


def total_units(cart):
    return sum(q for _, q in cart)
`,
      },
      {
        path: 'main.py',
        content: `from inventory.reserve import reserve, total_units

alice = reserve("apple", 2)
bob = reserve("pear", 1)
print(total_units(bob))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce',
        prompt: 'Before fixing anything: what does `main.py` print?',
        entry: 'main.py',
        answer: '3',
        hints: ['Default argument values are evaluated once, when the function is defined.'],
        explanation: 'The default `cart=[]` is created once and shared by every call that omits `cart`. Bob\'s cart is the same list as Alice\'s, so it contains 2 + 1 = 3 units.',
        timeLimitSec: 180,
        focusFile: 'main.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Locate the root cause',
        prompt: 'Click the line that causes the leak, then choose the root cause.',
        file: 'inventory/reserve.py',
        lines: [1],
        options: [
          'The mutable default list is shared across calls',
          '`append` should be `extend`',
          '`total_units` double counts quantities',
          'Python imports cache module state between files',
        ],
        correct: 0,
        hints: ['Which object is the same across both calls?'],
        explanation: 'Line 1: `cart=[]` is a single list object stored on the function. Use `cart=None` and create a new list inside.',
        timeLimitSec: 180,
        focusFile: 'inventory/reserve.py',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'The assistant has a fix',
        prompt: 'The assistant proposes a fix. Should you accept it?',
        persona: 'confident-intern',
        request: 'Fix the shared cart bug in reserve()',
        aiReply: `Easy one! Just make sure the cart is reset:

\`\`\`python
def reserve(sku, qty, cart=[]):
    if qty <= 0:
        raise ValueError("qty must be positive")
    cart = cart or []
    cart.append((sku, qty))
    return cart
\`\`\`

This guarantees each call gets a fresh list. ✅`,
        options: [
          'Accept: it creates a fresh list each call',
          'Reject: `cart or []` keeps the shared default once it is non-empty, and also discards a caller-supplied empty list',
          'Reject: it raises for qty == 0, which should be allowed',
          'Accept, but rename the parameter',
        ],
        correct: 1,
        hints: ['What is the truthiness of the shared default after the first call?'],
        explanation: 'After the first call the shared default list is non-empty, so `cart or []` returns the shared list again. It also replaces a caller\'s own empty list with a new one, so the caller never sees the append. The fix is `cart=None` + `if cart is None: cart = []`.',
        timeLimitSec: 180,
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Ship the fix',
        prompt: 'Fix `reserve` so each call without a cart gets its own list, and a caller-supplied cart (even an empty one) is appended to in place.',
        editable: ['inventory/reserve.py'],
        tests: [
          {
            path: 'tests/test_reserve.py',
            content: `from inventory.reserve import reserve, total_units

def test_independent_carts():
    a = reserve("apple", 2)
    b = reserve("pear", 1)
    assert total_units(a) == 2
    assert total_units(b) == 1

def test_caller_cart_mutated_in_place():
    mine = []
    out = reserve("fig", 4, mine)
    assert out is mine
    assert mine == [("fig", 4)]

def test_rejects_non_positive():
    try:
        reserve("x", 0)
        assert False, "expected ValueError"
    except ValueError:
        pass
`,
          },
        ],
        solution: {
          'inventory/reserve.py': `def reserve(sku, qty, cart=None):
    """Add a reservation to the cart and return the cart."""
    if qty <= 0:
        raise ValueError("qty must be positive")
    if cart is None:
        cart = []
    cart.append((sku, qty))
    return cart


def total_units(cart):
    return sum(q for _, q in cart)
`,
        },
        hints: ['Use a sentinel default of `None`.'],
        explanation: 'Use `None` as the sentinel and allocate inside the function. Compare with `is None`, not truthiness, so an empty caller cart is respected.',
        timeLimitSec: 420,
        focusFile: 'inventory/reserve.py',
      },
    ],
  },
  {
    id: 'l3-ts-booking-trace',
    title: 'Booking Service: First Day',
    level: 3,
    rating: 1650,
    lang: 'typescript',
    domain: 'booking',
    companies: ['atlassian', 'meta', 'uber'],
    tags: ['tracing', 'dependency-injection', 'date-ranges'],
    summary: 'Trace POST /bookings end to end, then fix a double-booking bug.',
    context: 'You joined the team that owns the room booking service. A customer reports two meetings booked into the same room at overlapping times.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'src/server.ts',
        content: `import { BookingController } from './controller';
import { BookingService } from './service';
import { InMemoryRepo } from './repo';

const repo = new InMemoryRepo();
const service = new BookingService(repo);
export const controller = new BookingController(service);
`,
      },
      {
        path: 'src/controller.ts',
        content: `import { BookingService } from './service';
import { parseRequest } from './validation';

export class BookingController {
  constructor(private service: BookingService) {}

  post(body: unknown): { status: number; body: unknown } {
    const req = parseRequest(body);
    if (!req.ok) return { status: 400, body: { error: req.error } };
    try {
      const booking = this.service.book(req.value.room, req.value.start, req.value.end);
      return { status: 201, body: booking };
    } catch (e) {
      return { status: 409, body: { error: (e as Error).message } };
    }
  }
}
`,
      },
      {
        path: 'src/validation.ts',
        content: `export type BookingRequest = { room: string; start: number; end: number };

export function parseRequest(body: any): { ok: true; value: BookingRequest } | { ok: false; error: string } {
  if (!body || typeof body.room !== 'string') return { ok: false, error: 'room required' };
  if (!(body.start < body.end)) return { ok: false, error: 'start must be before end' };
  return { ok: true, value: { room: body.room, start: body.start, end: body.end } };
}
`,
      },
      {
        path: 'src/service.ts',
        content: `import { InMemoryRepo, Booking } from './repo';
import { overlaps } from './time';

export class BookingService {
  constructor(private repo: InMemoryRepo) {}

  book(room: string, start: number, end: number): Booking {
    const existing = this.repo.findByRoom(room);
    if (existing.some((b) => overlaps(b, { start, end }))) {
      throw new Error('room already booked');
    }
    return this.repo.insert({ room, start, end });
  }
}
`,
      },
      {
        path: 'src/time.ts',
        content: `export interface Range { start: number; end: number }

/** Half-open intervals [start, end). Back-to-back meetings do not overlap. */
export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start > a.end;
}
`,
      },
      {
        path: 'src/repo.ts',
        content: `export interface Booking { id: number; room: string; start: number; end: number }

export class InMemoryRepo {
  private rows: Booking[] = [];
  private nextId = 1;

  findByRoom(room: string): Booking[] {
    return this.rows.filter((r) => r.room === room);
  }

  insert(b: Omit<Booking, 'id'>): Booking {
    const row = { id: this.nextId++, ...b };
    this.rows.push(row);
    return row;
  }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace POST /bookings',
        prompt: 'A valid request hits `controller.post(...)`. Order the calls as they execute for a successful booking.',
        items: [
          'BookingController.post',
          'parseRequest (validation.ts)',
          'BookingService.book',
          'InMemoryRepo.findByRoom',
          'overlaps (time.ts) for each existing booking',
          'InMemoryRepo.insert',
          'Controller returns 201',
        ],
        hints: ['Start in controller.ts and follow each call.'],
        explanation: 'Controller → validation → service → repo lookup → overlap check → insert → 201. `server.ts` only wires the dependencies (constructor injection).',
        timeLimitSec: 300,
        focusFile: 'src/controller.ts',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Reproduce the bug',
        prompt: 'Room A has a booking `[10, 20)`. Which new requests are **wrongly accepted** by the current code? Select all that apply.',
        options: ['[15, 25)', '[5, 15)', '[12, 18)', '[20, 30)', '[0, 10)'],
        correct: [0, 1, 2],
        hints: ['Evaluate `a.start < b.end && b.start > a.end` with a = [10,20).', 'For [15,25): is 15 > 20?'],
        explanation: 'The second clause should be `b.start < a.end`. As written it requires the new booking to start after the old one *ends*, which no overlapping booking does, so every true overlap is accepted. [20,30) and [0,10) are back-to-back and are correctly accepted.',
        timeLimitSec: 300,
        focusFile: 'src/time.ts',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the overlap check',
        prompt: 'Fix the double-booking bug. Back-to-back bookings (`[10,20)` then `[20,30)`) must still be allowed.',
        editable: ['src/time.ts'],
        tests: [
          {
            path: 'tests/booking.test.ts',
            content: `import { BookingController } from '../src/controller';
import { BookingService } from '../src/service';
import { InMemoryRepo } from '../src/repo';

function fresh() {
  return new BookingController(new BookingService(new InMemoryRepo()));
}

test('rejects overlapping booking', () => {
  const c = fresh();
  expect(c.post({ room: 'A', start: 10, end: 20 }).status).toBe(201);
  expect(c.post({ room: 'A', start: 15, end: 25 }).status).toBe(409);
  expect(c.post({ room: 'A', start: 5, end: 15 }).status).toBe(409);
  expect(c.post({ room: 'A', start: 12, end: 18 }).status).toBe(409);
  expect(c.post({ room: 'A', start: 0, end: 100 }).status).toBe(409);
});

test('allows back-to-back bookings', () => {
  const c = fresh();
  expect(c.post({ room: 'A', start: 10, end: 20 }).status).toBe(201);
  expect(c.post({ room: 'A', start: 20, end: 30 }).status).toBe(201);
  expect(c.post({ room: 'A', start: 0, end: 10 }).status).toBe(201);
});

test('other rooms are independent', () => {
  const c = fresh();
  expect(c.post({ room: 'A', start: 10, end: 20 }).status).toBe(201);
  expect(c.post({ room: 'B', start: 10, end: 20 }).status).toBe(201);
});
`,
          },
        ],
        solution: {
          'src/time.ts': `export interface Range { start: number; end: number }

/** Half-open intervals [start, end). Back-to-back meetings do not overlap. */
export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}
`,
        },
        hints: ['Two half-open intervals overlap iff each starts before the other ends.'],
        explanation: '`a.start < b.end && b.start < a.end` is the canonical half-open overlap test. Using `<=` would wrongly reject back-to-back meetings.',
        timeLimitSec: 600,
        focusFile: 'src/time.ts',
      },
    ],
  },
];

export default problems;
