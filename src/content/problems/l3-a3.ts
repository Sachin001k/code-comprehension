import type { Problem } from '../types';

const problems: Problem[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Portfolio P&L service (TypeScript)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-ts-portfolio-pnl',
    title: 'Portfolio P&L: The Flipped Short',
    level: 3,
    rating: 1760,
    lang: 'typescript',
    domain: 'portfolio',
    companies: ['blackrock', 'goldman', 'jpmorgan', 'citadel'],
    tags: ['tracing', 'average-cost', 'dependency-injection', 'pnl'],
    summary: 'Average-cost P&L across a trade log, position book and price feed. One desk sees phantom losses after flipping a position.',
    context:
      'You have just joined the trading-platform team that owns the **portfolio P&L service**. A desk head reports that whenever a trader flips a position (e.g. short 10 → long 20 in one trade), the unrealised P&L on the new position is wrong until the end-of-day rebuild. Get oriented, reproduce it, then fix it.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# portfolio-pnl

Tracks positions and P&L for a trading desk.

## Layout

- src/app.ts: composition root. Builds the repository, book, price feed and services and injects them.
- src/api/portfolioController.ts: request handlers postTrade and getPnl.
- src/trades/tradeRepository.ts: append-only trade log (the source of truth).
- src/positions/positionBook.ts: applies trades to positions using AVERAGE COST. Owns realised P&L.
- src/pricing/priceFeedClient.ts: latest quotes. A mark is the mid price; stale quotes are ignored.
- src/pnl/pnlService.ts: realised + unrealised + fees for the whole book.

## Conventions

- qty is signed: long > 0, short < 0.
- Realised P&L is booked only when a trade REDUCES a position.
- A trade that flips a position (long 50 -> short 30) closes the old side at the trade
  price and opens the new side at the trade price.
- Unrealised P&L = (mark - avgCost) * qty. This works for shorts because qty is negative.
- Fees are price * qty * feeBps / 10000 and are reported separately from P&L.
`,
      },
      {
        path: 'src/domain/types.ts',
        content: `export type Side = 'BUY' | 'SELL';

export interface Trade {
  id: number;
  symbol: string;
  side: Side;
  qty: number;   // always positive; direction comes from side
  price: number;
  ts: number;
}

export interface Position {
  symbol: string;
  qty: number;      // signed: long > 0, short < 0
  avgCost: number;  // average entry price of the OPEN quantity
  realised: number; // cumulative realised P&L for this symbol
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
}

export interface PnlLine {
  symbol: string;
  qty: number;
  avgCost: number;
  mark: number | null;
  realised: number;
  unrealised: number;
}
`,
      },
      {
        path: 'src/config.ts',
        content: `export interface PnlConfig {
  /** Fee charged on every trade, in basis points of notional. */
  feeBps: number;
  /** Quotes older than this are considered stale and are not used for marks. */
  maxQuoteAgeMs: number;
}

export const defaultConfig: PnlConfig = {
  feeBps: 10,
  maxQuoteAgeMs: 5000,
};
`,
      },
      {
        path: 'src/trades/tradeRepository.ts',
        content: `import { Trade, Side } from '../domain/types';

export interface NewTrade {
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  ts: number;
}

/** Append-only trade log. Positions can always be rebuilt by replaying it. */
export class TradeRepository {
  private trades: Trade[] = [];
  private nextId = 1;

  append(t: NewTrade): Trade {
    const trade: Trade = { id: this.nextId++, ...t };
    this.trades.push(trade);
    return trade;
  }

  all(): Trade[] {
    return [...this.trades];
  }

  bySymbol(symbol: string): Trade[] {
    return this.trades.filter((t) => t.symbol === symbol);
  }
}
`,
      },
      {
        path: 'src/positions/positionBook.ts',
        content: `import { Position, Trade } from '../domain/types';

/**
 * Average-cost position keeping.
 * - Adding to a position re-weights avgCost.
 * - Reducing a position books realised P&L against avgCost.
 */
export class PositionBook {
  private positions = new Map<string, Position>();

  /** Applies one trade and returns the realised P&L it produced. */
  apply(trade: Trade): number {
    const signedQty = trade.side === 'BUY' ? trade.qty : -trade.qty;
    const pos = this.positions.get(trade.symbol) ?? { symbol: trade.symbol, qty: 0, avgCost: 0, realised: 0 };
    let realised = 0;

    if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signedQty)) {
      // opening or adding: re-weight the average cost
      const newQty = pos.qty + signedQty;
      pos.avgCost = (pos.avgCost * Math.abs(pos.qty) + trade.price * Math.abs(signedQty)) / Math.abs(newQty);
      pos.qty = newQty;
    } else {
      // reducing, closing or flipping
      const direction = Math.sign(pos.qty); // +1 long, -1 short
      const closingQty = Math.min(Math.abs(signedQty), Math.abs(pos.qty));
      realised = (trade.price - pos.avgCost) * closingQty * direction;
      pos.qty += signedQty;
      if (pos.qty === 0) pos.avgCost = 0;
    }

    pos.realised += realised;
    this.positions.set(trade.symbol, pos);
    return realised;
  }

  get(symbol: string): Position | undefined {
    const p = this.positions.get(symbol);
    return p ? { ...p } : undefined;
  }

  all(): Position[] {
    return [...this.positions.values()].map((p) => ({ ...p }));
  }
}
`,
      },
      {
        path: 'src/pricing/priceFeedClient.ts',
        content: `import { Quote } from '../domain/types';
import { PnlConfig } from '../config';

export interface QuoteSource {
  latest(symbol: string): Quote | undefined;
}

/** In-memory source used by tests and the demo. Production wires a socket-backed source. */
export class StaticQuoteSource implements QuoteSource {
  private quotes = new Map<string, Quote>();

  push(q: Quote): void {
    this.quotes.set(q.symbol, q);
  }

  latest(symbol: string): Quote | undefined {
    return this.quotes.get(symbol);
  }
}

export class PriceFeedClient {
  constructor(private source: QuoteSource, private cfg: PnlConfig, private now: () => number) {}

  /** Mid price, or null when there is no quote or the quote is stale. */
  mark(symbol: string): number | null {
    const q = this.source.latest(symbol);
    if (!q) return null;
    if (this.now() - q.ts > this.cfg.maxQuoteAgeMs) return null;
    return (q.bid + q.ask) / 2;
  }
}
`,
      },
      {
        path: 'src/pnl/pnlService.ts',
        content: `import { PositionBook } from '../positions/positionBook';
import { PriceFeedClient } from '../pricing/priceFeedClient';
import { TradeRepository } from '../trades/tradeRepository';
import { PnlConfig } from '../config';
import { PnlLine } from '../domain/types';

export interface PnlSummary {
  lines: PnlLine[];
  realised: number;
  unrealised: number;
  fees: number;
  net: number;
  staleSymbols: string[];
}

export class PnlService {
  constructor(
    private book: PositionBook,
    private feed: PriceFeedClient,
    private trades: TradeRepository,
    private cfg: PnlConfig,
  ) {}

  summary(): PnlSummary {
    const lines: PnlLine[] = [];
    const staleSymbols: string[] = [];
    for (const p of this.book.all()) {
      const mark = this.feed.mark(p.symbol);
      let unrealised = 0;
      if (p.qty !== 0) {
        if (mark === null) staleSymbols.push(p.symbol);
        else unrealised = (mark - p.avgCost) * p.qty;
      }
      lines.push({ symbol: p.symbol, qty: p.qty, avgCost: p.avgCost, mark, realised: p.realised, unrealised });
    }
    const realised = lines.reduce((s, l) => s + l.realised, 0);
    const unrealised = lines.reduce((s, l) => s + l.unrealised, 0);
    const fees = this.trades.all().reduce((s, t) => s + (t.price * t.qty * this.cfg.feeBps) / 10000, 0);
    return { lines, realised, unrealised, fees, net: realised + unrealised - fees, staleSymbols };
  }
}
`,
      },
      {
        path: 'src/api/portfolioController.ts',
        content: `import { TradeRepository } from '../trades/tradeRepository';
import { PositionBook } from '../positions/positionBook';
import { PnlService } from '../pnl/pnlService';

type Res = { status: number; body: any };

export class PortfolioController {
  constructor(
    private trades: TradeRepository,
    private book: PositionBook,
    private pnl: PnlService,
    private now: () => number,
  ) {}

  postTrade(body: any): Res {
    if (!body || typeof body.symbol !== 'string') return { status: 400, body: { error: 'symbol required' } };
    if (body.side !== 'BUY' && body.side !== 'SELL') return { status: 400, body: { error: 'side must be BUY or SELL' } };
    if (!(body.qty > 0) || !(body.price > 0)) return { status: 400, body: { error: 'qty and price must be positive' } };
    const trade = this.trades.append({ symbol: body.symbol, side: body.side, qty: body.qty, price: body.price, ts: this.now() });
    const realised = this.book.apply(trade);
    return { status: 201, body: { tradeId: trade.id, realised } };
  }

