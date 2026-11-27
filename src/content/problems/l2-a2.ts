import type { Problem } from '../types';

/**
 * Level 2 "Function Tracer" — slice A (part 2).
 * Sorting, rounding, binary search, sliding window, two pointers, LRU, debounce,
 * date ranges, exception flow, generators.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 13. Comparator returning a boolean
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-search-rank-comparator',
    title: 'Search Ranking Ignores Relevance',
    level: 2,
    rating: 1350,
    lang: 'javascript',
    domain: 'search',
    companies: ['google', 'meta', 'canva'],
    tags: ['sorting', 'comparators', 'sort-stability'],
    summary: 'A comparator returns a boolean. Results come back in the original order.',
    context: 'Search results arrive ordered by recency. Ranking should put the highest relevance first and keep recency order among ties. Users say ranking "does nothing".',
    files: [
      {
        path: 'search/rank.js',
        content: `// Highest score first. Ties keep their incoming (recency) order.
function rankResults(results) {
  return results.slice().sort((a, b) => a.score < b.score);
}

function topIds(results, n) {
  return rankResults(results)
    .slice(0, n)
    .map((r) => r.id);
}

module.exports = { rankResults, topIds };
`,
      },
      {
        path: 'main.js',
        content: `const { topIds } = require('./search/rank');

const results = [
  { id: 'a', score: 2 },
  { id: 'b', score: 5 },
  { id: 'c', score: 2 },
  { id: 'd', score: 9 },
  { id: 'e', score: 5 },
];

console.log(topIds(results, 5).join(','));
console.log([10, 9, 1, 100].sort().join(','));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What order comes back? (Node.js)',
        prompt: 'Run under Node.js (V8). What does `main.js` print?',
        entry: 'main.js',
        answer: 'a,b,c,d,e\n1,10,100,9',
        options: [
          'd,b,e,a,c\n1,9,10,100',
          'a,b,c,d,e\n1,10,100,9',
          'd,b,e,a,c\n1,10,100,9',
          'a,c,b,e,d\n1,10,100,9',
        ],
        hints: [
          '`sort` expects a number: negative means "a before b", positive "a after b", 0 "equal". `true` becomes 1 and `false` becomes 0.',
          'Without a comparator, `sort` compares the values as **strings**.',
        ],
        explanation:
          'The comparator never returns a negative number, so the sort is never told that something must move earlier. V8 sorts short arrays with binary insertion: each new element is compared against earlier ones, gets `false` (0, "equal") or `true` (1, "after") and stays put, so the array comes back unchanged. (With an inconsistent comparator the spec leaves the order implementation-defined, so other engines may differ: another reason never to return booleans.) The default sort converts numbers to strings: `"1" < "10" < "100" < "9"`.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Spot the broken comparator',
        prompt: 'Click the buggy line and pick the root cause.',
        file: 'search/rank.js',
        lines: [3],
        options: [
          'The comparator returns a boolean; it must return a negative/zero/positive number such as `b.score - a.score`',
          '`slice()` makes the sort unstable',
          '`sort` must be called on the original array to be stable',
          'The comparator arguments are in the wrong order; `(b, a) => a.score < b.score` would work',
        ],
        correct: 0,
        hints: ['What value does the comparator return when `a.score > b.score`?'],
        explanation:
          'For `a.score > b.score` the comparator returns `false` → 0, i.e. "equal", so the sort has no way to learn the correct order. `b.score - a.score` returns negative when `a` should come first. `Array.prototype.sort` has been stable since ES2019, so returning 0 for ties keeps recency order.',
        timeLimitSec: 150,
        focusFile: 'search/rank.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the ranking',
        prompt: 'Fix `rankResults`: highest score first; equal scores keep their incoming order. Do not mutate the input.',
        editable: ['search/rank.js'],
        tests: [
          {
            path: 'tests/rank.test.js',
            content: `const { rankResults, topIds } = require('../search/rank');

const results = [
  { id: 'a', score: 2 },
  { id: 'b', score: 5 },
  { id: 'c', score: 2 },
  { id: 'd', score: 9 },
  { id: 'e', score: 5 },
];

test('highest first, ties stable', () => {
  expect(topIds(results, 5)).toEqual(['d', 'b', 'e', 'a', 'c']);
});

test('topIds limits', () => {
  expect(topIds(results, 2)).toEqual(['d', 'b']);
});

test('does not mutate input', () => {
  const copy = results.map((r) => r.id);
  rankResults(results);
  expect(results.map((r) => r.id)).toEqual(copy);
});

test('larger input', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 'x' + i, score: (i * 7) % 5 }));
  const ranked = rankResults(many);
  for (let i = 1; i < ranked.length; i++) {
    expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
  }
  expect(ranked[0].id).toBe('x2');
});
`,
          },
        ],
        solution: {
          'search/rank.js': `// Highest score first. Ties keep their incoming (recency) order.
function rankResults(results) {
  return results.slice().sort((a, b) => b.score - a.score);
}

function topIds(results, n) {
  return rankResults(results)
    .slice(0, n)
    .map((r) => r.id);
}

module.exports = { rankResults, topIds };
`,
        },
        hints: ['`b.score - a.score` sorts descending.'],
        explanation: 'A numeric comparator plus the guaranteed stability of `Array.prototype.sort` (ES2019+) gives "score desc, then original order" with no extra tie-breaker.',
        timeLimitSec: 240,
        focusFile: 'search/rank.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 14. Multi-key sort with stable passes in the wrong order
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-ticket-dispatch-sort',
    title: 'Support Queue: Two Sorts, Wrong Order',
    level: 2,
    rating: 1250,
    lang: 'python',
    domain: 'scheduler',
    companies: ['atlassian', 'microsoft', 'amazon'],
    tags: ['sorting', 'sort-stability', 'multi-key-sort'],
    summary: 'Two stable sorts should give "priority, then age". The queue is ordered by age only.',
    context: 'Agents must see the highest-priority tickets first and, within a priority, the oldest first. A low-priority ticket is at the top of the queue.',
    files: [
      {
        path: 'support/queue.py',
        content: `def dispatch_order(tickets):
    """Highest priority first; within a priority, oldest (smallest created) first."""
    ordered = sorted(tickets, key=lambda t: t["priority"], reverse=True)
    ordered = sorted(ordered, key=lambda t: t["created"])
    return [t["id"] for t in ordered]
`,
      },
      {
        path: 'main.py',
        content: `from support.queue import dispatch_order

TICKETS = [
    {"id": "T1", "priority": 1, "created": 5},
    {"id": "T2", "priority": 3, "created": 9},
    {"id": "T3", "priority": 2, "created": 1},
    {"id": "T4", "priority": 3, "created": 2},
    {"id": "T5", "priority": 1, "created": 3},
]

print(dispatch_order(TICKETS))
print([t["id"] for t in sorted(TICKETS, key=lambda t: t["priority"], reverse=True)])
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the queue',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "['T3', 'T4', 'T5', 'T1', 'T2']\n['T2', 'T4', 'T3', 'T1', 'T5']",
        options: [
          "['T4', 'T2', 'T3', 'T5', 'T1']\n['T2', 'T4', 'T3', 'T1', 'T5']",
          "['T3', 'T4', 'T5', 'T1', 'T2']\n['T2', 'T4', 'T3', 'T1', 'T5']",
          "['T3', 'T4', 'T5', 'T1', 'T2']\n['T4', 'T2', 'T3', 'T5', 'T1']",
          "['T3', 'T4', 'T5', 'T1', 'T2']\n['T5', 'T1', 'T3', 'T4', 'T2']",
        ],
        hints: [
          'The *last* sort decides the primary order; earlier sorts only break ties.',
          '`reverse=True` keeps equal elements in their original relative order (it is still stable).',
        ],
        explanation:
          'The final sort is by `created`, and all `created` values are distinct, so the priority pass is completely overwritten: the result is simply oldest first. In the second line, `reverse=True` does not reverse ties: T2 came before T4 in the input and stays before it, and T1 stays before T5.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Which pass is wrong?',
        prompt: 'Click a line involved in the bug and choose the explanation.',
        file: 'support/queue.py',
        lines: [3, 4],
        options: [
          'With successive stable sorts, the primary key must be sorted *last*; here the secondary key (`created`) is sorted last',
          '`sorted` is not stable when `reverse=True` is used',
          '`sorted` returns `None`, so `ordered` is lost',
          'The lambda captures `t` late, so all keys are equal',
        ],
        correct: 0,
        hints: ['Think of sorting a spreadsheet by column B, then by column A: which column ends up primary?'],
        explanation:
          'Stable multi-pass sorting works from the least significant key to the most significant. Swap the two passes, or do it in one pass with a tuple key: `key=lambda t: (-t["priority"], t["created"])`.',
        timeLimitSec: 150,
        focusFile: 'support/queue.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the dispatcher',
        prompt: 'Fix `dispatch_order`: highest priority first, then oldest first; full ties keep input order.',
        editable: ['support/queue.py'],
        tests: [
          {
            path: 'tests/test_queue.py',
            content: `from support.queue import dispatch_order

TICKETS = [
    {"id": "T1", "priority": 1, "created": 5},
    {"id": "T2", "priority": 3, "created": 9},
    {"id": "T3", "priority": 2, "created": 1},
    {"id": "T4", "priority": 3, "created": 2},
    {"id": "T5", "priority": 1, "created": 3},
]


def test_priority_then_age():
    assert dispatch_order(TICKETS) == ["T4", "T2", "T3", "T5", "T1"]


def test_full_ties_keep_input_order():
    ts = [{"id": "x", "priority": 1, "created": 1}, {"id": "y", "priority": 1, "created": 1}]
    assert dispatch_order(ts) == ["x", "y"]


def test_input_not_mutated():
    before = [t["id"] for t in TICKETS]
    dispatch_order(TICKETS)
    assert [t["id"] for t in TICKETS] == before
`,
          },
        ],
        solution: {
          'support/queue.py': `def dispatch_order(tickets):
    """Highest priority first; within a priority, oldest (smallest created) first."""
    ordered = sorted(tickets, key=lambda t: (-t["priority"], t["created"]))
    return [t["id"] for t in ordered]
`,
        },
        hints: ['A tuple key compares element by element. Negate the number you want descending.'],
        explanation: 'A tuple key `(-priority, created)` expresses both rules in one stable sort. Swapping the two passes (created first, then priority with `reverse=True`) is also correct.',
        timeLimitSec: 240,
        focusFile: 'support/queue.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 15. toFixed and float money
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-invoice-tofixed',
    title: 'The Missing Cent',
    level: 2,
    rating: 1450,
    lang: 'javascript',
    domain: 'payments',
    companies: ['stripe', 'blackrock', 'jpmorgan'],
    tags: ['floating-point', 'rounding', 'toFixed', 'money'],
    summary: 'Invoices computed with floats and `toFixed` are sometimes a cent short.',
    context:
      'Finance policy: each line\'s tax is rounded half-up to the nearest cent, then lines are summed. Prices are stored as integer cents and tax rates in basis points (500 = 5%). Some invoices are one cent short.',
    persona: 'confident-intern',
    files: [
      {
        path: 'billing/invoice.js',
        content: `// line = { unitCents, qty, taxBps }  (taxBps: 500 = 5%)
function lineTotal(line) {
  return (line.unitCents / 100) * line.qty * (1 + line.taxBps / 10000);
}

function formatMoney(dollars) {
  return '$' + dollars.toFixed(2);
}

function invoiceTotal(lines) {
  const sum = lines.reduce((acc, line) => acc + lineTotal(line), 0);
  return formatMoney(sum);
}

module.exports = { invoiceTotal, formatMoney };
`,
      },
      {
        path: 'main.js',
        content: `const { invoiceTotal } = require('./billing/invoice');

console.log((1.005).toFixed(2), (2.5).toFixed(0), (1.45).toFixed(1));
console.log(Math.round(1.005 * 100) / 100, 0.1 + 0.2 === 0.3);
console.log(invoiceTotal([{ unitCents: 190, qty: 1, taxBps: 500 }]));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the rounding',
        prompt: 'What does `main.js` print? (1.90 + 5% = 1.995, which policy rounds up to 2.00.)',
        entry: 'main.js',
        answer: '1.00 3 1.4\n1 false\n$1.99',
        options: ['1.01 3 1.5\n1.01 false\n$2.00', '1.00 2 1.4\n1 false\n$1.99', '1.00 3 1.4\n1 false\n$1.99', '1.00 3 1.5\n1.01 false\n$2.00', '1.01 3 1.4\n1 true\n$2.00'],
        hints: [
          '`1.005` is stored as 1.00499999999999989...; `toFixed` rounds the *exact binary* value.',
          '`2.5` is exactly representable, and `toFixed` rounds exact halves away from zero.',
          '1.9 * 1.05 in binary floating point is slightly below 1.995.',
        ],
        explanation:
          '`toFixed` works on the exact stored binary value. `1.005` and `1.45` are stored slightly *below* the decimal you wrote, so they round down (1.00, 1.4); `2.5` is exact and rounds up to 3. `1.005 * 100` is `100.49999999999999`, so `Math.round` gives 100 → 1. The invoice: `1.9 * 1.05` ≈ 1.99499999..., which `toFixed(2)` renders as `$1.99` instead of the policy\'s `$2.00`.',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'The classic StackOverflow fix',
        prompt: 'The assistant proposes this. Accept?',
        persona: 'confident-intern',
        request: 'toFixed rounds 1.995 down. Make formatMoney round half-up correctly.',
        aiReply: `\`toFixed\` is buggy. Use the standard rounding trick instead:

\`\`\`js
function formatMoney(dollars) {
  const rounded = Math.round(dollars * 100) / 100;
  return '$' + rounded.toFixed(2);
}
\`\`\`

\`Math.round\` always rounds .5 up, so 1.995 → 2.00. ✅`,
        options: [
          'Accept: `Math.round` rounds halves up, fixing the issue',
          'Reject: the value is already below 1.995 in binary (and `x * 100` can land on 199.49999…), so the result is still $1.99; money must be computed in integer cents',
          'Reject: `Math.round` rounds half to even',
          'Reject: `toFixed` must be removed entirely or it will round a second time to $2.01',
        ],
        correct: 1,
        hints: ['Evaluate `Math.round(1.005 * 100) / 100` from the previous stage.'],
        explanation:
          'The error happens before formatting: the float sum is already slightly below the half-cent. Multiplying by 100 does not recover the lost precision (`1.005 * 100 === 100.49999999999999`). The robust fix is to keep integer cents end-to-end and round the tax once per line with integer inputs.',
        timeLimitSec: 240,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Compute in integer cents',
        prompt:
          'Rewrite `invoiceTotal` to follow the policy exactly: per line, `net = unitCents * qty`, `tax = net * taxBps / 10000` rounded **half-up** to a whole cent, line total = `net + tax`; sum the lines and format as `$D.CC`.',
        editable: ['billing/invoice.js'],
        tests: [
          {
            path: 'tests/invoice.test.js',
            content: `const { invoiceTotal } = require('../billing/invoice');

test('half cent rounds up', () => {
  expect(invoiceTotal([{ unitCents: 190, qty: 1, taxBps: 500 }])).toBe('$2.00');
  expect(invoiceTotal([{ unitCents: 30, qty: 3, taxBps: 500 }])).toBe('$0.95');
});

test('rounding is per line', () => {
  expect(invoiceTotal([
    { unitCents: 70, qty: 1, taxBps: 500 },
    { unitCents: 70, qty: 1, taxBps: 500 },
  ])).toBe('$1.48');
});

test('no tax and larger amounts', () => {
  expect(invoiceTotal([{ unitCents: 1999, qty: 3, taxBps: 0 }])).toBe('$59.97');
  expect(invoiceTotal([{ unitCents: 123456, qty: 2, taxBps: 825 }])).toBe('$2672.82');
});

test('empty invoice', () => {
  expect(invoiceTotal([])).toBe('$0.00');
});
`,
          },
        ],
        solution: {
          'billing/invoice.js': `// line = { unitCents, qty, taxBps }  (taxBps: 500 = 5%)
function lineTotalCents(line) {
  const net = line.unitCents * line.qty;
  const tax = Math.round((net * line.taxBps) / 10000); // exact .5 is representable, rounds up
  return net + tax;
}

function formatCents(cents) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  return \`$\${whole}.\${frac}\`;
}

function invoiceTotal(lines) {
  const cents = lines.reduce((acc, line) => acc + lineTotalCents(line), 0);
  return formatCents(cents);
}

module.exports = { invoiceTotal, formatMoney: (d) => formatCents(Math.round(d * 100)) };
`,
        },
        hints: [
          'Keep everything an integer until the final string.',
          '`net * taxBps` is an integer; dividing by 10000 gives a value whose `.5` case is exactly representable, so `Math.round` is safe for non-negative amounts.',
        ],
        explanation:
          'Integers below 2^53 are exact in JS, so integer-cent arithmetic has no drift. The only division is `net * taxBps / 10000`, and a true half (`k + 0.5`) is exactly representable, so `Math.round` rounds it up as policy demands. Formatting from cents with integer division avoids `toFixed` entirely.',
        timeLimitSec: 480,
        focusFile: 'billing/invoice.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 16. Python banker's rounding
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-loyalty-bankers-rounding',
    title: 'Loyalty Points and Banker\'s Rounding',
    level: 2,
    rating: 1300,
    lang: 'python',
    domain: 'pricing',
    companies: ['amazon', 'apple', 'goldman'],
    tags: ['rounding', 'bankers-rounding', 'decimal', 'floating-point'],
    summary: 'Customers spending $25 get 2 points instead of 3. Python\'s `round` is not what you learned in school.',
    context: 'Policy: 1 loyalty point per $10 spent, halves round **up** ($25 → 3 points). Support tickets say some customers are short-changed.',
    files: [
      {
        path: 'loyalty/points.py',
        content: `def points_for(spend_cents):
    """1 point per $10 spent. Policy: halves round UP ($25.00 -> 3 points)."""
    return round(spend_cents / 1000)


def display_price(cents):
    return f"\${cents / 100:.2f}"
`,
      },
      {
        path: 'main.py',
        content: `from loyalty.points import points_for

print([points_for(c) for c in (2500, 3500, 1500, 4499)])
print(round(0.5), round(1.5), round(-2.5), round(2.675, 2))
print(f"{0.125:.2f}", f"{0.375:.2f}", f"{2.5:.0f}")
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the points',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: '[2, 4, 2, 4]\n0 2 -2 2.67\n0.12 0.38 2',
        options: [
          '[3, 4, 2, 4]\n1 2 -3 2.68\n0.13 0.38 3',
          '[2, 4, 2, 4]\n0 2 -2 2.67\n0.12 0.38 2',
          '[2, 4, 2, 4]\n0 2 -2 2.68\n0.13 0.38 3',
          '[3, 4, 2, 5]\n1 2 -2 2.67\n0.12 0.38 2',
        ],
        hints: [
          'Python 3 `round` uses round-half-to-even ("banker\'s rounding").',
          '`2.675` cannot be stored exactly; it is slightly *below* 2.675. `0.125` and `0.375` *are* exact.',
          'Format specs like `:.2f` also round half to even on the exact binary value.',
        ],
        explanation:
          '`round` sends exact halves to the nearest **even** integer: 2.5 → 2, 3.5 → 4, 1.5 → 2, 0.5 → 0, -2.5 → -2. `round(2.675, 2)` is 2.67 because the float is really 2.67499999.... `0.125` is exact, so `:.2f` rounds the tie to even → 0.12, while 0.375 → 0.38 (8 is even). `f"{2.5:.0f}"` → 2.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Rounding money correctly',
        prompt: 'You need to round the **decimal** price `2.675` half-up to cents and get `2.68`. Which expression does that reliably?',
        options: [
          '`Decimal("2.675").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`',
          '`Decimal(2.675).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`',
          '`round(2.675, 2)`',
          '`float(f"{2.675:.2f}")`',
        ],
        correct: [0],
        hints: ['What value does `Decimal(2.675)` (from a float) hold?'],
        explanation:
          'Constructing a `Decimal` from a **string** keeps the exact decimal 2.675, so ROUND_HALF_UP gives 2.68. `Decimal(2.675)` captures the float\'s exact binary value 2.67499999999999982236431605997495353221893310546875, which rounds to 2.67. `round` and format specs work on that same float and also give 2.67.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Honour the policy',
        prompt: 'Fix `points_for` so halves round **up** (spend is a non-negative integer number of cents). Avoid floats.',
        editable: ['loyalty/points.py'],
        tests: [
          {
            path: 'tests/test_points.py',
            content: `from loyalty.points import points_for


def test_halves_round_up():
    assert points_for(2500) == 3
    assert points_for(3500) == 4
    assert points_for(500) == 1
    assert points_for(1500) == 2


def test_other_values():
    assert points_for(0) == 0
    assert points_for(499) == 0
    assert points_for(4499) == 4
    assert points_for(10000) == 10


def test_huge_exact():
    assert points_for(10**20 + 500) == 10**17 + 1
`,
          },
        ],
        solution: {
          'loyalty/points.py': `def points_for(spend_cents):
    """1 point per $10 spent. Policy: halves round UP ($25.00 -> 3 points)."""
    return (spend_cents + 500) // 1000


def display_price(cents):
    return f"\${cents / 100:.2f}"
`,
        },
        hints: ['Adding half the divisor before floor division rounds half up for non-negative integers.'],
        explanation:
          '`(n + 500) // 1000` is pure integer arithmetic: exact for any size and rounds .5 up. The float version also breaks for huge values (`(10**20 + 500) / 1000` loses the 500 entirely).',
        timeLimitSec: 300,
        focusFile: 'loyalty/points.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 17. Binary search off-by-one
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-ts-slot-binary-search',
    title: 'Next Available Slot Is in the Past',
    level: 2,
    rating: 1400,
    lang: 'typescript',
    domain: 'booking',
    companies: ['google', 'uber', 'citadel'],
    tags: ['binary-search', 'off-by-one', 'lower-bound'],
    summary: 'A lower-bound binary search returns a slot earlier than the requested time.',
    context: 'Slot starts are sorted `HHMM` integers. `nextAvailable(starts, t)` must return the first start `>= t`, or `null` if there is none. A customer asking for 11:00 was offered 10:30.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'src/slots.ts',
        content: `// Index of the first element >= t (starts is sorted ascending).
export function firstAtOrAfter(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function nextAvailable(starts: number[], t: number): number | null {
  const i = firstAtOrAfter(starts, t);
  return i < starts.length ? starts[i] : null;
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { firstAtOrAfter, nextAvailable } from './slots';

const starts = [900, 930, 1000, 1030];
console.log(nextAvailable(starts, 1015), nextAvailable(starts, 1100));
console.log(nextAvailable(starts, 900), nextAvailable([], 900));
console.log(firstAtOrAfter(starts, 2000), firstAtOrAfter(starts, 0));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the slots',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: '1030 1030\n900 null\n3 0',
        options: ['1030 null\n900 null\n4 0', '1030 1030\n900 null\n3 0', '1030 1030\n900 undefined\n3 0', '1000 1030\n900 null\n3 0'],
        hints: ['What is the largest value `lo` can ever reach, given `hi` starts at `length - 1`?', 'For the empty array, `hi` is -1 and the loop does not run.'],
        explanation:
          'Because `hi` starts at `length - 1`, the search can never return `length` ("not found"). When `t` is larger than every element it returns the last index, so `nextAvailable(starts, 1100)` offers 1030, a slot **before** the requested time. The empty array happens to work: `lo = 0` is not `< 0`, so `null`.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the off-by-one',
        prompt: 'Click the line with the off-by-one and choose the explanation.',
        file: 'src/slots.ts',
        lines: [4],
        options: [
          'The search space must be the half-open range `[0, length)` so that `length` can be returned for "every element is < t"',
          '`mid` must be rounded up with `Math.ceil` or the loop never terminates',
          '`starts[mid] < t` should be `starts[mid] <= t`',
          '`return lo` should be `return lo - 1`',
        ],
        correct: 0,
        hints: ['A lower bound has `length + 1` possible answers: 0..length.'],
        explanation:
          'With `hi = length` and `while (lo < hi)`, the answer space is `0..length` inclusive, and `length` means "no element >= t". `Math.floor` is correct here because `lo = mid + 1` always makes progress. `<=` would turn this into an upper bound (first element > t).',
        timeLimitSec: 180,
        focusFile: 'src/slots.ts',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Tunnel-vision fix',
        prompt: 'The assistant only looked at the loop. Accept its fix?',
        persona: 'tunnel-vision',
        request: 'firstAtOrAfter never returns starts.length. Fix it.',
        aiReply: `The loop stops one step early. Make it inclusive:

\`\`\`ts
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
\`\`\`

Now \`lo\` can move past the last index and reach \`starts.length\`.`,
        options: [
          'Accept: the inclusive loop lets `lo` reach `length`',
          'Reject: when `lo === hi` and `starts[mid] >= t`, `hi = mid` does not shrink the range, so the loop never terminates',
          'Reject: `Math.floor` must become `Math.ceil` with the inclusive loop, then it is correct',
          'Reject: it is correct but slower by one iteration',
        ],
        correct: 1,
        hints: ['Try `firstAtOrAfter([900, 930], 900)` by hand.'],
        explanation:
          '`lo <= hi` pairs with `hi = mid - 1`; `lo < hi` pairs with `hi = mid`. Mixing them loops forever once `lo === hi` and the element is `>= t` (e.g. searching for 900). The correct fix is `hi = starts.length` with the original loop.',
        timeLimitSec: 240,
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix the lower bound',
        prompt: 'Fix `firstAtOrAfter` so it returns `starts.length` when every element is `< t`. Keep it O(log n).',
        editable: ['src/slots.ts'],
        tests: [
          {
            path: 'tests/slots.test.ts',
            content: `import { firstAtOrAfter, nextAvailable } from '../src/slots';

const starts = [900, 930, 1000, 1030];

test('lower bound positions', () => {
  expect(firstAtOrAfter(starts, 0)).toBe(0);
  expect(firstAtOrAfter(starts, 900)).toBe(0);
  expect(firstAtOrAfter(starts, 901)).toBe(1);
  expect(firstAtOrAfter(starts, 1030)).toBe(3);
  expect(firstAtOrAfter(starts, 1031)).toBe(4);
  expect(firstAtOrAfter([], 5)).toBe(0);
});

test('duplicates return the first', () => {
  expect(firstAtOrAfter([1, 2, 2, 2, 3], 2)).toBe(1);
});

test('nextAvailable', () => {
  expect(nextAvailable(starts, 1015)).toBe(1030);
  expect(nextAvailable(starts, 1100)).toBeNull();
  expect(nextAvailable([], 900)).toBeNull();
});
`,
          },
        ],
        solution: {
          'src/slots.ts': `// Index of the first element >= t (starts is sorted ascending).
export function firstAtOrAfter(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function nextAvailable(starts: number[], t: number): number | null {
  const i = firstAtOrAfter(starts, t);
  return i < starts.length ? starts[i] : null;
}
`,
        },
        hints: ['One character set: the initial value of `hi`.'],
        explanation: 'Half-open bounds `[lo, hi)` with `hi = length` is the canonical lower bound (same as C++ `std::lower_bound` and Python `bisect_left`).',
        timeLimitSec: 300,
        focusFile: 'src/slots.ts',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 18. Sliding-window rate limiter boundaries
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-sliding-window-limiter',
    title: 'Sliding Window Lets One Extra Through',
    level: 2,
    rating: 1350,
    lang: 'python',
    domain: 'rate-limiter',
    companies: ['stripe', 'meta', 'hrt'],
    tags: ['sliding-window', 'off-by-one', 'deque'],
    summary: 'A per-user sliding window limiter admits limit + 1 requests and keeps stale hits too long.',
    context:
      'Spec: at most `limit` **allowed** requests per user in any window. A hit at time `t` counts against requests at times in `[t, t + window)` and is forgotten from `t + window` on. Denied requests are not recorded.',
    files: [
      {
        path: 'limiter/window.py',
        content: `from collections import deque


class SlidingWindowLimiter:
    def __init__(self, limit, window):
        self.limit = limit
        self.window = window
        self.hits = {}  # user -> deque of allowed timestamps

    def allow(self, user, now):
        q = self.hits.setdefault(user, deque())
        while q and q[0] < now - self.window:
            q.popleft()
        if len(q) > self.limit:
            return False
        q.append(now)
        return True
`,
      },
      {
        path: 'main.py',
        content: `from limiter.window import SlidingWindowLimiter

lim = SlidingWindowLimiter(limit=3, window=10)
print([lim.allow("u1", t) for t in (0, 1, 2, 3, 4)])
print([lim.allow("u1", t) for t in (10, 11, 12)])
print(lim.allow("u2", 4), len(lim.hits["u1"]))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the decisions',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: '[True, True, True, True, False]\n[False, True, True]\nTrue 4',
        options: [
          '[True, True, True, False, False]\n[True, True, True]\nTrue 3',
          '[True, True, True, True, False]\n[False, True, True]\nTrue 4',
          '[True, True, True, True, False]\n[True, True, True]\nTrue 4',
          '[True, True, True, False, False]\n[False, True, True]\nFalse 3',
        ],
        hints: ['At t=3 the deque holds 3 hits. Is `3 > 3`?', 'At t=10 the eviction test is `q[0] < 0`. Is the hit at 0 evicted?'],
        explanation:
          '`len(q) > limit` only denies when there are already 4 hits, so 4 requests pass at t=0..3 and t=4 is denied. At t=10, the hit at 0 should be forgotten, but `0 < 10 - 10` is false, so it stays: 4 hits → denied. At t=11 the 0 is evicted (3 left, allowed → 4). At t=12 the 1 is evicted, 3 left, allowed → deque `[2, 3, 11, 12]`, length 4. u2 has its own deque.',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the capacity bug',
        prompt: 'Click the line that admits `limit + 1` requests and choose the explanation.',
        file: 'limiter/window.py',
        lines: [14],
        options: [
          'The check must deny when the window already holds `limit` hits (`>=`), because the current request would be the `limit + 1`-th',
          '`popleft` removes the newest hit instead of the oldest',
          '`setdefault` creates a new deque on every call, so history is lost',
          'Denied requests should also be appended',
        ],
        correct: 0,
        hints: ['Count how many hits are in the deque *before* the current request is appended.'],
        explanation:
          'The deque holds hits *before* the current one. If it already has `limit` entries, admitting the current one makes `limit + 1`. The eviction on line 12 has a matching boundary bug: with a window of `[t, t + window)`, a hit is stale when `q[0] <= now - window`.',
        timeLimitSec: 180,
        focusFile: 'limiter/window.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix both boundaries',
        prompt: 'Make `allow` match the spec in the briefing exactly (capacity **and** the eviction boundary).',
        editable: ['limiter/window.py'],
        tests: [
          {
            path: 'tests/test_window.py',
            content: `from limiter.window import SlidingWindowLimiter


def test_capacity():
    lim = SlidingWindowLimiter(limit=3, window=10)
    assert [lim.allow("u", t) for t in (0, 1, 2, 3, 4)] == [True, True, True, False, False]


def test_hit_forgotten_exactly_at_window():
    lim = SlidingWindowLimiter(limit=3, window=10)
    for t in (0, 1, 2):
        assert lim.allow("u", t)
    assert lim.allow("u", 9) is False
    assert lim.allow("u", 10) is True
    assert lim.allow("u", 11) is True
    assert lim.allow("u", 11) is False


def test_users_independent():
    lim = SlidingWindowLimiter(limit=1, window=5)
    assert lim.allow("a", 0)
    assert lim.allow("b", 0)
    assert not lim.allow("a", 4)
    assert lim.allow("a", 5)
`,
          },
        ],
        solution: {
          'limiter/window.py': `from collections import deque


class SlidingWindowLimiter:
    def __init__(self, limit, window):
        self.limit = limit
        self.window = window
        self.hits = {}  # user -> deque of allowed timestamps

    def allow(self, user, now):
        q = self.hits.setdefault(user, deque())
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True
`,
        },
        hints: ['Two comparison operators change.', 'A hit at 0 with window 10 must no longer count at now = 10.'],
        explanation:
          'Capacity: deny when `len(q) >= limit`. Expiry: a hit at `t` covers `[t, t + window)`, so at `now` it is stale iff `t + window <= now`, i.e. `t <= now - window`. Off-by-one bugs on both edges are the most common sliding-window mistakes, so write the interval down before writing the comparison.',
        timeLimitSec: 360,
        focusFile: 'limiter/window.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 19. Two-pointer interval intersection
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-calendar-two-pointer',
    title: 'Common Free Time (Two Pointers)',
    level: 2,
    rating: 1250,
    lang: 'javascript',
    domain: 'scheduler',
    companies: ['google', 'meta', 'atlassian'],
    tags: ['two-pointers', 'intervals', 'tracing'],
    summary: 'Intersect two sorted free-time lists with two pointers, then add a "first slot of N hours" feature.',
    context: 'The meeting scheduler intersects two people\'s free intervals (sorted, non-overlapping, half-open `[start, end)` in hours).',
    files: [
      {
        path: 'calendar/common.js',
        content: `// a, b: sorted, non-overlapping [start, end) intervals.
function commonFree(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (start < end) out.push([start, end]);
    // advance whichever interval finishes first
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

module.exports = { commonFree };
`,
      },
      {
        path: 'main.js',
        content: `const { commonFree } = require('./calendar/common');

const alice = [[9, 11], [13, 15], [16, 18]];
const bob = [[8, 10], [10, 14], [17, 20]];
const slots = commonFree(alice, bob);
console.log(slots.map(([s, e]) => \`\${s}-\${e}\`).join(' '));
console.log(commonFree([[9, 12]], [[9, 12]]).length, commonFree([], bob).length);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the slots',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: '9-10 10-11 13-14 17-18\n1 0',
        options: ['9-11 13-14 17-18\n1 0', '9-10 10-11 13-14 17-18\n1 0', '9-10 10-11 13-14 16-18\n1 0', '9-10 10-11 13-14 17-18\n2 0'],
        hints: ['The function does not merge adjacent results.', 'Walk the (i, j) pairs: (0,0), (0,1), (1,1), (1,2), (2,2).'],
        explanation:
          'Each step intersects the current pair and advances the pointer whose interval ends first. `[9,10)` and `[10,11)` come from different Bob intervals and are not merged. `[13,15)∩[17,20)` is empty and skipped. Identical intervals give one slot; then `j` advances (ends are equal, so the `else` branch) and the loop stops.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace the pointers',
        prompt: 'Order the steps `commonFree(alice, bob)` performs.',
        items: [
          'A[9,11] vs B[8,10]: push 9-10, advance j',
          'A[9,11] vs B[10,14]: push 10-11, advance i',
          'A[13,15] vs B[10,14]: push 13-14, advance j',
          'A[13,15] vs B[17,20]: empty, advance i',
          'A[16,18] vs B[17,20]: push 17-18, advance i',
          'i reaches alice.length: loop ends',
        ],
        hints: ['Always advance the interval with the smaller end.'],
        explanation:
          'The pointer with the earlier end can never overlap anything later in the other list, so it is safe to discard. Every step advances exactly one pointer, giving O(|a| + |b|).',
        timeLimitSec: 240,
        focusFile: 'calendar/common.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'feature',
        title: 'First slot of N hours',
        prompt:
          'Add and export `firstCommonSlot(a, b, hours)` returning `[start, start + hours]` for the earliest common free interval at least `hours` long, or `null`. Adjacent common intervals (like `9-10` and `10-11`) are **contiguous free time** and must be treated as one block.',
        editable: ['calendar/common.js'],
        tests: [
          {
            path: 'tests/common.test.js',
            content: `const { commonFree, firstCommonSlot } = require('../calendar/common');

const alice = [[9, 11], [13, 15], [16, 18]];
const bob = [[8, 10], [10, 14], [17, 20]];

test('commonFree unchanged', () => {
  expect(commonFree(alice, bob)).toEqual([[9, 10], [10, 11], [13, 14], [17, 18]]);
});

test('adjacent intervals merge into one block', () => {
  expect(firstCommonSlot(alice, bob, 2)).toEqual([9, 11]);
});

test('short slot', () => {
  expect(firstCommonSlot(alice, bob, 1)).toEqual([9, 10]);
});

test('none long enough', () => {
  expect(firstCommonSlot(alice, bob, 3)).toBeNull();
  expect(firstCommonSlot([], bob, 1)).toBeNull();
});

test('later block', () => {
  expect(firstCommonSlot([[8, 9], [12, 18]], [[8, 9], [13, 20]], 4)).toEqual([13, 17]);
});
`,
          },
        ],
        solution: {
          'calendar/common.js': `// a, b: sorted, non-overlapping [start, end) intervals.
function commonFree(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (start < end) out.push([start, end]);
    // advance whichever interval finishes first
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

function firstCommonSlot(a, b, hours) {
  const merged = [];
  for (const [s, e] of commonFree(a, b)) {
    const last = merged[merged.length - 1];
    if (last && last[1] === s) last[1] = e;
    else merged.push([s, e]);
  }
  for (const [s, e] of merged) {
    if (e - s >= hours) return [s, s + hours];
  }
  return null;
}

module.exports = { commonFree, firstCommonSlot };
`,
        },
        hints: ['Reuse `commonFree`, then merge results where `prev.end === next.start`.', 'Results are already sorted, so one pass is enough.'],
        explanation:
          'Composing with the existing two-pointer function keeps the logic O(n): intersect, merge touching intervals, then scan for the first block that is long enough. Do not mutate the arrays returned by the caller\'s inputs; here the merged list is built from fresh pairs.',
        timeLimitSec: 600,
        focusFile: 'calendar/common.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 20. LRU cache with Map ordering
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-ts-lru-map-order',
    title: 'The LRU That Is Really a FIFO',
    level: 2,
    rating: 1450,
    lang: 'typescript',
    domain: 'cache',
    companies: ['amazon', 'google', 'apple'],
    tags: ['lru-cache', 'map-ordering', 'data-structures'],
    summary: 'A Map-based LRU cache evicts hot keys because reads never refresh recency.',
    context: 'The product-page cache keeps evicting the homepage, which is read thousands of times a minute. It is built on `Map` insertion order.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'src/lru.ts',
        content: `export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  keys(): K[] {
    return [...this.map.keys()];
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { LruCache } from './lru';

const c = new LruCache<string, number>(3);
c.set('a', 1);
c.set('b', 2);
c.set('c', 3);
c.get('a');
c.set('b', 20);
c.set('d', 4);
console.log(c.keys().join(','));
console.log(c.get('a'), c.get('b'));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Which key was evicted?',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: 'b,c,d\nundefined 20',
        options: ['a,b,d\n1 20', 'b,c,d\nundefined 20', 'c,b,d\nundefined 20', 'a,c,d\n1 undefined', 'b,c,d\nundefined 2'],
        hints: ['`Map` iterates in insertion order. Does `get` change the order?', 'Does `map.set` on an existing key move it to the end?'],
        explanation:
          'A `Map` keeps keys in first-insertion order. `get` does not touch the order, and `set` on an existing key only replaces the value, keeping its original position. So the order stays `a, b, c`, and inserting `d` evicts `a`, the most recently *read* key. A real LRU would have evicted `c`.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'A convenient API',
        prompt: 'The assistant proposes this fix. Accept?',
        persona: 'api-dreamer',
        request: 'Make get() and set() refresh recency in LruCache.',
        aiReply: `Easy, \`Map\` has a built-in for this:

\`\`\`ts
get(key: K): V | undefined {
  if (!this.map.has(key)) return undefined;
  this.map.moveToEnd(key);
  return this.map.get(key);
}

set(key: K, value: V): void {
  this.map.set(key, value);
  this.map.moveToEnd(key);
  if (this.map.size > this.capacity) {
    this.map.delete(this.map.keys().next().value as K);
  }
}
\`\`\``,
        options: [
          'Accept: `moveToEnd` reorders the key in O(1)',
          'Reject: JavaScript `Map` has no `moveToEnd` (that is Python\'s `OrderedDict.move_to_end`); you must `delete` then `set` to move a key to the end',
          'Reject: `moveToEnd` exists but is O(n)',
          'Reject: `get` must not change the order in an LRU cache',
        ],
        correct: 1,
        hints: ['Check the `Map` API: `get`, `set`, `has`, `delete`, `clear`, `keys`, `values`, `entries`, `forEach`, `size`.'],
        explanation:
          '`moveToEnd` does not exist on `Map`, so TypeScript rejects it and plain JS would throw at runtime. The idiom is `const v = map.get(k); map.delete(k); map.set(k, v);`, which is O(1) and places the key last in iteration order.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make it an LRU',
        prompt: 'Fix `LruCache` so both `get` (on a hit) and `set` mark the key as most recently used. `keys()` must list least-recent first.',
        editable: ['src/lru.ts'],
        tests: [
          {
            path: 'tests/lru.test.ts',
            content: `import { LruCache } from '../src/lru';

test('get refreshes recency', () => {
  const c = new LruCache<string, number>(2);
  c.set('a', 1);
  c.set('b', 2);
  expect(c.get('a')).toBe(1);
  c.set('c', 3);
  expect(c.keys()).toEqual(['a', 'c']);
  expect(c.get('b')).toBeUndefined();
});

test('set on existing key refreshes recency', () => {
  const c = new LruCache<string, number>(3);
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.get('a');
  c.set('b', 20);
  c.set('d', 4);
  expect(c.keys()).toEqual(['a', 'b', 'd']);
  expect(c.get('b')).toBe(20);
});

test('miss does not insert', () => {
  const c = new LruCache<string, number>(1);
  expect(c.get('x')).toBeUndefined();
  expect(c.keys()).toEqual([]);
});

test('falsy values are cached', () => {
  const c = new LruCache<string, number>(2);
  c.set('zero', 0);
  c.set('one', 1);
  expect(c.get('zero')).toBe(0);
  c.set('two', 2);
  expect(c.keys()).toEqual(['zero', 'two']);
});
`,
          },
        ],
        solution: {
          'src/lru.ts': `export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  keys(): K[] {
    return [...this.map.keys()];
  }
}
`,
        },
        hints: ['Delete then re-insert moves a key to the end of the Map.', 'Use `has`, not truthiness, to detect a hit: `0` is a valid cached value.'],
        explanation:
          'Delete + set is the O(1) "move to end" for `Map`. Checking `has` (not `if (value)`) keeps falsy values like `0` cacheable and refreshable.',
        timeLimitSec: 360,
        focusFile: 'src/lru.ts',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 21. Debounce with a fake clock
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-debounce-fake-clock',
    title: 'Autocomplete Searches for "r"',
    level: 2,
    rating: 1500,
    lang: 'javascript',
    domain: 'search',
    companies: ['meta', 'canva', 'atlassian'],
    tags: ['debounce', 'closures', 'timers', 'fake-clock'],
    summary: 'A home-made debounce fires with the first keystroke instead of the last.',
    context:
      'Autocomplete should query the server once the user **stops typing** for 300 ms, using the latest text. Server logs show queries for single letters. Timers are driven by a deterministic fake clock (`clock.advance(ms)` runs due timers in time order).',
    files: [
      {
        path: 'ui/clock.js',
        content: `// Deterministic fake clock: timers only run inside advance().
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id -> { at, fn }
  return {
    get now() {
      return now;
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let due = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (due === null || t.at < timers.get(due).at)) due = id;
        }
        if (due === null) break;
        const t = timers.get(due);
        timers.delete(due);
        now = t.at;
        t.fn();
      }
      now = target;
    },
  };
}

module.exports = { createClock };
`,
      },
      {
        path: 'ui/debounce.js',
        content: `// Call fn once the caller has been quiet for \`wait\` ms, with the latest args.
function debounce(fn, wait, clock) {
  let timer = null;
  return function (...args) {
    if (timer === null) {
      timer = clock.setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    }
  };
}

module.exports = { debounce };
`,
      },
      {
        path: 'main.js',
        content: `const { createClock } = require('./ui/clock');
const { debounce } = require('./ui/debounce');

const clock = createClock();
const fired = [];
const search = debounce((q) => fired.push(\`\${clock.now}:\${q}\`), 300, clock);

const keystrokes = [[0, 'r'], [100, 're'], [200, 'rea'], [250, 'reac'], [900, 'react']];
for (const [t, q] of keystrokes) {
  clock.advance(t - clock.now);
  search(q);
}
clock.advance(1000);
console.log(fired.join(' '));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What hits the server?',
        prompt: 'What does `main.js` print? Each entry is `time:query`.',
        entry: 'main.js',
        answer: '300:r 1200:react',
        options: ['550:reac 1200:react', '300:r 1200:react', '300:reac 1200:react', '300:r 600:reac 1200:react', '0:r 900:react'],
        hints: ['While a timer is pending, what do later calls do?', 'Which `args` does the scheduled arrow function close over?'],
        explanation:
          'The first call schedules a timer for t=300 that closes over `args = [\'r\']`. Calls at 100, 200 and 250 see `timer !== null` and do nothing at all. At 300 the timer fires with "r". At 900 a new timer is scheduled for 1200 with "react". This is neither a debounce (it should fire at 550 with "reac") nor a proper throttle (it drops the trailing call\'s data).',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the debounce bug',
        prompt: 'Click the buggy line and choose the root cause.',
        file: 'ui/debounce.js',
        lines: [5],
        options: [
          'Later calls are ignored while a timer is pending; a debounce must cancel the pending timer and schedule a new one with the latest args',
          'The timer should be scheduled with `wait - clock.now`',
          '`timer = null` must happen after `fn(...args)`',
          'Rest parameters copy `args` lazily, so they hold the last value',
        ],
        correct: 0,
        hints: ['"Quiet for 300 ms" means every new call restarts the countdown.'],
        explanation:
          'Debounce = "restart the timer on every call". The guard `if (timer === null)` does the opposite: it keeps the *first* timer and its first arguments. Clear the pending timer unconditionally and reschedule.',
        timeLimitSec: 180,
        focusFile: 'ui/debounce.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix debounce',
        prompt: 'Fix `debounce`: `fn` runs once the caller has been quiet for `wait` ms, with the latest arguments. Use the injected `clock` for timers.',
        editable: ['ui/debounce.js'],
        tests: [
          {
            path: 'tests/debounce.test.js',
            content: `const { createClock } = require('../ui/clock');
const { debounce } = require('../ui/debounce');

function run(keystrokes, wait, tail = 1000) {
  const clock = createClock();
  const fired = [];
  const f = debounce((q) => fired.push(clock.now + ':' + q), wait, clock);
  for (const [t, q] of keystrokes) {
    clock.advance(t - clock.now);
    f(q);
  }
  clock.advance(tail);
  return fired;
}

test('fires once with latest args after quiet period', () => {
  expect(run([[0, 'r'], [100, 're'], [200, 'rea'], [250, 'reac']], 300)).toEqual(['550:reac']);
});

test('separate bursts fire separately', () => {
  expect(run([[0, 'a'], [100, 'ab'], [900, 'abc']], 300)).toEqual(['400:ab', '1200:abc']);
});

test('call exactly at the deadline still fires the previous one', () => {
  expect(run([[0, 'x'], [300, 'y']], 300)).toEqual(['300:x', '600:y']);
});
`,
          },
        ],
        solution: {
          'ui/debounce.js': `// Call fn once the caller has been quiet for \`wait\` ms, with the latest args.
function debounce(fn, wait, clock) {
  let timer = null;
  return function (...args) {
    if (timer !== null) clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

module.exports = { debounce };
`,
        },
        hints: ['`clock.clearTimeout(timer)` then always `clock.setTimeout(...)`.'],
        explanation:
          'Each call cancels the previous pending timer and schedules a new one whose closure captures this call\'s `args`. In the third test, `clock.advance(300)` runs the timer due at 300 *before* the next call happens, so "x" fires: timers due at or before the target time run inside `advance`.',
        timeLimitSec: 360,
        focusFile: 'ui/debounce.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 22. Date range: nights of a stay
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-hotel-nights',
    title: 'Hotel Nights Over a Leap Day',
    level: 2,
    rating: 1300,
    lang: 'python',
    domain: 'booking',
    companies: ['amazon', 'uber', 'generic'],
    tags: ['date-ranges', 'off-by-one', 'datetime'],
    summary: 'A stay is billed for one night too many, at the wrong weekend rate.',
    context:
      'Policy: the check-out date is exclusive (no night is spent there). **Friday and Saturday** nights are billed at the weekend rate. Guests are complaining about their bills.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'booking/nights.py',
        content: `from datetime import date, timedelta


def nights(check_in, check_out):
    """The date each night of the stay starts on. check_out is exclusive."""
    count = (check_out - check_in).days + 1
    return [check_in + timedelta(days=i) for i in range(count)]


def stay_price(check_in, check_out, weekday_rate, weekend_rate):
    total = 0
    for night in nights(check_in, check_out):
        is_weekend = night.weekday() >= 5
        total += weekend_rate if is_weekend else weekday_rate
    return total
`,
      },
      {
        path: 'main.py',
        content: `from datetime import date
from booking.nights import nights, stay_price

stay = nights(date(2024, 2, 28), date(2024, 3, 2))
print(len(stay), stay[1].isoformat(), stay[-1].strftime("%a %d %b"))
print(stay_price(date(2024, 2, 28), date(2024, 3, 2), 100, 150))
print(len(nights(date(2024, 5, 1), date(2024, 5, 1))))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the bill',
        prompt: 'What does `main.py` print? (28 Feb 2024 is a **Wednesday**.)',
        entry: 'main.py',
        answer: '4 2024-02-29 Sat 02 Mar\n450\n1',
        options: [
          '3 2024-02-29 Fri 01 Mar\n350\n0',
          '4 2024-03-01 Sat 02 Mar\n450\n1',
          '4 2024-02-29 Sat 02 Mar\n450\n1',
          '4 2024-02-29 Sat 02 Mar\n500\n1',
        ],
        hints: ['2024 is a leap year.', '`weekday()` is 0 for Monday … 4 Friday, 5 Saturday, 6 Sunday.', 'How many nights does a same-day "stay" have?'],
        explanation:
          '`+ 1` treats check-out as a night: Wed 28, Thu 29 (leap day), Fri 1, Sat 2 → 4 nights. `weekday() >= 5` marks Saturday and Sunday, so only the Sat 2 Mar night is "weekend": 100+100+100+150 = 450. The correct bill is 3 nights (Wed, Thu, Fri) with Friday at the weekend rate: 350. A zero-length stay yields 1 night.',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the off-by-one',
        prompt: 'Click the line that bills the check-out date and choose the cause.',
        file: 'booking/nights.py',
        lines: [6],
        options: [
          '`+ 1` makes the range inclusive of the check-out date, but check-out is exclusive',
          '`timedelta(days=i)` ignores leap days',
          'Subtracting two `date`s gives seconds, not days',
          '`range(count)` should start at 1',
        ],
        correct: 0,
        hints: ['A check-in Monday, check-out Tuesday stay is one night.'],
        explanation:
          '`check_out - check_in` already equals the number of nights for a half-open range. `date` arithmetic handles leap years correctly, and `.days` is a day count.',
        timeLimitSec: 150,
        focusFile: 'booking/nights.py',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Senior\'s patch',
        prompt: 'A senior engineer\'s assistant proposes this patch. Accept?',
        persona: 'helpful-senior',
        request: 'Fix nights() and the weekend rule (Fri + Sat nights are weekend).',
        aiReply: `Two fixes: the range is half-open, and weekend *nights* start on Friday and Saturday.

\`\`\`python
def nights(check_in, check_out):
    """The date each night of the stay starts on. check_out is exclusive."""
    count = (check_out - check_in).days
    return [check_in + timedelta(days=i) for i in range(count)]


def stay_price(check_in, check_out, weekday_rate, weekend_rate):
    total = 0
    for night in nights(check_in, check_out):
        is_weekend = night.weekday() in (4, 5)  # Fri, Sat
        total += weekend_rate if is_weekend else weekday_rate
    return total
\`\`\`

If \`check_out <= check_in\`, \`range\` of a non-positive number is empty, so invalid stays cost 0 rather than crashing; validate that at the API layer.`,
        options: [
          'Accept: both fixes are correct',
          'Reject: `weekday()` returns 1-7, so Friday is 5',
          'Reject: `range` of a negative number raises `ValueError`',
          'Reject: it must also add `timedelta(days=1)` to `check_out` to cover leap years',
        ],
        correct: 0,
        hints: ['Check the `weekday()` vs `isoweekday()` numbering.'],
        explanation:
          'The patch is right. `weekday()` is Monday=0 … Sunday=6, so Friday and Saturday are 4 and 5 (`isoweekday()` is the 1-7 one). `range(-2)` is simply empty. Date subtraction already accounts for leap days.',
        timeLimitSec: 180,
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Bill the stay correctly',
        prompt: 'Fix `nights` and `stay_price` to match the policy in the briefing.',
        editable: ['booking/nights.py'],
        tests: [
          {
            path: 'tests/test_nights.py',
            content: `from datetime import date
from booking.nights import nights, stay_price


def test_nights_exclusive_checkout():
    assert nights(date(2024, 2, 28), date(2024, 3, 2)) == [date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1)]
    assert nights(date(2024, 5, 1), date(2024, 5, 1)) == []


def test_weekend_is_fri_sat():
    # Fri 2024-03-01 .. Mon 2024-03-04: Fri, Sat, Sun nights
    assert stay_price(date(2024, 3, 1), date(2024, 3, 4), 100, 150) == 400


def test_leap_stay_price():
    assert stay_price(date(2024, 2, 28), date(2024, 3, 2), 100, 150) == 350


def test_year_boundary():
    assert len(nights(date(2023, 12, 30), date(2024, 1, 2))) == 3
`,
          },
        ],
        solution: {
          'booking/nights.py': `from datetime import date, timedelta


def nights(check_in, check_out):
    """The date each night of the stay starts on. check_out is exclusive."""
    count = (check_out - check_in).days
    return [check_in + timedelta(days=i) for i in range(count)]


def stay_price(check_in, check_out, weekday_rate, weekend_rate):
    total = 0
    for night in nights(check_in, check_out):
        is_weekend = night.weekday() in (4, 5)  # Friday and Saturday nights
        total += weekend_rate if is_weekend else weekday_rate
    return total
`,
        },
        hints: ['Drop the `+ 1`.', 'Friday is `weekday() == 4`.'],
        explanation: 'Half-open date ranges make the night count a plain subtraction. A "weekend night" is identified by the date the night *starts*, i.e. Friday and Saturday.',
        timeLimitSec: 300,
        focusFile: 'booking/nights.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 23. try / except / else / finally ordering
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-capture-exception-flow',
    title: 'Payment Capture: Who Runs When?',
    level: 2,
    rating: 1500,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'jpmorgan', 'optiver'],
    tags: ['exceptions', 'try-finally', 'control-flow'],
    summary: 'Trace try / except / else / finally through three payment outcomes.',
    context: 'The capture path holds a lock that must always be released. You need to know exactly what the audit log contains for each outcome.',
    files: [
      {
        path: 'payments/capture.py',
        content: `class DeclinedError(Exception):
    pass


log = []


def charge(amount):
    log.append(f"charge {amount}")
    if amount > 100:
        raise DeclinedError("limit")
    if amount == 0:
        raise ValueError("zero")
    return f"ch_{amount}"


def capture(amount):
    try:
        log.append("begin")
        ref = charge(amount)
    except DeclinedError as e:
        log.append(f"declined {e}")
        return "declined"
    else:
        log.append("commit")
        return ref
    finally:
        log.append("release")
`,
      },
      {
        path: 'main.py',
        content: `from payments.capture import capture, log

for amount in (50, 500, 0):
    log.clear()
    try:
        result = capture(amount)
    except ValueError as e:
        result = f"error {e}"
    print(result, "|", ", ".join(log))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Three outcomes',
        prompt: 'What does `main.py` print? Type the three lines exactly.',
        entry: 'main.py',
        answer:
          'ch_50 | begin, charge 50, commit, release\ndeclined | begin, charge 500, declined limit, release\nerror zero | begin, charge 0, release',
        hints: [
          '`else` runs only if the `try` body raised nothing.',
          '`finally` runs on every exit: normal, `return`, or an exception that is not caught here.',
        ],
        explanation:
          '50: no exception → `else` logs "commit" and starts returning; `finally` runs before the function actually returns. 500: `DeclinedError` is caught → "declined limit", then `finally`. 0: `ValueError` is not caught by `capture`, so `finally` logs "release" and the exception propagates to `main.py`, which turns it into "error zero".',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace the declined path',
        prompt: 'Order what happens for `capture(500)`.',
        items: [
          'log "begin"',
          'charge() logs "charge 500"',
          'charge() raises DeclinedError',
          'except block logs "declined limit"',
          'return "declined" is evaluated',
          'finally logs "release"',
          'caller receives "declined"',
        ],
        hints: ['The `return` expression is evaluated before `finally`, but the function only returns after it.'],
        explanation:
          'Python evaluates the return value, then runs `finally`, then completes the return. `ref = ...` is never assigned and `else` is skipped because the `try` body raised.',
        timeLimitSec: 240,
        focusFile: 'payments/capture.py',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Return inside finally',
        prompt:
          'A teammate adds `return "released"` as the last line of the `finally` block. Which statements are true? Select all that apply.',
        options: [
          '`capture(0)` now returns "released" and the `ValueError` is silently swallowed',
          '`capture(50)` now returns "released" instead of "ch_50"',
          'The `else` block no longer runs',
          'Python 3.14 emits a `SyntaxWarning` for `return` in `finally` (PEP 765)',
        ],
        correct: [0, 1, 3],
        hints: ['A `return` in `finally` replaces whatever the function was about to do: return a value or raise.'],
        explanation:
          'A `return` in `finally` overrides both a pending return value and a propagating exception, so errors vanish. `else` still runs before `finally`. Because this is such a common footgun, PEP 765 makes Python 3.14 warn about `return`/`break`/`continue` that exit a `finally` block.',
        timeLimitSec: 240,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 24. Generators: break closes, spread exhausts
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-paginator-generator',
    title: 'Paginated API Client',
    level: 2,
    rating: 1550,
    lang: 'javascript',
    domain: 'search',
    companies: ['google', 'atlassian', 'two-sigma'],
    tags: ['generators', 'iterators', 'yield-star', 'finally'],
    summary: 'A generator streams results page by page. What does `break` do to it?',
    context: 'The client lazily walks a cursor-paginated API. You want to know exactly how many HTTP calls a "first 2 results" query makes.',
    files: [
      {
        path: 'api/pager.js',
        content: `// Lazily yield every item across cursor-paginated pages.
function* paginate(fetchPage) {
  let cursor = null;
  try {
    do {
      const { items, next } = fetchPage(cursor);
      yield* items;
      cursor = next;
    } while (cursor);
  } finally {
    console.log('close');
  }
}

module.exports = { paginate };
`,
      },
      {
        path: 'main.js',
        content: `const { paginate } = require('./api/pager');

const PAGES = {
  start: { items: ['a', 'b', 'c'], next: 'p2' },
  p2: { items: ['d', 'e'], next: 'p3' },
  p3: { items: ['f'], next: null },
};
function fetchPage(cursor) {
  console.log('fetch ' + (cursor ?? 'start'));
  return PAGES[cursor ?? 'start'];
}

const it = paginate(fetchPage);
const firstTwo = [];
for (const item of it) {
  firstTwo.push(item);
  if (firstTwo.length === 2) break;
}
console.log(firstTwo.join(','));
console.log([...it].length);
console.log([...paginate(fetchPage)].join(''));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the calls',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'fetch start\nclose\na,b\n0\nfetch start\nfetch p2\nfetch p3\nclose\nabcdef',
        options: [
          'fetch start\na,b\nc\nfetch start\nfetch p2\nfetch p3\nclose\nabcdef',
          'fetch start\nclose\na,b\n0\nfetch start\nfetch p2\nfetch p3\nclose\nabcdef',
          'fetch start\nfetch p2\nfetch p3\nclose\na,b\n0\nfetch start\nfetch p2\nfetch p3\nclose\nabcdef',
          'fetch start\na,b\n4\nfetch p2\nfetch p3\nclose\nfetch start\nfetch p2\nfetch p3\nclose\nabcdef',
        ],
        hints: [
          'Generators are lazy: a page is fetched only when the consumer asks for an item from it.',
          '`break` in a `for...of` calls the iterator\'s `return()` method. What does that do to a suspended generator with a `finally`?',
        ],
        explanation:
          'Only the first page is fetched to get `a` and `b`. `break` calls `it.return()`, which resumes the generator as if a `return` happened at the `yield`, so the `finally` block runs ("close") and the generator is finished. Spreading a finished generator yields nothing (0), even though `c` was never consumed. A fresh generator walks all three pages, then logs "close" when it completes normally.',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a full walk',
        prompt: 'Order the events for `[...paginate(fetchPage)]`.',
        items: [
          'fetchPage(null) logs "fetch start"',
          'yield* hands out a, b, c',
          'cursor = "p2"; do-while condition is truthy',
          'fetchPage("p2") hands out d, e',
          'fetchPage("p3") hands out f',
          'cursor = null; loop exits',
          'finally logs "close"',
          'spread receives { done: true } and builds the array',
        ],
        hints: ['A `do...while` runs its body before checking the condition.'],
        explanation:
          'The generator fetches a page, delegates to the page array with `yield*`, then moves the cursor. When `next` is `null` the loop exits, `finally` runs, and only then does the generator report `done: true` to the spread.',
        timeLimitSec: 240,
        focusFile: 'api/pager.js',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Reusing the iterator',
        prompt: 'You want "first 2 results" and later "the rest" from the **same** paginated walk without refetching. Which approaches work? Select all that apply.',
        options: [
          'Call `it.next()` twice manually instead of `for...of` with `break`, then spread `it` for the rest',
          'Use `for...of` with `break` and then `it.next()` to resume',
          'Wrap the generator in an object whose `[Symbol.iterator]()` returns an iterator without a `return()` method, so `break` does not close the underlying generator',
          'Remove the `finally` block; then `break` no longer closes the generator',
        ],
        correct: [0, 2],
        hints: ['Who calls `return()` on the iterator, and when?'],
        explanation:
          '`for...of` calls `return()` on early exit; a generator\'s `return()` finishes it regardless of whether it has a `finally`. Pulling with `next()` manually never calls `return()`. Alternatively, hand `for...of` a wrapper iterator that forwards `next()` but has no `return()`, so the generator stays suspended.',
        timeLimitSec: 240,
      },
    ],
  },
];

export default problems;
