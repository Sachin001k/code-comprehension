import type { Problem } from '../types';

/**
 * Level 1 "Line Reader" — Java slice (author b).
 */
const problems: Problem[] = [
  // ───────────────────────────────────────────────────────────── J1
  {
    id: 'l1-b-java-integer-cache',
    title: 'Same Size, Different Answer',
    level: 1,
    rating: 900,
    lang: 'java',
    domain: 'orderbook',
    companies: ['citadel', 'blackrock', 'goldman'],
    tags: ['autoboxing', 'integer-cache', 'equality'],
    summary: 'A cross-detection helper works for AAPL but not for MSFT. Same code, same numbers.',
    context:
      'The matching-engine team stores resting quantities in `Map<String, Integer>`. A trader reports that the "same size" alert fires for small orders but never for large ones.',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Main {
    // Returns true when resting bid and ask quantities match exactly.
    static boolean sameSize(Integer bidQty, Integer askQty) {
        return bidQty == askQty;
    }

    public static void main(String[] args) {
        Map<String, Integer> bids = new HashMap<>();
        Map<String, Integer> asks = new HashMap<>();
        bids.put("AAPL", 100);
        asks.put("AAPL", 100);
        bids.put("MSFT", 500);
        asks.put("MSFT", 500);

        for (String sym : List.of("AAPL", "MSFT")) {
            Integer bid = bids.get(sym);
            Integer ask = asks.get(sym);
            System.out.println(sym + " same=" + sameSize(bid, ask) + " equals=" + bid.equals(ask));
        }
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What gets printed?',
        prompt: 'Predict the exact output of `Main.java`.',
        answer: 'AAPL same=true equals=true\nMSFT same=false equals=true',
        options: [
          'AAPL same=true equals=true\nMSFT same=false equals=true',
          'AAPL same=true equals=true\nMSFT same=true equals=true',
          'AAPL same=false equals=true\nMSFT same=false equals=true',
          'AAPL same=true equals=false\nMSFT same=false equals=false',
        ],
        hints: [
          '`map.put("AAPL", 100)` autoboxes with `Integer.valueOf(100)`.',
          '`Integer.valueOf` returns cached objects for values in -128..127 and allocates new objects outside that range.',
        ],
        explanation:
          '`Integer` is a reference type, so `==` compares object identity. Autoboxing calls `Integer.valueOf`, which returns a **cached** instance for -128..127. Both `100`s are the same cached object (`true`), but each `500` is a separate allocation (`false`). `equals` compares the wrapped value, so it is `true` for both.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Locate the bug',
        prompt: 'Click the line that causes the missing alert and choose the root cause.',
        file: 'Main.java',
        lines: [8],
        options: [
          '`==` on two `Integer` objects compares references, which only coincide for cached values (-128..127)',
          '`HashMap.get` returns a defensive copy of the value, so identity is never preserved',
          '`List.of` reorders the symbols, so MSFT is compared against AAPL',
          'The `Integer` parameters are unboxed on entry, losing precision above 127',
        ],
        correct: 0,
        hints: ['Which line compares two wrapper objects?'],
        explanation:
          'Line 8 uses `==` with two `Integer` operands. No unboxing happens when *both* sides are wrappers, so it is a reference comparison. It passes in unit tests with small quantities and fails in production with real sizes.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Pick every valid fix',
        prompt: 'Assume both arguments are non-null. Which replacements for line 8 correctly compare the **values**? Select all that apply.',
        options: [
          '`return bidQty.equals(askQty);`',
          '`return java.util.Objects.equals(bidQty, askQty);`',
          '`return bidQty.intValue() == askQty.intValue();`',
          '`return (Integer) bidQty == (Integer) askQty;`',
          'Keep `==` but change the maps to `Map<String, Long>`',
        ],
        correct: [0, 1, 2],
        hints: ['A cast to `Integer` leaves both sides as references.', '`Long.valueOf` has the same -128..127 cache.'],
        explanation:
          '`equals`, `Objects.equals` (which is also null-safe) and comparing the unboxed `int`s all compare values. Casting to `Integer` changes nothing: both operands are still references. `Long` caches the same range, so the bug simply moves.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J2
  {
    id: 'l1-b-java-string-identity',
    title: 'Is It Really USD?',
    level: 1,
    rating: 800,
    lang: 'java',
    domain: 'payments',
    companies: ['jpmorgan', 'goldman', 'amazon'],
    tags: ['string-equality', 'string-pool', 'compile-time-constants'],
    summary: 'A currency check passes in tests and fails on messages parsed off the wire.',
    context: 'FX settlement skips conversion for base-currency payments. Ops noticed some USD payments are being "converted" from USD to USD with a fee.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    static final String BASE_CCY = "USD";

    static boolean isBaseCurrency(String ccy) {
        return ccy == BASE_CCY;
    }

    public static void main(String[] args) {
        String fromConfig = "USD";
        String fromWire = new String("USD");
        String folded = "US" + "D";
        String prefix = "US";
        String built = prefix + "D";
        String interned = built.intern();
        System.out.println(isBaseCurrency(fromConfig) + " " + isBaseCurrency(fromWire) + " "
            + isBaseCurrency(folded) + " " + isBaseCurrency(built) + " " + isBaseCurrency(interned));
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: 'true false true false true',
        options: [
          'true false true false true',
          'true true true true true',
          'true false false false true',
          'true false true false false',
          'true false true true true',
        ],
        hints: [
          'String literals are interned: every `"USD"` literal is the same object.',
          '`"US" + "D"` is a compile-time constant expression; `prefix + "D"` is not, because `prefix` is not `final`.',
        ],
        explanation:
          '`==` compares references. `fromConfig` is the pooled literal (true). `new String(...)` always allocates (false). `"US" + "D"` is folded by the compiler into the literal `"USD"` (true). `prefix + "D"` is computed at runtime into a new object (false). `intern()` returns the pooled instance (true).',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the faulty comparison',
        prompt: 'Click the buggy line and pick the root cause.',
        file: 'Main.java',
        lines: [5],
        options: [
          '`==` compares object identity; strings parsed or built at runtime are different objects with the same characters',
          '`BASE_CCY` should not be `static`, so each call gets a fresh copy',
          'Java compares strings case-insensitively with `==`, so "usd" would match',
          '`new String("USD")` produces a string with a hidden trailing null character',
        ],
        correct: 0,
        hints: ['Which line decides equality?'],
        explanation: 'Line 5 uses reference equality. It works for literals (same pooled object) and fails for anything created at runtime, which is exactly what a message parser produces.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Null-safe fix',
        prompt: '`ccy` is `null` when the currency tag is missing from the message. Which replacement for line 5 is correct **and never throws**?',
        options: [
          '`return ccy.equals(BASE_CCY);`',
          '`return BASE_CCY.equals(ccy);`',
          '`return ccy.intern() == BASE_CCY;`',
          '`return ccy.compareTo(BASE_CCY) == 0;`',
        ],
        correct: [1],
        hints: ['Which receiver can never be null?'],
        explanation:
          'Calling a method on `ccy` throws `NullPointerException` when it is null. Putting the constant first, `BASE_CCY.equals(ccy)`, compares contents and simply returns `false` for `null`. (`Objects.equals(ccy, BASE_CCY)` would also work.)',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J3
  {
    id: 'l1-b-java-fee-math',
    title: 'Free Trades for Everyone',
    level: 1,
    rating: 650,
    lang: 'java',
    domain: 'pricing',
    companies: ['blackrock', 'jpmorgan', 'generic'],
    tags: ['integer-division', 'integer-overflow', 'widening'],
    summary: 'Exchange fees come out as zero and big notionals go negative.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    // Exchange fee in basis points: 25 bps = 0.25%
    static double feeRate(int feeBps) {
        return feeBps / 10000;
    }

    static long notionalCents(int qty, int priceCents) {
        return qty * priceCents;
    }

    public static void main(String[] args) {
        System.out.println(feeRate(25));
        System.out.println(notionalCents(50_000, 50_000));
        System.out.println(notionalCents(1_000, 2_500));
        System.out.println(7 / 2 + " " + (-7 / 2) + " " + (-7 % 3));
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: '0.0\n-1794967296\n2500000\n3 -3 -1',
        options: [
          '0.0\n-1794967296\n2500000\n3 -3 -1',
          '0.0025\n2500000000\n2500000\n3 -3 -1',
          '0.0\n2500000000\n2500000\n3 -4 2',
          '0.0025\n-1794967296\n2500000\n3 -4 -1',
        ],
        hints: [
          'The return type being `double` or `long` does not change how the expression inside is computed.',
          'Java integer division truncates toward zero, and `%` takes the sign of the dividend.',
        ],
        explanation:
          '`25 / 10000` is `int / int` = 0, then widened to `0.0`. `50_000 * 50_000` is computed in 32-bit `int`: 2,500,000,000 overflows to 2,500,000,000 - 2^32 = -1,794,967,296, *then* widened to `long`. 2,500,000 fits. `-7 / 2` truncates toward zero (-3, not -4) and `-7 % 3` is -1 (sign follows the dividend).',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Negative notional',
        prompt: 'Risk sees a negative notional for a large order. Click the line responsible and choose the cause.',
        file: 'Main.java',
        lines: [8],
        options: [
          'The multiplication is done in `int` and overflows before the result is widened to `long`',
          '`long` cannot hold values above 2^31 - 1',
          'Underscores in `50_000` make the literal octal',
          'The method should return `Long`, not `long`',
        ],
        correct: 0,
        hints: ['What are the types of `qty` and `priceCents`?'],
        explanation:
          'Widening happens on `return`, after the `int * int` has already overflowed. Fix: `return (long) qty * priceCents;` (casting one operand promotes the whole multiplication to `long`).',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Fix the fee rate',
        prompt: 'Which bodies for `feeRate` return `0.0025` for `feeRate(25)`? Select all that apply.',
        options: [
          '`return feeBps / 10000.0;`',
          '`return (double) (feeBps / 10000);`',
          '`return (double) feeBps / 10000;`',
          '`return feeBps / 10_000d;`',
          '`return Math.round(feeBps / 10000);`',
        ],
        correct: [0, 2, 3],
        hints: ['A cast binds tighter than `/`. Where do the parentheses put it?'],
        explanation:
          'Any `double` operand makes the division floating point: `10000.0`, `10_000d`, or casting `feeBps` *before* dividing. `(double)(feeBps / 10000)` casts the already-truncated 0. `Math.round` of an int division is still 0.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J4
  {
    id: 'l1-b-java-sla-switch',
    title: 'Platinum Support Is Slow',
    level: 1,
    rating: 750,
    lang: 'java',
    domain: 'support-tickets',
    companies: ['atlassian', 'microsoft', 'generic'],
    tags: ['switch', 'fall-through', 'switch-expressions'],
    summary: 'Platinum customers are promised a 4h SLA. The ticket system says 24h.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    // Support SLA in hours by customer tier.
    static int slaHours(String tier) {
        int hours;
        switch (tier) {
            case "PLATINUM":
                hours = 4;
            case "GOLD":
                hours = 24;
                break;
            case "SILVER":
                hours = 48;
            default:
                hours = 96;
        }
        return hours;
    }

    public static void main(String[] args) {
        for (String tier : new String[] {"PLATINUM", "GOLD", "SILVER", "BRONZE"}) {
            System.out.print(tier + "=" + slaHours(tier) + " ");
        }
        System.out.println();
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: 'PLATINUM=24 GOLD=24 SILVER=96 BRONZE=96',
        options: [
          'PLATINUM=24 GOLD=24 SILVER=96 BRONZE=96',
          'PLATINUM=4 GOLD=24 SILVER=48 BRONZE=96',
          'PLATINUM=4 GOLD=24 SILVER=96 BRONZE=96',
          'PLATINUM=24 GOLD=24 SILVER=48 BRONZE=96',
        ],
        hints: ['A classic `case` label is just an entry point. Execution continues until a `break` (or the end of the switch).'],
        explanation:
          'PLATINUM sets 4, then falls through into GOLD which overwrites it with 24 and breaks. SILVER sets 48 then falls into `default`, which overwrites it with 96. Only GOLD and BRONZE are right, and only by accident for BRONZE.',
        timeLimitSec: 150,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Where does it go wrong?',
        prompt: 'Click a line where control falls through by mistake, then pick the cause.',
        file: 'Main.java',
        lines: [7, 12],
        options: [
          'Missing `break` after the assignment, so execution falls through into the next case',
          '`switch` on `String` compares with `==`, so "PLATINUM" never matches',
          '`hours` is not initialised, so the JVM uses the previous call\'s value',
          '`default` must be the first label in a switch',
        ],
        correct: 0,
        hints: ['Look at the cases that do *not* end in `break`.'],
        explanation:
          'Lines 7 and 12 assign and then fall into the next label. Switch on `String` uses `hashCode`/`equals`, so matching is fine; the problem is purely control flow.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Senior suggests a rewrite',
        prompt: 'The assistant proposes a rewrite. Should you accept it?',
        persona: 'helpful-senior',
        request: 'Fix the fall-through bug in slaHours so it can\'t regress.',
        aiReply: `Rather than sprinkling \`break\`s, use a switch *expression* (Java 14+). Arrow labels never fall through, and the compiler forces every path to produce a value:

\`\`\`java
static int slaHours(String tier) {
    return switch (tier) {
        case "PLATINUM" -> 4;
        case "GOLD" -> 24;
        case "SILVER" -> 48;
        default -> 96;
    };
}
\`\`\`

Same behaviour for unknown tiers (96h), and adding a tier later can't accidentally fall into its neighbour.`,
        options: [
          'Accept: arrow-form cases do not fall through and the mapping matches the intended SLAs',
          'Reject: arrow cases still fall through unless each ends with `break`',
          'Reject: a switch expression needs `yield` in every case, so this does not compile',
          'Reject: switch expressions cannot switch on `String`',
        ],
        correct: 0,
        hints: ['Arrow labels with a single expression produce that value directly.'],
        explanation:
          'This one is correct. `case X -> expr;` has no fall-through, a single-expression arm needs no `yield` (only block arms `{ ... }` do), and `String` is a valid selector. It returns 4/24/48/96 as intended.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J5
  {
    id: 'l1-b-java-pass-by-value',
    title: 'The Account That Would Not Reset',
    level: 1,
    rating: 950,
    lang: 'java',
    domain: 'banking',
    companies: ['jpmorgan', 'goldman', 'amazon'],
    tags: ['pass-by-value', 'references', 'mutation'],
    summary: 'One helper mutates, one reassigns. Only one of them does what its name says.',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Account {
        final String id;
        long balanceCents;

        Account(String id, long balanceCents) {
            this.id = id;
            this.balanceCents = balanceCents;
        }
    }

    static void applyFee(Account acct, long feeCents) {
        acct.balanceCents -= feeCents;
        feeCents = 0;
    }

    static void resetAccount(Account acct) {
        acct = new Account(acct.id, 0);
    }

    static void addAudit(List<String> log, String msg) {
        log.add(msg);
        log = new ArrayList<>();
        log.add("dropped");
    }

    public static void main(String[] args) {
        Account acct = new Account("ACC-1", 10_000);
        long fee = 250;
        applyFee(acct, fee);
        resetAccount(acct);
        List<String> audit = new ArrayList<>();
        addAudit(audit, "fee charged");
        System.out.println(acct.balanceCents + " " + fee + " " + audit);
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: '9750 250 [fee charged]',
        options: [
          '9750 250 [fee charged]',
          '0 250 [fee charged]',
          '9750 0 [fee charged]',
          '0 0 [dropped]',
          '9750 250 [fee charged, dropped]',
        ],
        hints: [
          'Java always passes a *copy* of the variable. For objects, that copy is a reference to the same object.',
          'Mutating through the reference is visible to the caller; reassigning the parameter is not.',
        ],
        explanation:
          '`applyFee` mutates the shared object (10000 - 250 = 9750) and zeroes only its local copy of `feeCents`. `resetAccount` points its *local* parameter at a new object; the caller\'s `acct` is untouched. `addAudit` adds to the caller\'s list, then rebinds its local `log` to a new list, so "dropped" goes nowhere.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Why no reset?',
        prompt: 'Which change makes `resetAccount(acct)` actually zero the caller\'s balance?',
        options: [
          'Replace the body with `acct.balanceCents = 0;`',
          'Declare the parameter as `final Account acct`',
          'Call it as `resetAccount(new Account(acct.id, acct.balanceCents))`',
          'Make `Account` a `record` so it is passed by reference',
        ],
        correct: [0],
        hints: ['You cannot change which object the caller\'s variable points to, but you can change the object.'],
        explanation:
          'Mutating the object the reference points to is visible to everyone holding that reference. `final` only forbids reassigning the parameter; passing a new object resets a throwaway; records are still passed as a copied reference (and are immutable, which makes it worse).',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J6
  {
    id: 'l1-b-java-seat-labels',
    title: 'Seat 79, Please',
    level: 1,
    rating: 850,
    lang: 'java',
    domain: 'booking',
    companies: ['amazon', 'google', 'generic'],
    tags: ['char-arithmetic', 'string-concatenation', 'compound-assignment'],
    summary: 'Boarding passes show seat "79" instead of "12C".',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    // Seat label like "12C": row number followed by a column letter (col 0 = 'A').
    static String seatLabel(int row, int col) {
        char letter = 'A';
        letter += col;
        return row + letter + "";
    }

    static int pnrDigitSum(String pnr) {
        int sum = 0;
        for (char ch : pnr.toCharArray()) {
            if (Character.isDigit(ch)) {
                sum += ch - '0';
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        System.out.println(seatLabel(12, 2));
        System.out.println("" + 12 + (char) ('A' + 2));
        System.out.println(pnrDigitSum("AB7C91"));
        System.out.println('7' + '0');
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: '79\n12C\n17\n103',
        options: ['79\n12C\n17\n103', '12C\n12C\n17\n70', '79\n1267\n17\n103', '12C\n12C\n17\n103', '79\n12C\n226\n103'],
        hints: [
          '`+` is evaluated left to right. What is `int + char`?',
          '`\'A\'` is 65, `\'0\'` is 48, `\'7\'` is 55.',
        ],
        explanation:
          '`row + letter` is `int + char` → numeric: 12 + 67 (`\'C\'`) = 79, and only then is `""` appended. In line 2 the string comes first, so everything after is concatenation, and the `(char)` cast turns 67 back into `C`. `ch - \'0\'` converts digit characters to values: 7 + 9 + 1 = 17. `\'7\' + \'0\'` is 55 + 48 = 103.',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the bug',
        prompt: 'Click the line that produces "79" and choose the cause.',
        file: 'Main.java',
        lines: [6],
        options: [
          '`row + letter` is numeric addition (`int + char` → `int`) because no `String` has appeared yet in the expression',
          '`letter += col` overflows the `char` and wraps to a digit',
          '`""` at the end converts the whole expression to a string before addition happens',
          '`char` values are printed as their Unicode code point by `println`',
        ],
        correct: 0,
        hints: ['Evaluate the expression strictly left to right.'],
        explanation: 'String concatenation only kicks in once one operand is a `String`. Fix: `return row + String.valueOf(letter);` or `"" + row + letter`.',
        timeLimitSec: 120,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Why does line 5 compile?',
        prompt: '`letter += col;` compiles, but `letter = letter + col;` does not. Why?',
        options: [
          'Compound assignment includes an implicit narrowing cast back to the left-hand type; `letter + col` is an `int` that cannot be assigned to `char` without a cast',
          '`+=` is overloaded for `char` to mean "next letter"',
          '`letter = letter + col` fails because `col` might be negative',
          'Both compile; the second just prints a warning',
        ],
        correct: [0],
        hints: ['What is the type of `char + int`?'],
        explanation: 'JLS 15.26.2: `E1 op= E2` is equivalent to `E1 = (T) ((E1) op (E2))`. The hidden cast is convenient and also hides overflow.',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J7
  {
    id: 'l1-b-java-array-defaults',
    title: 'Fresh Arrays',
    level: 1,
    rating: 700,
    lang: 'java',
    domain: 'trade-settlement',
    companies: ['blackrock', 'jpmorgan', 'generic'],
    tags: ['array-defaults', 'null', 'unboxing'],
    summary: 'What is inside a freshly allocated array, and what happens when you unbox it?',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    public static void main(String[] args) {
        int[] fills = new int[3];
        boolean[] settled = new boolean[2];
        String[] venues = new String[2];
        double[] px = new double[1];
        Integer[] lots = new Integer[2];

        fills[1] += 5;
        venues[0] = venues[0] + "NYSE";
        System.out.println(fills[0] + fills[1] + " " + settled[1] + " " + venues[0] + " " + px[0] + " " + lots[0]);

        try {
            int total = lots[0] + 1;
            System.out.println(total);
        } catch (NullPointerException e) {
            System.out.println("NPE");
        }
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: '5 false nullNYSE 0.0 null\nNPE',
        options: [
          '5 false nullNYSE 0.0 null\nNPE',
          '05 false NYSE 0.0 0\n1',
          '5 false NYSE 0 null\nNPE',
          '05 false nullNYSE 0.0 null\nNPE',
        ],
        hints: [
          'Numeric arrays start at zero, `boolean` at `false`, object arrays at `null`.',
          'The first `+` in the print statement has two `int` operands.',
        ],
        explanation:
          '`fills[0] + fills[1]` is `0 + 5 = 5` (numeric, before any string). `settled[1]` is `false`. `venues[0]` was `null`, and `null + "NYSE"` concatenates to `"nullNYSE"`. `px[0]` prints as `0.0`, `lots[0]` as `null`. `lots[0] + 1` auto-unboxes `null` → `NullPointerException`.',
        timeLimitSec: 150,
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Defaults quiz',
        prompt: 'Which statements about `new T[n]` in Java are true? Select all that apply.',
        options: [
          '`new char[1][0]` is the character with code 0 (`\'\\u0000\'`), not a space',
          '`new Integer[1][0]` is `0` because of autoboxing',
          '`new long[1][0]` is `0L`',
          'Reading an element of a fresh `String[]` throws until it is assigned',
        ],
        correct: [0, 2],
        hints: ['Object arrays are arrays of references.'],
        explanation:
          'Primitive arrays are zero-filled (`0`, `0L`, `0.0`, `false`, `\'\\u0000\'`). Reference arrays — including wrappers like `Integer[]` — are filled with `null`. Reading `null` is fine; *using* it (method call, unboxing) throws.',
        timeLimitSec: 120,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J8
  {
    id: 'l1-b-java-stringbuilder-audit',
    title: 'One Builder, Many Names',
    level: 1,
    rating: 1050,
    lang: 'java',
    domain: 'audit-log',
    companies: ['goldman', 'atlassian', 'amazon'],
    tags: ['stringbuilder', 'aliasing', 'equals', 'char-arithmetic'],
    summary: 'StringBuilder chains return `this`, and `equals` is not what you think.',
    persona: 'confident-intern',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    static StringBuilder tag(StringBuilder sb, String t) {
        return sb.append('[').append(t).append(']');
    }

    public static void main(String[] args) {
        StringBuilder audit = new StringBuilder("ORD-42");
        StringBuilder withNew = tag(audit, "NEW");
        tag(withNew, "FILLED");
        System.out.println(audit);
        System.out.println(audit == withNew);

        StringBuilder copy = new StringBuilder(audit.toString());
        System.out.println(audit.equals(copy) + " " + audit.toString().equals(copy.toString()));

        System.out.println(new StringBuilder("px=").append(1 + 2).append('c' + 1));
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print?',
        answer: 'ORD-42[NEW][FILLED]\ntrue\nfalse true\npx=3100',
        options: [
          'ORD-42[NEW][FILLED]\ntrue\nfalse true\npx=3100',
          'ORD-42\nfalse\ntrue true\npx=3d',
          'ORD-42[NEW]\nfalse\nfalse true\npx=12c1',
          'ORD-42[NEW][FILLED]\ntrue\ntrue true\npx=3d',
        ],
        hints: [
          '`append` mutates the builder and returns the **same** object.',
          '`StringBuilder` does not override `equals`.',
          '`\'c\' + 1` is evaluated before `append` sees it. What type is it?',
        ],
        explanation:
          '`tag` appends into the one builder and returns it, so `audit`, `withNew` and the second result are the same object: `ORD-42[NEW][FILLED]` and `==` is `true`. `StringBuilder.equals` is `Object.equals` (identity) → `false`, while comparing the `toString()`s is `true`. `1 + 2` is `3`; `\'c\' + 1` is the `int` 100, so `append(int)` writes "100".',
        timeLimitSec: 180,
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Dedupe with a set',
        prompt: 'You asked the assistant to drop duplicate (orderId, venue) events before publishing. Review its answer.',
        persona: 'confident-intern',
        request: 'Dedupe incoming order events by orderId+venue before calling publish(id).',
        aiReply: `Super simple, and \`StringBuilder\` avoids creating lots of temporary strings 🚀

\`\`\`java
Set<StringBuilder> seen = new HashSet<>();
for (String id : incomingIds) {
    StringBuilder key = new StringBuilder(id).append('|').append(venue);
    if (seen.add(key)) {
        publish(id);
    }
}
\`\`\`

\`HashSet.add\` returns false for duplicates, so each event is published once.`,
        options: [
          'Accept: `HashSet.add` returns false when an equal key is already present',
          'Reject: `StringBuilder` inherits identity `equals`/`hashCode`, so every key is distinct and nothing is deduplicated; use `String` keys (e.g. `id + "|" + venue`)',
          'Reject: `append(\'|\')` appends the number 124 instead of a pipe character',
          'Reject: `HashSet.add` throws `IllegalStateException` on a duplicate',
        ],
        correct: 1,
        hints: ['What did `audit.equals(copy)` print above?'],
        explanation:
          'Hash-based collections rely on `equals`/`hashCode`. `StringBuilder` uses `Object`\'s identity versions, so two builders with identical text are different keys and every event is published. `append(char)` correctly appends the character; it is `append(\'c\' + 1)` — an `int` — that appends digits.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── J9
  {
    id: 'l1-b-java-increment-order',
    title: 'Retry Counter Riddles',
    level: 1,
    rating: 1150,
    lang: 'java',
    domain: 'language-semantics',
    companies: ['jane-street', 'optiver', 'google'],
    tags: ['post-increment', 'pre-increment', 'evaluation-order'],
    summary: '`x = x++`, `a++ + ++a` and an array store that reads after it writes the index.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    static int retries = 0;

    static int nextAttempt() {
        return retries++;
    }

    public static void main(String[] args) {
        int seq = 5;
        seq = seq++;
        System.out.println(seq);

        int a = 3;
        int b = a++ + ++a;
        System.out.println(a + " " + b);

        int[] slots = {10, 20, 30};
        int i = 0;
        slots[i++] = slots[i] + 1;
        System.out.println(java.util.Arrays.toString(slots) + " " + i);

        nextAttempt();
        nextAttempt();
        System.out.println(nextAttempt() + " " + retries);
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the output',
        prompt: 'What does `Main.java` print? (Java defines left-to-right evaluation, so this is well-defined.)',
        answer: '5\n5 8\n[21, 20, 30] 1\n2 3',
        options: [
          '5\n5 8\n[21, 20, 30] 1\n2 3',
          '6\n5 8\n[21, 20, 30] 1\n3 3',
          '5\n5 9\n[11, 20, 30] 1\n2 3',
          '6\n5 9\n[20, 21, 30] 1\n2 3',
          '5\n5 8\n[11, 20, 30] 1\n2 3',
        ],
        hints: [
          '`seq++` evaluates to the *old* value; the increment happens, then the assignment overwrites it.',
          'In `slots[i++] = ...` Java evaluates the index before the right-hand side.',
        ],
        explanation:
          '`seq = seq++`: the right side yields 5, `seq` becomes 6, then the assignment stores 5. `a++ + ++a` = 3 (a→4) + 5 (a→5) = 8. For the array store the index `i++` is evaluated first (index 0, i→1), then `slots[1] + 1` = 21 is stored into `slots[0]`. `nextAttempt()` returns the old value: 0, 1, then 2, leaving `retries` at 3.',
        timeLimitSec: 240,
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace the array store',
        prompt: 'Order the steps the JVM performs for `slots[i++] = slots[i] + 1;` (starting with `i == 0`).',
        items: [
          'Evaluate the array reference `slots` on the left',
          'Evaluate the index `i++`: yields 0, `i` becomes 1',
          'Evaluate the right-hand side `slots[i]` with `i == 1`: reads 20',
          'Compute 20 + 1 = 21',
          'Store 21 into `slots[0]`',
        ],
        hints: ['JLS 15.26.1: array reference, then index, then right-hand side, then the store.'],
        explanation:
          'For an array assignment Java evaluates the array reference, then the index expression (including its side effect), then the right operand, and only then performs the store. That is why the right side sees `i == 1`. (In C++ before C++17 this exact line was undefined behaviour — another reason not to write it.)',
        timeLimitSec: 180,
      },
    ],
  },
];

export default problems;
