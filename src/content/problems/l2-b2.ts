import type { Problem } from '../types';

/**
 * Level 2 "Function Tracer" — slice B, part 2 (Python).
 */
const problems: Problem[] = [
  // ───────────────────────────────────────────────────────────── Python 1
  {
    id: 'l2-b-py-portfolio-class-attrs',
    title: 'The Portfolio That Shared Everything',
    level: 2,
    rating: 1150,
    lang: 'python',
    domain: 'portfolio',
    companies: ['blackrock', 'two-sigma', 'meta', 'generic'],
    tags: ['class-attributes', 'instance-attributes', 'mutation', 'aliasing'],
    summary: 'Two portfolios, one positions list. Class vs instance attributes in a trading book.',
    context:
      'Each strategy owns a `Portfolio`. The PM noticed that the **beta** book reports AAPL trades that only **alpha** made.',
    persona: 'confident-intern',
    files: [
      {
        path: 'portfolio/book.py',
        content: `class Portfolio:
    """A trading book with its own positions and trade counter."""

    base_ccy = "USD"
    positions = []
    trade_count = 0

    def __init__(self, name):
        self.name = name

    def add_trade(self, symbol, qty):
        self.positions.append((symbol, qty))
        self.trade_count += 1

    def net(self, symbol):
        return sum(q for s, q in self.positions if s == symbol)
`,
      },
      {
        path: 'main.py',
        content: `from portfolio.book import Portfolio

alpha = Portfolio("alpha")
beta = Portfolio("beta")
alpha.add_trade("AAPL", 100)
beta.add_trade("AAPL", -40)
beta.add_trade("MSFT", 10)

print(alpha.net("AAPL"), beta.net("AAPL"))
print(alpha.trade_count, beta.trade_count, Portfolio.trade_count)

Portfolio.base_ccy = "EUR"
beta.base_ccy = "GBP"
print(alpha.base_ccy, beta.base_ccy, Portfolio.base_ccy)
print(len(Portfolio.positions), "trade_count" in vars(alpha))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Whose trades are these?',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer: '60 60\n1 2 0\nEUR GBP EUR\n3 True',
        options: [
          '100 -40\n1 2 0\nEUR GBP EUR\n0 True',
          '60 60\n3 3 3\nEUR GBP EUR\n3 False',
          '60 60\n1 2 0\nEUR GBP EUR\n3 True',
          '60 60\n1 2 0\nGBP GBP GBP\n3 True',
        ],
        hints: [
          '`self.positions.append(...)` *reads* `self.positions`. Where is it found?',
          '`self.trade_count += 1` is `self.trade_count = self.trade_count + 1`: a read, then an **assignment on the instance**.',
        ],
        explanation:
          'Attribute lookup on an instance checks the instance `__dict__` first, then the class. `positions` is never assigned on an instance, so every `append` mutates the one list stored on the class: both books see all three trades and net AAPL to 60.\n\n`self.trade_count += 1` reads the class value (0), adds 1 and **assigns** to the instance, creating an instance attribute that shadows the class one. So alpha has 1, beta has 2, and `Portfolio.trade_count` stays 0. Immutable class attributes behave like defaults; mutable ones are shared state.\n\nThe same shadowing explains `base_ccy`: `beta` gets its own `GBP`, `alpha` still reads the class value, now `EUR`.',
        timeLimitSec: 240,
        focusFile: 'portfolio/book.py',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Give each book its own positions',
        prompt:
          'Fix `Portfolio` so every instance has its **own** positions list and trade counter. `Portfolio.base_ccy` must remain a class-level default (`"USD"`).',
        editable: ['portfolio/book.py'],
        tests: [
          {
            path: 'tests/test_book.py',
            content: `from portfolio.book import Portfolio

def test_positions_are_independent():
    a = Portfolio("a")
    b = Portfolio("b")
    a.add_trade("AAPL", 100)
    b.add_trade("AAPL", -40)
    assert a.net("AAPL") == 100
    assert b.net("AAPL") == -40

def test_new_book_starts_empty():
    a = Portfolio("a")
    a.add_trade("MSFT", 5)
    c = Portfolio("c")
    assert c.positions == []
    assert c.trade_count == 0

def test_trade_count_per_book():
    a = Portfolio("a")
    a.add_trade("X", 1)
    a.add_trade("Y", 2)
    assert a.trade_count == 2

def test_base_ccy_is_class_default():
    assert Portfolio.base_ccy == "USD"
    assert Portfolio("z").base_ccy == "USD"
`,
          },
        ],
        solution: {
          'portfolio/book.py': `class Portfolio:
    """A trading book with its own positions and trade counter."""

    base_ccy = "USD"

    def __init__(self, name):
        self.name = name
        self.positions = []
        self.trade_count = 0

    def add_trade(self, symbol, qty):
        self.positions.append((symbol, qty))
        self.trade_count += 1

    def net(self, symbol):
        return sum(q for s, q in self.positions if s == symbol)
`,
        },
        hints: [
          'Per-instance state belongs in `__init__`.',
          'Leaving `trade_count = 0` on the class happens to work (it is immutable), but initialising it in `__init__` makes intent explicit.',
        ],
        explanation:
          'Create mutable state in `__init__` (`self.positions = []`). Class attributes are fine for constants and immutable defaults such as `base_ccy`, but a mutable class attribute is a global variable in disguise. Note that the tests construct fresh portfolios after earlier tests ran: with the original code, `c.positions` would already contain other books\' trades.',
        timeLimitSec: 360,
        focusFile: 'portfolio/book.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 2
  {
    id: 'l2-b-py-risk-check-mro',
    title: 'The Risk Check That Never Ran',
    level: 2,
    rating: 1500,
    lang: 'python',
    domain: 'risk',
    companies: ['citadel', 'jane-street', 'google', 'goldman'],
    tags: ['mro', 'super', 'multiple-inheritance', 'mixins'],
    summary: 'Cooperative mixins chain via super(). One mixin forgot to cooperate.',
    context:
      'Pre-trade risk checks are mixins composed per asset class. A 5,000,000 notional FX order sailed through, even though `NotionalLimit` is in `FxChecks`.',
    files: [
      {
        path: 'risk/checks.py',
        content: `class RiskCheck:
    """Base of the chain. Each check returns the audit trail of checks that ran."""

    def run(self, order):
        return ["base"]


class NotionalLimit(RiskCheck):
    max_notional = 1_000_000

    def run(self, order):
        trail = super().run(order)
        if order["qty"] * order["px"] > self.max_notional:
            raise ValueError("notional")
        trail.append("notional")
        return trail


class RestrictedList(RiskCheck):
    restricted = {"XYZ"}

    def run(self, order):
        trail = super().run(order)
        if order["symbol"] in self.restricted:
            raise ValueError("restricted")
        trail.append("restricted")
        return trail


class FatFinger(RiskCheck):
    max_qty = 10_000

    def run(self, order):
        if order["qty"] > self.max_qty:
            raise ValueError("fat-finger")
        return ["fat-finger"]


class EquityChecks(NotionalLimit, RestrictedList):
    pass


class FxChecks(RestrictedList, FatFinger, NotionalLimit):
    pass
`,
      },
      {
        path: 'main.py',
        content: `from risk.checks import EquityChecks, FxChecks

print(EquityChecks().run({"symbol": "AAPL", "qty": 100, "px": 150.0}))
print([c.__name__ for c in FxChecks.__mro__])
print(FxChecks().run({"symbol": "EURUSD", "qty": 5_000, "px": 1_000.0}))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the audit trails',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer:
          "['base', 'restricted', 'notional']\n['FxChecks', 'RestrictedList', 'FatFinger', 'NotionalLimit', 'RiskCheck', 'object']\n['fat-finger', 'restricted']",
        options: [
          "['base', 'notional', 'restricted']\n['FxChecks', 'RestrictedList', 'FatFinger', 'NotionalLimit', 'RiskCheck', 'object']\n['fat-finger', 'restricted']",
          "['base', 'restricted', 'notional']\n['FxChecks', 'RestrictedList', 'RiskCheck', 'FatFinger', 'RiskCheck', 'NotionalLimit', 'RiskCheck', 'object']\n['base', 'restricted']",
          "['base', 'restricted', 'notional']\n['FxChecks', 'RestrictedList', 'FatFinger', 'NotionalLimit', 'RiskCheck', 'object']\n['fat-finger', 'restricted']",
          "['base', 'restricted', 'notional']\n['FxChecks', 'RestrictedList', 'FatFinger', 'NotionalLimit', 'RiskCheck', 'object']\nValueError: notional",
        ],
        hints: [
          '`super()` means "the next class in the MRO of the **instance\'s** class", not "my parent".',
          'Each `run` calls `super().run` *first* and appends *after* it returns.',
          'What does `FatFinger.run` do instead of calling `super()`?',
        ],
        explanation:
          'C3 linearisation keeps each class before its bases and preserves the left-to-right order of the bases, and every class appears once: `EquityChecks → NotionalLimit → RestrictedList → RiskCheck → object`.\n\nFor `EquityChecks`, `NotionalLimit.run` calls `super()` → `RestrictedList.run` → `super()` → `RiskCheck.run` returns `["base"]`. Appends happen as the calls return: `restricted`, then `notional`.\n\nFor `FxChecks` the MRO is `RestrictedList → FatFinger → NotionalLimit → RiskCheck`. `FatFinger.run` does not call `super()`; it returns a fresh list, so the chain stops there. `NotionalLimit` never runs and the 5m-notional order passes with `[\'fat-finger\', \'restricted\']`.',
        timeLimitSec: 360,
        focusFile: 'risk/checks.py',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace EquityChecks().run',
        prompt: 'Order what happens when `EquityChecks().run(order)` is called for the AAPL order.',
        items: [
          'Lookup finds `run` on `NotionalLimit` (first in the MRO after `EquityChecks`)',
          '`NotionalLimit.run` calls `super().run`, which resolves to `RestrictedList.run`',
          '`RestrictedList.run` calls `super().run`, which resolves to `RiskCheck.run`',
          '`RiskCheck.run` returns `["base"]`',
          '`RestrictedList` checks the symbol and appends `"restricted"`',
          '`NotionalLimit` checks qty × px and appends `"notional"`',
        ],
        hints: ['`NotionalLimit` has no direct relationship to `RestrictedList`; the MRO links them.'],
        explanation:
          '`super()` inside `NotionalLimit` looks at the MRO of `type(self)` (`EquityChecks`) and continues *after* `NotionalLimit`, which is `RestrictedList`, a sibling, not a parent. That is what makes mixins composable. The work after each `super()` call happens on the way back out, in reverse order.',
        timeLimitSec: 240,
        focusFile: 'risk/checks.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make FatFinger cooperate',
        prompt:
          'Fix the checks so `FxChecks` runs **every** check in its MRO (an oversized-notional FX order must raise `ValueError("notional")`). Each check must still append its own name to the trail.',
        editable: ['risk/checks.py'],
        tests: [
          {
            path: 'tests/test_checks.py',
            content: `from risk.checks import EquityChecks, FxChecks

def test_fx_notional_enforced():
    try:
        FxChecks().run({"symbol": "EURUSD", "qty": 5_000, "px": 1_000.0})
        assert False, "expected ValueError('notional')"
    except ValueError as e:
        assert str(e) == "notional"

def test_fx_trail_has_every_check():
    trail = FxChecks().run({"symbol": "EURUSD", "qty": 100, "px": 1.1})
    assert trail == ["base", "notional", "fat-finger", "restricted"]

def test_fat_finger_still_enforced():
    try:
        FxChecks().run({"symbol": "EURUSD", "qty": 50_000, "px": 0.01})
        assert False, "expected ValueError('fat-finger')"
    except ValueError as e:
        assert str(e) == "fat-finger"

def test_equity_unchanged():
    trail = EquityChecks().run({"symbol": "AAPL", "qty": 100, "px": 150.0})
    assert trail == ["base", "restricted", "notional"]
`,
          },
        ],
        solution: {
          'risk/checks.py': `class RiskCheck:
    """Base of the chain. Each check returns the audit trail of checks that ran."""

    def run(self, order):
        return ["base"]


class NotionalLimit(RiskCheck):
    max_notional = 1_000_000

    def run(self, order):
        trail = super().run(order)
        if order["qty"] * order["px"] > self.max_notional:
            raise ValueError("notional")
        trail.append("notional")
        return trail


class RestrictedList(RiskCheck):
    restricted = {"XYZ"}

    def run(self, order):
        trail = super().run(order)
        if order["symbol"] in self.restricted:
            raise ValueError("restricted")
        trail.append("restricted")
        return trail


class FatFinger(RiskCheck):
    max_qty = 10_000

    def run(self, order):
        trail = super().run(order)
        if order["qty"] > self.max_qty:
            raise ValueError("fat-finger")
        trail.append("fat-finger")
        return trail


class EquityChecks(NotionalLimit, RestrictedList):
    pass


class FxChecks(RestrictedList, FatFinger, NotionalLimit):
    pass
`,
        },
        hints: [
          'Make `FatFinger.run` follow the same pattern as the other two checks.',
          'With the fix, the trail order is the reverse of the MRO (base first).',
        ],
        explanation:
          'In a cooperative hierarchy **every** override must call `super()`, because a class cannot know who comes after it in some subclass\'s MRO. `FatFinger` assumed its next class was `RiskCheck`; in `FxChecks` it is `NotionalLimit`. Calling `super().run(order)` and appending restores the chain: `base → notional → fat-finger → restricted`.',
        timeLimitSec: 420,
        focusFile: 'risk/checks.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 3
  {
    id: 'l2-b-py-fx-decimal',
    title: 'Half a Cent Matters',
    level: 2,
    rating: 1300,
    lang: 'python',
    domain: 'fx',
    companies: ['jpmorgan', 'stripe', 'blackrock', 'amazon'],
    tags: ['decimal', 'floating-point', 'rounding', 'money'],
    summary: 'The client agreement says round half up. float and round() disagree.',
    context:
      'A corporate client\'s agreement says FX conversions are rounded to the cent, **half up**. They have filed a complaint with a list of conversions that came out one cent short.',
    files: [
      {
        path: 'fx/convert.py',
        content: `from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def convert(amount, rate):
    """Convert amount at rate, rounded to cents, half up (per client agreement).

    amount and rate arrive as decimal strings from the order ticket,
    e.g. convert("1234.50", "1.0835"). Returns a Decimal.
    """
    return round(float(amount) * float(rate), 2)
`,
      },
      {
        path: 'main.py',
        content: `from decimal import Decimal
from fx.convert import convert

print(convert("2.675", "1"))
print(convert("1.005", "1"))
print(0.1 + 0.2 == 0.3, Decimal("0.1") + Decimal("0.2") == Decimal("0.3"))
print(Decimal("2.675").quantize(Decimal("0.01")), Decimal("2.665").quantize(Decimal("0.01")))
print(sum([Decimal("0.10")] * 3))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the conversions',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer: '2.67\n1.0\nFalse True\n2.68 2.66\n0.30',
        options: [
          '2.68\n1.01\nFalse True\n2.68 2.67\n0.3',
          '2.67\n1.0\nFalse True\n2.68 2.66\n0.30',
          '2.67\n1.0\nFalse False\n2.68 2.67\n0.30',
          '2.68\n1.0\nTrue True\n2.67 2.66\n0.30',
        ],
        hints: [
          '`float("2.675")` is actually 2.67499999999999982236431605997495353221893310546875.',
          'Python\'s `round` returns a float and prints the shortest repr: `1.0`, not `1.00`.',
          '`Decimal.quantize` defaults to `ROUND_HALF_EVEN` (banker\'s rounding).',
        ],
        explanation:
          '`round(2.675, 2)` rounds the *binary* value, which is just below 2.675, so it gives 2.67. Same for 1.005 → `1.0` (a float, so trailing zeros vanish).\n\n`0.1 + 0.2` is `0.30000000000000004` in binary floating point; Decimals built from strings are exact.\n\n`quantize` with no rounding argument uses the context default, `ROUND_HALF_EVEN`: 2.675 → 2.68 (8 is even), 2.665 → 2.66 (6 is even). That is *not* half up, so even the Decimal code needs an explicit `rounding=ROUND_HALF_UP`.\n\nDecimal addition keeps the exponent: `0.10 + 0.10 + 0.10 = 0.30`.',
        timeLimitSec: 300,
        focusFile: 'fx/convert.py',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Round like the contract says',
        prompt:
          'Fix `convert` so it does exact decimal arithmetic and rounds to cents **half up** (away from zero on a tie), returning a `Decimal` with exactly two decimal places.',
        editable: ['fx/convert.py'],
        tests: [
          {
            path: 'tests/test_convert.py',
            content: `from decimal import Decimal
from fx.convert import convert

def test_half_up_ties():
    assert convert("2.675", "1") == Decimal("2.68")
    assert convert("1.005", "1") == Decimal("1.01")
    assert convert("2.665", "1") == Decimal("2.67")

def test_negative_ties_round_away_from_zero():
    assert convert("-2.675", "1") == Decimal("-2.68")

def test_real_rate():
    assert convert("1234.50", "1.0835") == Decimal("1337.58")
    assert convert("100", "0.333335") == Decimal("33.33")

def test_returns_two_dp_decimal():
    r = convert("10", "1")
    assert isinstance(r, Decimal)
    assert str(r) == "10.00"
`,
          },
        ],
        solution: {
          'fx/convert.py': `from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def convert(amount, rate):
    """Convert amount at rate, rounded to cents, half up (per client agreement).

    amount and rate arrive as decimal strings from the order ticket,
    e.g. convert("1234.50", "1.0835"). Returns a Decimal.
    """
    return (Decimal(amount) * Decimal(rate)).quantize(CENT, rounding=ROUND_HALF_UP)
`,
        },
        hints: [
          'Build Decimals from the **strings**, never from floats.',
          '`Decimal.quantize(CENT, rounding=ROUND_HALF_UP)`.',
        ],
        explanation:
          'Constructing `Decimal("2.675")` keeps the exact decimal value the client typed. Multiplication is exact (Decimal has 28 significant digits by default), and `quantize(CENT, rounding=ROUND_HALF_UP)` applies the contractual rounding once, at the end. `ROUND_HALF_UP` in `decimal` means "ties away from zero", so -2.675 → -2.68. `Decimal(float(x))` would bring the binary error right back.',
        timeLimitSec: 360,
        focusFile: 'fx/convert.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 4
  {
    id: 'l2-b-py-tick-generators',
    title: 'VWAP of Nothing',
    level: 2,
    rating: 1400,
    lang: 'python',
    domain: 'market-data',
    companies: ['optiver', 'hrt', 'two-sigma', 'google'],
    tags: ['generators', 'iterators', 'laziness', 'exhaustion'],
    summary: 'A lazy tick pipeline returns a VWAP of 0.0. Generators only run once.',
    context:
      'The analytics service streams ticks through generator stages to keep memory flat. After the refactor, every VWAP on the dashboard reads `0.0`.',
    files: [
      {
        path: 'ticks/vwap.py',
        content: `def parse_ticks(lines):
    """Lazily parse 'SYM,PX,QTY' lines, skipping blanks and comments."""
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        sym, px, qty = line.split(",")
        yield sym, float(px), int(qty)


def for_symbol(ticks, symbol):
    return (t for t in ticks if t[0] == symbol)


def vwap(ticks):
    """Volume-weighted average price of an iterable of (sym, px, qty)."""
    notional = sum(px * qty for _, px, qty in ticks)
    volume = sum(qty for _, _, qty in ticks)
    return notional / volume if volume else 0.0
`,
      },
      {
        path: 'main.py',
        content: `from ticks.vwap import parse_ticks, for_symbol, vwap

FEED = ["# venue XLON", "VOD,100.0,300", "BP,450.5,100", "VOD,101.0,100", "", "VOD,99.0,600"]

ticks = parse_ticks(FEED)
print(type(ticks).__name__)
print(vwap(for_symbol(ticks, "VOD")))
print(vwap(for_symbol(ticks, "BP")))

cached = list(parse_ticks(FEED))
print(vwap(for_symbol(cached, "VOD")))
print(vwap([t for t in cached if t[0] == "VOD"]))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the dashboard',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer: 'generator\n0.0\n0.0\n0.0\n99.5',
        options: [
          'generator\n99.5\n450.5\n99.5\n99.5',
          'generator\n0.0\n450.5\n99.5\n99.5',
          'generator\n0.0\n0.0\n0.0\n99.5',
          'list\n99.5\n0.0\n99.5\n99.5',
        ],
        hints: [
          '`vwap` iterates `ticks` twice. What does a generator yield the second time you iterate it?',
          'After the first `vwap` call, how much of `ticks` (the parse generator) is left for the BP call?',
          '`for_symbol(cached, ...)` is called on a list, but what does `for_symbol` *return*?',
        ],
        explanation:
          'A generator is a one-shot iterator. In `vwap`, the first `sum` consumes it; the second `sum` sees an empty iterator, so `volume` is 0 and the function returns `0.0`.\n\nThe BP call is doubly broken: the first VOD call already drained the underlying `parse_ticks` generator, so there are no ticks left at all.\n\nMaterialising the parse step (`cached = list(...)`) is not enough, because `for_symbol` still returns a **generator expression** over it. Only the list comprehension gives `vwap` something it can iterate twice: (100×300 + 101×100 + 99×600) / 1000 = 99500 / 1000 = **99.5**.',
        timeLimitSec: 300,
        focusFile: 'ticks/vwap.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'When does it blow up?',
        prompt:
          'Suppose `FEED` had a malformed last line `"BAD"`. With the original code, at which point is `ValueError` (from unpacking `line.split(",")`) raised for `vwap(for_symbol(parse_ticks(FEED), "VOD"))`?',
        options: [
          'When `parse_ticks(FEED)` is called',
          'When `for_symbol(...)` is called',
          'Inside `vwap`, when the first `sum` pulls the last line through the pipeline',
          'Never: generators swallow exceptions',
        ],
        correct: [2],
        hints: ['Calling a generator function runs **none** of its body.'],
        explanation:
          'Calling a generator function only creates the generator object; the body starts running on the first `next()`. `for_symbol` builds a generator expression (only its outermost iterable is evaluated eagerly, and that is the parse generator object itself). Parsing happens tick by tick as `sum` pulls values, so the error surfaces deep inside `vwap`, which can make stack traces surprising in lazy pipelines.',
        timeLimitSec: 150,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Single-pass VWAP',
        prompt:
          'Fix `vwap` so it works for **any** iterable, including one-shot generators, while still streaming (do not build a list of all ticks).',
        editable: ['ticks/vwap.py'],
        tests: [
          {
            path: 'tests/test_vwap.py',
            content: `from ticks.vwap import parse_ticks, for_symbol, vwap

FEED = ["# venue XLON", "VOD,100.0,300", "BP,450.5,100", "VOD,101.0,100", "", "VOD,99.0,600"]

def test_generator_input():
    assert abs(vwap(for_symbol(parse_ticks(FEED), "VOD")) - 99.5) < 1e-9

def test_list_input():
    ticks = list(parse_ticks(FEED))
    assert abs(vwap(ticks) - (30000 + 45050 + 10100 + 59400) / 1100) < 1e-9

def test_iterator_input():
    it = iter([("X", 10.0, 1), ("X", 20.0, 3)])
    assert abs(vwap(it) - 17.5) < 1e-9

def test_empty():
    assert vwap(iter([])) == 0.0
    assert vwap(for_symbol(parse_ticks(FEED), "NOPE")) == 0.0
`,
          },
        ],
        solution: {
          'ticks/vwap.py': `def parse_ticks(lines):
    """Lazily parse 'SYM,PX,QTY' lines, skipping blanks and comments."""
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        sym, px, qty = line.split(",")
        yield sym, float(px), int(qty)


def for_symbol(ticks, symbol):
    return (t for t in ticks if t[0] == symbol)


def vwap(ticks):
    """Volume-weighted average price of an iterable of (sym, px, qty)."""
    notional = 0.0
    volume = 0
    for _, px, qty in ticks:
        notional += px * qty
        volume += qty
    return notional / volume if volume else 0.0
`,
        },
        hints: ['Accumulate notional and volume in the same loop.'],
        explanation:
          'A single `for` loop that accumulates both running totals consumes the iterable exactly once, so it works for lists, iterators and generators alike, with O(1) memory. `list(ticks)` at the top would also pass the tests but defeats the point of a streaming pipeline. As a rule: a function that accepts "an iterable" should iterate it at most once unless it documents otherwise.',
        timeLimitSec: 300,
        focusFile: 'ticks/vwap.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 5
  {
    id: 'l2-b-py-blotter-sort-keys',
    title: 'Blotter Sort Order',
    level: 2,
    rating: 1250,
    lang: 'python',
    domain: 'trade-blotter',
    companies: ['goldman', 'atlassian', 'canva', 'jpmorgan'],
    tags: ['sorting', 'key-functions', 'tuples', 'reverse'],
    summary: 'Three sort criteria, two directions, one reverse=True too many.',
    context:
      'Traders want the blotter grouped by workflow (`NEW`, then `PARTIAL`, then `FILLED`), biggest tickets first within a group, and oldest first on ties. They say the screen is "upside down".',
    persona: 'api-dreamer',
    files: [
      {
        path: 'blotter/sort.py',
        content: `STATUS_RANK = {"NEW": 0, "PARTIAL": 1, "FILLED": 2}


def blotter_order(trades):
    """Display order for the trade blotter:

    1. by status workflow: NEW, then PARTIAL, then FILLED
    2. within a status, largest notional first
    3. ties broken by oldest timestamp first
    """
    return sorted(
        trades,
        key=lambda t: (STATUS_RANK[t["status"]], t["notional"], t["ts"]),
        reverse=True,
    )
`,
      },
      {
        path: 'main.py',
        content: `from blotter.sort import blotter_order

trades = [
    {"id": "T1", "status": "NEW", "notional": 5_000, "ts": 3},
    {"id": "T2", "status": "FILLED", "notional": 9_000, "ts": 1},
    {"id": "T3", "status": "NEW", "notional": 5_000, "ts": 1},
    {"id": "T4", "status": "PARTIAL", "notional": 7_000, "ts": 2},
    {"id": "T5", "status": "NEW", "notional": 12_000, "ts": 5},
]

print([t["id"] for t in blotter_order(trades)])
print(sorted(["ORD-10", "ORD-9", "ORD-100"]))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the screen',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer: "['T2', 'T4', 'T5', 'T1', 'T3']\n['ORD-10', 'ORD-100', 'ORD-9']",
        options: [
          "['T5', 'T3', 'T1', 'T4', 'T2']\n['ORD-9', 'ORD-10', 'ORD-100']",
          "['T2', 'T4', 'T5', 'T1', 'T3']\n['ORD-10', 'ORD-100', 'ORD-9']",
          "['T2', 'T4', 'T5', 'T3', 'T1']\n['ORD-10', 'ORD-100', 'ORD-9']",
          "['T5', 'T1', 'T3', 'T4', 'T2']\n['ORD-10', 'ORD-9', 'ORD-100']",
        ],
        hints: [
          'Tuples compare element by element. `reverse=True` reverses the **whole** comparison, not just one element.',
          'Strings compare character by character: is `"1"` less than `"9"`?',
        ],
        explanation:
          'With `reverse=True`, every component of the key is descending: status rank descending (FILLED first), notional descending, and timestamp descending (T1 at ts=3 before T3 at ts=1). Result: `T2, T4, T5, T1, T3`, the "upside down" screen.\n\nString sorting is lexicographic: `"ORD-10"` vs `"ORD-9"` is decided at `"1"` < `"9"`, and `"ORD-10"` is a prefix of `"ORD-100"`, so it comes first. Numeric ids need a numeric key, e.g. `key=lambda s: int(s.split("-")[1])`.',
        timeLimitSec: 240,
        focusFile: 'blotter/sort.py',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'The assistant\'s one-liner',
        prompt: 'The assistant proposes this fix. Would you accept it?',
        persona: 'api-dreamer',
        request: 'Make blotter_order sort status asc, notional desc, ts asc.',
        aiReply: `Python 3.11+ supports per-key directions, so this is a one-liner:

\`\`\`python
return sorted(
    trades,
    key=lambda t: (STATUS_RANK[t["status"]], t["notional"], t["ts"]),
    reverse=(False, True, False),
)
\`\`\``,
        options: [
          'Accept: per-component `reverse` was added in Python 3.11',
          'Reject: `reverse` is a single bool; a tuple is just truthy, so this sorts everything descending (the same bug). Negate the numeric field instead: `(rank, -notional, ts)`',
          'Reject: `sorted` does not accept a `key` and `reverse` together',
          'Reject: lambdas cannot return tuples',
        ],
        correct: 1,
        hints: ['Check the `sorted` signature: `sorted(iterable, /, *, key=None, reverse=False)`.'],
        explanation:
          'There is no per-component `reverse` in any Python version. `reverse` is interpreted as a boolean flag, and a non-empty tuple is truthy, so the result is identical to `reverse=True`. The idiomatic fix is to negate numeric components you want descending. For non-numeric fields, sort in multiple stable passes (least significant key first) or use `functools.cmp_to_key`.',
        timeLimitSec: 150,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the blotter order',
        prompt: 'Make `blotter_order` follow its docstring.',
        editable: ['blotter/sort.py'],
        tests: [
          {
            path: 'tests/test_sort.py',
            content: `from blotter.sort import blotter_order

def ids(trades):
    return [t["id"] for t in blotter_order(trades)]

def test_full_order():
    trades = [
        {"id": "T1", "status": "NEW", "notional": 5_000, "ts": 3},
        {"id": "T2", "status": "FILLED", "notional": 9_000, "ts": 1},
        {"id": "T3", "status": "NEW", "notional": 5_000, "ts": 1},
        {"id": "T4", "status": "PARTIAL", "notional": 7_000, "ts": 2},
        {"id": "T5", "status": "NEW", "notional": 12_000, "ts": 5},
    ]
    assert ids(trades) == ["T5", "T3", "T1", "T4", "T2"]

def test_fractional_notional():
    trades = [
        {"id": "A", "status": "FILLED", "notional": 10.5, "ts": 9},
        {"id": "B", "status": "FILLED", "notional": 10.75, "ts": 1},
        {"id": "C", "status": "NEW", "notional": 0.5, "ts": 4},
    ]
    assert ids(trades) == ["C", "B", "A"]

def test_input_not_mutated():
    trades = [
        {"id": "X", "status": "FILLED", "notional": 1, "ts": 1},
        {"id": "Y", "status": "NEW", "notional": 1, "ts": 1},
    ]
    blotter_order(trades)
    assert [t["id"] for t in trades] == ["X", "Y"]
`,
          },
        ],
        solution: {
          'blotter/sort.py': `STATUS_RANK = {"NEW": 0, "PARTIAL": 1, "FILLED": 2}


def blotter_order(trades):
    """Display order for the trade blotter:

    1. by status workflow: NEW, then PARTIAL, then FILLED
    2. within a status, largest notional first
    3. ties broken by oldest timestamp first
    """
    return sorted(
        trades,
        key=lambda t: (STATUS_RANK[t["status"]], -t["notional"], t["ts"]),
    )
`,
        },
        hints: ['Only one component should be descending. Which one is numeric?'],
        explanation:
          'Drop `reverse=True` and negate the one component that should be descending: `(rank, -notional, ts)`. Ascending rank and ascending timestamp come for free. `sorted` returns a new list, so the caller\'s list is untouched (`list.sort()` would mutate it).',
        timeLimitSec: 300,
        focusFile: 'blotter/sort.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 6
  {
    id: 'l2-b-py-position-defaultdict',
    title: 'Phantom Accounts',
    level: 2,
    rating: 1200,
    lang: 'python',
    domain: 'risk',
    companies: ['blackrock', 'amazon', 'meta', 'citadel'],
    tags: ['defaultdict', 'side-effects', 'dictionaries'],
    summary: 'A read-only query creates accounts. defaultdict strikes again.',
    context:
      'Compliance runs a nightly report of every account with activity. It keeps listing accounts like `ACC-9` that have never traded; they were only looked up by the client portal.',
    files: [
      {
        path: 'positions/book.py',
        content: `from collections import defaultdict


class PositionBook:
    def __init__(self):
        self.qty = defaultdict(int)      # (account, symbol) -> net quantity
        self.fills = defaultdict(list)   # account -> [(symbol, qty), ...]

    def on_fill(self, account, symbol, qty):
        self.qty[(account, symbol)] += qty
        self.fills[account].append((symbol, qty))

    def position(self, account, symbol):
        return self.qty[(account, symbol)]

    def fill_count(self, account):
        return len(self.fills[account])

    def accounts(self):
        """Accounts with at least one fill."""
        return sorted(self.fills)

    def open_positions(self):
        return sorted(k for k, v in self.qty.items() if v != 0)
`,
      },
      {
        path: 'main.py',
        content: `from positions.book import PositionBook

book = PositionBook()
book.on_fill("ACC-1", "AAPL", 100)
book.on_fill("ACC-1", "AAPL", -100)
book.on_fill("ACC-2", "MSFT", 50)

print(book.position("ACC-3", "TSLA"))
print(book.fill_count("ACC-9"))
print(book.accounts())
print(len(book.qty), book.open_positions())
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the report',
        prompt: 'Predict exactly what `main.py` prints.',
        entry: 'main.py',
        answer: "0\n0\n['ACC-1', 'ACC-2', 'ACC-9']\n3 [('ACC-2', 'MSFT')]",
        options: [
          "0\n0\n['ACC-1', 'ACC-2']\n2 [('ACC-2', 'MSFT')]",
          "0\n0\n['ACC-1', 'ACC-2', 'ACC-9']\n3 [('ACC-2', 'MSFT')]",
          "0\n0\n['ACC-1', 'ACC-2', 'ACC-3', 'ACC-9']\n3 [('ACC-1', 'AAPL'), ('ACC-2', 'MSFT')]",
          "KeyError: ('ACC-3', 'TSLA')",
        ],
        hints: [
          '`defaultdict.__getitem__` on a missing key calls the factory **and stores the result**.',
          'Which dict does `accounts()` read, and which lookups touched it?',
        ],
        explanation:
          '`self.qty[("ACC-3", "TSLA")]` inserts `0` under that key, and `self.fills["ACC-9"]` inserts an empty list. Neither raises. `accounts()` lists keys of `fills`, so the phantom `ACC-9` appears (but not `ACC-3`, which only touched `qty`). `qty` now has 3 keys. `open_positions` filters out zero quantities, so the flat ACC-1/AAPL and phantom ACC-3/TSLA are hidden.',
        timeLimitSec: 210,
        focusFile: 'positions/book.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Who created ACC-9?',
        prompt: 'Click the line that adds `ACC-9` to the compliance report, then choose the root cause.',
        file: 'positions/book.py',
        lines: [17],
        options: [
          'Indexing a `defaultdict` with a missing key inserts a default value, so a read-only query mutates state',
          '`len` on an empty list raises and the exception is swallowed',
          '`sorted(self.fills)` sorts the fills rather than the accounts',
          '`on_fill` appends to the wrong account',
        ],
        correct: 0,
        hints: ['`accounts()` returns the keys of `self.fills`. Which method touches `self.fills` with an unknown key?'],
        explanation:
          'Line 17 (`self.fills[account]`) inserts `account -> []`. Use `self.fills.get(account, ())` or `account in self.fills` for queries. The same pattern on line 14 pollutes `qty`. `sorted` over a dict iterates its keys, so `accounts()` itself is fine.',
        timeLimitSec: 120,
        focusFile: 'positions/book.py',
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Make queries side-effect free',
        prompt: '`position` and `fill_count` must never create entries. Keep `on_fill` behaviour unchanged.',
        editable: ['positions/book.py'],
        tests: [
          {
            path: 'tests/test_positions.py',
            content: `from positions.book import PositionBook

def make():
    b = PositionBook()
    b.on_fill("ACC-1", "AAPL", 100)
    b.on_fill("ACC-1", "AAPL", -30)
    b.on_fill("ACC-2", "MSFT", 50)
    return b

def test_values():
    b = make()
    assert b.position("ACC-1", "AAPL") == 70
    assert b.position("ACC-3", "TSLA") == 0
    assert b.fill_count("ACC-1") == 2
    assert b.fill_count("ACC-9") == 0

def test_queries_do_not_create_accounts():
    b = make()
    b.fill_count("ACC-9")
    b.position("ACC-3", "TSLA")
    assert b.accounts() == ["ACC-1", "ACC-2"]
    assert len(b.qty) == 2

def test_fills_still_accumulate():
    b = make()
    b.on_fill("ACC-3", "TSLA", 5)
    assert b.accounts() == ["ACC-1", "ACC-2", "ACC-3"]
    assert b.position("ACC-3", "TSLA") == 5
`,
          },
        ],
        solution: {
          'positions/book.py': `from collections import defaultdict


class PositionBook:
    def __init__(self):
        self.qty = defaultdict(int)      # (account, symbol) -> net quantity
        self.fills = defaultdict(list)   # account -> [(symbol, qty), ...]

    def on_fill(self, account, symbol, qty):
        self.qty[(account, symbol)] += qty
        self.fills[account].append((symbol, qty))

    def position(self, account, symbol):
        return self.qty.get((account, symbol), 0)

    def fill_count(self, account):
        return len(self.fills.get(account, ()))

    def accounts(self):
        """Accounts with at least one fill."""
        return sorted(self.fills)

    def open_positions(self):
        return sorted(k for k, v in self.qty.items() if v != 0)
`,
        },
        hints: ['`dict.get` never calls the `default_factory`.'],
        explanation:
          '`defaultdict` only applies its factory in `__getitem__` (via `__missing__`). `.get()`, `in` and `.keys()` behave like a plain dict. Use subscripting where you *want* to create (writes) and `.get` for reads. Alternatively keep plain dicts and use `setdefault` in `on_fill`.',
        timeLimitSec: 300,
        focusFile: 'positions/book.py',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Python 7
  {
    id: 'l2-b-py-settlement-dates',
    title: 'T+2 Over Christmas',
    level: 2,
    rating: 1350,
    lang: 'python',
    domain: 'settlement',
    companies: ['jpmorgan', 'goldman', 'blackrock', 'stripe'],
    tags: ['dates', 'business-days', 'off-by-one', 'loops'],
    summary: 'Add two days, then roll to a business day. That is not T+2.',
    context:
      'Trades settle **T+2 business days**. The settlements team says Friday trades are settling on Monday (one day early) and two trades around Christmas came out wrong too.',
    files: [
      {
        path: 'settlement/calendar.py',
        content: `from datetime import date, timedelta

HOLIDAYS = frozenset({
    date(2026, 12, 25),
    date(2026, 12, 28),   # Boxing Day (observed)
    date(2027, 1, 1),
})


def is_business_day(d, holidays=HOLIDAYS):
    return d.weekday() < 5 and d not in holidays


def add_business_days(start, n, holidays=HOLIDAYS):
    """Return the date that is n business days after start."""
    d = start + timedelta(days=n)
    while not is_business_day(d, holidays):
        d += timedelta(days=1)
    return d


def settlement_date(trade_date, cycle=2):
    return add_business_days(trade_date, cycle)
`,
      },
      {
        path: 'main.py',
        content: `from datetime import date
from settlement.calendar import settlement_date

for trade_date in [date(2026, 12, 17), date(2026, 12, 18), date(2026, 12, 24), date(2026, 12, 30)]:
    s = settlement_date(trade_date)
    print(trade_date.strftime("%a %d"), "->", s.strftime("%a %d"))
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the settlement dates',
        prompt:
          'Predict exactly what `main.py` prints. For reference: 17 Dec 2026 is a Thursday, and 2 Jan 2027 is a Saturday.',
        entry: 'main.py',
        answer: 'Thu 17 -> Mon 21\nFri 18 -> Mon 21\nThu 24 -> Tue 29\nWed 30 -> Mon 04',
        options: [
          'Thu 17 -> Mon 21\nFri 18 -> Tue 22\nThu 24 -> Wed 30\nWed 30 -> Mon 04',
          'Thu 17 -> Sat 19\nFri 18 -> Sun 20\nThu 24 -> Sat 26\nWed 30 -> Fri 01',
          'Thu 17 -> Mon 21\nFri 18 -> Mon 21\nThu 24 -> Tue 29\nWed 30 -> Mon 04',
          'Thu 17 -> Mon 21\nFri 18 -> Mon 21\nThu 24 -> Mon 28\nWed 30 -> Mon 04',
        ],
        hints: [
          'The code adds n **calendar** days first, then rolls forward to the next business day.',
          'Thu 24 + 2 = Sat 26. Then roll: 27 is Sunday, 28 is a holiday.',
        ],
        explanation:
          'Calendar arithmetic plus a single roll-forward only counts the final landing day; it ignores non-business days *in between*.\n\n- Thu 17 + 2 = Sat 19 → rolls to Mon 21. Correct by luck (Fri 18 is day 1, Mon 21 day 2).\n- Fri 18 + 2 = Sun 20 → Mon 21. Wrong: Mon 21 is only T+1; T+2 is **Tue 22**.\n- Thu 24 + 2 = Sat 26 → Sun 27 → Mon 28 (holiday) → Tue 29. Wrong: 25-28 are all non-business, so T+1 = Tue 29 and T+2 = **Wed 30**.\n- Wed 30 + 2 = Fri 1 Jan (holiday) → Sat → Sun → Mon 04. Correct: Thu 31 is T+1, Mon 4 is T+2.',
        timeLimitSec: 300,
        focusFile: 'settlement/calendar.py',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Count business days properly',
        prompt: 'Fix `add_business_days` so it advances exactly `n` **business** days (for `n >= 1`).',
        editable: ['settlement/calendar.py'],
        tests: [
          {
            path: 'tests/test_calendar.py',
            content: `from datetime import date
from settlement.calendar import add_business_days, settlement_date

def test_midweek():
    assert settlement_date(date(2026, 12, 15)) == date(2026, 12, 17)

def test_friday_skips_weekend():
    assert settlement_date(date(2026, 12, 18)) == date(2026, 12, 22)

def test_thursday():
    assert settlement_date(date(2026, 12, 17)) == date(2026, 12, 21)

def test_christmas_block():
    assert settlement_date(date(2026, 12, 24)) == date(2026, 12, 30)

def test_new_year():
    assert settlement_date(date(2026, 12, 30)) == date(2027, 1, 4)

def test_t_plus_one_and_custom_holidays():
    assert add_business_days(date(2026, 12, 18), 1) == date(2026, 12, 21)
    assert add_business_days(date(2026, 12, 14), 3, holidays=frozenset({date(2026, 12, 16)})) == date(2026, 12, 18)
`,
          },
        ],
        solution: {
          'settlement/calendar.py': `from datetime import date, timedelta

HOLIDAYS = frozenset({
    date(2026, 12, 25),
    date(2026, 12, 28),   # Boxing Day (observed)
    date(2027, 1, 1),
})


def is_business_day(d, holidays=HOLIDAYS):
    return d.weekday() < 5 and d not in holidays


def add_business_days(start, n, holidays=HOLIDAYS):
    """Return the date that is n business days after start."""
    d = start
    remaining = n
    while remaining > 0:
        d += timedelta(days=1)
        if is_business_day(d, holidays):
            remaining -= 1
    return d


def settlement_date(trade_date, cycle=2):
    return add_business_days(trade_date, cycle)
`,
        },
        hints: [
          'Step one calendar day at a time and only count the days that are business days.',
          'Stop when you have counted `n` of them.',
        ],
        explanation:
          'Walk forward day by day and decrement a counter only on business days. That naturally skips weekends and holidays *between* the trade date and the settlement date, not just at the end. It also respects a caller-supplied holiday calendar (the custom-holiday test). Real systems use per-currency/market calendars, and FX spot additionally requires both currencies\' calendars to be open.',
        timeLimitSec: 360,
        focusFile: 'settlement/calendar.py',
      },
    ],
  },
];

export default problems;
