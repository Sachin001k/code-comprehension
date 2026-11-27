/**
 * In-memory CommonJS loader + tiny jest-like test framework.
 * Pure: no DOM, no Node APIs. Runs inside a Web Worker (browser) and in Node (validator).
 */
import { transform } from 'sucrase';

export interface TestResult { name: string; passed: boolean; error?: string; durationMs: number }
export interface RunOutput { logs: string[]; results: TestResult[]; error?: string; durationMs: number }

type FileMap = Record<string, string>;

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function fmt(v: unknown, seen = new WeakSet()): string {
  if (typeof v === 'string') return v;
  return inspect(v, seen, 0);
}

function inspect(v: unknown, seen: WeakSet<object>, depth: number): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return depth === 0 ? v : `'${v}'`;
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'function') return `[Function: ${v.name || '(anonymous)'}]`;
  if (typeof v === 'symbol') return v.toString();
  if (typeof v !== 'object') return String(v);
  if (seen.has(v as object)) return '[Circular]';
  seen.add(v as object);
  if (Array.isArray(v)) {
    const r = `[ ${v.map((x) => inspect(x, seen, depth + 1)).join(', ')} ]`;
    return v.length ? r : '[]';
  }
  if (v instanceof Map) return `Map(${v.size}) { ${[...v].map(([k, x]) => `${inspect(k, seen, depth + 1)} => ${inspect(x, seen, depth + 1)}`).join(', ')} }`;
  if (v instanceof Set) return `Set(${v.size}) { ${[...v].map((x) => inspect(x, seen, depth + 1)).join(', ')} }`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Date) return v.toISOString();
  const entries = Object.entries(v as object);
  if (!entries.length) return '{}';
  return `{ ${entries.map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${inspect(x, seen, depth + 1)}`).join(', ')} }`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

class AssertionError extends Error {}

function makeExpect() {
  const build = (actual: unknown, negate: boolean) => {
    const check = (pass: boolean, msg: string) => {
      if (pass === negate) throw new AssertionError((negate ? 'Expected NOT: ' : 'Expected: ') + msg);
    };
    const s = (x: unknown) => inspect(x, new WeakSet(), 1);
    const api = {
      toBe: (e: unknown) => check(Object.is(actual, e), `${s(actual)} to be ${s(e)}`),
      toEqual: (e: unknown) => check(deepEqual(actual, e), `${s(actual)} to equal ${s(e)}`),
      toStrictEqual: (e: unknown) => check(deepEqual(actual, e), `${s(actual)} to equal ${s(e)}`),
      toBeTruthy: () => check(!!actual, `${s(actual)} to be truthy`),
      toBeFalsy: () => check(!actual, `${s(actual)} to be falsy`),
      toBeNull: () => check(actual === null, `${s(actual)} to be null`),
      toBeUndefined: () => check(actual === undefined, `${s(actual)} to be undefined`),
      toBeDefined: () => check(actual !== undefined, `${s(actual)} to be defined`),
      toBeGreaterThan: (e: number) => check((actual as number) > e, `${s(actual)} > ${e}`),
      toBeGreaterThanOrEqual: (e: number) => check((actual as number) >= e, `${s(actual)} >= ${e}`),
      toBeLessThan: (e: number) => check((actual as number) < e, `${s(actual)} < ${e}`),
      toBeLessThanOrEqual: (e: number) => check((actual as number) <= e, `${s(actual)} <= ${e}`),
      toBeCloseTo: (e: number, digits = 2) =>
        check(Math.abs((actual as number) - e) < Math.pow(10, -digits) / 2, `${s(actual)} to be close to ${e}`),
      toContain: (e: unknown) =>
        check(
          typeof actual === 'string' ? actual.includes(e as string) : Array.isArray(actual) && actual.some((x) => deepEqual(x, e)),
          `${s(actual)} to contain ${s(e)}`,
        ),
      toHaveLength: (n: number) => check((actual as { length: number })?.length === n, `${s(actual)} to have length ${n}`),
      toBeInstanceOf: (c: new (...a: never[]) => unknown) => check(actual instanceof c, `${s(actual)} to be instance of ${c.name}`),
      toMatch: (re: RegExp | string) => check(typeof actual === 'string' && new RegExp(re).test(actual), `${s(actual)} to match ${re}`),
      toThrow: (m?: string | RegExp) => {
        let threw = false;
        let msg = '';
        try { (actual as () => unknown)(); } catch (e) { threw = true; msg = String((e as Error)?.message ?? e); }
        const ok = threw && (m === undefined || (typeof m === 'string' ? msg.includes(m) : m.test(msg)));
        check(ok, `function to throw${m ? ` matching ${m}` : ''}${threw ? ` (threw "${msg}")` : ' (did not throw)'}`);
      },
    };
    return api;
  };
  const expect = (actual: unknown) => {
    const pos = build(actual, false);
    const rejects = {
      toThrow: async (m?: string | RegExp) => {
        try { await (actual as Promise<unknown>); } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          if (m === undefined || (typeof m === 'string' ? msg.includes(m) : m.test(msg))) return;
          throw new AssertionError(`Expected rejection matching ${m}, got "${msg}"`);
        }
        throw new AssertionError('Expected promise to reject');
      },
    };
    return Object.assign(pos, { not: build(actual, true), rejects });
  };
  return expect;
}

export function transpile(path: string, src: string): string {
  if (/\.(json)$/.test(path)) return `module.exports = ${src};`;
  return transform(src, {
    transforms: /\.tsx?$/.test(path) ? ['typescript', 'imports'] : ['imports'],
    filePath: path,
    disableESTransforms: true,
  }).code;
}

/**
 * Load `files`, then run `testFiles` (each registers tests with `test()`), then execute tests.
 * If no tests: executes `entry` and returns its logs.
 */
export async function runJs(opts: {
  files: FileMap;
  entry?: string;
  testFiles?: FileMap;
  now?: () => number;
}): Promise<RunOutput> {
  const now = opts.now ?? (() => Date.now());
  const t0 = now();
  const logs: string[] = [];
  const all: FileMap = { ...opts.files, ...(opts.testFiles ?? {}) };
  const cache: Record<string, { exports: unknown }> = {};
  const tests: { name: string; fn: () => unknown }[] = [];
  const expect = makeExpect();

  const con = {
    log: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(' ')),
    info: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(' ')),
    warn: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(' ')),
    error: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(' ')),
    debug: (...a: unknown[]) => logs.push(a.map((x) => fmt(x)).join(' ')),
  };

  const resolve = (from: string, req: string): string | null => {
    const base = req.startsWith('.') ? normalize(dirname(from) + '/' + req) : normalize(req);
    const cands = [base, `${base}.ts`, `${base}.js`, `${base}.tsx`, `${base}.json`, `${base}/index.ts`, `${base}/index.js`];
    if (base.endsWith('.js')) cands.push(base.replace(/\.js$/, '.ts'));
    return cands.find((c) => c in all) ?? null;
  };

  const load = (path: string): unknown => {
    if (cache[path]) return cache[path].exports;
    const mod = { exports: {} as unknown };
    cache[path] = mod;
    const code = transpile(path, all[path]);
    const req = (r: string) => {
      const p = resolve(path, r);
      if (!p) {
        if (r === 'assert' || r === 'node:assert') return nodeAssert(expect);
        if (r === 'events' || r === 'node:events') return { EventEmitter: MiniEmitter, default: MiniEmitter };
        throw new Error(`Cannot find module '${r}' from '${path}'`);
      }
      return load(p);
    };
    const fn = new Function('require', 'module', 'exports', 'console', 'test', 'it', 'expect', 'describe', code);
    const describe = (_n: string, f: () => void) => f();
    const reg = (name: string, f: () => unknown) => tests.push({ name, fn: f });
    fn(req, mod, mod.exports, con, reg, reg, expect, describe);
    return mod.exports;
  };

  try {
    if (opts.testFiles && Object.keys(opts.testFiles).length) {
      for (const tf of Object.keys(opts.testFiles)) load(tf);
    } else {
      const entry = opts.entry ?? Object.keys(opts.files)[0];
      load(entry);
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (e) {
    return { logs, results: [], error: errStr(e), durationMs: now() - t0 };
  }

  const results: TestResult[] = [];
  for (const t of tests) {
    const s = now();
    try {
      await t.fn();
      results.push({ name: t.name, passed: true, durationMs: now() - s });
    } catch (e) {
      results.push({ name: t.name, passed: false, error: errStr(e), durationMs: now() - s });
    }
  }
  return { logs, results, durationMs: now() - t0 };
}

function errStr(e: unknown): string {
  if (e instanceof AssertionError) return e.message;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

function nodeAssert(expect: ReturnType<typeof makeExpect>) {
  const a = (v: unknown, m?: string) => { if (!v) throw new AssertionError(m ?? 'Assertion failed'); };
  a.ok = a;
  a.equal = (x: unknown, y: unknown) => expect(x == y).toBe(true);
  a.strictEqual = (x: unknown, y: unknown) => expect(x).toBe(y);
  a.deepStrictEqual = (x: unknown, y: unknown) => expect(x).toEqual(y);
  a.deepEqual = a.deepStrictEqual;
  a.throws = (f: () => unknown) => expect(f).toThrow();
  return a;
}

class MiniEmitter {
  private h: Record<string, ((...a: unknown[]) => void)[]> = {};
  on(e: string, f: (...a: unknown[]) => void) { (this.h[e] ??= []).push(f); return this; }
  off(e: string, f: (...a: unknown[]) => void) { this.h[e] = (this.h[e] ?? []).filter((x) => x !== f); return this; }
  once(e: string, f: (...a: unknown[]) => void) { const w = (...a: unknown[]) => { this.off(e, w); f(...a); }; return this.on(e, w); }
  emit(e: string, ...a: unknown[]) { const l = this.h[e] ?? []; l.slice().forEach((f) => f(...a)); return l.length > 0; }
}
