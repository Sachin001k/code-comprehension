import type { Problem } from '../types';

/**
 * Level 2 "Function Tracer" — slice A (part 1).
 * Recursion, mutation & aliasing, closures, generators, `this`, getters.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 1. Memoised recursion with the wrong cache key
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-payout-splits-memo',
    title: 'Payout Splitter: The Memo That Remembers Too Much',
    level: 2,
    rating: 1450,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'amazon', 'jane-street'],
    tags: ['recursion', 'memoisation', 'dynamic-programming'],
    summary: 'A memoised coin-change counter gives the wrong number of ways. The cache key is the suspect.',
    context:
      'The treasury team counts how many ways an ATM payout can be split into banknotes (order does not matter) to decide which cassettes to stock. Someone added a memo to make it fast. The numbers changed.',
    persona: 'confident-intern',
    files: [
      {
        path: 'payouts/splits.py',
        content: `"""Count the ways a payout can be split into banknotes (order does not matter)."""


def count_splits(amount, denoms):
    notes = tuple(sorted(set(denoms), reverse=True))
    return _count(amount, notes, 0, {})


def _count(amount, notes, i, memo):
    if amount == 0:
        return 1
    if amount < 0 or i == len(notes):
        return 0
    key = amount
    if key in memo:
        return memo[key]
    # either use notes[i] once more, or never use notes[i] again
    ways = _count(amount - notes[i], notes, i, memo) + _count(amount, notes, i + 1, memo)
    memo[key] = ways
    return ways
`,
      },
      {
        path: 'main.py',
        content: `from payouts.splits import count_splits

print(count_splits(4, [1, 2]))
print(count_splits(10, [1, 2, 5]))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What does it print?',
        prompt:
          'The true answers are 3 (`1+1+1+1`, `2+1+1`, `2+2`) and 10. Trace the memoised code carefully: what does `main.py` **actually** print?',
        entry: 'main.py',
        answer: '4\n33',
        options: ['3\n10', '4\n33', '2\n4', '3\n33', '4\n10'],
        hints: [
          'The memo key ignores `i`, the index of the note we are still allowed to use.',
          'For `count_splits(4, [1, 2])` notes are `(2, 1)`. Trace `_count(4, i=0)`: the left branch reaches `_count(0)` and `_count(2, i=0)`... which value gets stored for amount 2 first, and with which `i`?',
        ],
        explanation:
          'Notes are `(2, 1)`. `_count(4,0)` first goes left to `_count(2,0)` = `_count(0,0)` (1) + `_count(2,1)`. `_count(2,1)` may only use 1s and correctly returns 1, storing **memo[1]=1** and **memo[2]=1**. Back in `_count(2,0)` the result is 1 + 1 = 2, which *overwrites* **memo[2]=2** (that 2 counts `2` and `1+1`). Now the right branch `_count(4,1)` (only 1s allowed) calls `_count(3,1)` → `_count(2,1)`, which hits memo[2] and gets **2** even though with only 1s there is just one way. So `_count(4,1)` returns 2 instead of 1 and the total is 2 + 2 = **4**. The same contamination compounds for 10 and gives **33**. The memo key must include *every* parameter that affects the result: here `(amount, i)`.',
        timeLimitSec: 300,
        focusFile: 'payouts/splits.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Locate the root cause',
        prompt: 'Click the line responsible for the wrong counts and pick the root cause.',
        file: 'payouts/splits.py',
        lines: [14],
        options: [
          'The memo key omits `i`, so results computed with different allowed notes collide',
          'The notes must be sorted ascending, not descending',
          '`amount < 0` should be `amount <= 0`',
          'The memo dict should be a module-level global so it survives between calls',
        ],
        correct: 0,
        hints: ['Ask: does `_count(5, notes, 0)` return the same as `_count(5, notes, 2)`?'],
        explanation:
          'The result of `_count` depends on both `amount` and `i` (which notes remain usable). Keying only on `amount` lets "ways to make 5 with {5,2,1}" be reused as "ways to make 5 with {1}". Sorting order is irrelevant to correctness, and a global memo would make things worse (it would also leak between different `denoms`).',
        timeLimitSec: 180,
        focusFile: 'payouts/splits.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the memo',
        prompt:
          'Fix `_count` so `count_splits` returns the correct number of combinations. It must stay memoised: the hidden tests include `count_splits(1000, [1, 2, 5, 10, 20, 50, 100, 200])` with a time limit.',
        editable: ['payouts/splits.py'],
        timeoutMs: 4000,
        tests: [
          {
            path: 'tests/test_splits.py',
            content: `from payouts.splits import count_splits


def test_small():
    assert count_splits(4, [1, 2]) == 3
    assert count_splits(10, [1, 2, 5]) == 10


def test_us_coins():
    assert count_splits(100, [1, 5, 10, 25, 50]) == 292


def test_edge_cases():
    assert count_splits(0, [1, 2]) == 1
    assert count_splits(3, [2]) == 0
    assert count_splits(6, [2, 2, 3]) == 2


def test_large_is_fast():
    assert count_splits(1000, [1, 2, 5, 10, 20, 50, 100, 200]) == 321335886
`,
          },
        ],
        solution: {
          'payouts/splits.py': `"""Count the ways a payout can be split into banknotes (order does not matter)."""


def count_splits(amount, denoms):
    notes = tuple(sorted(set(denoms), reverse=True))
    return _count(amount, notes, 0, {})


def _count(amount, notes, i, memo):
    if amount == 0:
        return 1
    if amount < 0 or i == len(notes):
        return 0
    key = (amount, i)
    if key in memo:
        return memo[key]
    # either use notes[i] once more, or never use notes[i] again
    ways = _count(amount - notes[i], notes, i, memo) + _count(amount, notes, i + 1, memo)
    memo[key] = ways
    return ways
`,
        },
        hints: ['Make the key a tuple of every argument that changes the answer.'],
        explanation:
          'Keying on `(amount, i)` makes every cached value mean exactly one sub-problem. There are at most `amount × len(notes)` states, so the large test is ~8000 calls. (For very large amounts you would switch to the iterative 1-D DP to avoid Python\'s recursion limit.)',
        timeLimitSec: 420,
        focusFile: 'payouts/splits.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 2. Tree walk with a shared, never-popped prefix
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-category-breadcrumbs',
    title: 'Category Breadcrumbs',
    level: 2,
    rating: 1300,
    lang: 'javascript',
    domain: 'search',
    companies: ['amazon', 'canva', 'atlassian'],
    tags: ['recursion', 'tree-walk', 'mutation', 'default-parameters'],
    summary: 'A recursive walk builds breadcrumbs for a product catalog. Later crumbs grow strangely long.',
    context: 'Search shows a breadcrumb trail such as `Home > Electronics > Phones` under each result. QA says some trails are absurdly long.',
    files: [
      {
        path: 'catalog/paths.js',
        content: `// Build a "A > B > C" breadcrumb for every leaf category.
function collectPaths(node, prefix = [], out = []) {
  prefix.push(node.name);
  if (!node.children || node.children.length === 0) {
    out.push(prefix.join(' > '));
  } else {
    for (const child of node.children) {
      collectPaths(child, prefix, out);
    }
  }
  return out;
}

function countLeaves(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((n, c) => n + countLeaves(c), 0);
}

module.exports = { collectPaths, countLeaves };
`,
      },
      {
        path: 'main.js',
        content: `const { collectPaths, countLeaves } = require('./catalog/paths');

const tree = {
  name: 'Home',
  children: [
    { name: 'Electronics', children: [{ name: 'Phones' }, { name: 'Laptops' }] },
    { name: 'Books' },
  ],
};

const paths = collectPaths(tree);
console.log(paths.length, countLeaves(tree));
console.log(paths[1]);
console.log(collectPaths(tree.children[1]).join('|'));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the breadcrumbs',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: '3 3\nHome > Electronics > Phones > Laptops\nBooks',
        options: [
          '3 3\nHome > Electronics > Laptops\nBooks',
          '3 3\nHome > Electronics > Phones > Laptops\nBooks',
          '3 3\nHome > Electronics > Phones > Laptops\nHome > Electronics > Phones > Laptops > Books > Books',
          '5 3\nHome > Electronics > Phones > Laptops\nBooks',
        ],
        hints: [
          'There is one `prefix` array for the whole walk. Is anything ever removed from it?',
          'JavaScript default parameters are evaluated on *every* call that omits them (unlike Python).',
        ],
        explanation:
          'The same `prefix` array is passed down the whole recursion and only ever grows: after "Phones" is pushed it is never popped, so the second leaf becomes `Home > Electronics > Phones > Laptops`. `out` only gets one entry per leaf, so the length is still 3. The last call omits `prefix` and `out`, and JS evaluates `= []` afresh on each call, so it starts clean and prints just `Books`. (In Python, a `prefix=[]` default would have been shared across calls.)',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Where should the crumb come off?',
        prompt: 'Click the line where the fix belongs (the one that leaves the shared state dirty) and choose the root cause.',
        file: 'catalog/paths.js',
        lines: [3, 11],
        options: [
          '`prefix` is mutated with `push` but never restored with `pop` after visiting the node, so siblings inherit their predecessors\' names',
          'Default parameters `prefix = []` are shared between calls, as in Python',
          '`out.push` should push a copy of `prefix`, not a string',
          'The `for...of` loop must iterate in reverse',
        ],
        correct: 0,
        hints: ['Backtracking = do, recurse, undo.'],
        explanation:
          'This is a backtracking walk that forgot the "undo" step. Either `prefix.pop()` before returning (line 11), or avoid mutation entirely: `const path = [...prefix, node.name]` and pass `path` down (line 3). JS defaults are *not* shared between calls.',
        timeLimitSec: 180,
        focusFile: 'catalog/paths.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix collectPaths',
        prompt:
          'Fix `collectPaths` so every leaf gets its own correct trail. Callers may pass their own `prefix` (e.g. `[\'Store\']`) and it must **not** be modified by the call.',
        editable: ['catalog/paths.js'],
        tests: [
          {
            path: 'tests/paths.test.js',
            content: `const { collectPaths } = require('../catalog/paths');

const tree = {
  name: 'Home',
  children: [
    { name: 'Electronics', children: [{ name: 'Phones' }, { name: 'Laptops', children: [] }] },
    { name: 'Books', children: [{ name: 'Fiction' }] },
    { name: 'Garden' },
  ],
};

test('each leaf has its own trail', () => {
  expect(collectPaths(tree)).toEqual([
    'Home > Electronics > Phones',
    'Home > Electronics > Laptops',
    'Home > Books > Fiction',
    'Home > Garden',
  ]);
});

test('single node', () => {
  expect(collectPaths({ name: 'Solo' })).toEqual(['Solo']);
});

test('caller prefix is not modified', () => {
  const prefix = ['Store'];
  const out = collectPaths(tree.children[1], prefix);
  expect(out).toEqual(['Store > Books > Fiction']);
  expect(prefix).toEqual(['Store']);
});
`,
          },
        ],
        solution: {
          'catalog/paths.js': `// Build a "A > B > C" breadcrumb for every leaf category.
function collectPaths(node, prefix = [], out = []) {
  const path = [...prefix, node.name];
  if (!node.children || node.children.length === 0) {
    out.push(path.join(' > '));
  } else {
    for (const child of node.children) {
      collectPaths(child, path, out);
    }
  }
  return out;
}

function countLeaves(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((n, c) => n + countLeaves(c), 0);
}

module.exports = { collectPaths, countLeaves };
`,
        },
        hints: ['A `push`/`pop` pair still mutates a caller-supplied array during the call; copying is simpler and safer.'],
        explanation:
          'Building a new `path` array per node (`[...prefix, node.name]`) makes each recursion level own its trail, so siblings cannot contaminate each other and the caller\'s array is never touched. Push/pop also works for the trails, but you must make sure the pop runs on every path out of the function.',
        timeLimitSec: 420,
        focusFile: 'catalog/paths.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 3. Recursive descent parser with right-associative subtraction
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-ts-pricing-formula-parser',
    title: 'Pricing Formula Parser',
    level: 2,
    rating: 1550,
    lang: 'typescript',
    domain: 'pricing',
    companies: ['canva', 'atlassian', 'google'],
    tags: ['recursion', 'parser', 'recursive-descent', 'associativity'],
    summary: 'A hand-written recursive descent parser evaluates pricing formulas. Some invoices are off.',
    context:
      'Merchants define prices with formulas like `base - fee - tax`. Finance reports that a few formulas evaluate to more than they should. You own `formula.ts`.',
    files: [
      {
        path: 'src/formula.ts',
        content: `// Tiny recursive-descent parser for pricing formulas like "base * 2 - discount".
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := NUMBER | IDENT | '(' expr ')'

export type Vars = Record<string, number>;

export function evaluate(src: string, vars: Vars = {}): number {
  const tokens = src.match(/\\d+(?:\\.\\d+)?|[A-Za-z_]\\w*|[-+*/()]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr(): number {
    const left = term();
    const op = peek();
    if (op === '+' || op === '-') {
      next();
      const right = expr();
      return op === '+' ? left + right : left - right;
    }
    return left;
  }

  function term(): number {
    let value = factor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = factor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function factor(): number {
    const tok = next();
    if (tok === '(') {
      const v = expr();
      next(); // ')'
      return v;
    }
    if (/^\\d/.test(tok)) return Number(tok);
    if (tok in vars) return vars[tok];
    throw new Error(\`unknown token \${tok}\`);
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error(\`unexpected \${peek()}\`);
  return result;
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { evaluate } from './formula';

console.log(evaluate('2 + 3 * 4'));
console.log(evaluate('100 - 20 - 5'));
console.log(evaluate('(100 - 20) - 5'));
console.log(evaluate('base - fee + tip', { base: 50, fee: 10, tip: 5 }));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Evaluate four formulas',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: '14\n85\n75\n35',
        options: ['14\n75\n75\n45', '20\n75\n75\n45', '14\n85\n75\n35', '14\n85\n85\n35', '14\n75\n75\n35'],
        hints: [
          'Compare the grammar comment for `expr` with what `expr()` actually does after it sees `-`.',
          '`expr()` calls `expr()` for the right-hand side, so `a - b - c` becomes `a - (b - c)`.',
        ],
        explanation:
          '`term` handles precedence correctly (`2 + 3*4 = 14`). But `expr` recurses on the right: `100 - 20 - 5` parses as `100 - (20 - 5) = 85`. Parentheses force the left grouping, giving 75. `base - fee + tip` becomes `50 - (10 + 5) = 35` instead of 45. Right recursion makes the operator right-associative, which is wrong for `-` (and `/`).',
        timeLimitSec: 300,
        focusFile: 'src/formula.ts',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace the parser',
        prompt: 'Order the steps the parser takes for `evaluate(\'2 * (3 + 4)\')`.',
        items: [
          'outer expr() calls term()',
          'factor() consumes 2',
          'term() sees * and calls factor()',
          'factor() consumes ( and calls expr()',
          'inner term() / factor() consume 3',
          'inner expr() sees + and recurses into expr() for 4',
          'factor() consumes )',
          'term() multiplies 2 * 7 and outer expr() returns 14',
        ],
        hints: ['Every expr starts with a term, every term starts with a factor.', 'The parenthesis is handled inside `factor`, which re-enters `expr`.'],
        explanation:
          'Recursive descent mirrors the grammar: `expr → term → factor`. The `(` makes `factor` re-enter `expr`, whose `+` branch recurses once more for `4`. When the inner `expr` returns 7, `factor` eats `)`, `term` multiplies, and the outer `expr` finds no `+`/`-` and returns 14.',
        timeLimitSec: 300,
        focusFile: 'src/formula.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Find the associativity bug',
        prompt: 'Click the line that makes `-` right-associative and choose the explanation.',
        file: 'src/formula.ts',
        lines: [20],
        options: [
          'The right operand is parsed with `expr()` (right recursion) instead of `term()` inside a loop, so `a - b - c` groups as `a - (b - c)`',
          '`term()` should be called with a lower precedence than `expr()`',
          'The tokenizer regex treats `-` as part of the number',
          '`peek()` reads one token too far ahead',
        ],
        correct: 0,
        hints: ['Look at how `term()` handles `*` and `/` and compare with `expr()`.'],
        explanation:
          '`term()` uses the left-associative pattern: parse one operand, then loop folding into an accumulator. `expr()` instead calls itself for the right side. For `+` only that is harmless, but for `-` it computes `a - (b ± c)`.',
        timeLimitSec: 240,
        focusFile: 'src/formula.ts',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Make + and - left-associative',
        prompt: 'Fix `expr()` so `+` and `-` are left-associative, matching the grammar comment. Everything else must keep working.',
        editable: ['src/formula.ts'],
        tests: [
          {
            path: 'tests/formula.test.ts',
            content: `import { evaluate } from '../src/formula';

test('left associative minus', () => {
  expect(evaluate('100 - 20 - 5')).toBe(75);
  expect(evaluate('10 - 2 + 3')).toBe(11);
  expect(evaluate('1 - 1 - 1 - 1')).toBe(-2);
});

test('precedence and parentheses', () => {
  expect(evaluate('2 + 3 * 4')).toBe(14);
  expect(evaluate('2 * (3 + 4)')).toBe(14);
  expect(evaluate('100 - (20 - 5)')).toBe(85);
  expect(evaluate('8 / 4 / 2')).toBe(1);
});

test('variables', () => {
  expect(evaluate('base - fee + tip', { base: 50, fee: 10, tip: 5 })).toBe(45);
  expect(evaluate('price * 1.5', { price: 4 })).toBe(6);
});

test('errors', () => {
  expect(() => evaluate('base + 1')).toThrow('unknown token');
  expect(() => evaluate('1 2')).toThrow('unexpected');
});
`,
          },
        ],
        solution: {
          'src/formula.ts': `// Tiny recursive-descent parser for pricing formulas like "base * 2 - discount".
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := NUMBER | IDENT | '(' expr ')'

export type Vars = Record<string, number>;

export function evaluate(src: string, vars: Vars = {}): number {
  const tokens = src.match(/\\d+(?:\\.\\d+)?|[A-Za-z_]\\w*|[-+*/()]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr(): number {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const rhs = term();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function term(): number {
    let value = factor();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const rhs = factor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function factor(): number {
    const tok = next();
    if (tok === '(') {
      const v = expr();
      next(); // ')'
      return v;
    }
    if (/^\\d/.test(tok)) return Number(tok);
    if (tok in vars) return vars[tok];
    throw new Error(\`unknown token \${tok}\`);
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error(\`unexpected \${peek()}\`);
  return result;
}
`,
        },
        hints: ['Copy the shape of `term()`: accumulator + `while` loop.'],
        explanation:
          'The `*`-style loop (`value = value op rhs` while the next token is an operator of this precedence) is the standard way to get left associativity in recursive descent without left recursion (which would loop forever).',
        timeLimitSec: 480,
        focusFile: 'src/formula.ts',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 4. Sparse arrays: forEach/map skip holes
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-sparse-seat-map',
    title: 'The Seat Map With Holes',
    level: 2,
    rating: 1350,
    lang: 'javascript',
    domain: 'booking',
    companies: ['meta', 'amazon', 'generic'],
    tags: ['sparse-arrays', 'array-methods', 'language-semantics'],
    summary: 'Seats are stored in `new Array(n)`. The "free seats" counter says the cinema is full.',
    context: 'The cinema booking widget shows "0 seats left" on a half-empty screening. The row is built with `new Array(size)`.',
    files: [
      {
        path: 'booking/seats.js',
        content: `function buildRow(size, taken) {
  const row = new Array(size);
  for (const [seat, guest] of Object.entries(taken)) {
    row[Number(seat)] = guest;
  }
  return row;
}

function freeSeats(row) {
  let free = 0;
  row.forEach((guest) => {
    if (guest === undefined) free++;
  });
  return free;
}

function seatLabels(row) {
  return row.map((guest, i) => \`\${i + 1}:\${guest ?? 'free'}\`);
}

module.exports = { buildRow, freeSeats, seatLabels };
`,
      },
      {
        path: 'main.js',
        content: `const { buildRow, freeSeats, seatLabels } = require('./booking/seats');

const row = buildRow(5, { 1: 'ana', 3: 'raj' });
console.log(row.length, Object.keys(row).length);
console.log(freeSeats(row));
console.log(seatLabels(row).join(','));
console.log(row.filter(() => true).length, [...row].filter((g) => g === undefined).length);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Holes in the row',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: '5 2\n0\n,2:ana,,4:raj,\n2 3',
        options: [
          '5 5\n3\n1:free,2:ana,3:free,4:raj,5:free\n5 3',
          '5 2\n3\n1:free,2:ana,3:free,4:raj,5:free\n2 3',
          '5 2\n0\n,2:ana,,4:raj,\n2 3',
          '5 2\n0\n,2:ana,,4:raj,\n2 0',
          '2 2\n0\n2:ana,4:raj\n2 3',
        ],
        hints: [
          '`new Array(5)` creates a length-5 array with **no** elements: indices 0, 2, 4 are holes, not `undefined` values.',
          '`forEach`, `map` and `filter` skip holes. `map` preserves them in its result. Spread and `Array.from` turn holes into real `undefined`s.',
        ],
        explanation:
          '`length` is 5 but only indices 1 and 3 exist as keys. `forEach` never visits holes, so `freeSeats` counts 0. `map` skips holes and the result keeps them as holes; `join` renders holes as empty strings → `,2:ana,,4:raj,`. `filter` skips holes (2 survivors), while spread materialises them as `undefined` (3 matches).',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Count the empty seats',
        prompt:
          'Fix `freeSeats` and `seatLabels` so that holes are treated as free seats. `buildRow` must keep its signature; you may change its implementation too.',
        editable: ['booking/seats.js'],
        tests: [
          {
            path: 'tests/seats.test.js',
            content: `const { buildRow, freeSeats, seatLabels } = require('../booking/seats');

test('free seats counts unbooked seats', () => {
  expect(freeSeats(buildRow(5, { 1: 'ana', 3: 'raj' }))).toBe(3);
  expect(freeSeats(buildRow(3, {}))).toBe(3);
  expect(freeSeats(buildRow(2, { 0: 'x', 1: 'y' }))).toBe(0);
});

test('labels cover every seat', () => {
  expect(seatLabels(buildRow(4, { 2: 'li' }))).toEqual(['1:free', '2:free', '3:li', '4:free']);
});

test('works on dense arrays too', () => {
  expect(freeSeats([undefined, 'a', undefined])).toBe(2);
  expect(seatLabels(['a', undefined])).toEqual(['1:a', '2:free']);
});
`,
          },
        ],
        solution: {
          'booking/seats.js': `function buildRow(size, taken) {
  const row = Array.from({ length: size }, () => undefined);
  for (const [seat, guest] of Object.entries(taken)) {
    row[Number(seat)] = guest;
  }
  return row;
}

function freeSeats(row) {
  let free = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === undefined) free++;
  }
  return free;
}

function seatLabels(row) {
  return Array.from(row, (guest, i) => \`\${i + 1}:\${guest ?? 'free'}\`);
}

module.exports = { buildRow, freeSeats, seatLabels };
`,
        },
        hints: ['A classic `for (let i = 0; i < row.length; i++)` loop visits every index, holes included.', '`Array.from(row, fn)` also visits every index.'],
        explanation:
          'Avoid holes at the source (`Array.from({ length })` or `new Array(n).fill(null)`) *and* make the readers robust by iterating by index or with `Array.from`. Reading `row[i]` on a hole yields `undefined`, which is what the business logic wants.',
        timeLimitSec: 420,
        focusFile: 'booking/seats.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 5. Object spread is shallow
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-promo-shallow-copy',
    title: 'Promo Preview Leaks Into the Order',
    level: 2,
    rating: 1300,
    lang: 'javascript',
    domain: 'pricing',
    companies: ['amazon', 'stripe', 'canva'],
    tags: ['aliasing', 'shallow-copy', 'object-spread', 'mutation'],
    summary: 'Previewing a promo code permanently discounts the real order.',
    context:
      'Checkout shows a "preview with promo" panel. After a customer previews a code and then removes it, the order still charges the discounted line prices. Prices are integer cents.',
    persona: 'confident-intern',
    files: [
      {
        path: 'pricing/promo.js',
        content: `// Returns a NEW order with the promo applied. Must not change the input order.
function applyPromo(order, percentOff) {
  const discounted = { ...order, promoApplied: true };
  for (const line of discounted.lines) {
    line.price = Math.round((line.price * (100 - percentOff)) / 100);
  }
  discounted.total = discounted.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  return discounted;
}

module.exports = { applyPromo };
`,
      },
      {
        path: 'main.js',
        content: `const { applyPromo } = require('./pricing/promo');

const order = {
  id: 'o-1',
  lines: [
    { sku: 'tea', price: 400, qty: 2 },
    { sku: 'mug', price: 1200, qty: 1 },
  ],
  total: 2000,
};

const preview = applyPromo(order, 25);
console.log(order.total, preview.total);
console.log(order.lines[0].price, preview.lines[0].price);
console.log(order.lines === preview.lines, order.promoApplied);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What changed?',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: '2000 1500\n300 300\ntrue undefined',
        options: [
          '2000 1500\n400 300\nfalse undefined',
          '1500 1500\n300 300\ntrue true',
          '2000 1500\n300 300\ntrue undefined',
          '2000 1500\n300 300\nfalse undefined',
        ],
        hints: ['`{ ...order }` copies the *top-level* properties. What is the value of the `lines` property: the array, or a reference to it?'],
        explanation:
          'Spread creates a new outer object, so assigning `discounted.total` and `promoApplied` does not affect `order` (2000, `undefined`). But `lines` is copied by reference: both orders share the same array and the same line objects, so `line.price = ...` rewrites the original prices (300 in both).',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'The assistant has a fix',
        prompt: 'You ask the assistant to fix it. Should you accept its suggestion?',
        persona: 'confident-intern',
        request: 'applyPromo mutates the original order. Fix it.',
        aiReply: `Classic shallow-copy bug! The spread copies the object but not the array, so just copy the array too:

\`\`\`js
function applyPromo(order, percentOff) {
  const discounted = { ...order, lines: [...order.lines], promoApplied: true };
  for (const line of discounted.lines) {
    line.price = Math.round((line.price * (100 - percentOff)) / 100);
  }
  discounted.total = discounted.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  return discounted;
}
\`\`\`

Now \`order.lines !== preview.lines\`, so the original is untouched. 🎉`,
        options: [
          'Accept: the lines array is now a separate copy',
          'Reject: the new array still holds the same line objects, so `line.price = ...` still mutates the original order\'s lines',
          'Reject: array spread does not work on arrays of objects',
          'Reject: `promoApplied` must come before the spread',
        ],
        correct: 1,
        hints: ['Two levels of nesting: order → array → line objects. How many levels does the fix copy?'],
        explanation:
          '`[...order.lines]` is a new array of the **same** element references. The loop mutates those shared objects, so `order.lines[0].price` still becomes 300. The check `order.lines !== preview.lines` passes, which makes this fix look right in a quick test. Map to new objects instead: `lines: order.lines.map(l => ({ ...l, price: ... }))`.',
        timeLimitSec: 240,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make applyPromo pure',
        prompt: '`applyPromo` must return a new order and leave the input order (and every nested object) unchanged.',
        editable: ['pricing/promo.js'],
        tests: [
          {
            path: 'tests/promo.test.js',
            content: `const { applyPromo } = require('../pricing/promo');

function makeOrder() {
  return {
    id: 'o-1',
    lines: [
      { sku: 'tea', price: 400, qty: 2 },
      { sku: 'mug', price: 1200, qty: 1 },
    ],
    total: 2000,
  };
}

test('preview is discounted', () => {
  const p = applyPromo(makeOrder(), 25);
  expect(p.total).toBe(1500);
  expect(p.lines.map((l) => l.price)).toEqual([300, 900]);
  expect(p.promoApplied).toBe(true);
});

test('original order untouched', () => {
  const o = makeOrder();
  applyPromo(o, 25);
  expect(o).toEqual(makeOrder());
});

test('applying twice from the original does not compound', () => {
  const o = makeOrder();
  applyPromo(o, 50);
  const p = applyPromo(o, 50);
  expect(p.total).toBe(1000);
});
`,
          },
        ],
        solution: {
          'pricing/promo.js': `// Returns a NEW order with the promo applied. Must not change the input order.
function applyPromo(order, percentOff) {
  const lines = order.lines.map((line) => ({
    ...line,
    price: Math.round((line.price * (100 - percentOff)) / 100),
  }));
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  return { ...order, lines, total, promoApplied: true };
}

module.exports = { applyPromo };
`,
        },
        hints: ['Build new line objects with `map` + spread instead of assigning into the existing ones.'],
        explanation:
          'Copy exactly the path you modify: a new order, a new `lines` array and new line objects. Everything you do not touch (e.g. `sku` strings) can be shared safely. `structuredClone(order)` also works but deep-copies more than needed.',
        timeLimitSec: 360,
        focusFile: 'pricing/promo.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 6. Python list * n aliasing
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-heatmap-aliasing',
    title: 'Every Day Looks the Same',
    level: 2,
    rating: 1150,
    lang: 'python',
    domain: 'rate-limiter',
    companies: ['google', 'meta', 'generic'],
    tags: ['aliasing', 'list-multiplication', 'mutation'],
    summary: 'A traffic heatmap shows identical rows for every day.',
    context: 'The API gateway dashboard plots requests per (day, hour). Every day row on the chart is identical, even for a day with no traffic.',
    files: [
      {
        path: 'metrics/heatmap.py',
        content: `HOURS = 24


def empty_heatmap(days):
    """A days x 24 grid of request counts."""
    return [[0] * HOURS] * days


def record(heatmap, day, hour, count=1):
    heatmap[day][hour] += count


def busiest_hour(heatmap):
    best = (0, 0, -1)
    for d, row in enumerate(heatmap):
        for h, c in enumerate(row):
            if c > best[2]:
                best = (d, h, c)
    return best
`,
      },
      {
        path: 'main.py',
        content: `from metrics.heatmap import empty_heatmap, record, busiest_hour

grid = empty_heatmap(3)
record(grid, 0, 9, 5)
record(grid, 2, 9, 2)
record(grid, 1, 17, 4)
print(grid[1][9], grid[0][17])
print(busiest_hour(grid))
print(sum(map(sum, grid)))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Read the grid',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: '7 4\n(0, 9, 7)\n33',
        options: ['0 0\n(0, 9, 5)\n11', '7 4\n(0, 9, 7)\n33', '7 4\n(2, 9, 7)\n33', '7 4\n(0, 9, 7)\n11', '2 4\n(0, 9, 5)\n11'],
        hints: ['`[row] * 3` creates a list containing the same `row` object three times.'],
        explanation:
          '`[[0] * 24] * 3` multiplies the *outer* list, copying the reference to one inner list. All three "days" are the same list, so every `record` lands in all of them: hour 9 = 5 + 2 = 7 and hour 17 = 4 for each day. `busiest_hour` uses strict `>`, so the first day wins: `(0, 9, 7)`. The total counts the shared row three times: 3 × 11 = 33. (`[0] * 24` itself is fine, because ints are immutable.)',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the aliasing',
        prompt: 'Click the buggy line and choose the cause.',
        file: 'metrics/heatmap.py',
        lines: [6],
        options: [
          'The outer `* days` repeats a reference to one inner list, so all days share a row',
          'The inner `[0] * HOURS` shares a single int object, so all hours update together',
          '`record` should return the new heatmap',
          '`busiest_hour` should use `>=`',
        ],
        correct: 0,
        hints: ['Ints are immutable: `+=` on a list element rebinds that slot. Lists are mutable.'],
        explanation:
          'Repeating a list of immutables (`[0] * 24`) is safe: `+=` replaces the slot. Repeating a list of lists copies references, so all rows alias. Use `[[0] * HOURS for _ in range(days)]`.',
        timeLimitSec: 150,
        focusFile: 'metrics/heatmap.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Give each day its own row',
        prompt: 'Fix `empty_heatmap` so each day has an independent row.',
        editable: ['metrics/heatmap.py'],
        tests: [
          {
            path: 'tests/test_heatmap.py',
            content: `from metrics.heatmap import empty_heatmap, record, busiest_hour


def test_rows_are_independent():
    g = empty_heatmap(3)
    record(g, 0, 9, 5)
    record(g, 2, 9, 2)
    assert g[0][9] == 5
    assert g[1][9] == 0
    assert g[2][9] == 2


def test_shape():
    g = empty_heatmap(4)
    assert len(g) == 4 and all(len(r) == 24 for r in g)
    assert len({id(r) for r in g}) == 4


def test_busiest():
    g = empty_heatmap(2)
    record(g, 1, 17, 4)
    record(g, 0, 3, 1)
    assert busiest_hour(g) == (1, 17, 4)
`,
          },
        ],
        solution: {
          'metrics/heatmap.py': `HOURS = 24


def empty_heatmap(days):
    """A days x 24 grid of request counts."""
    return [[0] * HOURS for _ in range(days)]


def record(heatmap, day, hour, count=1):
    heatmap[day][hour] += count


def busiest_hour(heatmap):
    best = (0, 0, -1)
    for d, row in enumerate(heatmap):
        for h, c in enumerate(row):
            if c > best[2]:
                best = (d, h, c)
    return best
`,
        },
        hints: ['A list comprehension evaluates `[0] * HOURS` once per iteration.'],
        explanation: 'The comprehension builds a fresh inner list on every iteration, so each day owns its row.',
        timeLimitSec: 240,
        focusFile: 'metrics/heatmap.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 7. Mutating a dict while iterating it
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-session-purge',
    title: 'Session Purge Crashes the Cron',
    level: 2,
    rating: 1250,
    lang: 'python',
    domain: 'auth',
    companies: ['atlassian', 'microsoft', 'generic'],
    tags: ['dict-iteration', 'mutation', 'exceptions'],
    summary: 'A nightly job deletes expired sessions while iterating over them.',
    context: 'The `purge_expired` cron job has been failing every night, and the session table keeps growing.',
    persona: 'outdated-docs',
    files: [
      {
        path: 'auth/sessions.py',
        content: `class SessionStore:
    def __init__(self, ttl):
        self.ttl = ttl
        self._sessions = {}  # token -> last_seen (seconds)

    def touch(self, token, now):
        self._sessions[token] = now

    def active(self):
        return len(self._sessions)

    def purge_expired(self, now):
        removed = 0
        for token, last_seen in self._sessions.items():
            if now - last_seen > self.ttl:
                del self._sessions[token]
                removed += 1
        return removed
`,
      },
      {
        path: 'main.py',
        content: `from auth.sessions import SessionStore

store = SessionStore(ttl=30)
store.touch("a", 0)
store.touch("b", 50)
store.touch("c", 5)
try:
    print("purged", store.purge_expired(now=60))
except RuntimeError as e:
    print("error:", e)
print("active", store.active())
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What happens at now=60?',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: 'error: dictionary changed size during iteration\nactive 2',
        options: [
          'purged 2\nactive 1',
          'error: dictionary changed size during iteration\nactive 3',
          'error: dictionary changed size during iteration\nactive 2',
          'purged 1\nactive 2',
        ],
        hints: ['Insertion order is a, b, c. Which is the first expired session?', 'The deletion itself succeeds; the error comes on the *next* step of the iterator.'],
        explanation:
          '"a" (age 60) is expired and is deleted. When the loop asks the items view for the next entry, Python detects the size change and raises `RuntimeError`. So one session was removed before the crash ("active 2"), "c" (age 55) was never reached, and `removed` was never returned.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Old advice',
        prompt: 'The assistant suggests a fix. Accept or reject?',
        persona: 'outdated-docs',
        request: 'purge_expired raises "dictionary changed size during iteration". Fix please.',
        aiReply: `You are iterating over the live dict. \`dict.keys()\` returns a **list copy** of the keys, so iterate over that instead and you can safely delete:

\`\`\`python
def purge_expired(self, now):
    removed = 0
    for token in self._sessions.keys():
        if now - self._sessions[token] > self.ttl:
            del self._sessions[token]
            removed += 1
    return removed
\`\`\``,
        options: [
          'Accept: iterating over keys() decouples the loop from the dict',
          'Reject: in Python 3, `keys()` returns a live view, so this raises the same RuntimeError',
          'Reject: `del` must be replaced by `self._sessions.pop(token)` and then it works',
          'Reject: `keys()` is deprecated in Python 3',
        ],
        correct: 1,
        hints: ['Was the claim "keys() returns a list" true in Python 3?'],
        explanation:
          'In Python 2, `keys()` returned a list. In Python 3 it returns a dynamic *view*, so mutating the dict during iteration still raises. `pop` vs `del` makes no difference. Iterate over a snapshot (`list(self._sessions.items())`) or rebuild the dict.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the purge',
        prompt: 'Fix `purge_expired` so it removes every session older than `ttl` (strictly greater) and returns how many were removed.',
        editable: ['auth/sessions.py'],
        tests: [
          {
            path: 'tests/test_sessions.py',
            content: `from auth.sessions import SessionStore


def make():
    s = SessionStore(ttl=30)
    s.touch("a", 0)
    s.touch("b", 50)
    s.touch("c", 5)
    s.touch("d", 30)
    return s


def test_purges_all_expired():
    s = make()
    assert s.purge_expired(now=60) == 2
    assert s.active() == 2


def test_boundary_is_kept():
    s = make()
    s.purge_expired(now=60)
    s.touch("e", 60)
    # b=50, d=30, e=60 remain
    assert s.purge_expired(now=80) == 1   # only d (age 50); b is exactly 30 -> kept
    assert s.purge_expired(now=81) == 1   # b (age 31)
    assert s.active() == 1


def test_nothing_expired():
    s = make()
    assert s.purge_expired(now=10) == 0
    assert s.active() == 4
`,
          },
        ],
        solution: {
          'auth/sessions.py': `class SessionStore:
    def __init__(self, ttl):
        self.ttl = ttl
        self._sessions = {}  # token -> last_seen (seconds)

    def touch(self, token, now):
        self._sessions[token] = now

    def active(self):
        return len(self._sessions)

    def purge_expired(self, now):
        expired = [t for t, seen in self._sessions.items() if now - seen > self.ttl]
        for token in expired:
            del self._sessions[token]
        return len(expired)
`,
        },
        hints: ['Collect the tokens to delete first, then delete them in a second loop.'],
        explanation:
          'Two-phase: snapshot the keys to remove, then delete. Alternatively `self._sessions = {t: s for t, s in ... if not expired}` (but that rebinds the dict, which matters if anyone else holds a reference to it).',
        timeLimitSec: 300,
        focusFile: 'auth/sessions.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 8. var in a loop + closures
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-retry-plan-var',
    title: 'Retry Plan: Every Attempt Is the Last',
    level: 2,
    rating: 1150,
    lang: 'javascript',
    domain: 'scheduler',
    companies: ['google', 'uber', 'generic'],
    tags: ['closures', 'var-vs-let', 'scope'],
    summary: 'A retry planner builds one closure per attempt. They all describe the same attempt.',
    context: 'The job scheduler stores a list of thunks, one per retry attempt, and calls them later to log what it is about to do.',
    files: [
      {
        path: 'jobs/retry.js',
        content: `// Build one describer per retry attempt; the scheduler calls them later.
function buildRetryPlan(jobId, delays) {
  const steps = [];
  for (var attempt = 0; attempt < delays.length; attempt++) {
    var delay = delays[attempt];
    steps.push(function () {
      return \`job \${jobId} attempt \${attempt + 1} after \${delay}ms\`;
    });
  }
  return steps;
}

module.exports = { buildRetryPlan };
`,
      },
      {
        path: 'main.js',
        content: `const { buildRetryPlan } = require('./jobs/retry');

const plan = buildRetryPlan('j7', [100, 200, 400]);
for (const describe of plan) {
  console.log(describe());
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the log',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'job j7 attempt 4 after 400ms\njob j7 attempt 4 after 400ms\njob j7 attempt 4 after 400ms',
        options: [
          'job j7 attempt 1 after 100ms\njob j7 attempt 2 after 200ms\njob j7 attempt 3 after 400ms',
          'job j7 attempt 3 after 400ms\njob j7 attempt 3 after 400ms\njob j7 attempt 3 after 400ms',
          'job j7 attempt 4 after 400ms\njob j7 attempt 4 after 400ms\njob j7 attempt 4 after 400ms',
          'job j7 attempt 4 after undefinedms\njob j7 attempt 4 after undefinedms\njob j7 attempt 4 after undefinedms',
        ],
        hints: ['`var` is function-scoped: there is exactly one `attempt` and one `delay` for the whole call.', 'What is `attempt` when the loop exits?'],
        explanation:
          'All three closures capture the same function-scoped `attempt` and `delay`. They run after the loop finished, when `attempt` is 3 (so `attempt + 1` is 4) and `delay` holds the last assigned value, 400. `delay` was assigned inside the loop body, so it is not `delays[3]`.',
        timeLimitSec: 150,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Which declaration is wrong?',
        prompt: 'Click a line responsible and pick the root cause.',
        file: 'jobs/retry.js',
        lines: [4, 5],
        options: [
          '`var` creates one binding per function, so every closure sees the final values; `let`/`const` create a fresh binding per iteration',
          'Template literals are evaluated when the function is defined, not when it is called',
          '`steps.push` should push the result of calling the function',
          '`jobId` is captured by reference and changes between calls',
        ],
        correct: 0,
        hints: ['Both `var` lines contribute to the bug.'],
        explanation:
          'With `let attempt` in the `for` header, JS creates a new binding per iteration and copies the value forward. `const delay` inside the body is a new binding per iteration too. Template literals are evaluated when the function runs, which is why the late values show up.',
        timeLimitSec: 150,
        focusFile: 'jobs/retry.js',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the plan',
        prompt: 'Make each describer report its own attempt number and delay.',
        editable: ['jobs/retry.js'],
        tests: [
          {
            path: 'tests/retry.test.js',
            content: `const { buildRetryPlan } = require('../jobs/retry');

test('each step describes its own attempt', () => {
  const plan = buildRetryPlan('j7', [100, 200, 400]);
  expect(plan.map((f) => f())).toEqual([
    'job j7 attempt 1 after 100ms',
    'job j7 attempt 2 after 200ms',
    'job j7 attempt 3 after 400ms',
  ]);
});

test('empty plan', () => {
  expect(buildRetryPlan('x', [])).toHaveLength(0);
});
`,
          },
        ],
        solution: {
          'jobs/retry.js': `// Build one describer per retry attempt; the scheduler calls them later.
function buildRetryPlan(jobId, delays) {
  const steps = [];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const delay = delays[attempt];
    steps.push(function () {
      return \`job \${jobId} attempt \${attempt + 1} after \${delay}ms\`;
    });
  }
  return steps;
}

module.exports = { buildRetryPlan };
`,
        },
        hints: ['Two keywords to change.'],
        explanation: 'Per-iteration bindings (`let` in the loop header, `const` in the body) give each closure its own `attempt` and `delay`. `delays.map((delay, i) => () => ...)` is an equally good rewrite.',
        timeLimitSec: 180,
        focusFile: 'jobs/retry.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 9. Python late-binding lambdas
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-webhook-late-binding',
    title: 'Every Webhook Is a Refund',
    level: 2,
    rating: 1350,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'google', 'meta'],
    tags: ['closures', 'late-binding', 'lambda'],
    summary: 'A router builds one lambda per event type. Every event is dispatched as the last one.',
    context: 'The webhook router maps each event name to a handler. The ledger shows every charge event recorded as `refund.created`.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'webhooks/router.py',
        content: `def make_router(events, dispatch):
    """Return {event_name: handler(payload)} that forwards to dispatch(event, payload)."""
    handlers = {}
    for event in events:
        handlers[event] = lambda payload: dispatch(event, payload)
    return handlers
`,
      },
      {
        path: 'main.py',
        content: `from webhooks.router import make_router

ledger = []


def dispatch(event, payload):
    ledger.append(f"{event}:{payload['id']}")


router = make_router(["charge.succeeded", "charge.failed", "refund.created"], dispatch)
router["charge.succeeded"]({"id": 1})
router["charge.failed"]({"id": 2})
print(sorted(router))
print(ledger)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the ledger',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "['charge.failed', 'charge.succeeded', 'refund.created']\n['refund.created:1', 'refund.created:2']",
        options: [
          "['charge.failed', 'charge.succeeded', 'refund.created']\n['charge.succeeded:1', 'charge.failed:2']",
          "['charge.failed', 'charge.succeeded', 'refund.created']\n['refund.created:1', 'refund.created:2']",
          "['refund.created']\n['refund.created:1', 'refund.created:2']",
          "['charge.failed', 'charge.succeeded', 'refund.created']\n['refund.created:2', 'refund.created:2']",
        ],
        hints: ['The dict keys are evaluated immediately; the lambda bodies are not.', 'A lambda looks up `event` in the enclosing scope when it is *called*.'],
        explanation:
          'Keys are computed in the loop, so the router has all three. But every lambda closes over the single variable `event`, which holds `"refund.created"` after the loop. `payload` is a real parameter, so ids 1 and 2 are correct.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Review the fix',
        prompt: 'The assistant proposes this fix. Accept it?',
        persona: 'helpful-senior',
        request: 'All handlers dispatch the last event name. Fix make_router.',
        aiReply: `The lambdas late-bind \`event\`. Bind it eagerly with \`functools.partial\`, which stores the argument at creation time:

\`\`\`python
from functools import partial


def make_router(events, dispatch):
    """Return {event_name: handler(payload)} that forwards to dispatch(event, payload)."""
    handlers = {}
    for event in events:
        handlers[event] = partial(dispatch, event)
    return handlers
\`\`\`

\`handlers["charge.failed"](payload)\` now calls \`dispatch("charge.failed", payload)\`.`,
        options: [
          'Accept: `partial` captures the current value of `event` for each handler',
          'Reject: `partial` also late-binds, so the bug remains',
          'Reject: `partial(dispatch, event)` passes `event` as the second argument',
          'Reject: you must use `lambda payload, event=event: ...` because partial objects are not callable',
        ],
        correct: 0,
        hints: ['When is the expression `event` evaluated in `partial(dispatch, event)`?'],
        explanation:
          'Arguments to `partial(...)` are evaluated immediately, so each handler stores the event string from that iteration, and positional arguments are prepended, so the call is `dispatch(event, payload)`. The default-argument trick `lambda payload, event=event: ...` also works, but leaves an overridable parameter on the handler.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the router',
        prompt: 'Fix `make_router` so each handler dispatches its own event name. Handlers must be callable with exactly one argument (the payload).',
        editable: ['webhooks/router.py'],
        tests: [
          {
            path: 'tests/test_router.py',
            content: `from webhooks.router import make_router


def test_each_handler_routes_its_own_event():
    seen = []
    r = make_router(["a", "b", "c"], lambda e, p: seen.append((e, p)))
    r["a"](1)
    r["b"](2)
    r["c"](3)
    assert seen == [("a", 1), ("b", 2), ("c", 3)]


def test_returns_dispatch_result():
    r = make_router(["x", "y"], lambda e, p: e + str(p))
    assert r["x"](9) == "x9"
`,
          },
        ],
        solution: {
          'webhooks/router.py': `from functools import partial


def make_router(events, dispatch):
    """Return {event_name: handler(payload)} that forwards to dispatch(event, payload)."""
    handlers = {}
    for event in events:
        handlers[event] = partial(dispatch, event)
    return handlers
`,
        },
        hints: ['Bind the value at creation time: `functools.partial`, a default argument, or a factory function.'],
        explanation: 'Any technique that evaluates `event` during the loop works: `partial`, `lambda p, e=event: dispatch(e, p)`, or a helper `def make(e): return lambda p: dispatch(e, p)`.',
        timeLimitSec: 240,
        focusFile: 'webhooks/router.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 10. Generator exhausted by the first pass
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-py-log-summary-generator',
    title: 'The Log Summary Says Zero',
    level: 2,
    rating: 1300,
    lang: 'python',
    domain: 'log-processor',
    companies: ['amazon', 'google', 'two-sigma'],
    tags: ['generators', 'iterator-exhaustion'],
    summary: 'A log summariser reports 0 total lines while also reporting errors.',
    context: 'The on-call summary bot posts "total: 0, errors: 2", which is clearly impossible.',
    files: [
      {
        path: 'logs/report.py',
        content: `def parse(lines):
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        level, _, msg = line.partition(" ")
        yield level, msg


def summarize(lines):
    records = parse(lines)
    errors = [msg for level, msg in records if level == "ERROR"]
    total = sum(1 for _ in records)
    return {"total": total, "errors": len(errors), "first_error": errors[0] if errors else None}
`,
      },
      {
        path: 'main.py',
        content: `from logs.report import summarize, parse

LINES = [
    "# boot",
    "INFO service started",
    "ERROR db timeout",
    "",
    "WARN slow request",
    "ERROR db timeout again",
]

print(summarize(LINES))
gen = parse(LINES)
print(next(gen), len(list(gen)), len(list(gen)))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the summary',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "{'total': 0, 'errors': 2, 'first_error': 'db timeout'}\n('INFO', 'service started') 3 0",
        options: [
          "{'total': 4, 'errors': 2, 'first_error': 'db timeout'}\n('INFO', 'service started') 3 3",
          "{'total': 0, 'errors': 2, 'first_error': 'db timeout'}\n('INFO', 'service started') 3 0",
          "{'total': 6, 'errors': 2, 'first_error': 'db timeout'}\n('INFO', 'service started') 4 0",
          "{'total': 0, 'errors': 0, 'first_error': None}\n('INFO', 'service started') 3 0",
        ],
        hints: ['A generator can be iterated only once.', 'The list comprehension consumes `records` completely.'],
        explanation:
          '`parse` returns a generator. The comprehension drains it (finding 2 errors), so the second pass in `sum(...)` sees nothing → total 0. Likewise `next(gen)` takes the first record, the first `list(gen)` takes the remaining 3, and the second `list(gen)` is empty.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Where is the second pass?',
        prompt: 'Click the line that silently reads an exhausted iterator and choose the explanation.',
        file: 'logs/report.py',
        lines: [13],
        options: [
          '`records` was consumed by the comprehension on the previous line, so this pass sees an empty iterator',
          '`sum` of a generator expression always returns 0 in Python 3',
          '`partition` returns a list, so unpacking fails silently',
          'Blank lines are counted as records',
        ],
        correct: 0,
        hints: ['Lines 12 and 13 both loop over `records`.'],
        explanation: 'Iterators keep a position; once exhausted they stay exhausted without raising. Any code that iterates twice must either materialise a list or compute everything in one pass.',
        timeLimitSec: 150,
        focusFile: 'logs/report.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix summarize',
        prompt: 'Fix `summarize` so `total` counts all parsed records. `lines` may be any iterable (including a one-shot iterator such as an open file).',
        editable: ['logs/report.py'],
        tests: [
          {
            path: 'tests/test_report.py',
            content: `from logs.report import summarize

LINES = ["# boot", "INFO a", "ERROR b", "", "WARN c", "ERROR d"]


def test_list_input():
    assert summarize(LINES) == {"total": 4, "errors": 2, "first_error": "b"}


def test_one_shot_iterator_input():
    assert summarize(iter(LINES)) == {"total": 4, "errors": 2, "first_error": "b"}


def test_no_errors():
    assert summarize(["INFO x"]) == {"total": 1, "errors": 0, "first_error": None}
`,
          },
        ],
        solution: {
          'logs/report.py': `def parse(lines):
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        level, _, msg = line.partition(" ")
        yield level, msg


def summarize(lines):
    records = list(parse(lines))
    errors = [msg for level, msg in records if level == "ERROR"]
    total = len(records)
    return {"total": total, "errors": len(errors), "first_error": errors[0] if errors else None}
`,
        },
        hints: ['Materialise the generator once with `list(...)`, or count in the same loop that collects errors.'],
        explanation:
          '`list(parse(lines))` reads the input exactly once, so it also works when `lines` is a one-shot iterator. For huge logs, compute both numbers in a single streaming loop instead of keeping every record in memory.',
        timeLimitSec: 240,
        focusFile: 'logs/report.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 11. `this` binding with a detached method
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-js-token-bucket-this',
    title: 'Token Bucket Loses Its `this`',
    level: 2,
    rating: 1400,
    lang: 'javascript',
    domain: 'rate-limiter',
    companies: ['meta', 'google', 'atlassian'],
    tags: ['this-binding', 'getters', 'classes'],
    summary: 'Passing a method as a callback detaches it from its object.',
    context: 'The API gateway passes the limiter\'s `tryTake` method to a generic admission helper. Production crashed on deploy.',
    persona: 'confident-intern',
    files: [
      {
        path: 'limiter/tokenBucket.js',
        content: `class TokenBucket {
  constructor(capacity) {
    this.capacity = capacity;
    this.tokens = capacity;
  }

  tryTake() {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  get remaining() {
    return this.tokens;
  }
}

function admitAll(requests, check) {
  return requests.map((r) => (check(r) ? 'ok' : 'throttled'));
}

class Gateway {
  constructor(bucket) {
    this.check = bucket.tryTake;
  }

  handle(requests) {
    return admitAll(requests, this.check);
  }
}

module.exports = { TokenBucket, admitAll, Gateway };
`,
      },
      {
        path: 'main.js',
        content: `const { TokenBucket, admitAll } = require('./limiter/tokenBucket');

const reqs = ['r1', 'r2', 'r3'];
const bucket = new TokenBucket(2);
console.log(admitAll(reqs, () => bucket.tryTake()).join(','));

const other = new TokenBucket(2);
try {
  console.log(admitAll(reqs, other.tryTake).join(','));
} catch (e) {
  console.log(e.constructor.name);
}

const { remaining } = other;
other.tryTake();
console.log(remaining, other.remaining, bucket.remaining);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the gateway',
        prompt: 'What does `main.js` print?',
        entry: 'main.js',
        answer: 'ok,ok,throttled\nTypeError\n2 1 0',
        options: [
          'ok,ok,throttled\nok,ok,throttled\n0 0 0',
          'ok,ok,throttled\nthrottled,throttled,throttled\n2 1 0',
          'ok,ok,throttled\nTypeError\n2 1 0',
          'ok,ok,throttled\nTypeError\n1 1 0',
        ],
        hints: [
          '`other.tryTake` is just the function; `check(r)` calls it with no receiver. Class bodies are always strict mode.',
          'Destructuring a getter reads it once and stores the number.',
        ],
        explanation:
          'The arrow wrapper keeps the receiver, giving `ok,ok,throttled`. Passing `other.tryTake` detaches it: in strict mode (all class code) `this` is `undefined`, so `this.tokens` throws a `TypeError`. `const { remaining } = other` invokes the getter once and stores `2`; it is a snapshot, not a live binding, so after one more `tryTake` the getter returns 1 while the variable is still 2.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'A one-word fix?',
        prompt: 'The assistant suggests this change in `main.js`. Accept?',
        persona: 'confident-intern',
        request: 'admitAll(reqs, other.tryTake) throws TypeError. Smallest fix?',
        aiReply: `The method lost its \`this\`. Just bind it:

\`\`\`js
console.log(admitAll(reqs, other.tryTake.bind(this)).join(','));
\`\`\`

\`bind\` permanently attaches the context, so \`this.tokens\` works again. 👍`,
        options: [
          'Accept: `bind` fixes detached methods',
          'Reject: at module top level `this` is not `other` (in CommonJS it is `module.exports`), so no error is thrown but every request is throttled',
          'Reject: `bind` cannot be used on class methods',
          'Reject: `bind` creates a copy of the bucket, so tokens are not shared',
        ],
        correct: 1,
        hints: ['`bind` is right; the argument is the question. What is `this` at the top level of a CommonJS module?'],
        explanation:
          'It must be `other.tryTake.bind(other)`. At the top level of a CommonJS module `this` is `module.exports` (`{}`), so `this.tokens` is `undefined`, `undefined > 0` is false, and every request is silently "throttled". That is arguably worse than a crash, since it looks like correct rate limiting.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the Gateway',
        prompt: '`new Gateway(bucket).handle(reqs)` currently throws. Fix `Gateway` so it admits requests against the bucket it was given.',
        editable: ['limiter/tokenBucket.js'],
        tests: [
          {
            path: 'tests/gateway.test.js',
            content: `const { TokenBucket, Gateway } = require('../limiter/tokenBucket');

test('gateway uses its bucket', () => {
  const bucket = new TokenBucket(2);
  const gw = new Gateway(bucket);
  expect(gw.handle(['a', 'b', 'c'])).toEqual(['ok', 'ok', 'throttled']);
  expect(bucket.remaining).toBe(0);
});

test('two gateways do not share tokens', () => {
  const g1 = new Gateway(new TokenBucket(1));
  const g2 = new Gateway(new TokenBucket(1));
  expect(g1.handle(['a'])).toEqual(['ok']);
  expect(g2.handle(['a'])).toEqual(['ok']);
});
`,
          },
        ],
        solution: {
          'limiter/tokenBucket.js': `class TokenBucket {
  constructor(capacity) {
    this.capacity = capacity;
    this.tokens = capacity;
  }

  tryTake() {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  get remaining() {
    return this.tokens;
  }
}

function admitAll(requests, check) {
  return requests.map((r) => (check(r) ? 'ok' : 'throttled'));
}

class Gateway {
  constructor(bucket) {
    this.check = () => bucket.tryTake();
  }

  handle(requests) {
    return admitAll(requests, this.check);
  }
}

module.exports = { TokenBucket, admitAll, Gateway };
`,
        },
        hints: ['Either `bucket.tryTake.bind(bucket)` or an arrow function that calls `bucket.tryTake()`.'],
        explanation: 'Capture the receiver: `bucket.tryTake.bind(bucket)` or `() => bucket.tryTake()`. Arrow functions do not have their own `this`, but here the arrow calls the method *on* `bucket`, which is what supplies the receiver.',
        timeLimitSec: 240,
        focusFile: 'limiter/tokenBucket.js',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 12. Getters on the prototype vs spread / JSON / Object.create
  // ---------------------------------------------------------------------------
  {
    id: 'l2-a-ts-stock-getter-snapshot',
    title: 'Where Did `available` Go?',
    level: 2,
    rating: 1500,
    lang: 'typescript',
    domain: 'inventory',
    companies: ['amazon', 'apple', 'canva'],
    tags: ['getters', 'prototypes', 'object-spread', 'json'],
    summary: 'A computed `available` getter disappears from snapshots and API responses.',
    context: 'The stock API serialises `StockItem` objects with `JSON.stringify`. The mobile app shows "available: undefined".',
    files: [
      {
        path: 'src/stock.ts',
        content: `export class StockItem {
  reserved = 0;

  constructor(public sku: string, public onHand: number) {}

  get available(): number {
    return this.onHand - this.reserved;
  }

  reserve(qty: number): boolean {
    if (qty > this.available) return false;
    this.reserved += qty;
    return true;
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { StockItem } from './stock';

const item = new StockItem('sku-1', 10);
const snapshot: any = { ...item };
item.reserve(4);
console.log(item.available, snapshot.available, snapshot.reserved);
console.log(Object.keys(item).sort().join(','), 'available' in item);

const view = Object.create(item);
item.reserve(3);
console.log(view.available, Object.keys(view).length, view.reserve(5));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Snapshots and views',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: '6 undefined 0\nonHand,reserved,sku true\n3 0 false',
        options: [
          '6 10 0\navailable,onHand,reserved,sku true\n3 0 false',
          '6 undefined 0\nonHand,reserved,sku true\n3 0 false',
          '6 undefined 4\nonHand,reserved,sku false\n3 3 false',
          '6 undefined 0\nonHand,reserved,sku false\n10 0 true',
        ],
        hints: [
          'Getters defined in a class body live on the prototype, not on the instance.',
          'Object spread and `Object.keys` only see *own* enumerable properties; `in` walks the prototype chain.',
          '`Object.create(item)` makes an object whose prototype is `item`.',
        ],
        explanation:
          'Spread copies own fields (`reserved`, `sku`, `onHand`) at that moment, so `snapshot.reserved` is 0 and there is no `available`. `Object.keys(item)` lists only own fields, while `\'available\' in item` is true via the prototype. `view` has no own keys; reading `view.available` runs the getter with `this = view`, which reads `onHand` (10) and `reserved` (7) through the chain → 3. `reserve(5)` fails because only 3 are available.',
        timeLimitSec: 300,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Why is it missing from the API?',
        prompt: 'Why does `JSON.stringify(item)` not include `available`? Select all that apply.',
        options: [
          '`JSON.stringify` only serialises own enumerable properties, and the getter is defined on `StockItem.prototype`',
          'Getters are never callable by `JSON.stringify`',
          'Adding a `toJSON()` method to the class would let you include it',
          'TypeScript strips getters at compile time',
        ],
        correct: [0, 2],
        hints: ['If you did `Object.defineProperty(obj, "x", { get, enumerable: true })` on the instance, would it be serialised?'],
        explanation:
          'Serialisation walks own enumerable keys; an own enumerable getter *would* be invoked. Class accessors are on the prototype, so they are skipped. `toJSON()` lets the class control its representation. TypeScript keeps getters as-is.',
        timeLimitSec: 180,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'feature',
        title: 'Serialise available',
        prompt:
          'Make `JSON.stringify(item)` produce `{ sku, onHand, reserved, available }` with the **current** value of `available`. Keep the getter.',
        editable: ['src/stock.ts'],
        tests: [
          {
            path: 'tests/stock.test.ts',
            content: `import { StockItem } from '../src/stock';

test('json includes live available', () => {
  const item = new StockItem('sku-1', 10);
  item.reserve(4);
  expect(JSON.parse(JSON.stringify(item))).toEqual({ sku: 'sku-1', onHand: 10, reserved: 4, available: 6 });
  item.reserve(1);
  expect(JSON.parse(JSON.stringify(item)).available).toBe(5);
});

test('getter still works and reserve still validates', () => {
  const item = new StockItem('a', 2);
  expect(item.reserve(3)).toBe(false);
  expect(item.reserve(2)).toBe(true);
  expect(item.available).toBe(0);
});
`,
          },
        ],
        solution: {
          'src/stock.ts': `export class StockItem {
  reserved = 0;

  constructor(public sku: string, public onHand: number) {}

  get available(): number {
    return this.onHand - this.reserved;
  }

  reserve(qty: number): boolean {
    if (qty > this.available) return false;
    this.reserved += qty;
    return true;
  }

  toJSON() {
    return { sku: this.sku, onHand: this.onHand, reserved: this.reserved, available: this.available };
  }
}
`,
        },
        hints: ['`JSON.stringify` calls a `toJSON()` method if the object has one.'],
        explanation: '`toJSON` is the hook `JSON.stringify` uses. Computing `available` inside it gives the live value at serialisation time rather than a stale stored field.',
        timeLimitSec: 300,
        focusFile: 'src/stock.ts',
      },
    ],
  },
];

export default problems;
