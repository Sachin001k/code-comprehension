import type { Problem } from '../types';

/**
 * L5 Grandmaster set A (part 2): Python.
 * Descriptors & attribute lookup, cooperative super() in diamonds, the generator protocol + FIFO P&L,
 * asyncio scheduling/cancellation + lost updates, numerically stable rolling variance.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 7. Descriptors, __getattr__ and the swallowed AttributeError
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-py-descriptor-lookup',
    title: 'Attribute Lookup, All the Way Down',
    level: 5,
    rating: 2700,
    lang: 'python',
    domain: 'risk',
    companies: ['two-sigma', 'de-shaw', 'citadel', 'generic'],
    tags: ['descriptors', '__getattr__', '__getattribute__', 'property', 'data-model'],
    summary: 'Data vs non-data descriptors, instance dicts, and a property whose AttributeError gets silently "handled".',
    context:
      'The risk service models positions with a home-grown `Lazy` caching descriptor, a validating descriptor for quantities, and a `__getattr__` fallback for optional fields. A desk head says their risk numbers are **zero** for some books, and nothing errors.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'position.py',
        content: `class Lazy:
    """Non-data descriptor: caches into the instance __dict__."""
    def __init__(self, fn):
        self.fn = fn
        self.name = fn.__name__

    def __get__(self, obj, owner):
        if obj is None:
            return self
        print(f"  compute {self.name}")
        value = self.fn(obj)
        obj.__dict__[self.name] = value
        return value


class Validated:
    """Data descriptor: stores under a private name."""
    def __set_name__(self, owner, name):
        self.slot = "_" + name

    def __get__(self, obj, owner):
        if obj is None:
            return self
        return obj.__dict__[self.slot]

    def __set__(self, obj, value):
        if value <= 0:
            raise ValueError("must be positive")
        obj.__dict__[self.slot] = value


class Position:
    qty = Validated()

    def __init__(self, sym, qty, px):
        self.sym = sym
        self.qty = qty
        self.px = px

    @Lazy
    def notional(self):
        return self.qty * self.px

    @property
    def risk(self):
        return self.notional * self.vol

    DEFAULTS = {"risk": 0.0, "fee_bps": 1.5}

    def __getattr__(self, name):
        print(f"  __getattr__({name})")
        try:
            return self.DEFAULTS[name]
        except KeyError:
            raise AttributeError(name) from None


p = Position("AAPL", 10, 2.5)
print("1:", p.notional)
print("2:", p.notional)
p.qty = 20
print("3:", p.notional)
p.__dict__["qty"] = -5
print("4:", p.qty)
p.__dict__["notional"] = 99
del p.notional
print("5:", p.notional)
print("6:", p.risk)
print("7:", p.fee_bps)
print("8:", hasattr(p, "vol"))
try:
    p.qty = 0
except ValueError as e:
    print("9:", e)
print("10:", sorted(k for k in vars(p)))
`,
      },
      {
        path: 'limits.py',
        content: `from dataclasses import dataclass


@dataclass
class Desk:
    name: str
    limit_multiplier: float = 1.0


class RiskLimits:
    """Per-desk limits. Unknown limit names fall back to overrides, then firm defaults."""

    _DEFAULTS = {"max_notional": 1_000_000, "max_order_qty": 10_000, "kill_switch": False}

    def __init__(self, desk, overrides=None):
        self.desk = desk
        self._overrides = dict(overrides or {})

    def __getattr__(self, name):
        try:
            return self._overrides.get(name, self._DEFAULTS[name])
        except KeyError:
            raise AttributeError(name) from None

    @property
    def max_notional(self):
        base = self._overrides.get("max_notional", self._DEFAULTS["max_notional"])
        return base * self.desk.multiplier

    def allows(self, qty, px):
        if self.kill_switch:
            return False
        return qty <= self.max_order_qty and qty * px <= self.max_notional


limits = RiskLimits(Desk("vol-arb", limit_multiplier=0.25))
print(limits.max_notional)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Precedence rules',
        prompt: 'Predict the output of `position.py`. Lines starting with two spaces are printed from inside descriptors / `__getattr__`.',
        entry: 'position.py',
        answer:
          '  compute notional\n1: 25.0\n2: 25.0\n3: 25.0\n4: 20\n  compute notional\n5: 50.0\n  __getattr__(vol)\n  __getattr__(risk)\n6: 0.0\n  __getattr__(fee_bps)\n7: 1.5\n  __getattr__(vol)\n8: False\n9: must be positive\n10: [\'_qty\', \'notional\', \'px\', \'qty\', \'sym\']',
        options: [
          '  compute notional\n1: 25.0\n2: 25.0\n3: 25.0\n4: 20\n  compute notional\n5: 50.0\n  __getattr__(vol)\n  __getattr__(risk)\n6: 0.0\n  __getattr__(fee_bps)\n7: 1.5\n  __getattr__(vol)\n8: False\n9: must be positive\n10: [\'_qty\', \'notional\', \'px\', \'qty\', \'sym\']',
          '  compute notional\n1: 25.0\n2: 25.0\n  compute notional\n3: 50.0\n4: -5\n  compute notional\n5: 50.0\n  __getattr__(vol)\n6: 0.0\n  __getattr__(fee_bps)\n7: 1.5\n  __getattr__(vol)\n8: False\n9: must be positive\n10: [\'_qty\', \'notional\', \'px\', \'qty\', \'sym\']',
          '  compute notional\n1: 25.0\n  compute notional\n2: 25.0\n  compute notional\n3: 50.0\n4: 20\n5: 99\n  __getattr__(vol)\n6: 0.0\n  __getattr__(fee_bps)\n7: 1.5\n8: False\n9: must be positive\n10: [\'_qty\', \'notional\', \'px\', \'sym\']',
          '  compute notional\n1: 25.0\n2: 25.0\n3: 25.0\n4: 20\n  compute notional\n5: 50.0\n  __getattr__(vol)\n6: 0.0\n  __getattr__(fee_bps)\n7: 1.5\n  __getattr__(vol)\n8: False\n9: must be positive\n10: [\'_qty\', \'notional\', \'px\', \'qty\', \'sym\']',
        ],
        hints: [
          '`object.__getattribute__` order: **data** descriptor on the type → instance `__dict__` → non-data descriptor / class attribute. `__getattr__` only runs if that whole lookup raises `AttributeError`.',
          '`Lazy` has no `__set__`, so once it writes `obj.__dict__["notional"]`, the instance dict shadows it.',
          'A `property` getter that raises `AttributeError` *internally* looks, to the lookup machinery, exactly like "attribute `risk` not found".',
        ],
        explanation: `**1-3.** \`Lazy\` defines only \`__get__\`, so it is a *non-data* descriptor and ranks below the instance \`__dict__\`. The first read computes and stores \`notional\`; later reads hit the instance dict directly, even after \`qty\` changes. That is why 3 is still 25.0 (a stale cache, by design of the descriptor).

**4.** \`Validated\` defines \`__set__\`, so it is a *data* descriptor and wins over the instance dict. \`p.__dict__["qty"] = -5\` creates a shadow entry that is never consulted. \`p.qty\` returns \`__dict__["_qty"]\` = 20.

**5.** \`del p.notional\`: no data descriptor with \`__delete__\` exists, so the instance-dict entry (99) is removed. The next read falls through to \`Lazy\` again and recomputes 20 × 2.5 = 50.0.

**6.** \`risk\` is a property (data descriptor). Its getter reads \`self.vol\`, which is missing, so \`__getattr__("vol")\` runs and raises \`AttributeError\`. That exception propagates **out of the property getter**, and CPython's attribute slot then treats the whole \`p.risk\` lookup as failed and calls \`__getattr__("risk")\`, which happily returns the default 0.0. The real bug (no \`vol\`) is masked.

**7-8.** \`fee_bps\` resolves through the fallback. \`hasattr\` calls \`getattr\` and returns False on \`AttributeError\`, so the trace line is still printed.

**9-10.** The setter validates. \`vars(p)\` contains \`sym\`, \`_qty\`, \`px\`, the recomputed \`notional\` and the useless shadow \`qty\`.`,
        timeLimitSec: 900,
        focusFile: 'position.py',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The limit that silently quadrupled',
        prompt:
          '`limits.py` prints `1000000` for the vol-arb desk, whose multiplier is 0.25. No exception is raised anywhere. Click the line where the real error originates and choose the root cause.',
        file: 'limits.py',
        lines: [28],
        options: [
          '`self.desk.multiplier` raises `AttributeError` (the field is `limit_multiplier`); because it escapes a property on a class with `__getattr__`, Python retries the lookup as `__getattr__("max_notional")`, which returns the un-multiplied default',
          '`_DEFAULTS` is a class attribute, so it is shared across desks and overwritten by another instance',
          '`dict(overrides or {})` copies the overrides, so the desk multiplier is lost',
          '`@property` methods cannot read instance attributes inside `__getattr__` classes',
        ],
        correct: 0,
        hints: ['What happens if a property getter raises `AttributeError` on a class that defines `__getattr__`?'],
        explanation:
          'Line 28 raises `AttributeError: \'Desk\' object has no attribute \'multiplier\'`. Any `AttributeError` escaping `type(obj).__getattribute__` triggers `__getattr__(name)` with the **outer** name, so the fallback looks up `max_notional` in overrides/defaults and returns 1,000,000. The typo becomes a 4× limit breach instead of a crash. Defences: make `__getattr__` refuse names that are defined as properties on the class, re-raise inside properties as a different exception type, or avoid catch-all `__getattr__` on objects with computed attributes.',
        timeLimitSec: 420,
        focusFile: 'limits.py',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: '"Just use __getattribute__"',
        prompt: 'The assistant proposes a fix so overrides always win and properties are no longer masked. Review it.',
        persona: 'api-dreamer',
        request: 'Make RiskLimits overrides take precedence, and stop __getattr__ from hiding property errors.',
        aiReply: `\`__getattr__\` only runs on *failure*, which is why it masks errors. Use \`__getattribute__\`, which runs first for every attribute, and check overrides there:

\`\`\`python
class RiskLimits:
    def __getattribute__(self, name):
        try:
            return self._overrides[name]
        except KeyError:
            return object.__getattribute__(self, name)
\`\`\`

Properties are now only reached via \`object.__getattribute__\`, so their errors propagate normally. 🚀`,
        options: [
          'Accept: `__getattribute__` runs before descriptors, so overrides win and property errors propagate',
          'Reject: `self._overrides` inside `__getattribute__` calls `__getattribute__("_overrides")` again, which recurses without bound (RecursionError on the first attribute access); it must use `object.__getattribute__(self, "_overrides")`',
          'Reject: `__getattribute__` is only consulted for names not found in the instance dict',
          'Reject: `object.__getattribute__` cannot be called with a subclass instance',
        ],
        correct: 1,
        hints: ['How does the body of `__getattribute__` get hold of `self._overrides`?'],
        explanation:
          '`__getattribute__` intercepts **every** attribute access on the instance, including the ones made inside it. `self._overrides` re-enters `__getattribute__("_overrides")`, which reads `self._overrides` again, and so on until RecursionError. Even `__init__`\'s assignments are fine (they use `__setattr__`), but the first read explodes. The idiom is `object.__getattribute__(self, "_overrides")`. Separately, mixing `KeyError` handling with `__getattr__` still in the class means a property `AttributeError` would still fall back to `__getattr__`. The option-3 claim describes `__getattr__`, not `__getattribute__`.',
        timeLimitSec: 360,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 8. Cooperative super() in a diamond of risk checks
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-py-mro-risk-chain',
    title: 'The Risk Chain That Skips Itself',
    level: 5,
    rating: 2550,
    lang: 'python',
    domain: 'risk',
    companies: ['jane-street', 'de-shaw', 'goldman'],
    tags: ['mro', 'c3-linearization', 'super', 'mixins', 'multiple-inheritance'],
    summary: 'Pre-trade checks composed with mixins and cooperative `super()`. Base order changes which checks run at all.',
    context:
      'Pre-trade risk checks are mixins combined per desk. Equities claims its notional check "sometimes doesn\'t log", and somebody wants to hard-code the parent calls.',
    persona: 'confident-intern',
    files: [
      {
        path: 'checks.py',
        content: `class Check:
    def __init__(self, **kw):
        print(f"Check.__init__ leftover={sorted(kw)}")
        super().__init__()

    def run(self, order):
        return []


class NotionalCheck(Check):
    def __init__(self, max_notional, **kw):
        self.max_notional = max_notional
        super().__init__(**kw)

    def run(self, order):
        errs = super().run(order)
        if order["qty"] * order["px"] > self.max_notional:
            errs.append("notional")
        return errs


class FatFinger(Check):
    def __init__(self, max_qty, **kw):
        self.max_qty = max_qty
        super().__init__(**kw)

    def run(self, order):
        if order["qty"] > self.max_qty:
            return ["fat-finger"]
        return super().run(order)


class Logged(Check):
    def run(self, order):
        errs = super().run(order)
        print(f"  {type(self).__name__} via {__class__.__name__}: {errs}")
        return errs


class DeskRisk(Logged, NotionalCheck, FatFinger):
    pass


class EquityRisk(FatFinger, Logged, NotionalCheck):
    pass


print([c.__name__ for c in DeskRisk.__mro__])
d = DeskRisk(max_notional=1000, max_qty=50, venue="XNAS")
print("A", d.run({"qty": 100, "px": 20}))
e = EquityRisk(max_qty=50, max_notional=1000)
print("B", e.run({"qty": 100, "px": 20}))
print("C", e.run({"qty": 10, "px": 200}))
try:
    class Broken(Check, NotionalCheck):
        pass
except TypeError as ex:
    print("D", type(ex).__name__)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Follow the MRO',
        prompt: 'Predict the output of `checks.py`.',
        answer:
          "['DeskRisk', 'Logged', 'NotionalCheck', 'FatFinger', 'Check', 'object']\nCheck.__init__ leftover=['venue']\n  DeskRisk via Logged: ['fat-finger', 'notional']\nA ['fat-finger', 'notional']\nCheck.__init__ leftover=[]\nB ['fat-finger']\n  EquityRisk via Logged: ['notional']\nC ['notional']\nD TypeError",
        options: [
          "['DeskRisk', 'Logged', 'NotionalCheck', 'FatFinger', 'Check', 'object']\nCheck.__init__ leftover=['venue']\n  DeskRisk via Logged: ['fat-finger', 'notional']\nA ['fat-finger', 'notional']\nCheck.__init__ leftover=[]\nB ['fat-finger']\n  EquityRisk via Logged: ['notional']\nC ['notional']\nD TypeError",
          "['DeskRisk', 'Logged', 'Check', 'NotionalCheck', 'FatFinger', 'object']\nCheck.__init__ leftover=['venue']\n  DeskRisk via Logged: ['notional']\nA ['notional']\nCheck.__init__ leftover=[]\nB ['fat-finger']\n  EquityRisk via Logged: ['notional']\nC ['notional']\nD TypeError",
          "['DeskRisk', 'Logged', 'NotionalCheck', 'FatFinger', 'Check', 'object']\nCheck.__init__ leftover=['venue']\n  DeskRisk via Logged: ['fat-finger', 'notional']\nA ['fat-finger', 'notional']\nCheck.__init__ leftover=[]\n  EquityRisk via FatFinger: ['fat-finger']\nB ['fat-finger']\n  EquityRisk via Logged: ['notional']\nC ['notional']\nD TypeError",
          "['DeskRisk', 'Logged', 'NotionalCheck', 'FatFinger', 'Check', 'object']\nCheck.__init__ leftover=['max_qty', 'venue']\n  DeskRisk via Logged: ['notional', 'fat-finger']\nA ['notional', 'fat-finger']\nCheck.__init__ leftover=[]\nB ['fat-finger', 'notional']\n  EquityRisk via Logged: ['notional']\nC ['notional']\nD ['Broken', 'Check', 'NotionalCheck', 'object']",
        ],
        hints: [
          'C3: a class precedes its bases, and the local base order is preserved. `Check` must come after all three mixins.',
          '`super()` means "the next class after *the class where this method is defined*, in `type(self).__mro__`", not "my base class".',
          '`FatFinger.run` short-circuits: it returns without calling `super()` when the quantity is too large. In `EquityRisk`, who is *behind* FatFinger?',
        ],
        explanation: `**MRO.** C3 linearisation of \`DeskRisk(Logged, NotionalCheck, FatFinger)\` = DeskRisk + merge([Logged, Check, object], [NotionalCheck, Check, object], [FatFinger, Check, object], [Logged, NotionalCheck, FatFinger]) = DeskRisk, Logged, NotionalCheck, FatFinger, Check, object.

**Construction.** \`__init__\` chains cooperatively: \`Logged\` has none, so NotionalCheck's runs, consumes \`max_notional\`, and its \`super()\` is **FatFinger** (next in DeskRisk's MRO, although NotionalCheck does not inherit from it). FatFinger consumes \`max_qty\`, and Check sees only \`venue\`, then calls \`object.__init__()\` with no arguments.

**A.** Logged.run → super → NotionalCheck.run → super → FatFinger.run: qty 100 > 50, so it returns \`['fat-finger']\` immediately (Check.run is skipped). NotionalCheck appends \`notional\` (2000 > 1000). Logged prints. \`__class__\` is the zero-arg-super cell, always the *defining* class (Logged), while \`type(self)\` is DeskRisk.

**B.** EquityRisk MRO = EquityRisk, FatFinger, Logged, NotionalCheck, Check. FatFinger is first and short-circuits, so **neither Logged nor NotionalCheck runs**: no log line, and the notional breach is not even reported. That is the "sometimes doesn't log" bug.

**C.** qty 10 passes FatFinger, so Logged → NotionalCheck → Check run; 10 × 200 = 2000 > 1000.

**D.** \`class Broken(Check, NotionalCheck)\` asks for Check before NotionalCheck, but NotionalCheck's own linearisation requires NotionalCheck before Check. No consistent order exists, so C3 fails with \`TypeError: Cannot create a consistent method resolution order\`.`,
        timeLimitSec: 720,
        focusFile: 'checks.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Cooperative inheritance facts',
        prompt: 'Select **all** true statements.',
        options: [
          'When `d.run(...)` executes `NotionalCheck.run`, its `super().run` dispatches to `FatFinger.run`',
          'If `Check.__init__` forwarded `**kw` to `super().__init__(**kw)`, constructing `DeskRisk(..., venue="XNAS")` would raise `TypeError` from `object.__init__`',
          'Swapping `EquityRisk`\'s bases to `(Logged, NotionalCheck, FatFinger)` makes every check and the log line run for every order',
          '`__class__` inside `Logged.run` evaluates to `type(self)`',
          'A short-circuiting `return` without `super()` in one mixin can hide every mixin that comes *after* it in the MRO',
        ],
        correct: [0, 1, 2, 4],
        hints: ['`object.__init__` rejects extra arguments when `__init__` is overridden.', 'With FatFinger last before Check, what does its short-circuit skip?'],
        explanation:
          '1: `super()` follows `type(self).__mro__`. 2: `object.__init__` raises "takes exactly one argument" when given extra args and the type overrides `__init__`. That is why the root of a cooperative chain must swallow leftover kwargs (or fail loudly on purpose). 3: with FatFinger last before Check, its short-circuit only skips `Check.run` (which returns `[]`), so Logged and NotionalCheck always run, which is the DeskRisk arrangement. 4: `__class__` is the lexically enclosing class (Logged). 5: exactly what happened in EquityRisk.',
        timeLimitSec: 420,
        focusFile: 'checks.py',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Hard-code the parents?',
        prompt: 'An assistant suggests making the composition "explicit" so no check is ever skipped. Review it for `DeskRisk`.',
        persona: 'confident-intern',
        request: 'super() is too magic. Make DeskRisk run both checks explicitly.',
        aiReply: `Explicit is better than implicit! Call each parent directly and combine:

\`\`\`python
class DeskRisk(Logged, NotionalCheck, FatFinger):
    def run(self, order):
        return NotionalCheck.run(self, order) + FatFinger.run(self, order)
\`\`\`

Now both checks always run, independent of MRO order. ✅`,
        options: [
          'Accept: explicit calls remove the MRO dependency',
          'Reject: `NotionalCheck.run` still calls `super().run`, which (for a DeskRisk instance) dispatches to `FatFinger.run`. FatFinger runs twice (an order of qty 100, px 20 yields `[\'fat-finger\', \'notional\', \'fat-finger\']`), and `Logged.run` is bypassed entirely',
          'Reject: calling an unbound method with `self` raises TypeError in Python 3',
          'Reject: `+` on two lists mutates the first one in place',
        ],
        correct: 1,
        hints: ['Explicitly naming the first method does not change what `super()` *inside* it resolves to.'],
        explanation:
          'Mixing explicit parent calls with cooperative `super()` is the classic diamond bug. `super()` inside `NotionalCheck.run` still means "next after NotionalCheck in `type(self).__mro__`", which is FatFinger for a DeskRisk. So the explicit call already ran FatFinger, and the second explicit call runs it again: duplicated errors, and any side effects (counters, alerts) fire twice. `DeskRisk.run` no longer goes through `Logged`, so logging silently disappears. Either be fully cooperative (fix the short-circuit by always calling `super()` and merging) or fully explicit (no `super()` anywhere).',
        timeLimitSec: 360,
        focusFile: 'checks.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 9. Generator protocol + FIFO P&L
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-py-generator-fifo-pnl',
    title: 'Send, Throw, Close: The Fill Coroutine',
    level: 5,
    rating: 2750,
    lang: 'python',
    domain: 'pnl',
    companies: ['optiver', 'jane-street', 'citadel', 'blackrock'],
    tags: ['generators', 'send', 'close', 'GeneratorExit', 'yield-from', 'fifo', 'pnl'],
    summary: 'Drive a VWAP coroutine through `send`/`throw`/`close`, then fix FIFO realised P&L across position flips.',
    context:
      'The post-trade service consumes fills with generator-based coroutines (legacy, pre-asyncio). Realised P&L uses FIFO lot matching, and the desk says P&L is wrong whenever a book goes from long to short in one fill.',
    persona: 'lazy-copier',
    files: [
      {
        path: 'coro.py',
        content: `def vwap_tracker(sym):
    notional = qty = 0
    print(f"open {sym}")
    try:
        while True:
            try:
                fill = yield (notional / qty if qty else None)
            except ValueError as e:
                print(f"rejected: {e}")
                continue
            if fill is None:
                continue
            q, px = fill
            notional += q * px
            qty += q
    except GeneratorExit:
        print(f"close {sym} qty={qty}")
        raise
    finally:
        print(f"finally {sym}")


def session(sym):
    result = yield from vwap_tracker(sym)
    print("never reached", result)


g = vwap_tracker("AAPL")
try:
    g.send((10, 100))
except TypeError as e:
    print("E1", type(e).__name__)
print("A", next(g))
print("B", g.send((10, 100)))
print("C", g.send((30, 104)))
print("D", g.throw(ValueError("fat finger")))
print("E", g.send(None))
g.close()
g.close()
try:
    g.send((1, 1))
except StopIteration:
    print("F stopped")

s = session("MSFT")
next(s)
s.send((5, 10))
s.close()


def stubborn():
    try:
        yield 1
    finally:
        yield 2


st = stubborn()
next(st)
try:
    st.close()
except RuntimeError as e:
    print("G", e)
`,
      },
      {
        path: 'pnl/fifo.py',
        content: `from collections import deque


class FifoLedger:
    """FIFO lot matching for one instrument.

    fill(qty, px): qty > 0 is a buy, qty < 0 a sell; px is an integer price in ticks.
    Fills on the same side as the open position open new lots (appended at the back).
    Opposite-side fills close the OLDEST lots first; any remainder opens a new lot on the
    other side (the position flips). Realised P&L (in ticks * qty) is
      long lot closed:  (exit_px - entry_px) * closed_qty
      short lot closed: (entry_px - exit_px) * closed_qty
    fill() returns cumulative realised P&L.
    """

    def __init__(self):
        self.lots = deque()  # each lot: [signed_qty, entry_px]
        self.realized = 0

    @property
    def position(self):
        return sum(q for q, _ in self.lots)

    def open_lots(self):
        return [tuple(l) for l in self.lots]

    def fill(self, qty, px):
        while qty and self.lots:
            lot = self.lots[0]
            take = min(abs(qty), abs(lot[0]))
            self.realized += take * (px - lot[1])
            lot[0] -= take
            qty += take
            if lot[0] == 0:
                self.lots.popleft()
        if qty:
            self.lots.append([qty, px])
        return self.realized
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Drive the coroutine',
        prompt: 'Predict the output of `coro.py`.',
        entry: 'coro.py',
        answer:
          'E1 TypeError\nopen AAPL\nA None\nB 100.0\nC 103.0\nrejected: fat finger\nD 103.0\nE 103.0\nclose AAPL qty=40\nfinally AAPL\nF stopped\nopen MSFT\nclose MSFT qty=5\nfinally MSFT\nG generator ignored GeneratorExit',
        options: [
          'E1 TypeError\nopen AAPL\nA None\nB 100.0\nC 103.0\nrejected: fat finger\nD 103.0\nE 103.0\nclose AAPL qty=40\nfinally AAPL\nF stopped\nopen MSFT\nclose MSFT qty=5\nfinally MSFT\nG generator ignored GeneratorExit',
          'open AAPL\nE1 TypeError\nA None\nB 100.0\nC 103.0\nrejected: fat finger\nD 103.0\nE 103.0\nclose AAPL qty=40\nfinally AAPL\nclose AAPL qty=40\nfinally AAPL\nF stopped\nopen MSFT\nclose MSFT qty=5\nfinally MSFT\nG generator ignored GeneratorExit',
          'E1 TypeError\nopen AAPL\nA None\nB 100.0\nC 103.0\nrejected: fat finger\nD None\nE 103.0\nclose AAPL qty=40\nfinally AAPL\nF stopped\nopen MSFT\nfinally MSFT\nnever reached None',
          'E1 TypeError\nopen AAPL\nA None\nB 100.0\nC 103.0\nrejected: fat finger\nD 103.0\nE 103.0\nclose AAPL qty=40\nfinally AAPL\nF stopped\nopen MSFT\nclose MSFT qty=5\nfinally MSFT\nnever reached None\nG 2',
        ],
        hints: [
          'A just-created generator has not reached any `yield`, so there is nowhere to deliver a non-`None` value.',
          '`throw()` raises at the paused `yield`. If the generator handles it and reaches another `yield`, `throw()` *returns* that yielded value.',
          '`close()` throws `GeneratorExit` into the innermost delegate of a `yield from` chain. Yielding while handling `GeneratorExit` is an error.',
        ],
        explanation: `- **E1:** \`send(non-None)\` to a just-started generator raises \`TypeError\` ("can't send non-None value to a just-started generator") *before* running any code. The generator is still unstarted, so \`open AAPL\` appears only at \`next(g)\` (A: \`qty\` is 0, yields \`None\`).
- **B/C:** \`send\` resumes the paused \`yield\` expression with the value; the loop updates totals and yields VWAP: 1000/10 = 100.0, then (1000+3120)/40 = 103.0.
- **D:** \`throw(ValueError)\` raises at the \`yield\`; the inner \`except\` prints and \`continue\`s to the next \`yield\`, whose value (103.0) becomes the return value of \`throw()\`.
- **E:** \`send(None)\` is \`next()\`; \`fill is None\` → continue → yield 103.0.
- **close():** raises \`GeneratorExit\` at the \`yield\`. The outer \`except GeneratorExit\` prints and re-raises, \`finally\` prints, and \`close()\` treats the propagated \`GeneratorExit\` as success. A second \`close()\` on a finished generator is a no-op. \`send\` on a finished generator raises \`StopIteration\` (F).
- **yield from:** \`s.close()\` first closes the subgenerator (PEP 380: GeneratorExit is thrown into the delegate), so \`vwap_tracker\` prints close/finally. Then GeneratorExit is re-raised in \`session\` at the \`yield from\`, so \`never reached\` never prints.
- **G:** \`stubborn\`'s \`finally\` *yields* while GeneratorExit is in flight. \`close()\` sees a value yielded instead of the generator exiting and raises \`RuntimeError("generator ignored GeneratorExit")\`.`,
        timeLimitSec: 720,
        focusFile: 'coro.py',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix FIFO realised P&L',
        prompt:
          '`FifoLedger.fill` only works for a long book reduced by sells. Make it implement the doc comment exactly: same-side fills add lots, opposite-side fills close oldest lots first (with the correct P&L sign for short lots), and any remainder flips the position.',
        editable: ['pnl/fifo.py'],
        tests: [
          {
            path: 'tests/test_fifo.py',
            content: `from pnl.fifo import FifoLedger


def test_long_then_partial_close_across_lots():
    l = FifoLedger()
    assert l.fill(10, 100) == 0
    assert l.fill(5, 110) == 0
    assert l.open_lots() == [(10, 100), (5, 110)]
    assert l.fill(-12, 120) == 10 * 20 + 2 * 10
    assert l.open_lots() == [(3, 110)]
    assert l.position == 3


def test_flip_long_to_short_in_one_fill():
    l = FifoLedger()
    l.fill(4, 100)
    assert l.fill(-10, 90) == -40
    assert l.open_lots() == [(-6, 90)]
    assert l.position == -6


def test_short_cover_pnl_sign():
    l = FifoLedger()
    l.fill(-5, 200)
    l.fill(-5, 210)
    assert l.open_lots() == [(-5, 200), (-5, 210)]
    assert l.fill(7, 190) == 5 * 10 + 2 * 20
    assert l.open_lots() == [(-3, 210)]


def test_flip_short_to_long_and_back():
    l = FifoLedger()
    l.fill(-3, 115)
    assert l.fill(10, 100) == 45
    assert l.open_lots() == [(7, 100)]
    assert l.fill(-7, 101) == 52
    assert l.open_lots() == []
    assert l.position == 0


def test_adding_to_short_does_not_realise():
    l = FifoLedger()
    l.fill(-2, 50)
    assert l.fill(-3, 40) == 0
    assert l.open_lots() == [(-2, 50), (-3, 40)]


def test_zero_qty_is_noop():
    l = FifoLedger()
    l.fill(5, 10)
    assert l.fill(0, 99) == 0
    assert l.open_lots() == [(5, 10)]
`,
          },
        ],
        solution: {
          'pnl/fifo.py': `from collections import deque


class FifoLedger:
    """FIFO lot matching for one instrument.

    fill(qty, px): qty > 0 is a buy, qty < 0 a sell; px is an integer price in ticks.
    Fills on the same side as the open position open new lots (appended at the back).
    Opposite-side fills close the OLDEST lots first; any remainder opens a new lot on the
    other side (the position flips). Realised P&L (in ticks * qty) is
      long lot closed:  (exit_px - entry_px) * closed_qty
      short lot closed: (entry_px - exit_px) * closed_qty
    fill() returns cumulative realised P&L.
    """

    def __init__(self):
        self.lots = deque()  # each lot: [signed_qty, entry_px]
        self.realized = 0

    @property
    def position(self):
        return sum(q for q, _ in self.lots)

    def open_lots(self):
        return [tuple(l) for l in self.lots]

    def fill(self, qty, px):
        if qty == 0:
            return self.realized
        side = 1 if qty > 0 else -1
        remaining = abs(qty)
        # All open lots share one sign; only close while they are on the OTHER side.
        while remaining and self.lots and (self.lots[0][0] > 0) != (side > 0):
            lot = self.lots[0]
            lot_side = 1 if lot[0] > 0 else -1
            take = min(remaining, abs(lot[0]))
            self.realized += take * (px - lot[1]) * lot_side
            lot[0] -= take * lot_side
            remaining -= take
            if lot[0] == 0:
                self.lots.popleft()
        if remaining:
            self.lots.append([side * remaining, px])
        return self.realized
`,
        },
        hints: [
          'Work with `remaining = abs(qty)` and an explicit side; never mix signed and unsigned quantities in one update.',
          'Only match against lots on the *opposite* side; a buy into a long position must just append a lot.',
          'P&L for closing a lot of sign s at price px is `take * (px - entry) * s`.',
        ],
        explanation: `The original treated every fill as "a sell reducing a long":
- \`self.realized += take * (px - lot[1])\` has the wrong sign for short lots: covering a short at a lower price is a *profit* (entry − exit).
- \`lot[0] -= take\` / \`qty += take\` only move toward zero when the lot is positive and the fill negative. For a buy into a long book they *grow* the lot and the loop never ends correctly (qty += take moves away from 0). Same-side fills must not match at all.
- On a flip, the remainder must open a lot with the fill's sign.

The fix normalises to (side, magnitude), matches only opposite-side lots, applies P&L with the lot's sign, and appends the remainder as a new lot. Because a FIFO book's open lots always share a sign, checking only the head lot is sufficient.`,
        timeLimitSec: 900,
        focusFile: 'pnl/fifo.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 10. asyncio: scheduling, cancellation, late binding, lost updates
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-py-asyncio-cancel-race',
    title: 'Best Quote Wins, Everyone Else Is Cancelled',
    level: 5,
    rating: 2800,
    lang: 'python',
    domain: 'trading',
    companies: ['hrt', 'two-sigma', 'optiver', 'generic'],
    tags: ['asyncio', 'cancellation', 'event-loop', 'late-binding', 'locks', 'race-condition'],
    summary: 'Race three venues, cancel the losers, then fix a position keeper that loses fills across an `await`.',
    context:
      'The smart order router requests quotes from several venues and takes the first. The position keeper behind it awaits a remote risk check per fill. After a burst of 50 fills, the book shows a position of 1.',
    persona: 'confident-intern',
    files: [
      {
        path: 'router.py',
        content: `import asyncio

log = []


async def quote(venue, delay):
    log.append(f"{venue} start")
    try:
        await asyncio.sleep(delay)
        log.append(f"{venue} done")
        return venue
    except asyncio.CancelledError:
        log.append(f"{venue} cancelled")
        raise
    finally:
        log.append(f"{venue} cleanup")


async def best_quote():
    venues = (("XNAS", 0.30), ("ARCA", 0.01), ("BATS", 0.20))
    tasks = [asyncio.create_task(quote(v, d)) for v, d in venues]
    log.append("spawned")
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    winner = next(iter(done)).result()
    log.append(f"winner {winner}")
    losers = [t for t in tasks if t in pending]
    for t in losers:
        t.cancel()
    log.append("cancel requested")
    results = await asyncio.gather(*losers, return_exceptions=True)
    log.append(str([type(r).__name__ for r in results]))
    return winner


async def main():
    callbacks = [lambda: log.append(f"cb {i}") for i in range(3)]
    loop = asyncio.get_running_loop()
    for cb in callbacks:
        loop.call_soon(cb)
    w = await best_quote()
    log.append(f"main got {w}")


asyncio.run(main())
print("\\n".join(log))
`,
      },
      {
        path: 'risk/positions.py',
        content: `class PositionKeeper:
    """Applies fills after an async pre-trade risk check.

    on_fill(sym, qty):
      - awaits risk.check(sym, new_position) (may raise to reject), then commits it
      - returns the new position
    Guarantees:
      - fills for the SAME symbol are applied one at a time, in call order, and each
        risk check sees the position including every earlier (committed) fill
      - fills for DIFFERENT symbols never wait for each other
      - a rejected or cancelled fill leaves the position unchanged and never wedges later fills
    """

    def __init__(self, risk):
        self.risk = risk
        self.positions = {}

    async def on_fill(self, sym, qty):
        current = self.positions.get(sym, 0)
        new = current + qty
        await self.risk.check(sym, new)
        self.positions[sym] = new
        return new
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Race the venues',
        prompt: 'Predict the output of `router.py`. (The sleeps are far enough apart that timer order is unambiguous.)',
        entry: 'router.py',
        answer:
          "spawned\ncb 2\ncb 2\ncb 2\nXNAS start\nARCA start\nBATS start\nARCA done\nARCA cleanup\nwinner ARCA\ncancel requested\nXNAS cancelled\nXNAS cleanup\nBATS cancelled\nBATS cleanup\n['CancelledError', 'CancelledError']\nmain got ARCA",
        options: [
          "spawned\ncb 2\ncb 2\ncb 2\nXNAS start\nARCA start\nBATS start\nARCA done\nARCA cleanup\nwinner ARCA\ncancel requested\nXNAS cancelled\nXNAS cleanup\nBATS cancelled\nBATS cleanup\n['CancelledError', 'CancelledError']\nmain got ARCA",
          "cb 0\ncb 1\ncb 2\nspawned\nXNAS start\nARCA start\nBATS start\nARCA done\nARCA cleanup\nwinner ARCA\ncancel requested\nXNAS cancelled\nXNAS cleanup\nBATS cancelled\nBATS cleanup\n['CancelledError', 'CancelledError']\nmain got ARCA",
          "XNAS start\nARCA start\nBATS start\nspawned\ncb 2\ncb 2\ncb 2\nARCA done\nARCA cleanup\nwinner ARCA\nXNAS cancelled\nXNAS cleanup\nBATS cancelled\nBATS cleanup\ncancel requested\n[]\nmain got ARCA",
          "spawned\ncb 2\ncb 2\ncb 2\nXNAS start\nARCA start\nBATS start\nARCA done\nARCA cleanup\nwinner ARCA\ncancel requested\nXNAS cancelled\nBATS cancelled\n['CancelledError', 'CancelledError']\nmain got ARCA",
        ],
        hints: [
          '`await best_quote()` does not create a task: the coroutine runs inline in `main`\'s task until its first real suspension.',
          '`create_task` and `call_soon` both append to the same FIFO ready queue. Which was appended first?',
          'Each lambda closes over the *variable* `i` of the comprehension, not its value at creation time.',
        ],
        explanation: `1. **Late binding.** All three lambdas share the comprehension's single \`i\` cell, which is 2 when they run, so all print \`cb 2\`. Fix with \`lambda i=i: ...\`.
2. **Inline coroutine.** \`main\` schedules the 3 callbacks, then \`await best_quote()\` runs best_quote *synchronously* inside main's task: it creates 3 tasks (their first \`__step\` is queued via \`call_soon\`, **after** the callbacks) and logs \`spawned\` before anything yields. Only \`await asyncio.wait(...)\` suspends.
3. The loop then drains the ready queue FIFO: \`cb 2\` ×3, then the three task starts.
4. ARCA's 10 ms timer fires first; \`try\` completes and \`finally\` runs before the task finishes. \`asyncio.wait(FIRST_COMPLETED)\` wakes best_quote with \`done = {ARCA task}\`.
5. \`task.cancel()\` only *requests* cancellation: it cancels the sleep future the task is waiting on and schedules the task's wakeup. best_quote keeps running synchronously (\`cancel requested\`) until it awaits \`gather\`. The wakeups run in the order cancel() scheduled them (XNAS then BATS): \`CancelledError\` is raised at \`await asyncio.sleep\`, so \`except\` logs, re-raises, and \`finally\` logs.
6. \`gather(..., return_exceptions=True)\` returns the \`CancelledError\` instances instead of propagating them.`,
        timeLimitSec: 720,
        focusFile: 'router.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Cancellation semantics',
        prompt: 'Select **all** true statements (Python 3.8+ semantics).',
        options: [
          'If `quote` caught `Exception` instead of `asyncio.CancelledError`, cancellation would be swallowed and the task would return normally',
          'If `quote` caught `CancelledError` and did **not** re-raise, the task would complete normally with its return value, and the cancellation would be lost',
          '`t.cancel()` raises `CancelledError` immediately inside the target coroutine, before `cancel()` returns',
          'Without `return_exceptions=True`, `await asyncio.gather(*losers)` would raise `CancelledError` in `best_quote`',
          'In a single-threaded event loop, code between two `await`s of a coroutine can never be interleaved with other tasks',
        ],
        correct: [1, 3, 4],
        hints: ['Since 3.8, `CancelledError` derives from `BaseException`.', 'When does a coroutine observe a cancel request?'],
        explanation:
          '1 is false: since Python 3.8 `CancelledError` subclasses `BaseException`, so `except Exception` no longer catches it. 2 is true: swallowing it makes the task finish normally (a common bug; `asyncio.timeout`/TaskGroup rely on it propagating). 3 is false: `cancel()` only schedules a `CancelledError` to be thrown in at the next resumption. 4 is true: gather propagates the first exception, and a cancelled child counts. 5 is true, and it is the key to the position-keeper bug: interleaving can only happen *at* an `await`, so any read-modify-write that spans an `await` is a race.',
        timeLimitSec: 420,
      },
      {
        id: 's3',
        kind: 'code',
        task: 'fix',
        title: 'Fix the lost fills',
        prompt:
          '`PositionKeeper.on_fill` reads the position, awaits the risk check, then writes `current + qty`, so concurrent fills overwrite each other. Fix `risk/positions.py` to meet **all** the guarantees in its docstring (per-symbol serialisation in call order, no cross-symbol blocking, rejection/cancellation safety).',
        editable: ['risk/positions.py'],
        tests: [
          {
            path: 'tests/test_positions.py',
            content: `import asyncio
from risk.positions import PositionKeeper


class Risk:
    def __init__(self, limit=10**9, gates=None):
        self.seen = []
        self.limit = limit
        self.gates = gates if gates is not None else {}

    async def check(self, sym, pos):
        self.seen.append((sym, pos))
        await asyncio.sleep(0)
        gate = self.gates.get(sym)
        if gate is not None:
            await gate.wait()
        if abs(pos) > self.limit:
            raise ValueError("limit breached")


def test_no_lost_updates_and_call_order():
    async def go():
        risk = Risk()
        k = PositionKeeper(risk)
        results = await asyncio.gather(*(k.on_fill("AAPL", 1) for _ in range(50)))
        assert k.positions["AAPL"] == 50
        assert results == list(range(1, 51))
        assert [p for _, p in risk.seen] == list(range(1, 51))
    asyncio.run(go())


def test_symbols_do_not_block_each_other():
    async def go():
        gate = asyncio.Event()
        k = PositionKeeper(Risk(gates={"AAPL": gate}))
        blocked = asyncio.create_task(k.on_fill("AAPL", 5))
        for _ in range(3):
            await asyncio.sleep(0)
        assert await asyncio.wait_for(k.on_fill("MSFT", 7), 1.0) == 7
        gate.set()
        assert await blocked == 5
    asyncio.run(go())


def test_rejected_fill_leaves_position_and_later_fills_work():
    async def go():
        k = PositionKeeper(Risk(limit=10))
        assert await k.on_fill("ES", 8) == 8
        try:
            await k.on_fill("ES", 5)
            assert False, "expected rejection"
        except ValueError:
            pass
        assert k.positions["ES"] == 8
        assert await k.on_fill("ES", 2) == 10
    asyncio.run(go())


def test_cancelled_fill_does_not_wedge_or_commit():
    async def go():
        gate = asyncio.Event()
        k = PositionKeeper(Risk(gates={"NQ": gate}))
        t1 = asyncio.create_task(k.on_fill("NQ", 3))
        await asyncio.sleep(0)
        t2 = asyncio.create_task(k.on_fill("NQ", 4))
        for _ in range(3):
            await asyncio.sleep(0)
        t1.cancel()
        try:
            await t1
        except asyncio.CancelledError:
            pass
        gate.set()
        assert await asyncio.wait_for(t2, 1.0) == 4
        assert k.positions["NQ"] == 4
    asyncio.run(go())


def test_interleaved_mixed_signs():
    async def go():
        k = PositionKeeper(Risk())
        qtys = [5, -3, 7, -2, -10, 4]
        await asyncio.gather(*(k.on_fill("CL", q) for q in qtys))
        assert k.positions["CL"] == sum(qtys)
    asyncio.run(go())
`,
          },
        ],
        solution: {
          'risk/positions.py': `import asyncio


class PositionKeeper:
    """Applies fills after an async pre-trade risk check.

    on_fill(sym, qty):
      - awaits risk.check(sym, new_position) (may raise to reject), then commits it
      - returns the new position
    Guarantees:
      - fills for the SAME symbol are applied one at a time, in call order, and each
        risk check sees the position including every earlier (committed) fill
      - fills for DIFFERENT symbols never wait for each other
      - a rejected or cancelled fill leaves the position unchanged and never wedges later fills
    """

    def __init__(self, risk):
        self.risk = risk
        self.positions = {}
        self._locks = {}

    def _lock(self, sym):
        lock = self._locks.get(sym)
        if lock is None:
            lock = self._locks[sym] = asyncio.Lock()
        return lock

    async def on_fill(self, sym, qty):
        # asyncio.Lock is FIFO-fair, so same-symbol fills run in call order.
        async with self._lock(sym):
            # Read AFTER acquiring: the value can't change until we release.
            new = self.positions.get(sym, 0) + qty
            await self.risk.check(sym, new)
            self.positions[sym] = new
            return new
`,
        },
        hints: [
          'Any read-modify-write that spans an `await` is a race, even on one thread.',
          'One `asyncio.Lock` per symbol. A single global lock would make MSFT wait behind a slow AAPL check.',
          'Read the position *inside* the lock. `async with` releases on exceptions and on `CancelledError`.',
        ],
        explanation: `With one thread, interleaving happens only at \`await\` points, and \`on_fill\` has one between its read and its write. All 50 coroutines read 0 before any of them writes, so each writes 1: classic lost update.

A per-symbol \`asyncio.Lock\` serialises the read-check-write section:
- \`asyncio.Lock\` wakes waiters in FIFO order, giving call-order application and risk checks that see 1, 2, …, 50.
- Separate locks per symbol keep MSFT independent of a stalled AAPL check (a global lock fails the isolation test).
- \`async with\` releases on any exception, including \`CancelledError\` (a \`BaseException\`), so rejections and cancellations never wedge the queue. Because the commit happens after the check, an aborted fill never touches \`positions\`.
- Reading the position after acquiring is essential: computing \`new\` before \`async with\` would reintroduce the race.

Creating the lock lazily without an \`await\` between the check and the insert is itself race-free for the same reason.`,
        timeLimitSec: 1080,
        focusFile: 'risk/positions.py',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 11. Rolling variance: catastrophic cancellation, Kahan, Welford
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-py-rolling-variance',
    title: 'Negative Variance at a Billion Dollars',
    level: 5,
    rating: 2900,
    lang: 'python',
    domain: 'market-data',
    companies: ['citadel', 'two-sigma', 'jane-street', 'de-shaw', 'hrt'],
    tags: ['floating-point', 'catastrophic-cancellation', 'welford', 'kahan', 'fsum', 'numerics'],
    summary: 'Sum-of-squares variance goes negative on large prices. Review a broken Kahan "fix", then ship an O(1) stable rolling variance.',
    context:
      'The volatility signal feeds a sizing model. On instruments quoted around 1e9 (index points × multiplier) the signal sometimes reports **negative** variance and the model takes `sqrt` of it. The window is 2,000 ticks and `push` must stay O(1).',
    persona: 'confident-intern',
    files: [
      {
        path: 'numerics.py',
        content: `import math

prices = [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16]


def naive_var(xs):
    n, s, sq = len(xs), 0.0, 0.0
    for x in xs:
        s += x
        sq += x * x
    return (sq - s * s / n) / (n - 1)


def welford_var(xs):
    mean, m2 = 0.0, 0.0
    for k, x in enumerate(xs, 1):
        d = x - mean
        mean += d / k
        m2 += d * (x - mean)
    return m2 / (len(xs) - 1)


def shifted_var(xs):
    k = xs[0]
    return naive_var([x - k for x in xs])


def loop_sum(xs):
    total = 0.0
    for x in xs:
        total += x
    return total


print("naive  ", naive_var(prices))
print("welford", welford_var(prices))
print("shifted", shifted_var(prices))
print("ticks  ", loop_sum([0.1] * 10), math.fsum([0.1] * 10))
print("big    ", loop_sum([1e16, 1.0, -1e16]), math.fsum([1e16, 1.0, -1e16]))
print("order  ", loop_sum([1.0, 1e16, -1e16]), loop_sum([1e16, -1e16, 1.0]))
`,
      },
      {
        path: 'signals/rolling.py',
        content: `from collections import deque


class RollingStats:
    """Mean and sample variance (n - 1) of the last \`window\` values. push() must be O(1)."""

    def __init__(self, window):
        self.window = window
        self.buf = deque()
        self.s = 0.0
        self.sq = 0.0

    def push(self, x):
        self.buf.append(x)
        self.s += x
        self.sq += x * x
        if len(self.buf) > self.window:
            old = self.buf.popleft()
            self.s -= old
            self.sq -= old * old
        return self.mean(), self.variance()

    def mean(self):
        return self.s / len(self.buf)

    def variance(self):
        n = len(self.buf)
        if n < 2:
            return 0.0
        return (self.sq - self.s * self.s / n) / (n - 1)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Three variances',
        prompt:
          'The true sample variance of the four prices is exactly 30. Predict the output of `numerics.py` (IEEE-754 binary64, round-half-even, which is what CPython floats are on every mainstream platform).',
        entry: 'numerics.py',
        answer:
          'naive   -170.66666666666666\nwelford 30.0\nshifted 30.0\nticks   0.9999999999999999 1.0\nbig     0.0 1.0\norder   0.0 1.0',
        options: [
          'naive   -170.66666666666666\nwelford 30.0\nshifted 30.0\nticks   0.9999999999999999 1.0\nbig     0.0 1.0\norder   0.0 1.0',
          'naive   30.0\nwelford 30.0\nshifted 30.0\nticks   1.0 1.0\nbig     1.0 1.0\norder   1.0 1.0',
          'naive   0.0\nwelford 30.000000000000004\nshifted 30.0\nticks   0.9999999999999999 1.0\nbig     0.0 1.0\norder   1.0 1.0',
          'naive   -170.66666666666666\nwelford 30.0\nshifted 30.0\nticks   0.9999999999999999 0.9999999999999999\nbig     0.0 0.0\norder   0.0 1.0',
        ],
        hints: [
          '`x * x` ≈ 1e18. The spacing between adjacent doubles near 1e18 is 128, and near 4e18 it is 512.',
          'Welford only ever squares *deviations* from the running mean, which are small here and exactly representable.',
          '`math.fsum` returns the correctly rounded sum of the exact values. `1e16 + 1.0` rounds back to `1e16` (ulp 2 at 1e16).',
        ],
        explanation: `**Naive.** \`sq\` and \`s*s/n\` are both ≈ 4e18, where one ulp is 512. Each \`x*x\` (≈1e18, ulp 128) is already rounded by up to 64, and the subtraction cancels all ~18 leading digits, leaving pure rounding noise: here \`sq\` = 4.00000008e18 while \`s*s/n\` = 4.0000000800000005e18, one ulp (512) apart, so the numerator is −512 and the result −512/3 = **−170.666…**. A negative variance is a hallmark of catastrophic cancellation, not a "bug in the data".

**Welford** updates with \`d = x - mean\`, whose values (≈ 1e9 ± 10) are exact or nearly so; \`m2\` accumulates products of small deviations. Result **30.0**. **Shifted** subtracts a reference (exact here: Sterbenz) so the sums of squares are tiny integers, also **30.0**, though it degrades if prices drift far from the reference.

**Summation.** Naive left-to-right addition of ten 0.1s gives 0.9999999999999999. \`math.fsum\` tracks exact partials and returns the correctly rounded exact sum (1.0000000000000000555… → 1.0). \`1e16 + 1.0\` = 1e16 (the tie rounds to even), so the 1 is lost: 0.0. fsum gives 1.0. Order matters: \`(1.0 + 1e16) - 1e16\` loses the 1, \`(1e16 - 1e16) + 1.0\` keeps it, so floating-point addition is **not associative**.`,
        timeLimitSec: 600,
        focusFile: 'numerics.py',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Guaranteed or accident?',
        prompt:
          'Which of these are **guaranteed** by the Python language / documented semantics (assuming IEEE-754 doubles), rather than being CPython implementation details? Select all that apply.',
        options: [
          '`math.fsum([0.1] * 10) == 1.0`',
          '`sum([0.1] * 10) == 1.0`',
          '`a = 256; b = 256; a is b`',
          '`float("nan") != float("nan")`',
          '`x = 10**3; y = 10**3; x is not y`',
          '`0.1 + 0.2 != 0.3`',
        ],
        correct: [0, 3, 5],
        hints: ['Small-integer caching is a CPython optimisation. Since 3.12 `sum()` of floats is *documented* to use a more accurate algorithm "on most builds".'],
        explanation:
          '**fsum** is specified to return an accurately rounded sum. **NaN** comparisons are unordered by IEEE-754 and Python follows that. **0.1 + 0.2** is 0.30000000000000004 under IEEE-754 binary64. `sum([0.1]*10)` *is* `1.0` on CPython 3.12+, because `sum()` of floats switched to Neumaier compensated summation, but the docs hedge with "on most builds"; it was 0.9999999999999999 before 3.12, so do not rely on it. `is` on ints depends on CPython\'s cache of −5..256 and on constant folding and sharing within a code object: `x is not y` for 1000 is *not* guaranteed (both literals can be the same constant object). Never use `is` for numeric equality.',
        timeLimitSec: 360,
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Kahan to the rescue?',
        prompt: 'The assistant proposes this patch to `RollingStats` (window adds/removes now go through Kahan-compensated accumulators). Review it.',
        persona: 'confident-intern',
        request: 'variance() returns negative numbers for prices near 1e9. Fix precision without making push() O(window).',
        aiReply: `The issue is floating-point error accumulating in \`s\` and \`sq\`. Use **Kahan summation** for both accumulators. I also simplified the compensation step a bit:

\`\`\`python
class KahanAcc:
    def __init__(self):
        self.total = 0.0
        self.c = 0.0

    def add(self, x):
        y = x - self.c
        t = self.total + y
        self.c = t - (self.total + y)   # simplified from (t - total) - y
        self.total = t
\`\`\`

…and \`self.s\`/\`self.sq\` become \`KahanAcc()\` (remove = \`add(-x)\`). Variance formula unchanged. With compensated sums the cancellation goes away. ✅`,
        options: [
          'Accept: Kahan summation removes accumulation error, which is the root cause',
          'Reject, only because the "simplification" breaks Kahan: `self.total + y` is the same rounded operation that produced `t`, so `c` is always exactly 0. With the original `(t - total) - y`, this patch would fully fix the negative variance',
          'Reject, for two reasons: the rewritten compensation is always exactly 0 (floating-point subtraction is not associative, so `(t - total) - y` ≠ `t - (total + y)`), **and** even perfect sums cannot fix `sq - s*s/n`, since `sq` and `s*s/n` are each ~4e18 (ulp 512) and their difference of ~100 is lost to rounding when they are stored and subtracted',
          'Reject, only because Kahan summation is O(n) per add',
        ],
        correct: 2,
        hints: ['Evaluate `t - (total + y)` in floating point, given `t` was computed as `total + y`.', 'Suppose `s` and `sq` were *exactly* the true sums. Is `sq - s*s/n` then computed accurately?'],
        explanation:
          'Kahan\'s compensation `c = (t - total) - y` recovers the low-order bits lost in `t = total + y`. Algebraically it equals `t - (total + y)`, but in floating point `total + y` rounds to exactly `t`, so the "simplified" form is identically 0. This is the classic hazard of "optimisations" that reassociate FP expressions (also why compilers need `-ffast-math` to do it). More fundamentally, the instability is in the **formula**, not the accumulation: even exact `s` and `sq` must be rounded to doubles (~4e18, ulp 512) and `s*s/n` rounded again before subtracting quantities that agree in all but their last ~3 digits. Use Welford-style updates on deviations (or shift by a reference and recompute periodically).',
        timeLimitSec: 540,
        focusFile: 'signals/rolling.py',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Stable O(1) rolling variance',
        prompt:
          'Rewrite `signals/rolling.py` so `push` stays O(1) but the mean and sample variance are numerically stable for values around 1e9 (relative error ≤ 1e-3 vs exact over 100k pushes), never negative, and exactly 0 for a constant series. Keep the `push(x) -> (mean, variance)` API.',
        editable: ['signals/rolling.py'],
        timeoutMs: 6000,
        tests: [
          {
            path: 'tests/test_rolling.py',
            content: `import random
from fractions import Fraction
from signals.rolling import RollingStats


def exact_var(win):
    fr = [Fraction(v) for v in win]
    mu = sum(fr) / len(fr)
    return float(sum((v - mu) ** 2 for v in fr) / (len(fr) - 1)), float(mu)


def series(n, seed=7):
    rng = random.Random(seed)
    p = 1e9
    out = []
    for _ in range(n):
        p += rng.choice([-0.25, 0.0, 0.25]) * rng.randint(1, 4)
        out.append(p)
    return out


def test_small_window_matches_exact():
    xs = [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16, 1e9 + 1, 1e9 + 9]
    r = RollingStats(4)
    for i, x in enumerate(xs):
        m, v = r.push(x)
        win = xs[max(0, i - 3): i + 1]
        if len(win) >= 2:
            ev, em = exact_var(win)
            assert abs(v - ev) <= 1e-6 * max(1.0, ev), (i, v, ev)
            assert abs(m - em) <= 1e-6
    assert r.push(1e9 + 2)[1] >= 0


def test_long_run_accuracy_and_non_negative():
    xs = series(100_000)
    w = 2000
    r = RollingStats(w)
    for i, x in enumerate(xs):
        m, v = r.push(x)
        assert v >= 0.0
        if i >= w and i % 9973 == 0:
            ev, em = exact_var(xs[i - w + 1: i + 1])
            assert abs(v - ev) <= 1e-3 * ev, (i, v, ev)
            assert abs(m - em) <= 1e-4


def test_constant_series_is_exactly_zero():
    r = RollingStats(50)
    for _ in range(500):
        m, v = r.push(1e9 + 0.5)
    assert v == 0.0
    assert m == 1e9 + 0.5


def test_single_value_and_window_one():
    r = RollingStats(1)
    assert r.push(5.0) == (5.0, 0.0)
    assert r.push(7.0) == (7.0, 0.0)
    r2 = RollingStats(10)
    assert r2.push(3.0) == (3.0, 0.0)
`,
          },
        ],
        solution: {
          'signals/rolling.py': `from collections import deque


class RollingStats:
    """Mean and sample variance (n - 1) of the last \`window\` values. push() must be O(1)."""

    def __init__(self, window):
        self.window = window
        self.buf = deque()
        self.mu = 0.0
        self.m2 = 0.0  # sum of squared deviations from the current mean

    def push(self, x):
        buf = self.buf
        if len(buf) < self.window:
            buf.append(x)
            n = len(buf)
            d = x - self.mu
            self.mu += d / n
            self.m2 += d * (x - self.mu)
        else:
            old = buf.popleft()
            buf.append(x)
            n = self.window
            old_mu = self.mu
            self.mu += (x - old) / n
            # Welford-style replace step: works on deviations, never on raw squares.
            self.m2 += (x - old) * ((x - self.mu) + (old - old_mu))
        if self.m2 < 0.0:
            self.m2 = 0.0
        return self.mean(), self.variance()

    def mean(self):
        return self.mu

    def variance(self):
        n = len(self.buf)
        if n < 2:
            return 0.0
        return self.m2 / (n - 1)
`,
        },
        hints: [
          'Track the running mean and M2 (sum of squared deviations) instead of Σx and Σx².',
          'When the window is full, replacing `old` with `x` updates `mean += (x - old)/n` and `M2 += (x - old) * ((x - new_mean) + (old - old_mean))`.',
          'Clamp tiny negative M2 from rounding to 0, and handle window == 1.',
        ],
        explanation: `\`Σx² − (Σx)²/n\` subtracts two numbers ≈ n·1e18 that agree to ~16 digits, so the result is pure rounding noise, often negative. Welford's recurrences only ever multiply **deviations** (x − mean), which are small, so relative error stays near machine epsilon times the condition number of the data rather than of the raw magnitudes.

For a sliding window, the add-and-remove update follows from expanding M2 before and after replacing \`old\` by \`x\`:
\`\`\`
mean' = mean + (x - old)/n
M2'   = M2 + (x - old) * ((x - mean') + (old - mean))
\`\`\`
A constant series gives \`x - old = 0\` at every step, so M2 stays exactly 0. Rounding can still drift over very long runs (the test bounds it at 1e-3 over 100k updates). Production systems often also recompute from the buffer every N updates, or clamp at 0 as here.`,
        timeLimitSec: 1200,
        focusFile: 'signals/rolling.py',
      },
    ],
  },
];

export default problems;
