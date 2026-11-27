/// <reference lib="webworker" />
import { runJs, type RunOutput } from './jsCore';
import { PY_HARNESS } from './pyHarness';

const PYODIDE_VERSION = '0.27.7';

interface Req {
  id: number;
  lang: string;
  files: Record<string, string>;
  testFiles: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodidePromise: Promise<any> | null = null;

function loadPy() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const url = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
      const mod = await import(/* @vite-ignore */ `${url}pyodide.mjs`);
      const py = await mod.loadPyodide({ indexURL: url });
      py.runPython(PY_HARNESS);
      return py;
    })();
  }
  return pyodidePromise;
}

let runCounter = 0;

async function runPython(files: Record<string, string>, testFiles: Record<string, string>): Promise<RunOutput> {
  const py = await loadPy();
  const ws = `/home/pyodide/ws${++runCounter}`;
  const all = { ...files, ...testFiles };
  for (const [p, c] of Object.entries(all)) {
    const full = `${ws}/${p}`;
    const dir = full.slice(0, full.lastIndexOf('/'));
    py.FS.mkdirTree(dir);
    py.FS.writeFile(full, c);
  }
  const fn = py.globals.get('__cc_run');
  const json = fn(ws, py.toPy(Object.keys(testFiles)));
  fn.destroy?.();
  return JSON.parse(json);
}

self.onmessage = async (e: MessageEvent<Req | { type: 'warm'; lang: string }>) => {
  const msg = e.data;
  if ('type' in msg) {
    if (msg.lang === 'python') loadPy().catch(() => {});
    return;
  }
  try {
    const out =
      msg.lang === 'python'
        ? await runPython(msg.files, msg.testFiles)
        : await runJs({ files: msg.files, testFiles: msg.testFiles, now: () => performance.now() });
    self.postMessage({ id: msg.id, out });
  } catch (err) {
    self.postMessage({ id: msg.id, out: { logs: [], results: [], error: String((err as Error)?.message ?? err), durationMs: 0 } });
  }
};
