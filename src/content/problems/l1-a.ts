import type { Problem } from '../types';

/**
 * Level 1 "Line Reader" — slice A (JavaScript).
 * Python half of this slice lives in l1-a2.ts.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------- 1
  {
    id: 'l1-a-js-premium-picks-sort',
    title: 'Premium Picks Banner',
    level: 1,
    rating: 650,
    lang: 'javascript',
    domain: 'pricing',
    companies: ['amazon', 'canva', 'generic'],
    tags: ['array-sort', 'lexicographic', 'default-comparator'],
    summary: 'The "most expensive" banner is showing a $9 item. Why?',
    context:
      'Merchandising reports that the **Premium picks** banner on the storefront shows cheap items. The banner is fed by `topPrices` in `pricing.js`.',
    files: [
      {
        path: 'pricing.js',
        content: `// Returns the N highest prices for the "Premium picks" banner.
function topPrices(prices, n) {
  const sorted = prices.slice().sort();
  return sorted.reverse().slice(0, n);
}

module.exports = { topPrices };
`,
      },
      {
        path: 'main.js',
        content: `const { topPrices } = require('./pricing');

const prices = [25, 100, 9, 1500, 80];
console.log(topPrices(prices, 3).join(','));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What does the banner show?',
        prompt: 'Run `main.js` in your head. What exactly is printed?',
        entry: 'main.js',
        answer: '9,80,25',
        options: ['1500,100,80', '9,80,25', '100,1500,25', '1500,100,25'],
        hints: [
          '`Array.prototype.sort()` with no comparator does not compare numbers numerically.',
          'Convert every price to a string and sort them like dictionary words: "100" < "1500" < "25" < "80" < "9".',
        ],
        explanation:
          'With no comparator, `sort()` converts elements to strings and compares UTF-16 code units. So the ascending order is `"100", "1500", "25", "80", "9"` — `"9"` sorts last because the character `9` is greater than `8`, `2` and `1`. Reversing gives `9, 80, 25, 1500, 100`, and the first three are `9,80,25`. This is one of the most common JS surprises: always pass `(a, b) => a - b` when sorting numbers.',
        timeLimitSec: 150,
        focusFile: 'pricing.js',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix the banner',
        prompt:
          'Fix `topPrices` so it returns the `n` highest prices in **descending numeric** order. It must not mutate the caller\'s array.',
        editable: ['pricing.js'],
        tests: [
          {
            path: 'tests/pricing.test.js',
            content: `const { topPrices } = require('../pricing');

test('returns highest prices numerically', () => {
  expect(topPrices([25, 100, 9, 1500, 80], 3)).toEqual([1500, 100, 80]);
});

test('handles decimals and duplicates', () => {
  expect(topPrices([9.99, 10, 2, 10, 100.5], 2)).toEqual([100.5, 10]);
});

test('does not mutate input', () => {
  const input = [3, 20, 100];
  topPrices(input, 2);
  expect(input).toEqual([3, 20, 100]);
});

test('n larger than list', () => {
  expect(topPrices([5, 40], 10)).toEqual([40, 5]);
});
`,
          },
        ],
        solution: {
          'pricing.js': `// Returns the N highest prices for the "Premium picks" banner.
function topPrices(prices, n) {
  const sorted = prices.slice().sort((a, b) => b - a);
  return sorted.slice(0, n);
}

module.exports = { topPrices };
`,
        },
        hints: [
          'Pass a comparator to `sort`.',
          '`(a, b) => b - a` sorts numbers in descending order, so you no longer need `reverse()`.',
        ],
        explanation:
          'A numeric comparator returns a negative number when `a` should come first. `(a, b) => b - a` sorts descending. `slice()` before `sort()` matters because `sort` sorts **in place** — without the copy you would reorder the caller\'s array.',
        timeLimitSec: 300,
        focusFile: 'pricing.js',
      },
    ],
  },

  // ---------------------------------------------------------------- 2
  {
    id: 'l1-a-js-remote-flags-equality',
    title: 'Remote Feature Flags',
    level: 1,
    rating: 700,
    lang: 'javascript',
    domain: 'config',
    companies: ['meta', 'atlassian'],
    tags: ['loose-equality', 'type-coercion', 'truthiness'],
    summary: '`"true" == true` — is the new checkout on or off?',
    context:
      'Flags come from a remote config service that is sloppy about types: some are strings, some numbers, some booleans.',
    files: [
      {
        path: 'flags.js',
        content: `// Flags arrive from the remote config service as strings, numbers or booleans.
const remoteFlags = {
  newCheckout: 'true',
  darkMode: 1,
  betaSearch: '0',
  legacyExport: false,
  maxRetries: '3',
};

function isOn(name) {
  return remoteFlags[name] == true;
}

console.log(isOn('newCheckout'), isOn('darkMode'), isOn('betaSearch'), isOn('legacyExport'));
console.log(remoteFlags.maxRetries == 3, remoteFlags.maxRetries === 3);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Which flags are on?',
        prompt: 'Predict the exact output of `flags.js`.',
        answer: 'false true false false\ntrue false',
        options: [
          'true true false false\ntrue false',
          'false true false false\ntrue false',
          'true true true false\ntrue false',
          'false true false false\nfalse false',
        ],
        hints: [
          'With `==`, a boolean operand is converted to a number first: `true` becomes `1`.',
          'Then a string compared to a number is converted to a number: `Number("true")` is `NaN`.',
        ],
        explanation:
          '`x == true` is **not** a truthiness check. The abstract equality algorithm converts `true` to `1`, then converts the other side to a number too. `"true"` → `NaN` (not equal to 1), `1` → equal, `"0"` → `0` (not equal), `false` → `0` (not equal). On line 2, `"3" == 3` coerces the string to `3` (true) while `===` compares types first and returns false.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'What about plain truthiness?',
        prompt:
          'A teammate proposes `return Boolean(remoteFlags[name]);` instead. Which flags would then be reported as ON? Select all that apply.',
        options: ['newCheckout (\'true\')', 'darkMode (1)', 'betaSearch (\'0\')', 'legacyExport (false)', 'maxRetries (\'3\')'],
        correct: [0, 1, 2, 4],
        hints: ['Every non-empty string is truthy — including `"0"` and `"false"`.'],
        explanation:
          'The falsy values in JS are `false, 0, -0, 0n, "", null, undefined, NaN`. Any non-empty string is truthy, so `"0"` turns `betaSearch` ON — the opposite of what the config author meant. Neither `== true` nor `Boolean()` is right for mixed-type flags; parse explicitly (e.g. `v === true || v === 1 || v === "true"`).',
        timeLimitSec: 150,
      },
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 'l1-a-js-retry-plan-var',
    title: 'Retry Plan Builder',
    level: 1,
    rating: 950,
    lang: 'javascript',
    domain: 'scheduler',
    companies: ['google', 'uber'],
    tags: ['closures', 'var-vs-let', 'loops'],
    summary: 'Three retry callbacks, all of them think they are attempt 4.',
    context:
      'The job scheduler builds one callback per backoff slot, and the ops dashboard calls them to render the retry plan. The dashboard shows nonsense.',
    persona: 'confident-intern',
    files: [
      {
        path: 'retry.js',
        content: `// Builds one describer callback per backoff slot.
function buildRetryPlan(delaysMs) {
  const steps = [];
  for (var i = 0; i < delaysMs.length; i++) {
    steps.push(() => \`attempt \${i + 1} after \${delaysMs[i]}ms\`);
  }
  return steps;
}

module.exports = { buildRetryPlan };
`,
      },
      {
        path: 'main.js',
        content: `const { buildRetryPlan } = require('./retry');

const plan = buildRetryPlan([100, 200, 400]);
console.log(plan[0]());
console.log(plan.length);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What does the first step say?',
        prompt: 'Predict the output of `main.js`.',
        entry: 'main.js',
        answer: 'attempt 4 after undefinedms\n3',
        options: [
          'attempt 1 after 100ms\n3',
          'attempt 4 after undefinedms\n3',
          'attempt 3 after 400ms\n3',
          'attempt 4 after 400ms\n3',
        ],
        hints: [
          'The arrow functions run *after* the loop has finished.',
          '`var` is function-scoped: there is a single `i` shared by all three closures. What is its value once the loop exits?',
        ],
        explanation:
          'Closures capture **variables**, not values. Because `i` is declared with `var`, there is exactly one `i` for the whole function. When `plan[0]()` runs, the loop has finished and `i === 3`, so it prints `attempt 4` and `delaysMs[3]` is `undefined`. With `let`, each iteration gets a fresh binding, so each closure would see its own `i`.',
        timeLimitSec: 180,
        focusFile: 'retry.js',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix the retry plan',
        prompt: 'Make each callback describe its own slot, e.g. `attempt 2 after 200ms`.',
        editable: ['retry.js'],
        tests: [
          {
            path: 'tests/retry.test.js',
            content: `const { buildRetryPlan } = require('../retry');

test('each step describes its own slot', () => {
  const plan = buildRetryPlan([100, 200, 400]);
  expect(plan.map((f) => f())).toEqual([
    'attempt 1 after 100ms',
    'attempt 2 after 200ms',
    'attempt 3 after 400ms',
  ]);
});

test('empty plan', () => {
  expect(buildRetryPlan([])).toHaveLength(0);
});
`,
          },
        ],
        solution: {
          'retry.js': `// Builds one describer callback per backoff slot.
function buildRetryPlan(delaysMs) {
  const steps = [];
  for (let i = 0; i < delaysMs.length; i++) {
    steps.push(() => \`attempt \${i + 1} after \${delaysMs[i]}ms\`);
  }
  return steps;
}

module.exports = { buildRetryPlan };
`,
        },
        hints: ['One keyword change is enough.', 'A `let` in a `for` header creates a new binding per iteration.'],
        explanation:
          'Changing `var` to `let` gives every iteration its own `i`, so each arrow function closes over a different variable. `delaysMs.map((d, i) => () => ...)` works too, for the same reason: each callback invocation has its own parameters.',
        timeLimitSec: 240,
        focusFile: 'retry.js',
      },
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 'l1-a-js-outbox-slice-splice',
    title: 'Chat Outbox Batching',
    level: 1,
    rating: 800,
    lang: 'javascript',
    domain: 'chat',
    companies: ['meta', 'atlassian', 'generic'],
    tags: ['slice', 'splice', 'mutation'],
    summary: '`slice` and `splice` differ by one letter and one very big side effect.',
    files: [
      {
        path: 'outbox.js',
        content: `// Outbound chat messages are flushed to the socket in batches.
const outbox = ['m1', 'm2', 'm3', 'm4', 'm5'];

const preview = outbox.slice(1, 3);
console.log(preview, outbox.length);

const batch = outbox.splice(1, 3);
console.log(batch, outbox.length);

console.log(outbox.join('|'));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the batches',
        prompt: 'What does `outbox.js` print? (Node prints arrays as `[ \'a\', \'b\' ]`.)',
        answer: "[ 'm2', 'm3' ] 5\n[ 'm2', 'm3', 'm4' ] 2\nm1|m5",
        options: [
          "[ 'm2', 'm3' ] 5\n[ 'm2', 'm3', 'm4' ] 2\nm1|m5",
          "[ 'm2', 'm3' ] 5\n[ 'm2', 'm3' ] 3\nm1|m4|m5",
          "[ 'm2', 'm3', 'm4' ] 5\n[ 'm2', 'm3', 'm4' ] 2\nm1|m5",
          "[ 'm2', 'm3' ] 3\n[ 'm2', 'm3', 'm4' ] 2\nm1|m5",
        ],
        hints: [
          '`slice(start, end)` — end is exclusive, and the original is untouched.',
          '`splice(start, deleteCount)` — the second argument is a **count**, and it removes from the original.',
        ],
        explanation:
          '`slice(1, 3)` copies indices 1 and 2 (end exclusive) and leaves `outbox` alone (length 5). `splice(1, 3)` removes **three** elements starting at index 1 (`m2, m3, m4`), returns them, and mutates `outbox` down to `[m1, m5]`. Confusing the second argument (end index vs. delete count) is a classic off-by-N bug.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Which ones mutate?',
        prompt: 'Which of these array methods modify the array they are called on? Select all that apply.',
        options: ['slice', 'splice', 'sort', 'map', 'concat', 'reverse'],
        correct: [1, 2, 5],
        hints: ['Ask: does the method return a *new* array, or the same one?'],
        explanation:
          '`splice`, `sort` and `reverse` work in place (`sort` and `reverse` also return the same array, which makes the mutation easy to miss). `slice`, `map` and `concat` return new arrays. Modern JS adds non-mutating `toSorted`, `toReversed` and `toSpliced`.',
        timeLimitSec: 120,
      },
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 'l1-a-js-stock-zero-qty',
    title: 'Zero Is Not Missing',
    level: 1,
    rating: 750,
    lang: 'javascript',
    domain: 'inventory',
    companies: ['amazon', 'generic'],
    tags: ['truthiness', 'default-values', 'nullish-coalescing'],
    summary: 'A stock-take of zero keeps turning into one.',
    context:
      'Warehouse scanners send stock adjustments. When a picker scans an empty bin (qty 0), the system records 1 unit. `qty` is optional and should default to 1 only when it is not sent.',
    persona: 'lazy-copier',
    files: [
      {
        path: 'inventory/adjust.js',
        content: `// Applies a stock adjustment coming from the warehouse scanner.
// payload: { sku: string, qty?: number }  (qty defaults to 1 when omitted)
function parseAdjustment(payload) {
  const qty = payload.qty || 1;
  if (!payload.sku) {
    throw new Error('sku required');
  }
  return { sku: payload.sku.trim(), qty };
}

module.exports = { parseAdjustment };
`,
      },
      {
        path: 'main.js',
        content: `const { parseAdjustment } = require('./inventory/adjust');

const a = parseAdjustment({ sku: ' A1 ', qty: 0 });
const b = parseAdjustment({ sku: 'B2' });
const c = parseAdjustment({ sku: 'C3', qty: -2 });
console.log(a.qty, b.qty, c.qty);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce',
        prompt: 'What does `main.js` print? Type the single output line.',
        entry: 'main.js',
        answer: '1 1 -2',
        hints: ['`||` returns its right operand whenever the left one is **falsy**.', 'Is `0` falsy? Is `-2`?'],
        explanation:
          '`0 || 1` is `1` because `0` is falsy. `undefined || 1` is `1` as intended. `-2` is truthy (only `0` and `-0` are falsy numbers, plus `NaN`), so it passes through. Output: `1 1 -2`.',
        timeLimitSec: 120,
        focusFile: 'inventory/adjust.js',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the line',
        prompt: 'Click the line that turns an empty bin into 1 unit, then pick the root cause.',
        file: 'inventory/adjust.js',
        lines: [4],
        options: [
          '`||` falls back for every falsy value, including a legitimate 0',
          'The `sku` check runs after `qty` is computed, so `qty` is wrong',
          '`trim()` changes the SKU and breaks the lookup',
          'Destructuring `payload` would copy `qty` by reference',
        ],
        correct: 0,
        hints: ['The bug is about which values count as "not provided".'],
        explanation:
          'Line 4 uses `||`, which treats `0`, `""`, `NaN` and `false` as missing. Use `??` (nullish coalescing), which only falls back for `null` and `undefined`.',
        timeLimitSec: 120,
        focusFile: 'inventory/adjust.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Ship the fix',
        prompt: 'Fix `parseAdjustment`: `qty` defaults to 1 only when it is `undefined` or `null`. A qty of `0` must be kept.',
        editable: ['inventory/adjust.js'],
        tests: [
          {
            path: 'tests/adjust.test.js',
            content: `const { parseAdjustment } = require('../inventory/adjust');

test('keeps zero', () => {
  expect(parseAdjustment({ sku: 'A1', qty: 0 }).qty).toBe(0);
});

test('defaults when omitted or null', () => {
  expect(parseAdjustment({ sku: 'A1' }).qty).toBe(1);
  expect(parseAdjustment({ sku: 'A1', qty: null }).qty).toBe(1);
});

test('keeps negative corrections', () => {
  expect(parseAdjustment({ sku: 'A1', qty: -2 }).qty).toBe(-2);
});

test('still validates sku and trims it', () => {
  expect(() => parseAdjustment({ qty: 3 })).toThrow('sku required');
  expect(parseAdjustment({ sku: ' Z9 ', qty: 5 })).toEqual({ sku: 'Z9', qty: 5 });
});
`,
          },
        ],
        solution: {
          'inventory/adjust.js': `// Applies a stock adjustment coming from the warehouse scanner.
// payload: { sku: string, qty?: number }  (qty defaults to 1 when omitted)
function parseAdjustment(payload) {
  const qty = payload.qty ?? 1;
  if (!payload.sku) {
    throw new Error('sku required');
  }
  return { sku: payload.sku.trim(), qty };
}

module.exports = { parseAdjustment };
`,
        },
        hints: ['There is an operator that only falls back on `null`/`undefined`.'],
        explanation:
          '`payload.qty ?? 1` keeps `0` and only defaults on `null`/`undefined`. An equivalent explicit form is `payload.qty === undefined || payload.qty === null ? 1 : payload.qty`.',
        timeLimitSec: 240,
        focusFile: 'inventory/adjust.js',
      },
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 'l1-a-js-config-hoisting',
    title: 'Config Bootstrap Order',
    level: 1,
    rating: 1000,
    lang: 'javascript',
    domain: 'config',
    companies: ['google', 'microsoft'],
    tags: ['hoisting', 'var', 'tdz', 'function-scope'],
    summary: 'Using things before they are declared — sometimes it works, sometimes it is `undefined`.',
    files: [
      {
        path: 'bootstrap.js',
        content: `// Bootstraps service config. Declaration order matters more than it looks.
console.log(typeof region, typeof loadDefaults, typeof applyOverrides);

var region = 'eu-west-1';

function loadDefaults() {
  return { region, retries: 3 };
}

var applyOverrides = function (cfg) {
  return { ...cfg, retries: 5 };
};

const early = loadDefaults();
console.log(early.region);

function timeoutFor() {
  if (!timeout) {
    var timeout = 30;
  }
  return timeout;
}
console.log(timeoutFor());
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the bootstrap log',
        prompt: 'What does `bootstrap.js` print?',
        answer: 'undefined function undefined\neu-west-1\n30',
        options: [
          'undefined function undefined\neu-west-1\n30',
          'string function function\neu-west-1\n30',
          'undefined function function\neu-west-1\n30',
          'undefined function undefined\neu-west-1\nundefined',
        ],
        hints: [
          '`var` declarations are hoisted and initialised to `undefined`; function *declarations* are hoisted together with their body.',
          '`var applyOverrides = function ...` is a variable holding a function expression — only the variable is hoisted.',
          'A `var` inside an `if` block belongs to the whole function, not the block.',
        ],
        explanation:
          'Line 2 runs before any assignment: `region` is hoisted as `undefined`, `loadDefaults` is a function declaration (fully hoisted), and `applyOverrides` is a `var` that is still `undefined`. By line 14 `region` has been assigned, so `loadDefaults()` sees `eu-west-1`. In `timeoutFor`, `var timeout` is hoisted to the top of the function as `undefined`, so `!timeout` is true and it returns `30`.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Swap var for let',
        prompt: 'If line 4 is changed to `let region = \'eu-west-1\';`, what happens when the file runs?',
        options: [
          'Line 2 throws a ReferenceError (region is in the temporal dead zone)',
          'Line 2 prints `undefined function undefined` exactly as before',
          'Line 2 prints `string function undefined`',
          '`typeof` never throws, so only `loadDefaults()` would throw',
        ],
        correct: [0],
        hints: ['`let`/`const` are hoisted too — but not initialised.'],
        explanation:
          '`let` and `const` bindings exist from the start of their scope but are uninitialised until the declaration line runs (the temporal dead zone). Any access — even `typeof region` — throws `ReferenceError: Cannot access \'region\' before initialization`. `typeof` is only "safe" for identifiers that are not declared at all.',
        timeLimitSec: 150,
      },
    ],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 'l1-a-js-payout-reduce',
    title: 'End-of-Day Payout',
    level: 1,
    rating: 900,
    lang: 'javascript',
    domain: 'payments',
    companies: ['stripe', 'amazon', 'jpmorgan'],
    tags: ['reduce', 'initial-value', 'type-coercion'],
    summary: 'A merchant\'s payout reads "NaN". Finance is not amused.',
    context:
      'The settlement job computes each merchant\'s payout as the sum of their **settled** transactions. Merchant `acme` got a payout email saying `acme: NaN`.',
    persona: 'confident-intern',
    files: [
      {
        path: 'payments/settlement.js',
        content: `// Computes a merchant's end-of-day payout from its transactions.
function totalCents(transactions) {
  return transactions
    .filter((t) => t.status === 'settled')
    .reduce((sum, t) => sum + t.amountCents);
}

function formatPayout(merchant, transactions) {
  const cents = totalCents(transactions);
  return \`\${merchant}: \${cents / 100}\`;
}

module.exports = { totalCents, formatPayout };
`,
      },
      {
        path: 'main.js',
        content: `const { formatPayout } = require('./payments/settlement');

const txns = [
  { id: 't1', status: 'settled', amountCents: 1250 },
  { id: 't2', status: 'refunded', amountCents: 500 },
  { id: 't3', status: 'settled', amountCents: 750 },
];
console.log(formatPayout('acme', txns));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Reproduce the email',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'acme: NaN',
        options: ['acme: 20', 'acme: 25', 'acme: NaN', 'acme: [object Object]750'],
        hints: [
          'When `reduce` has no initial value, the **first element** becomes the initial accumulator.',
          'What is `{...} + 750`? And what is that divided by 100?',
        ],
        explanation:
          'Without an initial value, `reduce` uses the first settled transaction **object** as `sum`. `object + 750` converts the object to the string `"[object Object]"` and concatenates: `"[object Object]750"`. Dividing that string by 100 gives `NaN`.',
        timeLimitSec: 180,
        focusFile: 'payments/settlement.js',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Locate the bug',
        prompt: 'Click the buggy line and choose the root cause.',
        file: 'payments/settlement.js',
        lines: [5],
        options: [
          '`reduce` has no initial value, so the accumulator starts as a transaction object',
          '`filter` should use `==` instead of `===`',
          'Dividing by 100 should be done with integer division',
          'The template literal converts the number to a string too early',
        ],
        correct: 0,
        hints: ['Look at the arguments passed to `reduce`.'],
        explanation:
          'Line 5 calls `reduce(fn)` with no seed. The seed should be `0` so the accumulator is a number from the start. As a bonus, a seed also stops `reduce` from throwing `TypeError: Reduce of empty array with no initial value` on a merchant with no settled transactions.',
        timeLimitSec: 120,
        focusFile: 'payments/settlement.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the payout',
        prompt: 'Fix `totalCents`. It must return `0` for a merchant with no settled transactions (today it throws).',
        editable: ['payments/settlement.js'],
        tests: [
          {
            path: 'tests/settlement.test.js',
            content: `const { totalCents, formatPayout } = require('../payments/settlement');

const txns = [
  { id: 't1', status: 'settled', amountCents: 1250 },
  { id: 't2', status: 'refunded', amountCents: 500 },
  { id: 't3', status: 'settled', amountCents: 750 },
];

test('sums settled transactions', () => {
  expect(totalCents(txns)).toBe(2000);
  expect(formatPayout('acme', txns)).toBe('acme: 20');
});

test('single settled transaction', () => {
  expect(totalCents([txns[0]])).toBe(1250);
});

test('no settled transactions', () => {
  expect(totalCents([])).toBe(0);
  expect(totalCents([txns[1]])).toBe(0);
});
`,
          },
        ],
        solution: {
          'payments/settlement.js': `// Computes a merchant's end-of-day payout from its transactions.
function totalCents(transactions) {
  return transactions
    .filter((t) => t.status === 'settled')
    .reduce((sum, t) => sum + t.amountCents, 0);
}

function formatPayout(merchant, transactions) {
  const cents = totalCents(transactions);
  return \`\${merchant}: \${cents / 100}\`;
}

module.exports = { totalCents, formatPayout };
`,
        },
        hints: ['`reduce(callback, initialValue)`'],
        explanation:
          'Seeding `reduce` with `0` fixes both bugs: the accumulator is always a number, and an empty array returns the seed instead of throwing. Rule of thumb: always pass an initial value when the accumulator has a different type from the elements.',
        timeLimitSec: 240,
        focusFile: 'payments/settlement.js',
      },
    ],
  },

  // ---------------------------------------------------------------- 8
  {
    id: 'l1-a-js-session-short-circuit',
    title: 'Session Header Helpers',
    level: 1,
    rating: 850,
    lang: 'javascript',
    domain: 'auth',
    companies: ['atlassian', 'canva'],
    tags: ['short-circuit', 'operator-precedence', 'truthiness'],
    summary: '`&&` and `||` return operands, not booleans — and `&&` binds tighter.',
    files: [
      {
        path: 'session.js',
        content: `// Session helpers used by the header component.
function displayName(user) {
  return (user && user.profile && user.profile.nickname) || 'Anonymous';
}

function sessionBadge(user) {
  return user && user.isAdmin && 'ADMIN';
}

function canDelete(user, doc) {
  return user.isAdmin || doc.ownerId === user.id && !doc.locked;
}

const ana = { id: 7, isAdmin: false, profile: { nickname: '' } };
const raj = { id: 9, isAdmin: true, profile: null };

console.log(displayName(ana), displayName(raj));
console.log(sessionBadge(ana), sessionBadge(raj), sessionBadge(null));
console.log(canDelete(ana, { ownerId: 7, locked: true }), canDelete(raj, { ownerId: 7, locked: true }));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the header',
        prompt: 'What does `session.js` print?',
        answer: 'Anonymous Anonymous\nfalse ADMIN null\nfalse true',
        options: [
          'Anonymous Anonymous\nfalse ADMIN null\nfalse true',
          'Anonymous Anonymous\nfalse ADMIN false\nfalse true',
          ' Anonymous\nfalse true false\nfalse true',
          'Anonymous Anonymous\nfalse ADMIN null\nfalse false',
        ],
        hints: [
          '`a && b` returns `a` if `a` is falsy, otherwise `b`. It does not convert to boolean.',
          '`&&` has higher precedence than `||`: `x || y && z` means `x || (y && z)`.',
        ],
        explanation:
          '`displayName`: ana\'s nickname is `""` (falsy) and raj\'s profile is `null`, so both fall through to `"Anonymous"`. `sessionBadge` returns whichever operand stopped the chain: `false` (ana.isAdmin), `"ADMIN"`, and `null` (the user itself). `canDelete` parses as `user.isAdmin || (owner && !locked)`: ana owns the doc but it is locked → `false`; raj is admin → `true`.',
        timeLimitSec: 210,
      },
    ],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 'l1-a-js-checkout-finally-trace',
    title: 'Seat Checkout Log',
    level: 1,
    rating: 1050,
    lang: 'javascript',
    domain: 'booking',
    companies: ['uber', 'atlassian', 'generic'],
    tags: ['try-catch-finally', 'control-flow', 'tracing'],
    summary: 'Order the log lines of a failed checkout, including the `finally`.',
    files: [
      {
        path: 'checkout.js',
        content: `function log(msg) {
  console.log(msg);
}

function reserveSeat(seat) {
  log(\`reserve \${seat}\`);
  if (seat === 'B2') throw new Error('taken');
  return seat;
}

function checkout(seats) {
  log('checkout start');
  try {
    for (const s of seats) {
      reserveSeat(s);
    }
    log('payment');
    return 'ok';
  } catch (e) {
    log(\`rollback: \${e.message}\`);
    return 'failed';
  } finally {
    log('release lock');
  }
}

log(\`result \${checkout(['A1', 'B2', 'C3'])}\`);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Order the log lines',
        prompt: 'Put the lines printed by `checkout.js` in the order they appear.',
        items: ['checkout start', 'reserve A1', 'reserve B2', 'rollback: taken', 'release lock', 'result failed'],
        hints: [
          'The throw in `reserveSeat(\'B2\')` aborts the loop — `C3` is never attempted and `payment` is never logged.',
          '`finally` runs after the `catch` block\'s `return` expression is evaluated, but before the function actually returns.',
        ],
        explanation:
          'The outer `log(...)` must evaluate its argument first, so `checkout` runs fully before `result ...` prints. Inside, A1 succeeds, B2 throws, control jumps to `catch` (logs rollback, computes return value `"failed"`), then `finally` runs (`release lock`), and only then does `checkout` return to the template literal.',
        timeLimitSec: 210,
        focusFile: 'checkout.js',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'The happy path',
        prompt: 'If the call were `checkout([\'A1\', \'C3\'])`, what would the **last three** printed lines be?',
        options: [
          'payment → release lock → result ok',
          'release lock → payment → result ok',
          'payment → result ok → release lock',
          'reserve C3 → payment → result ok',
        ],
        correct: [0],
        hints: ['`finally` runs on the success path too, after `return \'ok\'` is evaluated.'],
        explanation:
          '`finally` always runs before control leaves the `try` statement, whether via normal completion, `return`, or an exception. So `payment` → (return value computed) → `release lock` → caller logs `result ok`.',
        timeLimitSec: 120,
      },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 'l1-a-js-oncall-negative-modulo',
    title: 'Who Was On Call?',
    level: 1,
    rating: 925,
    lang: 'javascript',
    domain: 'scheduler',
    companies: ['google', 'amazon', 'atlassian'],
    tags: ['modulo', 'negative-numbers', 'array-indexing'],
    summary: 'Looking back past week 0 of the rotation returns `undefined`.',
    context:
      'The incident tool asks "who was on call N weeks ago?" to page the right person for a post-mortem. For early shifts, it pages nobody.',
    files: [
      {
        path: 'rotation.js',
        content: `// On-call rotation: engineers take turns; shift 0 is the first engineer.
const ENGINEERS = ['asha', 'ben', 'chen', 'dara'];

// Who was on call \`weeksAgo\` weeks before the given shift?
function previousOnCall(currentShift, weeksAgo) {
  const idx = (currentShift - weeksAgo) % ENGINEERS.length;
  return ENGINEERS[idx];
}

module.exports = { previousOnCall, ENGINEERS };
`,
      },
      {
        path: 'main.js',
        content: `const { previousOnCall } = require('./rotation');

console.log(previousOnCall(5, 2), previousOnCall(1, 2), previousOnCall(2, 6));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Page the right person',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'dara undefined asha',
        options: ['dara undefined asha', 'dara dara asha', 'dara undefined undefined', 'chen undefined asha'],
        hints: [
          'In JS, `%` is a *remainder*: the result takes the sign of the dividend. `-1 % 4` is `-1`.',
          '`-4 % 4` is `-0`. What property key does `-0` become?',
        ],
        explanation:
          '`(5-2) % 4 = 3` → `dara`. `(1-2) % 4 = -1`, and `ENGINEERS[-1]` is `undefined` (JS arrays have no negative indexing with `[]`). `(2-6) % 4` is `-0`; property keys are strings and `String(-0)` is `"0"`, so you get `asha` — by luck. Python\'s `%` would give `3` for `-1 % 4`, because Python floors instead of truncating.',
        timeLimitSec: 180,
        focusFile: 'rotation.js',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Wrap around correctly',
        prompt: 'Fix `previousOnCall` so looking back past shift 0 wraps around the rotation (e.g. shift 1, 2 weeks ago → `dara`).',
        editable: ['rotation.js'],
        tests: [
          {
            path: 'tests/rotation.test.js',
            content: `const { previousOnCall } = require('../rotation');

test('simple look-back', () => {
  expect(previousOnCall(5, 2)).toBe('dara');
  expect(previousOnCall(3, 0)).toBe('dara');
});

test('wraps around before shift 0', () => {
  expect(previousOnCall(1, 2)).toBe('dara');
  expect(previousOnCall(0, 1)).toBe('dara');
  expect(previousOnCall(0, 3)).toBe('ben');
});

test('looks back many cycles', () => {
  expect(previousOnCall(2, 6)).toBe('asha');
  expect(previousOnCall(2, 11)).toBe('dara');
});
`,
          },
        ],
        solution: {
          'rotation.js': `// On-call rotation: engineers take turns; shift 0 is the first engineer.
const ENGINEERS = ['asha', 'ben', 'chen', 'dara'];

// Who was on call \`weeksAgo\` weeks before the given shift?
function previousOnCall(currentShift, weeksAgo) {
  const n = ENGINEERS.length;
  const idx = (((currentShift - weeksAgo) % n) + n) % n;
  return ENGINEERS[idx];
}

module.exports = { previousOnCall, ENGINEERS };
`,
        },
        hints: ['A remainder is in the range `(-n, n)`. Shift it into `[0, n)`.', '`((x % n) + n) % n`'],
        explanation:
          '`((x % n) + n) % n` maps any integer into `[0, n)`: the inner `%` brings it into `(-n, n)`, adding `n` makes it non-negative, and the final `%` folds `n` back to `0`. `ENGINEERS.at(idx)` would also handle `-1..-n`, but only because the inner `%` already bounded the value.',
        timeLimitSec: 300,
        focusFile: 'rotation.js',
      },
    ],
  },

  // ---------------------------------------------------------------- 11
  {
    id: 'l1-a-js-csv-parseint-map',
    title: 'Warehouse CSV Quantities',
    level: 1,
    rating: 1150,
    lang: 'javascript',
    domain: 'parser',
    companies: ['amazon', 'blackrock', 'generic'],
    tags: ['map', 'parseInt', 'callback-arguments'],
    summary: '`map(parseInt)` looks fine in review. It is not.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'csv.js',
        content: `// Parses the "qty" column of a warehouse CSV export.
function parseQuantities(line) {
  return line.split(',').map(parseInt);
}

console.log(parseQuantities('10,10,10,7').join(' '));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Parse the column',
        prompt: 'What does `csv.js` print?',
        answer: '10 NaN 2 NaN',
        options: ['10 10 10 7', '10 NaN 2 NaN', '10 NaN 2 7', '10 1 2 3'],
        hints: [
          '`map` calls its callback with `(element, index, array)`.',
          '`parseInt(string, radix)` — the index becomes the radix. Radix 0 means "auto" (decimal here); radix 1 is invalid.',
        ],
        explanation:
          '`map` passes the index as the second argument, which `parseInt` interprets as the radix: `parseInt("10", 0)` → 10 (0 means default), `parseInt("10", 1)` → `NaN` (radix 1 is invalid), `parseInt("10", 2)` → 2 (binary), `parseInt("7", 3)` → `NaN` (7 is not a base-3 digit). Passing a function reference directly to `map` hands it *all* the callback arguments.',
        timeLimitSec: 210,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'The assistant\'s one-liner',
        prompt: 'You asked the assistant to fix it. Should you accept its suggestion?',
        persona: 'api-dreamer',
        request: 'parseQuantities("10,10,10,7") gives NaNs. Fix it with minimal change.',
        aiReply: `The issue is that \`parseInt\` needs an explicit radix. \`Array.prototype.map\` accepts the radix as its second argument and forwards it to the callback:

\`\`\`js
function parseQuantities(line) {
  return line.split(',').map(parseInt, 10);
}
\`\`\`

Now every element is parsed in base 10. ✅`,
        options: [
          'Accept: the second argument of `map` sets the radix for `parseInt`',
          'Reject: the second argument of `map` is `thisArg`; `parseInt` still receives the index as its radix, so the output is unchanged',
          'Reject: `parseInt` has no radix parameter; use `Number.parseInt` instead',
          'Accept, but `10` should be the string `"10"`',
        ],
        correct: 1,
        hints: ['Check the real signature: `arr.map(callbackFn, thisArg)`.'],
        explanation:
          '`map(callback, thisArg)` uses the second argument only as `this` inside the callback. `parseInt` ignores `this` and still receives `(element, index, array)`, so the output is still `10 NaN 2 NaN`. Correct fixes: `.map((s) => parseInt(s, 10))` or `.map(Number)` (note that `Number` differs: `Number("")` is `0` and `Number("7kg")` is `NaN`, while `parseInt("7kg", 10)` is `7`).',
        timeLimitSec: 180,
      },
    ],
  },

  // ---------------------------------------------------------------- 12
  {
    id: 'l1-a-js-search-paginate-defaults',
    title: 'Search Result Pages',
    level: 1,
    rating: 1100,
    lang: 'javascript',
    domain: 'search',
    companies: ['google', 'canva', 'meta'],
    tags: ['default-parameters', 'null-vs-undefined', 'slice'],
    summary: 'Default parameters kick in for `undefined`… and only for `undefined`.',
    context:
      'The search API forwards query params straight to `paginate`. When the client sends `page=null`, users see an empty results page.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'search/paginate.js',
        content: `// Returns one page of search results. Pages are 1-based.
function paginate(results, page = 1, pageSize = 3) {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

module.exports = { paginate };
`,
      },
      {
        path: 'main.js',
        content: `const { paginate } = require('./search/paginate');

const hits = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
console.log(paginate(hits).join(''));
console.log(paginate(hits, 3).join(''));
console.log(paginate(hits, undefined, 2).join(''));
console.log(paginate(hits, null).length);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the pages',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'abc\ng\nab\n0',
        options: ['abc\ng\nab\n0', 'abc\ng\nab\n3', 'abc\nghi\nab\n0', 'abc\ng\nabc\n3'],
        hints: [
          'A default parameter is used when the argument is `undefined` — explicitly passed or missing.',
          '`null - 1` is `-1`. What does `slice(-3, 0)` return?',
        ],
        explanation:
          'Page 1 → `abc`. Page 3 → start 6 → `g` (slice clamps at the end). Passing `undefined` explicitly still triggers the default, so page 1 with size 2 → `ab`. But `null` does **not** trigger defaults: `(null - 1) * 3` is `-3`, and `slice(-3, 0)` means "from 3-from-the-end up to index 0", which is empty → length `0`.',
        timeLimitSec: 210,
        focusFile: 'search/paginate.js',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Review the fix',
        prompt: 'The assistant proposes a fix. Should you accept it?',
        persona: 'helpful-senior',
        request: 'Make paginate treat null page / pageSize exactly like an omitted argument. Keep everything else the same.',
        aiReply: `Default parameters only apply to \`undefined\`, so \`null\` slips through. Normalise both with nullish coalescing:

\`\`\`js
function paginate(results, page, pageSize) {
  page = page ?? 1;
  pageSize = pageSize ?? 3;
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}
\`\`\`

\`??\` only replaces \`null\`/\`undefined\`, so explicit values like \`pageSize = 0\` are still respected exactly as before.`,
        options: [
          'Accept: `??` covers both null and undefined and leaves every other value unchanged',
          'Reject: `??` also replaces `0`, so `page = 0` silently becomes page 1',
          'Reject: default parameters already apply to `null`, so this changes nothing',
          'Reject: it should use `||` so that `0` and `""` are also defaulted',
        ],
        correct: 0,
        hints: ['Which values does `??` fall back on? Which values did the old default parameters fall back on?'],
        explanation:
          'The suggestion is correct. The old version defaulted on `undefined` only; the new one defaults on `undefined` and `null` and nothing else, which is exactly the request. Using `||` would change behaviour for `0`, `NaN` and `""`, which the request did not ask for. Not every AI suggestion is wrong — the skill is verifying, not reflexively rejecting.',
        timeLimitSec: 180,
      },
    ],
  },
];

export default problems;