  getPnl(): Res {
    return { status: 200, body: this.pnl.summary() };
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { defaultConfig, PnlConfig } from './config';
import { TradeRepository } from './trades/tradeRepository';
import { PositionBook } from './positions/positionBook';
import { PriceFeedClient, StaticQuoteSource } from './pricing/priceFeedClient';
import { PnlService } from './pnl/pnlService';
import { PortfolioController } from './api/portfolioController';

/** Composition root: the only place that knows about concrete classes. */
export function buildApp(opts: { cfg?: PnlConfig; now?: () => number } = {}) {
  const cfg = opts.cfg ?? defaultConfig;
  const now = opts.now ?? (() => Date.now());
  const quotes = new StaticQuoteSource();
  const trades = new TradeRepository();
  const book = new PositionBook();
  const feed = new PriceFeedClient(quotes, cfg, now);
  const pnl = new PnlService(book, feed, trades, cfg);
  const controller = new PortfolioController(trades, book, pnl, now);
  return { controller, quotes, book, trades };
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { buildApp } from './app';

let clock = 1000;
const { controller, quotes } = buildApp({ now: () => clock });

controller.postTrade({ symbol: 'ACME', side: 'BUY', qty: 100, price: 10 });
controller.postTrade({ symbol: 'ACME', side: 'BUY', qty: 100, price: 12 });
const r1 = controller.postTrade({ symbol: 'ACME', side: 'SELL', qty: 150, price: 13 });
console.log('ACME realised ' + r1.body.realised);

controller.postTrade({ symbol: 'ZETA', side: 'SELL', qty: 10, price: 50 });
const r2 = controller.postTrade({ symbol: 'ZETA', side: 'BUY', qty: 30, price: 40 });
console.log('ZETA realised ' + r2.body.realised);

quotes.push({ symbol: 'ACME', bid: 13.5, ask: 14.5, ts: 1000 });
quotes.push({ symbol: 'ZETA', bid: 44, ask: 46, ts: 1000 });
clock = 3000;

for (const line of controller.getPnl().body.lines) {
  console.log(line.symbol + ' qty=' + line.qty + ' avg=' + line.avgCost + ' unrealised=' + line.unrealised);
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Who owns what?',
        prompt:
          'Before touching anything, map the modules. Select **all** statements that are true about this codebase.',
        options: [
          'Realised P&L is computed in `PositionBook.apply`, not in `PnlService`',
          '`PnlService` reads the trade log directly to compute fees',
          '`PriceFeedClient` returns the last traded price when a quote is stale',
          '`app.ts` is the only file that constructs concrete classes; other classes receive collaborators through their constructors',
          'Unrealised P&L for a short position needs a special case because `qty` is negative',
        ],
        correct: [0, 1, 3],
        hints: [
          'Search for the word `realised`: where is it assigned rather than just summed?',
          'Open `priceFeedClient.ts`: what does `mark()` return for an old quote?',
        ],
        explanation:
          '`PositionBook.apply` is the only place that *computes* realised P&L; `PnlService` merely sums `p.realised`. Fees are computed by `PnlService` from `TradeRepository.all()`. A stale quote makes `mark()` return `null`, and the service lists the symbol in `staleSymbols` with zero unrealised. There is no last-trade fallback. `app.ts` is the composition root (constructor injection everywhere else). `(mark - avgCost) * qty` is already correct for shorts because a negative qty flips the sign, as the README notes.',
        timeLimitSec: 240,
        focusFile: 'README.md',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a trade and a P&L read',
        prompt:
          'A client calls `controller.postTrade(...)` with a valid SELL, then calls `controller.getPnl()`. Put the steps in execution order.',
        items: [
          'PortfolioController.postTrade validates symbol, side, qty and price',
          'TradeRepository.append assigns the trade id and stores it',
          'PositionBook.apply updates qty/avgCost and returns realised P&L',
          'Controller responds 201 with tradeId and realised',
          'PnlService.summary iterates PositionBook.all()',
          'PriceFeedClient.mark reads StaticQuoteSource.latest and checks quote age',
          'PnlService sums fees over TradeRepository.all()',
          'Controller responds 200 with the summary',
        ],
        hints: [
          'Start in `api/portfolioController.ts` and follow each injected collaborator.',
          'Inside `summary()`, are fees computed inside or after the positions loop?',
        ],
        explanation:
          'The write path is controller → repository (persist first, so the log stays the source of truth) → book. The read path is controller → `PnlService.summary`, which marks each position through the price feed, then computes fees from the full trade log after the loop.',
        timeLimitSec: 300,
        focusFile: 'src/api/portfolioController.ts',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce the desk report',
        prompt: 'Run `src/main.ts` in your head. What does it print?',
        entry: 'src/main.ts',
        answer:
          'ACME realised 300\nZETA realised 100\nACME qty=50 avg=11 unrealised=150\nZETA qty=20 avg=50 unrealised=-100',
        options: [
          'ACME realised 300\nZETA realised 100\nACME qty=50 avg=11 unrealised=150\nZETA qty=20 avg=50 unrealised=-100',
          'ACME realised 300\nZETA realised 100\nACME qty=50 avg=11 unrealised=150\nZETA qty=20 avg=40 unrealised=100',
          'ACME realised 450\nZETA realised -100\nACME qty=50 avg=10 unrealised=200\nZETA qty=20 avg=50 unrealised=-100',
          'ACME realised 300\nZETA realised -100\nACME qty=50 avg=11 unrealised=150\nZETA qty=20 avg=50 unrealised=100',
        ],
        hints: [
          'ACME: after two buys the average cost is (100×10 + 100×12) / 200.',
          'ZETA: the short of 10 @ 50 is covered by a BUY of 30. Only 10 of those 30 close the short. What happens to `avgCost` for the remaining 20?',
          'Quotes were stamped at 1000 and the clock is 3000. Is that stale with `maxQuoteAgeMs = 5000`?',
        ],
        explanation:
          'ACME: avgCost = 11, selling 150 @ 13 realises (13 − 11) × 150 = 300, leaving 50 @ 11; mark = 14, unrealised = 3 × 50 = 150. ZETA: short 10 @ 50; the buy of 30 @ 40 closes 10 for (40 − 50) × 10 × (−1) = +100 and leaves qty = +20. The `else` branch only resets avgCost when qty hits **exactly** zero, so the new long keeps the *short\'s* entry price of 50. Its unrealised is (45 − 50) × 20 = −100 when it should be (45 − 40) × 20 = +100. That is the phantom loss the desk sees.',
        timeLimitSec: 360,
        focusFile: 'src/main.ts',
      },
      {
        id: 's4',
        kind: 'find-bug',
        title: 'Pin the root cause',
        prompt: 'Click the line responsible for the wrong P&L after a flip, then choose the root cause.',
        file: 'src/positions/positionBook.ts',
        lines: [28],
        options: [
          'After a flip, avgCost keeps the closed side\'s entry price instead of the flip trade\'s price',
          '`realised` should not be multiplied by `direction`',
          '`closingQty` should use `Math.max`, otherwise the flip quantity is lost',
          '`Math.sign(0)` makes every opening trade fall into the reducing branch',
        ],
        correct: 0,
        hints: [
          'Which branch handles a BUY of 30 against a short of 10?',
          'In that branch, which statement decides the avgCost of whatever is left open?',
        ],
        explanation:
          'Line 28 only handles the "closed to flat" case. When `pos.qty` changes sign, the residual quantity is a brand-new position opened at `trade.price`, so avgCost must be reset to the trade price. `direction` is required for shorts, `Math.min` is right for the closed portion, and `pos.qty === 0` is checked first so openings go through the first branch.',
        timeLimitSec: 240,
        focusFile: 'src/positions/positionBook.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix position flips',
        prompt:
          'Fix `PositionBook.apply` so that a trade which flips a position opens the new side at the trade price. Realised P&L for the closed portion must be unchanged, and partial reductions must keep the original avgCost.',
        editable: ['src/positions/positionBook.ts'],
        tests: [
          {
            path: 'tests/positionBook.test.ts',
            content: `import { PositionBook } from '../src/positions/positionBook';
import { buildApp } from '../src/app';

function tr(id: number, symbol: string, side: 'BUY' | 'SELL', qty: number, price: number) {
  return { id, symbol, side, qty, price, ts: 0 };
}

test('long -> short flip opens the short at the trade price', () => {
  const b = new PositionBook();
  b.apply(tr(1, 'X', 'BUY', 50, 10));
  expect(b.apply(tr(2, 'X', 'SELL', 80, 12))).toBe(100);
  const p = b.get('X')!;
  expect(p.qty).toBe(-30);
  expect(p.avgCost).toBe(12);
  expect(p.realised).toBe(100);
});

test('short -> long flip opens the long at the trade price', () => {
  const b = new PositionBook();
  b.apply(tr(1, 'Z', 'SELL', 10, 50));
  expect(b.apply(tr(2, 'Z', 'BUY', 30, 40))).toBe(100);
  const p = b.get('Z')!;
  expect(p.qty).toBe(20);
  expect(p.avgCost).toBe(40);
});

test('partial reduction keeps avgCost', () => {
  const b = new PositionBook();
  b.apply(tr(1, 'A', 'BUY', 100, 10));
  expect(b.apply(tr(2, 'A', 'SELL', 40, 15))).toBe(200);
  expect(b.get('A')!.qty).toBe(60);
  expect(b.get('A')!.avgCost).toBe(10);
});

test('full close resets avgCost and re-open uses new price', () => {
  const b = new PositionBook();
  b.apply(tr(1, 'A', 'SELL', 10, 20));
  expect(b.apply(tr(2, 'A', 'BUY', 10, 18))).toBe(20);
  expect(b.get('A')!.avgCost).toBe(0);
  b.apply(tr(3, 'A', 'BUY', 5, 30));
  expect(b.get('A')!.avgCost).toBe(30);
});

test('end to end: unrealised after a flip is marked against the flip price', () => {
  let clock = 0;
  const app = buildApp({ now: () => clock });
  app.controller.postTrade({ symbol: 'Z', side: 'SELL', qty: 10, price: 50 });
  app.controller.postTrade({ symbol: 'Z', side: 'BUY', qty: 30, price: 40 });
  app.quotes.push({ symbol: 'Z', bid: 44, ask: 46, ts: 0 });
  const s = app.controller.getPnl().body;
  expect(s.realised).toBe(100);
  expect(s.unrealised).toBe(100);
});
`,
          },
        ],
        solution: {
          'src/positions/positionBook.ts': `import { Position, Trade } from '../domain/types';

/**
 * Average-cost position keeping.
 * - Adding to a position re-weights avgCost.
 * - Reducing a position books realised P&L against avgCost.
 */
export class PositionBook {
  private positions = new Map<string, Position>();

  /** Applies one trade and returns the realised P&L it produced. */
  apply(trade: Trade): number {
    const signedQty = trade.side === 'BUY' ? trade.qty : -trade.qty;
    const pos = this.positions.get(trade.symbol) ?? { symbol: trade.symbol, qty: 0, avgCost: 0, realised: 0 };
    let realised = 0;

    if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signedQty)) {
      // opening or adding: re-weight the average cost
      const newQty = pos.qty + signedQty;
      pos.avgCost = (pos.avgCost * Math.abs(pos.qty) + trade.price * Math.abs(signedQty)) / Math.abs(newQty);
      pos.qty = newQty;
    } else {
      // reducing, closing or flipping
      const direction = Math.sign(pos.qty); // +1 long, -1 short
      const closingQty = Math.min(Math.abs(signedQty), Math.abs(pos.qty));
      realised = (trade.price - pos.avgCost) * closingQty * direction;
      pos.qty += signedQty;
      if (pos.qty === 0) pos.avgCost = 0;
      else if (Math.sign(pos.qty) !== direction) pos.avgCost = trade.price; // flipped: new side opened at trade price
    }

    pos.realised += realised;
    this.positions.set(trade.symbol, pos);
    return realised;
  }

  get(symbol: string): Position | undefined {
    const p = this.positions.get(symbol);
    return p ? { ...p } : undefined;
  }

  all(): Position[] {
    return [...this.positions.values()].map((p) => ({ ...p }));
  }
}
`,
        },
        hints: [
          'After `pos.qty += signedQty`, compare the new sign of `pos.qty` with `direction`.',
          'If the sign changed, the leftover quantity was opened by this very trade.',
        ],
        explanation:
          'Three outcomes exist after a reducing trade: still on the same side (keep avgCost), exactly flat (reset to 0), or flipped (the residual was opened at `trade.price`). The original code handled only the first two. A fix in `PnlService` would be wrong: the book is the owner of avgCost and other readers (risk, statements) would still see the stale value.',
        timeLimitSec: 600,
        focusFile: 'src/positions/positionBook.ts',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Webhook dispatcher (TypeScript)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-ts-webhook-dispatcher',
    title: 'Webhook Dispatcher: One Retry Too Many',
    level: 3,
    rating: 1860,
    lang: 'typescript',
    domain: 'webhooks',
    companies: ['stripe', 'atlassian', 'canva', 'amazon'],
    tags: ['outbox', 'retries', 'backoff', 'observer', 'off-by-one'],
    summary: 'Outbox → signer → HTTP client with exponential backoff and metric observers. A partner says we hammer their endpoint once more than the docs promise.',
    context:
      'You are on the integrations team. Our public docs promise that a failing webhook is attempted **at most `maxAttempts` times** before it is marked dead. A partner with a broken endpoint shared logs showing one extra attempt. Learn the dispatcher, reproduce, and fix it without breaking the other delivery rules.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# webhook-dispatcher

Delivers domain events to partner endpoints using the transactional outbox pattern.

## Flow

1. publisher.ts fans an event out to every subscription interested in its type and
   enqueues one outbox row per (event, endpoint). Row id = eventId + "|" + endpoint, so
   re-publishing the same event is a no-op.
2. dispatcher.ts tick(now) loads due PENDING rows, signs the payload, POSTs it and
   decides the row's fate:
   - 2xx                         -> DELIVERED
   - 4xx other than 429          -> DEAD (permanent client error, retrying will not help)
   - 429, 5xx or network error   -> retry with exponential backoff, until maxAttempts
3. Observers (metrics, audit log) receive every delivery event.

## Guarantees (public docs)

- At most maxAttempts delivery attempts per row (the first attempt counts).
- Backoff before attempt n+1 is baseDelayMs * 2^(n-1), capped at maxDelayMs.
- Every request carries x-webhook-signature: t=<ts>,v1=<sig>.
`,
      },
      {
        path: 'src/config.ts',
        content: `export interface DispatcherConfig {
  /** Total delivery attempts per row, INCLUDING the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Max rows processed per tick. */
  batchSize: number;
  signingSecret: string;
}

export const defaultConfig: DispatcherConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  batchSize: 10,
  signingSecret: 'whsec_demo',
};
`,
      },
      {
        path: 'src/outbox/outboxRepository.ts',
        content: `export type OutboxStatus = 'PENDING' | 'DELIVERED' | 'DEAD';

export interface OutboxRow {
  id: string;
  endpoint: string;
  eventType: string;
  payload: string;
  attempts: number;
  status: OutboxStatus;
  nextAttemptAt: number;
  lastError?: string;
}

export class OutboxRepository {
  private rows = new Map<string, OutboxRow>();

  /** Idempotent: enqueueing an existing id returns the existing row unchanged. */
  enqueue(id: string, endpoint: string, eventType: string, payload: string, now: number): OutboxRow {
    const existing = this.rows.get(id);
    if (existing) return existing;
    const row: OutboxRow = { id, endpoint, eventType, payload, attempts: 0, status: 'PENDING', nextAttemptAt: now };
    this.rows.set(id, row);
    return row;
  }

  due(now: number, limit: number): OutboxRow[] {
    return [...this.rows.values()]
      .filter((r) => r.status === 'PENDING' && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
      .slice(0, limit);
  }

  save(row: OutboxRow): void {
    this.rows.set(row.id, row);
  }

  get(id: string): OutboxRow | undefined {
    return this.rows.get(id);
  }
}
`,
      },
      {
        path: 'src/subscriptions.ts',
        content: `export interface Subscription {
  endpoint: string;
  eventTypes: string[];
}

export class SubscriptionRegistry {
  private subs: Subscription[] = [];

  add(endpoint: string, eventTypes: string[]): void {
    this.subs.push({ endpoint, eventTypes });
  }

  forEvent(eventType: string): Subscription[] {
    return this.subs.filter((s) => s.eventTypes.includes(eventType) || s.eventTypes.includes('*'));
  }
}
`,
      },
      {
        path: 'src/publisher.ts',
        content: `import { OutboxRepository } from './outbox/outboxRepository';
import { SubscriptionRegistry } from './subscriptions';

export interface DomainEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Fan-out: one outbox row per interested endpoint. Returns the number of rows created or found. */
export function publish(outbox: OutboxRepository, subs: SubscriptionRegistry, event: DomainEvent, now: number): number {
  const payload = JSON.stringify({ id: event.id, type: event.type, data: event.data });
  const targets = subs.forEvent(event.type);
  for (const s of targets) {
    outbox.enqueue(event.id + '|' + s.endpoint, s.endpoint, event.type, payload, now);
  }
  return targets.length;
}
`,
      },
      {
        path: 'src/signing/signer.ts',
        content: `/** Toy keyed hash (FNV-1a). Production uses HMAC-SHA256; the header format is identical. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class Signer {
  constructor(private secret: string) {}

  /** Header value: t=<timestamp>,v1=<signature of "timestamp.body"> */
  sign(timestamp: number, body: string): string {
    return 't=' + timestamp + ',v1=' + fnv1a(this.secret + ':' + timestamp + '.' + body);
  }

  /** Used by our SDK on the receiving side. */
  verify(header: string, body: string, now: number, toleranceMs: number): boolean {
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
    const ts = Number(parts.t);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceMs) return false;
    return this.sign(ts, body) === header;
  }
}
`,
      },
      {
        path: 'src/delivery/httpClient.ts',
        content: `export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
}

export interface HttpClient {
  post(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * Scripted client for tests and demos. Each URL replays a list of outcomes;
 * the last outcome repeats forever. 'throw' simulates a network error.
 */
export class ScriptedHttpClient implements HttpClient {
  public calls: HttpRequest[] = [];

  constructor(private script: Record<string, Array<number | 'throw'>>) {}

  async post(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push(req);
    const steps = this.script[req.url] ?? [200];
    const n = this.calls.filter((c) => c.url === req.url).length;
    const step = steps[Math.min(n - 1, steps.length - 1)];
    if (step === 'throw') throw new Error('ECONNRESET');
    return { status: step, headers: {} };
  }
}
`,
      },
      {
        path: 'src/delivery/backoff.ts',
        content: `import { DispatcherConfig } from '../config';

/** Delay before the next attempt, given how many attempts have already been made (>= 1). */
export function backoffDelay(attemptsMade: number, cfg: DispatcherConfig): number {
  const exp = cfg.baseDelayMs * Math.pow(2, attemptsMade - 1);
  return Math.min(exp, cfg.maxDelayMs);
}

/** 429 and 5xx are transient. Other 4xx mean the request itself is wrong. */
export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}
`,
      },
      {
        path: 'src/observers.ts',
        content: `export type DeliveryEvent =
  | { type: 'attempt'; id: string; attempt: number }
  | { type: 'delivered'; id: string; attempts: number }
  | { type: 'retry_scheduled'; id: string; at: number }
  | { type: 'dead'; id: string; reason: string };

export interface DeliveryObserver {
  on(e: DeliveryEvent): void;
}

export class MetricsObserver implements DeliveryObserver {
  private counters: Record<string, number> = {};

  on(e: DeliveryEvent): void {
    this.counters[e.type] = (this.counters[e.type] ?? 0) + 1;
  }

  get(name: DeliveryEvent['type']): number {
    return this.counters[name] ?? 0;
  }
}

export class AuditLogObserver implements DeliveryObserver {
  public lines: string[] = [];

  on(e: DeliveryEvent): void {
    this.lines.push(e.id + ' ' + e.type);
  }
}
`,
      },
      {
        path: 'src/dispatcher.ts',
        content: `import { OutboxRepository, OutboxRow } from './outbox/outboxRepository';
import { Signer } from './signing/signer';
import { HttpClient } from './delivery/httpClient';
import { backoffDelay, isRetryable } from './delivery/backoff';
import { DispatcherConfig } from './config';
import { DeliveryEvent, DeliveryObserver } from './observers';

export class WebhookDispatcher {
  constructor(
    private outbox: OutboxRepository,
    private signer: Signer,
    private http: HttpClient,
    private cfg: DispatcherConfig,
    private observers: DeliveryObserver[] = [],
  ) {}

  /** Attempts every due row once. Returns how many rows were processed. */
  async tick(now: number): Promise<number> {
    const due = this.outbox.due(now, this.cfg.batchSize);
    for (const row of due) {
      await this.deliver(row, now);
    }
    return due.length;
  }

  private emit(e: DeliveryEvent): void {
    for (const o of this.observers) o.on(e);
  }

