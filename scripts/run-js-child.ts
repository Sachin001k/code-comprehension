// Child process: read {files, testFiles} JSON on stdin, run with jsCore, print result JSON.
import { runJs } from '../src/runner/jsCore';

let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', async () => {
  const input = JSON.parse(buf);
  const out = await runJs({ files: input.files, testFiles: input.testFiles, now: () => performance.now() });
  process.stdout.write('__RESULT__' + JSON.stringify(out));
  process.exit(0);
});
