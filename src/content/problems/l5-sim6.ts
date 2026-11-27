import type { Problem } from '../types';

// L5 full interview simulations: async dispatch races (TS) and Stripe-style webhooks (Python).
const problems: Problem[] = [
  {
    id: "l5-sim-uber-dispatch-races",
    title: "Dispatch Under Fire: Races, Retries and One Car per Rider",
    level: 5,
    rating: 3000,
    lang: "typescript",
    domain: "concurrency",
    companies: [
      "uber",
      "amazon",
    ],
    tags: [
      "interview-simulation",
      "async",
      "race-condition",
      "optimistic-concurrency",
      "idempotency",
      "event-loop",
    ],
    summary: "Two riders, one car, and a retry storm. Prove the race with microtask-level tracing, then make dispatch and POST /rides safe.",
    context: `**Uber/Amazon-style AI-enabled round: 7 stages, one codebase, ~60 minutes.**

You're on call for \`dispatch-svc\`. Last Friday at 18:02 two riders at the same corner were both told *"Driver d1 is on the way"*, and a rider on flaky LTE got two cars after the app retried \`POST /rides\`.

The service is a single Node process; every store call is an \`await\`. The in-memory adapters in \`src/store\` yield to the event loop via \`io()\` instead of sleeping, so interleavings are **deterministic** and reproducible. Read \`README.md\` first, especially the four invariants.

The interviewer will push on *why* an interleaving happens, not just *that* it happens. The assistant panel is available, but it is overconfident about concurrency.`,
    persona: "confident-intern",
    files: [
      {
        path: "README.md",
        content: `# dispatch-svc

Assigns drivers to ride requests. One Node process handles many requests
concurrently; every store call is an \`await\` on a network round trip.

\`\`\`
POST /rides ──► RidesController.create      (src/api/rides.ts)
                 ├─ parseRideRequest          (src/api/validation.ts)
                 ├─ IdempotencyStore.get      (src/store/idempotencyStore.ts)
                 ├─ RideStore.create
                 ├─ Dispatcher.dispatch       (src/dispatch/dispatcher.ts)
                 │    ├─ DriverStore.listAvailable
                 │    ├─ rankCandidates       (src/matching/ranker.ts)
                 │    ├─ DriverStore.get      (re-read candidate)
                 │    ├─ PricingService.quote (src/pricing/*.ts, async surge lookup)
                 │    ├─ DriverStore.put      (mark assigned)
                 │    └─ RideStore.put + EventBus.emit
                 └─ IdempotencyStore.put
\`\`\`

## Local simulation

The in-memory stores in \`src/store\` call \`io(latency)\`, which yields to the
event loop instead of sleeping. Concurrency bugs therefore reproduce
deterministically: \`npx tsx src/demo.ts\`.

## Invariants (from the on-call runbook)

1. A driver is assigned to **at most one** active ride.
2. A retried \`POST /rides\` with the same \`Idempotency-Key\` (per rider)
   returns the original response and never dispatches a second car,
   including when the retry arrives while the first attempt is still running.
3. Reusing a key with a different body is a client bug: respond \`422\`.
4. A request that failed with a transient error must not poison its key:
   the client's retry should be processed normally.

## Config

\`config/dispatch.json\` — search radius, ranking weights, per-product pricing,
idempotency TTL.
`,
        language: "markdown",
      },
      {
        path: "config/dispatch.json",
        content: `{
  "maxPickupKm": 5,
  "maxAttempts": 3,
  "avgSpeedKmh": 30,
  "ratingPenaltyMin": 2,
  "pricing": {
    "x":  { "baseCents": 250, "perKmCents": 120, "minimumCents": 700 },
    "xl": { "baseCents": 400, "perKmCents": 190, "minimumCents": 1100 }
  },
  "idempotency": { "ttlMs": 86400000 }
}
`,
        language: "json",
      },
      {
        path: "src/app.ts",
        content: `import config from '../config/dispatch.json';
import { DispatchConfig, Driver, Product } from './types';
import { DriverStore } from './store/driverStore';
import { RideStore } from './store/rideStore';
import { IdempotencyStore } from './store/idempotencyStore';
import { PricingService, ProductPricing, SurgeTable } from './pricing/pricing';
import { EventBus } from './events/bus';
import { Dispatcher } from './dispatch/dispatcher';
import { RidesController } from './api/rides';
import { HttpResponse } from './api/http';
import { FakeClock } from './util/io';

export interface AppOptions {
  drivers: Omit<Driver, 'version'>[];
  /** Simulated round trips per store call. */
  latency?: number;
  surgeLatency?: number;
}

/** Composition root: wires every layer with constructor injection. */
export function buildApp(opts: AppOptions) {
  const clock = new FakeClock();
  const latency = opts.latency ?? 1;
  const cfg: DispatchConfig = {
    maxPickupKm: config.maxPickupKm,
    maxAttempts: config.maxAttempts,
    avgSpeedKmh: config.avgSpeedKmh,
    ratingPenaltyMin: config.ratingPenaltyMin,
  };
  const drivers = new DriverStore(latency);
  drivers.seed(opts.drivers);
  const rides = new RideStore(clock, latency);
  const idem = new IdempotencyStore<HttpResponse>(clock, config.idempotency.ttlMs, latency);
  const surge = new SurgeTable(opts.surgeLatency ?? latency);
  const pricing = new PricingService(config.pricing as Record<Product, ProductPricing>, surge);
  const bus = new EventBus();
  const dispatcher = new Dispatcher(drivers, rides, pricing, bus, cfg);
  const api = new RidesController(rides, dispatcher, idem);
  return { clock, cfg, drivers, rides, idem, surge, pricing, bus, dispatcher, api };
}
`,
      },
      {
        path: "src/types.ts",
        content: `export interface LatLng {
  lat: number;
  lng: number;
}

export type DriverStatus = 'available' | 'assigned' | 'offline';

export interface Driver {
  id: string;
  location: LatLng;
  status: DriverStatus;
  /** Ride the driver is currently assigned to, if any. */
  rideId?: string;
  /** 1.0 - 5.0 */
  rating: number;
  /** Optimistic-concurrency version, bumped by the store on every write. */
  version: number;
}

export type Product = 'x' | 'xl';

export interface RideRequest {
  riderId: string;
  pickup: LatLng;
  dropoff: LatLng;
  product: Product;
}

export type RideStatus = 'requested' | 'assigned' | 'no_driver' | 'cancelled';

export interface Ride extends RideRequest {
  id: string;
  status: RideStatus;
  driverId?: string;
  fareCents?: number;
  createdAt: number;
}

export interface DispatchConfig {
  /** Only drivers within this radius are considered. */
  maxPickupKm: number;
  /** How many ranked candidates to try before giving up. */
  maxAttempts: number;
  /** Average city speed used for ETA estimates. */
  avgSpeedKmh: number;
  /** Minutes of ETA penalty per rating point below 5. */
  ratingPenaltyMin: number;
}
`,
      },
      {
        path: "src/api/rides.ts",
        content: `import { HttpRequest, HttpResponse, badRequest, unavailable } from './http';
import { parseRideRequest, fingerprint } from './validation';
import { RideStore } from '../store/rideStore';
import { IdempotencyStore } from '../store/idempotencyStore';
import { Dispatcher } from '../dispatch/dispatcher';
import { TransientError } from '../dispatch/retry';
import { Ride } from '../types';

export function toDto(r: Ride) {
  return { id: r.id, status: r.status, driverId: r.driverId ?? null, fareCents: r.fareCents ?? null };
}

/**
 * POST /rides
 *
 * Mobile clients retry on timeouts with the same \`Idempotency-Key\` header.
 * A retried request must return the original ride and must never dispatch
 * a second car.
 */
export class RidesController {
  constructor(
    private rides: RideStore,
    private dispatcher: Dispatcher,
    private idem: IdempotencyStore<HttpResponse>,
  ) {}

  async create(req: HttpRequest): Promise<HttpResponse> {
    const parsed = parseRideRequest(req.body);
    if (!parsed.ok) return badRequest(parsed.error);
    const key = req.headers['idempotency-key'];
    const scoped = key ? \`\${parsed.value.riderId}:\${key}\` : undefined;

    if (scoped) {
      const hit = await this.idem.get(scoped);
      if (hit) return hit.response;
    }

    let response: HttpResponse;
    try {
      const ride = await this.rides.create(parsed.value);
      const result = await this.dispatcher.dispatch(ride.id);
      response = { status: 201, body: toDto(result) };
    } catch (e) {
      if (e instanceof TransientError) return unavailable('try again');
      throw e;
    }

    if (scoped) await this.idem.put(scoped, fingerprint(parsed.value), response);
    return response;
  }
}
`,
      },
      {
        path: "src/api/validation.ts",
        content: `import { LatLng, Product, RideRequest } from '../types';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isLatLng = (p: any): p is LatLng =>
  !!p && isNum(p.lat) && isNum(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
const PRODUCTS: Product[] = ['x', 'xl'];

export function parseRideRequest(body: any): { ok: true; value: RideRequest } | { ok: false; error: string } {
  if (!body || typeof body.riderId !== 'string' || !body.riderId) return { ok: false, error: 'riderId required' };
  if (!isLatLng(body.pickup)) return { ok: false, error: 'invalid pickup' };
  if (!isLatLng(body.dropoff)) return { ok: false, error: 'invalid dropoff' };
  const product = body.product ?? 'x';
  if (!PRODUCTS.includes(product)) return { ok: false, error: 'invalid product' };
  return {
    ok: true,
    value: {
      riderId: body.riderId,
      pickup: { lat: body.pickup.lat, lng: body.pickup.lng },
      dropoff: { lat: body.dropoff.lat, lng: body.dropoff.lng },
      product,
    },
  };
}

/**
 * Stable fingerprint of a parsed request: keys in a fixed order so that
 * \`{lat, lng}\` and \`{lng, lat}\` bodies hash the same.
 */
export function fingerprint(r: RideRequest): string {
  return [r.riderId, r.pickup.lat, r.pickup.lng, r.dropoff.lat, r.dropoff.lng, r.product].join('|');
}
`,
      },
      {
        path: "src/api/http.ts",
        content: `export interface HttpRequest {
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export const badRequest = (error: string): HttpResponse => ({ status: 400, body: { error } });
export const conflict = (error: string): HttpResponse => ({ status: 409, body: { error } });
export const unprocessable = (error: string): HttpResponse => ({ status: 422, body: { error } });
export const unavailable = (error: string): HttpResponse => ({ status: 503, body: { error } });
`,
      },
      {
        path: "src/dispatch/dispatcher.ts",
        content: `import { DispatchConfig, Ride } from '../types';
import { DriverStore } from '../store/driverStore';
import { RideStore } from '../store/rideStore';
import { PricingService } from '../pricing/pricing';
import { EventBus } from '../events/bus';
import { rankCandidates } from '../matching/ranker';

export class NotFoundError extends Error {}

/**
 * Assigns the best available driver to a requested ride.
 *
 * Called once per ride by the API layer. Many dispatches run concurrently
 * on the same Node process (one per in-flight request).
 */
export class Dispatcher {
  constructor(
    private drivers: DriverStore,
    private rides: RideStore,
    private pricing: PricingService,
    private bus: EventBus,
    private cfg: DispatchConfig,
  ) {}

  async dispatch(rideId: string): Promise<Ride> {
    const ride = await this.rides.get(rideId);
    if (!ride) throw new NotFoundError(\`ride \${rideId}\`);
    if (ride.status !== 'requested') return ride;

    const pool = await this.drivers.listAvailable();
    const candidates = rankCandidates(pool, ride.pickup, this.cfg).slice(0, this.cfg.maxAttempts);

    for (const cand of candidates) {
      // Re-read: the snapshot from listAvailable may be stale by now.
      const driver = await this.drivers.get(cand.id);
      if (!driver || driver.status !== 'available') continue;

      const quote = await this.pricing.quote(ride, driver);

      await this.drivers.put({ ...driver, status: 'assigned', rideId: ride.id });

      const assigned: Ride = { ...ride, status: 'assigned', driverId: driver.id, fareCents: quote.fareCents };
      await this.rides.put(assigned);
      this.bus.emit({ type: 'ride.assigned', rideId: ride.id, driverId: driver.id, fareCents: quote.fareCents });
      return assigned;
    }

    const failed: Ride = { ...ride, status: 'no_driver' };
    await this.rides.put(failed);
    this.bus.emit({ type: 'ride.no_driver', rideId: ride.id });
    return failed;
  }
}
`,
      },
      {
        path: "src/dispatch/retry.ts",
        content: `import { Clock } from '../util/io';

export interface RetryPolicy {
  /** Total attempts including the first one. */
  attempts: number;
  /** Errors for which a retry is pointless. */
  isRetryable: (e: unknown) => boolean;
}

export class TransientError extends Error {}

export const defaultPolicy: RetryPolicy = {
  attempts: 3,
  isRetryable: (e) => e instanceof TransientError,
};

/**
 * Retries \`fn\` up to \`policy.attempts\` times in total. The loop runs
 * attempts-1 retries after the first call; the final error is rethrown.
 *
 * Only safe for idempotent operations: a retried call may have taken
 * effect the first time even though we saw an error.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, policy: RetryPolicy = defaultPolicy, _clock?: Clock): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (!policy.isRetryable(e)) break;
    }
  }
  throw lastErr;
}
`,
      },
      {
        path: "src/store/driverStore.ts",
        content: `import { Driver } from '../types';
import { io } from '../util/io';

/**
 * Driver state store. Every method is async and yields \`latency\` times,
 * simulating a round trip to the backing database.
 *
 * Reads return copies: mutating a returned object never changes the store.
 */
export class DriverStore {
  private rows = new Map<string, Driver>();

  constructor(private latency = 1) {}

  seed(drivers: Omit<Driver, 'version'>[]): void {
    for (const d of drivers) this.rows.set(d.id, { ...d, version: 1 });
  }

  async get(id: string): Promise<Driver | undefined> {
    await io(this.latency);
    const d = this.rows.get(id);
    return d ? { ...d, location: { ...d.location } } : undefined;
  }

  async listAvailable(): Promise<Driver[]> {
    await io(this.latency);
    return [...this.rows.values()]
      .filter((d) => d.status === 'available')
      .map((d) => ({ ...d, location: { ...d.location } }));
  }

  /** Unconditional write (last writer wins). */
  async put(driver: Driver): Promise<void> {
    await io(this.latency);
    this.rows.set(driver.id, { ...driver, version: driver.version + 1 });
  }

  /**
   * Conditional write: applies \`patch\` only if the stored version still equals
   * \`expectedVersion\`. Mirrors a DynamoDB ConditionExpression on \`version\`.
   * Returns false (and writes nothing) if someone else wrote first.
   */
  async compareAndSet(id: string, expectedVersion: number, patch: Partial<Omit<Driver, 'id' | 'version'>>): Promise<boolean> {
    await io(this.latency);
    const cur = this.rows.get(id);
    if (!cur || cur.version !== expectedVersion) return false;
    this.rows.set(id, { ...cur, ...patch, version: cur.version + 1 });
    return true;
  }

  /** Test/ops helper: synchronous peek, no latency. */
  peek(id: string): Driver | undefined {
    const d = this.rows.get(id);
    return d ? { ...d } : undefined;
  }
}
`,
      },
      {
        path: "src/store/rideStore.ts",
        content: `import { Ride, RideRequest } from '../types';
import { io, IdGen, Clock } from '../util/io';

export class RideStore {
  private rows = new Map<string, Ride>();
  private ids = new IdGen('r');

  constructor(private clock: Clock, private latency = 1) {}

  async create(req: RideRequest): Promise<Ride> {
    await io(this.latency);
    const ride: Ride = { ...req, id: this.ids.next(), status: 'requested', createdAt: this.clock.now() };
    this.rows.set(ride.id, ride);
    return { ...ride };
  }

  async get(id: string): Promise<Ride | undefined> {
    await io(this.latency);
    const r = this.rows.get(id);
    return r ? { ...r } : undefined;
  }

  async put(ride: Ride): Promise<void> {
    await io(this.latency);
    this.rows.set(ride.id, { ...ride });
  }

  /** Synchronous peek for tests. */
  all(): Ride[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
`,
      },
      {
        path: "src/store/idempotencyStore.ts",
        content: `import { io } from '../util/io';
import { Clock } from '../util/io';

export interface IdempotencyRecord<T> {
  /** Hash of the request body that first used this key. */
  fingerprint: string;
  response: T;
  storedAt: number;
}

/**
 * Key/value store for idempotency records (Redis in production).
 * Records expire after \`ttlMs\`.
 */
export class IdempotencyStore<T> {
  private rows = new Map<string, IdempotencyRecord<T>>();

  constructor(private clock: Clock, private ttlMs: number, private latency = 1) {}

  async get(key: string): Promise<IdempotencyRecord<T> | undefined> {
    await io(this.latency);
    const rec = this.rows.get(key);
    if (!rec) return undefined;
    if (this.clock.now() - rec.storedAt >= this.ttlMs) {
      this.rows.delete(key);
      return undefined;
    }
    return rec;
  }

  async put(key: string, fingerprint: string, response: T): Promise<void> {
    await io(this.latency);
    this.rows.set(key, { fingerprint, response, storedAt: this.clock.now() });
  }

  async delete(key: string): Promise<void> {
    await io(this.latency);
    this.rows.delete(key);
  }

  size(): number {
    return this.rows.size;
  }
}
`,
      },
      {
        path: "src/matching/ranker.ts",
        content: `import { DispatchConfig, Driver, LatLng } from '../types';
import { distanceKm, etaMinutes } from './geo';

export interface Candidate {
  id: string;
  version: number;
  etaMin: number;
  score: number;
}

/**
 * Rank available drivers for a pickup. Lower score is better.
 *
 * score = ETA minutes + ratingPenaltyMin * (5 - rating)
 *
 * Ties are broken by driver id so that ranking is deterministic, which
 * matters for replaying incidents from logs.
 */
export function rankCandidates(drivers: Driver[], pickup: LatLng, cfg: DispatchConfig): Candidate[] {
  const out: Candidate[] = [];
  for (const d of drivers) {
    if (d.status !== 'available') continue;
    const km = distanceKm(d.location, pickup);
    if (km > cfg.maxPickupKm) continue;
    const etaMin = etaMinutes(km, cfg.avgSpeedKmh);
    const score = etaMin + cfg.ratingPenaltyMin * (5 - d.rating);
    out.push({ id: d.id, version: d.version, etaMin, score });
  }
  // Comparator returns negative/zero/positive; \`||\` falls through to the id
  // tie-break only when scores are exactly equal.
  return out.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
`,
      },
      {
        path: "src/matching/geo.ts",
        content: `import { LatLng } from '../types';

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance (haversine). Accurate to ~0.5% which is plenty for ETAs.
 * Note: \`Math.min(1, ...)\` guards against \`asin\` of 1.0000000000000002 from
 * floating point error for antipodal points; it is not a bug.
 */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes to cover \`km\` at \`speedKmh\`. */
export function etaMinutes(km: number, speedKmh: number): number {
  return (km / speedKmh) * 60;
}
`,
      },
      {
        path: "src/pricing/pricing.ts",
        content: `import { Driver, LatLng, Product, Ride } from '../types';
import { distanceKm } from '../matching/geo';
import { io } from '../util/io';

/**
 * Surge multipliers per 0.01-degree grid cell (~1km). Fetched from the
 * marketplace service; here an in-memory table with simulated latency.
 *
 * Cells are keyed with Math.floor so negative longitudes (e.g. -122.41)
 * land in the cell to their west, consistent with the marketplace service.
 */
export class SurgeTable {
  private cells = new Map<string, number>();

  constructor(private latency = 1) {}

  static cellOf(p: LatLng): string {
    return \`\${Math.floor(p.lat * 100)}:\${Math.floor(p.lng * 100)}\`;
  }

  set(p: LatLng, multiplier: number): void {
    this.cells.set(SurgeTable.cellOf(p), multiplier);
  }

  async multiplierAt(p: LatLng): Promise<number> {
    await io(this.latency);
    return this.cells.get(SurgeTable.cellOf(p)) ?? 1;
  }
}

export interface ProductPricing {
  baseCents: number;
  perKmCents: number;
  minimumCents: number;
}

export interface Quote {
  fareCents: number;
  surge: number;
}

export class PricingService {
  constructor(private table: Record<Product, ProductPricing>, private surge: SurgeTable) {}

  /**
   * Upfront fare. All money is integer cents; we round once, at the end,
   * after applying surge, so a 1.25x surge on 999 cents is 1249 not 1250.
   */
  async quote(ride: Ride, _driver: Driver): Promise<Quote> {
    const p = this.table[ride.product];
    if (!p) throw new Error(\`unknown product \${ride.product}\`);
    const surge = await this.surge.multiplierAt(ride.pickup);
    const km = distanceKm(ride.pickup, ride.dropoff);
    const raw = (p.baseCents + p.perKmCents * km) * surge;
    return { fareCents: Math.max(p.minimumCents, Math.floor(raw)), surge };
  }
}
`,
      },
      {
        path: "src/events/bus.ts",
        content: `export type RideEvent =
  | { type: 'ride.assigned'; rideId: string; driverId: string; fareCents: number }
  | { type: 'ride.no_driver'; rideId: string };

type Listener = (e: RideEvent) => void;

/** Synchronous in-process bus. Production publishes to Kafka after commit. */
export class EventBus {
  private listeners: Listener[] = [];
  readonly log: RideEvent[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(e: RideEvent): void {
    this.log.push(e);
    for (const l of this.listeners) l(e);
  }
}
`,
      },
      {
        path: "src/util/io.ts",
        content: `/**
 * Simulated I/O latency for the in-memory adapters.
 *
 * Production talks to DynamoDB / Redis. In this repo every store call
 * yields to the event loop \`hops\` times instead of sleeping, so that
 * concurrent requests interleave exactly like they would against a real
 * network, but deterministically (no timers, no randomness).
 */
export async function io(hops = 1): Promise<void> {
  for (let i = 0; i < hops; i++) {
    await Promise.resolve();
  }
}

/** Deterministic id generator; production uses ULIDs. */
export class IdGen {
  private n = 0;
  constructor(private prefix: string) {}
  next(): string {
    this.n += 1;
    return \`\${this.prefix}\${this.n}\`;
  }
}

export interface Clock {
  now(): number;
}

/** Manually advanced clock used by tests and the demo. */
export class FakeClock implements Clock {
  constructor(private t = 1_700_000_000_000) {}
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
        path: "src/demo.ts",
        content: `import { buildApp } from './app';

// Two drivers near Union Square. d1 is closer to everyone.
const app = buildApp({
  drivers: [
    { id: 'd1', location: { lat: 37.788, lng: -122.4075 }, status: 'available', rating: 4.9 },
    { id: 'd2', location: { lat: 37.781, lng: -122.4115 }, status: 'available', rating: 4.9 },
  ],
});

const trip = (riderId: string) => ({
  riderId,
  pickup: { lat: 37.7880, lng: -122.4074 },
  dropoff: { lat: 37.7790, lng: -122.4190 },
  product: 'x',
});

async function main() {
  // Alice and Bob tap "Request" at the same moment.
  const [a, b] = await Promise.all([
    app.api.create({ headers: {}, body: trip('alice') }),
    app.api.create({ headers: {}, body: trip('bob') }),
  ]);
  // Carol requests after both have returned.
  const c = await app.api.create({ headers: {}, body: trip('carol') });

  for (const [name, res] of [['alice', a], ['bob', b], ['carol', c]] as const) {
    const body = res.body as { id: string; status: string; driverId: string | null };
    console.log(\`\${name} \${body.id} \${body.status} \${body.driverId}\`);
  }
  const d1 = app.drivers.peek('d1')!;
  const d2 = app.drivers.peek('d2')!;
  console.log(\`d1 \${d1.status} \${d1.rideId} v\${d1.version}\`);
  console.log(\`d2 \${d2.status} \${d2.rideId ?? '-'} v\${d2.version}\`);
}

main();
`,
      },
      {
        path: "tests/dispatcher.test.ts",
        content: `import { rankCandidates } from '../src/matching/ranker';
import { Driver } from '../src/types';
import { buildApp } from '../src/app';

const body = (riderId: string) => ({
  riderId,
  pickup: { lat: 37.788, lng: -122.4074 },
  dropoff: { lat: 37.779, lng: -122.419 },
  product: 'x',
});

test('single request gets the nearest driver', async () => {
  const app = buildApp({
    drivers: [
      { id: 'd1', location: { lat: 37.788, lng: -122.4075 }, status: 'available', rating: 5 },
      { id: 'd2', location: { lat: 37.781, lng: -122.4115 }, status: 'available', rating: 5 },
    ],
  });
  const res = await app.api.create({ headers: {}, body: body('alice') });
  expect(res.status).toBe(201);
  expect((res.body as any).driverId).toBe('d1');
  expect(app.drivers.peek('d1')!.status).toBe('assigned');
});

test('no drivers nearby -> no_driver', async () => {
  const app = buildApp({ drivers: [] });
  const res = await app.api.create({ headers: {}, body: body('alice') });
  expect((res.body as any).status).toBe('no_driver');
});

test('sequential retry with the same key returns the same ride', async () => {
  const app = buildApp({
    drivers: [{ id: 'd1', location: { lat: 37.788, lng: -122.4075 }, status: 'available', rating: 5 }],
  });
  const req = { headers: { 'idempotency-key': 'k1' }, body: body('alice') };
  const first = await app.api.create(req);
  const second = await app.api.create(req);
  expect(second).toEqual(first);
  expect(app.rides.all()).toHaveLength(1);
});


const cfg = { maxPickupKm: 5, maxAttempts: 3, avgSpeedKmh: 30, ratingPenaltyMin: 2 };
const drv = (id: string, lat: number, rating = 5): Driver => ({
  id, location: { lat, lng: -122.4 }, status: 'available', rating, version: 1,
});

test('closer driver ranks first', () => {
  const out = rankCandidates([drv('far', 37.80), drv('near', 37.781)], { lat: 37.78, lng: -122.4 }, cfg);
  expect(out.map((c) => c.id)).toEqual(['near', 'far']);
});

test('drivers outside the radius are dropped', () => {
  const out = rankCandidates([drv('a', 37.78), drv('b', 38.5)], { lat: 37.78, lng: -122.4 }, cfg);
  expect(out.map((c) => c.id)).toEqual(['a']);
});

test('ties break by id', () => {
  const out = rankCandidates([drv('b', 37.79), drv('a', 37.79)], { lat: 37.78, lng: -122.4 }, cfg);
  expect(out.map((c) => c.id)).toEqual(['a', 'b']);
});
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
`,
        language: "json",
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: what is actually true here?",
        prompt: "Spend a few minutes in the repo before touching anything. Which statements are **true**? Select all that apply.",
        options: [
          "Every store method yields to the event loop (`io()`), so two in-flight requests can interleave at **any** `await` in the dispatch path.",
          "`rankCandidates` compares driver ids even when scores differ, because `||` always evaluates its right-hand side.",
          "`DriverStore.get` returns a copy, so mutating the returned driver does not change the stored row until a write method is called.",
          "Idempotency keys are scoped per rider, so two riders who happen to send the same key do not collide.",
          "`DriverStore.compareAndSet` exists but nothing in the dispatch path calls it today.",
          "`SurgeTable.cellOf` misplaces negative longitudes because `Math.floor(-12241.5)` is -12242; it should use `Math.trunc`.",
        ],
        correct: [
          0,
          2,
          3,
          4,
        ],
        hints: [
          "Open `src/util/io.ts` and every file under `src/store`. What does each method do before touching `rows`?",
          "`a || b` only evaluates `b` when `a` is falsy. When is `a.score - b.score` falsy?",
          "Search for `compareAndSet(`. Read the comment above `cellOf` before you call it a bug.",
        ],
        explanation: `* **True.** Each store method begins with \`await io(latency)\`, which is a loop of \`await Promise.resolve()\`. Every \`await\` is a point where another request's continuation can run, which is exactly how two dispatches interleave in production against DynamoDB.
* **False.** \`a.score - b.score || ...\` only reaches the id comparison when the score difference is \`0\` (falsy). This is the standard multi-key comparator idiom and a deliberate red herring.
* **True.** \`get\` spreads the row (and \`location\`). That matters later: the dispatcher's \`driver\` is a **snapshot**, and its \`version\` is the version *at read time*.
* **True.** \`scoped = \\\`\${riderId}:\${key}\\\`\`.
* **True.** The conditional write is already implemented and unused. Real codebases often contain the right primitive, unused, next to the bug.
* **False.** Flooring is intentional and documented: it must match the marketplace service's grid. \`Math.trunc\` would merge two cells around the prime meridian and the equator.

Orientation in a code comprehension round is about building a model of **where control can switch**. Here the answer is "at every \`await\`". You will need that model for every following stage.`,
        timeLimitSec: 300,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace POST /rides with an Idempotency-Key",
        prompt: "A rider sends `POST /rides` with header `Idempotency-Key: k1`. The key has never been seen and a driver is available. Put the steps in the order they **execute**.",
        items: [
          "`parseRideRequest` validates the body and normalises product to `x`",
          "`IdempotencyStore.get(\"<riderId>:k1\")` misses",
          "`RideStore.create` inserts the ride with status `requested`",
          "`Dispatcher.dispatch` re-reads the ride and calls `DriverStore.listAvailable`",
          "`rankCandidates` drops drivers beyond `maxPickupKm` and sorts by score, then id",
          "`DriverStore.get` re-reads the top candidate and checks it is still `available`",
          "`PricingService.quote` awaits `SurgeTable.multiplierAt` and computes integer cents",
          "`DriverStore.put` marks the driver `assigned`, then `RideStore.put` and the `ride.assigned` event",
          "`IdempotencyStore.put` stores the 201 response under the scoped key",
        ],
        hints: [
          "Start in `src/api/rides.ts`; `src/app.ts` only wires dependencies.",
          "Inside `dispatch`, the quote is computed **before** the driver is written.",
        ],
        explanation: `Controller → validation → idempotency lookup → ride insert → dispatcher (ride re-read, candidate list, ranking, candidate re-read, **quote**, driver write, ride write + event) → idempotency write.

Two things worth noticing for the rest of the interview:

1. Between "re-read the candidate and check \`available\`" and "write \`assigned\`" there are **two** awaits (the surge lookup and the put's own I/O). That gap is a classic check-then-act window.
2. The idempotency record is written only at the very end. Anything that arrives with the same key before that point sees a miss.`,
        timeLimitSec: 360,
        focusFile: "src/api/rides.ts",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Reproduce Friday 18:02",
        prompt: "`src/demo.ts` replays the incident: Alice and Bob request at the same instant (`Promise.all`), then Carol requests after both have returned. Predict **exactly** what it prints. Pay attention to the `version` column.",
        entry: "src/demo.ts",
        answer: `alice r1 assigned d1
bob r2 assigned d1
carol r3 assigned d2
d1 assigned r2 v2
d2 assigned r3 v2`,
        options: [
          `alice r1 assigned d1
bob r2 assigned d2
carol r3 no_driver null
d1 assigned r1 v2
d2 assigned r2 v2`,
          `alice r1 assigned d1
bob r2 assigned d1
carol r3 assigned d2
d1 assigned r2 v3
d2 assigned r3 v2`,
          `alice r1 assigned d1
bob r2 assigned d1
carol r3 assigned d2
d1 assigned r1 v2
d2 assigned r3 v2`,
          `alice r1 assigned d1
bob r2 assigned d1
carol r3 assigned d2
d1 assigned r2 v2
d2 assigned r3 v2`,
          `alice r1 assigned d1
bob r2 assigned d1
carol r3 no_driver null
d1 assigned r2 v3
d2 available - v1`,
        ],
        hints: [
          "Alice's and Bob's requests run the same code with the same latency. Who is one microtask ahead at every step, and does that ever let Alice's write land before Bob's read?",
          "Bob's `DriverStore.get(d1)` resolves right after Alice's. Alice's write needs two more awaits (surge lookup, put). What did Bob see?",
          "Look at how `put` computes the new version: from the stored row, or from the object you pass in?",
        ],
        explanation: `**The interleaving.** Both requests execute the identical sequence of awaits with identical latency, so they advance in lockstep with Alice exactly one microtask ahead (her chain was started first and the microtask queue is FIFO). So: Alice's ride insert runs first (**r1**), Bob's second (**r2**). Both \`listAvailable\` calls see d1 and d2; both rank d1 first. Alice's \`get(d1)\` resolves, then Bob's \`get(d1)\`. Both see \`available, version 1\`. Only then do the surge lookups and \`put\`s run. Alice's put lands, then Bob's put **overwrites** it.

* Both responses say \`d1\` because each request returns its own local \`assigned\` object. Nothing re-checks the store.
* \`d1.rideId\` is **r2**. Last writer wins.
* \`d1.version\` is **v2**, not v3. \`put\` stores \`driver.version + 1\` computed from the *caller's snapshot* (version 1), not from the stored row. Both writes produce 2. The lost update is invisible in the version history too. This is why an unconditional write plus a version field gives you no protection.
* Carol runs alone afterwards: only d2 is \`available\`, so she gets d2 (v1 → v2).

The fix needs the write to be **conditional** on what was read. That's the next stage.`,
        timeLimitSec: 540,
        focusFile: "src/demo.ts",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Enforce invariant 1: one car, one ride",
        prompt: `Fix the dispatcher so that **a driver is never assigned to two rides**, no matter how requests interleave or how slow the surge lookup is.

Requirements:
* A request that loses a race for a driver must move on to its next ranked candidate (up to \`maxAttempts\`), and end as \`no_driver\` only if every candidate is taken.
* Every assigned ride's \`driverId\` must point to a driver whose \`rideId\` is that ride.
* A pricing failure (\`TransientError\`) must not leave a driver claimed with no ride.

Keep the change minimal. The visible tests in \`tests/\` must keep passing.`,
        editable: [
          "src/dispatch/dispatcher.ts",
          "src/store/driverStore.ts",
        ],
        tests: [
          {
            path: "race.test.ts",
            content: `import { buildApp } from '../src/app';
import { TransientError } from '../src/dispatch/retry';

const near = (id: string, dLat: number) => ({
  id, location: { lat: 37.788 - dLat, lng: -122.4075 }, status: 'available' as const, rating: 5,
});
const body = (riderId: string) => ({
  riderId,
  pickup: { lat: 37.788, lng: -122.4074 },
  dropoff: { lat: 37.779, lng: -122.419 },
  product: 'x',
});

function consistent(app: ReturnType<typeof buildApp>) {
  const rides = app.rides.all().filter((r) => r.status === 'assigned');
  const ids = rides.map((r) => r.driverId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of rides) {
    const d = app.drivers.peek(r.driverId!)!;
    expect(d.status).toBe('assigned');
    expect(d.rideId).toBe(r.id);
  }
  return rides;
}

test('two simultaneous requests get two different drivers', async () => {
  const app = buildApp({ drivers: [near('d1', 0), near('d2', 0.004)] });
  const [a, b] = await Promise.all([
    app.api.create({ headers: {}, body: body('alice') }),
    app.api.create({ headers: {}, body: body('bob') }),
  ]);
  expect((a.body as any).driverId).toBe('d1');
  expect((b.body as any).driverId).toBe('d2');
  expect(consistent(app)).toHaveLength(2);
});

test('loser of a race falls through to the next candidate (3 riders, 3 drivers)', async () => {
  const app = buildApp({ drivers: [near('d1', 0), near('d2', 0.003), near('d3', 0.006)] });
  const res = await Promise.all(['a', 'b', 'c'].map((r) => app.api.create({ headers: {}, body: body(r) })));
  expect(res.map((r) => (r.body as any).status)).toEqual(['assigned', 'assigned', 'assigned']);
  expect(consistent(app)).toHaveLength(3);
});

test('more riders than drivers: extras get no_driver, never a shared car', async () => {
  const app = buildApp({ drivers: [near('d1', 0), near('d2', 0.004)], latency: 2 });
  const res = await Promise.all(['a', 'b', 'c', 'd'].map((r) => app.api.create({ headers: {}, body: body(r) })));
  const statuses = res.map((r) => (r.body as any).status).sort();
  expect(statuses).toEqual(['assigned', 'assigned', 'no_driver', 'no_driver']);
  expect(consistent(app)).toHaveLength(2);
  const assignedEvents = app.bus.log.filter((e) => e.type === 'ride.assigned');
  expect(assignedEvents).toHaveLength(2);
});

test('slow surge lookups widen the window but must not break the invariant', async () => {
  const app = buildApp({ drivers: [near('d1', 0), near('d2', 0.004)], surgeLatency: 7 });
  await Promise.all(['a', 'b'].map((r) => app.api.create({ headers: {}, body: body(r) })));
  expect(consistent(app)).toHaveLength(2);
});

test('pricing failure leaves the driver available (no orphaned claim)', async () => {
  const app = buildApp({ drivers: [near('d1', 0)] });
  app.surge.multiplierAt = async () => {
    throw new TransientError('surge service down');
  };
  const res = await app.api.create({ headers: {}, body: body('alice') });
  expect(res.status).toBe(503);
  expect(app.drivers.peek('d1')!.status).toBe('available');
});
`,
          },
        ],
        solution: {
          "src/dispatch/dispatcher.ts": `import { DispatchConfig, Ride } from '../types';
import { DriverStore } from '../store/driverStore';
import { RideStore } from '../store/rideStore';
import { PricingService } from '../pricing/pricing';
import { EventBus } from '../events/bus';
import { rankCandidates } from '../matching/ranker';

export class NotFoundError extends Error {}

/**
 * Assigns the best available driver to a requested ride.
 *
 * Called once per ride by the API layer. Many dispatches run concurrently
 * on the same Node process (one per in-flight request).
 */
export class Dispatcher {
  constructor(
    private drivers: DriverStore,
    private rides: RideStore,
    private pricing: PricingService,
    private bus: EventBus,
    private cfg: DispatchConfig,
  ) {}

  async dispatch(rideId: string): Promise<Ride> {
    const ride = await this.rides.get(rideId);
    if (!ride) throw new NotFoundError(\`ride \${rideId}\`);
    if (ride.status !== 'requested') return ride;

    const pool = await this.drivers.listAvailable();
    const candidates = rankCandidates(pool, ride.pickup, this.cfg).slice(0, this.cfg.maxAttempts);

    for (const cand of candidates) {
      // Re-read: the snapshot from listAvailable may be stale by now.
      const driver = await this.drivers.get(cand.id);
      if (!driver || driver.status !== 'available') continue;

      const quote = await this.pricing.quote(ride, driver);

      // Claim atomically: fails if anyone wrote the driver since our read.
      const claimed = await this.drivers.compareAndSet(driver.id, driver.version, { status: 'assigned', rideId: ride.id });
      if (!claimed) continue;

      const assigned: Ride = { ...ride, status: 'assigned', driverId: driver.id, fareCents: quote.fareCents };
      await this.rides.put(assigned);
      this.bus.emit({ type: 'ride.assigned', rideId: ride.id, driverId: driver.id, fareCents: quote.fareCents });
      return assigned;
    }

    const failed: Ride = { ...ride, status: 'no_driver' };
    await this.rides.put(failed);
    this.bus.emit({ type: 'ride.no_driver', rideId: ride.id });
    return failed;
  }
}
`,
        },
        hints: [
          "A JavaScript mutex is not needed. The store already has a primitive that makes check-and-write a single atomic step.",
          "`compareAndSet(id, expectedVersion, patch)` evaluates the condition and writes in the same synchronous block after its I/O hop, so nothing can interleave between them.",
          "Use the `version` from the `get` snapshot. If the CAS returns false, `continue` to the next candidate. If you claim *before* quoting, you must release the driver when `quote` throws.",
        ],
        explanation: `Replace the unconditional \`put\` with an optimistic-concurrency write:

\`\`\`ts
const claimed = await this.drivers.compareAndSet(driver.id, driver.version, { status: 'assigned', rideId: ride.id });
if (!claimed) continue; // someone else got this driver; try the next candidate
\`\`\`

**Why it works.** \`compareAndSet\` checks \`cur.version === expectedVersion\` and writes in one synchronous block after its I/O hop. In a single-threaded runtime no other continuation can run in between. In production the same guarantee comes from a DynamoDB \`ConditionExpression\` or \`UPDATE ... WHERE version = ?\`. The loser sees \`false\` and falls through to the next candidate.

**Why not a lock or a re-check?**
* Re-reading the driver right before \`put\` only shrinks the window: there is still an \`await\` between the read and the write.
* An in-process mutex works on one Node process and silently fails the day you run two (stage 7).

**Ordering choice.** Quote first, then CAS (the reference solution) means a pricing failure never claims anyone. If you claim first (a shorter window, and you don't quote a driver you can't get), you must release the driver in a \`catch\`, also with CAS (\`expectedVersion = version + 1\`), or a surge outage strands drivers as \`assigned\` forever. The last hidden test guards against that.`,
        timeLimitSec: 720,
        focusFile: "src/dispatch/dispatcher.ts",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Review: in-flight coalescing for retries",
        prompt: "Now invariant 2. The assistant produced a patch for `src/api/rides.ts`. Review it as you would in a real PR: decide whether to accept it and identify the most important problem.",
        persona: "confident-intern",
        request: "Make POST /rides idempotent for retries, including retries that arrive while the first attempt is still running. Same key + different body should 422.",
        aiReply: `Here's a clean in-flight coalescing layer. Duplicates that arrive while the first request is running join its promise; ones that arrive later are replayed from the store. I also added the 422 fingerprint check and made sure 503s are not cached.

\`\`\`ts
// src/api/rides.ts
const KEY_REUSED = 'Idempotency-Key reused with a different request body';

export class RidesController {
  private inflight = new Map<string, { fp: string; promise: Promise<HttpResponse> }>();

  constructor(private rides: RideStore, private dispatcher: Dispatcher, private idem: IdempotencyStore<HttpResponse>) {}

  async create(req: HttpRequest): Promise<HttpResponse> {
    const parsed = parseRideRequest(req.body);
    if (!parsed.ok) return badRequest(parsed.error);
    const key = req.headers['idempotency-key'];
    if (!key) return this.execute(parsed.value);

    const scoped = \`\${parsed.value.riderId}:\${key}\`;
    const fp = fingerprint(parsed.value);

    // 1. Already running in this process? Join it.
    const running = this.inflight.get(scoped);
    if (running) return running.fp === fp ? running.promise : unprocessable(KEY_REUSED);

    // 2. Already finished? Replay it.
    const hit = await this.idem.get(scoped);
    if (hit) return hit.fingerprint === fp ? hit.response : unprocessable(KEY_REUSED);

    // 3. First time: run it and let duplicates join.
    const promise = this.execute(parsed.value);
    this.inflight.set(scoped, { fp, promise });
    try {
      const response = await promise;
      if (response.status !== 503) await this.idem.put(scoped, fp, response);
      return response;
    } finally {
      this.inflight.delete(scoped);
    }
  }

  private async execute(value: RideRequest): Promise<HttpResponse> {
    try {
      const ride = await this.rides.create(value);
      const result = await this.dispatcher.dispatch(ride.id);
      return { status: 201, body: toDto(result) };
    } catch (e) {
      if (e instanceof TransientError) return unavailable('try again');
      throw e;
    }
  }
}
\`\`\`

Since Node is single-threaded the \`Map\` needs no locking. Ship it! 🚀`,
        options: [
          "Accept: the patch satisfies invariants 2-4.",
          "Reject: the in-flight check and the registration are separated by `await this.idem.get(...)`. Two simultaneous duplicates both see an empty map, both miss the store, and both dispatch a car.",
          "Reject: `finally` removes the in-flight entry before the response is persisted, so a retry that arrives just after completion dispatches again.",
          "Reject: a `Map` shared across concurrent requests needs a mutex, otherwise two requests can corrupt it.",
          "Reject: joining `running.promise` hands the duplicate the same response object, so the two HTTP responses alias each other.",
        ],
        correct: 1,
        hints: [
          "Mark every `await` in `create`. For each, ask: what can another request with the same key do while this one is suspended here?",
          "Simulate two identical requests started in the same tick. What does each one see at step 1? Where are they when step 3 runs?",
        ],
        explanation: `The bug is a **check-then-act across an await**, the same shape as stage 3:

1. Request A checks \`inflight\`: empty. It suspends on \`idem.get\`.
2. Request B (same key, same tick) checks \`inflight\`: still empty. It suspends on \`idem.get\`.
3. Both gets miss. A registers and executes. B **doesn't re-check**: it overwrites the map entry and executes too. Two rides, two cars.

The fix is to **check and register with no \`await\` in between**: look up \`inflight\` and \`set\` it synchronously, and do the durable-store lookup *inside* the registered promise.

Why the other options are wrong:
* \`finally\` runs after \`await this.idem.put(...)\` has completed, so the durable record exists before the in-flight entry disappears. A later retry hits the store.
* JavaScript runs one continuation at a time; \`Map.get\`/\`set\` can't be torn. The danger is never "two threads in the Map", it's *logical* races across awaits.
* Sharing the same response object is harmless: it's serialized per HTTP response.
* 503s really aren't cached (\`status !== 503\`), which is correct for invariant 4.

The assistant's claim "single-threaded, so no locking needed" is half true, and that half is what makes the bug easy to miss.`,
        timeLimitSec: 480,
        focusFile: "src/api/rides.ts",
      },
      {
        id: "s6",
        kind: "code",
        task: "feature",
        title: "Ship idempotent POST /rides",
        prompt: `Implement invariants 2-4 from the README in \`src/api/rides.ts\`:

* Same rider + same \`Idempotency-Key\` + same body → exactly **one** dispatch. Every duplicate gets the same response, whether it arrives concurrently, mid-flight, or after completion.
* Same rider + key, **different** body → \`422\`. This applies both when the original is still running and when it has finished.
* A request that ended in \`503\` (transient failure) must not poison the key: the retry is processed normally.
* Requests without a key behave exactly as today and are never stored.

Assume a single Node process for now (stage 7 is about scaling out).`,
        editable: [
          "src/api/rides.ts",
          "src/store/idempotencyStore.ts",
        ],
        tests: [
          {
            path: "idempotency.test.ts",
            content: `import { buildApp } from '../src/app';
import { TransientError } from '../src/dispatch/retry';

const drivers = [
  { id: 'd1', location: { lat: 37.788, lng: -122.4075 }, status: 'available' as const, rating: 5 },
  { id: 'd2', location: { lat: 37.784, lng: -122.4075 }, status: 'available' as const, rating: 5 },
  { id: 'd3', location: { lat: 37.780, lng: -122.4075 }, status: 'available' as const, rating: 5 },
];
const body = (riderId: string, product = 'x') => ({
  riderId,
  pickup: { lat: 37.788, lng: -122.4074 },
  dropoff: { lat: 37.779, lng: -122.419 },
  product,
});
const withKey = (k: string, b: unknown) => ({ headers: { 'idempotency-key': k }, body: b });

test('concurrent duplicates dispatch exactly once and share the response', async () => {
  const app = buildApp({ drivers });
  const res = await Promise.all([1, 2, 3].map(() => app.api.create(withKey('k1', body('alice')))));
  expect(app.rides.all()).toHaveLength(1);
  expect(res[1]).toEqual(res[0]);
  expect(res[2]).toEqual(res[0]);
  expect(app.bus.log.filter((e) => e.type === 'ride.assigned')).toHaveLength(1);
});

test('a retry that arrives mid-flight is coalesced', async () => {
  const app = buildApp({ drivers, latency: 3 });
  const first = app.api.create(withKey('k1', body('alice')));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const second = app.api.create(withKey('k1', body('alice')));
  const [a, b] = await Promise.all([first, second]);
  expect(b).toEqual(a);
  expect(app.rides.all()).toHaveLength(1);
});

test('completed request is replayed from the store afterwards', async () => {
  const app = buildApp({ drivers });
  const a = await app.api.create(withKey('k1', body('alice')));
  const b = await app.api.create(withKey('k1', body('alice')));
  expect(b).toEqual(a);
  expect(app.rides.all()).toHaveLength(1);
});

test('same key, different body -> 422 (sequential and concurrent)', async () => {
  const app = buildApp({ drivers });
  await app.api.create(withKey('k1', body('alice')));
  const seq = await app.api.create(withKey('k1', body('alice', 'xl')));
  expect(seq.status).toBe(422);

  const app2 = buildApp({ drivers });
  const [a, b] = await Promise.all([
    app2.api.create(withKey('k9', body('bob'))),
    app2.api.create(withKey('k9', body('bob', 'xl'))),
  ]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(422);
  expect(app2.rides.all()).toHaveLength(1);
});

test('keys are scoped per rider', async () => {
  const app = buildApp({ drivers });
  const [a, b] = await Promise.all([
    app.api.create(withKey('same', body('alice'))),
    app.api.create(withKey('same', body('bob'))),
  ]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(app.rides.all()).toHaveLength(2);
});

test('a transient failure does not poison the key', async () => {
  const app = buildApp({ drivers });
  const real = app.surge.multiplierAt.bind(app.surge);
  let calls = 0;
  app.surge.multiplierAt = async (p) => {
    calls += 1;
    if (calls === 1) throw new TransientError('surge down');
    return real(p);
  };
  const first = await app.api.create(withKey('k1', body('alice')));
  expect(first.status).toBe(503);
  const retry = await app.api.create(withKey('k1', body('alice')));
  expect(retry.status).toBe(201);
  expect((retry.body as any).status).toBe('assigned');
});

test('requests without a key are never cached', async () => {
  const app = buildApp({ drivers });
  await app.api.create({ headers: {}, body: body('alice') });
  await app.api.create({ headers: {}, body: body('alice') });
  expect(app.rides.all()).toHaveLength(2);
  expect(app.idem.size()).toBe(0);
});
`,
          },
        ],
        solution: {
          "src/api/rides.ts": `import { HttpRequest, HttpResponse, badRequest, unavailable, unprocessable } from './http';
import { parseRideRequest, fingerprint } from './validation';
import { RideStore } from '../store/rideStore';
import { IdempotencyStore } from '../store/idempotencyStore';
import { Dispatcher } from '../dispatch/dispatcher';
import { TransientError } from '../dispatch/retry';
import { Ride, RideRequest } from '../types';

export function toDto(r: Ride) {
  return { id: r.id, status: r.status, driverId: r.driverId ?? null, fareCents: r.fareCents ?? null };
}

const KEY_REUSED = 'Idempotency-Key reused with a different request body';

/**
 * POST /rides
 *
 * Mobile clients retry on timeouts with the same \`Idempotency-Key\` header.
 * A retried request must return the original ride and must never dispatch
 * a second car.
 */
export class RidesController {
  /** Requests currently executing in THIS process, by scoped key. */
  private inflight = new Map<string, { fp: string; promise: Promise<HttpResponse> }>();

  constructor(
    private rides: RideStore,
    private dispatcher: Dispatcher,
    private idem: IdempotencyStore<HttpResponse>,
  ) {}

  async create(req: HttpRequest): Promise<HttpResponse> {
    const parsed = parseRideRequest(req.body);
    if (!parsed.ok) return badRequest(parsed.error);
    const key = req.headers['idempotency-key'];
    if (!key) return this.execute(parsed.value);

    const scoped = \`\${parsed.value.riderId}:\${key}\`;
    const fp = fingerprint(parsed.value);

    // Check-and-register with NO await in between, so a concurrent duplicate
    // always observes the first request's entry.
    const running = this.inflight.get(scoped);
    if (running) {
      return running.fp === fp ? running.promise : unprocessable(KEY_REUSED);
    }
    const promise = this.runOnce(scoped, fp, parsed.value);
    this.inflight.set(scoped, { fp, promise });
    try {
      return await promise;
    } finally {
      // Safe to forget: runOnce has already persisted any cacheable response.
      this.inflight.delete(scoped);
    }
  }

  private async runOnce(scoped: string, fp: string, value: RideRequest): Promise<HttpResponse> {
    const hit = await this.idem.get(scoped);
    if (hit) return hit.fingerprint === fp ? hit.response : unprocessable(KEY_REUSED);

    const response = await this.execute(value);
    // Only cache final outcomes. A 503 must not poison the key: the client's
    // retry should get a fresh attempt.
    if (response.status < 500) await this.idem.put(scoped, fp, response);
    return response;
  }

  private async execute(value: RideRequest): Promise<HttpResponse> {
    try {
      const ride = await this.rides.create(value);
      const result = await this.dispatcher.dispatch(ride.id);
      return { status: 201, body: toDto(result) };
    } catch (e) {
      if (e instanceof TransientError) return unavailable('try again');
      throw e;
    }
  }
}
`,
        },
        hints: [
          "Keep a per-process `Map<scopedKey, { fp, promise }>`. The critical part is *where* you read and write it relative to awaits.",
          "Check and register the in-flight entry synchronously, before the first `await`. Then do the durable `idem.get` inside the promise you registered.",
          "Only persist responses with status < 500. Remove the in-flight entry in `finally`, after the durable write has been awaited.",
        ],
        explanation: `Reference shape:

\`\`\`ts
const running = this.inflight.get(scoped);           // no await before this...
if (running) return running.fp === fp ? running.promise : unprocessable(KEY_REUSED);
const promise = this.runOnce(scoped, fp, value);     // ...or between get and set
this.inflight.set(scoped, { fp, promise });
try { return await promise; } finally { this.inflight.delete(scoped); }
\`\`\`

\`runOnce\` checks the durable store (and returns 422 on a fingerprint mismatch), executes, and persists only non-5xx responses **before** resolving.

Why each piece matters:
* **Synchronous check-and-register** closes the window from the review stage. Every continuation that reaches this code after A has registered sees A's entry.
* **Durable write before \`finally\`** closes the hand-off gap: there is no moment when the key is in neither the map nor the store.
* **Fingerprint on both paths**: a client reusing a key with a different body is buggy. Silently returning the old ride would hide that bug, so 422 surfaces it.
* **Not caching 5xx**: an idempotency layer that remembers transient failures turns a 2-second outage into a 24-hour outage for those riders.

This is the same pattern as Stripe's and AWS's idempotency layers, except they replace the in-process map with an atomic "insert pending record" in the shared store (next stage).`,
        timeLimitSec: 900,
        focusFile: "src/api/rides.ts",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Follow-up: four processes behind a load balancer",
        prompt: "Traffic doubles and the service now runs as **4 Node processes** behind a round-robin load balancer. `DriverStore` is DynamoDB (conditional writes supported) and `IdempotencyStore` is Redis. With your fixes from stages 4 and 6 in place, which statements are **true**? Select all that apply.",
        options: [
          "The CAS-based driver claim still guarantees invariant 1 across processes, because the version condition is evaluated atomically by the database, not by Node.",
          "The in-memory `inflight` map no longer coalesces duplicates that land on different processes. You need an atomic \"create pending record if absent\" (e.g. Redis `SET key pending NX PX <lease>`) before dispatching, with duplicates told to wait/poll or receiving 409.",
          "Because each Node process is single-threaded, cross-process races are impossible; only the load balancer needs sticky sessions.",
          "A pending idempotency record needs a lease/TTL (or a fencing token): if the process that wrote it crashes mid-dispatch, the key would otherwise be stuck forever.",
          "Wrapping `Dispatcher.dispatch` in a per-process async mutex would make the CAS unnecessary.",
          "Useful production signals: rate of CAS failures per dispatch (contention), count of rides ending `no_driver` while drivers were available, and idempotency joins/replays per minute (retry storms).",
        ],
        correct: [
          0,
          1,
          3,
          5,
        ],
        hints: [
          "For each guarantee, ask: which component enforces it? Is that component shared by all four processes?",
          "Single-threaded is a property of one process. What do four single-threaded processes sharing a database look like?",
        ],
        explanation: `* **True.** The CAS's correctness never depended on Node: the condition (\`version = expected\`) is checked by the store that all processes share. This is why stage 4 used CAS and not a mutex.
* **True.** The \`inflight\` map is per process. A client retry routed to another process misses both the map and (if the first attempt hasn't finished) the store. Scale-out needs the claim moved into the shared store: atomically insert a *pending* record, run, then overwrite it with the final response.
* **False.** Four single-threaded processes sharing a database race exactly like four threads. Sticky sessions don't help either: retries often come over a new connection or from a different edge.
* **True.** Any lock-like record needs a lease: a crashed holder must not block the key forever. Fencing tokens or version checks also stop a slow "zombie" holder from writing after its lease expired.
* **False.** A per-process mutex is exactly what breaks at 4 processes. It also serializes unrelated rides behind each other.
* **True.** CAS failure rate measures contention directly. \`no_driver\` while supply exists catches \`maxAttempts\` that is set too low under contention. Replay/join counts expose client retry storms before they become outages.`,
        timeLimitSec: 360,
      },
    ],
  },
  {
    id: "l5-sim-stripe-webhooks",
    title: "Webhooks at Least Once: Signatures, Retries and Time Travel",
    level: 5,
    rating: 2800,
    lang: "python",
    domain: "payments",
    companies: [
      "stripe",
    ],
    tags: [
      "interview-simulation",
      "webhooks",
      "idempotency",
      "out-of-order-events",
      "hmac",
      "timing-safe-compare",
    ],
    summary: "A payment shows \"processing\" after it succeeded and a retried webhook vanished. Trace, fix and extend a Stripe-style webhook processor.",
    context: `**Stripe-style integration round: 7 stages, one codebase, ~60 minutes.**

You've joined the team that owns \`payments-webhooks\`. Overnight, finance flagged two problems:

* \`pi_A\` is \`processing\` in our database but \`succeeded\` in the Stripe dashboard.
* \`pi_B\` was paid, but we have no record of it at all, even though Stripe shows the delivery was retried and acknowledged.

Start with \`README.md\`, especially *Delivery semantics you must design for*. Every handler must be correct under **at-least-once, unordered** delivery. The interviewer cares more about the invariants you state than about the code you type.`,
    persona: "outdated-docs",
    files: [
      {
        path: "README.md",
        content: `# payments-webhooks

Receives Stripe webhooks and keeps our \`payment_intents\` / \`charges\` tables and
the merchant ledger in sync.

\`\`\`
POST /webhooks/stripe
  └─ WebhookProcessor.handle(raw_body, Stripe-Signature)   webhooks/processor.py
       ├─ verify()            HMAC-SHA256 over "t.raw_body"  webhooks/signature.py
       ├─ parse_event()       envelope -> Event               webhooks/envelope.py
       ├─ ProcessedEvents     dedup by event id               webhooks/dedup.py
       ├─ route(type)         type -> handler                 webhooks/router.py
       └─ handler(event, ctx)                                 payments/handlers.py
            ├─ PaymentRepository (copy-on-read)               payments/repository.py
            └─ Ledger.post (integer cents)                    payments/ledger.py
\`\`\`

## Delivery semantics you must design for

* **At least once.** Any non-2xx (or a timeout) makes Stripe retry the same
  event id with backoff for up to 3 days.
* **No ordering guarantee.** \`payment_intent.processing\` can arrive after
  \`payment_intent.succeeded\`. Each event's \`data.object\` is a full snapshot as
  of \`event.created\` (unix seconds; several events can share a second).
* **Secret rotation.** While two signing secrets are active the header carries
  one \`v1=\` per secret: \`t=...,v1=<old>,v1=<new>\`.

## Refunds

\`charge.refunded\` is sent for every (partial) refund and carries the charge
snapshot with a **cumulative** \`amount_refunded\`. The ledger must be debited
by the increase only. Refunds are not handled yet (see PAY-412).

## Running

\`\`\`
python3 main.py                 # replays the 2024-03-11 incident
python3 -m pytest tests         # example tests
\`\`\`
`,
        language: "markdown",
      },
      {
        path: "docs/RUNBOOK.md",
        content: `# On-call runbook: payments-webhooks

## Alert: webhook 5xx rate > 1%
1. Check \`WebhookProcessor.errors\` in the debug endpoint for the failing event ids.
2. A 5xx is *safe* only if the event will be processed correctly when Stripe
   retries it. Confirm that before muting the alert.
3. Ledger timeouts (\`LedgerUnavailable\`) are the usual cause; they clear on their own.

## Alert: signature failures spike
* Almost always a secret rotation: the new \`whsec_\` was deployed to some pods
  but not others, or the dashboard rolled the secret without expiring the old one.
* Never "temporarily disable verification". A forged \`payment_intent.succeeded\`
  ships goods for free.

## Alert: payment shows \`processing\` in our DB but \`succeeded\` in the dashboard
* Look for out-of-order deliveries: an older snapshot applied after a newer one.
* Fix forward by replaying the newest event for that object from the dashboard.

## Reconciliation mismatches
* \`payments/reconcile.py\` runs nightly. A mismatch equal to an exact multiple
  of a refund amount usually means a refund was debited more than once.
`,
        language: "markdown",
      },
      {
        path: "config/settings.py",
        content: `"""Service configuration. Values are overridden from the environment in prod."""

# Signing secret for the endpoint, from the Stripe dashboard ("whsec_...").
WEBHOOK_SECRET = "whsec_test_5f1c0a9e7b2d4c68"

# Reject deliveries whose signed timestamp is older than this (replay window).
SIGNATURE_TOLERANCE_SECONDS = 300

# Upper bound on remembered event ids. Stripe retries a failed delivery for up
# to 3 days, far fewer events than this at our volume.
DEDUP_MAX_EVENTS = 100_000

LEDGER_MERCHANT_ACCOUNT = "merchant_balance"
`,
      },
      {
        path: "webhooks/processor.py",
        content: `"""HTTP-facing entry point: POST /webhooks/stripe -> WebhookProcessor.handle.

Response contract with Stripe:
  2xx  -> delivered, Stripe will not retry
  4xx  -> we rejected it (bad signature / malformed); Stripe retries, then gives up
  5xx  -> transient failure; Stripe retries with backoff for up to 3 days
"""
import time

from config import settings
from payments.handlers import HandlerContext
from payments.ledger import Ledger
from payments.repository import PaymentRepository
from webhooks.dedup import ProcessedEvents
from webhooks.envelope import MalformedEvent, parse_event
from webhooks.router import route
from webhooks.signature import SignatureError, verify


class WebhookProcessor:
    def __init__(self, secret, ctx, dedup, clock=time.time, tolerance=settings.SIGNATURE_TOLERANCE_SECONDS):
        self.secret = secret
        self.ctx = ctx
        self.dedup = dedup
        self.clock = clock
        self.tolerance = tolerance
        self.errors = []

    def handle(self, raw, sig_header):
        try:
            verify(raw, sig_header, self.secret, int(self.clock()), self.tolerance)
        except SignatureError as e:
            return 400, {"error": str(e)}

        try:
            event = parse_event(raw)
        except MalformedEvent as e:
            return 400, {"error": str(e)}

        if self.dedup.seen(event.id):
            return 200, {"status": "duplicate"}
        self.dedup.mark(event.id)

        handler = route(event.type)
        if handler is None:
            return 200, {"status": "ignored"}

        try:
            outcome = handler(event, self.ctx)
        except Exception as e:  # noqa: BLE001 - any failure is retryable for Stripe
            self.errors.append((event.id, repr(e)))
            return 500, {"error": "handler failed"}
        return 200, {"status": outcome or "processed"}


def build_processor(clock=time.time):
    """Composition root used by the web app, the demo and the tests."""
    ctx = HandlerContext(repo=PaymentRepository(), ledger=Ledger())
    dedup = ProcessedEvents(settings.DEDUP_MAX_EVENTS)
    return WebhookProcessor(settings.WEBHOOK_SECRET, ctx, dedup, clock=clock), ctx
`,
      },
      {
        path: "webhooks/signature.py",
        content: `"""Stripe-Signature header verification.

Header format:  t=1700000000,v1=<hex hmac>,v1=<hex hmac>,v0=<legacy>

The signed payload is  "<t>." + raw request body  (bytes, exactly as received).
During a secret rotation Stripe includes one v1 signature per active secret,
so a delivery is valid if ANY v1 matches ours.
"""
import hashlib
import hmac


class SignatureError(Exception):
    pass


def parse_header(header):
    """Return {scheme: [values...]}; repeated schemes are kept in order."""
    out = {}
    for item in header.split(","):
        key, sep, value = item.strip().partition("=")
        if not sep:
            continue
        out.setdefault(key, []).append(value)
    return out


def compute_signature(payload, timestamp, secret):
    signed = str(timestamp).encode() + b"." + payload
    return hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()


def verify(payload, header, secret, now, tolerance):
    """Raise SignatureError unless the header proves \`payload\` came from Stripe.

    Returns the signed timestamp on success.
    """
    if not header:
        raise SignatureError("missing header")
    parts = parse_header(header)
    try:
        timestamp = int(parts["t"][0])
    except (KeyError, IndexError, ValueError):
        raise SignatureError("bad timestamp")
    candidates = parts.get("v1", [])
    if not candidates:
        raise SignatureError("no v1 signature")

    expected = compute_signature(payload, timestamp, secret)
    if not any(sig == expected for sig in candidates):
        raise SignatureError("signature mismatch")
    if now - timestamp > tolerance:
        raise SignatureError("timestamp outside tolerance")
    return timestamp
`,
      },
      {
        path: "webhooks/envelope.py",
        content: `"""Parse the event envelope. Only called AFTER the signature has been verified."""
import json
from dataclasses import dataclass


class MalformedEvent(Exception):
    pass


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    created: int          # unix seconds, set by Stripe when the event was generated
    data: dict            # snapshot of the object (payment intent, charge, ...)
    livemode: bool = False


def parse_event(raw):
    try:
        doc = json.loads(raw)
    except ValueError:
        raise MalformedEvent("body is not JSON")
    obj = (doc.get("data") or {}).get("object")
    if not doc.get("id") or not doc.get("type") or obj is None or "created" not in doc:
        raise MalformedEvent("missing id/type/created/data.object")
    return Event(
        id=doc["id"],
        type=doc["type"],
        created=int(doc["created"]),
        data=obj,
        livemode=bool(doc.get("livemode", False)),
    )
`,
      },
      {
        path: "webhooks/dedup.py",
        content: `"""Remembers which event ids have been processed.

Bounded: once \`max_events\` ids are stored the oldest is forgotten. An event
that old will not be retried by Stripe anymore, so forgetting it is safe.
"""
from collections import OrderedDict


class ProcessedEvents:
    def __init__(self, max_events):
        self._max = max_events
        self._ids = OrderedDict()

    def seen(self, event_id):
        return event_id in self._ids

    def mark(self, event_id):
        self._ids[event_id] = True
        self._ids.move_to_end(event_id)
        while len(self._ids) > self._max:
            self._ids.popitem(last=False)

    def __len__(self):
        return len(self._ids)
`,
      },
      {
        path: "webhooks/router.py",
        content: `"""Maps event types to handlers. Unrouted types are acknowledged and ignored."""
from payments import handlers

ROUTES = {
    "payment_intent.created": handlers.on_payment_intent,
    "payment_intent.requires_action": handlers.on_payment_intent,
    "payment_intent.processing": handlers.on_payment_intent,
    "payment_intent.payment_failed": handlers.on_payment_intent,
    "payment_intent.succeeded": handlers.on_payment_intent,
    "payment_intent.canceled": handlers.on_payment_intent,
}


def route(event_type):
    return ROUTES.get(event_type)
`,
      },
      {
        path: "webhooks/http_adapter.py",
        content: `"""Thin WSGI adapter around WebhookProcessor.

IMPORTANT: the body is read as raw bytes and passed through untouched. Any
framework helper that parses JSON first (request.json, request.get_json())
would re-serialize it and break the signature check.
"""
import json


MAX_BODY_BYTES = 512 * 1024


def make_wsgi_app(processor):
    def app(environ, start_response):
        if environ.get("REQUEST_METHOD") != "POST" or environ.get("PATH_INFO") != "/webhooks/stripe":
            start_response("404 Not Found", [("Content-Type", "application/json")])
            return [b'{"error":"not found"}']

        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            start_response("413 Payload Too Large", [("Content-Type", "application/json")])
            return [b'{"error":"bad length"}']

        raw = environ["wsgi.input"].read(length)
        header = environ.get("HTTP_STRIPE_SIGNATURE", "")
        status, body = processor.handle(raw, header)
        reason = {200: "OK", 400: "Bad Request", 500: "Internal Server Error"}.get(status, "")
        start_response(f"{status} {reason}", [("Content-Type", "application/json")])
        return [json.dumps(body).encode()]

    return app
`,
      },
      {
        path: "payments/handlers.py",
        content: `"""Business handlers, one per family of event types.

Stripe does NOT guarantee delivery order, and may deliver the same logical
change more than once. Each event carries a full snapshot of the object
(\`event.data\`) as of \`event.created\`.
"""
from dataclasses import dataclass

from config import settings
from payments.ledger import Ledger
from payments.models import PaymentIntent
from payments.repository import PaymentRepository


@dataclass
class HandlerContext:
    repo: PaymentRepository
    ledger: Ledger


def on_payment_intent(event, ctx):
    obj = event.data
    pi = ctx.repo.get_payment_intent(obj["id"])
    if pi is None:
        pi = PaymentIntent(id=obj["id"], amount=obj["amount"], currency=obj["currency"], status=obj["status"])

    pi.status = obj["status"]
    pi.last_event_at = event.created

    if obj["status"] == "succeeded":
        received = obj.get("amount_received", obj["amount"])
        ctx.ledger.post(settings.LEDGER_MERCHANT_ACCOUNT, received, ref=f"{pi.id}:succeeded")
        pi.amount_received = received

    ctx.repo.save_payment_intent(pi)
    return "processed"
`,
      },
      {
        path: "payments/models.py",
        content: `from dataclasses import dataclass

# How far along the payment lifecycle a status is. Used to order updates that
# carry the SAME \`created\` second. Note a payment can legitimately move
# "backwards" (processing -> requires_payment_method after a failed attempt),
# so rank alone must never be used to reject an update with a newer timestamp.
STATUS_RANK = {
    "requires_payment_method": 0,
    "requires_confirmation": 1,
    "requires_action": 2,
    "processing": 3,
    "requires_capture": 4,
    "succeeded": 5,
    "canceled": 5,
}

# Once here, a payment intent never changes status again.
TERMINAL = frozenset({"succeeded", "canceled"})


@dataclass
class PaymentIntent:
    id: str
    amount: int                 # minor units (cents)
    currency: str
    status: str
    amount_received: int = 0
    last_event_at: int = 0      # \`created\` of the last event applied


@dataclass
class Charge:
    id: str
    payment_intent: str
    amount: int
    currency: str
    amount_refunded: int = 0    # cumulative, as reported by Stripe
    refunded: bool = False      # fully refunded
    last_event_at: int = 0
`,
      },
      {
        path: "payments/repository.py",
        content: `"""In-memory stand-in for the payments tables.

Like a real database, reads return COPIES: mutating a returned object has no
effect until it is passed to save_*().
"""
from dataclasses import replace


class PaymentRepository:
    def __init__(self):
        self._intents = {}
        self._charges = {}

    def get_payment_intent(self, pi_id):
        pi = self._intents.get(pi_id)
        return replace(pi) if pi else None

    def save_payment_intent(self, pi):
        self._intents[pi.id] = replace(pi)

    def get_charge(self, charge_id):
        ch = self._charges.get(charge_id)
        return replace(ch) if ch else None

    def save_charge(self, charge):
        self._charges[charge.id] = replace(charge)
`,
      },
      {
        path: "payments/ledger.py",
        content: `"""Double-entry-lite ledger: every money movement is an append-only entry."""
from dataclasses import dataclass


class LedgerUnavailable(Exception):
    """Simulates the ledger DB timing out. Transient: a retry may succeed."""


@dataclass(frozen=True)
class Entry:
    account: str
    amount: int       # cents; positive = credit, negative = debit
    ref: str          # human-readable reference for reconciliation


class Ledger:
    def __init__(self):
        self.entries = []
        self.fail_next = False

    def post(self, account, amount, ref):
        if self.fail_next:
            self.fail_next = False
            raise LedgerUnavailable("ledger timeout")
        if not isinstance(amount, int):
            raise TypeError("ledger amounts must be integer cents")
        self.entries.append(Entry(account, amount, ref))

    def balance(self, account):
        return sum(e.amount for e in self.entries if e.account == account)
`,
      },
      {
        path: "payments/money.py",
        content: `"""Money helpers. Everything internal is integer minor units."""

ZERO_DECIMAL = frozenset({"jpy", "krw", "vnd"})


def to_minor(amount_str, currency):
    """'12.34' usd -> 1234. Parses digits manually to avoid float rounding."""
    whole, _, frac = amount_str.partition(".")
    if currency in ZERO_DECIMAL:
        return int(whole)
    frac = (frac + "00")[:2]
    sign = -1 if whole.startswith("-") else 1
    return sign * (abs(int(whole)) * 100 + int(frac))


def fmt(cents, currency):
    if currency in ZERO_DECIMAL:
        return f"{cents} {currency.upper()}"
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d} {currency.upper()}"
`,
      },
      {
        path: "payments/reconcile.py",
        content: `"""Nightly reconciliation: compare our ledger with Stripe's balance report.

Runs as a cron job, not on the webhook path. Listed here because on-call
often looks at its output when webhooks misbehave.
"""
from collections import defaultdict


def summarize_ledger(ledger, account):
    """Group entries by the payment/charge id prefix of their ref."""
    by_object = defaultdict(int)
    for e in ledger.entries:
        if e.account != account:
            continue
        object_id = e.ref.split(":", 1)[0]
        by_object[object_id] += e.amount
    return dict(by_object)


def diff_against_report(ledger, account, report_rows):
    """\`report_rows\`: iterable of (object_id, net_cents) from Stripe's report.

    Returns a list of (object_id, ours, theirs) for every mismatch, sorted by
    id so the output is stable between runs.
    """
    ours = summarize_ledger(ledger, account)
    theirs = defaultdict(int)
    for object_id, net in report_rows:
        theirs[object_id] += net
    mismatches = []
    for object_id in sorted(set(ours) | set(theirs)):
        a, b = ours.get(object_id, 0), theirs.get(object_id, 0)
        if a != b:
            mismatches.append((object_id, a, b))
    return mismatches
`,
      },
      {
        path: "tools/sign.py",
        content: `"""Helpers to build signed deliveries for tests and local replay."""
import json

from webhooks.signature import compute_signature


def make_event(event_id, event_type, created, obj):
    doc = {"id": event_id, "object": "event", "type": event_type, "created": created,
           "livemode": False, "data": {"object": obj}}
    return json.dumps(doc, separators=(",", ":")).encode()


def sign(payload, secret, timestamp, extra_v1=()):
    """Build a Stripe-Signature header. \`extra_v1\` simulates secret rotation."""
    sigs = [f"v1={s}" for s in extra_v1] + [f"v1={compute_signature(payload, timestamp, secret)}"]
    return ",".join([f"t={timestamp}"] + sigs)
`,
      },
      {
        path: "main.py",
        content: `"""Replay a captured delivery sequence from the incident on 2024-03-11."""
from config.settings import WEBHOOK_SECRET
from tools.sign import make_event, sign
from webhooks.processor import build_processor

NOW = 1000
proc, ctx = build_processor(clock=lambda: NOW)


def pi(pid, status, amount=5000, **kw):
    return dict(id=pid, object="payment_intent", amount=amount, currency="usd", status=status, **kw)


def deliver(label, raw, ts=990, secret=WEBHOOK_SECRET):
    code, body = proc.handle(raw, sign(raw, secret, ts))
    print(label, code, body.get("status") or body.get("error"))


e1 = make_event("evt_1", "payment_intent.created", 900, pi("pi_A", "requires_payment_method"))
e2 = make_event("evt_2", "payment_intent.processing", 905, pi("pi_A", "processing"))
e3 = make_event("evt_3", "payment_intent.succeeded", 906, pi("pi_A", "succeeded", amount_received=5000))
e4 = make_event("evt_4", "payment_intent.succeeded", 950, pi("pi_B", "succeeded", amount=1200, amount_received=1200))

deliver("evt_1", e1)
deliver("evt_3", e3)
deliver("evt_2", e2)                 # delayed in Stripe's queue
deliver("evt_3", e3)                 # Stripe retry: our 200 was lost
ctx.ledger.fail_next = True
deliver("evt_4", e4)                 # ledger DB times out
deliver("evt_4", e4)                 # Stripe retries a minute later
deliver("evt_1", e1, secret="whsec_old")
deliver("evt_2", e2, ts=650)

a = ctx.repo.get_payment_intent("pi_A")
b = ctx.repo.get_payment_intent("pi_B")
print("pi_A", a.status, a.amount_received)
print("pi_B", b.status if b else None)
print("balance", ctx.ledger.balance("merchant_balance"))
`,
      },
      {
        path: "tests/test_signature.py",
        content: `from tools.sign import sign
from webhooks.signature import SignatureError, verify

SECRET = "whsec_unit"
BODY = b'{"id":"evt_x"}'


def test_valid_signature_returns_timestamp():
    assert verify(BODY, sign(BODY, SECRET, 100), SECRET, now=120, tolerance=300) == 100


def test_tampered_body_rejected():
    header = sign(BODY, SECRET, 100)
    try:
        verify(BODY + b" ", header, SECRET, now=120, tolerance=300)
        assert False, "expected SignatureError"
    except SignatureError:
        pass


def test_rotation_any_v1_may_match():
    header = sign(BODY, SECRET, 100, extra_v1=["deadbeef" * 8])
    assert header.count("v1=") == 2
    assert verify(BODY, header, SECRET, now=120, tolerance=300) == 100
`,
      },
      {
        path: "tests/test_processor.py",
        content: `from config.settings import WEBHOOK_SECRET
from tools.sign import make_event, sign
from webhooks.processor import build_processor


def deliver(proc, raw, ts=1000):
    return proc.handle(raw, sign(raw, WEBHOOK_SECRET, ts))


def test_success_credits_ledger_once_per_event_id():
    proc, ctx = build_processor(clock=lambda: 1000)
    raw = make_event("evt_1", "payment_intent.succeeded", 990,
                     {"id": "pi_1", "amount": 700, "currency": "usd", "status": "succeeded"})
    assert deliver(proc, raw) == (200, {"status": "processed"})
    assert deliver(proc, raw) == (200, {"status": "duplicate"})
    assert ctx.ledger.balance("merchant_balance") == 700


def test_unknown_event_type_is_acknowledged():
    proc, _ = build_processor(clock=lambda: 1000)
    raw = make_event("evt_9", "customer.created", 990, {"id": "cus_1"})
    assert deliver(proc, raw) == (200, {"status": "ignored"})
`,
      },
      {
        path: "tests/test_money.py",
        content: `from payments.money import fmt, to_minor


def test_to_minor_handles_short_fraction():
    assert to_minor("12.3", "usd") == 1230
    assert to_minor("-0.05", "usd") == -5


def test_zero_decimal_currency():
    assert to_minor("500", "jpy") == 500
    assert fmt(500, "jpy") == "500 JPY"


def test_fmt_negative():
    assert fmt(-1234, "usd") == "-12.34 USD"
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: what does this service guarantee today?",
        prompt: "Read the README and skim `webhooks/` and `payments/`. Which statements are **true** of the current code? Select all that apply.",
        options: [
          "The HMAC is computed over the raw request bytes exactly as received, not over re-serialized JSON.",
          "An event type with no route is answered with 200, so Stripe stops retrying it.",
          "Deduplication is keyed on the event id, so two different events about the same payment intent are both processed.",
          "`ProcessedEvents` evicts old ids, so in practice duplicates are almost never detected.",
          "Money is stored as float dollars and rounded when posted to the ledger.",
          "`PaymentRepository` returns live references, so a handler's mutations are visible to the next read even without `save_*`.",
        ],
        correct: [
          0,
          1,
          2,
        ],
        hints: [
          "Follow `raw` from `WebhookProcessor.handle` into `verify` and `compute_signature`. Also read the docstring in `http_adapter.py`.",
          "Check what `get_payment_intent` returns, and what `Ledger.post` does with a non-int amount.",
        ],
        explanation: `* **True.** \`compute_signature\` signs \`b"<t>." + payload\`, where \`payload\` is the untouched body. The WSGI adapter reads bytes and is explicit about never parsing first. Re-serializing JSON changes whitespace and key order and breaks every signature.
* **True.** Acknowledging unknown types is correct. Returning 4xx/5xx would make Stripe retry an event we will never handle, for three days.
* **True.** The dedup key is \`event.id\`. That protects against redelivery of the *same* event, and says nothing about two *different* events carrying conflicting snapshots of the same object, which is the ordering problem you'll hit next.
* **False.** The bound is 100k ids, which at this volume is far longer than Stripe's 3-day retry window. Eviction is a red herring.
* **False.** Everything is integer minor units: \`Ledger.post\` even raises \`TypeError\` for non-ints, and \`money.to_minor\` parses strings by hand to avoid floats.
* **False.** Reads return \`dataclasses.replace\` copies, so nothing changes until \`save_*\`. Remember this for the next stage: a handler that raises after mutating its copy leaves **no trace** in the repository.`,
        timeLimitSec: 300,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace a first-time payment_intent.succeeded",
        prompt: "A correctly signed, never-seen `payment_intent.succeeded` for a payment intent we have no row for arrives. Order the steps as they **execute**.",
        items: [
          "`parse_header` splits the Stripe-Signature header into `t` and a list of `v1` values",
          "`compute_signature` HMACs `\"<t>.\" + raw_body` with the endpoint secret",
          "Each `v1` is compared to the expected signature, then the timestamp tolerance is checked",
          "`parse_event` decodes the JSON envelope into an `Event`",
          "`ProcessedEvents.seen(event.id)` returns False",
          "`ProcessedEvents.mark(event.id)` records the id",
          "`route(event.type)` returns `on_payment_intent`",
          "The handler builds a new `PaymentIntent` and `Ledger.post` credits `amount_received`",
          "`save_payment_intent` stores a copy and `handle` returns `(200, {\"status\": \"processed\"})`",
        ],
        hints: [
          "Verification happens entirely before the body is parsed. Why is that order important?",
          "Look carefully at where `mark` sits relative to the handler call.",
        ],
        explanation: `Verify (parse header → HMAC → compare → tolerance) → parse → dedup check → **mark** → route → handler (build, credit ledger, save) → 200.

Two orderings matter:

* **Verify before parse.** Never feed attacker-controlled JSON into business code before authenticating it, and never let an unauthenticated request touch dedup state (a forged request with a real event id could otherwise "burn" that id).
* **Mark before handle.** The event id is recorded *before* the side effects happen. If the handler raises, the id is already marked, so Stripe's retry will be answered \`duplicate\`. Keep that in mind for the next stage.`,
        timeLimitSec: 360,
        focusFile: "webhooks/processor.py",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Replay the incident",
        prompt: "`main.py` replays the captured delivery sequence from the incident with the clock frozen at `NOW = 1000`. Predict **exactly** what it prints.",
        entry: "main.py",
        answer: `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 duplicate
evt_1 400 signature mismatch
evt_2 400 timestamp outside tolerance
pi_A processing 5000
pi_B None
balance 5000`,
        options: [
          `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 processed
evt_1 400 signature mismatch
evt_2 400 timestamp outside tolerance
pi_A succeeded 5000
pi_B succeeded
balance 6200`,
          `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 duplicate
evt_1 400 signature mismatch
evt_2 400 timestamp outside tolerance
pi_A processing 5000
pi_B succeeded
balance 5000`,
          `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 duplicate
evt_1 200 duplicate
evt_2 200 duplicate
pi_A processing 5000
pi_B None
balance 5000`,
          `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 duplicate
evt_1 400 signature mismatch
evt_2 400 timestamp outside tolerance
pi_A processing 5000
pi_B None
balance 5000`,
          `evt_1 200 processed
evt_3 200 processed
evt_2 200 processed
evt_3 200 duplicate
evt_4 500 handler failed
evt_4 200 duplicate
evt_1 400 signature mismatch
evt_2 400 timestamp outside tolerance
pi_A processing 0
pi_B None
balance 5000`,
        ],
        hints: [
          "Does `on_payment_intent` compare `event.created` with anything before overwriting the status?",
          "For evt_4: in what order do the handler mutate its copy, call the ledger, and save? And when was evt_4 marked as processed?",
          "The last two deliveries reuse event ids that are already marked. Which runs first, signature verification or the dedup check?",
        ],
        explanation: `Line by line:

* **evt_1, evt_3** are applied normally: pi_A becomes \`succeeded\`, and the ledger is credited 5000.
* **evt_2** (\`processing\`, created 905) arrives late. The handler overwrites status unconditionally, so pi_A **regresses** to \`processing\`. \`amount_received\` stays 5000 because the stored row is copied and only \`status\`/\`last_event_at\` are overwritten. The DB now says "processing, 5000 received", which is internally contradictory.
* **evt_3 again** is deduplicated (same event id): \`duplicate\`.
* **evt_4 #1**: the id is **marked first**, then the handler mutates its *copy*, \`Ledger.post\` raises, and \`save\` never runs, so the response is 500. Because the repository is copy-on-read, nothing about pi_B was persisted.
* **evt_4 #2** (Stripe's retry): \`seen\` is True, so the response is \`200 duplicate\`. Stripe stops retrying. **The payment is silently lost**, and \`pi_B\` is \`None\`.
* **evt_1 with the old secret** fails verification **before** the dedup check, so it gets 400 \`signature mismatch\`, not \`duplicate\`.
* **evt_2 signed at t=650**: the HMAC is valid, but \`1000 - 650 = 350 > 300\`, so it gets 400 \`timestamp outside tolerance\`. The signature is checked first, then the age.
* Ledger balance: only evt_3's 5000.

Both finance complaints are reproduced: an **ordering** bug (pi_A) and a **mark-before-side-effects** bug (pi_B).`,
        timeLimitSec: 540,
        focusFile: "main.py",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Fix ordering and lost retries",
        prompt: `Fix both incident bugs.

1. **Out-of-order delivery.** An event whose snapshot is older than what we've applied must be acknowledged (200) but must not change state. Rules:
   * \`succeeded\` and \`canceled\` are terminal: nothing moves a payment intent out of them.
   * A **newer** \`created\` always wins, even if it moves "backwards" (e.g. \`processing\` → \`requires_payment_method\` after a failed attempt).
   * Several events can share the same \`created\` second. Within one second, only move **forward** in \`STATUS_RANK\`.
   * The ledger is credited exactly once per payment intent, even if two distinct events both report \`succeeded\`.
2. **Lost retries.** If a handler raises, Stripe's retry of that event id must be processed, not reported as a duplicate. Events we can't authenticate must never affect dedup state.

\`models.py\` already has \`STATUS_RANK\` and \`TERMINAL\`.`,
        editable: [
          "payments/handlers.py",
          "webhooks/processor.py",
          "payments/models.py",
        ],
        tests: [
          {
            path: "test_ordering_and_retries.py",
            content: `from config.settings import WEBHOOK_SECRET
from tools.sign import make_event, sign
from webhooks.processor import build_processor


def pi(status, created, eid, amount=5000, pid="pi_1"):
    obj = {"id": pid, "object": "payment_intent", "amount": amount, "currency": "usd",
           "status": status, "amount_received": amount if status == "succeeded" else 0}
    return make_event(eid, "payment_intent." + ("created" if status == "requires_payment_method" else status), created, obj)


def setup():
    proc, ctx = build_processor(clock=lambda: 1000)
    send = lambda raw: proc.handle(raw, sign(raw, WEBHOOK_SECRET, 995))
    return proc, ctx, send


def test_late_processing_does_not_regress_succeeded():
    _, ctx, send = setup()
    send(pi("requires_payment_method", 900, "evt_1"))
    send(pi("succeeded", 910, "evt_3"))
    code, _ = send(pi("processing", 905, "evt_2"))
    assert code == 200
    assert ctx.repo.get_payment_intent("pi_1").status == "succeeded"
    assert ctx.ledger.balance("merchant_balance") == 5000


def test_same_second_events_only_move_forward():
    _, ctx, send = setup()
    send(pi("processing", 905, "evt_2"))
    send(pi("requires_action", 905, "evt_x"))
    assert ctx.repo.get_payment_intent("pi_1").status == "processing"
    send(pi("succeeded", 905, "evt_3"))
    assert ctx.repo.get_payment_intent("pi_1").status == "succeeded"


def test_newer_failure_may_move_backwards():
    _, ctx, send = setup()
    send(pi("processing", 905, "evt_2"))
    failed = {"id": "pi_1", "object": "payment_intent", "amount": 5000, "currency": "usd",
              "status": "requires_payment_method"}
    send(make_event("evt_f", "payment_intent.payment_failed", 910, failed))
    assert ctx.repo.get_payment_intent("pi_1").status == "requires_payment_method"
    send(pi("succeeded", 920, "evt_s"))
    assert ctx.repo.get_payment_intent("pi_1").status == "succeeded"


def test_second_success_snapshot_does_not_double_credit():
    _, ctx, send = setup()
    send(pi("succeeded", 910, "evt_3"))
    send(pi("succeeded", 912, "evt_3b"))
    assert ctx.ledger.balance("merchant_balance") == 5000
    assert len(ctx.ledger.entries) == 1


def test_failed_handler_is_retried_not_deduplicated():
    _, ctx, send = setup()
    ctx.ledger.fail_next = True
    raw = pi("succeeded", 950, "evt_4", amount=1200, pid="pi_B")
    assert send(raw)[0] == 500
    assert send(raw) == (200, {"status": "processed"})
    assert ctx.repo.get_payment_intent("pi_B").status == "succeeded"
    assert ctx.ledger.balance("merchant_balance") == 1200
    assert send(raw) == (200, {"status": "duplicate"})


def test_bad_signature_does_not_burn_the_event_id():
    proc, ctx, send = setup()
    raw = pi("succeeded", 950, "evt_9", amount=300)
    assert proc.handle(raw, sign(raw, "whsec_wrong", 995))[0] == 400
    assert send(raw) == (200, {"status": "processed"})
`,
          },
        ],
        solution: {
          "payments/handlers.py": `"""Business handlers, one per family of event types.

Stripe does NOT guarantee delivery order, and may deliver the same logical
change more than once. Each event carries a full snapshot of the object
(\`event.data\`) as of \`event.created\`.
"""
from dataclasses import dataclass

from config import settings
from payments.ledger import Ledger
from payments.models import STATUS_RANK, TERMINAL, PaymentIntent
from payments.repository import PaymentRepository


@dataclass
class HandlerContext:
    repo: PaymentRepository
    ledger: Ledger


def _is_stale(current, event_created, new_status):
    """True if an event's snapshot is older than what we've already applied."""
    if current is None:
        return False
    if current.status in TERMINAL:
        return True
    if event_created != current.last_event_at:
        return event_created < current.last_event_at
    # Same second: only move forward in the lifecycle.
    return STATUS_RANK.get(new_status, 0) <= STATUS_RANK.get(current.status, 0)


def on_payment_intent(event, ctx):
    obj = event.data
    pi = ctx.repo.get_payment_intent(obj["id"])
    if _is_stale(pi, event.created, obj["status"]):
        return "stale"
    if pi is None:
        pi = PaymentIntent(id=obj["id"], amount=obj["amount"], currency=obj["currency"], status=obj["status"])

    pi.status = obj["status"]
    pi.last_event_at = event.created

    if obj["status"] == "succeeded":
        # Reached only once: succeeded is terminal, so later events are stale.
        received = obj.get("amount_received", obj["amount"])
        ctx.ledger.post(settings.LEDGER_MERCHANT_ACCOUNT, received, ref=f"{pi.id}:succeeded")
        pi.amount_received = received

    ctx.repo.save_payment_intent(pi)
    return "processed"
`,
          "webhooks/processor.py": `"""HTTP-facing entry point: POST /webhooks/stripe -> WebhookProcessor.handle.

Response contract with Stripe:
  2xx  -> delivered, Stripe will not retry
  4xx  -> we rejected it (bad signature / malformed); Stripe retries, then gives up
  5xx  -> transient failure; Stripe retries with backoff for up to 3 days
"""
import time

from config import settings
from payments.handlers import HandlerContext
from payments.ledger import Ledger
from payments.repository import PaymentRepository
from webhooks.dedup import ProcessedEvents
from webhooks.envelope import MalformedEvent, parse_event
from webhooks.router import route
from webhooks.signature import SignatureError, verify


class WebhookProcessor:
    def __init__(self, secret, ctx, dedup, clock=time.time, tolerance=settings.SIGNATURE_TOLERANCE_SECONDS):
        self.secret = secret
        self.ctx = ctx
        self.dedup = dedup
        self.clock = clock
        self.tolerance = tolerance
        self.errors = []

    def handle(self, raw, sig_header):
        try:
            verify(raw, sig_header, self.secret, int(self.clock()), self.tolerance)
        except SignatureError as e:
            return 400, {"error": str(e)}

        try:
            event = parse_event(raw)
        except MalformedEvent as e:
            return 400, {"error": str(e)}

        if self.dedup.seen(event.id):
            return 200, {"status": "duplicate"}

        handler = route(event.type)
        if handler is None:
            self.dedup.mark(event.id)
            return 200, {"status": "ignored"}

        try:
            outcome = handler(event, self.ctx)
        except Exception as e:  # noqa: BLE001 - any failure is retryable for Stripe
            self.errors.append((event.id, repr(e)))
            # Not marked: Stripe's retry must be processed, not deduplicated.
            return 500, {"error": "handler failed"}
        self.dedup.mark(event.id)
        return 200, {"status": outcome or "processed"}


def build_processor(clock=time.time):
    """Composition root used by the web app, the demo and the tests."""
    ctx = HandlerContext(repo=PaymentRepository(), ledger=Ledger())
    dedup = ProcessedEvents(settings.DEDUP_MAX_EVENTS)
    return WebhookProcessor(settings.WEBHOOK_SECRET, ctx, dedup, clock=clock), ctx
`,
        },
        hints: [
          "Two independent fixes: one in `processor.py` (when the id is marked), one in `handlers.py` (whether to apply a snapshot).",
          "Mark the event id only after the handler returns successfully. Unrouted events can be marked immediately.",
          "Staleness check: no row means apply. Terminal row means stale. Different `created` means compare timestamps. Same `created` means compare `STATUS_RANK`. Store `last_event_at` when you apply.",
        ],
        explanation: `**Processor.** Move \`self.dedup.mark(event.id)\` to *after* a successful handler call. Dedup then means "successfully processed", not "seen". A handler that fails leaves no mark, so the retry runs again. This is only safe because handlers are themselves idempotent per snapshot (next point). Exactly-once *effects* come from at-least-once delivery plus idempotent processing, never from "mark early".

**Handler.** Treat each event as a **versioned snapshot** and only apply snapshots that are newer than what we hold:

\`\`\`python
def _is_stale(current, created, new_status):
    if current is None:            return False
    if current.status in TERMINAL: return True
    if created != current.last_event_at:
        return created < current.last_event_at
    return STATUS_RANK[new_status] <= STATUS_RANK[current.status]
\`\`\`

* Timestamps decide first, because Stripe's object history really can go backwards (a failed attempt returns to \`requires_payment_method\`). Rank-only ordering would wrongly drop that.
* Rank only breaks **same-second ties**, because \`created\` has one-second resolution.
* Terminal states make the ledger credit naturally exactly-once: once \`succeeded\`, every later snapshot is stale, so a second "succeeded" event can't credit again.

In production you would also make \`Ledger.post\` idempotent on \`ref\` (a unique constraint) as a second line of defense.`,
        timeLimitSec: 840,
        focusFile: "payments/handlers.py",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Review: \"make the signature check timing-safe\"",
        prompt: "Security asked for a constant-time signature comparison. The assistant's patch is below. Decide whether to merge it.",
        persona: "outdated-docs",
        request: "Security review flagged `sig == expected` in webhooks/signature.py as not timing-safe. Please fix it.",
        aiReply: `Good catch from security. \`==\` on strings short-circuits at the first differing byte, which leaks timing. Here's a hardened \`verify\` using \`hmac.compare_digest\`. I also simplified the header parsing while I was in there, since a dict is much easier to read than the list juggling:

\`\`\`python
# webhooks/signature.py
def verify(payload, header, secret, now, tolerance):
    if not header:
        raise SignatureError("missing header")
    parts = dict(item.split("=", 1) for item in header.split(","))
    try:
        timestamp = int(parts["t"])
    except (KeyError, ValueError):
        raise SignatureError("bad timestamp")
    signature = parts.get("v1")
    if signature is None:
        raise SignatureError("no v1 signature")

    expected = compute_signature(payload, timestamp, secret)
    if not hmac.compare_digest(signature, expected):
        raise SignatureError("signature mismatch")
    if now - timestamp > tolerance:
        raise SignatureError("timestamp outside tolerance")
    return timestamp
\`\`\`

\`parse_header\` is now unused, so you can delete it. All three tests in \`tests/test_signature.py\` still pass ✅ (including the rotation one).`,
        options: [
          "Accept: `compare_digest` fixes the timing leak and the tests pass.",
          "Reject: `dict(...)` keeps only the **last** `v1=` value. During a secret rotation, if our endpoint's signature isn't the last one in the header, valid webhooks are rejected. The passing rotation test only covers the case where ours is last.",
          "Reject: `hmac.compare_digest` returns early when the lengths differ, so it still leaks timing; the expected signature should be padded first.",
          "Reject: `compare_digest` can't compare `str` values; both sides must be `bytes`, so this raises `TypeError` on every request.",
          "Reject: the tolerance check must come before the HMAC; checking it afterwards lets attackers replay old webhooks.",
        ],
        correct: 1,
        hints: [
          "The README describes what the header looks like during a secret rotation. Feed that header through `dict(item.split(\"=\", 1) ...)` in your head.",
          "Open `tools/sign.py`: which position does the test put *our* signature in? Would the test still pass if ours came first?",
        ],
        explanation: `The timing fix itself is correct. The regression is in the "simplification" nobody asked for.

\`dict(item.split("=", 1) for item in header.split(","))\` turns \`t=..,v1=<A>,v1=<B>\` into \`{"t": .., "v1": "<B>"}\`: **duplicate keys collapse to the last value**. Stripe sends one \`v1\` per active secret during rotation, and the order isn't something you control. The patch accepts the delivery only when our signature happens to be last. \`tests/test_signature.py\` builds the header as \`extra_v1 + [ours]\`, so the rotation test still passes. That's why "the tests pass ✅" proved nothing here. (It also now crashes with \`ValueError\` on any header element without \`=\`, which the old parser skipped.)

Why the other options are wrong:
* \`compare_digest\` *may* return early on a length mismatch, but the signature length (64 hex chars) is public. Only the *content* is secret, and that comparison is constant-time.
* \`compare_digest\` accepts two \`str\` values as long as both are ASCII, which hex digests are. Mixing \`str\` and \`bytes\` would raise.
* The order of the tolerance check and the HMAC doesn't matter for security. Both must pass, and the timestamp is covered by the HMAC.

The right patch is one line: \`if not any(hmac.compare_digest(sig, expected) for sig in candidates)\`. Keep \`parse_header\`.`,
        timeLimitSec: 420,
        focusFile: "webhooks/signature.py",
      },
      {
        id: "s6",
        kind: "code",
        task: "feature",
        title: "Add refund handling (PAY-412)",
        prompt: `Implement \`charge.refunded\` handling.

Each \`charge.refunded\` event carries a **charge snapshot**: \`id\`, \`payment_intent\`, \`amount\`, \`currency\`, and a **cumulative** \`amount_refunded\`. Stripe sends one per (partial) refund, at least once and in any order.

Requirements:
* Debit the merchant ledger by the **increase** in \`amount_refunded\` over what we have already recorded for that charge (a negative \`Ledger.post\`, integer cents).
* A snapshot whose cumulative amount is less than or equal to what we've recorded is a no-op, whether it is older or a duplicate under a new event id.
* Persist the \`Charge\` (\`amount_refunded\`, and \`refunded=True\` once fully refunded) via the repository.
* Payment-intent handling must keep working.`,
        editable: [
          "payments/handlers.py",
          "webhooks/router.py",
          "payments/models.py",
          "payments/repository.py",
        ],
        tests: [
          {
            path: "test_refunds.py",
            content: `from config.settings import WEBHOOK_SECRET
from tools.sign import make_event, sign
from webhooks.processor import build_processor


def charge(eid, created, refunded, amount=5000, cid="ch_1"):
    obj = {"id": cid, "object": "charge", "payment_intent": "pi_1", "amount": amount,
           "currency": "usd", "amount_refunded": refunded, "refunded": refunded >= amount}
    return make_event(eid, "charge.refunded", created, obj)


def setup():
    proc, ctx = build_processor(clock=lambda: 1000)
    send = lambda raw: proc.handle(raw, sign(raw, WEBHOOK_SECRET, 995))
    return ctx, send


def test_partial_refunds_debit_the_increase():
    ctx, send = setup()
    assert send(charge("evt_r1", 910, 1000))[0] == 200
    assert send(charge("evt_r2", 920, 1500))[0] == 200
    assert ctx.ledger.balance("merchant_balance") == -1500
    ch = ctx.repo.get_charge("ch_1")
    assert ch.amount_refunded == 1500 and ch.refunded is False


def test_out_of_order_cumulative_snapshots():
    ctx, send = setup()
    send(charge("evt_r2", 920, 1500))
    send(charge("evt_r1", 910, 1000))   # older, smaller cumulative: no-op
    assert ctx.ledger.balance("merchant_balance") == -1500
    assert ctx.repo.get_charge("ch_1").amount_refunded == 1500


def test_same_snapshot_under_two_event_ids_debits_once():
    ctx, send = setup()
    send(charge("evt_a", 910, 700))
    send(charge("evt_b", 911, 700))
    assert ctx.ledger.balance("merchant_balance") == -700


def test_full_refund_marks_charge_refunded():
    ctx, send = setup()
    send(charge("evt_r1", 910, 2000))
    send(charge("evt_r2", 930, 5000))
    ch = ctx.repo.get_charge("ch_1")
    assert ch.refunded is True
    assert ctx.ledger.balance("merchant_balance") == -5000
    assert all(isinstance(e.amount, int) for e in ctx.ledger.entries)


def test_charges_are_independent_and_success_still_works():
    ctx, send = setup()
    send(charge("evt_r1", 910, 300, cid="ch_1"))
    send(charge("evt_r2", 911, 400, cid="ch_2"))
    obj = {"id": "pi_9", "object": "payment_intent", "amount": 2000, "currency": "usd", "status": "succeeded"}
    send(make_event("evt_p", "payment_intent.succeeded", 905, obj))
    assert ctx.ledger.balance("merchant_balance") == 2000 - 700
`,
          },
        ],
        solution: {
          "payments/handlers.py": `"""Business handlers, one per family of event types.

Stripe does NOT guarantee delivery order, and may deliver the same logical
change more than once. Each event carries a full snapshot of the object
(\`event.data\`) as of \`event.created\`.
"""
from dataclasses import dataclass

from config import settings
from payments.ledger import Ledger
from payments.models import STATUS_RANK, TERMINAL, Charge, PaymentIntent
from payments.repository import PaymentRepository


@dataclass
class HandlerContext:
    repo: PaymentRepository
    ledger: Ledger


def _is_stale(current, event_created, new_status):
    """True if an event's snapshot is older than what we've already applied."""
    if current is None:
        return False
    if current.status in TERMINAL:
        return True
    if event_created != current.last_event_at:
        return event_created < current.last_event_at
    # Same second: only move forward in the lifecycle.
    return STATUS_RANK.get(new_status, 0) <= STATUS_RANK.get(current.status, 0)


def on_payment_intent(event, ctx):
    obj = event.data
    pi = ctx.repo.get_payment_intent(obj["id"])
    if _is_stale(pi, event.created, obj["status"]):
        return "stale"
    if pi is None:
        pi = PaymentIntent(id=obj["id"], amount=obj["amount"], currency=obj["currency"], status=obj["status"])

    pi.status = obj["status"]
    pi.last_event_at = event.created

    if obj["status"] == "succeeded":
        # Reached only once: succeeded is terminal, so later events are stale.
        received = obj.get("amount_received", obj["amount"])
        ctx.ledger.post(settings.LEDGER_MERCHANT_ACCOUNT, received, ref=f"{pi.id}:succeeded")
        pi.amount_received = received

    ctx.repo.save_payment_intent(pi)
    return "processed"


def on_charge_refunded(event, ctx):
    """\`amount_refunded\` is CUMULATIVE. Debit only the increase over what we
    have already recorded; an older or equal snapshot is a no-op."""
    obj = event.data
    ch = ctx.repo.get_charge(obj["id"])
    if ch is None:
        ch = Charge(id=obj["id"], payment_intent=obj["payment_intent"], amount=obj["amount"], currency=obj["currency"])
    new_total = obj["amount_refunded"]
    if new_total <= ch.amount_refunded:
        return "stale"
    delta = new_total - ch.amount_refunded
    ctx.ledger.post(settings.LEDGER_MERCHANT_ACCOUNT, -delta, ref=f"{ch.id}:refund:{new_total}")
    ch.amount_refunded = new_total
    ch.refunded = new_total >= ch.amount
    ch.last_event_at = max(ch.last_event_at, event.created)
    ctx.repo.save_charge(ch)
    return "processed"
`,
          "webhooks/router.py": `"""Maps event types to handlers. Unrouted types are acknowledged and ignored."""
from payments import handlers

ROUTES = {
    "payment_intent.created": handlers.on_payment_intent,
    "payment_intent.requires_action": handlers.on_payment_intent,
    "payment_intent.processing": handlers.on_payment_intent,
    "payment_intent.payment_failed": handlers.on_payment_intent,
    "payment_intent.succeeded": handlers.on_payment_intent,
    "payment_intent.canceled": handlers.on_payment_intent,
    "charge.refunded": handlers.on_charge_refunded,
}


def route(event_type):
    return ROUTES.get(event_type)
`,
        },
        hints: [
          "Two edits: a new handler in `payments/handlers.py` and a route in `webhooks/router.py`. `Charge` and `get_charge`/`save_charge` already exist.",
          "Cumulative totals are monotonic, so the total itself orders snapshots. You don't need `created` for this.",
          "delta = new_total - recorded_total; only post when delta > 0, then save the new total.",
        ],
        explanation: `Cumulative fields are a gift: the value itself is a **monotonic version**. The handler is a "max-merge":

\`\`\`python
new_total = obj["amount_refunded"]
if new_total <= ch.amount_refunded:
    return "stale"
ctx.ledger.post(MERCHANT, -(new_total - ch.amount_refunded), ref=f"{ch.id}:refund:{new_total}")
ch.amount_refunded = new_total
ch.refunded = new_total >= ch.amount
ctx.repo.save_charge(ch)
\`\`\`

* **Out of order:** if 1500 arrives before 1000, the 1000 snapshot is ignored. The debit already covered both refunds.
* **Duplicates under new ids** (which event-id dedup can't catch) are no-ops because the total didn't grow.
* The naive "debit \`amount_refunded\` each time" would debit 1000 + 1500 = 2500 for 1500 of refunds. That is the exact reconciliation pattern the runbook warns about.
* The ref includes the cumulative total, so a ledger-level unique constraint on \`ref\` would give you a second, storage-level guarantee.

The general rule: prefer state (snapshots, cumulative totals) over deltas in at-least-once systems. Applying a state twice is harmless; applying a delta twice is a double charge.`,
        timeLimitSec: 720,
        focusFile: "payments/handlers.py",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Follow-up: six workers and a retry storm",
        prompt: "Volume triples. We run **6 worker processes** behind a load balancer, sharing Postgres for payments and the ledger. When we're slow, Stripe times out and redelivers, so the **same event can be processed concurrently on two workers**. With your fixes in place, which changes or statements are **correct**? Select all that apply.",
        options: [
          "Move dedup into Postgres and make it atomic with the side effects: in one transaction, `INSERT INTO processed_events(id) ... ON CONFLICT DO NOTHING`, check the row count, then apply the handler, and commit (or roll back) together.",
          "Apply snapshots with a conditional write (`UPDATE ... WHERE id = ? AND last_event_at <= ?`, or `SELECT ... FOR UPDATE`). Otherwise two workers can both read the old row, both decide they're newer, and the slower write wins.",
          "Acknowledge fast: verify the signature, durably enqueue the raw event, return 200, and process asynchronously. This removes the timeouts that cause concurrent redeliveries.",
          "Put a `threading.Lock` around `WebhookProcessor.handle`. That serializes processing and removes the race.",
          "Sort events by `created` in memory before processing so they are always applied in order.",
          "Monitor: webhook 5xx rate, signature-failure rate (spikes mean a botched secret rotation), lag between `event.created` and processing, and the count of `stale` outcomes per type.",
        ],
        correct: [
          0,
          1,
          2,
          5,
        ],
        hints: [
          "Which state is per-process today? Which correctness arguments assumed one process?",
          "Can you sort events that haven't arrived yet?",
        ],
        explanation: `* **Correct.** In-memory \`ProcessedEvents\` is per process. Dedup must be shared **and** in the same transaction as the effects. Otherwise you are back to "mark then crash" (lost) or "effects then crash before mark" (applied twice).
* **Correct.** The staleness check is read-check-write. Across processes that is a race unless the write is conditional or the row is locked. This is the same lesson as optimistic concurrency anywhere.
* **Correct.** Stripe expects a fast 2xx. Doing heavy work inline is what makes Stripe redeliver while you're still processing. A durable queue (with the dedup and conditional writes above) turns a retry storm into ordinary duplicates.
* **Wrong.** A \`threading.Lock\` is per process. Six processes means six locks.
* **Wrong.** Events arrive over minutes or days and through retries. You can't sort a stream you haven't received yet. Versioned snapshots make order irrelevant instead.
* **Correct.** These signals map one-to-one onto the failure modes in this round: handler failures, rotation mistakes, backlog, and out-of-order delivery rates.`,
        timeLimitSec: 360,
      },
    ],
  },
];

export default problems;