  private async deliver(row: OutboxRow, now: number): Promise<void> {
    const attempt = row.attempts + 1;
    this.emit({ type: 'attempt', id: row.id, attempt });

    let status = 0; // 0 = network error
    let error = '';
    try {
      const res = await this.http.post({
        url: row.endpoint,
        headers: {
          'content-type': 'application/json',
          'x-webhook-id': row.id,
          'x-webhook-signature': this.signer.sign(now, row.payload),
        },
        body: row.payload,
      });
      status = res.status;
    } catch (e) {
      error = (e as Error).message;
    }
    row.attempts = attempt;

    if (status >= 200 && status < 300) {
      row.status = 'DELIVERED';
      this.emit({ type: 'delivered', id: row.id, attempts: row.attempts });
    } else if (status !== 0 && !isRetryable(status)) {
      row.status = 'DEAD';
      row.lastError = 'HTTP ' + status;
      this.emit({ type: 'dead', id: row.id, reason: row.lastError });
    } else if (row.attempts > this.cfg.maxAttempts) {
      row.status = 'DEAD';
      row.lastError = 'gave up: ' + (error || 'HTTP ' + status);
      this.emit({ type: 'dead', id: row.id, reason: row.lastError });
    } else {
      row.nextAttemptAt = now + backoffDelay(row.attempts, this.cfg);
      row.lastError = error || 'HTTP ' + status;
      this.emit({ type: 'retry_scheduled', id: row.id, at: row.nextAttemptAt });
    }
    this.outbox.save(row);
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { DispatcherConfig, defaultConfig } from './config';
import { OutboxRepository } from './outbox/outboxRepository';
import { SubscriptionRegistry } from './subscriptions';
import { Signer } from './signing/signer';
import { HttpClient } from './delivery/httpClient';
import { WebhookDispatcher } from './dispatcher';
import { MetricsObserver, AuditLogObserver } from './observers';

export function buildApp(http: HttpClient, cfg: DispatcherConfig = defaultConfig) {
  const outbox = new OutboxRepository();
  const subs = new SubscriptionRegistry();
  const metrics = new MetricsObserver();
  const audit = new AuditLogObserver();
  const dispatcher = new WebhookDispatcher(outbox, new Signer(cfg.signingSecret), http, cfg, [metrics, audit]);
  return { outbox, subs, metrics, audit, dispatcher };
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { buildApp } from './app';
import { defaultConfig } from './config';
import { publish } from './publisher';
import { ScriptedHttpClient } from './delivery/httpClient';

const http = new ScriptedHttpClient({
  'https://a.example/hook': [500, 500, 200],
  'https://b.example/hook': [404],
  'https://c.example/hook': [503],
});
const app = buildApp(http, { ...defaultConfig, maxAttempts: 3, baseDelayMs: 1000 });
app.subs.add('https://a.example/hook', ['order.paid']);
app.subs.add('https://b.example/hook', ['order.paid']);
app.subs.add('https://c.example/hook', ['*']);

publish(app.outbox, app.subs, { id: 'evt_1', type: 'order.paid', data: { total: 42 } }, 0);

async function run() {
  for (const t of [0, 1000, 3000, 7000, 15000]) {
    const n = await app.dispatcher.tick(t);
    console.log('t=' + t + ' processed=' + n);
  }
  const m = app.metrics;
  console.log('attempts=' + m.get('attempt') + ' delivered=' + m.get('delivered') + ' retries=' + m.get('retry_scheduled') + ' dead=' + m.get('dead'));
}

run();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation',
        prompt: 'Select **all** true statements about how this service is put together.',
        options: [
          'Which endpoints receive an event is decided in `publisher.ts` via `SubscriptionRegistry.forEvent`, before any HTTP call happens',
          'Re-publishing the same event id creates a second outbox row per endpoint',
          'Metrics are updated by the dispatcher calling `MetricsObserver.on` through the injected observers list',
          'A network error (the client throws) is treated as a permanent failure and the row goes DEAD immediately',
          'The signature header is computed per attempt, using the tick time `now`',
        ],
        correct: [0, 2, 4],
        hints: [
          'Look at how the outbox row id is built in `publisher.ts` and what `enqueue` does with an existing id.',
          'In `deliver`, what is `status` when the client throws, and which branch does that take?',
        ],
        explanation:
          'Fan-out is resolved at publish time. The row id is `eventId|endpoint` and `enqueue` returns the existing row, so republishing is idempotent. Observers are injected in `app.ts` and called through `emit`. On a network error `status` stays 0; the `status !== 0 && ...` guard skips the permanent-failure branch, so it is retried. `signer.sign(now, ...)` runs inside `deliver`, so each attempt gets a fresh timestamp. That matters because receivers reject old signatures.',
        timeLimitSec: 300,
        focusFile: 'README.md',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Replay the partner incident',
        prompt:
          'Endpoint **a** fails twice then succeeds, **b** returns 404, **c** always returns 503. `maxAttempts` is 3 and `baseDelayMs` is 1000. What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer:
          't=0 processed=3\nt=1000 processed=2\nt=3000 processed=2\nt=7000 processed=1\nt=15000 processed=0\nattempts=8 delivered=1 retries=5 dead=2',
        options: [
          't=0 processed=3\nt=1000 processed=2\nt=3000 processed=2\nt=7000 processed=0\nt=15000 processed=0\nattempts=7 delivered=1 retries=4 dead=2',
          't=0 processed=3\nt=1000 processed=2\nt=3000 processed=2\nt=7000 processed=1\nt=15000 processed=0\nattempts=8 delivered=1 retries=5 dead=2',
          't=0 processed=3\nt=1000 processed=3\nt=3000 processed=3\nt=7000 processed=1\nt=15000 processed=0\nattempts=10 delivered=1 retries=7 dead=2',
          't=0 processed=3\nt=1000 processed=2\nt=3000 processed=1\nt=7000 processed=1\nt=15000 processed=1\nattempts=8 delivered=1 retries=6 dead=1',
        ],
        hints: [
          'b returns 404. Which branch does that take, and is it ever due again?',
          'Backoff after attempt n is 1000 × 2^(n−1): so 1000, 2000, 4000. When is c due after each failure?',
          'For c after its third attempt: is `3 > 3`?',
        ],
        explanation:
          't=0: all three rows attempted; b is DEAD (404), a and c retry at 1000. t=1000: a and c fail again, next at 3000. t=3000: a succeeds; c has now made 3 attempts but `row.attempts > maxAttempts` is `3 > 3` = false, so it is scheduled again for 7000. t=7000: c\'s **fourth** attempt, and only now `4 > 3` kills it. Totals: 8 attempts, 1 delivered, 5 retries scheduled, 2 dead. The documented behaviour gives the first option.',
        timeLimitSec: 420,
        focusFile: 'src/main.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Find the off-by-one',
        prompt: 'Click the line that lets a row exceed `maxAttempts`, then pick the root cause.',
        file: 'src/dispatcher.ts',
        lines: [59],
        options: [
          '`row.attempts` already includes the current attempt, so the give-up check must be `>=`, not `>`',
          '`backoffDelay` should be called with `row.attempts - 1`',
          '`attempt` should be computed after the HTTP call',
          '`isRetryable` should treat 404 as retryable',
        ],
        correct: 0,
        hints: [
          'At the point of the check, has `row.attempts` been incremented for the attempt that just failed?',
        ],
        explanation:
          '`row.attempts = attempt` runs before the decision, so after the 3rd failure `row.attempts === 3`. The config comment says `maxAttempts` includes the first attempt, so a 3rd failure must be terminal: `row.attempts >= this.cfg.maxAttempts`. Changing the backoff exponent would alter delays, not the count.',
        timeLimitSec: 240,
        focusFile: 'src/dispatcher.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Retry-After support',
        prompt: 'A teammate asked the assistant to honour `Retry-After` on 429 responses. Review the proposal.',
        persona: 'api-dreamer',
        request: 'When a partner returns 429 with a Retry-After header (seconds), wait at least that long before the next attempt.',
        aiReply: `Sure! The HTTP client already parses this for you, so it's a two-line change in \`dispatcher.ts\`:

\`\`\`ts
      const res = await this.http.post({ ... });
      status = res.status;
      retryAfterMs = res.retryAfterMs ?? 0;   // parsed by HttpClient
...
    } else {
      const delay = Math.max(backoffDelay(row.attempts, this.cfg), retryAfterMs);
      row.nextAttemptAt = now + delay;
\`\`\`

\`HttpClient.post\` normalises \`Retry-After\` into \`retryAfterMs\`, so no header parsing is needed.`,
        options: [
          'Accept: taking the max of backoff and Retry-After is exactly right',
          'Reject: `HttpResponse` has no `retryAfterMs`; the value must be read from `res.headers[\'retry-after\']` and converted from seconds to ms',
          'Reject: 429 is not retryable in this codebase, so the branch is never reached',
          'Reject: Retry-After must replace backoff entirely, never be combined with it',
        ],
        correct: 1,
        hints: ['Open `delivery/httpClient.ts`. What fields does `HttpResponse` actually have?'],
        explanation:
          'The idea (max of exponential backoff and server hint) is sound, but the assistant invented `res.retryAfterMs`. `HttpResponse` only has `status` and `headers`, so in TypeScript this is a compile error, and in plain JS it would silently be `undefined ?? 0`. You need something like `Number(res.headers[\'retry-after\']) * 1000`, guarding against NaN. `isRetryable` does include 429.',
        timeLimitSec: 240,
        focusFile: 'src/delivery/httpClient.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Honour maxAttempts',
        prompt:
          'Fix the dispatcher so a row is attempted **at most `maxAttempts` times in total** and then marked DEAD. Keep the other rules intact: 2xx → DELIVERED, non-429 4xx → DEAD immediately, network errors retry.',
        editable: ['src/dispatcher.ts'],
        tests: [
          {
            path: 'tests/dispatcher.test.ts',
            content: `import { buildApp } from '../src/app';
import { defaultConfig } from '../src/config';
import { publish } from '../src/publisher';
import { ScriptedHttpClient } from '../src/delivery/httpClient';

async function drive(script: Record<string, Array<number | 'throw'>>, maxAttempts: number) {
  const http = new ScriptedHttpClient(script);
  const app = buildApp(http, { ...defaultConfig, maxAttempts, baseDelayMs: 10, maxDelayMs: 1000 });
  for (const url of Object.keys(script)) app.subs.add(url, ['*']);
  publish(app.outbox, app.subs, { id: 'e1', type: 'x', data: {} }, 0);
  for (let t = 0; t <= 100000; t += 10) await app.dispatcher.tick(t);
  return { http, app };
}

test('always-failing endpoint is attempted exactly maxAttempts times', async () => {
  const { http, app } = await drive({ 'u:c': [503] }, 3);
  expect(http.calls).toHaveLength(3);
  expect(app.outbox.get('e1|u:c')!.status).toBe('DEAD');
  expect(app.metrics.get('retry_scheduled')).toBe(2);
});

test('maxAttempts = 1 means no retries', async () => {
  const { http, app } = await drive({ 'u:n': ['throw'] }, 1);
  expect(http.calls).toHaveLength(1);
  expect(app.outbox.get('e1|u:n')!.status).toBe('DEAD');
});

test('success on the last allowed attempt is delivered', async () => {
  const { http, app } = await drive({ 'u:a': [500, 'throw', 200] }, 3);
  expect(http.calls).toHaveLength(3);
  expect(app.outbox.get('e1|u:a')!.status).toBe('DELIVERED');
});

test('404 is dead after a single attempt', async () => {
  const { http, app } = await drive({ 'u:b': [404, 200] }, 5);
  expect(http.calls).toHaveLength(1);
  expect(app.outbox.get('e1|u:b')!.lastError).toBe('HTTP 404');
});

test('429 is retried', async () => {
  const { http, app } = await drive({ 'u:r': [429, 200] }, 5);
  expect(http.calls).toHaveLength(2);
  expect(app.outbox.get('e1|u:r')!.status).toBe('DELIVERED');
});
`,
          },
        ],
        solution: {
          'src/dispatcher.ts': `import { OutboxRepository, OutboxRow } from './outbox/outboxRepository';
import { Signer } from './signing/signer';
import { HttpClient } from './delivery/httpClient';
import { backoffDelay, isRetryable } from './delivery/backoff';
import { DispatcherConfig } from './config';
import { DeliveryEvent, DeliveryObserver } from './observers';

export class WebhookDispatcher {
  constructor(
    private outbox: OutboxRepository,
    private signer: Signer,
    private http: HttpClient,
    private cfg: DispatcherConfig,
    private observers: DeliveryObserver[] = [],
  ) {}

  /** Attempts every due row once. Returns how many rows were processed. */
  async tick(now: number): Promise<number> {
    const due = this.outbox.due(now, this.cfg.batchSize);
    for (const row of due) {
      await this.deliver(row, now);
    }
    return due.length;
  }

  private emit(e: DeliveryEvent): void {
    for (const o of this.observers) o.on(e);
  }

  private async deliver(row: OutboxRow, now: number): Promise<void> {
    const attempt = row.attempts + 1;
    this.emit({ type: 'attempt', id: row.id, attempt });

    let status = 0; // 0 = network error
    let error = '';
    try {
      const res = await this.http.post({
        url: row.endpoint,
        headers: {
          'content-type': 'application/json',
          'x-webhook-id': row.id,
          'x-webhook-signature': this.signer.sign(now, row.payload),
        },
        body: row.payload,
      });
      status = res.status;
    } catch (e) {
      error = (e as Error).message;
    }
    row.attempts = attempt;

    if (status >= 200 && status < 300) {
      row.status = 'DELIVERED';
      this.emit({ type: 'delivered', id: row.id, attempts: row.attempts });
    } else if (status !== 0 && !isRetryable(status)) {
      row.status = 'DEAD';
      row.lastError = 'HTTP ' + status;
      this.emit({ type: 'dead', id: row.id, reason: row.lastError });
    } else if (row.attempts >= this.cfg.maxAttempts) {
      row.status = 'DEAD';
      row.lastError = 'gave up: ' + (error || 'HTTP ' + status);
      this.emit({ type: 'dead', id: row.id, reason: row.lastError });
    } else {
      row.nextAttemptAt = now + backoffDelay(row.attempts, this.cfg);
      row.lastError = error || 'HTTP ' + status;
      this.emit({ type: 'retry_scheduled', id: row.id, at: row.nextAttemptAt });
    }
    this.outbox.save(row);
  }
}
`,
        },
        hints: [
          'After `row.attempts = attempt`, how many attempts have been made in total?',
          'One character is enough.',
        ],
        explanation:
          'Because the counter is incremented before the decision, the terminal condition is `row.attempts >= maxAttempts`. Off-by-one errors like this hide easily when the counter is updated in one place and checked in another. Write the invariant down ("attempts made so far, including this one") before writing the comparison.',
        timeLimitSec: 480,
        focusFile: 'src/dispatcher.ts',
      },
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  // 3. Chat unread counts & read receipts (TypeScript)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-ts-chat-unread-receipts',
    title: 'Chat Unread Badges: The Badge That Grew Back',
    level: 3,
    rating: 1600,
    lang: 'typescript',
    domain: 'chat',
    companies: ['meta', 'atlassian', 'canva', 'microsoft'],
    tags: ['event-bus', 'observer', 'subscription-order', 'read-receipts', 'out-of-order-events'],
    summary: 'Unread counts, "Seen by" and push badges hang off one synchronous event bus. Reading on your phone, then on your laptop, brings unread messages back.',
    context:
      'You joined the messaging team. Users report that after reading a channel on their phone, opening the laptop (which was still showing older messages) makes the unread badge **jump back up**. All the read-state logic is wired through an in-process event bus. Find where the state lives before you change anything.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# chat-core

In-process core for channels, messages and read state.

## Modules

- bus/eventBus.ts: synchronous pub/sub. Handlers run in SUBSCRIPTION ORDER on the publisher's call stack.
- messages/: MessageStore (per-channel sequence numbers starting at 1) and MessageService (post).
- receipts/: ReceiptService (client says "I have read up to seq N") and ReadReceiptStore
  (the projection that remembers each user's last-read seq per channel; also powers "Seen by").
- unread/unreadService.ts: unread = messages after the user's last-read seq, not written by the user.
  Computed on demand, never cached.
- badges/badgeNotifier.ts: pushes the user's TOTAL unread count to their devices whenever it may have changed.
- app.ts: composition root. Subscription order is decided here.

## Read state rules

- A user's last-read seq per channel only ever moves FORWARD. Several devices report reads
  independently and their reports can arrive late or out of order.
- A user's own messages never count as unread for them.
`,
      },
      {
        path: 'src/bus/eventBus.ts',
        content: `export type Handler<T> = (payload: T) => void;

/** Synchronous, in-process bus. Handlers run in subscription order, on the publisher's stack. */
export class EventBus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Handler<any>[]>();

  subscribe<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const cur = this.handlers.get(type) ?? [];
      this.handlers.set(type, cur.filter((h) => h !== handler));
    };
  }

