import type { RunOutput } from './jsCore';
import RunnerWorker from './worker.ts?worker';

/**
 * Runs code in a dedicated worker. JS workers are recreated on timeout (infinite loops).
 * The Python worker is kept warm because loading Pyodide takes a few seconds.
 */
let worker: Worker | null = null;
let workerLang: string | null = null;
let seq = 0;

function getWorker(lang: string) {
  const kind = lang === 'python' ? 'python' : 'js';
  if (!worker || workerLang !== kind) {
    worker?.terminate();
    worker = new RunnerWorker();
    workerLang = kind;
  }
  return worker;
}

export function warmRunner(lang: string) {
  if (lang === 'python') getWorker('python').postMessage({ type: 'warm', lang });
}

export function runTests(lang: string, files: Record<string, string>, testFiles: Record<string, string>, timeoutMs = 4000): Promise<RunOutput & { timedOut?: boolean }> {
  const w = getWorker(lang);
  const id = ++seq;
  // Python's first run includes Pyodide boot; give it extra time.
  const budget = lang === 'python' ? timeoutMs + 25000 : timeoutMs;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      resolve({ logs: [], results: [], error: `Timed out after ${timeoutMs} ms. Infinite loop or too slow for this input?`, durationMs: timeoutMs, timedOut: true });
    }, budget);
    const onMsg = (e: MessageEvent<{ id: number; out: RunOutput }>) => {
      if (e.data.id !== id) return;
      clearTimeout(t);
      w.removeEventListener('message', onMsg);
      const out = e.data.out;
      if (lang === 'python' && out.durationMs > timeoutMs) {
        resolve({ ...out, error: `Too slow: took ${Math.round(out.durationMs)} ms (budget ${timeoutMs} ms)`, timedOut: true });
      } else resolve(out);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, lang, files, testFiles });
  });
}
