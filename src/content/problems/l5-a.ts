import type { Problem } from '../types';

/**
 * L5 Grandmaster set A (part 1): JavaScript / TypeScript.
 * Event loop, async generators, Proxy + super, completion records, money precision, sort semantics.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 1. Retrying fetch wrapper: microtask accounting + in-flight dedupe race
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-js-retry-microtasks',
    title: 'The Retry Wrapper That Never Retries',
    level: 5,
    rating: 2780,
    lang: 'javascript',
    domain: 'market-data',
    companies: ['jane-street', 'hrt', 'stripe', 'generic'],
    tags: ['event-loop', 'microtasks', 'async-await', 'thenable-adoption', 'race-condition', 'caching'],
    summary: 'Two retry helpers differ by one `await`. Count the microtask ticks, then fix an in-flight dedupe cache that races.',
    context:
      'The market-data client wraps every quote request in a retry helper. Somebody "simplified" one of the helpers by dropping an `await`, and on-call noticed that one venue never retries. A separate quote cache is also hammering the upstream with duplicate requests during reconnect storms.',
    persona: 'confident-intern',
    files: [
      {
        path: 'src/retry.js',
        content: `const out = [];
const backoff = () => new Promise((r) => setTimeout(r, 0));

async function attempt(name, n) {
  out.push(\`\${name}:try\${n}\`);
  if (n < 2) throw new Error(\`\${name}\${n}\`);
  return name;
}

async function withRetry(name) {
  for (let n = 1; ; n++) {
    try {
      return await attempt(name, n);
    } catch (e) {
      out.push(\`\${name}:caught \${e.message}\`);
      await backoff();
    } finally {
      out.push(\`\${name}:finally\${n}\`);
    }
  }
}

async function withRetryFast(name) {
  for (let n = 1; ; n++) {
    try {
      return attempt(name, n);
    } catch (e) {
      out.push(\`\${name}:caught \${e.message}\`);
    } finally {
      out.push(\`\${name}:finally\${n}\`);
    }
  }
}

withRetry('A').then((v) => out.push(\`A=\${v}\`));
withRetryFast('B').then(
  (v) => out.push(\`B=\${v}\`),
  (e) => out.push(\`B failed \${e.message}\`),
);
setTimeout(() => out.push('timer'), 0);
Promise.resolve()
  .then(() => out.push('t1'))
  .then(() => out.push('t2'))
  .then(() => out.push('t3'));
out.push('sync');
setTimeout(() => console.log(out.join('\\n')), 20);
`,
      },
      {
        path: 'src/quoteCache.js',
        content: `/**
 * QuoteCache: dedupes and caches upstream quote requests.
 *
 * Contract:
 *  - get(sym) returns a Promise of the quote.
 *  - Concurrent get(sym) calls while a fetch is in flight share ONE upstream fetch.
 *  - A successful quote is fresh for ttlMs, measured from when its fetch completed.
 *  - A failed fetch is never cached: every waiter of that fetch rejects, and the next get() refetches.
 *  - invalidate(sym) forgets the symbol immediately. A fetch that was in flight at the time
 *    must not later overwrite or evict whatever entry has replaced it.
 */
