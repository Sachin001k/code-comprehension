import type { Problem } from '../types';

const problems: Problem[] = [
  {
    id: "l4-a-inventory-oversell-race",
    title: "Flash Sale Oversell",
    level: 4,
    rating: 2250,
    lang: "typescript",
    domain: "inventory",
    companies: ["amazon", "canva", "atlassian", "uber"],
    tags: ["concurrency", "async", "race-condition", "lost-update", "mutex", "event-loop"],
    summary: `No errors in the logs, yet 57 lamps were sold from a shelf of 40. Find the interleaving and close it.`,
    context: `You are on call for the **inventory** team. During this morning's flash sale the shop sold more lamps than it had (see \`INCIDENT.md\`). Nothing threw, nothing timed out.

The service is single-threaded Node, so people on the team keep saying "we can't have races, there are no threads". Every repo call is a real round-trip (\`tick()\` simulates it), so other requests run while one is waiting.

The platform team already ships a per-SKU \`KeyedMutex\` and uses it in \`RestockService\`.`,
    persona: "confident-intern",
    files: [
      {
        path: "INCIDENT.md",
        content: `# INC-4471: lamps oversold during flash sale

- 09:00:00 flash sale starts, \`lamp\` stock = 40
- 09:00:03 dashboard shows \`available = 0\`
- 09:04 warehouse reports **57** paid orders for lamps, only 40 on the shelf
- \`reserved\` column for \`lamp\` reads **31**, which matches neither number

Checkout p99 latency was normal. No errors in the logs.
Every request went through \`CheckoutService.placeOrder\`.
`,
        language: "markdown",
      },
      {
        path: "src/inventory/reservationService.ts",
        content: `import { StockRepo } from './stockRepo';
import { AuditLog } from './audit';
import { KeyedMutex } from './keyedMutex';
import { OutOfStockError, ValidationError } from './errors';

interface Hold {
  sku: string;
  qty: number;
}

const holdKey = (orderId: string, sku: string) => orderId + '::' + sku;

/**
 * Moves units from \`available\` to \`reserved\` while an order is being paid for.
 * Called concurrently by many checkout requests.
 */
export class ReservationService {
  private holds = new Map<string, Hold>();

  constructor(
    private repo: StockRepo,
    private audit: AuditLog,
    private mutex: KeyedMutex,
  ) {}

  /** Reserve \`qty\` units of \`sku\` for \`orderId\`. Returns units still available. */
  async reserve(orderId: string, sku: string, qty: number): Promise<number> {
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer');
    const row = await this.repo.get(sku);
    if (row.available < qty) {
      throw new OutOfStockError(sku, qty, row.available);
    }
    await this.audit.record('reserve', sku, qty, orderId);
    row.available -= qty;
    row.reserved += qty;
    await this.repo.put(row);
    const key = holdKey(orderId, sku);
    const prev = this.holds.get(key);
    this.holds.set(key, { sku, qty: (prev?.qty ?? 0) + qty });
    return row.available;
  }

  /** Give back everything \`orderId\` holds for \`sku\`. No-op if nothing is held. */
  async release(orderId: string, sku: string): Promise<void> {
    const key = holdKey(orderId, sku);
    const hold = this.holds.get(key);
    if (!hold) return;
    this.holds.delete(key);
    const row = await this.repo.get(sku);
    await this.audit.record('release', sku, hold.qty, orderId);
    row.available += hold.qty;
    row.reserved -= hold.qty;
    await this.repo.put(row);
  }

  heldBy(orderId: string): Hold[] {
    const out: Hold[] = [];
    for (const [k, h] of this.holds) if (k.startsWith(orderId + '::')) out.push({ ...h });
    return out;
  }
}
`,
      },
      {
        path: "src/inventory/stockRepo.ts",
        content: `import { tick } from '../util/tick';

export interface StockRow {
  sku: string;
  /** Units that can still be sold. */
  available: number;
  /** Units held by open orders (not yet shipped). */
  reserved: number;
}

/**
 * Async stand-in for the \`stock\` table. Every call is one round-trip.
 * Reads return a COPY of the row, exactly like a SELECT would.
 */
export class StockRepo {
  private rows = new Map<string, StockRow>();
  reads = 0;
  writes = 0;

  seed(sku: string, available: number): void {
    this.rows.set(sku, { sku, available, reserved: 0 });
  }

  async get(sku: string): Promise<StockRow> {
    await tick();
    this.reads++;
    const row = this.rows.get(sku);
    if (!row) throw new Error('unknown sku ' + sku);
    return { ...row };
  }

  /** Full-row overwrite (UPDATE stock SET available=?, reserved=? WHERE sku=?). */
  async put(row: StockRow): Promise<void> {
    await tick();
    this.writes++;
    this.rows.set(row.sku, { ...row });
  }

  /** Synchronous peek for tests and admin tooling only. */
  snapshot(sku: string): StockRow | undefined {
    const r = this.rows.get(sku);
    return r ? { ...r } : undefined;
  }
}
`,
      },
      {
        path: "src/inventory/keyedMutex.ts",
        content: `/**
 * Per-key async mutex.
 *
 * Callers that pass the same key run one at a time, in arrival order.
 * Callers with different keys never wait for each other.
 *
 *   await mutex.runExclusive('sku-1', async () => { ...critical section... });
 *
 * The lock is released when \`fn\` settles, whether it resolves or throws.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** True if someone currently holds or waits for \`key\`. */
  isBusy(key: string): boolean {
    return this.tails.has(key);
  }
}
`,
      },
      {
        path: "src/inventory/restockService.ts",
        content: `import { StockRepo } from './stockRepo';
import { AuditLog } from './audit';
import { KeyedMutex } from './keyedMutex';
import { ValidationError } from './errors';

/**
 * Warehouse restocks. Written by the platform team last quarter.
 * Every read-modify-write of a stock row happens inside the per-SKU mutex.
 */
export class RestockService {
  constructor(
    private repo: StockRepo,
    private audit: AuditLog,
    private mutex: KeyedMutex,
  ) {}

  async restock(sku: string, qty: number, ref: string): Promise<number> {
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer');
    return this.mutex.runExclusive(sku, async () => {
      const row = await this.repo.get(sku);
      row.available += qty;
      await this.audit.record('restock', sku, qty, ref);
      await this.repo.put(row);
      return row.available;
    });
  }
}
`,
      },
      {
        path: "src/orders/checkout.ts",
        content: `import { ReservationService } from '../inventory/reservationService';

export interface OrderLine {
  sku: string;
  qty: number;
}

export type CheckoutResult =
  | { ok: true; orderId: string }
  | { ok: false; orderId: string; reason: string };

/**
 * Reserves every line of an order. If any line fails, the lines already
 * reserved are released again (compensation) so the order is all-or-nothing.
 */
export class CheckoutService {
  constructor(private reservations: ReservationService) {}

  async placeOrder(orderId: string, lines: OrderLine[]): Promise<CheckoutResult> {
    const done: string[] = [];
    try {
      for (const line of lines) {
        await this.reservations.reserve(orderId, line.sku, line.qty);
        done.push(line.sku);
      }
      return { ok: true, orderId };
    } catch (e) {
      for (const sku of done) await this.reservations.release(orderId, sku);
      return { ok: false, orderId, reason: (e as Error).message };
    }
  }
}
`,
      },
      {
        path: "src/inventory/audit.ts",
        content: `import { tick } from '../util/tick';

export interface AuditEntry {
  seq: number;
  kind: 'reserve' | 'release' | 'restock';
  sku: string;
  qty: number;
  ref: string;
}

/** Append-only audit trail (async because it is a remote write in prod). */
export class AuditLog {
  private seq = 0;
  readonly entries: AuditEntry[] = [];

  async record(kind: AuditEntry['kind'], sku: string, qty: number, ref: string): Promise<void> {
    await tick();
    this.entries.push({ seq: ++this.seq, kind, sku, qty, ref });
  }

  forSku(sku: string): AuditEntry[] {
    return this.entries.filter((e) => e.sku === sku);
  }
}
`,
      },
      {
        path: "src/inventory/errors.ts",
        content: `export class OutOfStockError extends Error {
  constructor(
    public readonly sku: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super('out of stock: ' + sku + ' requested ' + requested + ', available ' + available);
    this.name = 'OutOfStockError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
`,
      },
      {
        path: "src/util/tick.ts",
        content: `/**
 * Simulates one database / network round-trip.
 * In production this is a real I/O call; here it just yields to the event loop
 * so other in-flight requests get a chance to run (exactly like real I/O would).
 */
export function tick(): Promise<void> {
  return Promise.resolve();
}

export async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await tick();
}
`,
      },
      {
        path: "src/app.ts",
        content: `import { StockRepo } from './inventory/stockRepo';
import { AuditLog } from './inventory/audit';
import { KeyedMutex } from './inventory/keyedMutex';
import { ReservationService } from './inventory/reservationService';
import { RestockService } from './inventory/restockService';
import { CheckoutService } from './orders/checkout';

/** Composition root: one shared mutex for every service that touches stock rows. */
export function createApp() {
  const repo = new StockRepo();
  const audit = new AuditLog();
  const mutex = new KeyedMutex();
  const reservations = new ReservationService(repo, audit, mutex);
  const restock = new RestockService(repo, audit, mutex);
  const checkout = new CheckoutService(reservations);
  return { repo, audit, mutex, reservations, restock, checkout };
}
`,
      },
      {
        path: "src/demo.ts",
        content: `import { createApp } from './app';

// Two shoppers hit "Buy" on the last lamps at the same moment.
async function main() {
  const app = createApp();
  app.repo.seed('lamp', 5);

  const results = await Promise.all([
    app.checkout.placeOrder('A', [{ sku: 'lamp', qty: 3 }]),
    app.checkout.placeOrder('B', [{ sku: 'lamp', qty: 3 }]),
  ]);

  for (const r of results) console.log(r.orderId, r.ok ? 'ok' : 'failed');
  const row = app.repo.snapshot('lamp')!;
  console.log('available=' + row.available, 'reserved=' + row.reserved);
}

main();
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "predict",
        title: "Reproduce with two shoppers",
        prompt: `Run \`src/demo.ts\` in your head. Stock is 5 lamps and two orders for 3 lamps each arrive together via \`Promise.all\`. What does it print?`,
        entry: "src/demo.ts",
        answer: `A ok
B ok
available=2 reserved=3`,
        options: [
          `A ok
B failed
available=2 reserved=3`,
          `A ok
B ok
available=2 reserved=3`,
          `A ok
B ok
available=-1 reserved=6`,
          `A failed
B ok
available=2 reserved=3`,
        ],
        hints: [
          "`Promise.all` starts both `placeOrder` calls before either has finished its first `await`.",
          "Both requests call `repo.get` before either calls `repo.put`. What `available` does each one see?",
        ],
        explanation: `Both requests read the row while it still says \`available: 5\`, so both pass the stock check. Each then works out its new row from its **own stale copy** (5 - 3 = 2, 0 + 3 = 3) and writes the whole row back. The second \`put\` overwrites the first.

So **both orders succeed**, six lamps are promised from a shelf of five, and the row still says \`available=2 reserved=3\`, as if only one order happened. This is a *lost update*, and it matches the incident: more sales than stock, and a \`reserved\` figure that matches neither number. Node runs on one thread, but every \`await\` is a point where another request can run.`,
        timeLimitSec: 300,
        focusFile: "src/demo.ts",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Order the interleaving",
        prompt: `Put the events of the demo run in the order they actually happen. Every repo/audit call costs one \`tick()\`, and the two requests take the same number of awaits on each path.`,
        items: [
          "A: repo.get reads lamp (available 5)",
          "B: repo.get reads lamp (available 5)",
          "A: stock check passes (5 >= 3)",
          "B: stock check passes (5 >= 3)",
          "A: audit.record('reserve')",
          "B: audit.record('reserve')",
          "A: repo.put writes {available 2, reserved 3}",
          "B: repo.put writes {available 2, reserved 3}",
        ],
        hints: [
          "When an `await` suspends request A, the next queued job is request B reaching the same `await`.",
          "The two requests do the same work, so they take turns: A, B, A, B...",
        ],
        explanation: `\`Promise.all\` runs A until its first \`await\` (inside \`repo.get\`), then runs B until the same point. Microtasks run in FIFO order and both paths have the same number of awaits, so the two requests **alternate step by step**. The read of A and the write of A are separated by two awaits (audit, put), and B fits its whole read into that gap.

To fix this you have to make sure that no other request on the same SKU can run between the \`get\` and the \`put\`. Making the steps faster does not help.`,
        timeLimitSec: 360,
        focusFile: "src/inventory/reservationService.ts",
      },
      {
        id: "s3",
        kind: "mcq",
        title: "Which fixes actually close the race?",
        prompt: `Select **all** changes that, on their own, would make concurrent \`reserve\` calls for the same SKU safe (no oversell, no lost update).`,
        options: [
          "Wrap the body of `reserve` (get → check → audit → put) in `this.mutex.runExclusive(sku, ...)`",
          `Add a repo method \`decrementIfAvailable(sku, qty)\` that checks and updates the row in one call with no \`await\` between check and write (like \`UPDATE ... SET available = available - ? WHERE available >= ?\`)`,
          "Re-read the row with `repo.get` right before `repo.put` and re-check `available`",
          `In \`CheckoutService.placeOrder\`, replace any parallelism with a sequential \`for\` loop (it already is one)`,
          "Move `audit.record` after `repo.put` so the read and the write are closer together",
        ],
        correct: [0, 1],
        hints: [
          "Any option that still has an `await` between \"decide based on what I read\" and \"write\" leaves a gap.",
          `Two different HTTP requests are two different \`placeOrder\` calls. Can a loop inside one call serialise them?`,
        ],
        explanation: `**Correct:** a per-SKU mutex makes the whole read-modify-write a critical section. A conditional atomic update moves the check into the write itself, so there is no window. In a real database this is \`UPDATE ... WHERE available >= ?\` with a check on the affected row count, or optimistic locking with a version column.

**Wrong:**
- Re-reading still leaves an \`await\` (the \`put\`'s round-trip) between the second read and the write. Two requests can both re-read 5.
- The loop in \`placeOrder\` only orders the lines of *one* order. The race is between *different* orders.
- Moving the audit call makes the window smaller, but the window is still there: \`get\` and \`put\` are both async, and B's \`get\` happens between them.`,
        timeLimitSec: 360,
      },
      {
        id: "s4",
        kind: "review-ai",
        title: "The intern has a quick fix",
        prompt: `Your teammate asked the assistant for a fix and wants to merge it before the next flash sale. Review it.`,
        persona: "confident-intern",
        request: "Fix the lamp oversell in ReservationService.reserve. Keep it simple, no locks please, they are slow.",
        aiReply: `No locks needed! The problem is we check stock **too early**: by the time we write, it is stale. Just read right before writing:

\`\`\`ts
async reserve(orderId: string, sku: string, qty: number): Promise<number> {
  if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer');
  await this.audit.record('reserve', sku, qty, orderId);
  const row = await this.repo.get(sku);            // fresh read
  if (row.available < qty) throw new OutOfStockError(sku, qty, row.available);
  row.available -= qty;
  row.reserved += qty;
  await this.repo.put(row);                         // written immediately after
  // ...holds bookkeeping unchanged...
  return row.available;
}
\`\`\`

Since Node is single-threaded and the check and write are now back to back, nothing can sneak in between. ✅`,
        options: [
          "Accept: the check and the write are now adjacent, so the race is gone",
          `Reject: \`repo.get\` and \`repo.put\` are still separate awaits, so two requests can both read the same row before either writes. The lost update and the oversell remain (and audit now logs reservations that then fail)`,
          `Reject only because the audit entry is now written for reservations that fail the stock check; the race itself is fixed`,
          "Reject: `OutOfStockError` must be thrown after the `put`, otherwise the row is left inconsistent",
        ],
        correct: 1,
        hints: [
          "Count the `await`s between \"read available\" and \"write available\". Is it zero?",
        ],
        explanation: `"Single-threaded" only means two callbacks never run *at the same instant*. It does not stop another request from running while you \`await\`. After this change the run is still: A \`get\` → B \`get\` → A \`put\` → B \`put\`, because \`get\` and \`put\` each take a round-trip. The window is smaller, but it is still there, and under flash-sale load small windows get hit all the time.

The audit problem in option 3 is real, but it is the smaller flaw. The deciding issue is that the oversell is not fixed.`,
        timeLimitSec: 300,
        focusFile: "src/inventory/reservationService.ts",
      },
      {
        id: "s5",
        kind: "code",
        task: "fix",
        title: "Close the race (both directions)",
        prompt: `Fix \`ReservationService\` so that concurrent requests can never oversell or lose an update.

- \`reserve\` **and** \`release\` both do a read-modify-write on the stock row, and both are affected.
- Follow the existing pattern: \`RestockService\` uses the **shared** \`KeyedMutex\` that is injected into your class. Reservations must also be serialised against restocks of the same SKU.
- Reservations for *different* SKUs must not block each other.
- A failed reservation (out of stock) must not leave the SKU locked.`,
        editable: ["src/inventory/reservationService.ts"],
        tests: [
          {
            path: "tests/reservations.test.ts",
            content: `import { createApp } from '../src/app';

test('two concurrent orders for the last units: exactly one wins', async () => {
  const app = createApp();
  app.repo.seed('lamp', 5);
  const rs = await Promise.all([
    app.checkout.placeOrder('A', [{ sku: 'lamp', qty: 3 }]),
    app.checkout.placeOrder('B', [{ sku: 'lamp', qty: 3 }]),
  ]);
  expect(rs.filter((r) => r.ok)).toHaveLength(1);
  expect(app.repo.snapshot('lamp')).toEqual({ sku: 'lamp', available: 2, reserved: 3 });
});

test('flash sale: 10 buyers, 7 units, never oversold and books balance', async () => {
  const app = createApp();
  app.repo.seed('lamp', 7);
  const rs = await Promise.all(
    Array.from({ length: 10 }, (_, i) => app.checkout.placeOrder('o' + i, [{ sku: 'lamp', qty: 1 }])),
  );
  expect(rs.filter((r) => r.ok)).toHaveLength(7);
  const row = app.repo.snapshot('lamp')!;
  expect(row.available).toBe(0);
  expect(row.reserved).toBe(7);
  expect(app.audit.forSku('lamp').filter((e) => e.kind === 'reserve')).toHaveLength(7);
});

test('release racing a reserve does not lose either update', async () => {
  const app = createApp();
  app.repo.seed('desk', 10);
  await app.reservations.reserve('A', 'desk', 4);
  await Promise.all([app.reservations.release('A', 'desk'), app.reservations.reserve('B', 'desk', 3)]);
  expect(app.repo.snapshot('desk')).toEqual({ sku: 'desk', available: 7, reserved: 3 });
});

test('restock racing a reserve does not lose either update', async () => {
  const app = createApp();
  app.repo.seed('desk', 2);
  await Promise.all([app.restock.restock('desk', 5, 'PO-1'), app.reservations.reserve('B', 'desk', 2)]);
  expect(app.repo.snapshot('desk')).toEqual({ sku: 'desk', available: 5, reserved: 2 });
});

test('a failed reservation does not keep the SKU locked', async () => {
  const app = createApp();
  app.repo.seed('lamp', 3);
  const rs = await Promise.all([
    app.checkout.placeOrder('big', [{ sku: 'lamp', qty: 100 }]),
    app.checkout.placeOrder('small', [{ sku: 'lamp', qty: 1 }]),
  ]);
  expect(rs.map((r) => r.ok)).toEqual([false, true]);
  expect(rs[0].ok ? '' : rs[0].reason).toContain('out of stock');
  expect(app.mutex.isBusy('lamp')).toBe(false);
  expect(app.repo.snapshot('lamp')).toEqual({ sku: 'lamp', available: 2, reserved: 1 });
});

test('reservations use the shared per-SKU mutex and other SKUs are not blocked', async () => {
  const app = createApp();
  app.repo.seed('lamp', 5);
  app.repo.seed('desk', 5);
  let letGo!: () => void;
  const gate = new Promise<void>((r) => (letGo = r));
  const held = app.mutex.runExclusive('lamp', () => gate);
  let lampDone = false;
  const lamp = app.reservations.reserve('A', 'lamp', 1).then(() => { lampDone = true; });
  await app.reservations.reserve('B', 'desk', 1);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(lampDone).toBe(false);
  letGo();
  await held;
  await lamp;
  expect(lampDone).toBe(true);
  expect(app.repo.snapshot('lamp')!.available).toBe(4);
});

test('multi-line order is all-or-nothing', async () => {
  const app = createApp();
  app.repo.seed('lamp', 5);
  app.repo.seed('desk', 1);
  const r = await app.checkout.placeOrder('C', [{ sku: 'lamp', qty: 2 }, { sku: 'desk', qty: 2 }]);
  expect(r.ok).toBe(false);
  expect(app.repo.snapshot('lamp')).toEqual({ sku: 'lamp', available: 5, reserved: 0 });
  expect(app.reservations.heldBy('C')).toEqual([]);
});

test('validation still rejects bad quantities', async () => {
  const app = createApp();
  app.repo.seed('lamp', 5);
  await expect(app.reservations.reserve('A', 'lamp', 0)).rejects.toThrow('positive integer');
  await expect(app.reservations.reserve('A', 'lamp', 1.5)).rejects.toThrow('positive integer');
});
`,
          },
        ],
        solution: {
          "src/inventory/reservationService.ts": `import { StockRepo } from './stockRepo';
import { AuditLog } from './audit';
import { KeyedMutex } from './keyedMutex';
import { OutOfStockError, ValidationError } from './errors';

interface Hold {
  sku: string;
  qty: number;
}

const holdKey = (orderId: string, sku: string) => orderId + '::' + sku;

/**
 * Moves units from \`available\` to \`reserved\` while an order is being paid for.
 * Called concurrently by many checkout requests.
 */
export class ReservationService {
  private holds = new Map<string, Hold>();

  constructor(
    private repo: StockRepo,
    private audit: AuditLog,
    private mutex: KeyedMutex,
  ) {}

  /** Reserve \`qty\` units of \`sku\` for \`orderId\`. Returns units still available. */
  async reserve(orderId: string, sku: string, qty: number): Promise<number> {
    if (!Number.isInteger(qty) || qty <= 0) throw new ValidationError('qty must be a positive integer');
    // The whole read-check-write must be atomic per SKU: no other request may
    // read this row between our get() and our put().
    return this.mutex.runExclusive(sku, async () => {
      const row = await this.repo.get(sku);
      if (row.available < qty) {
        throw new OutOfStockError(sku, qty, row.available);
      }
      await this.audit.record('reserve', sku, qty, orderId);
      row.available -= qty;
      row.reserved += qty;
      await this.repo.put(row);
      const key = holdKey(orderId, sku);
      const prev = this.holds.get(key);
      this.holds.set(key, { sku, qty: (prev?.qty ?? 0) + qty });
      return row.available;
    });
  }

  /** Give back everything \`orderId\` holds for \`sku\`. No-op if nothing is held. */
  async release(orderId: string, sku: string): Promise<void> {
    const key = holdKey(orderId, sku);
    const hold = this.holds.get(key);
    if (!hold) return;
    this.holds.delete(key);
    await this.mutex.runExclusive(sku, async () => {
      const row = await this.repo.get(sku);
      await this.audit.record('release', sku, hold.qty, orderId);
      row.available += hold.qty;
      row.reserved -= hold.qty;
      await this.repo.put(row);
    });
  }

  heldBy(orderId: string): Hold[] {
    const out: Hold[] = [];
    for (const [k, h] of this.holds) if (k.startsWith(orderId + '::')) out.push({ ...h });
    return out;
  }
}
`,
        },
        hints: [
          "Look at how `RestockService.restock` wraps its read-modify-write.",
          `Use \`this.mutex.runExclusive(sku, async () => { ... })\` around the get→put section in both methods. A new private lock would not serialise you against restocks.`,
          "`runExclusive` releases the lock in a `finally`, so throwing `OutOfStockError` inside it is fine.",
        ],
        explanation: `The critical section is everything from reading the row to writing it back. Put it inside the per-SKU lock that is already injected:

\`\`\`ts
return this.mutex.runExclusive(sku, async () => {
  const row = await this.repo.get(sku);
  if (row.available < qty) throw new OutOfStockError(sku, qty, row.available);
  ...
  await this.repo.put(row);
  return row.available;
});
\`\`\`

\`release\` gets the same treatment. Without it, a cancellation that runs at the same time as a new reservation overwrites one of the two changes.

Why the **shared** mutex: lock scope has to match data scope. \`RestockService\` writes the same row, so all writers must use the same lock for that key. A private \`new KeyedMutex()\` inside \`ReservationService\` would still lose updates against restocks.

In a real system you would usually move this into the database instead: a conditional \`UPDATE\`, \`SELECT ... FOR UPDATE\`, or a version column with retry. An in-process lock only works while there is a single instance.`,
        timeLimitSec: 900,
        focusFile: "src/inventory/reservationService.ts",
      },
    ],
  },
  {
    id: "l4-a-build-graph-cycles",
    title: "Monorepo Build Planner",
    level: 4,
    rating: 2100,
    lang: "python",
    domain: "graph",
    companies: ["google", "meta", "atlassian", "canva"],
    tags: ["topological-sort", "dfs", "cycle-detection", "incremental-build", "graph"],
    summary: `CI builds in the wrong order, one cycle crashes with a bare KeyError, and incremental builds ship stale binaries.`,
    context: `You own the in-house build planner for the monorepo. It reads \`BUILD.txt\`, finds a build order, groups targets into parallel waves, and on each commit rebuilds only what changed.

Two tickets are open:
- **BUILD-212**: after someone added \`core: lib\` to a branch where \`lib: core\` already existed, CI crashed with \`KeyError: 'core'\` in \`waves.py\`. Nobody could tell what was wrong.
- **BUILD-219**: after a change to \`crypto\`, the incremental build rebuilt \`auth\` but deployed an \`app\` binary that still had the old crypto code in it.`,
    persona: "helpful-senior",
    files: [
      {
        path: "build/topo.py",
        content: `from build.errors import UnknownTargetError


def build_order(graph, roots=None):
    """Return the targets reachable from \`roots\` so that every target comes
    after all of its dependencies. Dependencies are visited in sorted order
    so the result is deterministic. Raises CycleError on a dependency loop."""
    roots = sorted(graph.targets()) if roots is None else list(roots)
    order = []
    done = set()

    def visit(t):
        if t in done:
            return
        done.add(t)
        for d in sorted(graph.deps(t)):
            visit(d)
        order.append(t)

    for r in roots:
        if not graph.has(r):
            raise UnknownTargetError(r)
        visit(r)
    return order
`,
      },
      {
        path: "build/incremental.py",
        content: `import hashlib


def fingerprint(sources):
    """Map target -> short content hash of its source text."""
    return {t: hashlib.sha256(src.encode("utf-8")).hexdigest()[:12] for t, src in sources.items()}


def changed_targets(old_prints, new_prints):
    """Targets whose own sources changed (or are new)."""
    return {t for t, h in new_prints.items() if old_prints.get(t) != h}


def affected(graph, changed):
    """Targets that must be rebuilt: the changed ones plus every target that
    depends on them, directly or transitively."""
    dirty = set(changed)
    for t in changed:
        for parent in graph.dependents(t):
            dirty.add(parent)
    return dirty
`,
      },
      {
        path: "build/planner.py",
        content: `from build.incremental import affected
from build.topo import build_order


def plan(graph, roots, changed):
    """Targets to rebuild, in a valid build order."""
    order = build_order(graph, roots)
    dirty = affected(graph, changed)
    return [t for t in order if t in dirty]


def explain(graph, roots, changed):
    steps = plan(graph, roots, changed)
    if not steps:
        return "nothing to do"
    return "\\n".join("%d. build %s" % (i + 1, t) for i, t in enumerate(steps))
`,
      },
      {
        path: "build/waves.py",
        content: `from build.topo import build_order


def waves(graph, roots=None):
    """Group targets into waves that can be built in parallel.

    Wave 0 = targets with no deps; a target goes in wave 1 + (highest wave
    among its deps). Each wave is sorted by name.
    """
    order = build_order(graph, roots)
    level = {}
    for t in order:
        ds = graph.deps(t)
        level[t] = 0 if not ds else 1 + max(level[d] for d in ds)
    if not level:
        return []
    out = [[] for _ in range(max(level.values()) + 1)]
    for t, lv in level.items():
        out[lv].append(t)
    return [sorted(w) for w in out]
`,
      },
      {
        path: "build/graph.py",
        content: `class Graph:
    """Directed graph of build targets. An edge t -> d means "t depends on d"
    (d must be built before t)."""

    def __init__(self):
        self._deps = {}
        self._rdeps = {}

    def add(self, target, deps=()):
        self._ensure(target)
        for d in deps:
            self._ensure(d)
            self._deps[target].add(d)
            self._rdeps[d].add(target)

    def _ensure(self, t):
        if t not in self._deps:
            self._deps[t] = set()
            self._rdeps[t] = set()

    def has(self, t):
        return t in self._deps

    def targets(self):
        return list(self._deps)

    def deps(self, t):
        """Direct dependencies of t (what t needs)."""
        return set(self._deps[t])

    def dependents(self, t):
        """Direct dependents of t (who needs t)."""
        return set(self._rdeps[t])

    def __len__(self):
        return len(self._deps)
`,
      },
      {
        path: "build/parser.py",
        content: `from build.errors import ParseError
from build.graph import Graph


def parse(text):
    """Parse a BUILD manifest.

    Each non-empty line is \`target: dep1 dep2 ...\`. \`#\` starts a comment.
    A dependency that never appears on the left is a leaf (a source package).
    """
    g = Graph()
    for no, raw in enumerate(text.splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if ":" not in line:
            raise ParseError(no, raw)
        name, _, rest = line.partition(":")
        name = name.strip()
        if not name or " " in name:
            raise ParseError(no, raw)
        g.add(name, rest.split())
    return g
`,
      },
      {
        path: "build/errors.py",
        content: `class BuildError(Exception):
    """Base class for everything the build planner raises."""


class CycleError(BuildError):
    """Raised when targets depend on each other in a loop.

    \`cycle\` is the loop as a list that starts and ends with the same target,
    e.g. ["lib", "core", "lib"] means lib -> core -> lib.
    """

    def __init__(self, cycle):
        self.cycle = list(cycle)
        super().__init__("dependency cycle: " + " -> ".join(self.cycle))


class UnknownTargetError(BuildError):
    def __init__(self, target):
        self.target = target
        super().__init__("unknown target: " + target)


class ParseError(BuildError):
    def __init__(self, line_no, line):
        super().__init__("line %d: cannot parse %r" % (line_no, line))
`,
      },
      {
        path: "build/cli.py",
        content: `import sys

from build.errors import BuildError
from build.parser import parse
from build.planner import explain
from build.waves import waves


def main(argv, manifest_text, changed):
    """\`build plan <root>\` / \`build waves <root>\` entry point used by CI."""
    try:
        g = parse(manifest_text)
        cmd, root = argv[0], argv[1]
        if cmd == "plan":
            print(explain(g, [root], set(changed)))
        elif cmd == "waves":
            for i, w in enumerate(waves(g, [root])):
                print("wave %d: %s" % (i, " ".join(w)))
        else:
            print("unknown command " + cmd)
            return 2
        return 0
    except BuildError as e:
        print("build error: %s" % e, file=sys.stderr)
        return 1
`,
      },
      {
        path: "build/__init__.py",
        content: "",
      },
      {
        path: "BUILD.txt",
        content: `# monorepo build manifest
app: api ui
api: models auth
ui: components models
auth: models crypto
components: icons
models:
crypto:
icons:
`,
        language: "text",
      },
      {
        path: "main.py",
        content: `from build.parser import parse
from build.planner import plan
from build.topo import build_order
from build.waves import waves

with open("BUILD.txt") as f:
    g = parse(f.read())

print(" ".join(build_order(g, ["app"])))
for i, w in enumerate(waves(g, ["app"])):
    print(i, w)
print(plan(g, ["app"], {"crypto"}))
`,
      },
      {
        path: "cycle_demo.py",
        content: `from build.parser import parse
from build.topo import build_order
from build.waves import waves

g = parse("""
lib: core
core: lib
""")
print("order:", build_order(g))
try:
    print("waves:", waves(g))
except Exception as e:
    print("waves failed:", type(e).__name__, e)
`,
      },
      {
        path: "build/__pycache__/__init__.cpython-314.pyc",
        content: `+
    �%	k    �                   �   � R # )N� r   �    ڠ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/__init__.py�<module>r      s   �r   `,
      },
      {
        path: "build/__pycache__/errors.cpython-314.pyc",
        content: `+
    �%	k�  �                   �^   �  ! R  R] 4      t ! R R]4      t ! R R]4      t ! R R]4      tR# )	c                   �   � ] tR t^tRtRtR# )�
BuildErrorz3Base class for everything the build planner raises.� N)�__name__�
__module__�__qualname__�__firstlineno__�__doc__�__static_attributes__r   �    ڞ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/errors.pyr   r      s   � �=r   r   c                   �6   a a� ] tR t^t oRtV 3R ltRtVtV ;t# )�
CycleErrorz�Raised when targets depend on each other in a loop.

\`cycle\` is the loop as a list that starts and ends with the same target,
e.g. ["lib", "core", "lib"] means lib -> core -> lib.
c                �   <� \\        V4      V n        \\        SV \`  R RP	                  V P                  4      ,           4       R# )zdependency cycle: z -> N)�list�cycle�super�__init__�join)�selfr   �	__class__s   &&�r   r   �CycleError.__init__   s.   �� ��%�[��
����-����D�J�J�0G�G�Hr   )r   )	r   r   r   r   r	   r   r
   �__classdictcell__�__classcell__�r   �__classdict__s   @@r   r   r      s   �� � ��I� Ir   r   c                   �2   a a� ] tR t^t oV 3R ltRtVtV ;t# )�UnknownTargetErrorc                �@   <� Wn         \\        SV \`	  R V,           4       R# )zunknown target: N)�targetr   r   )r   r   r   s   &&�r   r   �UnknownTargetError.__init__   s   �� ������+�f�4�5r   )r   �r   r   r   r   r   r
   r   r   r   s   @@r   r   r      s   �� � �6� 6r   r   c                   �2   a a� ] tR t^t oV 3R ltRtVtV ;t# )�
ParseErrorc                �6   <� \\         SV \`  R W3,          4       R# )zline %d: cannot parse %rN)r   r   )r   �line_no�liner   s   &&&�r   r   �ParseError.__init__   s   �� ����3�w�o�E�Fr   r   r!   r   s   @@r   r#   r#      s   �� � �G� Gr   r#   N)�	Exceptionr   r   r   r#   r   r   r   �<module>r)      s9   ��>�� >�	I�� 	I�6�� 6�G�� Gr   `,
      },
      {
        path: "build/__pycache__/graph.cpython-314.pyc",
        content: `+
    �%	k�  �                   �   �  ! R  R4      t R# )c                   �X   a � ] tR t^t o RtR tRR ltR tR tR t	R t
R tR	 tR
tV tR# )�GraphzbDirected graph of build targets. An edge t -> d means "t depends on d"
(d must be built before t).c                �"   � / V n         / V n        R # �N��_deps�_rdeps��selfs   &ڝ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/graph.py�__init__�Graph.__init__   s   � ���
����    c                ��   � V P                  V4       V FX  pV P                  V4       V P                  V,          P                  V4       V P                  V,          P                  V4       KZ  	  R # r   )�_ensurer   �addr   )r
   �target�deps�ds   &&& r   r   �	Graph.add	   sP   � ����V���A��L�L��O��J�J�v��"�"�1�%��K�K��N���v�&� r   c                �   � WP                   9  d1   \\        4       V P                   V&   \\        4       V P                  V&   R # R # r   )r   �setr   �r
   �ts   &&r   r   �Graph._ensure   s/   � ��J�J���E�D�J�J�q�M� �U�D�K�K��N� r   c                �   � WP                   9   # r   )r   r   s   &&r   �has�	Graph.has   s   � ��J�J��r   c                �,   � \\        V P                  4      # r   )�listr   r	   s   &r   �targets�Graph.targets   s   � ��D�J�J��r   c                �:   � \\        V P                  V,          4      # )z(Direct dependencies of t (what t needs).)r   r   r   s   &&r   r   �
Graph.deps   s   � ��4�:�:�a�=�!�!r   c                �:   � \\        V P                  V,          4      # )z%Direct dependents of t (who needs t).)r   r   r   s   &&r   �
dependents�Graph.dependents   s   � ��4�;�;�q�>�"�"r   c                �,   � \\        V P                  4      # r   )�lenr   r	   s   &r   �__len__�Graph.__len__#   s   � ��4�:�:��r   r   N)� )�__name__�
__module__�__qualname__�__firstlineno__�__doc__r   r   r   r   r    r   r%   r)   �__static_attributes__�__classdictcell__)�__classdict__s   @r   r   r      s7   �� � �#��'�#�
� �"�#�� r   r   N)r   r+   r   r   �<module>r4      s   ��#� #r   `,
      },
      {
        path: "build/__pycache__/incremental.cpython-314.pyc",
        content: `+
    �%	k�  �                   �    � ^ RI t R tR tR tR# )�    Nc           
     ��   � V P                  4        UUu/ uF@  w  rV\\        P                  ! VP                  R4      4      P	                  4       R,          bKB  	  upp# u uppi )z4Map target -> short content hash of its source text.zutf-8:N�   N)�items�hashlib�sha256�encode�	hexdigest)�sources�t�srcs   &  ڣ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/incremental.py�fingerprintr      sL   � �RY�R_�R_�Ra�b�Ra���A�w�~�~�c�j�j��1�2�<�<�>�s�C�C�Ra�b�b��bs   �AAc                �   � VP                  4        UUu0 uF  w  r#V P                  V4      V8w  g   K  VkK!  	  upp# u uppi )z/Targets whose own sources changed (or are new).)r   �get)�
old_prints�
new_printsr   �hs   &&  r   �changed_targetsr   	   s9   � �$�*�*�,�G�,�$�!�
���q�0A�Q�0F�A�A�,�G�G��Gs   �=�=c                �   � \\        V4      pV F,  pV P                  V4       F  pVP                  V4       K  	  K.  	  V# )zpTargets that must be rebuilt: the changed ones plus every target that
depends on them, directly or transitively.)�set�
dependents�add)�graph�changed�dirtyr   �parents   &&   r   �affectedr      s?   � � ��L�E����&�&�q�)�F��I�I�f�� *� � �L�    )r   r   r   r   � r   r   �<module>r       s   �� �c�
H�
r   `,
      },
      {
        path: "build/__pycache__/parser.cpython-314.pyc",
        content: `+
    �%	k�  �                   �$   � ^ RI Ht ^ RIHt R tR# )�    )�
ParseError)�Graphc                �  � \\        4       p\\        V P                  4       ^R7       F�  w  r#VP                  R^4      ^ ,          P	                  4       pV'       g   K6  RV9  d   \\        W#4      hVP                  R4      w  rVpVP	                  4       pV'       d   RV9   d   \\        W#4      hVP                  WWP                  4       4       K�  	  V# )z�Parse a BUILD manifest.

Each non-empty line is \`target: dep1 dep2 ...\`. \`#\` starts a comment.
A dependency that never appears on the left is a leaf (a source package).
)�start�#�:� )r   �	enumerate�
splitlines�split�stripr   �	partition�add)�text�g�no�raw�line�name�_�rests   &       ڞ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/parser.py�parser      s�   � � 	��A��T�_�_�.�a�8����y�y��a� ��#�)�)�+�����d�?��R�%�%����s�+�����z�z�|���s�d�{��R�%�%�	���d�J�J�L�!� 9� �H�    N)�build.errorsr   �build.graphr   r   � r   r   �<module>r      s   �� #� �r   `,
      },
      {
        path: "build/__pycache__/planner.cpython-314.pyc",
        content: `+
    �%	k�  �                   �*   � ^ RI Ht ^ RIHt R tR tR# )�    )�affected)�build_orderc                �l   � \\        W4      p\\        W4      pV Uu. uF  qUV9   g   K  VNK  	  up# u upi )z+Targets to rebuild, in a valid build order.)r   r   )�graph�roots�changed�order�dirty�ts   &&&   ڟ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/planner.py�planr      s4   � ���%�E��U�$�E��+�u�!�U�
�A�A�u�+�+��+s   �1�1c                 �p   � \\        WV4      pV'       g   R # RP                  R \\        V4       4       4      # )znothing to do�
c              3   �J   "  � T F  w  rR V^,           V3,          x � K  	  R# 5i)z%d. build %sN� )�.0�ir   s   &  r   �	<genexpr>�explain.<locals>.<genexpr>   s$   � � �N�=M�T�Q�^�q�1�u�a�j�0�0�=M�s   �!#)r   �join�	enumerate)r   r   r   �stepss   &&& r   �explainr      s.   � ���w�'�E����9�9�N�Y�u�=M�N�N�N�    N)�build.incrementalr   �
build.topor   r   r   r   r   r   �<module>r      s   �� &� "�,�Or   `,
      },
      {
        path: "build/__pycache__/topo.cpython-314.pyc",
        content: `+
    �%	k�  �                   �   � ^ RI Ht RR ltR# )�    )�UnknownTargetErrorNc                ��   a aaa� Vf   \\        S P                  4       4      M
\\        V4      p. o\\        4       oVV VV3R loV F-  pS P	                  V4      '       g   \\        V4      hS! V4       K/  	  S# )z�Return the targets reachable from \`roots\` so that every target comes
after all of its dependencies. Dependencies are visited in sorted order
so the result is deterministic. Raises CycleError on a dependency loop.c                 �   <� V S9   d   R # SP                  V 4       \\        SP                  V 4      4       F  pS! V4       K  	  SP                  V 4       R # �N)�add�sorted�deps�append)�t�d�done�graph�order�visits   & ����ڜ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/topo.pyr   �build_order.<locals>.visit   sA   �� ���9���������
�
�1��&�A��!�H� '����Q��    )r   �targets�list�set�hasr   )r   �roots�rr   r   r   s   f& @@@r   �build_orderr      sg   �� � (-�}�F�5�=�=�?�#�$�u�+�E��E��5�D�� � ���y�y��|�|�$�Q�'�'��a�� � �Lr   r   )�build.errorsr   r   � r   r   �<module>r      s   �� +�r   `,
      },
      {
        path: "build/__pycache__/waves.cpython-314.pyc",
        content: `+
    �%	kg  �                   �   � ^ RI Ht RR ltR# )�    )�build_orderNc                ��  a	� \\        W4      p/ o	V F=  pV P                  V4      pV'       g   ^ M^\\        V	3R lV 4       4      ,           S	V&   K?  	  S	'       g   . # \\        \\        S	P	                  4       4      ^,           4       Uu. uF  p. NK  	  ppS	P                  4        F  w  r7Wg,          P                  V4       K  	  V Uu. uF  p\\        V4      NK  	  up# u upi u upi )z�Group targets into waves that can be built in parallel.

Wave 0 = targets with no deps; a target goes in wave 1 + (highest wave
among its deps). Each wave is sorted by name.
c              3   �6   <"  � T F  pSV,          x � K  	  R # 5i�N� )�.0�d�levels   & �ڝ/private/tmp/claude-501/-Users-sachink-Documents-Dummy-codeComp-code-comprehension/e34c23c7-6b24-4aca-a2eb-f61333b97542/scratchpad/f3/p14/repo/build/waves.py�	<genexpr>�waves.<locals>.<genexpr>   s   �� � �+A�b��E�!�H�H�b�s   �)r   �deps�max�range�values�items�append�sorted)
�graph�roots�order�t�ds�_�out�lv�wr
   s
   &&       @r   �wavesr      s�   �� � ��%�E��E����Z�Z��]���1�A��+A�b�+A�(A�$A��a�� � ��	��S�����0�1�4�5�
6�5�!�2�5�C�
6�����������q�� �"�#�s�!�F�1�I�s�#�#�� 7�� $s   �C�C$r   )�
build.topor   r   r   �    r   �<module>r!      s   �� "�$r    `,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "predict",
        title: "What does CI print?",
        prompt: `Predict the output of \`main.py\` (it reads \`BUILD.txt\`). Dependencies are visited in **sorted** order.`,
        entry: "main.py",
        answer: `crypto models auth api icons components ui app
0 ['crypto', 'icons', 'models']
1 ['auth', 'components']
2 ['api', 'ui']
3 ['app']
['crypto', 'auth']`,
        options: [
          `crypto models auth api icons components ui app
0 ['crypto', 'icons', 'models']
1 ['auth', 'components']
2 ['api', 'ui']
3 ['app']
['crypto', 'auth']`,
          `crypto models auth api icons components ui app
0 ['crypto', 'icons', 'models']
1 ['auth', 'components']
2 ['api', 'ui']
3 ['app']
['crypto', 'auth', 'api', 'app']`,
          `models crypto auth api icons components ui app
0 ['crypto', 'icons', 'models']
1 ['auth', 'components']
2 ['api', 'ui']
3 ['app']
['crypto', 'auth']`,
          `crypto models auth api icons components ui app
0 ['crypto', 'icons', 'models']
1 ['api', 'auth', 'components']
2 ['ui']
3 ['app']
['crypto', 'auth']`,
        ],
        hints: [
          `Post-order DFS from \`app\`: a target is appended only after all its deps. \`api\` comes before \`ui\`, and inside \`api\`, \`auth\` before \`models\`.`,
          "`api` depends on `auth` (wave 1), so `api` is in wave 2.",
          "Look at `affected`: how far up the graph does it walk from `crypto`?",
        ],
        explanation: `**Order:** DFS from \`app\` visits \`api\` → \`auth\` → \`crypto\` (emit), \`models\` (emit), emit \`auth\`. \`models\` is already done, so emit \`api\`. Then \`ui\` → \`components\` → \`icons\` (emit), emit \`components\`, emit \`ui\`, emit \`app\`.

**Waves:** wave = 1 + max(wave of deps). \`api\` depends on \`auth\` (wave 1), so it sits in wave 2 next to \`ui\`.

**Plan:** this is BUILD-219 reproduced. \`affected\` adds only the **direct** dependents of \`crypto\`, which is \`auth\`. \`api\` and \`app\` also contain crypto code but are never rebuilt.`,
        timeLimitSec: 420,
        focusFile: "main.py",
      },
      {
        id: "s2",
        kind: "predict",
        title: "Reproduce BUILD-212",
        prompt: `Now predict the output of \`cycle_demo.py\`, which has a two-target cycle. \`build_order(g)\` with no roots visits **all** targets in sorted order.`,
        entry: "cycle_demo.py",
        answer: `order: ['lib', 'core']
waves failed: KeyError 'core'`,
        options: [
          `order: ['lib', 'core']
waves failed: KeyError 'core'`,
          `order: ['core', 'lib']
waves failed: KeyError 'lib'`,
          "waves failed: RecursionError maximum recursion depth exceeded",
          `order: ['lib', 'core']
waves: [['core'], ['lib']]`,
        ],
        hints: [
          `\`visit\` adds a target to \`done\` **before** visiting its deps. What happens when the DFS comes back around to \`core\`?`,
          "Then `waves` walks the order and needs `level[d]` for every dep `d` of the current target.",
        ],
        explanation: `Roots are sorted: \`core\` first. \`visit(core)\` marks it done and visits \`lib\`. \`lib\` depends on \`core\`, which is already in \`done\`, so the visit returns early. \`lib\` is emitted, then \`core\`. The cycle is **silently accepted**, and \`lib\` is scheduled before something it depends on.

\`waves\` then processes \`lib\` first and asks for \`level['core']\`, which does not exist yet, so it raises \`KeyError: 'core'\`. That is the error CI showed.

The root cause: a single \`done\` set cannot tell **"finished"** apart from **"in progress on the current path"**. Cycle detection needs that third state (the white/grey/black colouring of DFS).`,
        timeLimitSec: 360,
        focusFile: "build/topo.py",
      },
      {
        id: "s3",
        kind: "find-bug",
        title: "Why did app ship stale crypto?",
        prompt: "Click the line in `build/incremental.py` responsible for BUILD-219 and pick the root cause.",
        file: "build/incremental.py",
        lines: [19, 20],
        options: [
          `Only direct dependents of each changed target are marked dirty; their own dependents (transitive) are never visited`,
          "`graph.dependents` returns dependencies instead of dependents",
          "`dirty = set(changed)` aliases the caller's set and mutates it",
          "`changed_targets` ignores targets that were deleted",
        ],
        correct: 0,
        hints: [
          "`crypto` → `auth` → `api` → `app`. How many hops does the loop go?",
        ],
        explanation: `The loop walks one level of reverse edges. Rebuilds have to propagate along the whole reverse graph: everything that can reach a changed target is affected. The fix is a BFS/DFS over \`dependents\` with a worklist, which also handles diamonds without visiting a node twice.

(\`set(changed)\` makes a copy, so the caller's set is safe. \`changed_targets\` ignoring deletions is a fair point, but it is not what caused this ticket.)`,
        timeLimitSec: 240,
        focusFile: "build/incremental.py",
      },
      {
        id: "s4",
        kind: "review-ai",
        title: "Review the cycle-detection patch",
        prompt: "The assistant proposes this `visit` for `build_order`. Decide whether it is correct.",
        persona: "helpful-senior",
        request: `Make build_order raise CycleError(cycle) when there is a dependency loop. cycle should start and end with the re-entered target.`,
        aiReply: `Track the current DFS path explicitly and only mark a node done once all of its deps are finished:

\`\`\`python
def build_order(graph, roots=None):
    roots = sorted(graph.targets()) if roots is None else list(roots)
    order = []
    done = set()

    def visit(t, path=()):
        if t in path:
            raise CycleError(list(path[path.index(t):]) + [t])
        if t in done:
            return
        for d in sorted(graph.deps(t)):
            visit(d, path + (t,))
        done.add(t)
        order.append(t)

    for r in roots:
        if not graph.has(r):
            raise UnknownTargetError(r)
        visit(r)
    return order
\`\`\`

\`path\` holds the ancestors of \`t\` in this DFS branch, so seeing \`t\` in it means we followed edges back to ourselves. Shared deps (diamonds) are in \`done\` but not in \`path\`, so they are not reported as cycles.`,
        options: [
          `Accept: it distinguishes "on the current path" from "finished", reports the loop slice correctly, and keeps the original order for acyclic graphs`,
          "Reject: a diamond (`top → left → base`, `top → right → base`) is reported as a cycle",
          "Reject: `done.add(t)` after the loop means a target can be appended to `order` twice",
          "Reject: building `path + (t,)` on every call makes it exponential on large graphs",
        ],
        correct: 0,
        hints: [
          "Walk the diamond by hand: when `right` visits `base`, is `base` in `path` or in `done`?",
          "Can `visit(t)` reach `order.append(t)` twice? The second call returns early at the `done` check.",
        ],
        explanation: `This one is correct. The immutable \`path\` tuple is the "grey" set: only the ancestors on the current branch. \`done\` is the "black" set, filled after the children finish. A diamond's shared node is black when it is reached again, so it is not reported. A real back-edge hits a grey node, and \`path[path.index(t):] + [t]\` is the loop, for example \`['lib', 'core', 'lib']\`.

On cost: each target is expanded once (guarded by \`done\`). Copying the tuple costs O(depth) per edge, so the total is O(E·depth), which is polynomial and tiny for real build graphs. A mutable list with push/pop would get it to O(V+E), and that is what the reference solution does. Either way, you should be able to tell a correct suggestion apart from a perfect one.`,
        timeLimitSec: 360,
        focusFile: "build/topo.py",
      },
      {
        id: "s5",
        kind: "code",
        task: "fix",
        title: "Fix both tickets",
        prompt: `There are **two bugs**. Fix them both.

1. \`build_order\` must raise \`CycleError\` for any dependency loop. \`e.cycle\` must start and end with the target that was re-entered, following the DFS path, e.g. \`lib: core\`, \`core: lib\` gives \`["core", "lib", "core"]\` (roots in sorted order). Diamonds are **not** cycles, and the order for acyclic graphs must not change.
2. \`affected\` must return the changed targets plus **all transitive** dependents.

CI currently shows:
\`\`\`
tests/test_build.py::test_transitive_rebuild
    assert plan(g, ["app"], {"crypto"}) == ["crypto", "auth", "api", "app"]
AssertionError: ['crypto', 'auth'] != ['crypto', 'auth', 'api', 'app']
\`\`\``,
        editable: ["build/topo.py", "build/incremental.py"],
        tests: [
          {
            path: "tests/test_build.py",
            content: `from build.errors import CycleError, UnknownTargetError
from build.incremental import affected, changed_targets, fingerprint
from build.parser import parse
from build.planner import plan
from build.topo import build_order
from build.waves import waves

MANIFEST = """
app: api ui
api: models auth
ui: components models
auth: models crypto
components: icons
models:
crypto:
icons:
"""


def _raises_cycle(fn):
    try:
        fn()
    except CycleError as e:
        return e
    raise AssertionError("expected CycleError")


def test_order_unchanged_for_acyclic_graph():
    g = parse(MANIFEST)
    assert build_order(g, ["app"]) == ["crypto", "models", "auth", "api", "icons", "components", "ui", "app"]


def test_diamond_is_not_a_cycle():
    g = parse("top: left right\\nleft: base\\nright: base\\nbase:\\n")
    assert build_order(g) == ["base", "left", "right", "top"]
    assert waves(g) == [["base"], ["left", "right"], ["top"]]


def test_two_node_cycle_detected():
    g = parse("lib: core\\ncore: lib\\n")
    e = _raises_cycle(lambda: build_order(g))
    assert e.cycle == ["core", "lib", "core"]
    assert str(e) == "dependency cycle: core -> lib -> core"


def test_cycle_below_root_reports_only_the_loop():
    g = parse("app: lib\\nlib: core\\ncore: util lib\\nutil:\\n")
    e = _raises_cycle(lambda: build_order(g, ["app"]))
    assert e.cycle == ["lib", "core", "lib"]


def test_self_loop():
    g = parse("x: x\\n")
    e = _raises_cycle(lambda: build_order(g))
    assert e.cycle == ["x", "x"]


def test_waves_report_cycle_not_keyerror():
    g = parse("a: b\\nb: c\\nc: a\\n")
    e = _raises_cycle(lambda: waves(g))
    assert e.cycle == ["a", "b", "c", "a"]


def test_failed_visit_does_not_poison_later_calls():
    g = parse("a: b\\nb: a\\nz:\\n")
    _raises_cycle(lambda: build_order(g))
    assert build_order(g, ["z"]) == ["z"]


def test_unknown_root():
    g = parse(MANIFEST)
    try:
        build_order(g, ["nope"])
        assert False
    except UnknownTargetError:
        pass


def test_transitive_rebuild():
    g = parse(MANIFEST)
    assert affected(g, {"crypto"}) == {"crypto", "auth", "api", "app"}
    assert plan(g, ["app"], {"crypto"}) == ["crypto", "auth", "api", "app"]
    assert plan(g, ["app"], {"icons"}) == ["icons", "components", "ui", "app"]
    assert plan(g, ["app"], {"models"}) == ["models", "auth", "api", "ui", "app"]


def test_rebuild_from_fingerprints():
    g = parse(MANIFEST)
    old = fingerprint({"crypto": "v1", "icons": "v1", "models": "v1"})
    new = fingerprint({"crypto": "v1", "icons": "v2", "models": "v1"})
    assert changed_targets(old, new) == {"icons"}
    assert plan(g, ["app"], changed_targets(old, new)) == ["icons", "components", "ui", "app"]


def test_long_chain_is_fully_dirty():
    names = ["t%d" % i for i in range(30)]
    text = "\\n".join("%s: %s" % (names[i], names[i - 1]) if i else names[0] + ":" for i in range(30))
    g = parse(text)
    assert affected(g, {"t0"}) == set(names)
`,
          },
        ],
        solution: {
          "build/incremental.py": `import hashlib
from collections import deque


def fingerprint(sources):
    """Map target -> short content hash of its source text."""
    return {t: hashlib.sha256(src.encode("utf-8")).hexdigest()[:12] for t, src in sources.items()}


def changed_targets(old_prints, new_prints):
    """Targets whose own sources changed (or are new)."""
    return {t for t, h in new_prints.items() if old_prints.get(t) != h}


def affected(graph, changed):
    """Targets that must be rebuilt: the changed ones plus every target that
    depends on them, directly or transitively."""
    dirty = set(changed)
    queue = deque(changed)
    while queue:
        t = queue.popleft()
        for parent in graph.dependents(t):
            if parent not in dirty:
                dirty.add(parent)
                queue.append(parent)
    return dirty
`,
          "build/topo.py": `from build.errors import CycleError, UnknownTargetError


def build_order(graph, roots=None):
    """Return the targets reachable from \`roots\` so that every target comes
    after all of its dependencies. Dependencies are visited in sorted order
    so the result is deterministic. Raises CycleError on a dependency loop."""
    roots = sorted(graph.targets()) if roots is None else list(roots)
    order = []
    done = set()      # fully built: all deps placed before it
    path = []         # targets currently being visited (grey), in DFS order
    on_path = set()

    def visit(t):
        if t in done:
            return
        if t in on_path:
            start = path.index(t)
            raise CycleError(path[start:] + [t])
        path.append(t)
        on_path.add(t)
        for d in sorted(graph.deps(t)):
            visit(d)
        path.pop()
        on_path.discard(t)
        done.add(t)
        order.append(t)

    for r in roots:
        if not graph.has(r):
            raise UnknownTargetError(r)
        visit(r)
    return order
`,
        },
        hints: [
          `Use three states: unvisited, on the current path (grey), done (black). Add to \`done\` only after the deps have been visited.`,
          `Keep the current path as a list with push/pop so you can slice out the loop: \`path[path.index(t):] + [t]\`.`,
          `For \`affected\`, use a worklist (deque) over \`graph.dependents\`, adding each node to \`dirty\` the first time you see it.`,
        ],
        explanation: `**Topological sort with cycle detection** needs three colours. The original code marked a node done *on entry*. A back-edge to an ancestor then looked the same as reaching a finished node, so cycles slipped through and produced an invalid order, which made \`waves\` crash far away from the cause.

**Incremental rebuild** has to find everything reachable over *reverse* edges from the changed set, which is a plain BFS. The \`if parent not in dirty\` guard keeps it linear and stops it from looping.

Lesson: if an invariant ("deps before dependents") is not enforced where the data is produced, it fails later with a confusing error (\`KeyError\`) in a different module.`,
        timeLimitSec: 900,
        focusFile: "build/topo.py",
      },
    ],
  },
  {
    id: "l4-a-search-unicode-tokenizer",
    title: "Café Not Found",
    level: 4,
    rating: 2300,
    lang: "typescript",
    domain: "search",
    companies: ["canva", "google", "atlassian", "apple"],
    tags: ["unicode", "normalization", "regex", "tokenizer", "bm25", "i18n"],
    summary: `Search works in English and misses half the catalog everywhere else. Two small Unicode bugs, one large blast radius.`,
    context: `You've joined the team that owns catalog search. After the EU launch, tickets started coming in:

- "Searching **cafe** doesn't show *Café Müller*, but **café** does"
- "Nothing in Russian is searchable"
- "*résumé* only matches if I type **sum**"

Indexing and query parsing both go through \`tokenize\` → \`fold\`. The ranker (BM25) has been stable for a year and is not the suspect.`,
    persona: "tunnel-vision",
    files: [
      {
        path: "src/text/normalize.ts",
        content: `/**
 * Folding applied to BOTH documents and queries, so they meet in the same form.
 *
 * Product spec (SEARCH-1):
 *   - case-insensitive            "CAFÉ"  == "café"
 *   - accent-insensitive          "cafe"  == "café", "muller" == "Müller"
 *   - representation-insensitive  "é" (e + combining acute) == "é" (U+00E9)
 */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function fold(s: string): string {
  return s.toLowerCase().normalize('NFC').replace(COMBINING_MARKS, '');
}
`,
      },
      {
        path: "src/text/tokenizer.ts",
        content: `import { fold } from './normalize';
import { STOPWORDS } from './stopwords';

export const MIN_TOKEN_LENGTH = 2;

/**
 * Split text into searchable terms.
 * Words are maximal runs of letters or digits, in ANY script.
 * Tokens shorter than MIN_TOKEN_LENGTH and stop words are dropped.
 */
export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}
`,
      },
      {
        path: "src/text/stopwords.ts",
        content: `/** Very small English stop list. Tokens are compared AFTER folding. */
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'to', 'with', 'und',
]);
`,
      },
      {
        path: "src/index/invertedIndex.ts",
        content: `import { tokenize } from '../text/tokenizer';

export interface Doc {
  id: number;
  title: string;
  body: string;
}

/** term -> (docId -> term frequency) */
export type Postings = Map<string, Map<number, number>>;

export class InvertedIndex {
  readonly postings: Postings = new Map();
  readonly docLength = new Map<number, number>();
  readonly docs = new Map<number, Doc>();
  private totalLength = 0;

  add(doc: Doc): void {
    if (this.docs.has(doc.id)) throw new Error('duplicate doc ' + doc.id);
    // Title terms count twice: a match in the title is a stronger signal.
    const terms = [...tokenize(doc.title), ...tokenize(doc.title), ...tokenize(doc.body)];
    this.docs.set(doc.id, doc);
    this.docLength.set(doc.id, terms.length);
    this.totalLength += terms.length;
    for (const t of terms) {
      let p = this.postings.get(t);
      if (!p) this.postings.set(t, (p = new Map()));
      p.set(doc.id, (p.get(doc.id) ?? 0) + 1);
    }
  }

  get size(): number {
    return this.docs.size;
  }

  get avgDocLength(): number {
    return this.docs.size ? this.totalLength / this.docs.size : 0;
  }

  /** All indexed terms starting with \`prefix\` (already folded), sorted. */
  termsWithPrefix(prefix: string): string[] {
    const out: string[] = [];
    for (const t of this.postings.keys()) if (t.startsWith(prefix)) out.push(t);
    return out.sort();
  }
}
`,
      },
      {
        path: "src/index/ranker.ts",
        content: `import { InvertedIndex } from './invertedIndex';

export interface Hit {
  id: number;
  score: number;
}

const K1 = 1.2;
const B = 0.75;

/** BM25 idf, floored at 0 so very common terms never subtract score. */
export function idf(index: InvertedIndex, term: string): number {
  const n = index.postings.get(term)?.size ?? 0;
  const N = index.size;
  return Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
}

/**
 * Score every doc containing at least one of \`terms\`.
 * Ties are broken by ascending doc id so results are stable.
 */
export function rank(index: InvertedIndex, terms: string[]): Hit[] {
  const scores = new Map<number, number>();
  const avg = index.avgDocLength || 1;
  for (const term of new Set(terms)) {
    const postings = index.postings.get(term);
    if (!postings) continue;
    const w = idf(index, term);
    for (const [id, tf] of postings) {
      const len = index.docLength.get(id)!;
      const s = (w * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg));
      scores.set(id, (scores.get(id) ?? 0) + s);
    }
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id - b.id);
}
`,
      },
      {
        path: "src/query/parseQuery.ts",
        content: `import { fold } from '../text/normalize';
import { tokenize } from '../text/tokenizer';

export interface ParsedQuery {
  /** Exact terms (already tokenized/folded). */
  terms: string[];
  /** Prefix terms from \`word*\` syntax (folded, no star). */
  prefixes: string[];
}

/**
 * "cafe* paris"  -> { terms: ['paris'], prefixes: ['cafe'] }
 * Prefixes go through the same tokenizer as everything else so that
 * "Caf*" and "caf*" behave the same.
 */
export function parseQuery(q: string): ParsedQuery {
  const terms: string[] = [];
  const prefixes: string[] = [];
  for (const raw of q.trim().split(/\\s+/)) {
    if (!raw) continue;
    if (raw.endsWith('*')) {
      const stem = tokenize(raw.slice(0, -1));
      if (stem.length) prefixes.push(stem[stem.length - 1]);
      else if (fold(raw.slice(0, -1)).length) prefixes.push(fold(raw.slice(0, -1)));
    } else {
      terms.push(...tokenize(raw));
    }
  }
  return { terms, prefixes };
}
`,
      },
      {
        path: "src/search/engine.ts",
        content: `import { Doc, InvertedIndex } from '../index/invertedIndex';
import { Hit, rank } from '../index/ranker';
import { parseQuery } from '../query/parseQuery';

export const MAX_PREFIX_EXPANSIONS = 20;

export class SearchEngine {
  private index = new InvertedIndex();

  addAll(docs: Doc[]): this {
    for (const d of docs) this.index.add(d);
    return this;
  }

  search(q: string, limit = 10): Hit[] {
    const { terms, prefixes } = parseQuery(q);
    const expanded = [...terms];
    for (const p of prefixes) expanded.push(...this.index.termsWithPrefix(p).slice(0, MAX_PREFIX_EXPANSIONS));
    return rank(this.index, expanded).slice(0, limit);
  }

  /** Convenience for UIs and tests: just the ids, best first. */
  ids(q: string, limit = 10): number[] {
    return this.search(q, limit).map((h) => h.id);
  }

  title(id: number): string {
    return this.index.docs.get(id)?.title ?? '?';
  }
}
`,
      },
      {
        path: "src/ui/snippet.ts",
        content: `/** Shorten a title for the result card. Adds an ellipsis when truncated. */
export function snippet(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
`,
      },
      {
        path: "src/data/catalog.ts",
        content: `import { Doc } from '../index/invertedIndex';

/**
 * A slice of the real catalog. Titles arrive from many upstream systems:
 * some send precomposed characters (NFC), the macOS uploader sends
 * decomposed ones (NFD), e.g. 'Café' below.
 */
export const CATALOG: Doc[] = [
  { id: 1, title: 'Café Müller', body: 'Pina Bausch dance piece set in a café' },
  { id: 2, title: 'Café Society', body: 'A film about Hollywood in the 1930s' },
  { id: 3, title: 'Москва travel guide', body: 'Museums, metro and food in Moscow' },
  { id: 4, title: 'Naïve Bayes for résumé screening', body: 'A practical introduction' },
  { id: 5, title: 'Straße und Verkehr', body: 'German road traffic rules' },
  { id: 6, title: 'Cafe racer motorcycles', body: 'Building a cafe racer from a 1970s bike' },
  { id: 7, title: 'Emoji 👍 style guide', body: 'When to use emoji in product copy' },
];
`,
      },
      {
        path: "src/demo.ts",
        content: `import { SearchEngine } from './search/engine';
import { CATALOG } from './data/catalog';
import { tokenize } from './text/tokenizer';

const engine = new SearchEngine().addAll(CATALOG);

console.log(JSON.stringify(tokenize('Café Müller — Straße')));
for (const q of ['cafe', 'café', 'москва', 'resume']) {
  console.log(q + ' -> ' + JSON.stringify(engine.ids(q)));
}
`,
      },
      {
        path: "src/unicodeFacts.ts",
        content: `import { snippet } from './ui/snippet';

const composed = 'café';
const decomposed = 'café';
console.log(composed.length, decomposed.length, composed === decomposed);
console.log(composed.normalize('NFD') === decomposed, decomposed.normalize('NFC') === composed);

const title = '👍👍👍 launch';
console.log(title.length, [...title].length);

const s = snippet(title, 4);
console.log(s.length, /[\\uD800-\\uDBFF]$/.test(s.slice(0, -1)));
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "predict",
        title: "Reproduce the tickets",
        prompt: `Predict the output of \`src/demo.ts\`. Doc 1 is \`Café Müller\` (precomposed é), doc 2 is \`Cafe\\u0301 Society\` (decomposed), doc 6 is \`Cafe racer motorcycles\`.`,
        entry: "src/demo.ts",
        answer: `["caf","ller","stra"]
cafe -> [6]
café -> [1,2]
москва -> []
resume -> []`,
        options: [
          `["caf","ller","stra"]
cafe -> [6]
café -> [1,2]
москва -> []
resume -> []`,
          `["cafe","muller","straße"]
cafe -> [1,6,2]
café -> [1,6,2]
москва -> [3]
resume -> [4]`,
          `["caf","ller","stra"]
cafe -> [6]
café -> [1]
москва -> []
resume -> []`,
          `["café","müller","straße"]
cafe -> [6]
café -> [1,2]
москва -> [3]
resume -> []`,
        ],
        hints: [
          `\`fold\` runs first. Does \`.normalize('NFC')\` leave any characters in U+0300..U+036F for the replace to strip?`,
          "Then the split class is `[^a-z0-9]`. Is `é` in `a-z`? Is `ü`? Is `ß`?",
          "Doc 2 is stored decomposed, but NFC composes it into the same `é` as doc 1.",
        ],
        explanation: `**fold:** NFC *composes* \`e + U+0301\` into the single code point \`é\` (U+00E9). After that there are no combining marks left, so the "strip accents" replace does nothing. Accents survive, and both café spellings become the same precomposed \`café\`.

**tokenize:** \`/[^a-z0-9]+/\` treats every non-ASCII letter as a separator. \`café\` → \`caf\`, \`müller\` → \`m\` + \`ller\`, \`straße\` → \`stra\` + \`e\`. Tokens shorter than 2 are dropped, which leaves \`["caf","ller","stra"]\`.

So \`cafe\` matches only the ASCII "Cafe racer" (6), \`café\` folds to \`caf\` and matches 1 and 2, Cyrillic disappears completely, and \`résumé\` is indexed as \`sum\`. Every ticket is reproduced.`,
        timeLimitSec: 480,
        focusFile: "src/demo.ts",
      },
      {
        id: "s2",
        kind: "find-bug",
        title: "Why don't accents fold?",
        prompt: `Even with a perfect tokenizer, \`cafe\` would still not match \`café\`. Click the line responsible and choose the root cause.`,
        file: "src/text/normalize.ts",
        lines: [12],
        options: [
          `NFC composes base + mark into one code point, so there are no separate combining marks left for the regex to remove. It must decompose (NFD) first`,
          "The regex is missing the `u` flag, so it matches UTF-16 code units instead of code points",
          "`toLowerCase()` must run after `normalize`, because lower-casing changes the normal form",
          "The combining-mark range should be U+0300..U+03FF",
        ],
        correct: 0,
        hints: [
          "Compare `'\\u00e9'.normalize('NFC')` and `'\\u00e9'.normalize('NFD')`. Which one contains U+0301?",
        ],
        explanation: `To strip accents you **decompose** (NFD/NFKD), remove the marks (\`\\p{M}\` or U+0300..U+036F), and optionally re-compose. NFC goes the other way, so the replace matches nothing for precomposed input. It "works" only by accident on strings that are decomposed *and* have no precomposed form.

The \`u\` flag does not matter here: U+0300..U+036F are single BMP code units. The order of \`toLowerCase\` and NFD makes no difference for these characters.`,
        timeLimitSec: 300,
        focusFile: "src/text/normalize.ts",
      },
      {
        id: "s3",
        kind: "review-ai",
        title: "The assistant fixes the tokenizer",
        prompt: "You ask the assistant (which only sees the open file) to fix the tokenizer. Review the suggestion.",
        persona: "tunnel-vision",
        request: "tokenize() drops non-English letters. Fix the split regex so words in any language survive.",
        aiReply: `The hand-rolled \`[a-z0-9]\` class is the problem. Use the built-in word class and turn on Unicode mode:

\`\`\`ts
export function tokenize(text: string): string[] {
  return fold(text)
    .split(/\\W+/u)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}
\`\`\`

With the \`u\` flag, \`\\W\` becomes Unicode-aware, so \`é\`, \`ß\` and Cyrillic letters are all word characters now.`,
        options: [
          "Accept: `\\W` with the `u` flag matches any non-letter in any script",
          `Reject: in JavaScript \`\\w\`/\`\\W\` stay ASCII-only (\`[A-Za-z0-9_]\`) even with \`u\`; you need property escapes like \`/[^\\p{L}\\p{N}]+/u\``,
          "Reject: `split` cannot take a regex with the `u` flag",
          "Reject: it is correct but slower; keep the explicit class and add the Latin-1 range `\\u00c0-\\u00ff`",
        ],
        correct: 1,
        hints: ["Try `/\\w/u.test('é')` in a console."],
        explanation: `This is a common false belief. In JS, the \`u\` flag changes how the pattern is parsed (code points, \`\\u{...}\`, stricter syntax), but \`\\w\` is still \`[A-Za-z0-9_]\`. (With \`u\` **and** \`i\` it gains two odd extras, ſ and K, and that is all.) Unicode word matching needs property escapes: \`\\p{L}\` (letters), \`\\p{N}\` (numbers), and often \`\\p{M}\` if you keep marks.

Adding Latin-1 would fix \`é\` and \`ß\` but not Cyrillic, Greek or CJK. The suggestion also leaves \`_\` as a word character, which changes behaviour for snake_case input.`,
        timeLimitSec: 300,
        focusFile: "src/text/tokenizer.ts",
      },
      {
        id: "s4",
        kind: "predict",
        title: "Strings are not characters",
        prompt: `While you are here, a designer reports a "�" on result cards with emoji. Predict the output of \`src/unicodeFacts.ts\`.`,
        entry: "src/unicodeFacts.ts",
        answer: `4 5 false
true true
13 10
4 true`,
        options: [
          `4 5 false
true true
13 10
4 true`,
          `4 4 true
true true
10 10
4 false`,
          `4 5 false
false true
13 10
5 false`,
          `4 5 false
true true
10 13
4 true`,
        ],
        hints: [
          `\`.length\` counts UTF-16 code units. A combining mark is its own code unit, and 👍 (U+1F44D) is a surrogate pair.`,
          "`[...str]` iterates by code point.",
          "`snippet` keeps `slice(0, 3)` = one full 👍 plus half of the next one.",
        ],
        explanation: `- \`café\` precomposed is 4 units and decomposed is 5. They are different strings, but equal after normalising to the same form, which is why the index has to normalise.
- \`👍👍👍 launch\` is 13 UTF-16 units but 10 code points.
- \`snippet\` cuts by code units, so \`slice(0, 3)\` ends on a lone high surrogate. That renders as "�" (and breaks \`encodeURIComponent\`). Cut with \`[...text].slice(...)\` (code points) or \`Intl.Segmenter\` (grapheme clusters, which also keeps 👍🏽 and family emoji whole).`,
        timeLimitSec: 360,
        focusFile: "src/unicodeFacts.ts",
      },
      {
        id: "s5",
        kind: "code",
        task: "fix",
        title: "Make search work for everyone",
        prompt: `There are **two bugs**, one in \`normalize.ts\` and one in \`tokenizer.ts\`. Fix both so that search matches SEARCH-1:

- case-, accent- and representation-insensitive (\`cafe\` = \`café\` = \`CAFÉ\` = \`cafe\\u0301\`)
- words in any script survive tokenisation (\`москва\`, \`東京\`, \`straße\`)
- existing ASCII behaviour (stop words, min length 2, digits, ranking order) must not change

A visible failing test:
\`\`\`
✗ accent-insensitive search finds every cafe, best first
  Expected: [ 6 ] to equal [ 1, 6, 2 ]
\`\`\``,
        editable: ["src/text/normalize.ts", "src/text/tokenizer.ts"],
        tests: [
          {
            path: "tests/search.test.ts",
            content: `import { SearchEngine } from '../src/search/engine';
import { CATALOG } from '../src/data/catalog';
import { tokenize } from '../src/text/tokenizer';
import { fold } from '../src/text/normalize';

const engine = () => new SearchEngine().addAll(CATALOG);

test('tokenizer keeps whole words in any Latin spelling', () => {
  expect(tokenize('Café Müller — Straße')).toEqual(['cafe', 'muller', 'straße']);
  expect(tokenize('Naïve résumé')).toEqual(['naive', 'resume']);
});

test('tokenizer keeps non-Latin scripts', () => {
  expect(tokenize('Москва travel')).toEqual(['москва', 'travel']);
  expect(tokenize('東京 guide')).toEqual(['東京', 'guide']);
  expect(tokenize('Ελλάδα')).toEqual(['ελλαδα']);
});

test('tokenizer behaviour that must not change', () => {
  expect(tokenize('The cat & a dog, iPhone 15!')).toEqual(['cat', 'dog', 'iphone', '15']);
  expect(tokenize("don't x y")).toEqual(['don']);
  expect(tokenize('')).toEqual([]);
});

test('fold is representation-insensitive and accent-insensitive', () => {
  expect(fold('cafe\\u0301')).toBe(fold('caf\\u00e9'));
  expect(fold('CAF\\u00c9')).toBe('cafe');
  expect(fold('Mu\\u0308ller')).toBe('muller');
});

test('accent-insensitive search finds every cafe, best first', () => {
  const e = engine();
  expect(e.ids('cafe')).toEqual([1, 6, 2]);
  expect(e.ids('café')).toEqual([1, 6, 2]);
  expect(e.ids('CAFÉ')).toEqual([1, 6, 2]);
  expect(e.ids('cafe\\u0301')).toEqual([1, 6, 2]);
});

test('prefix search folds too', () => {
  const e = engine();
  expect(e.ids('Caf*')).toEqual([1, 6, 2]);
  expect(e.ids('мос*')).toEqual([3]);
});

test('names, Cyrillic and German titles are findable', () => {
  const e = engine();
  expect(e.ids('müller')).toEqual([1]);
  expect(e.ids('muller')).toEqual([1]);
  expect(e.ids('МОСКВА')).toEqual([3]);
  expect(e.ids('resume')).toEqual([4]);
  expect(e.ids('naive')).toEqual([4]);
  expect(e.ids('straße')).toEqual([5]);
});

test('multi-term ranking is unchanged for ASCII queries', () => {
  const e = engine();
  expect(e.ids('cafe racer')).toEqual([6, 1, 2]);
  expect(e.ids('1930s')).toEqual([2]);
  expect(e.ids('emoji')).toEqual([7]);
  expect(e.ids('zzz')).toEqual([]);
});
`,
          },
        ],
        solution: {
          "src/text/normalize.ts": `/**
 * Folding applied to BOTH documents and queries, so they meet in the same form.
 *
 * Product spec (SEARCH-1):
 *   - case-insensitive            "CAFÉ"  == "café"
 *   - accent-insensitive          "cafe"  == "café", "muller" == "Müller"
 *   - representation-insensitive  "é" (e + combining acute) == "é" (U+00E9)
 */
const COMBINING_MARKS = /\\p{M}/gu;

export function fold(s: string): string {
  // NFD first: split "é" into "e" + U+0301 so the mark can be stripped.
  // (NFC does the opposite: it glues marks ON, leaving nothing to strip.)
  return s.normalize('NFD').toLowerCase().replace(COMBINING_MARKS, '').normalize('NFC');
}
`,
          "src/text/tokenizer.ts": `import { fold } from './normalize';
import { STOPWORDS } from './stopwords';

export const MIN_TOKEN_LENGTH = 2;

/**
 * Split text into searchable terms.
 * Words are maximal runs of letters or digits, in ANY script.
 * Tokens shorter than MIN_TOKEN_LENGTH and stop words are dropped.
 */
export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^\\p{L}\\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));
}
`,
        },
        hints: [
          "Decompose with `normalize('NFD')` before removing marks.",
          "Split on anything that is not a letter or number in any script: `/[^\\p{L}\\p{N}]+/u`.",
          `Greek \`ά\` and Cyrillic letters decompose too, so strip all marks (\`\\p{M}\`) and not only the Latin combining block.`,
        ],
        explanation: `\`\`\`ts
fold = s.normalize('NFD').toLowerCase().replace(/\\p{M}/gu, '').normalize('NFC');
tokenize = fold(text).split(/[^\\p{L}\\p{N}]+/u)...
\`\`\`

**Why both are needed:** fixing only the tokenizer leaves accents in place, so \`cafe\` still misses \`café\`. Fixing only \`fold\` turns \`müller\` into \`muller\`, but Cyrillic, CJK and \`ß\` are still cut apart.

**Why it lives in one place:** indexing and querying must use *exactly the same* pipeline, or the terms never meet. Here both paths call \`tokenize\`, so one fix covers both. When a search bug "only affects some users", check normalisation first.

Accent folding is a product decision. Some languages treat accented letters as different letters (Spanish \`año\` vs \`ano\`). Real engines make this a per-locale analyser setting.`,
        timeLimitSec: 900,
        focusFile: "src/text/normalize.ts",
      },
    ],
  },
];

export default problems;
