import type { Problem } from '../types';

/**
 * Level 1 "Line Reader" — slice A (Python).
 * JavaScript half of this slice lives in l1-a.ts.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------- 1
  {
    id: 'l1-a-py-retry-range',
    title: 'Webhook Retry Count',
    level: 1,
    rating: 600,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'generic'],
    tags: ['range', 'off-by-one', 'loops'],
    summary: 'The config says 4 attempts. How many actually happen?',
    files: [
      {
        path: 'retries.py',
        content: `# Retry schedule for the payment webhook: attempts are numbered from 1.
MAX_ATTEMPTS = 4

attempts = []
for attempt in range(1, MAX_ATTEMPTS):
    attempts.append(attempt)

print(len(attempts), attempts[-1])
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Count the attempts',
        prompt: 'What does `retries.py` print? Type the single output line.',
        answer: '3 3',
        hints: ['`range(start, stop)` includes `start` but excludes `stop`.'],
        explanation:
          '`range(1, 4)` yields `1, 2, 3` — the stop value is exclusive. So only 3 attempts are made and the last is attempt 3, one fewer than configured. Half-open ranges make `len(range(a, b)) == b - a`, which is why they are the default in Python.',
        timeLimitSec: 90,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Pick the right range',
        prompt: 'Which `range` produces attempts numbered `1, 2, 3, 4` when `MAX_ATTEMPTS = 4`?',
        options: [
          'range(MAX_ATTEMPTS)',
          'range(1, MAX_ATTEMPTS + 1)',
          'range(0, MAX_ATTEMPTS + 1)',
          'range(1, MAX_ATTEMPTS, 1)',
        ],
        correct: [1],
        hints: ['You need the stop value to be one past the last number you want.'],
        explanation:
          '`range(1, 5)` gives `1..4`. `range(4)` gives `0..3`, `range(0, 5)` gives `0..4` (five attempts), and the explicit step of 1 changes nothing.',
        timeLimitSec: 90,
      },
    ],
  },

  // ---------------------------------------------------------------- 2
  {
    id: 'l1-a-py-status-counter-get',
    title: 'Access-Log Status Counter',
    level: 1,
    rating: 625,
    lang: 'python',
    domain: 'log-processor',
    companies: ['google', 'amazon'],
    tags: ['dict-get', 'default-values', 'counting'],
    summary: 'Every status code is over-counted by exactly one.',
    context: 'The SRE dashboard shows more requests than the load balancer ever received. The counts come from `logs/stats.py`.',
    files: [
      {
        path: 'logs/stats.py',
        content: `def count_status(lines):
    """Count HTTP status codes from access-log lines like 'GET /x 200'."""
    counts = {}
    for line in lines:
        status = line.split()[-1]
        counts[status] = counts.get(status, 1) + 1
    return counts


def error_rate(counts):
    total = sum(counts.values())
    errors = sum(n for code, n in counts.items() if code.startswith("5"))
    return errors / total if total else 0.0
`,
      },
      {
        path: 'main.py',
        content: `from logs.stats import count_status

lines = ["GET / 200", "GET /a 500", "POST /b 200", "GET /c 200"]
print(count_status(lines))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Count the statuses',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "{'200': 4, '500': 2}",
        options: ["{'200': 3, '500': 1}", "{'200': 4, '500': 2}", "{'200': 3, '500': 2}", "{'500': 2, '200': 4}"],
        hints: ['`dict.get(key, default)` returns `default` when the key is missing.', 'What does the first `200` line store?'],
        explanation:
          'The first time a status is seen, `counts.get(status, 1)` returns the default `1`, then `+ 1` stores `2`. Every later occurrence adds 1 correctly, so each code ends up one too high: `200` → 4, `500` → 2. Dicts preserve insertion order, so `200` prints first.',
        timeLimitSec: 120,
        focusFile: 'logs/stats.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the off-by-one',
        prompt: 'Click the line responsible for the over-count and choose the cause.',
        file: 'logs/stats.py',
        lines: [6],
        options: [
          'The default passed to `get` should be 0, not 1',
          '`line.split()[-1]` picks the path instead of the status',
          '`error_rate` divides by the wrong total',
          'Dict keys should be ints, not strings',
        ],
        correct: 0,
        hints: ['The bug only affects the *first* occurrence of each status.'],
        explanation:
          'Line 6 seeds unseen keys with 1 and then adds 1. The seed must be the identity for addition: `counts.get(status, 0) + 1`. (`collections.Counter` does this for you.)',
        timeLimitSec: 90,
        focusFile: 'logs/stats.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the counter',
        prompt: 'Fix `count_status` so each status code is counted exactly once per line.',
        editable: ['logs/stats.py'],
        tests: [
          {
            path: 'tests/test_stats.py',
            content: `from logs.stats import count_status, error_rate


def test_counts():
    lines = ["GET / 200", "GET /a 500", "POST /b 200", "GET /c 200"]
    assert count_status(lines) == {"200": 3, "500": 1}


def test_empty():
    assert count_status([]) == {}


def test_error_rate():
    lines = ["GET / 200", "GET /a 503", "GET /b 500", "GET /c 404"]
    assert error_rate(count_status(lines)) == 0.5
`,
          },
        ],
        solution: {
          'logs/stats.py': `def count_status(lines):
    """Count HTTP status codes from access-log lines like 'GET /x 200'."""
    counts = {}
    for line in lines:
        status = line.split()[-1]
        counts[status] = counts.get(status, 0) + 1
    return counts


def error_rate(counts):
    total = sum(counts.values())
    errors = sum(n for code, n in counts.items() if code.startswith("5"))
    return errors / total if total else 0.0
`,
        },
        hints: ['One character.'],
        explanation:
          '`counts.get(status, 0) + 1` is the standard counting idiom. Alternatives: `collections.Counter(line.split()[-1] for line in lines)` or `collections.defaultdict(int)`.',
        timeLimitSec: 180,
        focusFile: 'logs/stats.py',
      },
    ],
  },

  // ---------------------------------------------------------------- 3
  {
    id: 'l1-a-py-event-window-slicing',
    title: 'Rate-Limiter Event Window',
    level: 1,
    rating: 725,
    lang: 'python',
    domain: 'rate-limiter',
    companies: ['meta', 'uber', 'generic'],
    tags: ['slicing', 'negative-index', 'off-by-one'],
    summary: 'Asking for the last 0 events returns all of them.',
    context:
      'The rate limiter looks at the most recent `n` events per client, and the admin UI pages through the event log.',
    files: [
      {
        path: 'ratelimit/window.py',
        content: `def recent(events, n):
    """Return the last n events, oldest first."""
    return events[-n:]


def page(events, page_no, size):
    """1-based page of events."""
    start = (page_no - 1) * size
    return events[start:start + size + 1]
`,
      },
      {
        path: 'main.py',
        content: `from ratelimit.window import recent, page

events = ["e1", "e2", "e3", "e4", "e5"]
print(recent(events, 2))
print(recent(events, 0))
print(page(events, 2, 2))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Slice the window',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "['e4', 'e5']\n['e1', 'e2', 'e3', 'e4', 'e5']\n['e3', 'e4', 'e5']",
        options: [
          "['e4', 'e5']\n[]\n['e3', 'e4']",
          "['e4', 'e5']\n['e1', 'e2', 'e3', 'e4', 'e5']\n['e3', 'e4', 'e5']",
          "['e4', 'e5']\n[]\n['e3', 'e4', 'e5']",
          "['e5', 'e4']\n['e1', 'e2', 'e3', 'e4', 'e5']\n['e3', 'e4']",
        ],
        hints: ['`-0` is just `0`. What is `events[0:]`?', 'For `page(events, 2, 2)`: start is 2, stop is `2 + 2 + 1`.'],
        explanation:
          '`events[-2:]` is the last two. But `-0 == 0`, so `events[-0:]` is `events[0:]` — the **whole** list. `page(events, 2, 2)` slices `[2:5]`, three items, because of the extra `+ 1` (slice stops are already exclusive).',
        timeLimitSec: 180,
        focusFile: 'ratelimit/window.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The zero-window bug',
        prompt: 'A client with a window size of 0 is being judged on its entire history. Click the line responsible and choose the cause.',
        file: 'ratelimit/window.py',
        lines: [3],
        options: [
          '`-n` is `0` when `n == 0`, and `events[0:]` is the full list',
          'Negative slices return items newest-first',
          'Slicing copies the list, which is too slow for a rate limiter',
          '`events[-n:]` raises IndexError when `n > len(events)`',
        ],
        correct: 0,
        hints: ['Evaluate `-n` for `n = 0`.'],
        explanation:
          'Line 3 relies on a negative start index, and there is no "negative zero" index. Guard it (`return events[-n:] if n > 0 else []`) or compute a non-negative start: `events[max(len(events) - n, 0):]`. Note that out-of-range slices never raise — `events[-100:]` just returns the whole list.',
        timeLimitSec: 120,
        focusFile: 'ratelimit/window.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix both helpers',
        prompt: '`recent(events, 0)` must return `[]`, and `page` must return at most `size` items.',
        editable: ['ratelimit/window.py'],
        tests: [
          {
            path: 'tests/test_window.py',
            content: `from ratelimit.window import recent, page

EVENTS = ["e1", "e2", "e3", "e4", "e5"]


def test_recent():
    assert recent(EVENTS, 2) == ["e4", "e5"]
    assert recent(EVENTS, 0) == []
    assert recent(EVENTS, 9) == EVENTS


def test_page():
    assert page(EVENTS, 1, 2) == ["e1", "e2"]
    assert page(EVENTS, 2, 2) == ["e3", "e4"]
    assert page(EVENTS, 3, 2) == ["e5"]
    assert page(EVENTS, 4, 2) == []
`,
          },
        ],
        solution: {
          'ratelimit/window.py': `def recent(events, n):
    """Return the last n events, oldest first."""
    if n <= 0:
        return []
    return events[-n:]


def page(events, page_no, size):
    """1-based page of events."""
    start = (page_no - 1) * size
    return events[start:start + size]
`,
        },
        hints: ['Handle `n <= 0` explicitly.', 'A slice `[start:start + size]` already contains exactly `size` items.'],
        explanation:
          'Slices are half-open: `[a:b]` has `b - a` items, so `+ 1` is always wrong for "take size items". And any time you write `seq[-n:]`, ask what happens when `n` is 0.',
        timeLimitSec: 240,
        focusFile: 'ratelimit/window.py',
      },
    ],
  },

  // ---------------------------------------------------------------- 4
  {
    id: 'l1-a-py-trade-bucket-floor-div',
    title: 'Pre-Open Trade Buckets',
    level: 1,
    rating: 775,
    lang: 'python',
    domain: 'market-data',
    companies: ['jane-street', 'optiver', 'hrt'],
    tags: ['floor-division', 'modulo', 'negative-numbers'],
    summary: 'Python floors, JavaScript truncates. Auction trades have negative timestamps.',
    files: [
      {
        path: 'buckets.py',
        content: `# Groups trade timestamps (seconds relative to market open) into 60s buckets.
# Pre-open auction trades have negative offsets.
def bucket(offset_s):
    return offset_s // 60


def seconds_into_bucket(offset_s):
    return offset_s % 60


for t in [125, -1, -60, -61]:
    print(t, bucket(t), seconds_into_bucket(t))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Bucket the trades',
        prompt: 'What does `buckets.py` print?',
        answer: '125 2 5\n-1 -1 59\n-60 -1 0\n-61 -2 59',
        options: [
          '125 2 5\n-1 -1 59\n-60 -1 0\n-61 -2 59',
          '125 2 5\n-1 0 -1\n-60 -1 0\n-61 -1 -1',
          '125 2 5\n-1 -1 59\n-60 -1 0\n-61 -1 59',
          '125 2 5\n-1 -1 59\n-60 -2 0\n-61 -2 59',
        ],
        hints: [
          'Python\'s `//` rounds toward **negative infinity**, not toward zero.',
          'Python keeps `a == (a // b) * b + a % b`, so `%` has the sign of the divisor.',
        ],
        explanation:
          '`-1 // 60` is `floor(-0.0167) = -1`, and `-1 % 60 = 59` (because `-1 * 60 + 59 = -1`). `-60` divides exactly: bucket `-1`, remainder `0`. `-61 // 60 = floor(-1.0167) = -2`, remainder `59`. This is great for bucketing: every bucket is exactly 60 seconds wide, including the ones before the open.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Port it to JavaScript',
        prompt:
          'A teammate ports this to JS as `Math.trunc(t / 60)` and `t % 60`. What does the JS version compute for `t = -1`?',
        options: [
          'bucket 0, remainder -1',
          'bucket -1, remainder 59',
          'bucket -1, remainder -1',
          'bucket 0, remainder 59',
        ],
        correct: [0],
        hints: ['`Math.trunc` rounds toward zero; JS `%` takes the sign of the dividend.'],
        explanation:
          'JS truncates: `Math.trunc(-1/60)` is `-0` (numerically equal to 0), and `-1 % 60` is `-1`. So the trade at one second before the open lands in bucket 0 with the post-open trades. To match Python, use `Math.floor(t / 60)` and `((t % 60) + 60) % 60`.',
        timeLimitSec: 150,
      },
    ],
  },

  // ---------------------------------------------------------------- 5
  {
    id: 'l1-a-py-email-normalize-immutable',
    title: 'Email Normalisation',
    level: 1,
    rating: 825,
    lang: 'python',
    domain: 'auth',
    companies: ['google', 'atlassian', 'apple'],
    tags: ['string-immutability', 'return-values'],
    summary: 'Three string methods are called and none of them do anything.',
    context:
      'Users can sign up twice with `Ana.Silva@Gmail.com` and `anasilva@gmail.com`. `normalize_email` is supposed to produce the canonical key for the `users` table.',
    persona: 'outdated-docs',
    files: [
      {
        path: 'auth/normalize.py',
        content: `def normalize_email(raw):
    """Canonical form used as the primary key in the users table."""
    email = raw
    email.strip()
    email.lower()
    local, _, domain = email.partition("@")
    if domain == "gmail.com":
        local.replace(".", "")
    return local + "@" + domain
`,
      },
      {
        path: 'main.py',
        content: `from auth.normalize import normalize_email

print(repr(normalize_email("  Ana.Silva@Gmail.com ")))
print(normalize_email("bo.b@gmail.com"))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What key is stored?',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "'  Ana.Silva@Gmail.com '\nbo.b@gmail.com",
        options: [
          "'anasilva@gmail.com'\nbob@gmail.com",
          "'ana.silva@gmail.com'\nbob@gmail.com",
          "'  Ana.Silva@Gmail.com '\nbo.b@gmail.com",
          "'  Ana.Silva@Gmail.com '\nbob@gmail.com",
        ],
        hints: ['Python strings are immutable. What do `strip()`, `lower()` and `replace()` return?'],
        explanation:
          'String methods never modify a string in place — they **return a new string**. Lines 4, 5 and 8 throw their results away, so `email` and `local` keep their original values. The first input is returned unchanged (whitespace and capitals included; note the domain is `"Gmail.com "`, so the gmail branch is skipped). For `bo.b@gmail.com` the branch runs, but `local.replace(...)` is discarded too.',
        timeLimitSec: 150,
        focusFile: 'auth/normalize.py',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Normalise for real',
        prompt:
          'Fix `normalize_email`: strip surrounding whitespace, lowercase everything, and for `gmail.com` remove dots from the local part.',
        editable: ['auth/normalize.py'],
        tests: [
          {
            path: 'tests/test_normalize.py',
            content: `from auth.normalize import normalize_email


def test_gmail_dots_case_whitespace():
    assert normalize_email("  Ana.Silva@Gmail.com ") == "anasilva@gmail.com"
    assert normalize_email("bo.b@gmail.com") == "bob@gmail.com"


def test_other_domains_keep_dots():
    assert normalize_email("Bo.B@Example.com") == "bo.b@example.com"


def test_input_unchanged_type():
    raw = "X@Y.com"
    normalize_email(raw)
    assert raw == "X@Y.com"
`,
          },
        ],
        solution: {
          'auth/normalize.py': `def normalize_email(raw):
    """Canonical form used as the primary key in the users table."""
    email = raw.strip().lower()
    local, _, domain = email.partition("@")
    if domain == "gmail.com":
        local = local.replace(".", "")
    return local + "@" + domain
`,
        },
        hints: ['Assign the result: `email = email.strip()`.', 'Order matters: strip before partitioning, or the domain keeps a trailing space.'],
        explanation:
          'Re-bind the names to the returned strings (`email = raw.strip().lower()`, `local = local.replace(".", "")`). Because strings are immutable, the caller\'s `raw` can never be changed by this function — a nice guarantee that also explains why the original code silently did nothing.',
        timeLimitSec: 240,
        focusFile: 'auth/normalize.py',
      },
    ],
  },

  // ---------------------------------------------------------------- 6
  {
    id: 'l1-a-py-seat-map-aliasing',
    title: 'Cinema Seat Map',
    level: 1,
    rating: 875,
    lang: 'python',
    domain: 'booking',
    companies: ['amazon', 'canva', 'generic'],
    tags: ['list-aliasing', 'shallow-copy', 'list-multiplication'],
    summary: 'Booking seat 0-1 also books 1-1 and 2-1.',
    context: 'Customers report that after one booking, the same seat appears taken in **every row** of the hall.',
    persona: 'confident-intern',
    files: [
      {
        path: 'seating/layout.py',
        content: `def empty_layout(rows, cols):
    """Seat map: layout[r][c] is True when the seat is booked."""
    row = [False] * cols
    return [row] * rows


def book(layout, r, c):
    if layout[r][c]:
        raise ValueError(f"seat {r}-{c} already booked")
    layout[r][c] = True


def booked_count(layout):
    return sum(seat for row in layout for seat in row)
`,
      },
      {
        path: 'main.py',
        content: `from seating.layout import empty_layout, book, booked_count

hall = empty_layout(3, 4)
book(hall, 0, 1)
print(booked_count(hall))
print(hall[2][1])
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Book one seat',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: '3\nTrue',
        options: ['1\nFalse', '3\nTrue', '1\nTrue', '3\nFalse'],
        hints: ['`[row] * 3` makes a list containing the **same** `row` object three times.'],
        explanation:
          'List multiplication copies *references*, not objects. `hall` is `[row, row, row]` where all three entries are the same list, so setting `hall[0][1] = True` is visible through `hall[1]` and `hall[2]` too. The count is 3 and `hall[2][1]` is `True`. (`[False] * cols` is fine because booleans are immutable.)',
        timeLimitSec: 150,
        focusFile: 'seating/layout.py',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Review the quick fix',
        prompt: 'The assistant proposes a fix. Should you accept it?',
        persona: 'confident-intern',
        request: 'Booking one seat books it in every row. Fix empty_layout.',
        aiReply: `Classic aliasing! You just need to copy the row so the rows aren't shared:

\`\`\`python
def empty_layout(rows, cols):
    row = [False] * cols
    return [row.copy()] * rows
\`\`\`

\`.copy()\` creates a brand new list, so each row is independent now. 🎉`,
        options: [
          'Accept: `.copy()` makes each row independent',
          'Reject: `row.copy()` runs once, so the outer list still holds the same (copied) list three times',
          'Reject: `.copy()` is deep, so it is unnecessarily slow',
          'Reject: lists have no `.copy()` method; use `copy.copy(row)`',
        ],
        correct: 1,
        hints: ['How many times is `row.copy()` evaluated?'],
        explanation:
          '`[row.copy()] * rows` evaluates `row.copy()` **once**, producing one new list, and then multiplies the reference to it. The bug is unchanged. Each row needs its own list, created per iteration: `[[False] * cols for _ in range(rows)]`. (`list.copy()` does exist and is a shallow copy.)',
        timeLimitSec: 150,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the seat map',
        prompt: 'Fix `empty_layout` so every row is an independent list.',
        editable: ['seating/layout.py'],
        tests: [
          {
            path: 'tests/test_layout.py',
            content: `from seating.layout import empty_layout, book, booked_count


def test_one_booking_books_one_seat():
    hall = empty_layout(3, 4)
    book(hall, 0, 1)
    assert booked_count(hall) == 1
    assert hall[2][1] is False


def test_rows_are_distinct_objects():
    hall = empty_layout(3, 2)
    assert hall[0] is not hall[1]
    assert hall == [[False, False]] * 3


def test_double_booking_rejected():
    hall = empty_layout(2, 2)
    book(hall, 1, 1)
    try:
        book(hall, 1, 1)
        assert False, "expected ValueError"
    except ValueError:
        pass
`,
          },
        ],
        solution: {
          'seating/layout.py': `def empty_layout(rows, cols):
    """Seat map: layout[r][c] is True when the seat is booked."""
    return [[False] * cols for _ in range(rows)]


def book(layout, r, c):
    if layout[r][c]:
        raise ValueError(f"seat {r}-{c} already booked")
    layout[r][c] = True


def booked_count(layout):
    return sum(seat for row in layout for seat in row)
`,
        },
        hints: ['Create a new inner list on every iteration of a comprehension.'],
        explanation:
          'A list comprehension evaluates its expression once per iteration, so `[[False] * cols for _ in range(rows)]` builds `rows` distinct lists. Note `==` compares contents (so `hall == [[False, False]] * 3` is true) while `is` compares identity.',
        timeLimitSec: 240,
        focusFile: 'seating/layout.py',
      },
    ],
  },

  // ---------------------------------------------------------------- 7
  {
    id: 'l1-a-py-catalog-comprehensions',
    title: 'Catalog Comprehensions',
    level: 1,
    rating: 950,
    lang: 'python',
    domain: 'search',
    companies: ['amazon', 'google'],
    tags: ['list-comprehension', 'dict-comprehension', 'conditional-expression'],
    summary: 'Filter vs. conditional expression, and what a dict comprehension does with duplicate keys.',
    files: [
      {
        path: 'catalog.py',
        content: `products = [
    {"sku": "A1", "category": "books", "price": 12},
    {"sku": "B7", "category": "games", "price": 60},
    {"sku": "C3", "category": "books", "price": 30},
    {"sku": "D9", "category": "music", "price": 9},
]

cheap = [p["sku"] for p in products if p["price"] < 20]
by_category = {p["category"]: p["sku"] for p in products}
labels = [p["sku"] if p["price"] < 20 else "-" for p in products]

print(cheap)
print(by_category)
print(labels)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Build the indexes',
        prompt: 'What does `catalog.py` print?',
        answer: "['A1', 'D9']\n{'books': 'C3', 'games': 'B7', 'music': 'D9'}\n['A1', '-', '-', 'D9']",
        options: [
          "['A1', 'D9']\n{'books': 'C3', 'games': 'B7', 'music': 'D9'}\n['A1', '-', '-', 'D9']",
          "['A1', 'D9']\n{'books': 'A1', 'games': 'B7', 'music': 'D9'}\n['A1', '-', '-', 'D9']",
          "['A1', 'D9']\n{'games': 'B7', 'books': 'C3', 'music': 'D9'}\n['A1', 'D9']",
          "['A1', '-', '-', 'D9']\n{'books': 'C3', 'games': 'B7', 'music': 'D9'}\n['A1', 'D9']",
        ],
        hints: [
          'A trailing `if` filters items out; an `x if cond else y` before `for` transforms every item.',
          'In a dict comprehension, a repeated key is overwritten — but where does it sit in the order?',
        ],
        explanation:
          '`cheap` filters: only A1 (12) and D9 (9). `by_category` assigns `books` twice; the later value `C3` wins, but the key keeps its **original insertion position** (first), because updating an existing key does not move it. `labels` uses a conditional expression, so it has one entry per product.',
        timeLimitSec: 210,
      },
    ],
  },

  // ---------------------------------------------------------------- 8
  {
    id: 'l1-a-py-ticker-fstrings',
    title: 'Ticker Tape Formatting',
    level: 1,
    rating: 975,
    lang: 'python',
    domain: 'market-data',
    companies: ['citadel', 'two-sigma', 'blackrock'],
    tags: ['f-strings', 'format-spec', 'rounding'],
    summary: 'Format specs, sign flags and banker\'s rounding on a quote board.',
    files: [
      {
        path: 'ticker.py',
        content: `quotes = [("AAPL", 189.5, 0.25), ("BRK.A", 612345.678, -1.5)]

for sym, px, chg in quotes:
    print(f"{sym:<6}|{px:>10.2f}|{chg:+.1f}%")

print(round(2.5), round(3.5), round(0.125, 2))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Render the board',
        prompt: 'What does `ticker.py` print? (Spaces matter inside each line.)',
        answer: 'AAPL  |    189.50|+0.2%\nBRK.A | 612345.68|-1.5%\n2 4 0.12',
        options: [
          'AAPL  |    189.50|+0.2%\nBRK.A | 612345.68|-1.5%\n2 4 0.12',
          'AAPL  |    189.50|+0.3%\nBRK.A | 612345.68|-1.5%\n3 4 0.13',
          'AAPL  |189.50    |+0.2%\nBRK.A |612345.68 |-1.5%\n2 4 0.12',
          'AAPL  |    189.50|0.3%\nBRK.A | 612345.68|-1.5%\n3 4 0.13',
        ],
        hints: [
          '`<6` left-aligns in 6 chars; `>10.2f` right-aligns a 2-decimal number in 10 chars; `+` forces a sign.',
          'Python rounds exact halves to the nearest **even** digit (banker\'s rounding).',
          '0.25 and 0.125 are exactly representable in binary, so they really are halves.',
        ],
        explanation:
          '`{sym:<6}` pads to 6 characters on the right, `{px:>10.2f}` pads `189.50` to 10 on the left, and `+` shows `+` for positives. `0.25` to one decimal is an exact tie, so it rounds to the even digit: `0.2`. Likewise `round(2.5) == 2`, `round(3.5) == 4`, and `round(0.125, 2) == 0.12`. Ties-to-even avoids a systematic upward bias when summing many rounded values — which matters for P&L reports.',
        timeLimitSec: 240,
      },
    ],
  },

  // ---------------------------------------------------------------- 9
  {
    id: 'l1-a-py-quota-cache-falsy',
    title: 'Quota Cache That Never Hits',
    level: 1,
    rating: 1025,
    lang: 'python',
    domain: 'cache',
    companies: ['stripe', 'microsoft', 'generic'],
    tags: ['truthiness', 'caching', 'evaluation-order'],
    summary: 'Users who are out of quota hammer the backend on every request.',
    context:
      'The quota service is getting thousands of calls per second, almost all for users with **zero** quota left. The cache in front of it should prevent that.',
    persona: 'confident-intern',
    files: [
      {
        path: 'cache/quota.py',
        content: `_cache = {}


def remaining_quota(user_id, fetch):
    """Return the user's remaining API quota, hitting the backend at most once per user."""
    cached = _cache.get(user_id)
    if cached:
        return cached
    value = fetch(user_id)
    _cache[user_id] = value
    return value
`,
      },
      {
        path: 'main.py',
        content: `from cache.quota import remaining_quota

calls = []


def fetch(uid):
    calls.append(uid)
    return {"u1": 120, "u2": 0}[uid]


for uid in ["u1", "u2", "u1", "u2", "u2"]:
    remaining_quota(uid, fetch)
print(len(calls), calls)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Count the backend calls',
        prompt: 'What does `main.py` print?',
        entry: 'main.py',
        answer: "4 ['u1', 'u2', 'u2', 'u2']",
        options: [
          "2 ['u1', 'u2']",
          "4 ['u1', 'u2', 'u2', 'u2']",
          "5 ['u1', 'u2', 'u1', 'u2', 'u2']",
          "3 ['u1', 'u2', 'u2']",
        ],
        hints: ['What is `bool(0)`?'],
        explanation:
          '`u1` is fetched once (120 is truthy, so the second lookup hits). `u2` has quota `0`, which **is** cached, but `if cached:` treats 0 as a miss, so every lookup for `u2` refetches: 1 + 3 = 4 calls.',
        timeLimitSec: 150,
        focusFile: 'cache/quota.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the miss',
        prompt: 'Click the line that turns a cached 0 into a cache miss, and choose the root cause.',
        file: 'cache/quota.py',
        lines: [7],
        options: [
          'A truthiness check cannot distinguish "not cached" from a cached falsy value like 0',
          '`_cache.get` raises KeyError for unknown users',
          '`_cache` is re-created on every call',
          'The cache stores the function instead of its result',
        ],
        correct: 0,
        hints: ['There are two different reasons `cached` could be falsy.'],
        explanation:
          'Line 7 conflates "missing" (`None` from `get`) with "present but falsy" (`0`). Test membership explicitly: `if user_id in _cache:` or `if cached is not None:`.',
        timeLimitSec: 120,
        focusFile: 'cache/quota.py',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'The idiomatic one-liner',
        prompt: 'The assistant offers a "more Pythonic" fix. Should you accept it?',
        persona: 'confident-intern',
        request: 'Fix remaining_quota so a cached 0 is a cache hit.',
        aiReply: `Even simpler — let \`setdefault\` handle the hit/miss logic for you:

\`\`\`python
def remaining_quota(user_id, fetch):
    return _cache.setdefault(user_id, fetch(user_id))
\`\`\`

\`setdefault\` only stores the value if the key is missing, and returns the cached value otherwise — including 0. Fewer branches, fewer bugs. ✅`,
        options: [
          'Accept: `setdefault` returns the existing value, including 0',
          'Reject: `fetch(user_id)` is evaluated before `setdefault` is called, so the backend is hit on every request',
          'Reject: `setdefault` overwrites the existing value each time',
          'Reject: `setdefault` returns None when the key is missing',
        ],
        correct: 1,
        hints: ['Python evaluates all arguments before calling a function.'],
        explanation:
          'The returned *value* would be right, but arguments are evaluated eagerly: `fetch(user_id)` runs on every call before `setdefault` even looks at the dict, so the cache saves nothing. `setdefault` is fine for cheap defaults (`d.setdefault(k, [])`), not for expensive ones. A correct fix: `if user_id in _cache: return _cache[user_id]` before fetching.',
        timeLimitSec: 180,
      },
    ],
  },

  // ---------------------------------------------------------------- 10
  {
    id: 'l1-a-py-charge-for-else',
    title: 'Card Charge Retries',
    level: 1,
    rating: 1075,
    lang: 'python',
    domain: 'payments',
    companies: ['stripe', 'goldman', 'jpmorgan'],
    tags: ['for-else', 'break', 'continue'],
    summary: '`for ... else` with `break`, `continue` and `return` in one loop.',
    files: [
      {
        path: 'charge.py',
        content: `def charge_with_retry(responses):
    """responses: simulated gateway replies for successive attempts."""
    for attempt, status in enumerate(responses, start=1):
        if status == "timeout":
            print(f"attempt {attempt}: timeout, retrying")
            continue
        if status == "declined":
            print(f"attempt {attempt}: declined")
            break
        print(f"attempt {attempt}: approved")
        return "charged"
    else:
        print("gave up after retries")
        return "retry-exhausted"
    return "declined"


print(charge_with_retry(["timeout", "declined", "approved"]))
print(charge_with_retry(["timeout", "timeout"]))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Two charges',
        prompt: 'What does `charge.py` print?',
        answer:
          'attempt 1: timeout, retrying\nattempt 2: declined\ndeclined\nattempt 1: timeout, retrying\nattempt 2: timeout, retrying\ngave up after retries\nretry-exhausted',
        options: [
          'attempt 1: timeout, retrying\nattempt 2: declined\ndeclined\nattempt 1: timeout, retrying\nattempt 2: timeout, retrying\ngave up after retries\nretry-exhausted',
          'attempt 1: timeout, retrying\nattempt 2: declined\ngave up after retries\nretry-exhausted\nattempt 1: timeout, retrying\nattempt 2: timeout, retrying\ngave up after retries\nretry-exhausted',
          'attempt 1: timeout, retrying\nattempt 2: declined\nattempt 3: approved\ncharged\nattempt 1: timeout, retrying\nattempt 2: timeout, retrying\ngave up after retries\nretry-exhausted',
          'attempt 1: timeout, retrying\nattempt 2: declined\ndeclined\nattempt 1: timeout, retrying\nattempt 2: timeout, retrying\ndeclined',
        ],
        hints: [
          'The `else` of a `for` loop runs only when the loop finishes **without** `break`.',
          '`continue` does not count as breaking out.',
        ],
        explanation:
          'Call 1: timeout → `continue`; declined → `break`, which skips the `else` and falls through to `return "declined"`. Call 2: two timeouts, the loop runs out of items naturally, so the `else` block runs and returns `"retry-exhausted"`. Read `for/else` as "for … if no break".',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Empty input',
        prompt: 'What does `charge_with_retry([])` return?',
        options: ['"retry-exhausted"', '"declined"', 'None', 'It raises StopIteration'],
        correct: [0],
        hints: ['An empty loop finishes immediately — did it `break`?'],
        explanation:
          'With no items the loop body never runs, so it never breaks; the `else` block runs, prints `gave up after retries` and returns `"retry-exhausted"`. That may or may not be what the payments team wants — it is worth flagging in review.',
        timeLimitSec: 90,
      },
    ],
  },

  // ---------------------------------------------------------------- 11
  {
    id: 'l1-a-py-export-try-finally',
    title: 'Report Export Cleanup',
    level: 1,
    rating: 1175,
    lang: 'python',
    domain: 'file-system',
    companies: ['blackrock', 'apple', 'generic'],
    tags: ['try-finally', 'return', 'exceptions'],
    summary: 'A `return` inside `finally` overrides everything — even exceptions.',
    files: [
      {
        path: 'export.py',
        content: `def export_report(rows, log):
    try:
        if not rows:
            raise ValueError("nothing to export")
        log.append(f"wrote {len(rows)} rows")
        return "ok"
    except ValueError as e:
        log.append(f"error: {e}")
        return "error"
    finally:
        log.append("closed")


def close_handle(handle, log):
    try:
        log.append(f"flush {handle}")
        return "ok"
    finally:
        log.append(f"close {handle}")
        if handle == "tmp":
            return "discarded"


log = []
print(export_report([], log))
print(close_handle("audit.csv", log))
print(close_handle("tmp", log))
print(log)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the export log',
        prompt: 'What does `export.py` print?',
        answer:
          "error\nok\ndiscarded\n['error: nothing to export', 'closed', 'flush audit.csv', 'close audit.csv', 'flush tmp', 'close tmp']",
        options: [
          "error\nok\ndiscarded\n['error: nothing to export', 'closed', 'flush audit.csv', 'close audit.csv', 'flush tmp', 'close tmp']",
          "error\nok\nok\n['error: nothing to export', 'closed', 'flush audit.csv', 'close audit.csv', 'flush tmp', 'close tmp']",
          "error\nok\ndiscarded\n['error: nothing to export', 'flush audit.csv', 'flush tmp', 'close tmp']",
          "closed\nok\ndiscarded\n['error: nothing to export', 'closed', 'flush audit.csv', 'close audit.csv', 'flush tmp', 'close tmp']",
        ],
        hints: [
          '`finally` runs on every exit path — normal return, return from `except`, or exception.',
          'If `finally` itself executes a `return`, that value replaces the pending one.',
        ],
        explanation:
          '`export_report([])` raises, the `except` appends the error and prepares to return `"error"`, then `finally` appends `closed` (no return, so `"error"` stands). `close_handle("audit.csv")` returns `"ok"` after `finally` logs the close. For `"tmp"`, the `try` prepares `"ok"`, but `finally` executes `return "discarded"`, which **replaces** it. (Python 3.14 emits a SyntaxWarning for `return` in `finally` — PEP 765 — precisely because it is so surprising.)',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Swallowed errors',
        prompt:
          'Suppose `log.append(f"flush {handle}")` in `close_handle` raised an `OSError` (disk full) while `handle == "tmp"`. What would the caller observe?',
        options: [
          'The call returns "discarded"; the OSError is silently discarded',
          'The OSError propagates after "close tmp" is logged',
          'The call returns "ok"',
          'Python raises a RuntimeError because of the conflicting exits',
        ],
        correct: [0],
        hints: ['A `return` in `finally` ends the function — what happens to the in-flight exception?'],
        explanation:
          'When `finally` executes `return` (or `break`/`continue`), the in-flight exception is discarded and the function returns normally. That is why linters and PEP 765 flag control flow in `finally`: it can silently swallow real errors like a failed flush. Without the `return`, the OSError would propagate after `finally` ran.',
        timeLimitSec: 150,
      },
    ],
  },

  // ---------------------------------------------------------------- 12
  {
    id: 'l1-a-py-scheduler-default-arg-trace',
    title: 'Job Scheduler Timestamps',
    level: 1,
    rating: 1200,
    lang: 'python',
    domain: 'scheduler',
    companies: ['google', 'meta', 'uber'],
    tags: ['default-arguments', 'evaluation-order', 'tracing'],
    summary: 'When is a default argument evaluated? Trace every print in order.',
    context:
      'Jobs scheduled without an explicit time all fire at the same moment, long before anyone expected. `now()` is a stand-in for a clock call.',
    files: [
      {
        path: 'scheduler.py',
        content: `_clock = [0]


def now():
    _clock[0] += 1
    print(f"now() -> {_clock[0]}")
    return _clock[0]


def schedule(job, at=now()):
    print(f"schedule {job} at {at}")
    return at


def run_all(jobs):
    print("run_all start")
    times = [schedule(j) for j in jobs]
    print("run_all end")
    return times


print("module loaded")
first = schedule("backup", now())
print(run_all(["email", "report"]), first)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Order every print',
        prompt: 'Put the lines printed by `scheduler.py` in the order they appear.',
        items: [
          'now() -> 1',
          'module loaded',
          'now() -> 2',
          'schedule backup at 2',
          'run_all start',
          'schedule email at 1',
          'schedule report at 1',
          'run_all end',
          '[1, 1] 2',
        ],
        hints: [
          'A `def` statement is executed when the module runs, and it evaluates default values right then.',
          'Arguments are evaluated before the function body runs, so `now()` for "backup" prints before "schedule backup".',
          'The final `print` must evaluate `run_all(...)` before it can print anything.',
        ],
        explanation:
          'Executing `def schedule(job, at=now())` calls `now()` **once**, before `module loaded` prints, and stores `1` as the default. `schedule("backup", now())` evaluates its argument first (`now() -> 2`), then runs the body. Inside `run_all`, both jobs use the stored default `1` — `now()` is not called again. Finally the outer `print` receives `[1, 1]` and `2`.',
        timeLimitSec: 300,
        focusFile: 'scheduler.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Fix the default',
        prompt: 'Which signature makes every call without `at` use the time *at the moment of the call*?',
        options: [
          'def schedule(job, at=None):  then  if at is None: at = now()',
          'def schedule(job, at=now):  then use `at` directly',
          'def schedule(job, at=now() or None):',
          'def schedule(job, at=lambda: now()):  then use `at` directly',
        ],
        correct: [0],
        hints: ['Use a sentinel default and compute the real value inside the body.'],
        explanation:
          'A `None` sentinel defers the call to run time: the body runs `now()` each time `at` is omitted. `at=now` stores the *function* (so `at` would print as `<function now ...>` unless called), `now() or None` is still evaluated once at definition time, and the lambda variant also stores a function, not a timestamp.',
        timeLimitSec: 150,
      },
    ],
  },
];

export default problems;