  publish<K extends keyof E>(type: K, payload: E[K]): void {
    for (const h of [...(this.handlers.get(type) ?? [])]) h(payload);
  }
}
`,
      },
      {
        path: 'src/events.ts',
        content: `export interface MessagePosted {
  channelId: string;
  seq: number;
  authorId: string;
}

export interface MessageRead {
  channelId: string;
  userId: string;
  /** The user has read everything up to and including this seq. */
  seq: number;
}

export type ChatEvents = {
  'message.posted': MessagePosted;
  'message.read': MessageRead;
};
`,
      },
      {
        path: 'src/channels/channelDirectory.ts',
        content: `export class ChannelDirectory {
  private members = new Map<string, string[]>();

  join(channelId: string, userId: string): void {
    const list = this.members.get(channelId) ?? [];
    if (!list.includes(userId)) list.push(userId);
    this.members.set(channelId, list);
  }

  isMember(channelId: string, userId: string): boolean {
    return (this.members.get(channelId) ?? []).includes(userId);
  }

  membersOf(channelId: string): string[] {
    return [...(this.members.get(channelId) ?? [])];
  }

  channelsOf(userId: string): string[] {
    return [...this.members].filter(([, m]) => m.includes(userId)).map(([c]) => c);
  }
}
`,
      },
      {
        path: 'src/messages/messageStore.ts',
        content: `export interface Message {
  channelId: string;
  seq: number;
  authorId: string;
  text: string;
}

export class MessageStore {
  private byChannel = new Map<string, Message[]>();

  append(channelId: string, authorId: string, text: string): Message {
    const list = this.byChannel.get(channelId) ?? [];
    const msg: Message = { channelId, seq: list.length + 1, authorId, text };
    list.push(msg);
    this.byChannel.set(channelId, list);
    return msg;
  }

  latestSeq(channelId: string): number {
    return (this.byChannel.get(channelId) ?? []).length;
  }

  /** Messages with seq > afterSeq that were NOT written by excludeAuthor. */
  countAfter(channelId: string, afterSeq: number, excludeAuthor: string): number {
    return (this.byChannel.get(channelId) ?? []).filter((m) => m.seq > afterSeq && m.authorId !== excludeAuthor).length;
  }
}
`,
      },
      {
        path: 'src/messages/messageService.ts',
        content: `import { MessageStore, Message } from './messageStore';
import { ChannelDirectory } from '../channels/channelDirectory';
import { EventBus } from '../bus/eventBus';
import { ChatEvents } from '../events';

export class MessageService {
  constructor(
    private store: MessageStore,
    private directory: ChannelDirectory,
    private bus: EventBus<ChatEvents>,
  ) {}

  post(channelId: string, authorId: string, text: string): Message {
    if (!this.directory.isMember(channelId, authorId)) throw new Error('not a member of ' + channelId);
    if (!text.trim()) throw new Error('empty message');
    const msg = this.store.append(channelId, authorId, text);
    this.bus.publish('message.posted', { channelId, seq: msg.seq, authorId });
    return msg;
  }
}
`,
      },
      {
        path: 'src/receipts/receiptService.ts',
        content: `import { MessageStore } from '../messages/messageStore';
import { ChannelDirectory } from '../channels/channelDirectory';
import { EventBus } from '../bus/eventBus';
import { ChatEvents } from '../events';

/** Entry point for clients reporting "I have read up to seq N". */
export class ReceiptService {
  constructor(
    private messages: MessageStore,
    private directory: ChannelDirectory,
    private bus: EventBus<ChatEvents>,
  ) {}

  markRead(userId: string, channelId: string, seq: number): void {
    if (!this.directory.isMember(channelId, userId)) throw new Error('not a member of ' + channelId);
    const upTo = Math.min(seq, this.messages.latestSeq(channelId));
    if (upTo < 1) return;
    this.bus.publish('message.read', { channelId, userId, seq: upTo });
  }
}
`,
      },
      {
        path: 'src/receipts/readReceiptStore.ts',
        content: `import { EventBus } from '../bus/eventBus';
import { ChatEvents, MessageRead } from '../events';

/** Projection of 'message.read' events: last-read seq per (channel, user). */
export class ReadReceiptStore {
  private byChannel = new Map<string, Map<string, number>>();

  constructor(bus: EventBus<ChatEvents>) {
    bus.subscribe('message.read', (e) => this.record(e));
  }

  private record(e: MessageRead): void {
    const users = this.byChannel.get(e.channelId) ?? new Map<string, number>();
    users.set(e.userId, e.seq);
    this.byChannel.set(e.channelId, users);
  }

  lastReadSeq(userId: string, channelId: string): number {
    return this.byChannel.get(channelId)?.get(userId) ?? 0;
  }

  /** "Seen by": users whose last-read seq is at or beyond the given message. */
  readersOf(channelId: string, seq: number): string[] {
    const users = this.byChannel.get(channelId) ?? new Map<string, number>();
    return [...users].filter(([, s]) => s >= seq).map(([u]) => u).sort();
  }
}
`,
      },
      {
        path: 'src/unread/unreadService.ts',
        content: `import { MessageStore } from '../messages/messageStore';
import { ReadReceiptStore } from '../receipts/readReceiptStore';
import { ChannelDirectory } from '../channels/channelDirectory';

export class UnreadService {
  constructor(
    private messages: MessageStore,
    private receipts: ReadReceiptStore,
    private directory: ChannelDirectory,
  ) {}

  unreadFor(userId: string, channelId: string): number {
    return this.messages.countAfter(channelId, this.receipts.lastReadSeq(userId, channelId), userId);
  }

  totalUnread(userId: string): number {
    return this.directory.channelsOf(userId).reduce((n, c) => n + this.unreadFor(userId, c), 0);
  }
}
`,
      },
      {
        path: 'src/badges/badgeNotifier.ts',
        content: `import { EventBus } from '../bus/eventBus';
import { ChatEvents } from '../events';
import { ChannelDirectory } from '../channels/channelDirectory';
import { UnreadService } from '../unread/unreadService';

export interface PushGateway {
  send(userId: string, badge: number): void;
}

export class RecordingPushGateway implements PushGateway {
  public sent: { userId: string; badge: number }[] = [];

  send(userId: string, badge: number): void {
    this.sent.push({ userId, badge });
  }