class QuoteCache {
  constructor(fetchQuote, { ttlMs = 1000, now = () => Date.now() } = {}) {
    this.fetchQuote = fetchQuote;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  async get(sym) {
    const e = this.entries.get(sym);
    if (e && this.now() - e.at < this.ttlMs) return e.value;
    const value = await this.fetchQuote(sym);
    this.entries.set(sym, { value, at: this.now() });
    return value;
  }

  invalidate(sym) {
    this.entries.delete(sym);
  }
}

module.exports = { QuoteCache };
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Count the ticks',
        prompt:
          'Run `src/retry.js` in Node. Which output is printed? Every line matters: work out exactly which microtask tick each line is pushed in.',
        entry: 'src/retry.js',
        answer:
          'A:try1\nB:try1\nB:finally1\nsync\nA:caught A1\nt1\nt2\nB failed B1\nt3\ntimer\nA:finally1\nA:try2\nA:finally2\nA=A',
        options: [
          'A:try1\nB:try1\nB:finally1\nsync\nA:caught A1\nt1\nt2\nB failed B1\nt3\ntimer\nA:finally1\nA:try2\nA:finally2\nA=A',
          'A:try1\nB:try1\nB:finally1\nsync\nA:caught A1\nt1\nB failed B1\nt2\nt3\ntimer\nA:finally1\nA:try2\nA:finally2\nA=A',
          'A:try1\nB:try1\nsync\nA:caught A1\nB:caught B1\nB:finally1\nt1\nB:try2\nB:finally2\nt2\nt3\ntimer\nA:finally1\nA:try2\nA:finally2\nA=A\nB=B',
          'A:try1\nB:try1\nB:finally1\nsync\nA:caught A1\nt1\nt2\nt3\nB failed B1\nA:finally1\ntimer\nA:try2\nA:finally2\nA=A',
        ],
        hints: [
          '`return attempt(name, n)` leaves the `try` block with a *return completion* whose value is a promise. Does the rejection ever happen inside the `try`?',
          'Resolving an async function\'s result promise with another promise is not 1 tick: NewPromiseResolveThenableJob runs first, and only then does it call `.then` on the inner promise.',
          'The backoff timer is registered during tick 1, *after* the `timer` callback was registered synchronously.',
        ],
        explanation: `**Synchronous phase.** \`withRetry('A')\` runs \`attempt\` synchronously up to its \`throw\`: it pushes \`A:try1\` and returns an already-rejected promise. \`await\` on a native promise (ES2019+) is a single \`PerformPromiseThen\`, so A's resumption is queued as *one* reaction job. \`withRetryFast('B')\` pushes \`B:try1\` and then executes \`return attempt(...)\`: the return completion leaves the \`try\` **immediately**, so the \`finally\` runs synchronously (\`B:finally1\`) and the \`catch\` can never see the rejection, which only exists as a rejected promise value. The async function then *resolves* its result promise with that promise, which enqueues a **NewPromiseResolveThenableJob**. The timer is registered, \`t1\` is queued, and \`sync\` is pushed.

Queue after sync: \`[A-resume, B-thenableJob, t1]\`.

- **Tick 1:** A resumes by throwing into the \`try\`, so \`A:caught A1\` runs and \`backoff()\` registers a *second* timer (after \`timer\`). B's thenable job calls \`inner.then(resolve, reject)\`. Because \`inner\` is already rejected, a reaction job is queued. \`t1\` runs and queues \`t2\`.
- **Tick 2:** B's reaction rejects B's outer promise, which queues the user's \`onRejected\`. \`t2\` runs and queues \`t3\`.
- **Tick 3:** \`B failed B1\`, then \`t3\`.

That is the "two extra ticks" of thenable adoption: resolving with a promise costs ResolveThenableJob + the inner reaction before the outer promise even settles.

**Macrotasks.** \`timer\` fires first (registered first). Then the backoff timer resolves, A resumes, leaves the \`catch\`, runs \`finally\` (\`A:finally1\`), loops, runs \`A:try2\`, awaits the fulfilled promise (1 tick), returns, so \`finally\` runs (\`A:finally2\`) and \`A=A\` follows.

Option 2 forgets the extra adoption tick, option 3 assumes \`return p\` inside \`try\` lets \`catch\` observe the rejection, and option 4 puts B too late and runs the backoff timer before \`timer\`.`,
        timeLimitSec: 720,
        focusFile: 'src/retry.js',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Why B never retries',
        prompt: 'Select **all** statements that are true about `withRetryFast` as written.',
        options: [
          '`return attempt(name, n)` completes the `try` block with a return completion holding a pending/rejected promise, so the rejection is never thrown inside the `try` and `catch` cannot run',
          'The `finally` block of iteration 1 executes before the promise returned by `withRetryFast` settles',
          'Resolving the async function\'s implicit promise with the promise from `attempt` costs extra microtask ticks (NewPromiseResolveThenableJob, then the inner `.then` reaction) before user `.then` handlers are queued',
          'Changing it to `return await attempt(name, n)` would make it behave exactly like the current code, because `return await` is redundant in async functions',
          '`await` on a native, already-settled promise always costs three microtask ticks in modern engines',
        ],
        correct: [0, 1, 2],
        hints: ['Inside a `try`, `return await p` and `return p` differ: one rethrows at the `await` site, the other does not.'],
        explanation:
          '`return p` inside `try`/`catch` is the classic case where `return await` is **not** redundant. With `await`, a rejection resumes the function by throwing at the `await` expression, which is still inside the `try`, so `catch` runs and the loop retries. Without it, the `try` completes normally (return completion), `finally` runs right away, and the async function adopts `p` via ResolvePromise → NewPromiseResolveThenableJob (one tick) → `p.then` reaction (second tick). Only then are the caller\'s handlers queued. Since ES2019 (the "await optimisation"), `await` on a native promise costs exactly one tick, not three.',
        timeLimitSec: 360,
        focusFile: 'src/retry.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the quote cache race',
        prompt: `\`QuoteCache.get\` caches only *after* the \`await\`, so a reconnect storm of 50 concurrent \`get('AAPL')\` calls makes 50 upstream requests. Fix \`src/quoteCache.js\` so it meets **every** line of the contract in its doc comment:

- concurrent \`get\`s for the same symbol share one in-flight fetch;
- failures are not cached (all waiters reject, the next \`get\` refetches);
- TTL is measured from when the fetch **completed**;
- after \`invalidate\`, a stale in-flight fetch that settles later (success **or** failure) must not overwrite or evict the newer entry.`,
        editable: ['src/quoteCache.js'],
        tests: [
          {
            path: 'tests/quoteCache.test.js',
            content: `const { QuoteCache } = require('../src/quoteCache');

function harness() {
  const pending = [];
  let calls = 0;
  let t = 0;
  const fetchQuote = (sym) => {
    calls++;
    return new Promise((resolve, reject) => pending.push({ sym, resolve, reject }));
  };
  const cache = new QuoteCache(fetchQuote, { ttlMs: 1000, now: () => t });
  return {
    cache,
    pending,
    calls: () => calls,
    setTime: (x) => { t = x; },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('concurrent gets share one upstream fetch', async () => {
  const h = harness();
  const ps = [h.cache.get('AAPL'), h.cache.get('AAPL'), h.cache.get('AAPL')];
  await flush();
  expect(h.calls()).toBe(1);
  h.pending[0].resolve(101);
  const vals = await Promise.all(ps);
  expect(vals).toEqual([101, 101, 101]);
});

test('different symbols fetch independently', async () => {
  const h = harness();
  const a = h.cache.get('AAPL');
  const m = h.cache.get('MSFT');
  await flush();
  expect(h.calls()).toBe(2);
  h.pending[0].resolve(1);
  h.pending[1].resolve(2);
  expect(await a).toBe(1);
  expect(await m).toBe(2);
});

test('failures reject every waiter and are not cached', async () => {
  const h = harness();
  const p1 = h.cache.get('AAPL');
  const p2 = h.cache.get('AAPL');
  await flush();
  h.pending[0].reject(new Error('upstream 503'));
  await expect(p1).rejects.toThrow('503');
  await expect(p2).rejects.toThrow('503');
  const p3 = h.cache.get('AAPL');
  await flush();
  expect(h.calls()).toBe(2);
  h.pending[1].resolve(7);
  expect(await p3).toBe(7);
});

test('ttl is measured from completion, and cached values do not refetch', async () => {
  const h = harness();
  h.setTime(0);
  const p = h.cache.get('AAPL');
  await flush();
  h.setTime(500);
  h.pending[0].resolve(42);
  expect(await p).toBe(42);
  h.setTime(1400);
  expect(await h.cache.get('AAPL')).toBe(42);
  expect(h.calls()).toBe(1);
  h.setTime(1500);
  const p2 = h.cache.get('AAPL');
  await flush();
  expect(h.calls()).toBe(2);
  h.pending[1].resolve(43);
  expect(await p2).toBe(43);
});

test('stale in-flight SUCCESS after invalidate does not overwrite the newer value', async () => {
  const h = harness();
  const old = h.cache.get('AAPL');
  await flush();
  h.cache.invalidate('AAPL');
  const fresh = h.cache.get('AAPL');
  await flush();
  expect(h.calls()).toBe(2);
  h.pending[1].resolve(200);
  expect(await fresh).toBe(200);
  h.pending[0].resolve(100);
  expect(await old).toBe(100);
  await flush();
  expect(await h.cache.get('AAPL')).toBe(200);
  expect(h.calls()).toBe(2);
});

test('stale in-flight FAILURE after invalidate does not evict the newer entry', async () => {
  const h = harness();
  const old = h.cache.get('AAPL');
  await flush();
  h.cache.invalidate('AAPL');
  const fresh = h.cache.get('AAPL');
  await flush();
  h.pending[1].resolve(300);
  expect(await fresh).toBe(300);
  h.pending[0].reject(new Error('late failure'));
  await expect(old).rejects.toThrow('late failure');
  await flush();
  expect(await h.cache.get('AAPL')).toBe(300);
  expect(h.calls()).toBe(2);
});

test('a synchronous throw from fetchQuote becomes a rejection and is not cached', async () => {
  let n = 0;
  const cache = new QuoteCache((s) => { n++; if (n === 1) throw new Error('sync boom'); return Promise.resolve(9); });
  await expect(cache.get('X')).rejects.toThrow('sync boom');
  expect(await cache.get('X')).toBe(9);
});
`,
          },
        ],
        solution: {
          'src/quoteCache.js': `/**
 * QuoteCache: dedupes and caches upstream quote requests.
 *
 * Contract:
 *  - get(sym) returns a Promise of the quote.
 *  - Concurrent get(sym) calls while a fetch is in flight share ONE upstream fetch.
 *  - A successful quote is fresh for ttlMs, measured from when its fetch completed.
 *  - A failed fetch is never cached: every waiter of that fetch rejects, and the next get() refetches.
 *  - invalidate(sym) forgets the symbol immediately. A fetch that was in flight at the time
 *    must not later overwrite or evict whatever entry has replaced it.
 */
class QuoteCache {
  constructor(fetchQuote, { ttlMs = 1000, now = () => Date.now() } = {}) {
    this.fetchQuote = fetchQuote;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  get(sym) {
    const cur = this.entries.get(sym);
    // In-flight entries (at === null) are always shared; completed ones only while fresh.
    if (cur && (cur.at === null || this.now() - cur.at < this.ttlMs)) return cur.promise;

    const entry = { at: null, promise: null };
    // Register the entry SYNCHRONOUSLY, before any await, so concurrent callers see it.
    entry.promise = new Promise((resolve) => resolve(this.fetchQuote(sym))).then(
      (value) => {
        if (this.entries.get(sym) === entry) entry.at = this.now();
        return value;
      },
      (err) => {
        // Identity check: never evict an entry that replaced us after invalidate().
        if (this.entries.get(sym) === entry) this.entries.delete(sym);
        throw err;
      },
    );
    this.entries.set(sym, entry);
    return entry.promise;
  }

  invalidate(sym) {
    this.entries.delete(sym);
  }
}

module.exports = { QuoteCache };
`,
        },
        hints: [
          'Cache the **promise**, not the value, and put it in the map before anything is awaited.',
          'On failure you must remove the entry, but only if the map still points at *this* entry (compare identities).',
          'Wrap the call so a synchronous `throw` in `fetchQuote` becomes a rejection: `new Promise((r) => r(fetchQuote(sym)))`.',
        ],
        explanation: `The original cached the *value* after \`await\`, so every caller arriving during the await saw an empty map and started its own fetch. The fix stores an entry holding the **promise** synchronously, so the very next caller in the same tick finds it.

Two classic follow-on bugs separate a senior fix from a naive one:
1. **Negative caching.** If you cache the promise and never remove it, a rejected promise is served forever. You need an \`onRejected\` that deletes the entry and re-throws, so every waiter still rejects.
2. **The ABA-style eviction race.** After \`invalidate\` and a new \`get\`, the map holds a *new* entry. When the stale fetch later settles, a plain \`this.entries.delete(sym)\` / \`set(sym, …)\` would clobber the newer entry. Guard every write with \`this.entries.get(sym) === entry\`.

Stamping \`at\` on completion (with \`at === null\` meaning "in flight, always share") implements "TTL measured from completion". Wrapping the call in \`new Promise(r => r(fetchQuote(sym)))\` turns synchronous throws into rejections that go through the same eviction path.`,
        timeLimitSec: 1200,
        focusFile: 'src/quoteCache.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Async iterator pipeline: laziness, backpressure, return() propagation
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-ts-async-iter-pipeline',
    title: 'Pull, Don\'t Push: The Async Iterator Pipeline',
    level: 5,
    rating: 2850,
    lang: 'typescript',
    domain: 'market-data',
    companies: ['optiver', 'two-sigma', 'jane-street', 'generic'],
    tags: ['async-generators', 'backpressure', 'iterator-protocol', 'resource-cleanup', 'event-loop'],
    summary: 'A tick stream goes through async generators. Predict the interleaving, then find the stage that leaks venue subscriptions.',
    context:
      'The tick ingestion service is built from composable async generators: a venue feed, a `mapAsync` enrichment step and a `batch` step that groups ticks for the risk engine. Ops reports that venue subscriptions keep piling up after strategies stop consuming.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'src/pipeline.ts',
        content: `const log: string[] = [];

async function* ticks(n: number) {
  try {
    for (let i = 0; i < n; i++) {
      log.push(\`produce \${i}\`);
      yield i;
      log.push(\`resumed \${i}\`);
    }
  } finally {
    log.push('producer cleanup');
  }
}

async function* mapAsync<T, U>(src: AsyncIterable<T>, f: (x: T) => Promise<U>) {
  try {
    for await (const x of src) {
      yield await f(x);
    }
  } finally {
    log.push('map cleanup');
  }
}

async function main() {
  const it = mapAsync(ticks(5), async (x) => {
    log.push(\`map \${x}\`);
    return x * 10;
  });
  for await (const v of it) {
    log.push(\`got \${v}\`);
    if (v === 10) break;
  }
  log.push('after loop');
}

main().then(() => log.push('main done'));
log.push('sync');
setTimeout(() => console.log(log.join('\\n')), 0);
`,
      },
      {
        path: 'src/queued.ts',
        content: `const log: string[] = [];

async function* feed() {
  try {
    for (let i = 0; ; i++) {
      log.push('p' + i);
      yield i;
    }
  } finally {
    log.push('fin');
  }
}

const it = feed();
const reqs = [it.next(), it.next(), it.return(42), it.next()];
log.push('sync');
Promise.all(reqs).then((rs) => {
  console.log(log.join(','));
  console.log(rs.map((r) => \`\${r.value}/\${r.done}\`).join(' '));
});
`,
      },
      {
        path: 'src/batch.ts',
        content: `export interface Tick { sym: string; px: number }

/** Venue feed. The finally block MUST run so the venue subscription is released. */
export async function* venueFeed(venue: { subscribe(): AsyncIterator<Tick>; unsubscribe(): void }) {
  const sub = venue.subscribe();
  try {
    while (true) {
      const r = await sub.next();
      if (r.done) return;
      yield r.value;
    }
  } finally {
    venue.unsubscribe();
  }
}

/** Group ticks into arrays of \`size\`; flush the remainder at the end. */
export async function* batch<T>(src: AsyncIterable<T>, size: number): AsyncGenerator<T[]> {
  const it = src[Symbol.asyncIterator]();
  let buf: T[] = [];
  while (true) {
    const { value, done } = await it.next();
    if (done) break;
    buf.push(value);
    if (buf.length === size) {
      yield buf;
      buf = [];
    }
  }
  if (buf.length) yield buf;
}

/** Keep only ticks for one symbol. */
export async function* only<T extends Tick>(src: AsyncIterable<T>, sym: string) {
  for await (const t of src) {
    if (t.sym === sym) yield t;
  }
}

/** Strategy: consume until the first batch whose average is above a threshold. */
export async function firstHotBatch(src: AsyncIterable<Tick>, threshold: number) {
  for await (const b of batch(src, 4)) {
    const avg = b.reduce((s, t) => s + t.px, 0) / b.length;
    if (avg > threshold) return b;
  }
  return null;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Who runs when?',
        prompt: 'Predict the output of `src/pipeline.ts`.',
        entry: 'src/pipeline.ts',
        answer:
          'produce 0\nsync\nmap 0\ngot 0\nresumed 0\nproduce 1\nmap 1\ngot 10\nproducer cleanup\nmap cleanup\nafter loop\nmain done',
        options: [
          'produce 0\nsync\nmap 0\ngot 0\nresumed 0\nproduce 1\nmap 1\ngot 10\nproducer cleanup\nmap cleanup\nafter loop\nmain done',
          'sync\nproduce 0\nmap 0\ngot 0\nresumed 0\nproduce 1\nmap 1\ngot 10\nmap cleanup\nproducer cleanup\nafter loop\nmain done',
          'produce 0\nsync\nmap 0\nresumed 0\nproduce 1\ngot 0\nmap 1\nresumed 1\nproduce 2\ngot 10\nproducer cleanup\nmap cleanup\nafter loop\nmain done',
          'produce 0\nsync\nmap 0\ngot 0\nresumed 0\nproduce 1\nmap 1\ngot 10\nafter loop\nmain done',
        ],
        hints: [
          'Calling an async generator function runs nothing, but the first `next()` runs its body **synchronously** up to the first `await`/`yield`.',
          'Generators are pull-based: `ticks` only resumes when `mapAsync` asks for its next value, which only happens when the consumer asks `mapAsync`.',
          '`break` in `for await` calls `it.return()`. Where is `mapAsync` suspended at that moment, and what does its `for await` do when it receives a return completion?',
        ],
        explanation: `**Synchronous start.** \`main()\` runs synchronously until its first real suspension. \`for await\` calls \`it.next()\`, which starts \`mapAsync\`'s body; its \`for await\` calls \`ticks.next()\`, which starts \`ticks\`'s body, which pushes \`produce 0\` and reaches \`yield 0\`. Everything up to here happened inside the synchronous call to \`main()\`, so \`produce 0\` comes **before** \`sync\`.

**Strict pull.** \`ticks\` stays parked at \`yield 0\` until someone calls \`next()\` on it again. \`mapAsync\` receives 0, runs \`f(0)\` (\`map 0\`), awaits it, and yields 0 to the consumer (\`got 0\`). Only when the consumer loops and calls \`next()\` does \`mapAsync\` resume and call \`ticks.next()\`, so \`resumed 0\`/\`produce 1\` come *after* \`got 0\`. There is no read-ahead: async generators have no internal buffer. That is natural backpressure.

**Return propagation.** On \`got 10\` the consumer \`break\`s, so \`for await\` runs AsyncIteratorClose, which calls \`mapAsync.return()\`. \`mapAsync\` is suspended at its \`yield\`, so it resumes with a *return completion*. That completion leaves the inner \`for await\`, which runs AsyncIteratorClose on \`ticks\` (\`ticks.return()\`). \`ticks\` is suspended at \`yield 1\`, so its \`finally\` runs first (\`producer cleanup\`). Then \`mapAsync\`'s own \`finally\` runs (\`map cleanup\`). The consumer awaits the \`return()\` promise before continuing (\`after loop\`), then \`main\` settles (\`main done\`). \`resumed 1\` is never printed.`,
        timeLimitSec: 600,
        focusFile: 'src/pipeline.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Queued requests',
        prompt: 'Now `src/queued.ts` fires four requests at a fresh generator **without awaiting** between them. What does it print?',
        entry: 'src/queued.ts',
        answer: 'p0,sync,p1,fin\n0/false 1/false 42/true undefined/true',
        options: [
          'p0,sync,p1,fin\n0/false 1/false 42/true undefined/true',
          'p0,p1,fin,sync\n0/false 1/false 42/true undefined/true',
          'p0,sync,fin\n0/false undefined/true 42/true undefined/true',
          'p0,sync,p1,p2,fin\n0/false 1/false 42/true 2/false',
        ],
        hints: [
          'An async generator keeps a **queue** of requests. A `next()` issued while it is executing (or not yet resolved) is enqueued, not rejected.',
          'Requests are serviced strictly one after another, in order. `return(42)` is serviced only after the second `next()` has produced its value.',
        ],
        explanation: `Async generator objects have an internal [[AsyncGeneratorQueue]]. The first \`next()\` starts the body synchronously (\`p0\`) and it suspends at \`yield 0\`. The other three calls are just enqueued and \`sync\` is logged. Yielding in an async generator awaits the value and then completes the head request. AsyncGeneratorDrainQueue then resumes the body for the second \`next()\` (\`p1\`, \`yield 1\`). Then \`return(42)\` resumes the body at \`yield 1\` with a return completion, so \`finally\` runs (\`fin\`) and the request completes with \`{value: 42, done: true}\`. The generator is now completed, so the last \`next()\` resolves \`{value: undefined, done: true}\`.

Practical point: you cannot get concurrency out of a single async generator by calling \`next()\` several times. It is a strictly sequential request queue, which is exactly why it gives backpressure for free.`,
        timeLimitSec: 420,
        focusFile: 'src/queued.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Who leaks the subscription?',
        prompt:
          'After `firstHotBatch` returns, the venue\'s `unsubscribe()` is **never** called (it is called fine if the strategy consumes `venueFeed` directly with `for await` and breaks). Click the line responsible and choose the root cause.',
        file: 'src/batch.ts',
        lines: [19, 21, 22],
        options: [
          '`batch` drives its source with manual `it.next()` calls and never calls `it.return()`, so when the consumer stops early, `batch` finishes but the source generator stays suspended at `yield` and its `finally` never runs',
          '`venueFeed` must put `venue.unsubscribe()` in a `catch` block, because `finally` does not run for async generators',
          '`firstHotBatch` uses `return b` inside `for await`, which skips the iterator\'s `return()` method',
          '`only` should use `yield*` instead of `for await`, otherwise its finally blocks are skipped',
        ],
        correct: 0,
        hints: [
          '`for await ... break/return` calls `return()` on the iterator it is looping over, but only that one.',
          'Which of these generators obtains an iterator but never hands it to a `for await` loop?',
        ],
        explanation: `\`firstHotBatch\`'s \`return b\` *does* close \`batch(...)\` (AsyncIteratorClose calls \`batch.return()\`). \`batch\` is suspended at \`yield buf\` and resumes with a return completion. But nothing in \`batch\` forwards that to its source: it obtained \`it\` manually (line 19) and pumps it with \`await it.next()\` (line 22). Only the \`for await\` statement performs AsyncIteratorClose automatically. So the upstream \`venueFeed\` stays suspended at its \`yield\` forever, its \`finally\` never runs, and the subscription leaks.

Fix: use \`for await (const value of src)\` (gets close-on-abrupt-exit for free), or wrap the manual loop in \`try { … } finally { await it.return?.(); }\`. Options 2-4 are false: \`finally\` does run in async generators when they are resumed with a return completion; \`return\` inside \`for await\` does call \`return()\`; and \`for await\` in \`only\` already propagates closure.`,
        timeLimitSec: 480,
        focusFile: 'src/batch.ts',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Proxy + getters + super home objects
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-js-proxy-receiver',
    title: 'The Receiver Knows Too Much',
    level: 5,
    rating: 2650,
    lang: 'javascript',
    domain: 'language-semantics',
    companies: ['meta', 'canva', 'atlassian', 'google'],
    tags: ['proxy', 'reflect', 'getters', 'super', 'home-object', 'prototype-chain', 'spread'],
    summary: 'A dependency-tracking Proxy, a getter, `super` and the prototype chain. Exactly which keys get tracked?',
    context:
      'The front-end order ticket uses a tiny reactive system: reads through `track()` are recorded so the UI knows which fields a computed value depends on. Prices are wrong in some derived views, and someone wants to "optimise" the trap.',
    persona: 'confident-intern',
    files: [
      {
        path: 'src/track.js',
        content: `const accessed = [];
function track(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      if (typeof key === 'string') accessed.push(key);
      return Reflect.get(target, key, receiver);
    },
  });
}
function drain() {
  const s = accessed.join(',');
  accessed.length = 0;
  return s;
}

const instrument = {
  name: 'base',
  describe() {
    return \`\${this.name}@\${this.venue}\`;
  },
};

const order = {
  __proto__: instrument,
  name: 'ORD-1',
  venue: 'XNAS',
  qty: 3,
  px: 100,
  get notional() {
    return this.qty * this.px;
  },
  describe() {
    return 'order:' + super.describe();
  },
};

const p = track(order);
console.log(p.notional, drain());

const child = Object.create(p);
child.qty = 5;
console.log(child.notional, drain());

const clone = { ...p };
console.log(clone.notional, drain());

const borrowed = { name: 'B', venue: 'XLON', describe: order.describe };
console.log(borrowed.describe(), drain());

console.log(p.describe(), drain());
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Trace every trap',
        prompt: 'Predict the output of `src/track.js` (the second column is the comma-joined list of tracked keys; an empty list prints nothing after the value).',
        answer:
          '300 notional,qty,px\n500 notional,px\n300 name,venue,qty,px,notional,qty,px,describe\norder:B@XLON\norder:ORD-1@XNAS describe,name,venue',
        options: [
          '300 notional,qty,px\n500 notional,px\n300 name,venue,qty,px,notional,qty,px,describe\norder:B@XLON\norder:ORD-1@XNAS describe,name,venue',
          '300 notional\n300 notional\n300 name,venue,qty,px,notional,describe\norder:B@XLON\norder:ORD-1@XNAS describe',
          '300 notional,qty,px\n500 qty,notional,px\n300 notional,qty,px\nB@XLON\norder:ORD-1@XNAS describe,name,venue',
          '300 notional,qty,px\n500 notional,px\n300 name,venue,qty,px,notional,describe\norder:base@undefined\norder:ORD-1@XNAS describe,name,venue',
        ],
        hints: [
          '`Reflect.get(target, key, receiver)` runs a getter with `this === receiver`, and the receiver is not always the proxy.',
          '`child.qty = 5` performs [[Set]] along the prototype chain. With no `set` trap, where does the new data property end up?',
          '`super.describe` is resolved through the method\'s [[HomeObject]] (fixed at definition), but `this` is whatever the call site provides.',
        ],
        explanation: `**Line 1.** \`p.notional\` → \`get\` trap (\`notional\`) → \`Reflect.get(order, 'notional', p)\` calls the getter with \`this = p\`, so \`this.qty\` and \`this.px\` go through the trap again: \`notional,qty,px\`, value 300.

**Line 2.** \`child.qty = 5\`: \`child\` has no own \`qty\`, so OrdinarySet walks to the proxy. There is no \`set\` trap, so the default forwards to \`order\`'s [[Set]] **with receiver = child**. \`qty\` is a writable data property, so the new property is created *on the receiver* (\`child\`), and \`order.qty\` stays 3. Reading \`child.notional\`: not own, so the proto (proxy) \`get\` trap runs with \`receiver = child\` (\`notional\`). The getter runs with \`this = child\`: \`this.qty\` is child's own 5 (no trap), \`this.px\` misses on child and hits the proxy trap (\`px\`). 5 × 100 = 500.

**Line 3.** Object spread is CopyDataProperties: [[OwnPropertyKeys]] on the proxy (no trap, so insertion order \`name, venue, qty, px, notional, describe\`; \`__proto__:\` in a literal sets the prototype and is not an own key), then [[Get]] for each. Getting \`notional\` runs the getter with receiver = proxy, which reads \`qty,px\` through the trap again. The clone gets a plain data property \`notional: 300\`, and reading it later touches no proxy.

**Line 4.** \`describe\` was defined with method syntax inside \`order\`, so its [[HomeObject]] is \`order\` permanently. \`super.describe\` = \`Object.getPrototypeOf(order).describe\` = \`instrument.describe\`, called with the *current* \`this\` (\`borrowed\`): \`order:B@XLON\`. Copying a method does not rebind \`super\`. Nothing went through the proxy, so the list is empty.

**Line 5.** \`p.describe\` is trapped (\`describe\`) and called with \`this = p\`. \`super.describe()\` calls \`instrument.describe\` with \`this = p\`, so \`this.name\`/\`this.venue\` are trapped.`,
        timeLimitSec: 720,
        focusFile: 'src/track.js',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'A "free" optimisation',
        prompt: 'The assistant proposes a micro-optimisation for the hot `get` trap. Review it.',
        persona: 'confident-intern',
        request: 'The get trap shows up in the profiler. Can we make it cheaper?',
        aiReply: `Sure! \`Reflect.get\` is an extra function call. Indexing the target directly is equivalent and ~15% faster in V8:

\`\`\`js
get(target, key, receiver) {
  if (typeof key === 'string') accessed.push(key);
  return target[key]; // same result, no Reflect overhead
}
\`\`\`

Both read the same property from the same object, so behaviour is unchanged. ✅`,
        options: [
          'Accept: for data properties and getters alike, `target[key]` and `Reflect.get(target, key, receiver)` return the same value',
          'Reject: `target[key]` runs getters with `this = target` instead of the receiver, so `p.notional` would only track `notional` (losing its `qty`/`px` dependencies) and `child.notional` would ignore `child.qty` and return 300',
          'Reject: `target[key]` throws a TypeError for symbol keys inside a Proxy trap',
          'Reject: `target[key]` re-enters the `get` trap recursively and overflows the stack',
        ],
        correct: 1,
        hints: ['What is `this` inside the `notional` getter in each version?'],
        explanation:
          '`target[key]` is `target.[[Get]](key, target)`. The receiver is the target itself, so accessor properties run with `this = target`, bypassing the proxy. Reads inside getters are no longer tracked (a reactive UI would show a stale notional when `qty` changes). Inheritance through the proxy also breaks: `child.notional` computes from `order.qty` (3) instead of `child.qty` (5). `Reflect.get(target, key, receiver)` exists precisely to forward the receiver. It does not recurse (the target is not the proxy), and symbol keys are fine.',
        timeLimitSec: 360,
        focusFile: 'src/track.js',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Home objects and receivers',
        prompt: 'Select **all** true statements.',
        options: [
          'A method defined with method syntax captures [[HomeObject]] at definition time; assigning it to another object does not change what `super` refers to',
          '`super.describe()` invokes the parent\'s method with the current `this`, not with the home object',
          'If `Object.setPrototypeOf(order, other)` were called later, `super.describe()` inside `order.describe` would start resolving through `other`',
          'Arrow functions and `function` expressions assigned as properties also get a [[HomeObject]], so `super` works in them',
          'A `set` trap is required for `child.qty = 5` to create a property on `child` when the proxy is in its prototype chain',
        ],
        correct: [0, 1, 2],
        hints: ['`super.x` is `HomeObject.[[GetPrototypeOf]]().[[Get]](x, this)`, evaluated at call time.'],
        explanation:
          'The HomeObject is fixed, but its *prototype* is read each time `super` is evaluated, so re-parenting `order` changes what `super` finds (option 3 is true). `super` property references use the current `this` as the receiver. Only method-syntax definitions (methods, getters, setters, class methods) get a HomeObject; using `super` in a plain `function` is a SyntaxError, and arrows inherit `super` lexically from the enclosing method. Without a `set` trap the proxy forwards [[Set]] to the target with the original receiver, and OrdinarySet creates the property on the receiver (`child`).',
        timeLimitSec: 360,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Completion records: labels, finally overriding return/throw
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-js-finally-completions',
    title: 'Settlement Loop: Who Gets the Last Word?',
    level: 5,
    rating: 2450,
    lang: 'javascript',
    domain: 'payments',
    companies: ['stripe', 'goldman', 'jpmorgan', 'generic'],
    tags: ['completion-records', 'finally', 'labels', 'control-flow', 'exceptions'],
    summary: 'Labelled `continue`/`break` inside `finally` override returns and swallow exceptions. Predict four settlement runs.',
    context:
      'The legacy settlement batcher is a nest of labelled loops and `finally` blocks. Audit found batches that report success even though a leg was negative.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'src/settle.js',
        content: `function settle(batch, limit) {
  const log = [];
  let total = 0;
  accounts: for (const acct of batch) {
    try {
      for (const amt of acct.legs) {
        try {
          if (amt === 0) continue accounts;
          if (amt < 0) throw new Error(\`negative leg on \${acct.id}\`);
          total += amt;
          if (total > limit) return \`LIMIT at \${acct.id}\`;
        } finally {
          log.push(\`\${acct.id}\${amt}\`);
          if (amt === 7) break accounts;
        }
      }
    } catch (e) {
      log.push('ERR');
      return \`FAILED: \${e.message}\`;
    } finally {
      if (acct.vip) continue;
    }
  }
  return \`total=\${total} log=\${log.join(' ')}\`;
}

console.log(settle([{ id: 'A', legs: [5, 0, 9] }, { id: 'B', legs: [4, 7, 1] }, { id: 'C', legs: [2] }], 100));
console.log(settle([{ id: 'A', legs: [95, 7] }, { id: 'B', legs: [1] }], 100));
console.log(settle([{ id: 'A', vip: true, legs: [-1, 3] }, { id: 'B', legs: [8] }], 100));
console.log(settle([{ id: 'A', legs: [90, 20, 7] }, { id: 'B', vip: true, legs: [1] }], 100));
`,
      },
      {
        path: 'src/postFills.js',
        content: `const MAX_AUDIT = 3;

function validate(fill) {
  if (!(fill.qty > 0)) throw new RangeError(\`bad qty on \${fill.id}\`);
  if (!Number.isFinite(fill.px)) throw new RangeError(\`bad px on \${fill.id}\`);
}

function postFills(book, fills, audit) {
  let posted = 0;
  for (const fill of fills) {
    try {
      validate(fill);
      book.apply(fill);
      posted++;
    } finally {
      audit.push(fill.id);
      if (audit.length >= MAX_AUDIT) {
        audit.flush();
        return posted;
      }
    }
  }
  return posted;
}

function withBook(load, fn) {
  const book = load();
  try {
    return fn(book);
  } finally {
    book.close();
  }
}

module.exports = { postFills, withBook };
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Four batches',
        prompt: 'Predict the four lines printed by `src/settle.js`.',
        answer: 'total=16 log=A5 A0 B4 B7\ntotal=102 log=A95 A7\ntotal=8 log=A-1 ERR B8\nLIMIT at A',
        hints: [
          'A `finally` block that completes abruptly (`break`, `continue`, `return`, `throw`) **replaces** the completion of the `try`/`catch`.',
          'A `finally` that completes normally lets the original completion (including a pending `return` or labelled `continue`) proceed.',
          'In run 2, `return` happens at total 102, but whose `finally` runs next, and what does it do when `amt === 7`?',
        ],
        explanation: `The spec models control flow with completion records. \`try { A } finally { B }\`: if B completes **normally**, the result is A's completion; if B completes **abruptly**, B's completion wins.

1. A: 5 (log A5). 0 → \`continue accounts\`; the inner \`finally\` logs A0 and completes normally, so the labelled continue propagates through the outer try (outer finally normal) to the next account. B: 4 (total 9), 7 (total 16) → inner finally logs B7 and \`break accounts\` exits the loop. C never runs. → \`total=16 log=A5 A0 B4 B7\`.
2. A: 95, then 7 → total 102 > 100 → \`return 'LIMIT at A'\`. The inner \`finally\` sees \`amt === 7\` and executes \`break accounts\`. That break **replaces** the return completion, so the loop ends and the final return reports \`total=102\`.
3. A: -1 → throw; inner finally logs A-1; outer \`catch\` logs ERR and returns \`FAILED…\`. The outer \`finally\` sees \`acct.vip\` and \`continue\`s, which **discards the return** (and therefore the error). B: 8 → \`total=8\`.
4. A: 90, 20 → 110 > 100 → return \`LIMIT at A\`. The inner finally logs A20 with amt ≠ 7 (normal completion), and the outer finally is not VIP (normal). The return stands. The function returns before reaching B.`,
        timeLimitSec: 600,
        focusFile: 'src/settle.js',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The swallowed RangeError',
        prompt:
          'In production, `postFills` sometimes returns normally even though a fill with `qty: 0` was in the batch, and **no error surfaces**. It only happens "occasionally". Click the offending line and pick the root cause.',
        file: 'src/postFills.js',
        lines: [19],
        options: [
          'The `return posted` inside `finally` overrides the pending throw completion, so a validation error raised on the fill that fills the audit window is silently discarded (and the remaining fills are skipped)',
          '`validate` throws a `RangeError`, which `try/finally` does not propagate because there is no `catch`',
          '`withBook` returns from inside `try`, so `book.close()` never runs',
          '`posted++` executes before `book.apply` because of hoisting',
        ],
        correct: 0,
        hints: ['Only the fill that brings `audit.length` to `MAX_AUDIT` is affected. Why would that one be special?'],
        explanation:
          'A `try { … } finally { … }` without `catch` normally re-throws after `finally`. Here `finally` completes abruptly with `return posted` whenever the audit buffer reaches its threshold, and that return completion **replaces** the throw completion. So the error disappears only on the fill that triggers a flush, which is why it looks intermittent. It also aborts processing of the remaining fills while reporting success. Move the flush/return logic out of `finally` (for example flush in `finally`, but decide whether to stop *after* the try statement). `withBook` is fine: `finally` runs after the return value is computed and, completing normally, preserves it.',
        timeLimitSec: 360,
        focusFile: 'src/postFills.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 5. Money and IDs: Number precision vs BigInt
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-ts-money-bigint',
    title: 'Half a Cent and a 64-bit Order ID',
    level: 5,
    rating: 2500,
    lang: 'typescript',
    domain: 'payments',
    companies: ['stripe', 'citadel', 'blackrock', 'jpmorgan'],
    tags: ['floating-point', 'bigint', 'rounding', 'json', 'decimal-arithmetic'],
    summary: 'IEEE-754 doubles meet decimal prices and 64-bit IDs. Predict the damage, review a bogus fix, then do it exactly.',
    context:
      'The fee service parses order messages from the matching engine. Finance says some notionals are off by a cent, and support says some order IDs "don\'t exist".',
    persona: 'confident-intern',
    files: [
      {
        path: 'src/precision.ts',
        content: `const payload = '{"orderId": 9007199254740993, "px": "1.005", "qty": 3}';
const msg = JSON.parse(payload);
console.log(msg.orderId);
console.log(String(msg.orderId) === '9007199254740993');

const px = parseFloat(msg.px);
console.log((px * 100).toString());
console.log(Math.round(px * 100) / 100, px.toFixed(2));

const milli = BigInt(Math.round(px * 1000)) * BigInt(msg.qty);
console.log(milli.toString());

console.log((-7n / 2n).toString(), (-7n % 2n).toString());
console.log(0.1 + 0.2 === 0.3, 0.1 * 3, 0.3 / 0.1);

try {
  console.log(BigInt(0.1 * 3 * 10));
} catch (e) {
  console.log((e as Error).name);
}
console.log(Number(2n ** 53n + 1n) === 2 ** 53);
`,
      },
      {
        path: 'src/fees.ts',
        content: `/**
 * notional(px, qty): exact notional of a fill, rounded to cents.
 *
 *  - px: decimal string with up to 6 fractional digits, optional leading '-', e.g. "101.125", "-0.5"
 *  - qty: integer string, may exceed 2^53, e.g. "9007199254740993"
 *  - Rounding: to 2 decimals, HALF AWAY FROM ZERO (1.005 -> 1.01, -2.345 -> -2.35)
 *  - Output: "-123.45" style string, never "-0.00"
 */
export function notional(px: string, qty: string): string {
  return (parseFloat(px) * Number(qty)).toFixed(2);
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the damage',
        prompt: 'Predict the exact output of `src/precision.ts`.',
        entry: 'src/precision.ts',
        answer:
          '9007199254740992\nfalse\n100.49999999999999\n1 1.00\n3015\n-3 -1\nfalse 0.30000000000000004 2.9999999999999996\nRangeError\ntrue',
        hints: [
          '2^53 + 1 is the first integer a double cannot represent. Ties round to even.',
          '1.005 is stored as 1.00499999999999989342…. Both `Math.round(x*100)` and `toFixed(2)` see that value.',
          '`BigInt(number)` throws unless the number is an integer. BigInt division truncates toward zero.',
        ],
        explanation: `- \`JSON.parse\` produces Numbers. 9007199254740993 = 2^53 + 1 lies exactly between two doubles (2^53 and 2^53 + 2), and round-half-to-even picks 2^53 = **9007199254740992**. The ID is silently corrupted. Use string IDs or a reviver with \`context.source\` and BigInt.
- \`parseFloat('1.005')\` is 1.00499999999999989…. Multiplying by 100 gives **100.49999999999999**, so \`Math.round\` → 100 → **1**, and \`toFixed(2)\` (which uses the exact binary value) → **"1.00"**. Both are wrong under half-up rounding.
- \`px * 1000\` = 1004.9999999999999, and \`Math.round\` → 1005. × 3n = **3015**. This one works by luck: scaling by 1000 and rounding happens to recover the intended value.
- BigInt \`/\` truncates toward zero (−3) and \`%\` takes the sign of the dividend (−1).
- \`0.1*3\` = 0.30000000000000004 and \`0.3/0.1\` = 2.9999999999999996, both correctly rounded IEEE results.
- \`BigInt(3.0000000000000004)\` throws **RangeError** (NumberToBigInt requires an integral Number).
- \`Number(2n**53n + 1n)\` rounds to nearest-even = 2^53, so **true**.`,
        timeLimitSec: 540,
        focusFile: 'src/precision.ts',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'The EPSILON patch',
        prompt: 'Finance pings you with the assistant\'s proposed fix for `notional`. Review it against the doc comment.',
        persona: 'confident-intern',
        request: 'notional("1.005", "1") returns "1.00" but should be "1.01". Fix it.',
        aiReply: `Classic float issue! The standard fix is to nudge by \`Number.EPSILON\` before rounding:

\`\`\`ts
export function notional(px: string, qty: string): string {
  const raw = parseFloat(px) * Number(qty);
  return (Math.round((raw + Number.EPSILON) * 100) / 100).toFixed(2);
}
\`\`\`

\`notional("1.005", "1")\` now gives \`"1.01"\`. This is the well-known StackOverflow answer, it works for all prices. ✅`,
        options: [
          'Accept: adding EPSILON compensates for representation error for any magnitude',
          'Reject: `Number.EPSILON` (2^-52) is the gap next to **1.0** only. For notionals above a few units the nudge is smaller than half an ulp and vanishes, negatives round toward +∞ (`Math.round(-234.5)` is -234), and `Number(qty)` still corrupts quantities above 2^53',
          'Reject: `Math.round` returns a string, so `.toFixed` throws',
          'Reject: it is correct but slower; prefer `toPrecision`',
        ],
        correct: 1,
        hints: ['What is the spacing between adjacent doubles near 100,000? Compare it to 2.2e-16.', 'What does `Math.round(-2.5)` return?'],
        explanation:
          'The EPSILON trick only "works" when the scaled value is near 1. The ulp of a double x is about |x|·2^-52, so once |x| ≥ 2 the addition `raw + 2.2e-16` is less than half an ulp and returns `raw` unchanged. Concretely `notional("10.075", "1")` still yields `"10.07"` (10.075 is stored as 10.07499999…), and so do `2.135`, `64.085` and many other `x.xx5` prices. For negatives the nudge pushes the wrong way and `Math.round` breaks ties toward +∞: `-2.345` gives `-2.34` instead of the specified `-2.35` (half away from zero). `Number(qty)` cannot represent `9007199254740993`. The only robust approach is to never put decimal money into binary floating point: parse the decimal string into a scaled BigInt and round with integer arithmetic.',
        timeLimitSec: 420,
        focusFile: 'src/fees.ts',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Exact notional',
        prompt:
          'Rewrite `notional` in `src/fees.ts` to meet its doc comment **exactly**: decimal parsing with no floating point, BigInt arithmetic, half-away-from-zero rounding to cents, and no `-0.00`. You may assume inputs are well-formed per the comment.',
        editable: ['src/fees.ts'],
        tests: [
          {
            path: 'tests/fees.test.ts',
            content: `import { notional } from '../src/fees';

test('half-up on exact decimal ties', () => {
  expect(notional('1.005', '1')).toBe('1.01');
  expect(notional('1000.005', '1')).toBe('1000.01');
  expect(notional('10.075', '1')).toBe('10.08');
  expect(notional('2.135', '1')).toBe('2.14');
  expect(notional('0.005', '1')).toBe('0.01');
  expect(notional('0.004999', '1')).toBe('0.00');
});

test('negatives round half away from zero and never print -0.00', () => {
  expect(notional('-2.345', '1')).toBe('-2.35');
  expect(notional('-0.001', '1')).toBe('0.00');
  expect(notional('-0.5', '3')).toBe('-1.50');
});

test('multiplies exactly', () => {
  expect(notional('0.1', '3')).toBe('0.30');
  expect(notional('101.125', '7')).toBe('707.88');
  expect(notional('123456789.123456', '1000000')).toBe('123456789123456.00');
});

test('quantities beyond 2^53 are exact', () => {
  expect(notional('1', '9007199254740993')).toBe('9007199254740993.00');
  expect(notional('0.01', '9007199254740993')).toBe('90071992547409.93');
});

test('integers and short fractions', () => {
  expect(notional('42', '2')).toBe('84.00');
  expect(notional('3.1', '1')).toBe('3.10');
  expect(notional('0.000001', '4999')).toBe('0.00');
  expect(notional('0.000001', '5000')).toBe('0.01');
});
`,
          },
        ],
        solution: {
          'src/fees.ts': `/**
 * notional(px, qty): exact notional of a fill, rounded to cents.
 *
 *  - px: decimal string with up to 6 fractional digits, optional leading '-', e.g. "101.125", "-0.5"
 *  - qty: integer string, may exceed 2^53, e.g. "9007199254740993"
 *  - Rounding: to 2 decimals, HALF AWAY FROM ZERO (1.005 -> 1.01, -2.345 -> -2.35)
 *  - Output: "-123.45" style string, never "-0.00"
 */
const SCALE = 6;

function parseScaled(px: string): bigint {
  const m = /^(-)?(\\d+)(?:\\.(\\d{1,6}))?$/.exec(px.trim());
  if (!m) throw new Error('bad price ' + px);
  const frac = (m[3] ?? '').padEnd(SCALE, '0');
  const v = BigInt(m[2] + frac);
  return m[1] ? -v : v;
}

export function notional(px: string, qty: string): string {
  const exact = parseScaled(px) * BigInt(qty); // scaled by 10^6
  const neg = exact < 0n;
  const abs = neg ? -exact : exact;
  const div = 10n ** BigInt(SCALE - 2); // 10^4: from micro-units to cents
  let cents = abs / div;
  if ((abs % div) * 2n >= div) cents += 1n; // half away from zero (on the magnitude)
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  return (neg && cents !== 0n ? '-' : '') + whole.toString() + '.' + frac;
}
`,
        },
        hints: [
          'Parse "101.125" as the integer 101125000 (scale 10^6) by padding the fraction, never via `parseFloat`.',
          'Round the *magnitude*: `q = abs / 10^4n`, bump if `2 * (abs % 10^4n) >= 10^4n`, then re-apply the sign.',
          'Only print the minus sign if the rounded cents are non-zero.',
        ],
        explanation: `Decimal money must never pass through binary floating point: \`"1.005"\` has no exact double, and \`Number("9007199254740993")\` is already wrong before any arithmetic. Scale to integers instead: price × 10^6 as BigInt, qty as BigInt, and the product is exact.

Rounding with BigInt needs care because \`/\` truncates toward zero and \`%\` takes the dividend's sign. Working on the absolute value and re-applying the sign gives half-away-from-zero symmetrically. Suppressing the sign when the rounded result is zero avoids the \`-0.00\` that \`toFixed\` produces for tiny negatives.`,
        timeLimitSec: 900,
        focusFile: 'src/fees.ts',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 6. Array.prototype.sort: spec-level guarantees & a broken book comparator
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-js-sort-comparator',
    title: 'Price-Time Priority and the Inconsistent Comparator',
    level: 5,
    rating: 2600,
    lang: 'javascript',
    domain: 'orderbook',
    companies: ['optiver', 'hrt', 'citadel', 'jane-street'],
    tags: ['sorting', 'comparator', 'stability', 'spec', 'orderbook'],
    summary: 'What does the spec actually guarantee about `sort`? Then fix a comparator that mixes bids and asks.',
    context:
      'The order-book snapshot service sorts resting orders for display and for the matching simulator. QA reports the depth ladder is occasionally wrong around round numbers, and a quant says "but sort is stable now, right?".',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'src/sortFacts.js',
        content: `const show = (a) => Array.from(a, (x, i) => (i in a ? String(x) : '_')).join(' ');

const sizes = [100, 25, 9, 1000];
console.log(show(sizes.sort()));

const px = [3, undefined, 1, , 2];
let sawUndefined = false;
px.sort((a, b) => {
  if (a === undefined || b === undefined) sawUndefined = true;
  return a - b;
});
console.log(show(px), px.length, sawUndefined);

const fills = [
  { id: 'f1', px: 101 },
  { id: 'f2', px: 100 },
  { id: 'f3', px: 101 },
  { id: 'f4', px: 100 },
];
fills.sort((a, b) => (a.px === b.px ? 0 : a.px < b.px ? 1 : -1));
console.log(fills.map((f) => f.id).join(' '));

const ids = ['b', 'a', 'c'];
const copy = ids.toSorted();
console.log(ids.join(''), copy.join(''));
`,
      },
      {
        path: 'src/book.js',
        content: `/**
 * Price-time priority.
 *  - bids: best (highest) price first
 *  - asks: best (lowest) price first
 *  - same price: earlier ts first; same ts: lower seq first
 * Prices arrive from the feed as decimal STRINGS, e.g. "99.75", "100.5".
 * Must not mutate the input array.
 */
function sortBook(orders) {
  const sorted = orders.slice().sort((a, b) => {
    if (a.px !== b.px) {
      if (a.side === 'B') return a.px < b.px ? 1 : -1;
      return a.px < b.px ? -1 : 1;
    }
    return a.ts - b.ts;
  });
  return {
    bids: sorted.filter((o) => o.side === 'B'),
    asks: sorted.filter((o) => o.side === 'S'),
  };
}

module.exports = { sortBook };
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What the spec guarantees',
        prompt: 'Every line of `src/sortFacts.js` is fully determined by the ECMAScript spec. Predict it.',
        entry: 'src/sortFacts.js',
        answer: '100 1000 25 9\n1 2 3 undefined _ 5 false\nf1 f3 f2 f4\nbac abc',
        hints: [
          'With no comparator, elements are compared by their **string** forms.',
          'SortIndexedProperties collects only present elements, and `undefined`s are set aside without ever calling the comparator. Holes go last.',
          'Since ES2019 `sort` must be stable. `toSorted` (ES2023) returns a new array.',
        ],
        explanation: `1. Default comparison is \`String(x) < String(y)\`: "100" < "1000" < "25" < "9".
2. Array.prototype.sort (via SortIndexedProperties with *skip-holes*) reads only existing indices (holes skipped). SortCompare orders every \`undefined\` after all other values **without calling the comparator**. The 4 collected items are written back to indices 0..3 and index 4 is deleted, so the hole moves to the end: \`1 2 3 undefined _\`, length unchanged (5).
3. The comparator is consistent (descending by px). Stability is guaranteed since ES2019, so equal prices keep input order: f1 before f3, f2 before f4.
4. \`toSorted\` copies; the original is untouched.

Not on this list on purpose: a comparator returning \`NaN\` or a boolean (\`(a, b) => a > b\`) is *not a consistent comparator*, and then the sort order is **implementation-defined**. Any output you see is an engine accident.`,
        timeLimitSec: 420,
        focusFile: 'src/sortFacts.js',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Is this comparator legal?',
        prompt: 'Which of these comparators are **consistent comparators** per the spec (so the result is fully specified)? Select all that apply.',
        options: [
          '`(a, b) => a - b` on an array of finite numbers',
          '`(a, b) => a > b` on numbers (returns a boolean)',
          '`(a, b) => a - b` on an array that may contain `NaN`',
          '`(a, b) => a.px - b.px || a.seq - b.seq` on objects with finite numeric `px` and unique `seq`',
          'The current `sortBook` comparator applied to a mix of bids and asks',
        ],
        correct: [0, 3],
        hints: ['A consistent comparator must induce a strict weak order: if a <C b and b <C c then a <C c, and "equal" must be transitive.', 'With `a > b`, what is returned when a < b? Is that distinguishable from equality?'],
        explanation:
          '`a > b` coerces to 1 or 0, never negative, so "a < b" is reported as "equal". With it, cmp(1, 2) says "equal" and cmp(2, 1) says "greater", which is not even antisymmetric, so the order is implementation-defined. `NaN` makes `a - b` return NaN, which is treated as +0 ("equal" to everything), breaking transitivity. In `sortBook`, the direction depends on `a.side` only: for a bid X and an ask Y, `cmp(X, Y)` and `cmp(Y, X)` can return the same sign (each claims to sort after the other), which violates antisymmetry. It also compares price *strings* lexicographically ("99.75" > "100.5"). Options 1 and 4 are total orders on their domains.',
        timeLimitSec: 360,
        focusFile: 'src/book.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the depth ladder',
        prompt:
          'Fix `sortBook` in `src/book.js` so it implements the documented price-time priority exactly (numeric prices, full tie-break chain, no input mutation, consistent comparators).',
        editable: ['src/book.js'],
        tests: [
          {
            path: 'tests/book.test.js',
            content: `const { sortBook } = require('../src/book');

const orders = () => [
  { id: 'b1', side: 'B', px: '99.75', ts: 3, seq: 7 },
  { id: 's1', side: 'S', px: '100.5', ts: 1, seq: 1 },
  { id: 'b2', side: 'B', px: '100.25', ts: 2, seq: 4 },
  { id: 's2', side: 'S', px: '101', ts: 2, seq: 5 },
  { id: 'b3', side: 'B', px: '99.75', ts: 1, seq: 2 },
  { id: 's3', side: 'S', px: '100.5', ts: 1, seq: 0 },
  { id: 'b4', side: 'B', px: '100.25', ts: 2, seq: 3 },
  { id: 's4', side: 'S', px: '99.9', ts: 9, seq: 9 },
];
const ids = (xs) => xs.map((o) => o.id);

test('bids: highest numeric price first, then ts, then seq', () => {
  expect(ids(sortBook(orders()).bids)).toEqual(['b4', 'b2', 'b3', 'b1']);
});

test('asks: lowest numeric price first, then ts, then seq', () => {
  expect(ids(sortBook(orders()).asks)).toEqual(['s4', 's3', 's1', 's2']);
});

test('does not mutate the input', () => {
  const o = orders();
  const before = ids(o);
  sortBook(o);
  expect(ids(o)).toEqual(before);
});

test('numeric, not lexicographic, comparison across digit counts', () => {
  const r = sortBook([
    { id: 'x', side: 'B', px: '9.5', ts: 1, seq: 1 },
    { id: 'y', side: 'B', px: '10', ts: 1, seq: 2 },
    { id: 'z', side: 'B', px: '10.0', ts: 0, seq: 3 },
  ]);
  expect(ids(r.bids)).toEqual(['z', 'y', 'x']);
});

test('result is independent of input order', () => {
  const base = orders();
  for (let k = 0; k < 20; k++) {
    const shuffled = base.slice();
    let s = k + 1;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2147483648;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const r = sortBook(shuffled);
    expect(ids(r.bids)).toEqual(['b4', 'b2', 'b3', 'b1']);
    expect(ids(r.asks)).toEqual(['s4', 's3', 's1', 's2']);
  }
});
`,
          },
        ],
        solution: {
          'src/book.js': `/**
 * Price-time priority.
 *  - bids: best (highest) price first
 *  - asks: best (lowest) price first
 *  - same price: earlier ts first; same ts: lower seq first
 * Prices arrive from the feed as decimal STRINGS, e.g. "99.75", "100.5".
 * Must not mutate the input array.
 */
function timeThenSeq(a, b) {
  return a.ts - b.ts || a.seq - b.seq;
}

function sortBook(orders) {
  const num = (o) => Number(o.px);
  const bids = orders
    .filter((o) => o.side === 'B')
    .sort((a, b) => num(b) - num(a) || timeThenSeq(a, b));
  const asks = orders
    .filter((o) => o.side === 'S')
    .sort((a, b) => num(a) - num(b) || timeThenSeq(a, b));
  return { bids, asks };
}

module.exports = { sortBook };
`,
        },
        hints: [
          'Partition first, then sort each side with its own comparator. A single comparator whose direction depends on one argument cannot be consistent.',
          'Compare prices numerically: `"10" !== "10.0"` but they are the same price.',
        ],
        explanation: `Three independent defects:
1. **Inconsistent comparator.** The direction depends on \`a.side\` only, so for a bid/ask pair \`cmp(a,b)\` and \`cmp(b,a)\` can both be negative. The spec then makes the order implementation-defined, and filtering afterwards does not undo the damage because the bids were positioned relative to asks.
2. **String comparison.** \`"99.75" < "100.5"\` is false lexicographically, and \`"10" !== "10.0"\` means equal prices are treated as different.
3. **Missing tie-break.** Equal \`ts\` returns 0, so stability preserves *input* order rather than \`seq\` order.

Partition, then sort each side with its own total order (\`price || ts || seq\`). \`filter\` already returns new arrays, so the input stays untouched.`,
        timeLimitSec: 720,
        focusFile: 'src/book.js',
      },
    ],
  },
];

export default problems;
