import type { Problem } from '../types';

/**
 * L5 Grandmaster set A (part 4): C++20.
 * Temporaries & lifetime extension, container invalidation, integer promotion in fixed-point
 * order-book maths, lock-free SPSC/Treiber structures, and initialisation order.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 16. Object lifetime, temporaries, copy elision, moved-from state
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-cpp-temporaries',
    title: 'Who Dies at the Semicolon?',
    level: 5,
    rating: 2800,
    lang: 'cpp',
    domain: 'language-semantics',
    companies: ['hrt', 'citadel', 'jane-street', 'optiver'],
    tags: ['object-lifetime', 'temporaries', 'lifetime-extension', 'copy-elision', 'move-semantics', 'dangling'],
    summary: 'Trace every constructor and destructor through elision, binding to references, and `std::move` on a const.',
    context:
      'The market-data team is chasing a crash in the snapshot code that only reproduces in release builds. Before reading it, the lead wants you to prove you can trace object lifetimes exactly.',
    persona: 'confident-intern',
    files: [
      {
        path: 'life.cpp',
        content: `#include <cstdio>
#include <string>
#include <utility>

struct T {
    std::string n;
    explicit T(std::string s) : n(std::move(s)) { std::printf("ctor %s\\n", n.c_str()); }
    T(const T& o) : n(o.n + "c") { std::printf("copy %s\\n", n.c_str()); }
    T(T&& o) noexcept : n(o.n + "m") {
        o.n = "moved";
        std::printf("move %s\\n", n.c_str());
    }
    ~T() { std::printf("dtor %s\\n", n.c_str()); }
    const T& self() const { return *this; }
};

T make(const char* s) { return T(s); }
T pass(T t) { return t; }

int main() {
    std::puts("-- 1");
    [[maybe_unused]] const T& a = make("a");
    std::puts("-- 2");
    [[maybe_unused]] const T& b = T("b").self();
    std::puts("-- 3");
    T c = pass(T("c"));
    std::puts("-- 4");
    const T d = T("d");
    T e = std::move(d);
    std::puts("-- 5");
    T f("f");
    T g = std::move(f);
    std::printf("f is %s\\n", f.n.c_str());
    std::puts("-- 6");
    [[maybe_unused]] auto&& h = std::move(T("h"));
    std::puts("-- 7");
    T i = true ? T("i1") : T("i2");
    std::puts("-- end");
}
`,
      },
      {
        path: 'snapshot.h',
        content: `#pragma once
#include <string>
#include <string_view>
#include <vector>

struct Level {
    long px;
    long qty;
};

struct Book {
    std::vector<Level> bids_;
    std::string venue_;
    const std::vector<Level>& bids() const { return bids_; }
    const std::string& venue() const { return venue_; }
};

Book snapshot(int venueId);  // returns a fresh Book by value

inline long depthA(int id) {
    long total = 0;
    for (const Level& l : snapshot(id).bids_) total += l.qty;
    return total;
}

inline long depthB(int id) {
    long total = 0;
    for (const Level& l : snapshot(id).bids()) total += l.qty;
    return total;
}

inline std::size_t venueLenA(int id) {
    const std::string& v = snapshot(id).venue_;
    return v.size();
}

inline std::size_t venueLenB(int id) {
    std::string_view v = snapshot(id).venue();
    return v.size();
}

inline std::string venueCopy(int id) {
    std::string v = snapshot(id).venue();
    return v;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Every ctor, every dtor',
        prompt:
          'Predict the full output of `life.cpp` (C++20). The program never *reads* through a dangling reference, so its behaviour is fully defined.',
        entry: 'life.cpp',
        answer:
          '-- 1\nctor a\n-- 2\nctor b\ndtor b\n-- 3\nctor c\nmove cm\ndtor moved\n-- 4\nctor d\ncopy dc\n-- 5\nctor f\nmove fm\nf is moved\n-- 6\nctor h\ndtor h\n-- 7\nctor i1\n-- end\ndtor i1\ndtor fm\ndtor moved\ndtor dc\ndtor d\ndtor cm\ndtor a',
        options: [
          '-- 1\nctor a\n-- 2\nctor b\ndtor b\n-- 3\nctor c\nmove cm\ndtor moved\n-- 4\nctor d\ncopy dc\n-- 5\nctor f\nmove fm\nf is moved\n-- 6\nctor h\ndtor h\n-- 7\nctor i1\n-- end\ndtor i1\ndtor fm\ndtor moved\ndtor dc\ndtor d\ndtor cm\ndtor a',
          '-- 1\nctor a\n-- 2\nctor b\n-- 3\nctor c\nmove cm\ndtor moved\n-- 4\nctor d\ncopy dc\n-- 5\nctor f\nmove fm\nf is moved\n-- 6\nctor h\n-- 7\nctor i1\n-- end\ndtor i1\ndtor h\ndtor fm\ndtor moved\ndtor dc\ndtor d\ndtor cm\ndtor b\ndtor a',
          '-- 1\nctor a\nmove am\ndtor moved\n-- 2\nctor b\ndtor b\n-- 3\nctor c\ncopy cc\nmove ccm\ndtor moved\ndtor c\n-- 4\nctor d\nmove dm\n-- 5\nctor f\nmove fm\nf is moved\n-- 6\nctor h\ndtor h\n-- 7\nctor i1\nmove i1m\ndtor moved\n-- end\ndtor i1m\ndtor fm\ndtor moved\ndtor moved\ndtor dm\ndtor cm\ndtor am',
          '-- 1\nctor a\n-- 2\nctor b\ndtor b\n-- 3\nctor c\nmove cm\ndtor moved\n-- 4\nctor d\nmove dm\n-- 5\nctor f\nmove fm\nf is moved\n-- 6\nctor h\ndtor h\n-- 7\nctor i1\n-- end\ndtor a\ndtor cm\ndtor d\ndtor dm\ndtor moved\ndtor fm\ndtor i1',
        ],
        hints: [
          'C++17 guaranteed copy elision: a prvalue initialises its final destination directly. That covers `return T(s);`, parameter initialisation from a prvalue, and a conditional whose operands are both prvalues.',
          'Lifetime extension only applies when a reference binds *directly* to a temporary (or a subobject of one). A reference returned from a function call (`self()`, `std::move`) does not count.',
          '`std::move` on a `const T` yields `const T&&`. Which constructor can bind that?',
        ],
        explanation: `- **1** \`make\` returns a prvalue, which is materialised as a temporary bound directly to \`a\`, so its lifetime is extended to \`a\`'s scope. No move (guaranteed elision).
- **2** \`T("b").self()\` returns \`const T&\`, an lvalue from a function call. The reference \`b\` binds to that, not to the temporary, so nothing is extended. The temporary dies at the end of the full-expression and \`b\` dangles (harmless only because it is never used).
- **3** The parameter \`t\` is initialised directly from the prvalue (elision). \`return t;\` cannot use NRVO for a parameter, but it is an implicitly movable entity, so it moves (\`cm\`). The moved-from parameter is destroyed (\`dtor moved\`) before \`-- 4\`. Whether that happens at function exit or at the end of the full-expression is implementation-defined, but no output sits between the two points.
- **4** \`std::move(d)\` is \`const T&&\`: \`T(T&&)\` is not viable (would drop const), so \`T(const T&)\` is chosen: **copy** \`dc\`. \`std::move\` on const objects silently copies.
- **5** Real move; our move ctor writes \`"moved"\` into the source.
- **6** \`std::move(T("h"))\` returns an xvalue *reference* to the temporary. A reference bound to a function's return value does not extend the temporary, so \`h\` dangles immediately (clang even warns \`-Wdangling\`).
- **7** Both arms are prvalues of type \`T\`, so the conditional is a prvalue and initialises \`i\` directly: one ctor, no move.
- **end** Automatic objects die in reverse order of construction: i1, g (\`fm\`), f (\`moved\`), e (\`dc\`), d, c (\`cm\`), and finally the lifetime-extended temporary \`a\`.`,
        timeLimitSec: 900,
        focusFile: 'life.cpp',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The release-only crash',
        prompt:
          '`snapshot()` returns a `Book` by value. Some helpers in `snapshot.h` read freed memory. Click a line with undefined behaviour and pick the rule that explains it (C++20, before P2718).',
        file: 'snapshot.h',
        lines: [28, 38],
        options: [
          'A reference or view obtained through a *member function call* on a temporary does not extend the temporary\'s lifetime. The `Book` dies at the end of the full-expression (for range-for, right after the range initialiser), leaving the loop or `string_view` pointing into freed storage. Binding directly to a data member (`.bids_`, `.venue_`) **does** extend the whole temporary',
          'Every one of these helpers is UB, because temporaries returned by value always die at the semicolon regardless of how they are bound',
          'Only `venueCopy` is UB, because copying from a reference to a temporary reads it after destruction',
          'Range-based for loops copy the range, so `depthA` and `depthB` are both safe; only the `string_view` is a problem',
        ],
        correct: 0,
        hints: [
          'Range-for desugars to `auto&& __range = <range-init>;`. What does `__range` bind to in each loop?',
          '`snapshot(id).bids_` is a member access on a prvalue, which is one of the forms that extends lifetime.',
        ],
        explanation: `Lifetime extension ([class.temporary]/6) applies when a reference binds to a temporary or to a **subobject** of it reached via member access. \`snapshot(id).bids_\` and \`snapshot(id).venue_\` qualify, so the entire \`Book\` lives as long as \`__range\` / \`v\` (depthA and venueLenA are fine). \`bids()\` and \`venue()\` are function calls returning references: the compiler cannot know they refer into the temporary, so no extension. The \`Book\` is destroyed at the end of the full-expression. In range-for that is the end of \`auto&& __range = snapshot(id).bids();\`, *before the loop body runs* (line 28). \`string_view\` on line 38 is a non-owning view into the destroyed string. \`venueCopy\` copies the string while the temporary is still alive, so it is fine.

C++23 (P2718R0) extends temporaries in a range-for initialiser to the end of the loop, which fixes line 28 but **not** line 38. Debug builds often "work" because freed memory has not been reused yet.`,
        timeLimitSec: 540,
        focusFile: 'snapshot.h',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 17. Container invalidation and moved-from objects
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-cpp-invalidation',
    title: 'References That Outlive Their Level',
    level: 5,
    rating: 2400,
    lang: 'cpp',
    domain: 'orderbook',
    companies: ['optiver', 'hrt', 'citadel', 'google'],
    tags: ['iterator-invalidation', 'std-vector', 'std-deque', 'move-semantics', 'undefined-behaviour'],
    summary: 'Which references survive `push_back`, `erase`, `rehash` and `splice`? Then find the reference held across an insert in a bid ladder.',
    context:
      'The bid ladder hits the best level, but when an implied bid improves the top of book first, the fills get booked against the wrong price, and occasionally ASan fires in CI.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'inval.cpp',
        content: `#include <cstdio>
#include <deque>
#include <list>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

int main() {
    std::vector<int> v{1, 2, 3};
    v.reserve(8);
    int& r = v[0];
    auto it = v.begin() + 1;
    v.push_back(4);
    r = 10;
    *it = 20;
    v.erase(v.begin() + 2);
    r += 1;
    *it += 1;
    for (int x : v) std::printf("%d ", x);
    std::printf("| cap>=8:%d\\n", v.capacity() >= 8);

    std::deque<int> dq{1, 2};
    int& front = dq.front();
    dq.push_back(3);
    dq.push_front(0);
    front = 7;
    for (int x : dq) std::printf("%d ", x);
    std::printf("\\n");

    std::unordered_map<int, std::string> um{{1, "ES"}, {2, "NQ"}};
    std::string& es = um[1];
    um.rehash(1024);
    es += "Z5";
    std::printf("%s %zu\\n", um[1].c_str(), um.size());

    std::list<int> lst{5, 6, 7};
    auto mid = std::next(lst.begin());
    lst.push_front(4);
    lst.erase(lst.begin());
    lst.splice(lst.end(), lst, lst.begin());
    std::printf("%d %d\\n", *mid, lst.front());

    auto p = std::make_unique<int>(42);
    auto q = std::move(p);
    std::printf("%d %d\\n", p == nullptr, *q);

    std::vector<int> src{1, 2, 3};
    std::vector<int> dst = std::move(src);
    src.assign({9});
    std::printf("%zu %zu %d\\n", dst.size(), src.size(), src[0]);
}
`,
      },
      {
        path: 'ladder.h',
        content: `#pragma once
#include <algorithm>
#include <cstdint>
#include <vector>

struct Level {
    std::int64_t px;
    std::int64_t qty;
};

// Bid ladder, best (highest) price first.
class BidLadder {
    std::vector<Level> levels_;

public:
    void add(std::int64_t px, std::int64_t qty) {
        auto it = std::find_if(levels_.begin(), levels_.end(), [&](const Level& l) { return l.px <= px; });
        if (it != levels_.end() && it->px == px) {
            it->qty += qty;
            return;
        }
        levels_.insert(it, Level{px, qty});
    }

    // Sell \`qty\` into the best bid. An implied bid (from a spread leg) may improve
    // the top of book just before we hit it; if so it must be hit first.
    std::int64_t hitBest(std::int64_t qty, std::int64_t impliedPx, std::int64_t impliedQty) {
        if (levels_.empty()) return 0;
        Level& best = levels_.front();
        if (impliedQty > 0 && impliedPx > best.px) {
            add(impliedPx, impliedQty);
        }
        std::int64_t filled = std::min(qty, best.qty);
        best.qty -= filled;
        if (best.qty == 0) levels_.erase(levels_.begin());
        return filled;
    }

    const std::vector<Level>& levels() const { return levels_; }
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Valid or invalidated?',
        prompt:
          'Every reference and iterator in `inval.cpp` is used only where the standard guarantees it is still valid, so the output is fully defined. Predict it.',
        entry: 'inval.cpp',
        answer: '11 21 4 | cap>=8:1\n0 7 2 3\nESZ5 2\n6 6\n1 42\n3 1 9',
        hints: [
          '`reserve(n)` guarantees no reallocation until `size()` would exceed `capacity()`. `erase` invalidates only iterators/references at or after the erase point.',
          '`deque::push_front/push_back` invalidate all *iterators* but **no references**. `rehash` invalidates iterators but not references. `list` operations never invalidate other elements, even `splice`.',
          '`unique_ptr`\'s move constructor guarantees the source becomes null. A moved-from `vector` is "valid but unspecified", and `assign` has no preconditions.',
        ],
        explanation: `- **vector:** after \`reserve(8)\`, \`push_back\` (size 4 ≤ 8) does not reallocate, so \`r\` (index 0) and \`it\` (index 1) stay valid → {10, 20, 3, 4}. \`erase(begin()+2)\` invalidates only positions ≥ 2, so \`r\`/\`it\` are still valid → {11, 21, 4}.
- **deque:** insertion at either end invalidates iterators but keeps references to existing elements ([deque.modifiers]). \`front\` still refers to the old 1 → \`0 7 2 3\`.
- **unordered_map:** rehashing invalidates iterators, not pointers/references to elements (nodes are not moved) → \`ESZ5 2\`.
- **list:** \`mid\` → 6. push_front/erase of other nodes and even \`splice\` of a node keep every other iterator valid → list is {6, 7, 5}, \`*mid\` = 6, front = 6.
- **unique_ptr:** moved-from is guaranteed \`nullptr\`.
- **vector move:** \`dst\` owns the 3 elements. \`src\` is valid-but-unspecified, and \`assign\` resets it to {9}.

Without \`reserve(8)\` the first block would not be portable: the capacity after list-initialisation is unspecified, and if \`push_back\` reallocates, every reference and iterator is invalidated and using \`r\` is UB.`,
        timeLimitSec: 600,
        focusFile: 'inval.cpp',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The implied bid that steals the fill',
        prompt:
          'With an implied bid above the current best, `hitBest` decrements the **wrong** level (and under ASan sometimes reports heap-use-after-free). Click the problematic line and pick the cause.',
        file: 'ladder.h',
        lines: [29, 31],
        options: [
          '`best` is a reference into `levels_`, and `add` inserts at the front: `vector::insert` invalidates references at/after the insertion point (all of them if it reallocates). Without reallocation `best` now aliases the *implied* level; with reallocation it dangles. Re-acquire `levels_.front()` after `add`',
          '`std::find_if` with `<=` places equal prices after the existing level, creating duplicates',
          '`levels_.erase(levels_.begin())` is UB when the vector has exactly one element',
          '`std::min` returns a reference to a temporary, so `filled` dangles',
        ],
        correct: 0,
        hints: ['What does `Level& best` refer to after an element is inserted before it?'],
        explanation:
          '`vector::insert` invalidates every reference and iterator at or after the insertion point, and all of them on reallocation. Here the insertion point is `begin()`, so `best` is invalidated in both cases. In practice, when capacity suffices, elements shift right and `best` (still pointing at slot 0) now silently refers to the new implied level: the "wrong level" bug. When the vector reallocates, `best` points into freed storage: the ASan report. The spec of the function (hit the implied level first) is accidentally *sometimes* met, which makes this nasty to spot in tests. Fix: perform `add` first, then take `Level& best = levels_.front();`. `std::min(qty, best.qty)` returns a reference to an lvalue that is copied immediately, which is fine.',
        timeLimitSec: 420,
        focusFile: 'ladder.h',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Invalidation rules',
        prompt: 'Select **all** statements guaranteed by the C++20 standard library specification.',
        options: [
          '`std::vector::push_back` when `size() < capacity()` keeps all references valid but invalidates the `end()` iterator',
          '`std::deque::push_back` keeps all iterators valid',
          '`std::unordered_map::insert` that triggers a rehash keeps references to existing elements valid',
          'After `std::string t = std::move(s);`, `s.empty()` is guaranteed to be true',
          'After `std::string t = std::move(s);`, calling `s.clear()` and then reusing `s` is well-defined',
        ],
        correct: [0, 2, 4],
        hints: ['"Valid but unspecified" means: any operation without preconditions is fine; you just cannot assume the value.'],
        explanation:
          '1: true; only past-the-end is invalidated when no reallocation happens. 2: false; deque end insertions invalidate all iterators (but not references). 3: true; node-based containers keep references across rehash, only iterators are invalidated. 4: false; a moved-from `std::string` is valid but unspecified (with SSO it often keeps its contents). 5: true; `clear()` has no preconditions, after which the value is known.',
        timeLimitSec: 360,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 18. Integer promotion and fixed-point order-book arithmetic
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-cpp-fixed-point-promotion',
    title: 'Six Billion Dollars Becomes 1.7',
    level: 5,
    rating: 2850,
    lang: 'cpp',
    domain: 'orderbook',
    companies: ['citadel', 'hrt', 'jane-street', 'optiver', 'two-sigma'],
    tags: ['integer-promotion', 'usual-arithmetic-conversions', 'overflow', 'fixed-point', 'undefined-behaviour'],
    summary: 'Integral promotions and usual arithmetic conversions in tick-based price maths, plus a cast that comes one multiplication too late.',
    context:
      'Prices are stored as integer ticks (0.01) to avoid floating point. Risk saw a notional of 17,050,327.04 for a fill that was really 60,000,000.00. Assume the usual LP64 platform: 8/16/32/64-bit `char`/`short`/`int`/`long long`, 64-bit `size_t`.',
    persona: 'confident-intern',
    files: [
      {
        path: 'promo.cpp',
        content: `#include <cstdint>
#include <cstdio>
#include <type_traits>
#include <vector>

int main() {
    std::uint8_t a = 200, b = 100;
    auto sum = a + b;
    std::uint8_t wrapped = a + b;
    std::printf("%d %d %d\\n", sum, int(wrapped), int(std::is_same_v<decltype(sum), int>));

    unsigned u = 1;
    int i = -2;
    std::printf("%u %d\\n", u + i, int(-1 < 0u));

    std::vector<int> v(3);
    int iterations = 0;
    for (int k = -1; k < static_cast<int>(v.size()); ++k) ++iterations;
    int iterations2 = 0;
    for (long long k = -1; k < v.size(); ++k) ++iterations2;
    std::printf("%d %d\\n", iterations, iterations2);

    std::uint32_t pxTicks = 300000, qty = 20000;
    std::uint64_t bad = pxTicks * qty;
    std::uint64_t good = std::uint64_t(pxTicks) * qty;
    std::printf("%llu %llu\\n", (unsigned long long)bad, (unsigned long long)good);

    int bid = -7, ask = -4;
    std::printf("%d %d %d\\n", (bid + ask) / 2, -7 / 2, -7 % 2);

    std::int16_t pos = 30000;
    pos += 30000;
    std::printf("%d\\n", pos);

    std::int64_t lots = 3;
    std::uint32_t lotSize = 100;
    std::printf("%lld\\n", (long long)(-lots * lotSize));
    std::int32_t shortQty = -3;
    std::printf("%lld\\n", (long long)(shortQty * lotSize));
}
`,
      },
      {
        path: 'fixed.h',
        content: `#pragma once
#include <cstdint>
#include <vector>

// Prices in ticks of 0.01. Quantities in shares.
struct Fill {
    std::int32_t pxTicks;
    std::int32_t qty;
};

inline std::int64_t notionalTicks(const Fill& f) {
    return f.pxTicks * f.qty;
}

inline std::int64_t vwapTicks(const std::vector<Fill>& fills) {
    std::int64_t num = 0, den = 0;
    for (const Fill& f : fills) {
        num += notionalTicks(f);
        den += f.qty;
    }
    return den == 0 ? 0 : num / den;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Promotions and conversions',
        prompt: 'Predict the output of `promo.cpp` (every operation in it is well-defined in C++20 on LP64).',
        entry: 'promo.cpp',
        answer: '300 44 1\n4294967295 0\n4 0\n1705032704 6000000000\n-5 -3 -1\n-5536\n-300\n4294966996',
        hints: [
          'Operands narrower than `int` are promoted to `int` before arithmetic. Converting back to a narrower unsigned type is modular; since C++20 conversion to a narrower *signed* type is modular too.',
          'Usual arithmetic conversions: `int` with `unsigned int` → `unsigned int`. `long long` with `unsigned long` (`size_t`): the signed type cannot represent all values of the unsigned one, so both become `unsigned long long`.',
          '`uint32_t * uint32_t` is computed in 32-bit unsigned arithmetic (wraps mod 2^32) *before* it is widened for the assignment. Integer division truncates toward zero.',
        ],
        explanation: `1. \`a + b\`: both \`uint8_t\` promote to \`int\` → 300 of type \`int\`. Storing into \`uint8_t\` reduces mod 256 → 44.
2. \`u + i\`: \`i\` converts to \`unsigned\` (2^32 − 2), plus 1 → 4294967295. \`-1 < 0u\`: −1 becomes UINT_MAX, so false.
3. The first loop casts \`size()\` to \`int\` → k = −1, 0, 1, 2 → 4 iterations. In the second, \`long long\` vs \`unsigned long\` (same width) converts **both** to \`unsigned long long\`, so −1 becomes 2^64 − 1 and the loop never runs.
4. \`pxTicks * qty\` = 6,000,000,000 computed in \`uint32_t\` wraps mod 2^32 → 1,705,032,704 (well-defined for unsigned, which is why no sanitizer catches it), *then* it is widened. Widening one operand first gives 6,000,000,000. In ticks that is \$17,050,327.04 vs \$60,000,000.00.
5. Division truncates toward zero: (−11)/2 = −5 (floor would be −6, so a "mid" of negative spread prices is biased toward zero); −7 % 2 = −1 (sign of the dividend).
6. \`pos += 30000\` computes 60000 as \`int\`, then converts to \`int16_t\`: modular since C++20 (implementation-defined before) → −5536.
7. \`int64_t * uint32_t\`: \`int64_t\` can represent every \`uint32_t\`, so the unsigned operand converts to signed 64-bit → −300.
8. \`int32_t * uint32_t\`: same rank, so it goes **unsigned**: −3 → 4294967293, × 100 mod 2^32 = 4294966996. A short position became four billion shares.`,
        timeLimitSec: 900,
        focusFile: 'promo.cpp',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Unsigned is safe, right?',
        prompt: 'Which of these expressions have **undefined behaviour** in C++20 on LP64? Select all that apply.',
        options: [
          '`std::uint16_t a = 50000, b = 50000; std::uint32_t c = a * b;`',
          '`std::uint32_t a = 4000000000u, b = 2; std::uint32_t c = a * b;`',
          '`std::int32_t p = 2000000000; std::int64_t n = p * 2;`',
          '`std::int32_t p = 2000000000; std::int64_t n = p * 2LL;`',
          '`std::int8_t x = 100; x += 100;`',
        ],
        correct: [0, 2],
        hints: ['`uint16_t` is narrower than `int`. What type is the multiplication actually performed in?'],
        explanation:
          '1: both `uint16_t` operands promote to **signed `int`**; 2.5e9 exceeds INT_MAX, which is signed overflow and therefore UB, even though every declared type is unsigned. Write `std::uint32_t(a) * b`. 2: `uint32_t` arithmetic wraps (defined, if wrong). 3: `int * int` overflows before widening, so UB. 4: `2LL` makes the multiplication 64-bit, so it is fine. 5: `x + 100` is computed in `int` (200, no overflow), then converted to `int8_t`: modular since C++20 (−56), not UB.',
        timeLimitSec: 420,
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'The overflow patch',
        prompt: 'A big fill (`pxTicks = 450025`, `qty = 10000`) produced a garbage VWAP. The assistant patches `notionalTicks`. Review it.',
        persona: 'confident-intern',
        request: 'notionalTicks overflows for large fills. Fix it.',
        aiReply: `The result is being truncated to 32 bits. Cast it to 64-bit:

\`\`\`cpp
inline std::int64_t notionalTicks(const Fill& f) {
    return static_cast<std::int64_t>(f.pxTicks * f.qty);
}
\`\`\`

Alternatively \`return f.pxTicks * f.qty * 1LL;\` does the same. Either way the return value is now 64-bit and can hold up to 9.2e18. ✅`,
        options: [
          'Accept: the explicit cast makes the multiplication 64-bit',
          'Accept the `* 1LL` variant only: the multiplier forces 64-bit arithmetic for the whole expression',
          'Reject: both variants still evaluate `f.pxTicks * f.qty` in 32-bit `int` first (`*` is left-associative), which overflows (UB) before any widening. One operand must be widened *before* multiplying: `std::int64_t(f.pxTicks) * f.qty`',
          'Reject: `static_cast` cannot convert between signed integer types; use `reinterpret_cast`',
        ],
        correct: 2,
        hints: ['Evaluate the types of each sub-expression, innermost first.'],
        explanation:
          'The type of an arithmetic expression depends only on its operands. `f.pxTicks * f.qty` is `int * int` → `int`; 450025 × 10000 = 4.5e9 > INT_MAX, which is signed overflow and therefore UB (the optimiser may assume it never happens). The cast then widens an already-garbage value. In `f.pxTicks * f.qty * 1LL` the left-associative grouping is `(f.pxTicks * f.qty) * 1LL`, so the same overflow happens first. Widen an operand: `std::int64_t{f.pxTicks} * f.qty`, and consider `__builtin_mul_overflow` or a checked helper for the 64-bit VWAP numerator too.',
        timeLimitSec: 420,
        focusFile: 'fixed.h',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 19. Lock-free: SPSC memory ordering and the Treiber-stack ABA
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-cpp-lockfree-aba',
    title: 'Relaxed Until It Isn\'t: SPSC Rings and ABA',
    level: 5,
    rating: 3000,
    lang: 'cpp',
    domain: 'concurrency',
    companies: ['hrt', 'jane-street', 'citadel', 'optiver'],
    tags: ['std-atomic', 'memory-order', 'acquire-release', 'lock-free', 'aba', 'ring-buffer'],
    summary: 'A market-data SPSC ring with one wrong memory order, and a lock-free order pool with a textbook ABA.',
    context:
      'The feed handler pushes decoded events into an SPSC ring read by the strategy thread. Order objects are recycled through a lock-free pool shared by all gateway threads. Tests pass on x86 dev boxes; the ARM (Graviton) canary shows corrupted events and duplicated order objects.',
    persona: 'confident-intern',
    files: [
      {
        path: 'spsc.h',
        content: `#pragma once
#include <atomic>
#include <cstddef>

// Single-producer / single-consumer ring buffer for market-data events.
template <typename T, std::size_t N>
class SpscRing {
    static_assert((N & (N - 1)) == 0, "N must be a power of two");
    T buf_[N];
    alignas(64) std::atomic<std::size_t> head_{0};  // written by consumer only
    alignas(64) std::atomic<std::size_t> tail_{0};  // written by producer only

public:
    // Producer thread only.
    bool push(const T& v) {
        std::size_t t = tail_.load(std::memory_order_relaxed);
        std::size_t h = head_.load(std::memory_order_acquire);
        if (t - h == N) return false;  // full
        buf_[t & (N - 1)] = v;
        tail_.store(t + 1, std::memory_order_relaxed);
        return true;
    }

    // Consumer thread only.
    bool pop(T& out) {
        std::size_t h = head_.load(std::memory_order_relaxed);
        std::size_t t = tail_.load(std::memory_order_acquire);
        if (h == t) return false;  // empty
        out = buf_[h & (N - 1)];
        head_.store(h + 1, std::memory_order_release);
        return true;
    }
};
`,
      },
      {
        path: 'treiber.h',
        content: `#pragma once
#include <atomic>

// Lock-free free-list of order objects, shared by all gateway threads.
struct OrderNode {
    OrderNode* next = nullptr;
    long orderId = 0;
};

class OrderPool {
    std::atomic<OrderNode*> head_{nullptr};

public:
    void release(OrderNode* n) {
        OrderNode* old = head_.load(std::memory_order_relaxed);
        do {
            n->next = old;
        } while (!head_.compare_exchange_weak(old, n, std::memory_order_release, std::memory_order_relaxed));
    }

    OrderNode* acquire() {
        OrderNode* old = head_.load(std::memory_order_acquire);
        while (old && !head_.compare_exchange_weak(old, old->next, std::memory_order_acq_rel,
                                                   std::memory_order_acquire)) {
        }
        return old;  // nullptr if empty
    }
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'find-bug',
        title: 'Corrupted events on ARM',
        prompt:
          'On ARM the strategy thread occasionally reads an event whose fields are half old, half new. Click the line with the wrong memory ordering and pick the explanation.',
        file: 'spsc.h',
        lines: [20],
        options: [
          'The producer publishes `tail_` with `memory_order_relaxed`. Without a release store there is no synchronizes-with edge to the consumer\'s acquire load, so the consumer can observe the new tail before the slot write `buf_[...] = v` is visible',
          'The consumer must load `head_` with acquire, because the producer may have modified it',
          '`t - h == N` overflows when the indices wrap around `SIZE_MAX`, so the full check is wrong',
          '`alignas(64)` on atomics is undefined behaviour and corrupts adjacent memory',
        ],
        correct: 0,
        hints: ['An acquire load only synchronizes with a **release** (or stronger) store that it reads from.'],
        explanation:
          'The protocol is message passing: write the payload, then publish the index. The consumer\'s `tail_.load(acquire)` synchronizes with the producer\'s store only if that store is a release operation. With `relaxed`, the compiler and the CPU are free to make the index visible before the payload. ARM\'s weak memory model really does reorder these stores, while x86 (TSO) never reorders store-store, so the bug hides on x86 (only compiler reordering could expose it there). Fix: `tail_.store(t + 1, std::memory_order_release)`. The consumer\'s own-index load can be relaxed (only it writes `head_`), and unsigned wrap-around makes `t - h` correct modulo 2^64.',
        timeLimitSec: 480,
        focusFile: 'spsc.h',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Minimal correct orderings',
        prompt: 'Assume line 20 is fixed to `release`. Select **all** true statements about the remaining orderings in `SpscRing`.',
        options: [
          'Each thread may load its *own* index with `relaxed`, because no other thread ever writes it',
          'The consumer\'s `head_.store(release)` paired with the producer\'s `head_.load(acquire)` prevents the producer from overwriting a slot the consumer is still copying out of',
          'Replacing every ordering with `memory_order_seq_cst` would still be correct (just potentially slower)',
          'Making `buf_` an array of `std::atomic<T>` accessed with `relaxed` would make the release/acquire on the indices unnecessary',
          'On x86 a `release` store compiles to an ordinary `mov`, so the fix costs nothing on the hot path there',
        ],
        correct: [0, 1, 2, 4],
        hints: ['Relaxed atomics on the payload still do not order the payload relative to the index.'],
        explanation:
          '1: a thread always sees its own latest write in modification order. 2: this is the second message-passing direction (the slot is "returned" to the producer). Without it, the producer could reuse the slot while `out = buf_[...]` is still reading it. 3: seq_cst is strictly stronger than acq/rel. 4: false: relaxed atomic slots avoid data-race UB but still let the consumer see the new index with the *old* slot value; you still need release/acquire on the index. 5: true, x86 TSO gives release semantics to plain stores (only seq_cst stores need `xchg`/`mfence`); the cost is limiting compiler reordering.',
        timeLimitSec: 540,
        focusFile: 'spsc.h',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: '"It\'s CAS, so it\'s atomic"',
        prompt: 'Gateways are seeing the same `OrderNode` handed to two threads. The assistant reviews `OrderPool`. Evaluate its reply.',
        persona: 'confident-intern',
        request: 'Is OrderPool::acquire thread-safe? We get duplicate order objects under load.',
        aiReply: `\`acquire()\` is correct. The \`compare_exchange_weak\` only succeeds if \`head_\` is still \`old\`, so no two threads can pop the same node, and the \`acq_rel\` ordering makes \`old->next\` visible. The duplicates must come from callers \`release()\`-ing the same node twice. Add a debug flag on \`OrderNode\` to catch double releases. 🔍`,
        options: [
          'Accept: CAS guarantees each node is popped once; look for double release',
          'Reject: `old->next` is read *before* the CAS. If between that read and the CAS other threads pop `old`, pop its successor, and push `old` back, `head_` equals `old` again, so the CAS succeeds and installs a stale `next` that points at a node now handed out elsewhere (ABA). Needs a version tag (double-width CAS), hazard pointers or epoch-based reclamation',
          'Reject: `compare_exchange_weak` can fail spuriously, so a node may be skipped; use `compare_exchange_strong`',
          'Reject: the failure ordering `memory_order_acquire` must be weaker than `relaxed`, which makes the call ill-formed',
        ],
        correct: 1,
        hints: ['The CAS compares pointer *values*. Can the same pointer value come back with a different successor?'],
        explanation:
          'CAS checks that `head_` has the same **value**, not that the stack is unchanged. Recycling makes the same address reappear with a different `next`: the ABA problem. The stale `next` is installed as the new head, so a node that another thread already owns becomes poppable again (duplicate order objects), and nodes that were pushed after it can be lost. If nodes were ever freed, reading `old->next` would also be a use-after-free. Spurious failure of `compare_exchange_weak` just loops (it reloads `old`), and acquire as the failure ordering is legal. Standard fixes: pair the pointer with a monotonically increasing tag in a 16-byte CAS, or use hazard pointers / epoch reclamation (or a per-thread pool).',
        timeLimitSec: 600,
        focusFile: 'treiber.h',
      },
      {
        id: 's4',
        kind: 'trace',
        title: 'Replay the ABA',
        prompt: 'The pool starts as `head → A → B → C`. Order the events of the interleaving that hands node B to two owners.',
        items: [
          'T1 in acquire(): loads head = A and reads A->next = B',
          'T1 is preempted before its compare_exchange',
          'T2 acquires A (head = B)',
          'T2 acquires B (head = C); B is now owned by T2',
          'T2 releases A back to the pool (A->next = C, head = A)',
          'T1 resumes: CAS(head, expected A, desired B) succeeds because head == A again',
          'head = B: the pool now hands out B (owned by T2) and C has fallen off the list',
        ],
        hints: ['The CAS at the end must see `head == A`, so A has to be released back after being taken.'],
        explanation:
          'T1 captured `next = B` while A was the head. T2 then changed the list twice and restored the *pointer* A at the head, now with `A->next = C`. T1\'s CAS only compares `head_` with A, succeeds, and writes the stale B. Result: B is simultaneously owned by T2 and at the head of the free list (duplicate order objects), and C is leaked. A tag incremented on every successful CAS makes the second comparison fail.',
        timeLimitSec: 420,
        focusFile: 'treiber.h',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 20. Initialisation order: statics, function-local statics, virtual calls in ctors
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-cpp-init-order',
    title: 'Before Main, After Main',
    level: 5,
    rating: 2550,
    lang: 'cpp',
    domain: 'language-semantics',
    companies: ['jane-street', 'de-shaw', 'microsoft', 'generic'],
    tags: ['static-initialization', 'function-local-static', 'virtual-dispatch', 'destruction-order', 'constexpr'],
    summary: 'Zero-, constant- and dynamic initialisation in one TU, construct-on-first-use, and virtual dispatch during construction and destruction.',
    context:
      'The strategy host registers components from global constructors and logs through a lazily created logger. A colleague claims "virtual functions don\'t work in constructors" and another that "globals are initialised in random order". Both are half right.',
    persona: 'outdated-docs',
    files: [
      {
        path: 'init.cpp',
        content: `#include <cstdio>
#include <string>

struct Logger {
    Logger() { std::puts("Logger ctor"); }
    ~Logger() { std::puts("Logger dtor"); }
    void log(const char* m) { std::printf("log: %s\\n", m); }
};

Logger& logger() {
    static Logger instance;
    return instance;
}

int compute() {
    std::puts("compute()");
    return 42;
}

extern int late;
int early = late + 1;
int late = compute();
constexpr int kTick = 25;
int early2 = kTick * 2;

struct Strategy {
    Strategy() {
        std::printf("Strategy ctor: %s\\n", name());
        init();
    }
    virtual ~Strategy() { std::printf("Strategy dtor: %s\\n", name()); }
    virtual const char* name() const { return "base"; }
    void init() { std::printf("init via %s\\n", name()); }
};

struct MeanRev : Strategy {
    std::string sym = "ES";
    MeanRev() { std::printf("MeanRev ctor: %s %s\\n", name(), sym.c_str()); }
    ~MeanRev() override { std::printf("MeanRev dtor: %s\\n", name()); }
    const char* name() const override { return "meanrev"; }
};

struct Registered {
    const char* id;
    explicit Registered(const char* i) : id(i) {
        std::printf("register %s\\n", id);
        if (id[0] == 'B') logger().log(id);
    }
    ~Registered() { std::printf("unregister %s\\n", id); }
};

Registered regA("A");
Registered regB("B");

int main() {
    std::printf("main: early=%d late=%d early2=%d\\n", early, late, early2);
    {
        MeanRev m;
        Strategy& s = m;
        std::printf("dispatch: %s\\n", s.name());
    }
    static Registered regC("C");
    logger().log("done");
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'The whole life of the process',
        prompt: 'Predict the complete output of `init.cpp` (a single translation unit).',
        answer:
          'compute()\nregister A\nregister B\nLogger ctor\nlog: B\nmain: early=1 late=42 early2=50\nStrategy ctor: base\ninit via base\nMeanRev ctor: meanrev ES\ndispatch: meanrev\nMeanRev dtor: meanrev\nStrategy dtor: base\nregister C\nlog: done\nunregister C\nunregister B\nLogger dtor\nunregister A',
        options: [
          'compute()\nregister A\nregister B\nLogger ctor\nlog: B\nmain: early=1 late=42 early2=50\nStrategy ctor: base\ninit via base\nMeanRev ctor: meanrev ES\ndispatch: meanrev\nMeanRev dtor: meanrev\nStrategy dtor: base\nregister C\nlog: done\nunregister C\nunregister B\nLogger dtor\nunregister A',
          'compute()\nregister A\nregister B\nLogger ctor\nlog: B\nmain: early=43 late=42 early2=50\nStrategy ctor: meanrev\ninit via meanrev\nMeanRev ctor: meanrev ES\ndispatch: meanrev\nMeanRev dtor: meanrev\nStrategy dtor: meanrev\nregister C\nlog: done\nunregister C\nunregister B\nunregister A\nLogger dtor',
          'Logger ctor\ncompute()\nregister A\nregister B\nlog: B\nmain: early=1 late=42 early2=50\nStrategy ctor: base\ninit via base\nMeanRev ctor: meanrev ES\ndispatch: meanrev\nMeanRev dtor: meanrev\nStrategy dtor: base\nregister C\nlog: done\nLogger dtor\nunregister C\nunregister B\nunregister A',
          'compute()\nregister A\nregister B\nLogger ctor\nlog: B\nregister C\nmain: early=1 late=42 early2=50\nStrategy ctor: base\ninit via meanrev\nMeanRev ctor: meanrev ES\ndispatch: meanrev\nMeanRev dtor: meanrev\nStrategy dtor: base\nlog: done\nunregister C\nunregister B\nLogger dtor\nunregister A',
        ],
        hints: [
          'All statics are zero-initialised first, then constant-initialised (`early2 = kTick * 2` is a constant expression), then dynamically initialised in definition order within the TU.',
          'A function-local static is initialised the first time control passes through its declaration, and objects with static storage are destroyed in reverse order of the **completion** of their constructors.',
          'During a base-class constructor or destructor, the dynamic type of the object *is* the base class.',
        ],
        explanation: `**Static init.** Zero-initialisation sets \`early\`, \`late\` to 0. \`early2 = kTick * 2\` is a constant expression, so it is constant-initialised (50) before any dynamic code. Dynamic initialisation then runs in definition order within the TU: \`early = late + 1\` reads the still-zero \`late\`, so 1 (any permitted early static initialisation must produce the same value). Then \`late = compute()\` prints and gives 42. \`regA\`, then \`regB\`, whose constructor calls \`logger()\` for the first time, so the function-local static \`Logger\` is constructed **during** \`regB\`'s constructor.

**Construction/destruction dispatch.** In \`Strategy()\` the object's dynamic type is \`Strategy\` (the \`MeanRev\` part does not exist yet, and its \`sym\` is unconstructed), so both the direct virtual call and the call through the non-virtual \`init()\` resolve to \`Strategy::name\`. In \`~Strategy()\`, the \`MeanRev\` part is already destroyed, so it is \`base\` again. A reference to the complete object dispatches normally.

**Local static in main.** \`regC\` is constructed when control first reaches it.

**Exit.** Static-storage objects are destroyed in reverse order of *completion* of construction. The completion order is: regA, Logger (finished inside regB's ctor), regB, regC. So the reverse is: regC, regB, Logger, regA. Note that \`regA\` cannot safely log in its destructor: the Logger is already gone.`,
        timeLimitSec: 720,
        focusFile: 'init.cpp',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Across translation units',
        prompt:
          'Now split the program: `fees.cpp` defines `std::map<std::string,int> g_fees = loadFees();` and `venues.cpp` defines `Venue g_default(g_fees.at("XNAS"));` (both dynamically initialised, non-inline globals). Select **all** true statements.',
        options: [
          'The relative order of dynamic initialisation of `g_fees` and `g_default` is unspecified (indeterminately sequenced), so `g_default` may read an empty, zero-initialised map: in practice UB or an exception',
          'The link order on the command line is guaranteed by the standard to determine initialisation order',
          'Replacing `g_fees` with a function returning a reference to a function-local static (`const auto& fees() { static auto m = loadFees(); return m; }`) makes `g_default`\'s initialisation safe',
          'Calling a pure virtual function (directly or indirectly) from an abstract base\'s constructor is undefined behaviour',
          'Declaring `g_fees` as `constinit` would make the original code correct as written',
        ],
        correct: [0, 2, 3],
        hints: ['`constinit` requires the initialiser to be a constant expression. Is `loadFees()` one?'],
        explanation:
          'Across TUs, dynamic initialisation of non-inline variables is indeterminately sequenced (the "static initialisation order fiasco"); link order is a toolchain behaviour, not a guarantee. Construct-on-first-use via a function-local static fixes the ordering (and since C++11 its initialisation is thread-safe). Calling a pure virtual during construction is UB ([class.abstract]); typically it crashes with "pure virtual method called". `constinit` only *asserts* constant initialisation. Since `loadFees()` is not a constant expression, the program would simply fail to compile.',
        timeLimitSec: 420,
      },
    ],
  },
];

export default problems;