  badgesFor(userId: string): number[] {
    return this.sent.filter((s) => s.userId === userId).map((s) => s.badge);
  }
}

/** Observer: whenever a user's unread total may have changed, push the new total to their devices. */
export class BadgeNotifier {
  constructor(bus: EventBus<ChatEvents>, directory: ChannelDirectory, unread: UnreadService, push: PushGateway) {
    bus.subscribe('message.posted', (e) => {
      for (const userId of directory.membersOf(e.channelId)) {
        if (userId !== e.authorId) push.send(userId, unread.totalUnread(userId));
      }
    });
    bus.subscribe('message.read', (e) => push.send(e.userId, unread.totalUnread(e.userId)));
  }
}
`,
      },
      {
        path: 'src/app.ts',
        content: `import { EventBus } from './bus/eventBus';
import { ChatEvents } from './events';
import { ChannelDirectory } from './channels/channelDirectory';
import { MessageStore } from './messages/messageStore';
import { MessageService } from './messages/messageService';
import { ReceiptService } from './receipts/receiptService';
import { ReadReceiptStore } from './receipts/readReceiptStore';
import { UnreadService } from './unread/unreadService';
import { BadgeNotifier, RecordingPushGateway } from './badges/badgeNotifier';

export function buildApp() {
  const bus = new EventBus<ChatEvents>();
  const directory = new ChannelDirectory();
  const messages = new MessageStore();

  // Projections first, then observers that read from them.
  const receipts = new ReadReceiptStore(bus);
  const unread = new UnreadService(messages, receipts, directory);
  const push = new RecordingPushGateway();
  new BadgeNotifier(bus, directory, unread, push);

  const messageService = new MessageService(messages, directory, bus);
  const receiptService = new ReceiptService(messages, directory, bus);
  return { bus, directory, messages, receipts, unread, push, messageService, receiptService };
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { buildApp } from './app';

const app = buildApp();
for (const u of ['ana', 'bob', 'cy']) app.directory.join('general', u);

app.messageService.post('general', 'ana', 'hi all');
app.messageService.post('general', 'bob', 'morning');
app.messageService.post('general', 'ana', 'standup in 5?');
app.messageService.post('general', 'cy', 'ok');
app.messageService.post('general', 'ana', 'starting now');

console.log('bob unread=' + app.unread.unreadFor('bob', 'general'));
app.receiptService.markRead('bob', 'general', 4); // phone
console.log('bob unread=' + app.unread.unreadFor('bob', 'general'));
app.receiptService.markRead('bob', 'general', 2); // laptop, delivered late
console.log('bob unread=' + app.unread.unreadFor('bob', 'general'));
console.log('seen #4 by [' + app.receipts.readersOf('general', 4).join(',') + ']');
console.log('bob badges=' + app.push.badgesFor('bob').join(','));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace a new message to a badge',
        prompt:
          '`ana` posts in `#general`, where `bob` is a member. Order the steps up to bob\'s device receiving a badge.',
        items: [
          'MessageService.post checks membership via ChannelDirectory',
          'MessageStore.append assigns the next seq',
          "bus.publish('message.posted')",
          'BadgeNotifier handler loops over channel members, skipping the author',
          'UnreadService.totalUnread sums unreadFor over the user\'s channels',
          'ReadReceiptStore.lastReadSeq returns bob\'s last-read seq',
          'MessageStore.countAfter counts newer messages not written by bob',
          'PushGateway.send(bob, total)',
        ],
        hints: [
          'Who subscribes to `message.posted`? Search for the event name.',
          'Unread is computed on demand: which two stores does `unreadFor` read?',
        ],
        explanation:
          'The bus is synchronous, so the whole chain runs inside `post()`: persist → publish → BadgeNotifier → UnreadService (on-demand) → receipt lookup → count → push. `ReadReceiptStore` does not subscribe to `message.posted`; a new message does not change anyone\'s receipt.',
        timeLimitSec: 300,
        focusFile: 'src/messages/messageService.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Phone, then laptop',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: 'bob unread=4\nbob unread=1\nbob unread=3\nseen #4 by []\nbob badges=1,2,3,4,1,3',
        options: [
          'bob unread=4\nbob unread=1\nbob unread=3\nseen #4 by []\nbob badges=1,2,3,4,1,3',
          'bob unread=4\nbob unread=1\nbob unread=1\nseen #4 by [bob]\nbob badges=1,2,3,4,1,1',
          'bob unread=5\nbob unread=1\nbob unread=3\nseen #4 by []\nbob badges=1,2,3,4,5,1,3',
          'bob unread=4\nbob unread=1\nbob unread=3\nseen #4 by [bob,cy]\nbob badges=1,2,3,4,1,3',
        ],
        hints: [
          'bob wrote message #2; does it count as unread for him? Does posting it push a badge to bob?',
          'What does `ReadReceiptStore.record` do when the seq 2 report arrives after seq 4?',
          'cy wrote #4, but has cy ever sent a read receipt?',
        ],
        explanation:
          'Initially bob has read nothing; his unread messages are #1, #3, #4, #5 (his own #2 is excluded), so 4. Reading to 4 leaves only #5. The late laptop report **overwrites** last-read with 2, so #3, #4, #5 are unread again: 3. "Seen by" only looks at receipts, and nobody now has last-read ≥ 4. Badges: bob gets a push for every post he did not write (1, 2, 3, 4), then one per read event (1, then 3).',
        timeLimitSec: 360,
        focusFile: 'src/main.ts',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Does wiring order matter?',
        prompt:
          'During a refactor someone moves `new BadgeNotifier(...)` **above** `new ReadReceiptStore(bus)` in `app.ts` (passing the same instances). What is the effect?',
        options: [
          'After a read, the badge is computed before the receipt is recorded, so the device shows the pre-read count until the next event',
          '`unreadFor` returns stale counts from then on, even when called later',
          'Nothing: the bus always delivers to stores before notifiers',
          '`message.read` events stop reaching ReadReceiptStore',
        ],
        correct: [0],
        hints: [
          'The bus runs handlers in subscription order. Who subscribes to `message.read` first after the move?',
          'Is `unreadFor` cached anywhere?',
        ],
        explanation:
          '`EventBus.publish` calls handlers in subscription order on the same stack. If BadgeNotifier subscribes first, its `message.read` handler calls `totalUnread` while the receipt still holds the old value, so the push is one step behind. Later direct calls are correct because unread is computed on demand. The comment in `app.ts` ("projections first, then observers") exists for exactly this reason.',
        timeLimitSec: 240,
        focusFile: 'src/app.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Auto-read your own messages',
        prompt:
          'Product wants this: when you post, everything up to your own message counts as read (as in Slack). The assistant proposes a change. Review it.',
        persona: 'helpful-senior',
        request: 'When a user posts a message, mark the channel as read for them up to that message.',
        aiReply: `I'd do it in \`MessageService.post\`, publishing the same event clients send, so every existing subscriber (receipts, badges) reacts without new wiring:

\`\`\`ts
  post(channelId: string, authorId: string, text: string): Message {
    if (!this.directory.isMember(channelId, authorId)) throw new Error('not a member of ' + channelId);
    if (!text.trim()) throw new Error('empty message');
    const msg = this.store.append(channelId, authorId, text);
    this.bus.publish('message.posted', { channelId, seq: msg.seq, authorId });
    this.bus.publish('message.read', { channelId, userId: authorId, seq: msg.seq });
    return msg;
  }
\`\`\`

Since \`msg.seq\` is the channel's latest seq, the receipt can only move forward. The author also gets a fresh badge push, which is what we want when their other devices are showing a stale count.`,
        options: [
          'Accept: it reuses the existing event, so receipts, "Seen by" and badges all stay consistent',
          'Reject: publishing a second event from inside `post` makes the synchronous bus recurse forever',
          'Reject: it should write to `ReadReceiptStore` directly, because going through the bus skips the projection',
          'Reject: the author\'s own message would now count as unread for them',
        ],
        correct: 0,
        hints: [
          'Does any `message.read` handler publish another event?',
          'Which subscribers would be skipped if the code wrote to the store directly?',
        ],
        explanation:
          'This one is correct. No handler publishes in response to `message.read`, so there is no recursion; the second publish runs after the first has finished. Going through the bus is better than writing to the store directly, which would skip the badge update. The author\'s own messages are already excluded by `countAfter`. Sometimes the right review answer is "ship it".',
        timeLimitSec: 240,
        focusFile: 'src/messages/messageService.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Receipts only move forward',
        prompt:
          'Fix the read-state bug so a late or out-of-order read report can never move a user\'s last-read seq backwards. Unread counts, "Seen by" and badges must all reflect this.',
        editable: ['src/receipts/readReceiptStore.ts', 'src/receipts/receiptService.ts'],
        tests: [
          {
            path: 'tests/receipts.test.ts',
            content: `import { buildApp } from '../src/app';

function seeded() {
  const app = buildApp();
  for (const u of ['ana', 'bob', 'cy']) app.directory.join('general', u);
  app.messageService.post('general', 'ana', 'm1');
  app.messageService.post('general', 'bob', 'm2');
  app.messageService.post('general', 'ana', 'm3');
  app.messageService.post('general', 'cy', 'm4');
  app.messageService.post('general', 'ana', 'm5');
  return app;
}

test('late, older read report does not resurrect unread messages', () => {
  const app = seeded();
  app.receiptService.markRead('bob', 'general', 4);
  app.receiptService.markRead('bob', 'general', 2);
  expect(app.receipts.lastReadSeq('bob', 'general')).toBe(4);
  expect(app.unread.unreadFor('bob', 'general')).toBe(1);
});

test('seen-by is not lost on an out-of-order report', () => {
  const app = seeded();
  app.receiptService.markRead('bob', 'general', 4);
  app.receiptService.markRead('bob', 'general', 1);
  expect(app.receipts.readersOf('general', 4)).toEqual(['bob']);
});

test('badge after a stale report shows the current count', () => {
  const app = seeded();
  app.receiptService.markRead('bob', 'general', 5);
  app.receiptService.markRead('bob', 'general', 3);
  const badges = app.push.badgesFor('bob');
  expect(badges[badges.length - 1]).toBe(0);
});

test('reading forward still works', () => {
  const app = seeded();
  app.receiptService.markRead('cy', 'general', 2);
  expect(app.unread.unreadFor('cy', 'general')).toBe(2);
  app.receiptService.markRead('cy', 'general', 99);
  expect(app.receipts.lastReadSeq('cy', 'general')).toBe(5);
  expect(app.unread.unreadFor('cy', 'general')).toBe(0);
});
`,
          },
        ],
        solution: {
          'src/receipts/readReceiptStore.ts': `import { EventBus } from '../bus/eventBus';
import { ChatEvents, MessageRead } from '../events';

/** Projection of 'message.read' events: last-read seq per (channel, user). */
export class ReadReceiptStore {
  private byChannel = new Map<string, Map<string, number>>();

  constructor(bus: EventBus<ChatEvents>) {
    bus.subscribe('message.read', (e) => this.record(e));
  }

  private record(e: MessageRead): void {
    const users = this.byChannel.get(e.channelId) ?? new Map<string, number>();
    // Devices report independently and out of order: last-read only moves forward.
    users.set(e.userId, Math.max(users.get(e.userId) ?? 0, e.seq));
    this.byChannel.set(e.channelId, users);
  }

  lastReadSeq(userId: string, channelId: string): number {
    return this.byChannel.get(channelId)?.get(userId) ?? 0;
  }

  /** "Seen by": users whose last-read seq is at or beyond the given message. */
  readersOf(channelId: string, seq: number): string[] {
    const users = this.byChannel.get(channelId) ?? new Map<string, number>();
    return [...users].filter(([, s]) => s >= seq).map(([u]) => u).sort();
  }
}
`,
        },
        hints: [
          'Which module owns last-read state? Fix it there, not in each reader.',
          'Combine the existing value with the incoming one instead of overwriting it.',
        ],
        explanation:
          'Make the projection monotonic: `Math.max(existing, incoming)`. Doing it in `ReadReceiptStore` (the owner of the state) fixes unread, "Seen by" and badges at once, and it is idempotent and order-independent, which is what you want for events from several devices. Filtering in `ReceiptService` would also work today, but any other publisher of `message.read` (like the auto-read change in the previous stage) would bypass it.',
        timeLimitSec: 480,
        focusFile: 'src/receipts/readReceiptStore.ts',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Inventory holds with TTL (Python)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-py-inventory-ttl-holds',
    title: 'Inventory Holds: Expired but Not Swept',
    level: 3,
    rating: 1550,
    lang: 'python',
    domain: 'inventory',
    companies: ['amazon', 'canva', 'uber', 'generic'],
    tags: ['ttl', 'injected-clock', 'sweeper', 'oversell', 'layering'],
    summary: 'Checkout holds expire after 10 minutes, but a background sweeper only marks them later. Something in between lets stock go negative.',
    context:
      'You are on the commerce team. A flash sale ended with **negative on-hand stock** for one SKU. Holds are meant to expire after 10 minutes, and a sweeper job marks them expired every few minutes. Your lead suspects the window between "expired" and "swept".',
    persona: 'lazy-copier',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# inventory-holds

Checkout places a HOLD on stock; payment success CONFIRMS it (stock is decremented);
abandoning checkout RELEASES it. Holds that are neither confirmed nor released within
HOLD_TTL_SECONDS expire.

## Layers

- inventory/api.py: HoldsApi, maps domain errors to HTTP-style status codes.
- inventory/service.py: ReservationService, which holds all business rules.
- inventory/sweeper.py: ExpirySweeper, a periodic job (cron, every ~5 min) that marks expired holds EXPIRED.
- inventory/repository.py: dumb storage for stock and holds. No rules.
- inventory/events.py: tiny event bus plus an AuditLog listener.
- inventory/clock.py: SystemClock / FakeClock. ALWAYS inject; never call time.time() in services.
- inventory/app.py: composition root.

## Expiry semantics

A hold is live while now < expires_at. At now >= expires_at it is expired, whether or
not the sweeper has run yet. The sweeper is housekeeping, not the source of truth.
`,
      },
      {
        path: 'inventory/clock.py',
        content: `import time


class SystemClock:
    def now(self) -> float:
        return time.time()


class FakeClock:
    """Deterministic clock for tests and demos."""

    def __init__(self, start: float = 0.0):
        self._now = float(start)

    def now(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds
`,
      },
      {
        path: 'inventory/config.py',
        content: `HOLD_TTL_SECONDS = 600
MAX_QTY_PER_HOLD = 10
`,
      },
      {
        path: 'inventory/models.py',
        content: `from dataclasses import dataclass

ACTIVE = "ACTIVE"
CONFIRMED = "CONFIRMED"
RELEASED = "RELEASED"
EXPIRED = "EXPIRED"


@dataclass
class Hold:
    id: str
    sku: str
    qty: int
    created_at: float
    expires_at: float
    status: str = ACTIVE

    def is_live(self, now: float) -> bool:
        return self.status == ACTIVE and now < self.expires_at


class HoldError(Exception):
    pass


class InsufficientStock(HoldError):
    pass


class HoldNotActive(HoldError):
    pass


class UnknownHold(HoldError):
    pass
`,
      },
      {
        path: 'inventory/repository.py',
        content: `from inventory.models import ACTIVE


class StockRepository:
    """On-hand stock per SKU. Dumb storage: business rules live in the service."""

    def __init__(self, on_hand=None):
        self._on_hand = dict(on_hand or {})

    def on_hand(self, sku):
        return self._on_hand.get(sku, 0)

    def adjust(self, sku, delta):
        self._on_hand[sku] = self.on_hand(sku) + delta


class HoldRepository:
    def __init__(self):
        self._holds = {}
        self._seq = 0

    def next_id(self):
        self._seq += 1
        return f"H{self._seq}"

    def add(self, hold):
        self._holds[hold.id] = hold

    def get(self, hold_id):
        return self._holds.get(hold_id)

    def active(self, sku=None):
        """Holds whose status is ACTIVE (they may already be past expires_at)."""
        return [h for h in self._holds.values() if h.status == ACTIVE and (sku is None or h.sku == sku)]
`,
      },
      {
        path: 'inventory/events.py',
        content: `class EventBus:
    def __init__(self):
        self._listeners = {}

    def on(self, name, fn):
        self._listeners.setdefault(name, []).append(fn)

    def emit(self, name, payload):
        for fn in self._listeners.get(name, []):
            fn(payload)


class AuditLog:
    EVENTS = ("hold_placed", "hold_confirmed", "hold_released", "hold_expired")

    def __init__(self, bus):
        self.lines = []
        for name in self.EVENTS:
            short = name.split("_")[1]
            bus.on(name, lambda hold, short=short: self.lines.append(f"{short}:{hold.id}"))
`,
      },
      {
        path: 'inventory/service.py',
        content: `from inventory.config import HOLD_TTL_SECONDS, MAX_QTY_PER_HOLD
from inventory.models import (
    Hold, ACTIVE, CONFIRMED, RELEASED,
    InsufficientStock, HoldNotActive, UnknownHold,
)


class ReservationService:
    def __init__(self, stock, holds, clock, bus, ttl_seconds=HOLD_TTL_SECONDS):
        self.stock = stock
        self.holds = holds
        self.clock = clock
        self.bus = bus
        self.ttl = ttl_seconds

    def available(self, sku):
        now = self.clock.now()
        held = sum(h.qty for h in self.holds.active(sku) if h.is_live(now))
        return self.stock.on_hand(sku) - held

    def place_hold(self, sku, qty):
        if qty <= 0 or qty > MAX_QTY_PER_HOLD:
            raise ValueError(f"qty must be between 1 and {MAX_QTY_PER_HOLD}")
        if self.available(sku) < qty:
            raise InsufficientStock(sku)
        now = self.clock.now()
        hold = Hold(self.holds.next_id(), sku, qty, now, now + self.ttl)
        self.holds.add(hold)
        self.bus.emit("hold_placed", hold)
        return hold

    def confirm(self, hold_id):
        hold = self._get(hold_id)
        if hold.status != ACTIVE:
            raise HoldNotActive(f"{hold_id} is {hold.status}")
        self.stock.adjust(hold.sku, -hold.qty)
        hold.status = CONFIRMED
        self.bus.emit("hold_confirmed", hold)
        return hold

    def release(self, hold_id):
        hold = self._get(hold_id)
        if hold.status != ACTIVE:
            raise HoldNotActive(f"{hold_id} is {hold.status}")
        hold.status = RELEASED
        self.bus.emit("hold_released", hold)
        return hold

    def _get(self, hold_id):
        hold = self.holds.get(hold_id)
        if hold is None:
            raise UnknownHold(hold_id)
        return hold
`,
      },
      {
        path: 'inventory/sweeper.py',
        content: `from inventory.models import EXPIRED


class ExpirySweeper:
    """Periodic housekeeping: marks ACTIVE holds past their expiry as EXPIRED."""

    def __init__(self, holds, clock, bus):
        self.holds = holds
        self.clock = clock
        self.bus = bus

    def sweep(self):
        now = self.clock.now()
        expired = []
        for hold in self.holds.active():
            if now >= hold.expires_at:
                hold.status = EXPIRED
                expired.append(hold.id)
                self.bus.emit("hold_expired", hold)
        return expired
`,
      },
      {
        path: 'inventory/api.py',
        content: `from inventory.models import HoldError, InsufficientStock, UnknownHold


class HoldsApi:
    def __init__(self, service):
        self.service = service

    def post_hold(self, body):
        try:
            hold = self.service.place_hold(body["sku"], int(body["qty"]))
        except (KeyError, ValueError) as e:
            return 400, {"error": str(e)}
        except InsufficientStock as e:
            return 409, {"error": f"insufficient stock for {e}"}
        return 201, {"id": hold.id, "expires_at": hold.expires_at}

    def post_confirm(self, hold_id):
        try:
            hold = self.service.confirm(hold_id)
        except UnknownHold:
            return 404, {"error": "unknown hold"}
        except HoldError as e:
            return 409, {"error": str(e)}
        return 200, {"id": hold.id, "status": hold.status}
`,
      },
      {
        path: 'inventory/app.py',
        content: `from types import SimpleNamespace

from inventory.api import HoldsApi
from inventory.clock import SystemClock
from inventory.config import HOLD_TTL_SECONDS
from inventory.events import AuditLog, EventBus
from inventory.repository import HoldRepository, StockRepository
from inventory.service import ReservationService
from inventory.sweeper import ExpirySweeper


def build(clock=None, on_hand=None, ttl_seconds=HOLD_TTL_SECONDS):
    clock = clock or SystemClock()
    bus = EventBus()
    audit = AuditLog(bus)
    stock = StockRepository(on_hand)
    holds = HoldRepository()
    service = ReservationService(stock, holds, clock, bus, ttl_seconds)
    sweeper = ExpirySweeper(holds, clock, bus)
    return SimpleNamespace(
        clock=clock, bus=bus, audit=audit, stock=stock, holds=holds,
        service=service, sweeper=sweeper, api=HoldsApi(service),
    )
`,
      },
      {
        path: 'main.py',
        content: `from inventory.app import build
from inventory.clock import FakeClock

clock = FakeClock(1000)
app = build(clock, {"SKU-1": 5})
svc = app.service

h1 = svc.place_hold("SKU-1", 3)
print(h1.id, svc.available("SKU-1"))

clock.advance(600)
print("available", svc.available("SKU-1"))

h2 = svc.place_hold("SKU-1", 4)
print(h2.id, svc.available("SKU-1"))

print("confirm", app.api.post_confirm("H1")[0], app.api.post_confirm("H2")[0])
print("on_hand", app.stock.on_hand("SKU-1"))
print("swept", app.sweeper.sweep())
print(" | ".join(app.audit.lines))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Who expires a hold?',
        prompt: 'Select **all** places in the code that can change a hold\'s `status` to `EXPIRED` today.',
        options: [
          '`ExpirySweeper.sweep`',
          '`ReservationService.available`',
          '`Hold.is_live`',
          '`HoldRepository.active`',
          '`ReservationService.confirm`',
        ],
        correct: [0],
        hints: ['Search for the `EXPIRED` constant. Which files import it?'],
        explanation:
          'Only the sweeper writes `EXPIRED`. `available()` and `is_live()` *treat* an expired hold as not live, but they don\'t change its status, and `confirm()` only checks `status`. So between expiry and the next sweep, a hold is expired for availability but still ACTIVE for confirmation. That inconsistency is the bug.',
        timeLimitSec: 180,
        focusFile: 'inventory/service.py',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Replay the flash sale',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: 'H1 2\navailable 5\nH2 1\nconfirm 200 200\non_hand -2\nswept []\nplaced:H1 | placed:H2 | confirmed:H1 | confirmed:H2',
        options: [
          'H1 2\navailable 5\nH2 1\nconfirm 200 200\non_hand -2\nswept []\nplaced:H1 | placed:H2 | confirmed:H1 | confirmed:H2',
          'H1 2\navailable 2\nH2 1\nconfirm 200 200\non_hand -2\nswept []\nplaced:H1 | placed:H2 | confirmed:H1 | confirmed:H2',
          'H1 2\navailable 5\nH2 1\nconfirm 409 200\non_hand 1\nswept []\nplaced:H1 | placed:H2 | expired:H1 | confirmed:H2',
          'H1 2\navailable 5\nH2 1\nconfirm 200 200\non_hand -2\nswept [\'H1\']\nplaced:H1 | placed:H2 | confirmed:H1 | confirmed:H2 | expired:H1',
        ],
        hints: [
          'After advancing 600s, `now == expires_at`. Is `now < expires_at`?',
          'What does `confirm` check before decrementing stock?',
          'By the time the sweeper runs, what is H1\'s status?',
        ],
        explanation:
          'H1 holds 3 of 5, leaving 2. At exactly t = 1600, `is_live` is false (`1600 < 1600` fails), so availability is back to 5 and H2 can hold 4. `confirm(H1)` only checks `status == ACTIVE`; the sweeper has not run, so it succeeds and decrements stock, and so does H2: 5 − 3 − 4 = −2. The sweeper then finds no ACTIVE holds. The audit log never mentions expiry.',
        timeLimitSec: 360,
        focusFile: 'main.py',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Locate the oversell',
        prompt: 'Click the line where the service trusts stale state, then pick the root cause.',
        file: 'inventory/service.py',
        lines: [34],
        options: [
          '`confirm` checks only `status`, not expiry, so an expired-but-unswept hold can still be confirmed',
          '`available` should not filter by `is_live`; it should count every ACTIVE hold',
          '`place_hold` should call the sweeper first',
          '`stock.adjust` should refuse to go negative',
        ],
        correct: 0,
        hints: [
          'The README says the sweeper is "housekeeping, not the source of truth". Which method relies on it anyway?',
        ],
        explanation:
          '`available` and `confirm` disagree about what "active" means: one uses time, the other uses the status field that only the sweeper updates. Making `available` count unswept holds would block legitimate new holds until the cron runs, and guarding in the repository would hide the bug instead of fixing the rule. The fix belongs in `confirm`.',
        timeLimitSec: 240,
        focusFile: 'inventory/service.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'A quick patch from the assistant',
        prompt: 'You asked the assistant for a patch. Review it before applying it.',
        persona: 'lazy-copier',
        request: 'Make confirm() reject holds that have expired, even if the sweeper has not run yet.',
        aiReply: `Here you go, just swap the check:

\`\`\`python
    def confirm(self, hold_id):
        hold = self.holds.get(hold_id)
        if not hold.is_live(self.clock.now()):
            raise HoldNotActive(f"{hold_id} expired")
        # ... rest unchanged
\`\`\`

\`is_live\` already checks both status and expiry, so this covers every case.`,
        options: [
          'Accept: `is_live` covers both status and expiry',
          'Reject: it bypasses `_get`, so an unknown id raises `AttributeError` on `None`, which escapes `HoldsApi` as a 500 instead of a 404',
          'Reject: `is_live` uses `<=`, so holds expire one second early',
          'Reject: `HoldNotActive` is not caught by the API layer',
        ],
        correct: 1,
        hints: [
          'What does `HoldRepository.get` return for an id that does not exist?',
          'Which exceptions does `HoldsApi.post_confirm` catch?',
        ],
        explanation:
          'The expiry check is right, but the patch quietly replaced `self._get(hold_id)` with `self.holds.get(hold_id)`. For an unknown id that returns `None`, and `None.is_live` raises `AttributeError`, which `HoldsApi` does not catch, so a client typo becomes a 500. It also leaves the hold ACTIVE with no `hold_expired` event, and "rest unchanged" hides whether the stock decrement survived. `HoldNotActive` is a `HoldError`, so the API maps it to 409.',
        timeLimitSec: 240,
        focusFile: 'inventory/api.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Make expiry authoritative',
        prompt:
          'Fix `ReservationService.confirm` so an expired hold (`now >= expires_at`) can never be confirmed, even if the sweeper has not run. When `confirm` discovers an expired hold it should do what the sweeper would: mark it `EXPIRED` and emit `hold_expired` (once), then raise `HoldNotActive`. Unknown ids must still raise `UnknownHold`.',
        editable: ['inventory/service.py'],
        tests: [
          {
            path: 'tests/test_holds.py',
            content: `from inventory.app import build
from inventory.clock import FakeClock
from inventory.models import HoldNotActive, UnknownHold, EXPIRED, CONFIRMED


def make(stock=5):
    clock = FakeClock(0)
    return clock, build(clock, {"S": stock})


def test_expired_hold_cannot_be_confirmed():
    clock, app = make()
    h = app.service.place_hold("S", 3)
    clock.advance(600)
    try:
        app.service.confirm(h.id)
        assert False, "expected HoldNotActive"
    except HoldNotActive:
        pass
    assert app.stock.on_hand("S") == 5
    assert h.status == EXPIRED


def test_expiry_found_by_confirm_is_audited_once():
    clock, app = make()
    h = app.service.place_hold("S", 1)
    clock.advance(1000)
    for _ in range(2):
        try:
            app.service.confirm(h.id)
        except HoldNotActive:
            pass
    assert app.sweeper.sweep() == []
    assert app.audit.lines == ["placed:H1", "expired:H1"]


def test_live_hold_confirms():
    clock, app = make()
    h = app.service.place_hold("S", 3)
    clock.advance(599)
    app.service.confirm(h.id)
    assert h.status == CONFIRMED
    assert app.stock.on_hand("S") == 2


def test_flash_sale_scenario_no_oversell():
    clock, app = make()
    app.service.place_hold("S", 3)
    clock.advance(600)
    app.service.place_hold("S", 4)
    assert app.api.post_confirm("H1")[0] == 409
    assert app.api.post_confirm("H2")[0] == 200
    assert app.stock.on_hand("S") == 1


def test_unknown_hold_is_404():
    clock, app = make()
    assert app.api.post_confirm("nope")[0] == 404
    try:
        app.service.confirm("nope")
        assert False
    except UnknownHold:
        pass
`,
          },
        ],
        solution: {
          'inventory/service.py': `from inventory.config import HOLD_TTL_SECONDS, MAX_QTY_PER_HOLD
from inventory.models import (
    Hold, ACTIVE, CONFIRMED, RELEASED, EXPIRED,
    InsufficientStock, HoldNotActive, UnknownHold,
)


class ReservationService:
    def __init__(self, stock, holds, clock, bus, ttl_seconds=HOLD_TTL_SECONDS):
        self.stock = stock
        self.holds = holds
        self.clock = clock
        self.bus = bus
        self.ttl = ttl_seconds

    def available(self, sku):
        now = self.clock.now()
        held = sum(h.qty for h in self.holds.active(sku) if h.is_live(now))
        return self.stock.on_hand(sku) - held

    def place_hold(self, sku, qty):
        if qty <= 0 or qty > MAX_QTY_PER_HOLD:
            raise ValueError(f"qty must be between 1 and {MAX_QTY_PER_HOLD}")
        if self.available(sku) < qty:
            raise InsufficientStock(sku)
        now = self.clock.now()
        hold = Hold(self.holds.next_id(), sku, qty, now, now + self.ttl)
        self.holds.add(hold)
        self.bus.emit("hold_placed", hold)
        return hold

    def confirm(self, hold_id):
        hold = self._get(hold_id)
        self._expire_if_due(hold)
        if hold.status != ACTIVE:
            raise HoldNotActive(f"{hold_id} is {hold.status}")
        self.stock.adjust(hold.sku, -hold.qty)
        hold.status = CONFIRMED
        self.bus.emit("hold_confirmed", hold)
        return hold

    def release(self, hold_id):
        hold = self._get(hold_id)
        if hold.status != ACTIVE:
            raise HoldNotActive(f"{hold_id} is {hold.status}")
        hold.status = RELEASED
        self.bus.emit("hold_released", hold)
        return hold

    def _expire_if_due(self, hold):
        if hold.status == ACTIVE and not hold.is_live(self.clock.now()):
            hold.status = EXPIRED
            self.bus.emit("hold_expired", hold)

    def _get(self, hold_id):
        hold = self.holds.get(hold_id)
        if hold is None:
            raise UnknownHold(hold_id)
        return hold
`,
        },
        hints: [
          'Use `_get` so unknown ids keep their domain error.',
          'Only transition holds that are still ACTIVE, so the event is emitted once and the sweeper skips them later.',
        ],
        explanation:
          'Time is the source of truth and the status field is a cache of it. `confirm` now applies the same transition the sweeper would, so the audit trail stays complete and a later sweep finds nothing to do. Because the transition happens only from ACTIVE, repeated confirms or a later sweep never emit a second `hold_expired`. The API needs no change: `HoldNotActive` is already mapped to 409.',
        timeLimitSec: 600,
        focusFile: 'inventory/service.py',
      },
    ],
  },
  // ───────────────────────────────────────────────────────────────────────────
  // 5. Notification digest batching (Python)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-py-notification-digest',
    title: 'Notification Digests: Quiet Hours That Never Start',
    level: 3,
    rating: 1950,
    lang: 'python',
    domain: 'notifications',
    companies: ['meta', 'atlassian', 'google', 'canva'],
    tags: ['quiet-hours', 'time-zones', 'batching', 'adapters', 'wrap-around'],
    summary: 'Preferences, quiet hours, a per-user batcher and channel adapters. Users with overnight quiet hours still get pinged at 11pm.',
    context:
      'You have joined the notifications team. Support has a pile of complaints: "I set quiet hours from 22:00 to 07:00 and still got a push at 23:10." Daytime quiet windows seem to work. Find out how notifications are routed, reproduce the complaint, and fix it without breaking anyone else\'s quiet hours.',
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# notify-digest

Routes user notifications either instantly or into periodic digests.

## Rules

1. URGENT notifications are always sent immediately, quiet hours or not.
2. Users in "instant" mode get normal notifications immediately, UNLESS they are in
   quiet hours. Then the notification is buffered like a digest item.
3. Users in "digest" mode always buffer.
4. flush() runs every few minutes. A user's buffer is sent as ONE digest when their window
   (opened by the first buffered item) is at least interval_minutes old AND they are not in
   quiet hours right now.

## Quiet hours

quiet_start / quiet_end are LOCAL hours: start inclusive, end exclusive. Windows may wrap
midnight (22 -> 7 means 22:00-06:59). start == end disables quiet hours. Local hour =
UTC hour + tz_offset_hours (mod 24).

## Modules

- digest/models.py: Notification, Preferences
- digest/preferences.py: PreferenceStore (defaults when a user has none)
- digest/quiet_hours.py: local time + quiet window maths
- digest/batcher.py: per-user buffers and windows
- digest/renderer.py: digest/instant message bodies
- digest/channels.py: Email and Push adapters (write to a DeliveryLog in this repo)
- digest/service.py: NotificationService, the routing rules above
- digest/app.py: composition root
`,
      },
      {
        path: 'digest/config.py',
        content: `DEFAULT_INTERVAL_MINUTES = 60
MAX_ITEMS_PER_DIGEST = 3
`,
      },
      {
        path: 'digest/models.py',
        content: `from dataclasses import dataclass

from digest.config import DEFAULT_INTERVAL_MINUTES


@dataclass(frozen=True)
class Notification:
    user_id: str
    text: str
    at: int                      # minutes since epoch, UTC
    priority: str = "normal"     # "normal" | "urgent"


@dataclass
class Preferences:
    user_id: str
    channel: str = "email"       # "email" | "push"
    mode: str = "digest"         # "instant" | "digest"
    interval_minutes: int = DEFAULT_INTERVAL_MINUTES
    quiet_start: int = 0         # local hour, inclusive
    quiet_end: int = 0           # local hour, exclusive; start == end disables
    tz_offset_hours: int = 0
`,
      },
      {
        path: 'digest/preferences.py',
        content: `from digest.models import Preferences


class PreferenceStore:
    def __init__(self):
        self._prefs = {}

