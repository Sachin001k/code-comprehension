import type { Problem } from '../types';

/**
 * Level 1 "Line Reader" — C++ and TypeScript slice (author b).
 */
const problems: Problem[] = [
  // ───────────────────────────────────────────────────────────── C1
  {
    id: 'l1-b-cpp-split-adjust',
    title: 'The Stock Split That Never Happened',
    level: 1,
    rating: 900,
    lang: 'cpp',
    domain: 'portfolio',
    companies: ['citadel', 'hrt', 'two-sigma'],
    tags: ['references', 'copies', 'range-for', 'pass-by-value'],
    summary: 'A 2:1 split adjustment loop runs, yet every position is unchanged.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <string>
#include <vector>

struct Position {
    std::string symbol;
    int qty;
};

void addFill(Position p, int fill) { p.qty += fill; }
void addFillRef(Position& p, int fill) { p.qty += fill; }

int main() {
    std::vector<Position> book = {{"AAPL", 100}, {"MSFT", 50}};

    // Double every position after a 2:1 stock split.
    for (auto pos : book) pos.qty *= 2;
    std::cout << book[0].qty << " " << book[1].qty << "\\n";

    for (auto& pos : book) pos.qty += 1;
    std::cout << book[0].qty << " " << book[1].qty << "\\n";

    addFill(book[0], 10);
    addFillRef(book[1], 10);
    std::cout << book[0].qty << " " << book[1].qty << "\\n";

    Position snapshot = book[0];
    Position& live = book[1];
    snapshot.qty = 0;
    live.qty = 0;
    std::cout << book[0].qty << " " << book[1].qty << "\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print?',
        answer: '100 50\n101 51\n101 61\n101 0',
        options: [
          '100 50\n101 51\n101 61\n101 0',
          '200 100\n201 101\n211 111\n0 0',
          '200 100\n201 101\n201 111\n201 0',
          '100 50\n101 51\n111 61\n0 0',
        ],
        hints: [
          '`auto pos` deduces `Position` (a copy); `auto& pos` deduces `Position&`.',
          'A by-value parameter is a fresh copy of the argument.',
        ],
        explanation:
          '`for (auto pos : book)` copies each element, so doubling changes the copies only (100 50). `auto&` binds to the elements (101 51). `addFill` takes a copy; `addFillRef` modifies `book[1]` (101 61). `snapshot` is a copy, `live` is an alias, so only `book[1]` is zeroed (101 0).',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the bug',
        prompt: 'The split adjustment has no effect. Click the line and pick the root cause.',
        file: 'main.cpp',
        lines: [17],
        options: [
          '`auto pos` copies each `Position`; the loop modifies the copy, not the element in the vector',
          '`qty *= 2` overflows `int`',
          'Range-for loops over a `std::vector` iterate in reverse',
          'Missing braces around the loop body mean only the first element is updated',
        ],
        correct: 0,
        hints: ['Compare line 17 with line 20.'],
        explanation:
          'Use `for (auto& pos : book)` to modify in place (or `const auto&` to read without copying). Copying a struct with a `std::string` in every iteration is also a hidden performance cost.',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C2
  {
    id: 'l1-b-cpp-signed-unsigned',
    title: 'Minus One Is Huge',
    level: 1,
    rating: 1100,
    lang: 'cpp',
    domain: 'market-data',
    companies: ['optiver', 'hrt', 'jane-street'],
    tags: ['signed-unsigned', 'size_t', 'usual-arithmetic-conversions'],
    summary: 'Comparing an `int` with `size()` and subtracting from an empty vector\'s size.',
    context: 'The signals team computes rolling windows over mid prices. A config of `lookback = -1` ("all history") is being rejected as too large.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <vector>

int main() {
    std::vector<double> mids = {101.5, 102.0, 99.75};
    int lookback = -1;  // -1 means "use all history"
    if (lookback < mids.size()) {
        std::cout << "window ok\\n";
    } else {
        std::cout << "window too large\\n";
    }

    std::vector<double> empty;
    std::cout << empty.size() - 1 << "\\n";

    unsigned int filled = 3;
    int delta = -5;
    std::cout << delta + filled << "\\n";
    std::cout << (delta < static_cast<int>(filled)) << "\\n";
}
`,
      },
      {
        path: 'spread.hpp',
        content: `#pragma once
#include <vector>

// Sum of consecutive mid-price changes (equals last - first); 0 for fewer than 2 samples.
inline double totalMove(const std::vector<double>& mids) {
    double move = 0.0;
    for (std::size_t i = 0; i < mids.size() - 1; ++i) {
        move += mids[i + 1] - mids[i];
    }
    return move;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print on a 64-bit platform (`size_t` is 64-bit, `unsigned int` is 32-bit)?',
        answer: 'window too large\n18446744073709551615\n4294967294\n1',
        options: [
          'window too large\n18446744073709551615\n4294967294\n1',
          'window ok\n-1\n-2\n1',
          'window too large\n18446744073709551615\n-2\n1',
          'window ok\n18446744073709551615\n4294967294\n0',
        ],
        hints: [
          'When an `int` meets an unsigned type of equal or greater rank, the `int` is converted to unsigned.',
          '-1 converted to a 64-bit unsigned value is 2^64 - 1.',
        ],
        explanation:
          '`lookback < mids.size()` converts -1 to `size_t` (18446744073709551615), which is not less than 3. `empty.size() - 1` is unsigned arithmetic: 0 - 1 wraps to 2^64 - 1 (well-defined for unsigned). `delta + filled` is `unsigned int`: -5 + 3 = -2 → 2^32 - 2 = 4294967294. Casting `filled` to `int` makes the last comparison signed: -5 < 3 → 1.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Crash on an empty series',
        prompt: '`totalMove({})` in `spread.hpp` reads far out of bounds. Click the line and choose the cause.',
        file: 'spread.hpp',
        lines: [7],
        options: [
          '`mids.size() - 1` wraps to the maximum `size_t` when the vector is empty, so the loop condition is true for a huge range',
          '`i` should start at 1 because `mids[0]` is uninitialised',
          '`mids[i + 1]` overflows `double`',
          'Passing by `const&` prevents reading the elements',
        ],
        correct: 0,
        hints: ['What is `std::size_t(0) - 1`?'],
        explanation:
          'With an empty vector the bound becomes 18446744073709551615 and `mids[i + 1]` reads out of bounds (undefined behaviour). Rewrite as `i + 1 < mids.size()`, which never subtracts from an unsigned value.',
        timeLimitSec: 150,
        focusFile: 'spread.hpp',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C3
  {
    id: 'l1-b-cpp-map-brackets',
    title: 'The Limit That Appeared From Nowhere',
    level: 1,
    rating: 950,
    lang: 'cpp',
    domain: 'risk',
    companies: ['citadel', 'two-sigma', 'blackrock'],
    tags: ['std-map', 'operator-brackets', 'lookup'],
    summary: 'Checking a risk limit silently adds a new symbol to the limits table.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <map>
#include <string>

int main() {
    std::map<std::string, int> limits = {{"AAPL", 500}, {"TSLA", 200}};
    std::cout << limits.size() << "\\n";

    if (limits["NVDA"] > 0) {
        std::cout << "NVDA allowed\\n";
    }
    std::cout << limits.size() << "\\n";

    std::cout << limits.count("GOOG") << " " << limits.size() << "\\n";

    for (const auto& [sym, lim] : limits) {
        std::cout << sym << "=" << lim << " ";
    }
    std::cout << "\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print?',
        answer: '2\n3\n0 3\nAAPL=500 NVDA=0 TSLA=200',
        options: [
          '2\n3\n0 3\nAAPL=500 NVDA=0 TSLA=200',
          '2\n2\n0 2\nAAPL=500 TSLA=200',
          '2\n3\n0 4\nAAPL=500 GOOG=0 NVDA=0 TSLA=200',
          '2\n3\n0 3\nAAPL=500 TSLA=200 NVDA=0',
        ],
        hints: [
          '`operator[]` must return a reference to *something*, even for a missing key.',
          '`std::map` iterates in key order.',
        ],
        explanation:
          '`limits["NVDA"]` inserts `{"NVDA", 0}` (value-initialised `int`) and returns a reference to it, so the size goes 2 → 3 and the check fails. `count` never inserts. `std::map` is ordered, so NVDA appears between AAPL and TSLA.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Lookups that do not insert',
        prompt: 'Which of these lookups on `limits` **never** insert a new element? Select all that apply.',
        options: [
          '`limits.find("X")`',
          '`limits.count("X")`',
          '`limits["X"]`',
          '`limits.at("X")`',
          '`limits.contains("X")` (C++20)',
        ],
        correct: [0, 1, 3, 4],
        hints: ['Only one of these can be used to *write* a new key.'],
        explanation:
          '`find`, `count` and `contains` are read-only. `at` throws `std::out_of_range` for a missing key instead of inserting. Only `operator[]` inserts, which is also why it cannot be called on a `const std::map`.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'A tidy helper?',
        prompt: 'The assistant offers a helper for read-only limit lookups. Accept or reject?',
        persona: 'api-dreamer',
        request: 'Write a helper that returns the limit for a symbol, or 0 if there is none, without modifying the map.',
        aiReply: `Use the built-in default-value overload, just like Python's \`dict.get\`:

\`\`\`cpp
int limitFor(const std::map<std::string, int>& limits, const std::string& sym) {
    return limits.get(sym, 0);
}
\`\`\`

Since the map is \`const&\`, the compiler guarantees nothing is inserted.`,
        options: [
          'Accept: `get` with a default never inserts and the `const&` makes it safe',
          'Reject: `std::map` has no `get` member; use `auto it = limits.find(sym); return it == limits.end() ? 0 : it->second;`',
          'Reject: should be `return limits[sym];` because a missing key already yields 0',
          'Reject: `get` exists but throws `std::out_of_range` when the key is missing',
        ],
        correct: 1,
        hints: ['Check the members of `std::map` on cppreference.'],
        explanation:
          '`std::map::get` does not exist; this will not compile. `limits[sym]` would not compile either on a `const` map (and would insert on a non-const one). `find` + compare with `end()` is the idiomatic read-only lookup.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C4
  {
    id: 'l1-b-cpp-fix-substr',
    title: 'FIX Tag Parser',
    level: 1,
    rating: 800,
    lang: 'cpp',
    domain: 'parser',
    companies: ['optiver', 'jane-street', 'jpmorgan'],
    tags: ['std-string', 'substr', 'npos'],
    summary: '`substr(start, end)` reads like Java\'s `substring`. It is not.',
    context: 'Order messages arrive in FIX format: `tag=value` pairs separated by `|`. The symbol for every order is coming out wrong.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <string>

// Returns the value of a FIX tag, e.g. extractTag(msg, "55") -> "AAPL".
std::string extractTag(const std::string& msg, const std::string& tag) {
    std::size_t start = msg.find(tag + "=");
    if (start == std::string::npos) return "";
    start += tag.size() + 1;
    std::size_t end = msg.find('|', start);
    return msg.substr(start, end);
}

int main() {
    std::string order = "35=D|55=AAPL|38=100|44=187.5";
    std::cout << extractTag(order, "35") << "\\n";
    std::cout << extractTag(order, "55") << "\\n";
    std::cout << extractTag(order, "44") << "\\n";
    std::cout << "[" << extractTag(order, "99") << "]\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print?',
        answer: 'D|55\nAAPL|38=100|\n187.5\n[]',
        options: [
          'D|55\nAAPL|38=100|\n187.5\n[]',
          'D\nAAPL\n187.5\n[]',
          'D\nAAPL|38=10\n187.5\n[]',
          'D|55\nAAPL|38=100|\n187.5\n[44=187.5]',
        ],
        hints: [
          '`std::string::substr(pos, count)` takes a **length**, not an end index.',
          'If `count` runs past the end of the string, `substr` just stops at the end.',
        ],
        explanation:
          'For tag 35: start = 3, end = 4, so `substr(3, 4)` takes 4 characters: `D|55`. For 55: start = 8, end = 12, `substr(8, 12)` takes 12 characters: `AAPL|38=100|`. For 44 there is no following `|`, so `end` is `npos` and `substr(23, npos)` correctly takes the rest. Tag 99 is not found → empty.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the bug',
        prompt: 'Click the buggy line and choose the root cause.',
        file: 'main.cpp',
        lines: [10],
        options: [
          '`substr`\'s second argument is a length; passing the end index takes too many characters. Use `end - start`.',
          '`find` returns a 1-based index, so `start` is off by one',
          '`substr` returns a view into `msg` that dangles after return',
          '`find(\'|\', start)` searches backwards from `start`',
        ],
        correct: 0,
        hints: ['Look at what `substr` received for tag 35: `(3, 4)`.'],
        explanation:
          '`msg.substr(start, end - start)` fixes it. When `end == npos`, `npos - start` is still huge, so the last field still works. `std::string::substr` returns a new `std::string` (a copy), not a view.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Why does tag 44 work?',
        prompt: 'Even with the bug, `extractTag(order, "44")` returns `187.5`. Why?',
        options: [
          'There is no `|` after it, so `end` is `std::string::npos` and `substr(pos, npos)` means "to the end of the string"',
          '`187.5` is a number, so `substr` stops at the decimal point',
          '`find` returns the length of the string when not found',
          'It is the last tag, so `start` is 0',
        ],
        correct: [0],
        hints: ['What does `find` return when the character is not present?'],
        explanation: '`npos` is the largest `size_t`. As a `count`, any value past the end is clamped, so passing `npos` reads the remainder. Tests that only check the last field would never catch this bug.',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C5
  {
    id: 'l1-b-cpp-uint8-promotion',
    title: 'Eight-Bit Sequence Numbers',
    level: 1,
    rating: 1200,
    lang: 'cpp',
    domain: 'market-data',
    companies: ['hrt', 'jane-street', 'optiver'],
    tags: ['integer-promotion', 'uint8_t', 'iostream'],
    summary: 'Small integer types are promoted to `int` before arithmetic, and `uint8_t` prints as a character.',
    persona: 'confident-intern',
    context: 'A UDP feed carries an 8-bit sequence number that wraps from 255 to 0. You are reviewing the gap detector.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <cstdint>
#include <iostream>

int main() {
    std::uint8_t seq = 250;   // 8-bit packet sequence number from the feed
    std::uint8_t step = 10;
    auto sum = seq + step;
    std::uint8_t wrapped = seq + step;
    std::cout << sum << " " << +wrapped << "\\n";
    std::cout << sizeof(seq + step) << "\\n";

    std::uint8_t msgType = 65;
    std::cout << msgType << " " << +msgType << "\\n";

    char side = 'a';
    std::cout << side + 1 << " " << char(side + 1) << "\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print (`int` is 32-bit)?',
        answer: '260 4\n4\nA 65\n98 b',
        options: ['260 4\n4\nA 65\n98 b', '4 4\n1\n65 65\nb b', '260 4\n1\nA 65\n98 b', '4 4\n4\nA A\n98 b'],
        hints: [
          'Operands narrower than `int` are promoted to `int` before `+`.',
          '`std::uint8_t` is a typedef for `unsigned char`, and `<<` prints chars as characters. Unary `+` promotes to `int`.',
        ],
        explanation:
          '`seq + step` is `int` 260, so `auto sum` is `int` and `sizeof` is 4. Storing 260 into `uint8_t` wraps modulo 256 to 4; `+wrapped` prints it as a number. `msgType` (65) is an `unsigned char` and prints as `A`; `+msgType` prints `65`. `side + 1` is `int` 98; `char(98)` is `b`.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Gap detector review',
        prompt: 'The assistant wrote the gap detector. Accept or reject?',
        persona: 'confident-intern',
        request: 'Write isGap(last, next) for our 8-bit wrapping sequence numbers. 255 followed by 0 is NOT a gap.',
        aiReply: `Easy, \`uint8_t\` arithmetic wraps for us:

\`\`\`cpp
bool isGap(std::uint8_t last, std::uint8_t next) {
    // uint8_t wraps, so 255 -> 0 gives next - last == 1 automatically
    return next - last != 1;
}
\`\`\`

Tested with (4, 5) → false and (4, 7) → true. ✅`,
        options: [
          'Accept: unsigned 8-bit subtraction wraps, so 0 - 255 == 1',
          'Reject: both operands are promoted to `int`, so 0 - 255 is -255 and every wraparound is reported as a gap; use `static_cast<std::uint8_t>(next - last) != 1`',
          'Reject: subtracting unsigned values that underflow is undefined behaviour',
          'Reject: should be `return next != last + 1;`, which handles the wrap',
        ],
        correct: 1,
        hints: ['What type is `next - last`? Look at the `sizeof` line above.'],
        explanation:
          'Integer promotion turns both `uint8_t`s into `int` before subtracting, so no 8-bit wrap happens: 0 - 255 = -255. Casting the result back to `uint8_t` reapplies modulo-256 (-255 → 1). `last + 1` has the same problem (255 + 1 = 256, not 0). There is no UB here: the arithmetic is on `int` and does not overflow.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C6
  {
    id: 'l1-b-cpp-vector-sizing',
    title: 'Zeroes at the Top of the Book',
    level: 1,
    rating: 850,
    lang: 'cpp',
    domain: 'orderbook',
    companies: ['citadel', 'optiver', 'apple'],
    tags: ['std-vector', 'reserve', 'resize', 'push_back'],
    summary: '`vector(n)`, `reserve(n)`, `resize(n)` and `{a, b}` all do different things.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <vector>

int main() {
    std::vector<int> qty;
    qty.reserve(4);
    std::cout << qty.size() << "\\n";

    std::vector<int> px(3);
    px.push_back(7);
    std::cout << px.size() << " " << px[0] << " " << px.back() << "\\n";

    std::vector<int> lots(3, 100);
    lots.resize(5);
    std::cout << lots.size() << " " << lots[4] << "\\n";

    std::vector<int> ids{3, 100};
    std::cout << ids.size() << "\\n";
}
`,
      },
      {
        path: 'depth.hpp',
        content: `#pragma once
#include <vector>

struct Level {
    double price;
    int qty;
};

// Build the top-N price ladder from raw levels (best first).
inline std::vector<Level> topOfBook(const std::vector<Level>& levels, std::size_t n) {
    std::vector<Level> out(n);
    for (std::size_t i = 0; i < n && i < levels.size(); ++i) {
        out.push_back(levels[i]);
    }
    return out;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print?',
        answer: '0\n4 0 7\n5 0\n2',
        options: ['0\n4 0 7\n5 0\n2', '4\n1 7 7\n5 100\n100', '0\n4 0 7\n5 100\n3', '4\n4 0 7\n5 0\n2'],
        hints: [
          '`reserve` changes capacity, not size.',
          '`vector<int>(3)` holds three zeroes; `resize` value-initialises new elements; braces call the `initializer_list` constructor.',
        ],
        explanation:
          '`reserve(4)` allocates but size stays 0. `px(3)` is `{0,0,0}`; `push_back(7)` appends → size 4, `px[0]` 0, back 7. `lots(3, 100)` is three 100s; `resize(5)` adds two zeroes, so `lots[4]` is 0. `ids{3, 100}` is a two-element list, not "three 100s".',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Ghost levels',
        prompt: '`topOfBook(levels, 5)` returns 10 levels and the first five are `{0, 0}`. Click the bug and pick the cause.',
        file: 'depth.hpp',
        lines: [11],
        options: [
          '`std::vector<Level> out(n)` already holds `n` value-initialised levels; `push_back` appends after them. Use `out.reserve(n)` instead.',
          'The loop condition should use `||` instead of `&&`',
          '`push_back` inserts at the front of a vector',
          'Returning a local vector by value copies garbage',
        ],
        correct: 0,
        hints: ['What is `out.size()` before the loop?'],
        explanation:
          'The sizing constructor creates `n` elements. Either keep it and assign by index (`out[i] = levels[i]`, then shrink), or — clearer — `reserve(n)` and `push_back`. Returning by value is fine (move/NRVO).',
        timeLimitSec: 150,
        focusFile: 'depth.hpp',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C7
  {
    id: 'l1-b-cpp-const-config',
    title: 'Read-Only Risk Defaults',
    level: 1,
    rating: 1000,
    lang: 'cpp',
    domain: 'risk',
    companies: ['two-sigma', 'de-shaw', 'citadel'],
    tags: ['const', 'references', 'auto-deduction'],
    summary: 'Copies, const references and what `auto` keeps or drops.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <string>

struct RiskConfig {
    std::string venue = "XNAS";
    int maxQty = 1000;
};

const RiskConfig& defaults() {
    static RiskConfig cfg;
    return cfg;
}

int main() {
    RiskConfig local = defaults();
    local.maxQty = 50;
    const RiskConfig& shared = defaults();
    std::cout << shared.maxQty << " " << local.maxQty << "\\n";

    int limit = 10;
    const int& view = limit;
    const int snapshot = limit;
    limit += 5;
    std::cout << view << " " << snapshot << "\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print?',
        answer: '1000 50\n15 10',
        options: ['1000 50\n15 10', '50 50\n15 10', '1000 50\n10 10', '50 50\n15 15'],
        hints: [
          'Initialising a non-reference variable from a reference makes a copy.',
          '`const int&` means "I can\'t change it through this name", not "it never changes".',
        ],
        explanation:
          '`local` is a copy of the static config, so changing it leaves the original at 1000. `view` is a reference to `limit` and sees the update (15); `snapshot` copied the value 10 at initialisation.',
        timeLimitSec: 150,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'What compiles?',
        prompt: 'Each snippet is added on its own at the end of `main`. Which ones **compile**? Select all that apply.',
        options: [
          '`shared.maxQty = 5;`',
          '`view++;`',
          '`local.venue = "XLON";`',
          '`auto& r = defaults(); r.maxQty = 1;`',
          '`auto c = defaults(); c.maxQty = 1;`',
        ],
        correct: [2, 4],
        hints: ['`auto` drops top-level const and references; `auto&` keeps the const of what it binds to.'],
        explanation:
          '`shared` and `view` are references to const, so writes through them are errors. `local` is a non-const copy. `auto& r` deduces `const RiskConfig&`, so `r.maxQty = 1` fails. Plain `auto c` deduces `RiskConfig` (a mutable copy), so it compiles — and silently modifies only the copy.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C8
  {
    id: 'l1-b-cpp-short-circuit',
    title: 'Pre-Trade Checks',
    level: 1,
    rating: 700,
    lang: 'cpp',
    domain: 'risk',
    companies: ['jane-street', 'hrt', 'generic'],
    tags: ['short-circuit', 'side-effects', 'operator-precedence'],
    summary: 'Which checks actually run? Count the calls.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>

int calls = 0;

bool marketOpen(bool open) {
    ++calls;
    std::cout << "open ";
    return open;
}

bool riskCheck(int qty) {
    ++calls;
    std::cout << "risk(" << qty << ") ";
    return qty <= 500;
}

int main() {
    bool a = marketOpen(false) && riskCheck(100);
    std::cout << "| " << a << "\\n";
    bool b = marketOpen(true) || riskCheck(900);
    std::cout << "| " << b << "\\n";
    bool c = marketOpen(true) && riskCheck(900);
    std::cout << "| " << c << "\\n";
    std::cout << "calls=" << calls << "\\n";
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `main.cpp` print? (`bool` prints as `0`/`1` by default.)',
        answer: 'open | 0\nopen | 1\nopen risk(900) | 0\ncalls=4',
        options: [
          'open | 0\nopen | 1\nopen risk(900) | 0\ncalls=4',
          'open risk(100) | 0\nopen risk(900) | 1\nopen risk(900) | 0\ncalls=6',
          'open | false\nopen | true\nopen risk(900) | false\ncalls=4',
          'open | 0\nopen risk(900) | 1\nopen risk(900) | 0\ncalls=5',
        ],
        hints: ['`&&` stops at the first `false`; `||` stops at the first `true`.'],
        explanation:
          '`a`: `marketOpen(false)` is false, so `riskCheck` is skipped. `b`: `marketOpen(true)` is true, so `||` skips the right side. `c`: left is true, so `&&` must evaluate `riskCheck(900)` → false. Four calls in total. Without `std::boolalpha`, `bool` prints as 0/1.',
        timeLimitSec: 150,
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a mixed expression',
        prompt: 'Order the steps for `bool ok = marketOpen(true) && riskCheck(900) || riskCheck(100);`',
        items: [
          '`marketOpen(true)` prints `open ` and returns true',
          '`&&` needs its right side: `riskCheck(900)` prints `risk(900) ` and returns false',
          'The `&&` sub-expression is false, so `||` evaluates its right side',
          '`riskCheck(100)` prints `risk(100) ` and returns true',
          '`ok` is assigned true',
        ],
        hints: ['`&&` binds tighter than `||`: the expression is `(A && B) || C`.'],
        explanation:
          'Precedence groups it as `(marketOpen(true) && riskCheck(900)) || riskCheck(100)`. Built-in `&&`/`||` evaluate left to right with a sequence point, and only evaluate the right side when needed. (Overloaded `operator&&` on user types loses short-circuiting — another reason to avoid overloading it.)',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── T1
  {
    id: 'l1-b-ts-free-shipping',
    title: 'Free Shipping Costs $4.99',
    level: 1,
    rating: 800,
    lang: 'typescript',
    domain: 'checkout',
    companies: ['canva', 'amazon', 'stripe'],
    tags: ['nullish-coalescing', 'logical-or', 'optional-chaining', 'falsy-values'],
    summary: 'Customers with free shipping are being charged the standard rate.',
    context: 'Marketing launched a free-shipping campaign (`shippingCents: 0`). Support tickets say checkout still adds $4.99.',
    files: [
      {
        path: 'src/pricing.ts',
        content: `export interface Promo {
  code: string;
  percentOff: number;
}

export interface Cart {
  subtotalCents: number;
  promo?: Promo | null;
  /** 0 means free shipping; undefined means "use the standard rate". */
  shippingCents?: number;
}

const STANDARD_SHIPPING_CENTS = 499;

export function quote(cart: Cart): string {
  const shipping = cart.shippingCents || STANDARD_SHIPPING_CENTS;
  const pct = cart.promo?.percentOff ?? 0;
  const code = cart.promo?.code ?? 'NONE';
  const total = Math.round(cart.subtotalCents * (1 - pct / 100)) + shipping;
  return code + ':' + total;
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { quote } from './pricing';

console.log(quote({ subtotalCents: 2000, shippingCents: 0 }));
console.log(quote({ subtotalCents: 2000 }));
console.log(quote({ subtotalCents: 2000, promo: null, shippingCents: 250 }));
console.log(quote({ subtotalCents: 2000, promo: { code: 'STAFF', percentOff: 10 }, shippingCents: 0 }));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: 'NONE:2499\nNONE:2499\nNONE:2250\nSTAFF:2299',
        options: [
          'NONE:2499\nNONE:2499\nNONE:2250\nSTAFF:2299',
          'NONE:2000\nNONE:2499\nNONE:2250\nSTAFF:1800',
          'NONE:2499\nNONE:2499\nnull:2250\nSTAFF:2299',
          'NONE:2000\nNONE:2499\nNONE:2250\nSTAFF:2299',
        ],
        hints: [
          '`||` returns the right side for *any* falsy left side: `0`, `""`, `NaN`, `null`, `undefined`, `false`.',
          '`?.` returns `undefined` when the object on its left is `null` or `undefined`.',
        ],
        explanation:
          '`0 || 499` is 499, so free shipping is lost in both the first and last carts. `cart.promo?.code` on a `null` promo is `undefined`, and `?? \'NONE\'` supplies the default. 2000 × 0.9 = 1800 + 499 = 2299.',
        timeLimitSec: 180,
        focusFile: 'src/pricing.ts',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Honour free shipping',
        prompt: 'Fix `quote` so `shippingCents: 0` means free shipping, while a missing value still uses the standard rate.',
        editable: ['src/pricing.ts'],
        tests: [
          {
            path: 'tests/pricing.test.ts',
            content: `import { quote } from '../src/pricing';

test('free shipping is honoured', () => {
  expect(quote({ subtotalCents: 2000, shippingCents: 0 })).toBe('NONE:2000');
});

test('missing shipping uses the standard rate', () => {
  expect(quote({ subtotalCents: 2000 })).toBe('NONE:2499');
});

test('null promo is treated as no promo', () => {
  expect(quote({ subtotalCents: 2000, promo: null, shippingCents: 250 })).toBe('NONE:2250');
});

test('promo with free shipping', () => {
  expect(quote({ subtotalCents: 2000, promo: { code: 'STAFF', percentOff: 10 }, shippingCents: 0 })).toBe('STAFF:1800');
});

test('0% promo keeps its code', () => {
  expect(quote({ subtotalCents: 2000, promo: { code: 'PRICEMATCH', percentOff: 0 }, shippingCents: 100 })).toBe('PRICEMATCH:2100');
});
`,
          },
        ],
        solution: {
          'src/pricing.ts': `export interface Promo {
  code: string;
  percentOff: number;
}

export interface Cart {
  subtotalCents: number;
  promo?: Promo | null;
  /** 0 means free shipping; undefined means "use the standard rate". */
  shippingCents?: number;
}

const STANDARD_SHIPPING_CENTS = 499;

export function quote(cart: Cart): string {
  const shipping = cart.shippingCents ?? STANDARD_SHIPPING_CENTS;
  const pct = cart.promo?.percentOff ?? 0;
  const code = cart.promo?.code ?? 'NONE';
  const total = Math.round(cart.subtotalCents * (1 - pct / 100)) + shipping;
  return code + ':' + total;
}
`,
        },
        hints: ['You want a default only for `null`/`undefined`, not for `0`.', 'The fix is one operator on one line.'],
        explanation:
          'Replace `||` with `??`. Nullish coalescing only falls back for `null` and `undefined`, so a legitimate `0` survives. Rule of thumb: use `??` for defaults whenever `0`, `""` or `false` are valid values.',
        timeLimitSec: 300,
        focusFile: 'src/pricing.ts',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── T2
  {
    id: 'l1-b-ts-latency-percentile',
    title: 'p100 Latency Is 9ms',
    level: 1,
    rating: 900,
    lang: 'typescript',
    domain: 'observability',
    companies: ['google', 'meta', 'atlassian'],
    tags: ['array-sort', 'comparator', 'mutation'],
    summary: 'The latency dashboard says the slowest request took 9ms. It took a full second.',
    files: [
      {
        path: 'src/latency.ts',
        content: `/** Returns the p-th percentile (nearest-rank) of latency samples in ms. */
export function percentile(samplesMs: number[], p: number): number {
  if (samplesMs.length === 0) throw new Error('no samples');
  const sorted = samplesMs.sort();
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { percentile } from './latency';

const samples = [120, 15, 9, 1000, 85];
console.log(percentile(samples, 50));
console.log(percentile(samples, 100));
console.log(samples.join(','));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: '15\n9\n1000,120,15,85,9',
        options: [
          '15\n9\n1000,120,15,85,9',
          '85\n1000\n120,15,9,1000,85',
          '15\n9\n120,15,9,1000,85',
          '85\n1000\n9,15,85,120,1000',
        ],
        hints: [
          'Without a comparator, `Array.prototype.sort` converts elements to strings and compares them in UTF-16 order.',
          '`sort` sorts in place and returns the same array.',
        ],
        explanation:
          'Default sort compares `"1000" < "120" < "15" < "85" < "9"`. The median (rank 3) is therefore 15 and the max (rank 5) is 9. Because `sort` mutates and returns the *same* array, the caller\'s `samples` is reordered too.',
        timeLimitSec: 180,
        focusFile: 'src/latency.ts',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix percentile',
        prompt: 'Make `percentile` sort numerically **without mutating** the caller\'s array.',
        editable: ['src/latency.ts'],
        tests: [
          {
            path: 'tests/latency.test.ts',
            content: `import { percentile } from '../src/latency';

test('median is numeric', () => {
  expect(percentile([120, 15, 9, 1000, 85], 50)).toBe(85);
});

test('p100 is the maximum', () => {
  expect(percentile([120, 15, 9, 1000, 85], 100)).toBe(1000);
});

test('p25 of four samples', () => {
  expect(percentile([300, 5, 2000, 40], 25)).toBe(5);
});

test('does not mutate the input', () => {
  const xs = [120, 15, 9, 1000, 85];
  percentile(xs, 95);
  expect(xs).toEqual([120, 15, 9, 1000, 85]);
});

test('empty input throws', () => {
  expect(() => percentile([], 50)).toThrow();
});
`,
          },
        ],
        solution: {
          'src/latency.ts': `/** Returns the p-th percentile (nearest-rank) of latency samples in ms. */
export function percentile(samplesMs: number[], p: number): number {
  if (samplesMs.length === 0) throw new Error('no samples');
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}
`,
        },
        hints: ['A numeric comparator returns a negative, zero or positive number.', 'Copy before sorting: `[...xs]` or `xs.slice()`.'],
        explanation:
          '`[...samplesMs].sort((a, b) => a - b)` copies, then sorts numerically. (`toSorted` does both in ES2023, but check your runtime targets.) A comparator returning a boolean, like `(a, b) => a > b`, is also wrong: `false` and `true` coerce to 0 and 1 and never signal "less than".',
        timeLimitSec: 300,
        focusFile: 'src/latency.ts',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── T3
  {
    id: 'l1-b-ts-webhook-typeof',
    title: 'typeof null Strikes Again',
    level: 1,
    rating: 650,
    lang: 'typescript',
    domain: 'payments',
    companies: ['stripe', 'canva', 'generic'],
    tags: ['typeof', 'null', 'type-guards', 'validation'],
    summary: 'A webhook validator crashes on `null` bodies and accepts arrays.',
    files: [
      {
        path: 'src/webhook.ts',
        content: `export interface PaymentEvent {
  type: string;
  amountCents: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object';
}

export function parseEvent(body: unknown): PaymentEvent | null {
  if (!isRecord(body)) return null;
  if (typeof body.type !== 'string') return null;
  if (typeof body.amountCents !== 'number' || Number.isNaN(body.amountCents)) return null;
  return { type: body.type, amountCents: body.amountCents };
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { parseEvent } from './webhook';

const samples: unknown[] = [null, [], {}, 42, NaN, 'evt', undefined, () => 1];
console.log(samples.map((s) => typeof s).join(' '));

for (const body of [{ type: 'charge', amountCents: 500 }, ['charge', 500], 'charge']) {
  console.log(JSON.stringify(parseEvent(body)));
}
try {
  console.log(JSON.stringify(parseEvent(null)));
} catch (e) {
  console.log('threw ' + (e as Error).constructor.name);
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer:
          'object object object number number string undefined function\n{"type":"charge","amountCents":500}\nnull\nnull\nthrew TypeError',
        options: [
          'object object object number number string undefined function\n{"type":"charge","amountCents":500}\nnull\nnull\nthrew TypeError',
          'null array object number NaN string undefined function\n{"type":"charge","amountCents":500}\nnull\nnull\nnull',
          'object object object number number string undefined object\n{"type":"charge","amountCents":500}\nnull\nnull\nthrew TypeError',
          'object object object number number string undefined function\n{"type":"charge","amountCents":500}\nthrew TypeError\nnull\nnull',
        ],
        hints: [
          '`typeof null` is a famous historical bug in JavaScript.',
          'Arrays are objects. Reading a missing property of an array is fine; reading a property of `null` is not.',
        ],
        explanation:
          '`typeof null === "object"`, arrays are `"object"`, `NaN` is a `"number"` and functions are `"function"`. The array passes `isRecord`, but `body.type` is `undefined` → `null`. A string fails `isRecord` → `null`. `null` passes `isRecord`, then `null.type` throws a `TypeError`.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix the type guard',
        prompt: 'Fix `isRecord` so it only accepts plain non-null, non-array objects. `parseEvent` must return `null` (not throw) for any malformed body.',
        editable: ['src/webhook.ts'],
        tests: [
          {
            path: 'tests/webhook.test.ts',
            content: `import { isRecord, parseEvent } from '../src/webhook';

test('null is not a record', () => {
  expect(isRecord(null)).toBe(false);
});

test('arrays are not records', () => {
  expect(isRecord([1, 2])).toBe(false);
});

test('plain objects are records', () => {
  expect(isRecord({ a: 1 })).toBe(true);
});

test('parseEvent rejects null without throwing', () => {
  expect(parseEvent(null)).toBeNull();
});

test('parseEvent accepts a valid event', () => {
  expect(parseEvent({ type: 'refund', amountCents: 125 })).toEqual({ type: 'refund', amountCents: 125 });
});

test('parseEvent rejects NaN amounts and primitives', () => {
  expect(parseEvent({ type: 'charge', amountCents: NaN })).toBeNull();
  expect(parseEvent(42)).toBeNull();
});
`,
          },
        ],
        solution: {
          'src/webhook.ts': `export interface PaymentEvent {
  type: string;
  amountCents: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseEvent(body: unknown): PaymentEvent | null {
  if (!isRecord(body)) return null;
  if (typeof body.type !== 'string') return null;
  if (typeof body.amountCents !== 'number' || Number.isNaN(body.amountCents)) return null;
  return { type: body.type, amountCents: body.amountCents };
}
`,
        },
        hints: ['`typeof` alone cannot tell `null` or arrays apart from objects.', 'Add `value !== null` and `!Array.isArray(value)`.'],
        explanation:
          'A correct guard is `typeof value === \'object\' && value !== null && !Array.isArray(value)`. TypeScript trusts a `value is ...` predicate blindly, so a wrong guard silently lies to the type checker.',
        timeLimitSec: 300,
        focusFile: 'src/webhook.ts',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── T4
  {
    id: 'l1-b-ts-optional-chain-profile',
    title: 'Where Optional Chaining Stops',
    level: 1,
    rating: 1100,
    lang: 'typescript',
    domain: 'user-profile',
    companies: ['meta', 'canva', 'apple'],
    tags: ['optional-chaining', 'nullish-coalescing', 'api-payloads'],
    summary: '`u?.profile.settings` is safe when `u` is missing. Is it safe when `profile` is?',
    persona: 'tunnel-vision',
    context: 'The settings page crashes for some users. The API types say `profile` is always present; the API disagrees.',
    files: [
      {
        path: 'src/profile.ts',
        content: `export interface Settings {
  theme: string;
}

export interface Profile {
  displayName?: string;
  settings?: Settings;
}

export interface User {
  id: number;
  profile: Profile;
}

export function label(u?: User): string {
  return u?.profile?.displayName ?? 'user-' + u?.id;
}

export function theme(u?: User): string {
  try {
    return u?.profile.settings?.theme ?? 'light';
  } catch {
    return 'crash';
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { label, theme } from './profile';
import type { User } from './profile';

// Payloads come from an API that sometimes omits "profile".
const payloads = JSON.parse('[{"id":7,"profile":{"displayName":""}},{"id":8},{"id":9,"profile":{}}]') as User[];

console.log(label(undefined));
console.log('[' + label(payloads[0]) + ']');
console.log(label(payloads[1]));
console.log(theme(undefined));
console.log(theme(payloads[1]));
console.log(theme(payloads[2]));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: 'user-undefined\n[]\nuser-8\nlight\ncrash\nlight',
        options: [
          'user-undefined\n[]\nuser-8\nlight\ncrash\nlight',
          'user-undefined\n[user-7]\nuser-8\nlight\nlight\nlight',
          'crash\n[]\nuser-8\nlight\ncrash\nlight',
          'user-undefined\n[]\nuser-8\ncrash\ncrash\nlight',
        ],
        hints: [
          '`??` only replaces `null`/`undefined` — an empty string is kept.',
          '`a?.b.c` short-circuits only when `a` itself is nullish.',
        ],
        explanation:
          '`label(undefined)`: the chain yields `undefined`, so the fallback is `\'user-\' + undefined`. User 7 has `displayName: ""`, which `??` keeps. For `theme(undefined)` the `u?.` short-circuits the *whole* chain → `light`. For user 8 `u` exists, `u.profile` is `undefined`, and `.settings` on it throws → `crash`. User 9 has a profile without settings, and `settings?.` handles that → `light`.',
        timeLimitSec: 240,
        focusFile: 'src/profile.ts',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Diagnose the crash',
        prompt: 'You asked the assistant why `theme()` crashes for user 8. Is its diagnosis right?',
        persona: 'tunnel-vision',
        request: 'theme() returns "crash" for user 8. Why, and what is the fix?',
        aiReply: `Optional chaining short-circuits the **entire rest of the chain**, so once you write \`u?.\` nothing after it can throw. \`u?.profile.settings\` is therefore safe.

The crash must be the API sending \`settings: null\`. Make the fallback explicit:

\`\`\`ts
return (u?.profile.settings ?? { theme: 'light' }).theme;
\`\`\``,
        options: [
          'Accept: `?.` makes the remainder of the chain null-safe, and the explicit fallback handles `settings: null`',
          'Reject: `?.` only short-circuits when the value to its left is nullish. `u` is defined, `u.profile` is `undefined`, and `.settings` on it throws — the proposed code still crashes. Use `u?.profile?.settings?.theme ?? \'light\'`',
          'Reject: optional chaining does not work on values produced by `JSON.parse`',
          'Reject: the crash comes from `??`, which throws when its left side is `undefined`',
        ],
        correct: 1,
        hints: ['Which value is actually `undefined` for user 8: `u`, `u.profile`, or `u.profile.settings`?'],
        explanation:
          'Short-circuiting is triggered by the operand of each `?.`. `u?.profile.settings` protects against `u` being nullish, not `profile`. The suggested fix keeps the unguarded `.settings` access and fails the same way. Also notice the root cause: the `User` type promised `profile` is always present — consider validating API payloads at the boundary.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── T5
  {
    id: 'l1-b-ts-status-counts',
    title: 'NaN Orders Filled',
    level: 1,
    rating: 1000,
    lang: 'typescript',
    domain: 'reporting',
    companies: ['amazon', 'atlassian', 'uber'],
    tags: ['undefined-arithmetic', 'NaN', 'json', 'records'],
    summary: 'The daily order report shows `null` for every status count.',
    files: [
      {
        path: 'src/report.ts',
        content: `export type OrderStatus = 'NEW' | 'FILLED' | 'CANCELLED';

export interface Order {
  id: string;
  status: OrderStatus;
  qty: number;
}

export function countByStatus(orders: Order[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of orders) {
    counts[o.status]++;
  }
  return counts;
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { countByStatus } from './report';
import type { Order } from './report';

const orders: Order[] = [
  { id: 'o1', status: 'NEW', qty: 100 },
  { id: 'o2', status: 'FILLED', qty: 50 },
  { id: 'o3', status: 'NEW', qty: 10 },
];

const counts = countByStatus(orders);
console.log(JSON.stringify(counts));
console.log(counts.NEW + 1);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer: '{"NEW":null,"FILLED":null}\nNaN',
        options: [
          '{"NEW":null,"FILLED":null}\nNaN',
          '{"NEW":2,"FILLED":1}\n3',
          '{}\nNaN',
          '{"NEW":1,"FILLED":1}\n2',
        ],
        hints: [
          'What is `undefined + 1`?',
          'How does `JSON.stringify` serialise `NaN`?',
        ],
        explanation:
          '`counts[o.status]` starts as `undefined`; `undefined++` converts it with `Number(undefined)` → `NaN` and stores `NaN`. Every further increment stays `NaN`. The key *is* created, so it appears in the output, but `JSON.stringify` writes `NaN` as `null`. `NaN + 1` is `NaN`.',
        timeLimitSec: 180,
        focusFile: 'src/report.ts',
      },
      {
        id: 's2',
        kind: 'code',
        task: 'fix',
        title: 'Fix the counter',
        prompt: 'Fix `countByStatus` so it returns real counts. Statuses that never appear should be absent from the result.',
        editable: ['src/report.ts'],
        tests: [
          {
            path: 'tests/report.test.ts',
            content: `import { countByStatus } from '../src/report';

test('counts each status', () => {
  const counts = countByStatus([
    { id: 'o1', status: 'NEW', qty: 100 },
    { id: 'o2', status: 'FILLED', qty: 50 },
    { id: 'o3', status: 'NEW', qty: 10 },
  ]);
  expect(counts).toEqual({ NEW: 2, FILLED: 1 });
});

test('empty input gives an empty object', () => {
  expect(countByStatus([])).toEqual({});
});

test('single cancelled order', () => {
  expect(countByStatus([{ id: 'x', status: 'CANCELLED', qty: 1 }])).toEqual({ CANCELLED: 1 });
});
`,
          },
        ],
        solution: {
          'src/report.ts': `export type OrderStatus = 'NEW' | 'FILLED' | 'CANCELLED';

export interface Order {
  id: string;
  status: OrderStatus;
  qty: number;
}

export function countByStatus(orders: Order[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of orders) {
    counts[o.status] = (counts[o.status] ?? 0) + 1;
  }
  return counts;
}
`,
        },
        hints: ['Give the first increment a starting value.', '`(counts[k] ?? 0) + 1`'],
        explanation:
          'Initialise on first use: `counts[k] = (counts[k] ?? 0) + 1`. TypeScript does not catch this because `Record<string, number>` claims every key maps to a `number`; enabling `noUncheckedIndexedAccess` would type the read as `number | undefined` and flag the bug.',
        timeLimitSec: 240,
        focusFile: 'src/report.ts',
      },
    ],
  },
];

export default problems;
