/**
 * Python test harness source. Executed by Pyodide in the browser and by python3 in the validator.
 * Expects globals: WS (workspace root dir), TEST_FILES (list of repo-relative test paths).
 * Repo root is on sys.path, so tests import modules by absolute dotted path from the repo root.
 * Prints a single JSON line prefixed with __RESULT__.
 */
export const PY_HARNESS = String.raw`
import sys, os, json, time, traceback, importlib.util, io, contextlib, inspect, asyncio

def __cc_run(WS, TEST_FILES):
    if WS not in sys.path:
        sys.path.insert(0, WS)
    # drop cached workspace modules so edits are picked up between runs
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, '__file__', None) or ''
        if f.startswith(WS):
            del sys.modules[name]
    importlib.invalidate_caches()
    results = []
    logs = io.StringIO()
    err = None
    t0 = time.perf_counter()
    with contextlib.redirect_stdout(logs):
        for tf in TEST_FILES:
            full = os.path.join(WS, tf)
            modname = '__cc_test_' + tf.replace('/', '_').replace('.py', '')
            try:
                spec = importlib.util.spec_from_file_location(modname, full)
                m = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(m)
            except Exception as e:
                err = ''.join(traceback.format_exception_only(type(e), e)).strip()
                break
            for name, fn in list(vars(m).items()):
                if name.startswith('test') and callable(fn):
                    s = time.perf_counter()
                    try:
                        r = fn()
                        if inspect.iscoroutine(r):
                            asyncio.run(r)
                        results.append({'name': name, 'passed': True, 'durationMs': (time.perf_counter() - s) * 1000})
                    except AssertionError as e:
                        msg = str(e) or 'AssertionError'
                        tb = traceback.extract_tb(e.__traceback__)
                        if not str(e) and tb:
                            msg = 'AssertionError at line %d: %s' % (tb[-1].lineno, tb[-1].line)
                        results.append({'name': name, 'passed': False, 'error': msg, 'durationMs': (time.perf_counter() - s) * 1000})
                    except Exception as e:
                        results.append({'name': name, 'passed': False, 'error': ''.join(traceback.format_exception_only(type(e), e)).strip(), 'durationMs': (time.perf_counter() - s) * 1000})
    out = {'logs': [l for l in logs.getvalue().split('\n') if l != ''], 'results': results, 'durationMs': (time.perf_counter() - t0) * 1000}
    if err:
        out['error'] = err
    return json.dumps(out)
`;