    def set(self, prefs):
        self._prefs[prefs.user_id] = prefs

    def get(self, user_id):
        return self._prefs.get(user_id) or Preferences(user_id)
`,
      },
      {
        path: 'digest/quiet_hours.py',
        content: `def local_hour(at_minutes, tz_offset_hours):
    """Local wall-clock hour (0-23) for a UTC timestamp in minutes."""
    return (at_minutes // 60 + tz_offset_hours) % 24


def in_quiet_hours(hour, start, end):
    """True if local hour is in [start, end). Windows may wrap midnight (22 -> 7).
    start == end means quiet hours are disabled."""
    if start == end:
        return False
    return start <= hour < end


def is_quiet(prefs, at_minutes):
    hour = local_hour(at_minutes, prefs.tz_offset_hours)
    return in_quiet_hours(hour, prefs.quiet_start, prefs.quiet_end)
`,
      },
      {
        path: 'digest/batcher.py',
        content: `class DigestBatcher:
    """Per-user buffer. A user's window opens with their first buffered notification."""

    def __init__(self):
        self._pending = {}
        self._window_start = {}

    def add(self, n):
        self._pending.setdefault(n.user_id, []).append(n)
        self._window_start.setdefault(n.user_id, n.at)

    def users(self):
        return sorted(self._pending)

    def pending(self, user_id):
        return list(self._pending.get(user_id, []))

    def is_due(self, user_id, now, interval_minutes):
        start = self._window_start.get(user_id)
        return start is not None and now - start >= interval_minutes

    def take(self, user_id):
        self._window_start.pop(user_id, None)
        return self._pending.pop(user_id, [])
`,
      },
      {
        path: 'digest/renderer.py',
        content: `from digest.config import MAX_ITEMS_PER_DIGEST


def render_digest(items, max_items=MAX_ITEMS_PER_DIGEST):
    n = len(items)
    head = f"{n} update" + ("" if n == 1 else "s")
    shown = "; ".join(i.text for i in items[:max_items])
    more = f" (+{n - max_items} more)" if n > max_items else ""
    return f"{head}: {shown}{more}"


def render_instant(n):
    return ("[urgent] " if n.priority == "urgent" else "") + n.text
`,
      },
      {
        path: 'digest/channels.py',
        content: `class DeliveryLog:
    """Stands in for the real email/push providers."""

    def __init__(self):
        self.lines = []


class EmailAdapter:
    name = "email"

    def __init__(self, log):
        self.log = log

    def send(self, user_id, body):
        self.log.lines.append(f"email {user_id}: {body}")


class PushAdapter:
    name = "push"
    MAX_LEN = 80

    def __init__(self, log):
        self.log = log

    def send(self, user_id, body):
        if len(body) > self.MAX_LEN:
            body = body[: self.MAX_LEN - 3] + "..."
        self.log.lines.append(f"push {user_id}: {body}")


def build_channels(log):
    return {a.name: a for a in (EmailAdapter(log), PushAdapter(log))}
`,
      },
      {
        path: 'digest/service.py',
        content: `from digest.quiet_hours import is_quiet
from digest.renderer import render_digest, render_instant


class NotificationService:
    def __init__(self, prefs, batcher, channels, clock):
        self.prefs = prefs
        self.batcher = batcher
        self.channels = channels
        self.clock = clock

    def notify(self, n):
        p = self.prefs.get(n.user_id)
        channel = self.channels[p.channel]
        if n.priority == "urgent":
            channel.send(n.user_id, render_instant(n))
            return "sent"
        if p.mode == "instant" and not is_quiet(p, n.at):
            channel.send(n.user_id, render_instant(n))
            return "sent"
        self.batcher.add(n)
        return "batched"

    def flush(self):
        now = self.clock.now()
        flushed = []
        for user_id in self.batcher.users():
            p = self.prefs.get(user_id)
            if not self.batcher.is_due(user_id, now, p.interval_minutes):
                continue
            if is_quiet(p, now):
                continue
            items = self.batcher.take(user_id)
            self.channels[p.channel].send(user_id, render_digest(items))
            flushed.append(user_id)
        return flushed
`,
      },
      {
        path: 'digest/app.py',
        content: `from types import SimpleNamespace

from digest.batcher import DigestBatcher
from digest.channels import DeliveryLog, build_channels
from digest.preferences import PreferenceStore
from digest.service import NotificationService


class FakeClock:
    def __init__(self, minute=0):
        self.minute = minute

    def now(self):
        return self.minute

    def set(self, minute):
        self.minute = minute


def build(start_minute=0):
    clock = FakeClock(start_minute)
    log = DeliveryLog()
    prefs = PreferenceStore()
    batcher = DigestBatcher()
    service = NotificationService(prefs, batcher, build_channels(log), clock)
    return SimpleNamespace(clock=clock, log=log, prefs=prefs, batcher=batcher, service=service)
`,
      },
      {
        path: 'main.py',
        content: `from digest.app import build
from digest.models import Notification, Preferences

app = build()
app.prefs.set(Preferences("ana", channel="push", mode="instant", quiet_start=22, quiet_end=7))
app.prefs.set(Preferences("ben", channel="email", mode="digest", quiet_start=22, quiet_end=7, tz_offset_hours=-5))
app.prefs.set(Preferences("cleo", channel="push", mode="instant", quiet_start=13, quiet_end=15, tz_offset_hours=1))

T = 23 * 60 + 10  # 23:10 UTC
for n in [
    Notification("ana", "build failed", T),
    Notification("ben", "PR approved", T),
    Notification("ana", "prod down", T + 5, priority="urgent"),
    Notification("cleo", "lunch?", T + 10),
    Notification("ben", "deploy done", T + 20),
]:
    print(n.user_id, app.service.notify(n))

app.clock.set(T + 60)
print("flushed", app.service.flush())
for line in app.log.lines:
    print(line)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Scope a change',
        prompt:
          'Product wants a new per-user setting, "strict quiet hours": when it is on, even URGENT notifications are buffered during quiet hours. Which files **must** change? Select all that apply.',
        options: [
          '`digest/models.py`',
          '`digest/service.py`',
          '`digest/quiet_hours.py`',
          '`digest/batcher.py`',
          '`digest/channels.py`',
        ],
        correct: [0, 1],
        hints: [
          'Where do per-user settings live?',
          'Where is the "urgent bypasses everything" rule implemented? Does the quiet maths itself need to change?',
        ],
        explanation:
          'The new flag is a field on `Preferences` (models.py), and the urgent short-circuit lives in `NotificationService.notify` (service.py). `is_quiet` already answers "is it quiet now?", the batcher does not care why something was buffered, and adapters only deliver. Knowing which layer owns a rule is most of the work in a multi-file change.',
        timeLimitSec: 240,
        focusFile: 'digest/service.py',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a quiet-hours notification',
        prompt:
          '`cleo` (instant mode, push, quiet 13→15 local) receives a **normal** notification at 13:30 her local time. Later, after her window is due and quiet hours are over, `flush()` runs. Order the steps.',
        items: [
          'NotificationService.notify loads Preferences via PreferenceStore.get',
          'The urgent check is skipped (priority is normal)',
          'is_quiet calls local_hour to convert UTC minutes to local time',
          'in_quiet_hours returns True',
          'DigestBatcher.add buffers it and opens cleo\'s window',
          'flush: DigestBatcher.is_due confirms the window is old enough',
          'flush: is_quiet is checked again at the current time and is False',
          'render_digest builds the body and PushAdapter.send delivers it',
        ],
        hints: [
          'In `notify`, which condition is evaluated before `is_quiet`?',
          'In `flush`, which check comes first: due-ness or quiet hours?',
        ],
        explanation:
          '`notify` reads preferences, short-circuits for urgent, then evaluates `p.mode == "instant" and not is_quiet(...)`. For cleo `is_quiet` → `local_hour` → `in_quiet_hours` returns True for 13, so the item is buffered. In `flush` the batcher is asked first whether the window is due, then quiet hours are re-checked at flush time, and only then is the digest rendered and sent via the user\'s channel adapter. Note that for a digest-mode user, `is_quiet` is never even called in `notify` because of short-circuit evaluation.',
        timeLimitSec: 300,
        focusFile: 'digest/service.py',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce the 23:10 complaint',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer:
          "ana sent\nben batched\nana sent\ncleo sent\nben batched\nflushed ['ben']\npush ana: build failed\npush ana: [urgent] prod down\npush cleo: lunch?\nemail ben: 2 updates: PR approved; deploy done",
        options: [
          "ana sent\nben batched\nana sent\ncleo sent\nben batched\nflushed ['ben']\npush ana: build failed\npush ana: [urgent] prod down\npush cleo: lunch?\nemail ben: 2 updates: PR approved; deploy done",
          "ana batched\nben batched\nana sent\ncleo sent\nben batched\nflushed ['ben']\npush ana: [urgent] prod down\npush cleo: lunch?\nemail ben: 2 updates: PR approved; deploy done",
          "ana sent\nben batched\nana sent\ncleo batched\nben batched\nflushed ['ben', 'cleo']\npush ana: build failed\npush ana: [urgent] prod down\nemail ben: 2 updates: PR approved; deploy done\npush cleo: 1 update: lunch?",
          "ana sent\nben batched\nana batched\ncleo sent\nben batched\nflushed []\npush ana: build failed\npush cleo: lunch?",
        ],
        hints: [
          'ana: local hour 23, window 22→7. Evaluate `22 <= 23 < 7`.',
          'cleo is at UTC+1: what local hour is 23:xx UTC for her?',
          'ben is digest mode at UTC−5; at flush time (00:10 UTC) what is his local hour, and is his window 60 minutes old?',
        ],
        explanation:
          'The chained comparison `start <= hour < end` can never be true when start > end, so ana\'s 23:10 notification goes straight out: that is the complaint. The urgent one is sent regardless (correct). cleo\'s local hour is 0, outside 13→15, so it is sent. ben buffers both items; at flush (00:10 UTC = 19:10 local) his window opened at 23:10 is exactly 60 minutes old and he is not quiet, so he gets one 2-item email. With correct maths, ana\'s "build failed" would be batched and held by flush (local 00:10 is quiet), as in the second option.',
        timeLimitSec: 420,
        focusFile: 'main.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'The intern\'s one-liner',
        prompt: 'The assistant proposes a fix for `in_quiet_hours`. Review it.',
        persona: 'confident-intern',
        request: 'Quiet hours that cross midnight (22 -> 7) never trigger. Fix in_quiet_hours.',
        aiReply: `Classic wrap-around bug! If the window crosses midnight, the hour is quiet when it's after the start **or** before the end:

\`\`\`python
def in_quiet_hours(hour, start, end):
    if start == end:
        return False
    return hour >= start or hour < end
\`\`\`

22→7: hour 23 → True, hour 3 → True, hour 12 → False. ✅ Ship it!`,
        options: [
          'Accept: the examples show it handles wrap-around correctly',
          'Reject: for a window that does not wrap, like cleo\'s 13→15, it returns True for almost every hour (e.g. 16 or 9), so daytime users get everything batched',
          'Reject: it should use `hour > start` because start is exclusive',
          'Reject: wrap-around must be handled in `local_hour` by adding 24 to negative hours',
        ],
        correct: 1,
        hints: ['Try the proposal with start=13, end=15 and hour=16, then hour=9.'],
        explanation:
          'The `or` form is right only for wrapping windows. For 13→15, hour 16 gives `16 >= 13` → True and hour 9 gives `9 < 15` → True, so cleo would be "quiet" all day except 15:00. The intern tested only the case from the bug report. The correct version branches: `start < end` → `start <= hour < end`, otherwise `hour >= start or hour < end`. `local_hour` already normalises with `% 24` (Python\'s modulo is non-negative).',
        timeLimitSec: 240,
        focusFile: 'digest/quiet_hours.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix quiet hours for every window shape',
        prompt:
          'Fix quiet-hours handling so windows that wrap midnight work, non-wrapping windows keep working, `start == end` still disables quiet hours, and time-zone offsets are respected. The routing rules in the README must hold end to end.',
        editable: ['digest/quiet_hours.py'],
        tests: [
          {
            path: 'tests/test_quiet_hours.py',
            content: `from digest.quiet_hours import in_quiet_hours
from digest.app import build
from digest.models import Notification, Preferences


def test_wrapping_window():
    assert in_quiet_hours(22, 22, 7)
    assert in_quiet_hours(23, 22, 7)
    assert in_quiet_hours(0, 22, 7)
    assert in_quiet_hours(6, 22, 7)
    assert not in_quiet_hours(7, 22, 7)
    assert not in_quiet_hours(12, 22, 7)
    assert not in_quiet_hours(21, 22, 7)


def test_daytime_window_unchanged():
    assert in_quiet_hours(13, 13, 15)
    assert in_quiet_hours(14, 13, 15)
    assert not in_quiet_hours(15, 13, 15)
    assert not in_quiet_hours(16, 13, 15)
    assert not in_quiet_hours(9, 13, 15)


def test_disabled_window():
    for h in range(24):
        assert not in_quiet_hours(h, 0, 0)
        assert not in_quiet_hours(h, 9, 9)


def test_overnight_user_is_batched_then_delivered_in_the_morning():
    app = build()
    app.prefs.set(Preferences("ana", channel="push", mode="instant", quiet_start=22, quiet_end=7))
    t = 23 * 60 + 10
    assert app.service.notify(Notification("ana", "build failed", t)) == "batched"
    app.clock.set(t + 60)
    assert app.service.flush() == []
    app.clock.set(24 * 60 + 7 * 60)  # 07:00 next day
    assert app.service.flush() == ["ana"]
    assert app.log.lines == ["push ana: 1 update: build failed"]


def test_timezone_offset_is_respected():
    app = build()
    app.prefs.set(Preferences("ben", channel="push", mode="instant", quiet_start=22, quiet_end=7, tz_offset_hours=-5))
    assert app.service.notify(Notification("ben", "late", 3 * 60)) == "batched"   # 22:00 local
    assert app.service.notify(Notification("ben", "day", 15 * 60)) == "sent"      # 10:00 local
`,
          },
        ],
        solution: {
          'digest/quiet_hours.py': `def local_hour(at_minutes, tz_offset_hours):
    """Local wall-clock hour (0-23) for a UTC timestamp in minutes."""
    return (at_minutes // 60 + tz_offset_hours) % 24


def in_quiet_hours(hour, start, end):
    """True if local hour is in [start, end). Windows may wrap midnight (22 -> 7).
    start == end means quiet hours are disabled."""
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def is_quiet(prefs, at_minutes):
    hour = local_hour(at_minutes, prefs.tz_offset_hours)
    return in_quiet_hours(hour, prefs.quiet_start, prefs.quiet_end)
`,
        },
        hints: [
          'There are three shapes of window: disabled, same-day, and wrapping. Handle each explicitly.',
          'A wrapping window is the complement of the same-day window [end, start).',
        ],
        explanation:
          'Branch on the window shape. Same-day: `start <= hour < end`. Wrapping: `hour >= start or hour < end`. Disabled: `start == end`. The service needs no change because both `notify` and `flush` go through `is_quiet`, so fixing the single owner of the maths fixes buffering and delivery together.',
        timeLimitSec: 540,
        focusFile: 'digest/quiet_hours.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Checkout middleware pipeline (JavaScript)
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'l3-a-js-checkout-pipeline',
    title: 'Checkout Pipeline: Taxed Before the Discount',
    level: 3,
    rating: 1650,
    lang: 'javascript',
    domain: 'checkout',
    companies: ['amazon', 'canva', 'uber', 'stripe'],
    tags: ['middleware', 'onion-model', 'async', 'ordering', 'promotions'],
    summary: 'A Koa-style middleware chain: cart → promotions → tax → shipping → payment. Customers with promo codes are overcharged tax.',
    context:
      'You have just joined the checkout team. Finance flagged that orders using promo codes are being charged tax on the **pre-discount** amount. `tax.js` looks right when read on its own. The checkout is a Koa-style middleware pipeline, so you need to understand how the pieces are composed.',
    persona: 'agent-mode',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# checkout

Checkout is a chain of async middleware, (ctx, next) => Promise, composed Koa-style in
src/pipeline.js. Each middleware does its work, then awaits next(). Code after
await next() runs on the way back out (the "onion").

## Order of business rules

1. validate the cart and compute subtotal (cents)
2. apply promotions (ctx.discount)
3. tax on the DISCOUNTED subtotal (region rate, basis points)
4. shipping: free when the DISCOUNTED subtotal >= FREE_SHIPPING_THRESHOLD
5. payment: charge subtotal - discount + tax + shipping, idempotent on cart id

errorBoundary wraps everything. Any throw downstream sets ctx.status = 'failed' and ctx.error.

## Files

- src/checkout.js: composition root, the ONLY place the order is defined
- src/pipeline.js: compose()
- src/middleware/*.js: one rule each
- src/services/promotions.js: promo code rules
- src/services/paymentGateway.js: fake gateway
- src/config.js: rates and thresholds
`,
      },
      {
        path: 'src/config.js',
        content: `module.exports = {
  TAX_BPS: { CA: 725, NY: 800, OR: 0 },
  FREE_SHIPPING_THRESHOLD: 5000, // cents, compared with the discounted subtotal
  FLAT_SHIPPING: 599,
  PAYMENT_LIMIT: 10000,
};
`,
      },
      {
        path: 'src/pipeline.js',
        content: `/**
 * Koa-style compose: returns run(ctx) which calls middlewares[0](ctx, next),
 * where next() invokes the following middleware and returns its promise.
 */
function compose(middlewares) {
  return function run(ctx) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called multiple times'));
      index = i;
      const fn = middlewares[i];
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

module.exports = compose;
`,
      },
      {
        path: 'src/services/promotions.js',
        content: `const RULES = {
  SAVE10: (subtotal) => Math.round(subtotal * 0.1),
  FIVEOFF: (subtotal) => Math.min(500, subtotal),
};

function discountFor(code, subtotal) {
  if (!code) return 0;
  const rule = RULES[code.toUpperCase()];
  if (!rule) throw new Error('unknown promo code ' + code);
  return rule(subtotal);
}

module.exports = { discountFor };
`,
      },
      {
        path: 'src/services/paymentGateway.js',
        content: `class FakePaymentGateway {
  constructor(limit) {
    this.limit = limit;
    this.charges = new Map();
    this.calls = 0;
  }

  /** Idempotent on idempotencyKey: a repeated key returns the first result. */
  async charge({ amount, idempotencyKey }) {
    this.calls++;
    if (this.charges.has(idempotencyKey)) return this.charges.get(idempotencyKey);
    const res = amount > this.limit
      ? { ok: false, reason: 'limit exceeded' }
      : { ok: true, id: 'ch_' + (this.charges.size + 1), amount };
    this.charges.set(idempotencyKey, res);
    return res;
  }
}

module.exports = { FakePaymentGateway };
`,
      },
      {
        path: 'src/middleware/errorBoundary.js',
        content: `module.exports = async function errorBoundary(ctx, next) {
  ctx.trace.push('boundary');
  try {
    await next();
    ctx.status = 'paid';
  } catch (err) {
    ctx.status = 'failed';
    ctx.error = err.message;
  }
  ctx.trace.push('boundary:' + ctx.status);
};
`,
      },
      {
        path: 'src/middleware/validateCart.js',
        content: `module.exports = async function validateCart(ctx, next) {
  ctx.trace.push('validate');
  const items = ctx.cart.items || [];
  if (!items.length) throw new Error('empty cart');
  for (const it of items) {
    if (!(it.qty > 0) || !(it.price >= 0)) throw new Error('bad line ' + it.sku);
  }
  ctx.subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  ctx.discount = 0;
  ctx.tax = 0;
  ctx.shipping = 0;
  await next();
};
`,
      },
      {
        path: 'src/middleware/applyPromotions.js',
        content: `module.exports = function applyPromotions(engine) {
  return async function promo(ctx, next) {
    ctx.trace.push('promo');
    ctx.discount = engine.discountFor(ctx.cart.promoCode, ctx.subtotal);
    await next();
  };
};
`,
      },
      {
        path: 'src/middleware/tax.js',
        content: `const { TAX_BPS } = require('../config');

module.exports = async function tax(ctx, next) {
  ctx.trace.push('tax');
  const bps = TAX_BPS[ctx.cart.region];
  if (bps === undefined) throw new Error('unsupported region ' + ctx.cart.region);
  const taxable = ctx.subtotal - ctx.discount; // tax what the customer actually pays for goods
  ctx.tax = Math.round((taxable * bps) / 10000);
  await next();
};
`,
      },
      {
        path: 'src/middleware/shipping.js',
        content: `const { FREE_SHIPPING_THRESHOLD, FLAT_SHIPPING } = require('../config');

module.exports = async function shipping(ctx, next) {
  ctx.trace.push('shipping');
  ctx.shipping = ctx.subtotal - ctx.discount >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  await next();
};
`,
      },
      {
        path: 'src/middleware/payment.js',
        content: `module.exports = function payment(gateway) {
  return async function pay(ctx, next) {
    ctx.trace.push('payment');
    ctx.total = ctx.subtotal - ctx.discount + ctx.tax + ctx.shipping;
    const res = await gateway.charge({ amount: ctx.total, idempotencyKey: ctx.cart.id });
    if (!res.ok) throw new Error('declined: ' + res.reason);
    ctx.chargeId = res.id;
    await next();
  };
};
`,
      },
      {
        path: 'src/checkout.js',
        content: `const compose = require('./pipeline');
const errorBoundary = require('./middleware/errorBoundary');
const validateCart = require('./middleware/validateCart');
const applyPromotions = require('./middleware/applyPromotions');
const tax = require('./middleware/tax');
const shipping = require('./middleware/shipping');
const payment = require('./middleware/payment');
const promotions = require('./services/promotions');

function createCheckout({ gateway }) {
  const run = compose([
    errorBoundary,
    validateCart,
    tax,
    applyPromotions(promotions),
    shipping,
    payment(gateway),
  ]);

  return async function checkout(cart) {
    const ctx = { cart, trace: [] };
    await run(ctx);
    return ctx;
  };
}

module.exports = { createCheckout };
`,
      },
      {
        path: 'main.js',
        content: `const { createCheckout } = require('./src/checkout');
const { FakePaymentGateway } = require('./src/services/paymentGateway');
const { PAYMENT_LIMIT } = require('./src/config');

async function main() {
  const checkout = createCheckout({ gateway: new FakePaymentGateway(PAYMENT_LIMIT) });

  const a = await checkout({
    id: 'c1',
    region: 'CA',
    promoCode: 'save10',
    items: [{ sku: 'mug', price: 1500, qty: 2 }, { sku: 'tee', price: 2500, qty: 1 }],
  });
  console.log(a.trace.join(' > '));
  console.log('status=' + a.status + ' total=' + a.total + ' tax=' + a.tax + ' shipping=' + a.shipping);

  const b = await checkout({ id: 'c2', region: 'OR', items: [{ sku: 'chair', price: 12000, qty: 1 }] });
  console.log(b.trace.join(' > '));
  console.log('status=' + b.status + ' error=' + b.error);
}

main();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Walk the onion',
        prompt:
          'For a successful checkout **as currently wired**, order these steps as they execute, including the code that runs after `await next()` returns.',
        items: [
          'errorBoundary pushes "boundary" and awaits next()',
          'validateCart computes subtotal and resets discount/tax/shipping',
          'tax computes ctx.tax',
          'promo sets ctx.discount',
          'shipping decides flat or free',
          'pay computes total and awaits gateway.charge',
          'Each await next() resolves back up the chain',
          'errorBoundary sets ctx.status = "paid" and pushes "boundary:paid"',
        ],
        hints: [
          'The order is defined in exactly one file. Which one does the README name?',
          'Where does control go after the last middleware\'s `await next()` resolves?',
        ],
        explanation:
          '`compose` runs middlewares in array order from `checkout.js`. Each `await next()` suspends until everything downstream finishes, so the after-`next` code in `errorBoundary` runs last. As wired, `tax` runs before `promo`; that is the bug you will chase next.',
        timeLimitSec: 300,
        focusFile: 'src/checkout.js',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict two checkouts',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer:
          'boundary > validate > tax > promo > shipping > payment > boundary:paid\nstatus=paid total=5948 tax=399 shipping=599\nboundary > validate > tax > promo > shipping > payment > boundary:failed\nstatus=failed error=declined: limit exceeded',
        options: [
          'boundary > validate > tax > promo > shipping > payment > boundary:paid\nstatus=paid total=5948 tax=399 shipping=599\nboundary > validate > tax > promo > shipping > payment > boundary:failed\nstatus=failed error=declined: limit exceeded',
          'boundary > validate > tax > promo > shipping > payment > boundary:paid\nstatus=paid total=5908 tax=359 shipping=599\nboundary > validate > tax > promo > shipping > payment > boundary:failed\nstatus=failed error=declined: limit exceeded',
          'boundary > validate > tax > promo > shipping > payment > boundary:paid\nstatus=paid total=5349 tax=399 shipping=0\nboundary > validate > tax > promo > shipping > payment > boundary:failed\nstatus=failed error=declined: limit exceeded',
          'boundary > validate > tax > promo > shipping > payment > boundary:paid\nstatus=paid total=5948 tax=399 shipping=599\nboundary > validate > tax > promo > shipping > payment\nstatus=undefined error=undefined',
        ],
        hints: [
          'When `tax` runs, what is `ctx.discount`? Which middleware set it?',
          'Subtotal is 5500 and SAVE10 is 550. Is shipping decided on 5500 or on 4950?',
          'Does a throw inside `pay` reach errorBoundary\'s catch?',
        ],
        explanation:
          'Cart c1: subtotal 2×1500 + 2500 = 5500. `tax` runs while `ctx.discount` is still 0 (reset by validateCart), so tax = round(5500 × 725 / 10000) = round(398.75) = 399 instead of 359. Then promo sets discount 550; shipping sees 4950 < 5000 → 599. Total = 5500 − 550 + 399 + 599 = 5948. Cart c2: total 12000 > limit, so `pay` throws; the rejection propagates through every awaited `next()` into errorBoundary\'s catch, which still pushes "boundary:failed".',
        timeLimitSec: 420,
        focusFile: 'main.js',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Where is the bug?',
        prompt: 'Click the line responsible for taxing the pre-discount amount, then choose the root cause.',
        file: 'src/checkout.js',
        lines: [14, 15],
        options: [
          'The tax middleware is composed before applyPromotions, so it reads discount = 0',
          '`tax.js` should subtract `ctx.shipping` from the taxable amount',
          '`compose` runs middlewares in reverse order',
          '`validateCart` should not reset `ctx.discount`',
        ],
        correct: 0,
        hints: [
          '`tax.js` already subtracts `ctx.discount`. So when is `ctx.discount` set?',
        ],
        explanation:
          '`tax.js` is correct in isolation. The defect is in the composition root: `tax` sits before `applyPromotions(promotions)`, so it reads the `0` that validateCart set. Single-file review would never find this; you need to know who writes `ctx.discount` and in what order the chain runs.',
        timeLimitSec: 240,
        focusFile: 'src/checkout.js',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Agent adds a fraud check',
        prompt: 'An AI agent was asked to add a fraud check. It edited several files. Review the change.',
        persona: 'agent-mode',
        request: 'Add a fraud check that rejects carts with more than 20 units in total. It must run before payment.',
        aiReply: `Done! I made the following edits across the repo:

**src/middleware/fraudCheck.js** (new)
\`\`\`js
module.exports = async function fraudCheck(ctx, next) {
  ctx.trace.push('fraud');
  const units = ctx.cart.items.reduce((n, it) => n + it.qty, 0);
  if (units > 20) throw new Error('fraud: too many units');
  next();
};
\`\`\`

**src/checkout.js**: inserted \`fraudCheck\` right after \`validateCart\`.

**src/pipeline.js**: simplified \`dispatch\` by removing the "next() called multiple times" guard, since none of our middleware calls next twice.

**src/middleware/tax.js**: renamed \`bps\` → \`rateBps\` for clarity.

All existing behaviour is preserved. 🚀`,
        options: [
          'Accept: the fraud check runs before payment and every other edit is cosmetic',
          'Reject: `fraudCheck` calls `next()` without awaiting or returning it, so errors downstream (e.g. a payment decline) no longer reach errorBoundary and become unhandled rejections',
          'Reject: a fraud check must be placed after payment so the charge can be reversed',
          'Reject: `ctx.cart.items` is undefined at that point because validateCart has not run yet',
        ],
        correct: 1,
        hints: [
          'Compare the last line of `fraudCheck` with every other middleware.',
          'What does errorBoundary\'s `await next()` actually wait for?',
        ],
        explanation:
          'Every middleware here ends with `await next()`, which keeps the downstream promise chained to the caller. `fraudCheck` drops that promise: its own promise resolves as soon as `next()` has *started*, so errorBoundary\'s try/catch can finish (and may mark the order "paid") before payment does, and a decline becomes an unhandled rejection. The unrequested `pipeline.js` change also removed a safety guard: typical agent over-editing that should be reverted. `fraudCheck` is inserted after validateCart, so `items` exists.',
        timeLimitSec: 300,
        focusFile: 'src/pipeline.js',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix the composition',
        prompt:
          'Fix checkout so tax and free-shipping both use the **discounted** subtotal, as the README specifies. Do not change the individual rule files unless you need to.',
        editable: ['src/checkout.js', 'src/middleware/tax.js'],
        tests: [
          {
            path: 'tests/checkout.test.js',
            content: `const { createCheckout } = require('../src/checkout');
const { FakePaymentGateway } = require('../src/services/paymentGateway');

function make() {
  const gateway = new FakePaymentGateway(10000);
  return { gateway, checkout: createCheckout({ gateway }) };
}

test('CA with SAVE10 taxes the discounted subtotal', async () => {
  const { checkout } = make();
  const ctx = await checkout({ id: 'a', region: 'CA', promoCode: 'SAVE10', items: [{ sku: 'm', price: 1500, qty: 2 }, { sku: 't', price: 2500, qty: 1 }] });
  expect(ctx.status).toBe('paid');
  expect(ctx.discount).toBe(550);
  expect(ctx.tax).toBe(359);
  expect(ctx.shipping).toBe(599);
  expect(ctx.total).toBe(5908);
});

test('NY with FIVEOFF', async () => {
  const { checkout, gateway } = make();
  const ctx = await checkout({ id: 'b', region: 'NY', promoCode: 'fiveoff', items: [{ sku: 'x', price: 3000, qty: 1 }] });
  expect(ctx.tax).toBe(200);
  expect(ctx.total).toBe(3299);
  expect(gateway.charges.get('b').amount).toBe(3299);
});

test('promo runs before tax and shipping', async () => {
  const { checkout } = make();
  const ctx = await checkout({ id: 'c', region: 'OR', items: [{ sku: 'x', price: 6000, qty: 1 }] });
  expect(ctx.trace.indexOf('promo')).toBeLessThan(ctx.trace.indexOf('tax'));
  expect(ctx.trace.indexOf('promo')).toBeLessThan(ctx.trace.indexOf('shipping'));
  expect(ctx.shipping).toBe(0);
  expect(ctx.total).toBe(6000);
});

test('errors still reach the boundary', async () => {
  const { checkout } = make();
  const bad = await checkout({ id: 'd', region: 'CA', promoCode: 'BOGUS', items: [{ sku: 'x', price: 100, qty: 1 }] });
  expect(bad.status).toBe('failed');
  expect(bad.error).toBe('unknown promo code BOGUS');
  const big = await checkout({ id: 'e', region: 'OR', items: [{ sku: 'x', price: 20000, qty: 1 }] });
  expect(big.error).toBe('declined: limit exceeded');
});
`,
          },
        ],
        solution: {
          'src/checkout.js': `const compose = require('./pipeline');
const errorBoundary = require('./middleware/errorBoundary');
const validateCart = require('./middleware/validateCart');
const applyPromotions = require('./middleware/applyPromotions');
const tax = require('./middleware/tax');
const shipping = require('./middleware/shipping');
const payment = require('./middleware/payment');
const promotions = require('./services/promotions');

function createCheckout({ gateway }) {
  const run = compose([
    errorBoundary,
    validateCart,
    applyPromotions(promotions),
    tax,
    shipping,
    payment(gateway),
  ]);

  return async function checkout(cart) {
    const ctx = { cart, trace: [] };
    await run(ctx);
    return ctx;
  };
}

module.exports = { createCheckout };
`,
        },
        hints: [
          'The rule files are each correct; the README lists the intended order.',
          'One line moves.',
        ],
        explanation:
          'Moving `applyPromotions(promotions)` above `tax` restores the documented order. Patching `tax.js` to compute the discount itself would duplicate promotion logic and drift from `promotions.js`. In a middleware architecture the composition root is a real part of the business logic, and ordering bugs live there.',
        timeLimitSec: 420,
        focusFile: 'src/checkout.js',
      },
    ],
  },
];

export default problems;
