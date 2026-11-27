/**
 * Content validator. Executes every problem to prove its answers are correct.
 *
 *   npm run validate                         # all problem files
 *   npm run validate -- l3-ts-booking.ts     # only files whose name contains the arg(s)
 *   npm run validate -- --id l3-ts-booking-trace
 */
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Problem, Stage, CodeStage, PredictStage } from '../src/content/types';
import { LEVELS, RUNNABLE_LANGS } from '../src/content/types';
import { transpile } from '../src/runner/jsCore';
import { PY_HARNESS } from '../src/runner/pyHarness';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBLEMS_DIR = join(ROOT, 'src/content/problems');

interface Exec { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function exec(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Exec> {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const t = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, opts.timeoutMs ?? 15000);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (code) => { clearTimeout(t); res({ code, stdout, stderr, timedOut }); });
    p.stdin.end(opts.input ?? '');
  });
}

const norm = (s: string) => s.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '').replace(/^\n+/, '');

function writeTree(dir: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, c);
  }
}

function fileMap(p: Problem, overrides: Record<string, string> = {}): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of p.files) m[f.path] = f.content;
  return { ...m, ...overrides };
}

async function runProgram(p: Problem, entry: string): Promise<{ out: string; err?: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  try {
    const files = fileMap(p);
    const lang = p.lang;
    if (lang === 'javascript' || lang === 'typescript') {
      const out: Record<string, string> = {};
      for (const [path, src] of Object.entries(files)) {
        if (/\.(js|ts|mjs|cjs|tsx)$/.test(path)) out[path.replace(/\.(ts|tsx|mjs)$/, '.js')] = transpile(path, src);
        else out[path] = src;
      }
      writeTree(dir, out);
      const r = await exec('node', [entry.replace(/\.(ts|tsx|mjs)$/, '.js')], { cwd: dir });
      if (r.timedOut) return { out: r.stdout, err: 'timed out' };
      if (r.code !== 0 && !r.stdout) return { out: r.stdout, err: r.stderr.slice(0, 800) };
      return { out: r.stdout };
    }
    writeTree(dir, files);
    if (lang === 'python') {
      const r = await exec('python3', ['-B', entry], { cwd: dir, timeoutMs: 20000 });
      if (r.timedOut) return { out: r.stdout, err: 'timed out' };
      return { out: r.stdout, err: r.code !== 0 && !r.stdout ? r.stderr.slice(-800) : undefined };
    }
    if (lang === 'java') {
      const javaFiles = Object.keys(files).filter((f) => f.endsWith('.java'));
      const c = await exec('javac', ['-d', 'out', ...javaFiles], { cwd: dir, timeoutMs: 60000 });
      if (c.code !== 0) return { out: '', err: 'javac: ' + c.stderr.slice(0, 1200) };
      const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(files[entry])?.[1];
      const cls = entry.split('/').pop()!.replace(/\.java$/, '');
      const r = await exec('java', ['-cp', 'out', pkg ? `${pkg}.${cls}` : cls], { cwd: dir, timeoutMs: 20000 });
      return { out: r.stdout, err: r.timedOut ? 'timed out' : r.code !== 0 && !r.stdout ? r.stderr.slice(0, 800) : undefined };
    }
    if (lang === 'cpp') {
      const srcs = Object.keys(files).filter((f) => /\.(cpp|cc)$/.test(f));
      const c = await exec('clang++', ['-std=c++20', '-O0', '-pthread', '-o', 'a.out', ...srcs], { cwd: dir, timeoutMs: 60000 });
      if (c.code !== 0) return { out: '', err: 'clang++: ' + c.stderr.slice(0, 1200) };
      const r = await exec('./a.out', [], { cwd: dir, timeoutMs: 20000 });
      return { out: r.stdout, err: r.timedOut ? 'timed out' : undefined };
    }
    return { out: '', err: `cannot run ${lang}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface TestRun { results: { name: string; passed: boolean; error?: string }[]; error?: string; timedOut?: boolean }

async function runTests(p: Problem, s: CodeStage, overrides: Record<string, string>): Promise<TestRun> {
  const files = fileMap(p, overrides);
  const tests: Record<string, string> = {};
  for (const t of s.tests) tests[t.path] = t.content;
  const timeoutMs = (s.timeoutMs ?? 4000) * 2 + 3000;
  if (p.lang === 'javascript' || p.lang === 'typescript') {
    const r = await exec('node', ['--import', 'tsx', join(ROOT, 'scripts/run-js-child.ts')], {
      cwd: ROOT, input: JSON.stringify({ files, testFiles: tests }), timeoutMs: timeoutMs + 2000,
    });
    if (r.timedOut) return { results: [], timedOut: true, error: 'timed out' };
    const i = r.stdout.indexOf('__RESULT__');
    if (i === -1) return { results: [], error: 'no result: ' + r.stderr.slice(0, 600) };
    return JSON.parse(r.stdout.slice(i + 10));
  }
  const dir = mkdtempSync(join(tmpdir(), 'ccpy-'));
  try {
    writeTree(dir, { ...files, ...tests });
    writeFileSync(join(dir, '__cc_harness.py'), PY_HARNESS + `\nprint('__RESULT__' + __cc_run(${JSON.stringify(dir)}, ${JSON.stringify(Object.keys(tests))}))\n`);
    const r = await exec('python3', ['-B', '__cc_harness.py'], { cwd: dir, timeoutMs });
    if (r.timedOut) return { results: [], timedOut: true, error: 'timed out' };
    const i = r.stdout.indexOf('__RESULT__');
    if (i === -1) return { results: [], error: 'no result: ' + r.stderr.slice(-600) };
    return JSON.parse(r.stdout.slice(i + 10));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function validateStage(p: Problem, s: Stage, errs: string[]) {
  const where = `${p.id}/${s.id}`;
  if (!s.prompt?.trim()) errs.push(`${where}: empty prompt`);
  if (!s.explanation?.trim()) errs.push(`${where}: empty explanation`);
  if (!Array.isArray(s.hints)) errs.push(`${where}: hints must be an array`);
  if (s.focusFile && !p.files.some((f) => f.path === s.focusFile)) errs.push(`${where}: focusFile ${s.focusFile} not found`);
  switch (s.kind) {
    case 'predict': {
      const ps = s as PredictStage;
      if (ps.options && !ps.options.includes(ps.answer)) errs.push(`${where}: answer not among options`);
      if (ps.options && new Set(ps.options).size !== ps.options.length) errs.push(`${where}: duplicate options`);
      if (ps.verify === false) return;
      const entry = ps.entry ?? p.files[0].path;
      if (!p.files.some((f) => f.path === entry)) { errs.push(`${where}: entry ${entry} missing`); return; }
      const r = await runProgram(p, entry);
      if (r.err) errs.push(`${where}: run error: ${r.err}`);
      else if (norm(r.out) !== norm(ps.answer)) errs.push(`${where}: WRONG ANSWER\n   expected: ${JSON.stringify(norm(ps.answer))}\n   actual:   ${JSON.stringify(norm(r.out))}`);
      return;
    }
    case 'find-bug': {
      const f = p.files.find((x) => x.path === s.file);
      if (!f) { errs.push(`${where}: file ${s.file} missing`); return; }
      const n = f.content.split('\n').length;
      if (!s.lines.length || s.lines.some((l) => l < 1 || l > n)) errs.push(`${where}: lines out of range (file has ${n})`);
      if (s.correct < 0 || s.correct >= s.options.length) errs.push(`${where}: correct out of range`);
      return;
    }
    case 'mcq':
      if (!s.correct.length || s.correct.some((c) => c < 0 || c >= s.options.length)) errs.push(`${where}: correct out of range`);
      if (s.options.length < 2) errs.push(`${where}: need >=2 options`);
      return;
    case 'trace':
      if (s.items.length < 3 || s.items.length > 10) errs.push(`${where}: trace needs 3-10 items`);
      if (new Set(s.items).size !== s.items.length) errs.push(`${where}: duplicate trace items`);
      return;
    case 'review-ai':
      if (s.correct < 0 || s.correct >= s.options.length) errs.push(`${where}: correct out of range`);
      return;
    case 'code': {
      if (!RUNNABLE_LANGS.includes(p.lang)) { errs.push(`${where}: code stage needs runnable lang`); return; }
      for (const e of s.editable) if (!p.files.some((f) => f.path === e)) errs.push(`${where}: editable ${e} missing`);
      for (const k of Object.keys(s.solution)) if (!s.editable.includes(k)) errs.push(`${where}: solution file ${k} not editable`);
      if (!s.tests.length) { errs.push(`${where}: no tests`); return; }
      const before = await runTests(p, s, {});
      const after = await runTests(p, s, s.solution);
      const failing = (r: TestRun) => r.timedOut || !!r.error || r.results.some((t) => !t.passed);
      if (after.error || after.timedOut || !after.results.length || after.results.some((t) => !t.passed)) {
        errs.push(`${where}: REFERENCE SOLUTION FAILS: ${after.error ?? ''} ${after.results.filter((t) => !t.passed).map((t) => `${t.name}: ${t.error}`).join(' | ')}`);
      }
      if (s.task !== 'refactor' && !failing(before)) errs.push(`${where}: original code already passes all tests (bug not caught by tests)`);
      return;
    }
    default:
      errs.push(`${where}: unknown kind ${(s as Stage).kind}`);
  }
}

async function validateProblem(p: Problem, seenIds: Set<string>): Promise<string[]> {
  const errs: string[] = [];
  if (seenIds.has(p.id)) errs.push(`${p.id}: duplicate problem id`);
  seenIds.add(p.id);
  const lv = LEVELS.find((l) => l.level === p.level);
  if (!lv) errs.push(`${p.id}: bad level`);
  else if (p.rating < lv.range[0] - 50 || p.rating > lv.range[1] + 50) errs.push(`${p.id}: rating ${p.rating} outside level range ${lv.range}`);
  if (!p.id.startsWith(`l${p.level}-`)) errs.push(`${p.id}: id must start with l${p.level}-`);
  if (!p.files.length) errs.push(`${p.id}: no files`);
  if (!p.stages.length) errs.push(`${p.id}: no stages`);
  const paths = new Set<string>();
  for (const f of p.files) { if (paths.has(f.path)) errs.push(`${p.id}: duplicate file ${f.path}`); paths.add(f.path); }
  const sids = new Set<string>();
  for (const s of p.stages) { if (sids.has(s.id)) errs.push(`${p.id}: duplicate stage id ${s.id}`); sids.add(s.id); }
  for (const s of p.stages) {
    try { await validateStage(p, s, errs); } catch (e) { errs.push(`${p.id}/${s.id}: validator crash ${(e as Error).message}`); }
  }
  return errs;
}

async function main() {
  const args = process.argv.slice(2);
  const idIdx = args.indexOf('--id');
  const onlyId = idIdx >= 0 ? args[idIdx + 1] : undefined;
  const filters = args.filter((a, i) => !a.startsWith('--') && (idIdx === -1 || i !== idIdx + 1));
  const files = readdirSync(PROBLEMS_DIR).filter((f) => f.endsWith('.ts') && (!filters.length || filters.some((x) => f.includes(x.split('/').pop()!))));
  const problems: { file: string; p: Problem }[] = [];
  const loadErrs: string[] = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(PROBLEMS_DIR, f)).href);
      const arr: Problem[] = mod.default;
      if (!Array.isArray(arr)) { loadErrs.push(`${f}: default export is not an array`); continue; }
      for (const p of arr) if (!onlyId || p.id === onlyId) problems.push({ file: f, p });
    } catch (e) {
      loadErrs.push(`${f}: failed to import: ${(e as Error).message}`);
    }
  }
  const seen = new Set<string>();
  // Global id uniqueness across ALL files (even when filtering)
  if (filters.length) {
    for (const f of readdirSync(PROBLEMS_DIR).filter((x) => x.endsWith('.ts') && !files.includes(x))) {
      try { const m = await import(pathToFileURL(join(PROBLEMS_DIR, f)).href); for (const p of m.default ?? []) seen.add(p.id); } catch { /* ignore */ }
    }
  }
  const conc = Math.max(2, Math.min(8, cpus().length));
  const results: { id: string; file: string; errs: string[] }[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < problems.length) {
      const { file, p } = problems[i++];
      const errs = await validateProblem(p, seen);
      results.push({ id: p.id, file, errs });
      process.stdout.write(errs.length ? 'x' : '.');
    }
  }));
  console.log('\n');
  for (const e of loadErrs) console.log('LOAD ERROR', e);
  const bad = results.filter((r) => r.errs.length);
  for (const r of bad) { console.log(`✗ [${r.file}] ${r.id}`); for (const e of r.errs) console.log('   - ' + e); }
  const stages = problems.reduce((n, x) => n + x.p.stages.length, 0);
  const byLevel = [1, 2, 3, 4, 5].map((l) => `L${l}:${problems.filter((x) => x.p.level === l).length}`).join(' ');
  console.log(`\n${problems.length} problems, ${stages} stages (${byLevel}). ${bad.length} with errors, ${loadErrs.length} load errors.`);
  process.exit(bad.length || loadErrs.length ? 1 : 0);
}

main();
