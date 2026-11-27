import type { Problem } from '../types';

/**
 * Level 2 "Function Tracer" — slice B (Java + C++).
 * Python problems for this slice live in l2-b2.ts.
 */
const problems: Problem[] = [
  // ───────────────────────────────────────────────────────────── Java 1
  {
    id: 'l2-b-java-dropcopy-hashset',
    title: 'The Drop-Copy Deduper',
    level: 2,
    rating: 1250,
    lang: 'java',
    domain: 'trade-blotter',
    companies: ['goldman', 'jpmorgan', 'blackrock', 'amazon'],
    tags: ['equals-hashcode', 'hashset', 'collections'],
    summary: 'Venues resend fills. The deduper should drop them. It books them twice instead.',
    context:
      'Exchanges re-transmit execution reports after a reconnect. `DropCopyDeduper` is supposed to book each `(venue, execId)` exactly once. Ops says the position report shows **double fills** after every reconnect.',
    persona: 'confident-intern',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        DropCopyDeduper d = new DropCopyDeduper();
        d.onFill("XLON", "E-1001", 500);
        d.onFill("XLON", "E-1001", 500);   // venue resend after reconnect
        d.onFill("XNAS", "E-1001", 200);   // same execId, different venue
        d.onFill("XLON", "E-1002", 300);

        TradeKey a = new TradeKey("XLON", "E-1001");
        TradeKey b = new TradeKey("XLON", "E-1001");
        System.out.println(a.equals(b));
        System.out.println(d.bookedCount());
        System.out.println(d.wasSeen("XLON", "E-1002"));

        List<TradeKey> audit = new ArrayList<>();
        audit.add(a);
        System.out.println(audit.contains(b));
    }
}
`,
      },
      {
        path: 'TradeKey.java',
        content: `/** Identity of an execution report: unique per venue. */
public final class TradeKey {
    private final String venue;
    private final String execId;

    public TradeKey(String venue, String execId) {
        this.venue = venue;
        this.execId = execId;
    }

    public String venue() { return venue; }
    public String execId() { return execId; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TradeKey)) return false;
        TradeKey other = (TradeKey) o;
        return venue.equals(other.venue) && execId.equals(other.execId);
    }

    @Override
    public String toString() {
        return venue + ":" + execId;
    }
}
`,
      },
      {
        path: 'DropCopyDeduper.java',
        content: `import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Books each execution report once, even if the venue resends it. */
public class DropCopyDeduper {
    private final Set<TradeKey> seen = new HashSet<>();
    private final List<String> booked = new ArrayList<>();

    /** Returns true if the fill was booked, false if it was a duplicate. */
    public boolean onFill(String venue, String execId, long qty) {
        TradeKey key = new TradeKey(venue, execId);
        if (!seen.add(key)) {
            return false;
        }
        booked.add(key + " x" + qty);
        return true;
    }

    public int bookedCount() {
        return booked.size();
    }

    public boolean wasSeen(String venue, String execId) {
        return seen.contains(new TradeKey(venue, execId));
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What does Main print?',
        prompt: 'Read all three files and predict the output of `Main.java`.',
        entry: 'Main.java',
        answer: 'true\n4\nfalse\ntrue',
        options: ['true\n3\ntrue\ntrue', 'true\n4\nfalse\ntrue', 'true\n4\nfalse\nfalse', 'false\n4\nfalse\nfalse'],
        hints: [
          '`HashSet.add` first computes `key.hashCode()` to pick a bucket, and only calls `equals` on entries with the same hash.',
          '`TradeKey` does not override `hashCode`, so it inherits `Object.hashCode` (identity-based).',
          '`ArrayList.contains` never hashes: it just calls `equals` on each element.',
        ],
        explanation:
          '`equals` is overridden, so `a.equals(b)` is `true`. But `hashCode` is not, so two equal keys almost always get different identity hash codes. `HashSet`/`HashMap` compare the hash first, so the resend lands in a different bucket and is **added again**: 4 fills booked instead of 3. `wasSeen` builds a fresh key with yet another identity hash, so it is `false` even though that exact fill was booked. `ArrayList.contains` only uses `equals`, so it returns `true`. Hash-based and equality-based collections now disagree, which is exactly what the equals/hashCode contract exists to prevent.',
        timeLimitSec: 240,
        focusFile: 'DropCopyDeduper.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Where does the contract break?',
        prompt: 'Click the line where `TradeKey` breaks the `equals`/`hashCode` contract, then choose the root cause.',
        file: 'TradeKey.java',
        lines: [14, 15],
        options: [
          '`equals` is overridden without a matching `hashCode`, so equal keys can hash to different buckets',
          '`instanceof` should be `getClass() ==`, otherwise subclasses break symmetry',
          'The fields must not be `final` or `HashSet` cannot update them',
          '`equals` should compare with `==` because Java interns all strings',
        ],
        correct: 0,
        hints: [
          'The contract: if `a.equals(b)` then `a.hashCode() == b.hashCode()`.',
          'Which of the two methods does this class actually define?',
        ],
        explanation:
          'Overriding `equals` (line 14-15 onwards) obliges you to override `hashCode` with the same fields, e.g. `Objects.hash(venue, execId)`. `TradeKey` is `final`, so the `instanceof` vs `getClass()` debate does not matter here. Strings built at runtime are not interned, and `final` fields are exactly what you want in a hash key.',
        timeLimitSec: 150,
        focusFile: 'TradeKey.java',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Review the fix',
        prompt: 'The assistant patched `TradeKey`. Would you merge it?',
        persona: 'confident-intern',
        request: 'Make TradeKey work properly as a HashSet key.',
        aiReply: `Done, just add a hash function that matches \`equals\`:

\`\`\`java
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof TradeKey)) return false;
        TradeKey other = (TradeKey) o;
        return venue.equals(other.venue) && execId.equals(other.execId);
    }

    public int hashcode() {
        return Objects.hash(venue, execId);
    }
\`\`\`

(plus \`import java.util.Objects;\`). It compiles cleanly and uses the same two fields as \`equals\`, so the contract holds. 🚀`,
        options: [
          'Accept: it hashes exactly the fields used by `equals`',
          'Reject: `hashcode()` (lower-case c) is a new method, not an override of `hashCode()`, so `HashSet` still uses identity hashes',
          'Reject: `Objects.hash` allocates a varargs array, which is too slow for a hash key',
          'Reject: `hashCode` must also include the fill quantity',
        ],
        correct: 1,
        hints: ['Look very carefully at the method name, and at what is missing above it.'],
        explanation:
          'Java method names are case sensitive. `hashcode()` compiles fine as a brand-new method that nobody calls; `HashSet` still calls the inherited `Object.hashCode()`. Had the assistant written `@Override`, the compiler would have rejected it immediately. That is why `@Override` is non-negotiable in review. Quantity is not part of identity (a resend has the same quantity anyway), and `Objects.hash` is perfectly fine here.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 2
  {
    id: 'l2-b-java-blotter-cme',
    title: 'Purging Cancelled Orders',
    level: 2,
    rating: 1400,
    lang: 'java',
    domain: 'trade-blotter',
    companies: ['citadel', 'jpmorgan', 'atlassian', 'amazon'],
    tags: ['concurrent-modification', 'iterators', 'arraylist'],
    summary: 'One blotter silently keeps a cancelled order, the other throws. Same method.',
    context:
      'The end-of-day job calls `Blotter.purgeCancelled()` on each desk\'s blotter. On some days it crashes, on others it "succeeds" but cancelled orders still show up in the client report.',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.ConcurrentModificationException;

public class Main {
    public static void main(String[] args) {
        Blotter morning = new Blotter();
        morning.add(new Order("A1", "NEW"));
        morning.add(new Order("A2", "CANCELLED"));
        morning.add(new Order("A3", "CANCELLED"));
        System.out.println(morning.purgeCancelled() + " " + morning.ids());

        Blotter afternoon = new Blotter();
        afternoon.add(new Order("B1", "CANCELLED"));
        afternoon.add(new Order("B2", "NEW"));
        afternoon.add(new Order("B3", "NEW"));
        try {
            System.out.println(afternoon.purgeCancelled() + " " + afternoon.ids());
        } catch (ConcurrentModificationException e) {
            System.out.println("CME " + afternoon.ids());
        }
    }
}
`,
      },
      {
        path: 'Order.java',
        content: `public class Order {
    final String id;
    final String status;

    Order(String id, String status) {
        this.id = id;
        this.status = status;
    }
}
`,
      },
      {
        path: 'Blotter.java',
        content: `import java.util.ArrayList;
import java.util.List;

public class Blotter {
    private final List<Order> orders = new ArrayList<>();

    public void add(Order o) {
        orders.add(o);
    }

    /** Removes every CANCELLED order and returns how many were removed. */
    public int purgeCancelled() {
        int purged = 0;
        for (Order o : orders) {
            if (o.status.equals("CANCELLED")) {
                orders.remove(o);
                purged++;
            }
        }
        return purged;
    }

    public List<String> ids() {
        List<String> out = new ArrayList<>();
        for (Order o : orders) {
            out.add(o.id);
        }
        return out;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Two blotters, one method',
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: '1 [A1, A3]\nCME [B2, B3]',
        options: [
          '2 [A1]\n1 [B2, B3]',
          'CME [A1, A3]\nCME [B2, B3]',
          '1 [A1, A3]\nCME [B2, B3]',
          '1 [A1, A3]\n1 [B2, B3]',
        ],
        hints: [
          'A for-each loop over an `ArrayList` is `while (it.hasNext()) { o = it.next(); ... }`.',
          '`hasNext()` is just `cursor != size`. Only `next()` checks for concurrent modification.',
          'Morning: after removing A2 the cursor is 2 and the size is 2.',
        ],
        explanation:
          'The for-each loop uses the list\'s iterator. `hasNext()` returns `cursor != size()`, while `next()` throws `ConcurrentModificationException` if the list was structurally modified behind the iterator\'s back.\n\n**Morning:** A1 (cursor→1), A2 (cursor→2) is removed so size becomes 2. `hasNext()` sees `2 != 2` → false and the loop ends *without error*, never looking at A3. Result: `1 [A1, A3]`, a cancelled order silently survives.\n\n**Afternoon:** B1 is removed (cursor 1, size 2). `hasNext()` is true, `next()` detects the modification and throws. The list has already lost B1, so the catch prints `CME [B2, B3]`.\n\nRemoving the *second-to-last* element is the one case where this bug hides instead of crashing.',
        timeLimitSec: 300,
        focusFile: 'Blotter.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Point at the culprit',
        prompt: 'Click the line responsible for both symptoms and pick the root cause.',
        file: 'Blotter.java',
        lines: [16],
        options: [
          'The list is structurally modified through `orders.remove` while a for-each iterator is walking it',
          '`status.equals("CANCELLED")` should be `status == "CANCELLED"`',
          '`ArrayList` is not thread-safe; it should be a `Vector`',
          '`purged++` runs before the remove completes',
        ],
        correct: 0,
        hints: ['Which call changes the list size while the hidden iterator is active?'],
        explanation:
          'Line 16 calls `List.remove(Object)` directly, bypassing the iterator. The iterator\'s `expectedModCount` no longer matches the list\'s `modCount`, and its cursor now points one past where it should. There is only one thread here, so swapping to `Vector` changes nothing: CME is about iteration protocol, not threads.',
        timeLimitSec: 120,
        focusFile: 'Blotter.java',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Pick the safe rewrites',
        prompt: 'Which replacements for the loop body of `purgeCancelled` remove **every** cancelled order correctly and return the right count? Select all that apply.',
        options: [
          '`int before = orders.size(); orders.removeIf(o -> o.status.equals("CANCELLED")); return before - orders.size();`',
          'An explicit `Iterator<Order> it = orders.iterator();` loop that calls `it.remove()` on cancelled orders',
          '`for (int i = 0; i < orders.size(); i++) { if (cancelled(orders.get(i))) { orders.remove(i); purged++; } }`',
          'Wrap the list with `Collections.synchronizedList(...)` and keep the for-each loop',
          'Loop over a copy (`for (Order o : new ArrayList<>(orders))`) and remove from `orders`',
        ],
        correct: [0, 1, 4],
        hints: [
          'For the index loop, trace the list `[C, C, NEW]`.',
          'Synchronisation guards against other threads. Is another thread involved here?',
        ],
        explanation:
          '`removeIf` and `Iterator.remove()` keep the iterator consistent. Iterating a copy while mutating the original is also safe (though O(n²) with `remove(Object)`). The forward index loop **skips** the element that slides into position `i` after a removal, so `[C, C, NEW]` leaves one C behind. A synchronized wrapper does not change iterator semantics and still throws CME.',
        timeLimitSec: 240,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 3
  {
    id: 'l2-b-java-static-order-ids',
    title: 'Per-Desk Order IDs',
    level: 2,
    rating: 1150,
    lang: 'java',
    domain: 'order-management',
    companies: ['goldman', 'blackrock', 'microsoft', 'generic'],
    tags: ['static', 'instance-state', 'thread-safety'],
    summary: 'Each desk should number its own orders. Why does RATES start at 2?',
    context:
      'The OMS gives every desk its own `OrderIdGenerator`. Downstream reconciliation expects `FX-1, FX-2, ...` and `RATES-1, RATES-2, ...` independently.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    public static void main(String[] args) {
        OrderIdGenerator fx = new OrderIdGenerator("FX");
        OrderIdGenerator rates = new OrderIdGenerator("RATES");

        System.out.println(fx.next());
        System.out.println(rates.next());
        System.out.println(fx.next());

        OrderIdGenerator credit = new OrderIdGenerator("CR");
        credit.resetSequence();          // new desk wants a clean start

        System.out.println(rates.next());
        System.out.println(fx.issued() + " " + rates.issued() + " " + credit.issued());
    }
}
`,
      },
      {
        path: 'OrderIdGenerator.java',
        content: `/** Generates human-readable order ids of the form DESK-SEQ. */
public class OrderIdGenerator {
    private static int nextSeq = 1;

    private final String desk;
    private int issued = 0;

    public OrderIdGenerator(String desk) {
        this.desk = desk;
    }

    public String next() {
        issued++;
        return desk + "-" + (nextSeq++);
    }

    public int issued() {
        return issued;
    }

    public static void resetSequence() {
        nextSeq = 1;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Number the orders',
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: 'FX-1\nRATES-2\nFX-3\nRATES-1\n2 2 0',
        options: [
          'FX-1\nRATES-1\nFX-2\nRATES-2\n2 2 0',
          'FX-1\nRATES-2\nFX-3\nRATES-4\n2 2 0',
          'FX-1\nRATES-2\nFX-3\nRATES-1\n2 2 0',
          'FX-1\nRATES-2\nFX-3\nRATES-1\n4 4 4',
        ],
        hints: [
          'How many copies of `nextSeq` exist? How many copies of `issued`?',
          '`credit.resetSequence()` looks like an instance call, but what kind of method is it?',
        ],
        explanation:
          '`nextSeq` is `static`: one counter shared by every generator, so desks interleave (FX-1, RATES-2, FX-3). `resetSequence()` is also static; calling it through `credit` compiles (with a warning) but resets the **shared** counter, so RATES\'s next id is `RATES-1`: sequence number 1 is handed out a second time (FX-1 already used it), and with a different desk prefix it could have been an exact duplicate id. `issued` is an instance field, so each generator counts its own calls: 2, 2, 0.',
        timeLimitSec: 180,
        focusFile: 'OrderIdGenerator.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the shared state',
        prompt: 'Reconciliation wants independent sequences per desk. Click the line that makes the sequences shared.',
        file: 'OrderIdGenerator.java',
        lines: [3],
        options: [
          '`nextSeq` is `static`, so all generator instances share one counter',
          '`issued` should be `static` so it matches `nextSeq`',
          '`nextSeq++` is post-increment; it should be `++nextSeq`',
          '`desk` should not be `final`',
        ],
        correct: 0,
        hints: ['A `static` field belongs to the class, not to the object.'],
        explanation:
          'Making `nextSeq` an instance field (`private int nextSeq = 1;`) gives each desk its own sequence; `resetSequence` should then become an instance method too. Changing post- to pre-increment would just start every sequence at 2.',
        timeLimitSec: 120,
        focusFile: 'OrderIdGenerator.java',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Now add threads',
        prompt: 'With the **original** code, two threads call `fx.next()` and `rates.next()` at the same time. Which statements are true? Select all that apply.',
        options: [
          'Both threads can read the same `nextSeq` value, producing e.g. `FX-7` and `RATES-7`',
          'Marking `next()` as `synchronized` fully fixes it, because each call then holds a lock',
          '`nextSeq++` is a read-modify-write and is not atomic',
          'Using a `static final AtomicInteger` with `getAndIncrement()` makes the shared counter safe',
          'It is safe because each thread uses a different generator object',
        ],
        correct: [0, 2, 3],
        hints: [
          '`synchronized` on an instance method locks `this`. Are the two threads locking the same `this`?',
        ],
        explanation:
          '`nextSeq++` is load, add, store, so two threads can interleave and both observe the same value. A `synchronized` instance method locks **the instance**; `fx` and `rates` are different objects, so the two calls do not exclude each other while touching the same static field. An `AtomicInteger` (or `synchronized` on `OrderIdGenerator.class`) fixes the race. Different objects do not help when the state is static.',
        timeLimitSec: 210,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 4
  {
    id: 'l2-b-java-fee-overload-override',
    title: 'Which Fee Applies?',
    level: 2,
    rating: 1500,
    lang: 'java',
    domain: 'pricing',
    companies: ['google', 'jane-street', 'goldman', 'apple'],
    tags: ['overloading', 'overriding', 'dynamic-dispatch', 'field-hiding'],
    summary: 'Overloads are picked at compile time, overrides at run time. The fee engine mixes both.',
    context:
      'VIP clients are supposed to get the VIP fee on **every** order. Finance found some VIP limit orders charged at the standard maker fee.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    public static void main(String[] args) {
        FeeSchedule s = new VipFeeSchedule();
        Order o1 = new LimitOrder();
        LimitOrder o2 = new LimitOrder();

        System.out.println(s.fee(o1));
        System.out.println(s.fee(o2));
        System.out.println(s.fee((Order) o2));
        System.out.println(s.tier + " " + s.describe() + " " + ((VipFeeSchedule) s).tier);
        System.out.println(s.charge(5));
    }
}
`,
      },
      {
        path: 'Order.java',
        content: `class Order {
    String type() {
        return "order";
    }
}

class LimitOrder extends Order {
    @Override
    String type() {
        return "limit";
    }
}
`,
      },
      {
        path: 'FeeSchedule.java',
        content: `class FeeSchedule {
    String tier = "standard";

    String fee(Order o) {
        return "base:" + o.type();
    }

    String fee(LimitOrder o) {
        return "maker:" + o.type();
    }

    String describe() {
        return tier;
    }

    String charge(long notional) {
        return "long";
    }

    String charge(Integer notional) {
        return "Integer";
    }
}

class VipFeeSchedule extends FeeSchedule {
    String tier = "vip";

    @Override
    String fee(Order o) {
        return "vip:" + o.type();
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the fees',
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: 'vip:limit\nmaker:limit\nvip:limit\nstandard standard vip\nlong',
        options: [
          'vip:limit\nvip:limit\nvip:limit\nvip vip vip\nInteger',
          'vip:limit\nmaker:limit\nvip:limit\nstandard standard vip\nlong',
          'maker:limit\nmaker:limit\nvip:limit\nstandard vip vip\nlong',
          'vip:order\nmaker:limit\nvip:order\nstandard standard vip\nInteger',
        ],
        hints: [
          'Step 1 (compile time): pick the overload from the **static** types of the receiver and arguments.',
          'Step 2 (run time): find the most specific override of *that signature* in the actual class.',
          'Fields are never virtual. And for overloads, primitive widening beats autoboxing.',
        ],
        explanation:
          '`s.fee(o1)`: the static type of `o1` is `Order`, so the compiler binds `fee(Order)`; at run time `VipFeeSchedule` overrides it → `vip:`, and `o.type()` dispatches on the real object → `limit`.\n\n`s.fee(o2)`: static type `LimitOrder` binds `fee(LimitOrder)`, which `VipFeeSchedule` never overrides → `maker:limit`. That is the finance bug.\n\nThe cast `(Order) o2` changes only the static type, so it binds `fee(Order)` again → `vip:limit`.\n\nFields are resolved by static type: `s.tier` is `FeeSchedule.tier` and `describe()` (declared in `FeeSchedule`) reads its own `tier`. `VipFeeSchedule.tier` *hides* it rather than overriding it; only the explicit cast sees `vip`.\n\n`charge(5)`: Java tries overloads without boxing first (int→long widening) before trying boxing, so `long` wins.',
        timeLimitSec: 360,
        focusFile: 'FeeSchedule.java',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace `s.fee(o1)`',
        prompt: 'Order the steps the compiler and JVM take to produce the first line of output, `s.fee(o1)`.',
        items: [
          'Compiler reads the static types: receiver `FeeSchedule`, argument `Order`',
          'Compiler chooses the overload `fee(Order)` and emits a virtual call to it',
          'JVM looks at the runtime class of `s`: `VipFeeSchedule`',
          'JVM dispatches to `VipFeeSchedule.fee(Order)`',
          '`o.type()` is dispatched on the runtime class of `o1`: `LimitOrder.type()`',
          'Returns `"vip:limit"`',
        ],
        hints: ['Overload resolution happens before the program ever runs.'],
        explanation:
          'Java method calls are resolved in two phases. Overload selection is purely static (types written in the source). Virtual dispatch happens at run time but only among overrides of the **already chosen signature**. That is why `fee(LimitOrder)` is never considered for `o1`, even though the object really is a `LimitOrder`.',
        timeLimitSec: 240,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Fix the VIP pricing',
        prompt: 'Which change guarantees VIP clients get the VIP fee for both `Order` and `LimitOrder` arguments, whatever the static type? Pick one.',
        options: [
          'Add `@Override String fee(LimitOrder o) { return "vip:" + o.type(); }` to `VipFeeSchedule`',
          'Declare `s` as `VipFeeSchedule s = new VipFeeSchedule();` in `Main`',
          'Make `FeeSchedule.fee(Order)` `final`',
          'Change `VipFeeSchedule.tier` to `"standard"`',
        ],
        correct: [0],
        hints: ['Which signature is called for `o2` and is it overridden?'],
        explanation:
          'Every call bound to `fee(LimitOrder)` needs a VIP override of that signature. Changing the declared type of `s` does not help: `VipFeeSchedule` still inherits `fee(LimitOrder)` unchanged. Making the base method `final` would make the existing override a compile error. A cleaner long-term design is a single `fee(Order)` that asks the order for its maker/taker classification instead of overloading on subclasses.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 5
  {
    id: 'l2-b-java-symbol-strings',
    title: 'Normalising Symbols',
    level: 2,
    rating: 1100,
    lang: 'java',
    domain: 'market-data',
    companies: ['amazon', 'optiver', 'microsoft', 'generic'],
    tags: ['string-immutability', 'string-equality', 'interning'],
    summary: 'The normaliser trims and upper-cases. Or does it?',
    context:
      'Symbols arrive from a vendor feed with stray whitespace and mixed case. `SymbolUtil` normalises them before they are used as cache keys.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    public static void main(String[] args) {
        String n = SymbolUtil.normalize(" eurusd ");
        System.out.println("[" + n + "]");

        String pair = SymbolUtil.pair("EUR", "USD");
        System.out.println(pair == "EURUSD");
        System.out.println(pair.equals("EURUSD"));
        System.out.println("EUR" + "USD" == "EURUSD");
        System.out.println(pair.intern() == "EURUSD");

        StringBuilder sb = new StringBuilder("FILL");
        String snapshot = sb.toString();
        sb.append("-42");
        System.out.println(snapshot + " " + sb);

        System.out.println("px=" + 1 + 2 + " / " + (1 + 2));
    }
}
`,
      },
      {
        path: 'SymbolUtil.java',
        content: `public final class SymbolUtil {
    private SymbolUtil() {}

    /** " eurusd " -> "EURUSD" */
    public static String normalize(String raw) {
        raw.trim();
        raw.toUpperCase();
        return raw;
    }

    public static String pair(String base, String quote) {
        return base + quote;
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
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: '[ eurusd ]\nfalse\ntrue\ntrue\ntrue\nFILL FILL-42\npx=12 / 3',
        options: [
          '[EURUSD]\ntrue\ntrue\ntrue\ntrue\nFILL-42 FILL-42\npx=3 / 3',
          '[ eurusd ]\nfalse\ntrue\ntrue\ntrue\nFILL FILL-42\npx=12 / 3',
          '[ eurusd ]\nfalse\ntrue\nfalse\ntrue\nFILL FILL-42\npx=12 / 3',
          '[EURUSD]\nfalse\ntrue\nfalse\nfalse\nFILL FILL-42\npx=12 / 3',
        ],
        hints: [
          '`String` methods never modify the receiver; they return a new string.',
          '`"EUR" + "USD"` is a compile-time constant expression. `base + quote` with parameters is not.',
          'String concatenation is left-associative: `"px=" + 1` happens first.',
        ],
        explanation:
          '`trim()` and `toUpperCase()` return new strings that are thrown away, so `raw` is returned unchanged: `[ eurusd ]`.\n\n`pair` builds a new `String` at run time, so `==` (reference comparison) against the literal is `false` while `equals` is `true`. `"EUR" + "USD"` is folded by the compiler into the literal `"EURUSD"`, which is interned, so `==` is `true` (note `+` binds tighter than `==`). `intern()` returns the canonical pooled instance → `true`.\n\n`sb.toString()` copies the builder\'s contents into an immutable `String`, so later appends do not affect `snapshot`.\n\n`"px=" + 1` is `"px=1"`, then `+ 2` → `"px=12"`; the parenthesised `(1 + 2)` is integer addition → `3`.',
        timeLimitSec: 300,
        focusFile: 'SymbolUtil.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Why is the cache keyed on " eurusd "?',
        prompt: 'Click a line responsible for `normalize` returning its input unchanged, then pick the cause.',
        file: 'SymbolUtil.java',
        lines: [6, 7],
        options: [
          'The results of `trim()` and `toUpperCase()` are discarded; strings are immutable',
          '`trim()` does not remove leading spaces, only trailing ones',
          '`toUpperCase()` needs `Locale.ROOT` or it does nothing',
          'The parameter is passed by value, so the caller\'s variable is not updated',
        ],
        correct: 0,
        hints: ['What does `raw.trim();` do with its return value?'],
        explanation:
          'Fix: `return raw.trim().toUpperCase(Locale.ROOT);`. Passing `Locale.ROOT` is good practice (the Turkish-i problem), but its absence is not why nothing happens. The pass-by-value option is a misdiagnosis: the method *returns* `raw`, so if `raw` had been reassigned the caller would see the new value.',
        timeLimitSec: 120,
        focusFile: 'SymbolUtil.java',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 6
  {
    id: 'l2-b-java-bigdecimal-commission',
    title: 'Commission in Cents',
    level: 2,
    rating: 1350,
    lang: 'java',
    domain: 'payments',
    companies: ['blackrock', 'jpmorgan', 'goldman', 'stripe'],
    tags: ['bigdecimal', 'floating-point', 'money', 'rounding'],
    summary: 'Ten ten-cent fees should be a dollar. In double, it isn\'t.',
    context:
      'The fee-accrual service is being migrated from `double` to `BigDecimal`. You are checking how the old and new code paths differ before the migration goes live.',
    files: [
      {
        path: 'Main.java',
        content: `import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.Set;

public class Main {
    public static void main(String[] args) {
        System.out.println(FeeAccrual.accrueDouble(10, 0.10));
        System.out.println(FeeAccrual.accrue(10, new BigDecimal("0.10")));

        BigDecimal a = new BigDecimal("2.0");
        BigDecimal b = new BigDecimal("2.00");
        System.out.println(a.equals(b) + " " + (a.compareTo(b) == 0));

        Set<BigDecimal> limits = new HashSet<>();
        limits.add(a);
        limits.add(b);
        System.out.println(limits.size());

        System.out.println(new BigDecimal(2.675).setScale(2, RoundingMode.HALF_UP));
        System.out.println(new BigDecimal("2.675").setScale(2, RoundingMode.HALF_UP));
    }
}
`,
      },
      {
        path: 'FeeAccrual.java',
        content: `import java.math.BigDecimal;

public final class FeeAccrual {
    private FeeAccrual() {}

    /** Legacy path: accrues a per-trade fee n times. */
    public static double accrueDouble(int trades, double feePerTrade) {
        double total = 0.0;
        for (int i = 0; i < trades; i++) {
            total += feePerTrade;
        }
        return total;
    }

    /** New path: exact decimal arithmetic. */
    public static BigDecimal accrue(int trades, BigDecimal feePerTrade) {
        BigDecimal total = BigDecimal.ZERO;
        for (int i = 0; i < trades; i++) {
            total = total.add(feePerTrade);
        }
        return total;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Old path vs new path',
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: '0.9999999999999999\n1.00\nfalse true\n2\n2.67\n2.68',
        options: [
          '1.0\n1.00\ntrue true\n1\n2.68\n2.68',
          '0.9999999999999999\n1.00\nfalse true\n2\n2.67\n2.68',
          '0.9999999999999999\n1.0\ntrue true\n1\n2.68\n2.68',
          '0.9999999999999999\n1.00\nfalse true\n1\n2.68\n2.68',
        ],
        hints: [
          '0.1 has no exact binary representation; adding it ten times accumulates the error.',
          '`BigDecimal.equals` compares value **and scale**; `compareTo` compares only value.',
          '`new BigDecimal(double)` captures the exact binary value of the double, digits and all.',
        ],
        explanation:
          'The double sum is `0.9999999999999999`. `BigDecimal` addition keeps the larger scale, so ten `0.10`s give exactly `1.00`.\n\n`2.0` and `2.00` have different scales, so `equals` is `false` while `compareTo` is `0`. `HashSet` uses `equals`/`hashCode`, so both go in: size 2. (A `TreeSet` would use `compareTo` and keep 1.)\n\n`new BigDecimal(2.675)` is really `2.67499999999999982236431605997495353221893310546875`, so HALF_UP gives `2.67`. Constructing from the string `"2.675"` gives exactly 2.675 → `2.68`. Always build money from strings (or `BigDecimal.valueOf`), never `new BigDecimal(double)`.',
        timeLimitSec: 300,
        focusFile: 'Main.java',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Converting the commission rate',
        prompt: 'The assistant wrote the commission helper for the new path. Would you merge it?',
        persona: 'outdated-docs',
        request: 'Write commission(notional, rateBps) returning the fee in currency units, 2dp, using BigDecimal. rateBps comes from config as a double, e.g. 2.5.',
        aiReply: `Here's the classic pattern from the BigDecimal docs:

\`\`\`java
public static BigDecimal commission(BigDecimal notional, double rateBps) {
    BigDecimal rate = new BigDecimal(rateBps)
            .divide(new BigDecimal(10000));
    return notional.multiply(rate).setScale(2, BigDecimal.ROUND_HALF_UP);
}
\`\`\`

\`new BigDecimal(double)\` is the most precise constructor, so the rate is captured exactly.`,
        options: [
          'Accept: BigDecimal throughout means no floating-point error',
          'Reject: `new BigDecimal(rateBps)` imports the binary error of the double (e.g. 0.1 bps); use `BigDecimal.valueOf(rateBps)`. Also `ROUND_HALF_UP` is the deprecated int constant; use `RoundingMode.HALF_UP`',
          'Reject: `divide` without a scale always throws `ArithmeticException`',
          'Reject: `multiply` must be given a `MathContext` or the result is truncated',
        ],
        correct: 1,
        hints: [
          'What exact value does `new BigDecimal(0.1)` hold?',
          'Check which rounding API is current.',
        ],
        explanation:
          '"Most precise" is the trap: `new BigDecimal(double)` precisely captures the *wrong* number, e.g. `0.1` becomes `0.1000000000000000055511151231257827…`. `BigDecimal.valueOf(d)` goes through `Double.toString` and gives `0.1`. `BigDecimal.ROUND_HALF_UP` (an `int`) and `setScale(int, int)` have been deprecated since Java 9 in favour of `RoundingMode`. `divide` without a scale throws only when the quotient has a non-terminating expansion; dividing by 10000 always terminates, so it is fine here. `multiply` is exact by default.',
        timeLimitSec: 240,
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Keys in a risk-limit map',
        prompt: 'Risk limits are stored in a `HashMap<BigDecimal, String>` keyed by price level. Prices arrive as `"101.5"` from one feed and `"101.50"` from another. Which approaches make both feeds hit the same entry? Select all that apply.',
        options: [
          'Normalise keys with `price.stripTrailingZeros()` before put/get',
          'Normalise keys with `price.setScale(2, RoundingMode.UNNECESSARY)` before put/get (all prices have at most 2dp)',
          'Switch to a `TreeMap<BigDecimal, String>`, which uses `compareTo`',
          'Do nothing: `BigDecimal.hashCode` ignores scale',
        ],
        correct: [0, 1, 2],
        hints: ['`equals` and `hashCode` both look at scale. What makes the scales agree?'],
        explanation:
          'Either canonicalise the scale (strip zeros, or force a fixed scale; `UNNECESSARY` throws if rounding would be needed, which is a useful guard) or use a sorted map whose key identity is `compareTo`. `BigDecimal.hashCode` *does* include scale, which is why `2.0` and `2.00` hash differently.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 7
  {
    id: 'l2-b-java-seq-binary-search',
    title: 'Sequence-Number Recovery',
    level: 2,
    rating: 1450,
    lang: 'java',
    domain: 'market-data',
    companies: ['google', 'hrt', 'optiver', 'citadel'],
    tags: ['binary-search', 'integer-overflow', 'tracing'],
    summary: 'Binary search finds the first gap. Works in tests, spins in production.',
    context:
      'After a crash, the market-data recorder binary-searches for the first sequence number that was **not** persisted, then requests a replay from there. Unit tests use small numbers; production sequence numbers are past 1.9 billion.',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    public static void main(String[] args) {
        System.out.println(SeqRecovery.firstUnpersisted(1, 100, seq -> seq < 42));
        try {
            int first = SeqRecovery.firstUnpersisted(
                    1_000_000_000, 2_000_000_000, seq -> seq < 1_900_000_000);
            System.out.println(first);
        } catch (IllegalStateException e) {
            System.out.println(e.getMessage());
        }
    }
}
`,
      },
      {
        path: 'SeqRecovery.java',
        content: `import java.util.function.IntPredicate;

public final class SeqRecovery {
    private static final int MAX_PROBES = 64;

    private SeqRecovery() {}

    /**
     * Smallest seq in [lo, hi] for which persisted(seq) is false, or hi + 1 if all are persisted.
     * persisted must be monotone: true ... true false ... false.
     */
    public static int firstUnpersisted(int lo, int hi, IntPredicate persisted) {
        int probes = 0;
        while (lo <= hi) {
            if (++probes > MAX_PROBES) {
                throw new IllegalStateException("no convergence after " + MAX_PROBES + " probes");
            }
            int mid = (lo + hi) / 2;
            if (persisted.test(mid)) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace the small search',
        prompt: 'For `firstUnpersisted(1, 100, seq -> seq < 42)`, order the probes (`mid` values) in the order they are tested.',
        items: [
          'lo=1, hi=100 → mid=50 (not persisted)',
          'lo=1, hi=49 → mid=25 (persisted)',
          'lo=26, hi=49 → mid=37 (persisted)',
          'lo=38, hi=49 → mid=43 (not persisted)',
          'lo=38, hi=42 → mid=40 (persisted)',
          'lo=41, hi=42 → mid=41 (persisted)',
          'lo=42, hi=42 → mid=42 (not persisted) → return 42',
        ],
        hints: ['Integer division rounds toward zero: (1 + 100) / 2 = 50.', 'A "persisted" probe moves `lo` up; a miss moves `hi` down.'],
        explanation:
          'Each probe halves the interval. When `persisted(mid)` is true the answer is to the right (`lo = mid + 1`); otherwise it is at `mid` or to the left (`hi = mid - 1`). The loop ends with `lo = 42`, `hi = 41`, and `lo` is the first unpersisted sequence number.',
        timeLimitSec: 300,
        focusFile: 'SeqRecovery.java',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Now with production numbers',
        prompt: 'Predict exactly what `Main.java` prints.',
        entry: 'Main.java',
        answer: '42\nno convergence after 64 probes',
        options: [
          '42\n1900000000',
          '42\nno convergence after 64 probes',
          '42\n-647483648',
          '42\n1899999999',
        ],
        hints: [
          '`Integer.MAX_VALUE` is 2,147,483,647.',
          'What is `1_000_000_000 + 2_000_000_000` in 32-bit two\'s complement?',
        ],
        explanation:
          '`lo + hi = 3,000,000,000` overflows to `-1,294,967,296`, so `mid = -647,483,648`. That is "persisted" (it is < 1.9e9), so `lo` jumps to a negative number. From then on the sum alternates between overflowing and not, `mid` bounces between large negative and mid-range values, and the interval never closes. The guard trips after 64 probes. Without the guard this would spin forever, which is what happened in production.',
        timeLimitSec: 240,
        focusFile: 'SeqRecovery.java',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Fix the midpoint',
        prompt: 'Click the buggy line and choose the correct replacement.',
        file: 'SeqRecovery.java',
        lines: [18],
        options: [
          '`int mid = lo + (hi - lo) / 2;` (or `(lo + hi) >>> 1` when both are non-negative)',
          '`int mid = (lo + hi + 1) / 2;`',
          '`int mid = (int) Math.round((lo + hi) / 2.0);`',
          '`long mid = (lo + hi) / 2;`',
        ],
        correct: 0,
        hints: ['The bug is in the addition, not the division.', 'Does widening the *result* to `long` help if the addition is still done in `int`?'],
        explanation:
          '`hi - lo` cannot overflow when `0 <= lo <= hi`, so `lo + (hi - lo) / 2` is safe. `(lo + hi) >>> 1` treats the overflowed sum as unsigned, which also works for non-negative inputs (this was the famous `java.util.Arrays.binarySearch` fix in 2006). `long mid = (lo + hi) / 2` still adds two `int`s first, then widens the already-wrong result. `lo + hi` inside `Math.round(...)` overflows the same way.',
        timeLimitSec: 150,
        focusFile: 'SeqRecovery.java',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── Java 8
  {
    id: 'l2-b-java-breach-comparator',
    title: 'Worst Loss First',
    level: 2,
    rating: 1300,
    lang: 'java',
    domain: 'risk',
    companies: ['jane-street', 'two-sigma', 'blackrock', 'meta'],
    tags: ['comparator', 'integer-overflow', 'sorting'],
    summary: 'The risk dashboard should put the biggest loss on top. RATES just lost $2bn and is last.',
    context:
      'The risk dashboard lists limit breaches sorted by P&L ascending, so the worst loss is first. P&L is stored in whole dollars as an `int`.',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<Breach> breaches = new ArrayList<>(List.of(
                new Breach("RATES", -2_000_000_000),
                new Breach("FX", 1_500_000_000),
                new Breach("EQ", -300_000),
                new Breach("CREDIT", 400_000_000)));

        RiskDashboard.sortWorstFirst(breaches);
        for (Breach b : breaches) {
            System.out.println(b.desk());
        }
    }
}
`,
      },
      {
        path: 'Breach.java',
        content: `/** A desk whose P&L breached a limit. pnl is in whole dollars. */
public record Breach(String desk, int pnl) {}
`,
      },
      {
        path: 'RiskDashboard.java',
        content: `import java.util.Comparator;
import java.util.List;

public final class RiskDashboard {
    private RiskDashboard() {}

    /** Ascending P&L: largest loss first. */
    static final Comparator<Breach> BY_PNL = (a, b) -> a.pnl() - b.pnl();

    public static void sortWorstFirst(List<Breach> breaches) {
        breaches.sort(BY_PNL);
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Read the dashboard',
        prompt: 'Predict the order in which desks are printed.',
        entry: 'Main.java',
        answer: 'EQ\nCREDIT\nFX\nRATES',
        options: ['RATES\nEQ\nCREDIT\nFX', 'EQ\nCREDIT\nFX\nRATES', 'FX\nCREDIT\nEQ\nRATES', 'RATES\nFX\nEQ\nCREDIT'],
        hints: [
          'Compute `-2_000_000_000 - 1_500_000_000` in 32-bit arithmetic.',
          'Also try `-2_000_000_000 - 400_000_000`.',
        ],
        explanation:
          'Subtraction-based comparators overflow when the operands are far apart. `-2,000,000,000 - 1,500,000,000` wraps to `+794,967,296`, and `-2,000,000,000 - 400,000,000` wraps to `+1,894,967,296`, so RATES compares as **greater** than FX and CREDIT. The sort faithfully follows the broken comparator and puts the $2bn loss at the bottom. RATES vs EQ does not overflow (it gives a negative number), which makes the comparator inconsistent, not just reversed. On larger lists TimSort may even throw "Comparison method violates its general contract!"',
        timeLimitSec: 240,
        focusFile: 'RiskDashboard.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the faulty comparison',
        prompt: 'Click the buggy line and choose the root cause.',
        file: 'RiskDashboard.java',
        lines: [8],
        options: [
          '`a.pnl() - b.pnl()` can overflow `int`, flipping the sign of the comparison',
          'The comparator is reversed; it should be `b.pnl() - a.pnl()`',
          '`List.sort` is not stable, so equal P&Ls are shuffled',
          'Records cannot be compared with lambdas; `Breach` must implement `Comparable`',
        ],
        correct: 0,
        hints: ['Is the sign of `a - b` always the sign of the true difference?'],
        explanation:
          'The direction is right (ascending P&L). The problem is that `int` subtraction can overflow. Reversing the operands has exactly the same overflow. `List.sort` is a stable TimSort, and lambdas work fine with records.',
        timeLimitSec: 120,
        focusFile: 'RiskDashboard.java',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'The assistant\'s patch',
        prompt: 'The assistant proposes this fix. Should you accept it?',
        persona: 'helpful-senior',
        request: 'Fix the overflow in BY_PNL.',
        aiReply: `Use the overflow-safe comparison helpers instead of subtraction:

\`\`\`java
static final Comparator<Breach> BY_PNL = Comparator.comparingInt(Breach::pnl);
\`\`\`

\`comparingInt\` delegates to \`Integer.compare(x, y)\`, which is implemented as \`(x < y) ? -1 : ((x == y) ? 0 : 1)\`, so it never subtracts and cannot overflow. Ordering stays ascending (worst loss first). If you later want a tie-break, chain \`.thenComparing(Breach::desk)\`.`,
        options: [
          'Accept: `comparingInt` uses `Integer.compare`, which is overflow-safe and keeps ascending order',
          'Reject: `comparingInt` sorts descending by default',
          'Reject: method references on records are boxed, so it still overflows',
          'Reject: you must widen to `long` and subtract: `(int) ((long) a.pnl() - b.pnl())`',
        ],
        correct: 0,
        hints: ['Sometimes the assistant is right. Check each claim against what you know about `Integer.compare`.'],
        explanation:
          'The patch is correct. `Comparator.comparingInt` is ascending and uses `Integer.compare`, which compares instead of subtracting. The "widen to long" option is a classic false fix: the `long` difference is correct, but casting it back to `int` truncates to the low 32 bits and can flip the sign again (e.g. a difference of 2^32 + 1 becomes 1). Use `Long.compare` or `Long.signum` if you go via `long`.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 1
  {
    id: 'l2-b-cpp-ledger-copies',
    title: 'The Interest Run That Paid Nothing',
    level: 2,
    rating: 1200,
    lang: 'cpp',
    domain: 'ledger',
    companies: ['jpmorgan', 'goldman', 'apple', 'generic'],
    tags: ['copies', 'references', 'range-for', 'std-map'],
    summary: 'Value semantics bite: which writes reach the ledger and which hit a copy?',
    context:
      'The nightly batch applies 1% interest to every account. Customers report their balances never move. You suspect copies, but where?',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <map>
#include <string>
#include "ledger.h"

int main() {
    Ledger ledger;
    ledger.open("ACC-1", 100000);
    ledger.open("ACC-2", 50000);

    Account a = ledger.find("ACC-1");
    a.balanceCents -= 25000;              // withdrawal

    ledger.at(1).balanceCents += 1000;    // deposit
    Account b = ledger.at(1);
    b.balanceCents = 0;

    ledger.applyInterestBps(100);         // +1%
    std::cout << ledger.total() << '\\n';

    std::map<std::string, long> positions;
    positions["AAPL"] = 100;
    auto p = positions["AAPL"];
    p += 50;
    auto& q = positions["MSFT"];
    q += 10;
    std::cout << positions["AAPL"] << " " << positions["MSFT"] << " " << positions.size() << '\\n';
}
`,
      },
      {
        path: 'ledger.h',
        content: `#pragma once
#include <cstddef>
#include <string>
#include <vector>

struct Account {
    std::string id;
    long balanceCents;
};

class Ledger {
public:
    void open(const std::string& id, long cents) {
        accounts_.push_back({id, cents});
    }

    // Returns the account with this id, or an empty account.
    Account find(const std::string& id) const {
        for (const auto& a : accounts_) {
            if (a.id == id) return a;
        }
        return {"", 0};
    }

    Account& at(std::size_t i) { return accounts_[i]; }

    void applyInterestBps(long bps) {
        for (auto acct : accounts_) {
            acct.balanceCents += acct.balanceCents * bps / 10000;
        }
    }

    long total() const {
        long sum = 0;
        for (const auto& a : accounts_) sum += a.balanceCents;
        return sum;
    }

private:
    std::vector<Account> accounts_;
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'What reaches the ledger?',
        prompt: 'Predict exactly what `main.cpp` prints.',
        entry: 'main.cpp',
        answer: '151000\n100 10 2',
        options: ['127260\n150 10 2', '151000\n100 10 2', '126000\n100 10 2', '152510\n100 10 1'],
        hints: [
          '`Account a = ...` and `Account b = ...` declare new objects. A reference would be `Account&`.',
          'In `applyInterestBps`, what is the type of `acct`?',
          '`auto` drops references: `auto p = positions["AAPL"]` is a `long`, not a `long&`.',
        ],
        explanation:
          '`find` returns by value and `a` is a copy, so the withdrawal never touches the ledger. `ledger.at(1)` returns a reference, so the deposit lands (ACC-2 = 51,000), but `Account b = ledger.at(1)` copies it, so zeroing `b` is harmless. `applyInterestBps` iterates with `auto acct`, copying each account and updating the copy: no interest. Total = 100,000 + 51,000 = **151000**.\n\nFor the map, `auto p` copies the `long`, while `auto& q` binds to the newly inserted `MSFT` value. `operator[]` inserts MSFT, so the size is 2.',
        timeLimitSec: 240,
        focusFile: 'ledger.h',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Find the interest bug',
        prompt: 'Click the line that makes the interest run a no-op, then pick the fix.',
        file: 'ledger.h',
        lines: [28],
        options: [
          'Iterate by reference: `for (auto& acct : accounts_)`',
          'Use `const auto& acct` to avoid the copy',
          'Change `bps / 10000` to `bps / 10000.0`',
          'Make `accounts_` a `std::list` so elements are not copied',
        ],
        correct: 0,
        hints: ['Which object does `acct.balanceCents += ...` modify?'],
        explanation:
          '`for (auto acct : accounts_)` copies each `Account` (including its `std::string`!) and then mutates the copy. `auto&` binds to the element in the vector. `const auto&` would not compile because we are modifying it. The arithmetic is fine: multiplication happens before division, so integer cents work (1% of 100,000 = 1,000). The container type is irrelevant; the loop variable declaration decides copy vs reference.',
        timeLimitSec: 120,
        focusFile: 'ledger.h',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 2
  {
    id: 'l2-b-cpp-orderbook-invalidation',
    title: 'Dangling Orders',
    level: 2,
    rating: 1450,
    lang: 'cpp',
    domain: 'orderbook',
    companies: ['hrt', 'optiver', 'citadel', 'jane-street'],
    tags: ['iterator-invalidation', 'dangling-reference', 'vector', 'undefined-behaviour'],
    summary: 'A toy order book with two invalidation bugs. Spot them before they spot you.',
    context:
      'This order book passed code review because "it works on my machine". AddressSanitizer in CI disagrees. (Do not run it; reason about it.)',
    persona: 'lazy-copier',
    files: [
      {
        path: 'order_book.h',
        content: `#pragma once
#include <vector>

struct Order {
    int id;
    int qty;
    bool cancelled;
};

class OrderBook {
public:
    Order& add(int id, int qty) {
        orders_.push_back({id, qty, false});
        return orders_.back();
    }

    void cancel(int id) {
        for (auto& o : orders_) {
            if (o.id == id) o.cancelled = true;
        }
    }

    // Remove cancelled orders, keeping the rest in time priority.
    void purgeCancelled() {
        for (auto it = orders_.begin(); it != orders_.end(); ++it) {
            if (it->cancelled) {
                orders_.erase(it);
            }
        }
    }

    int totalQty() const {
        int sum = 0;
        for (const auto& o : orders_) sum += o.qty;
        return sum;
    }

private:
    std::vector<Order> orders_;
};
`,
      },
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include "order_book.h"

int main() {
    OrderBook book;
    Order& first = book.add(1, 100);
    book.add(2, 50);
    first.qty = 90;              // client amends order 1
    book.add(3, 70);
    book.cancel(2);
    book.purgeCancelled();
    std::cout << book.totalQty() << '\\n';
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'find-bug',
        title: 'Bug #1: the purge',
        prompt: 'Click the line in `order_book.h` that invalidates the loop iterator, then choose the root cause.',
        file: 'order_book.h',
        lines: [27],
        options: [
          '`erase(it)` invalidates `it` (and everything after it), yet the loop then does `++it` on it',
          '`erase` on a vector is O(n), which is a performance bug but not a correctness bug',
          '`it->cancelled` dereferences `end()` on the last iteration',
          'The loop should use `cbegin()`/`cend()` because it does not modify orders',
        ],
        correct: 0,
        hints: ['What does the standard say about iterators at or after the erase point?'],
        explanation:
          '`vector::erase(pos)` invalidates iterators and references at or after `pos`. Incrementing the invalidated `it` is undefined behaviour. In practice it often skips the element that slid into the hole, and if the last element is erased, `++it` steps past `end()` and the loop runs off the buffer. `erase` returns a valid iterator to the next element; use it.',
        timeLimitSec: 150,
        focusFile: 'order_book.h',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Bug #2: the amendment',
        prompt: 'Look at `main.cpp`: `Order& first = book.add(1, 100); book.add(2, 50); first.qty = 90;`. Which statements are true? Select all that apply.',
        options: [
          '`push_back` may reallocate the vector\'s buffer, leaving `first` dangling, so `first.qty = 90` is undefined behaviour',
          'Calling `orders_.reserve(1024)` in the constructor makes `first` valid as long as fewer than 1024 orders are added (and none erased)',
          'If `orders_` were a `std::deque<Order>`, `push_back` would keep `first` valid',
          '`back()` returns a reference into a separate heap node per element, so the reference is always stable',
          'Returning the order id from `add` and looking the order up by id when amending avoids the problem',
        ],
        correct: [0, 1, 2, 4],
        hints: [
          'A vector stores elements contiguously. What happens when capacity runs out?',
          '`deque::push_back` invalidates iterators but not references to existing elements.',
        ],
        explanation:
          'When capacity is exhausted, `push_back` allocates a new buffer, moves elements over and frees the old one, so every reference, pointer and iterator into the old buffer dangles. `reserve` prevents reallocation up to the reserved capacity. `std::deque` guarantees references survive insertion at either end (iterators do not). A vector has one contiguous buffer, not per-element nodes. Handing out stable ids (or indices into a stable store) instead of raw references is the production fix.',
        timeLimitSec: 240,
        focusFile: 'main.cpp',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: 'Review the purge fix',
        prompt: 'The assistant offers a fix for `purgeCancelled`. Would you merge it?',
        persona: 'lazy-copier',
        request: 'Fix the iterator invalidation in purgeCancelled().',
        aiReply: `\`erase\` returns the next valid iterator, so just reassign it:

\`\`\`cpp
void purgeCancelled() {
    for (auto it = orders_.begin(); it != orders_.end(); ++it) {
        if (it->cancelled) {
            it = orders_.erase(it);
        }
    }
}
\`\`\`

No more invalid iterator. ✔`,
        options: [
          'Accept: `it` is always valid now',
          'Reject: after `it = erase(it)` the loop still does `++it`, so the element after each erased order is skipped, and erasing the last order steps past `end()` (UB)',
          'Reject: `erase` returns `void` for vectors',
          'Reject: you can never erase from a vector inside a loop; copy into a new vector instead',
        ],
        correct: 1,
        hints: ['Trace it with orders `[cancelled, cancelled, live]`.', 'Then trace it with `[live, cancelled]`.'],
        explanation:
          'The iterator is now valid immediately after `erase`, but the `for` header still increments it. With `[C, C, L]` the second C is skipped. With `[L, C]`, `erase` returns `end()` and `++end()` is undefined behaviour. Correct options: only increment in the `else` branch (`if (...) it = erase(it); else ++it;`), or better, C++20 `std::erase_if(orders_, [](const Order& o) { return o.cancelled; });`, which is also O(n) total instead of O(n²).',
        timeLimitSec: 210,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 3
  {
    id: 'l2-b-cpp-instrument-slicing',
    title: 'Sliced Futures',
    level: 2,
    rating: 1400,
    lang: 'cpp',
    domain: 'pricing',
    companies: ['two-sigma', 'citadel', 'google', 'apple'],
    tags: ['virtual-dispatch', 'object-slicing', 'constructors', 'polymorphism'],
    summary: 'An E-mini future has a 50x multiplier, unless you pass it by value.',
    context:
      'The risk engine reports futures notionals as if every contract had a multiplier of 1. The pricing library looks fine at first glance.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <memory>
#include <vector>
#include "instrument.h"

void printRisk(Instrument inst) {
    std::cout << inst.describe() << " " << inst.notional(2) << '\\n';
}

int main() {
    Future es("ES", 50);
    std::vector<std::unique_ptr<Instrument>> owned;
    owned.push_back(std::make_unique<Future>("NQ", 20));

    const Instrument& ref = es;
    std::cout << ref.describe() << " " << ref.notional(2) << " " << ref.assetClass() << '\\n';
    std::cout << owned[0]->describe() << " " << owned[0]->notional(2) << '\\n';

    printRisk(es);

    std::vector<Instrument> book;
    book.push_back(es);
    std::cout << book[0].notional(3) << '\\n';
}
`,
      },
      {
        path: 'instrument.h',
        content: `#pragma once
#include <iostream>
#include <string>
#include <utility>

class Instrument {
public:
    explicit Instrument(std::string sym) : sym_(std::move(sym)) {
        std::cout << "register " << describe() << '\\n';
    }
    virtual ~Instrument() = default;

    virtual std::string describe() const { return "Instrument " + sym_; }
    virtual double notional(double qty) const { return qty; }
    std::string assetClass() const { return "generic"; }

protected:
    std::string sym_;
};

class Future : public Instrument {
public:
    Future(std::string sym, double multiplier)
        : Instrument(std::move(sym)), multiplier_(multiplier) {}

    std::string describe() const override { return "Future " + sym_; }
    double notional(double qty) const override { return qty * multiplier_; }
    std::string assetClass() const { return "futures"; }

private:
    double multiplier_;
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the risk report',
        prompt: 'Predict exactly what `main.cpp` prints.',
        entry: 'main.cpp',
        answer: 'register Instrument ES\nregister Instrument NQ\nFuture ES 100 generic\nFuture NQ 40\nInstrument ES 2\n3',
        options: [
          'register Future ES\nregister Future NQ\nFuture ES 100 futures\nFuture NQ 40\nFuture ES 100\n150',
          'register Instrument ES\nregister Instrument NQ\nFuture ES 100 generic\nFuture NQ 40\nInstrument ES 2\n3',
          'register Instrument ES\nregister Instrument NQ\nFuture ES 100 futures\nFuture NQ 40\nInstrument ES 2\n3',
          'register Future ES\nregister Future NQ\nFuture ES 100 generic\nFuture NQ 40\nFuture ES 100\n3',
        ],
        hints: [
          'While the `Instrument` base constructor runs, the object is not yet a `Future`.',
          'Only `virtual` functions dispatch on the dynamic type; `assetClass` is not virtual.',
          'Copying a `Future` into an `Instrument` object keeps only the `Instrument` part.',
        ],
        explanation:
          '**Constructors:** during `Instrument`\'s constructor the dynamic type is `Instrument`, so the virtual call to `describe()` resolves to the base version: `register Instrument ES`, `register Instrument NQ`.\n\n**Reference / pointer:** `ref` and `owned[0]` refer to real `Future` objects, so virtual calls dispatch to `Future`: `Future ES 100`, `Future NQ 40`. `assetClass()` is non-virtual, so it binds statically to `Instrument::assetClass` → `generic`.\n\n**Slicing:** `printRisk` takes `Instrument` by value, and `std::vector<Instrument>` stores `Instrument` objects. Copy-constructing an `Instrument` from a `Future` copies just the base sub-object (no multiplier, base vptr), so you get `Instrument ES 2` and `3`. This is the multiplier-of-1 bug.',
        timeLimitSec: 360,
        focusFile: 'instrument.h',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Where is the risk engine slicing?',
        prompt: 'The risk engine calls a function shaped like `printRisk`. Click its slicing line in `main.cpp` and choose the fix.',
        file: 'main.cpp',
        lines: [6],
        options: [
          'Take the parameter as `const Instrument& inst` so the dynamic type is preserved',
          'Mark `Instrument::notional` as `final`',
          'Add `virtual` to `Future::notional` as well as `override`',
          'Make `printRisk` a template on `std::string`',
        ],
        correct: 0,
        hints: ['Which line creates a brand new `Instrument` object out of a `Future`?'],
        explanation:
          'Pass-by-value constructs a new `Instrument` from the argument. A `const&` (or pointer / smart pointer) refers to the original `Future`, so `notional` dispatches to the override. `override` already implies virtual. In containers use `std::vector<std::unique_ptr<Instrument>>` (as `owned` does) rather than `std::vector<Instrument>`. Making the base class abstract (pure virtual `notional`) turns accidental slicing into a compile error.',
        timeLimitSec: 150,
        focusFile: 'main.cpp',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Hardening the hierarchy',
        prompt: 'Which changes would make the compiler **reject** at least one of the slicing mistakes in `main.cpp`? Select all that apply.',
        options: [
          'Make `notional` pure virtual in `Instrument` (`virtual double notional(double) const = 0;`)',
          'Delete the base copy constructor: `Instrument(const Instrument&) = delete;`',
          'Add `final` to the `Future` class',
          'Make `assetClass` virtual',
        ],
        correct: [0, 1],
        hints: ['Slicing needs to construct an object whose static type is `Instrument`.'],
        explanation:
          'An abstract class cannot be instantiated, so `Instrument inst` (by value) and `std::vector<Instrument>` no longer compile. Deleting the copy constructor forbids constructing an `Instrument` from a `Future`, which kills both the by-value parameter and `push_back(es)`. `final` stops further derivation but not slicing. Making `assetClass` virtual fixes the `generic` output for `ref`, but does not prevent slicing.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 4
  {
    id: 'l2-b-cpp-raii-transaction',
    title: 'The Transaction That Always Commits',
    level: 2,
    rating: 1550,
    lang: 'cpp',
    domain: 'ledger',
    companies: ['goldman', 'blackrock', 'microsoft', 'jane-street'],
    tags: ['raii', 'destructor-order', 'stack-unwinding', 'member-initialisation'],
    summary: 'Constructors, destructors and an exception. The log tells a worrying story.',
    context:
      'Booking runs inside a `Transaction` RAII guard. The auditors found trades in the ledger that had been rejected by the limit check. The debug build logs every construction and destruction.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <stdexcept>
#include "txn.h"

void book(bool breach) {
    Transaction tx;
    Trace("validate");
    Trace leg("leg");
    if (breach) throw std::runtime_error("limit breach");
    std::cout << "booked" << '\\n';
}

int main() {
    Trace session("session");
    book(false);
    try {
        book(true);
    } catch (const std::exception& e) {
        std::cout << "caught " << e.what() << '\\n';
    }
}
`,
      },
      {
        path: 'txn.h',
        content: `#pragma once
#include <iostream>
#include <string>
#include <utility>

struct Trace {
    std::string name;
    explicit Trace(std::string n) : name(std::move(n)) { std::cout << "+" << name << '\\n'; }
    ~Trace() { std::cout << "-" << name << '\\n'; }
};

class Transaction {
public:
    Transaction() : lock_("lock"), journal_("journal") {
        std::cout << "begin" << '\\n';
    }

    ~Transaction() {
        std::cout << "commit" << '\\n';
    }

private:
    Trace journal_;
    Trace lock_;
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the log',
        prompt: 'Predict exactly what `main.cpp` prints.',
        entry: 'main.cpp',
        answer:
          '+session\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\nbooked\n-leg\ncommit\n-lock\n-journal\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\n-leg\ncommit\n-lock\n-journal\ncaught limit breach\n-session',
        options: [
          '+session\n+lock\n+journal\nbegin\n+validate\n-validate\n+leg\nbooked\n-leg\ncommit\n-journal\n-lock\n+lock\n+journal\nbegin\n+validate\n-validate\n+leg\n-leg\ncommit\n-journal\n-lock\ncaught limit breach\n-session',
          '+session\n+journal\n+lock\nbegin\n+validate\n+leg\nbooked\n-leg\n-validate\ncommit\n-lock\n-journal\n+journal\n+lock\nbegin\n+validate\n+leg\n-leg\n-validate\ncommit\n-lock\n-journal\ncaught limit breach\n-session',
          '+session\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\nbooked\n-leg\ncommit\n-lock\n-journal\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\n-leg\ncommit\n-lock\n-journal\ncaught limit breach\n-session',
          '+session\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\nbooked\n-leg\ncommit\n-lock\n-journal\n+journal\n+lock\nbegin\n+validate\n-validate\n+leg\ncaught limit breach\n-leg\ncommit\n-lock\n-journal\n-session',
        ],
        hints: [
          'Members are constructed in **declaration** order, whatever order the initialiser list uses.',
          '`Trace("validate");` creates a temporary. When does a temporary die?',
          'During stack unwinding, all locals of `book` are destroyed **before** the catch handler runs.',
        ],
        explanation:
          '**Members:** `journal_` is declared before `lock_`, so it is constructed first even though the initialiser list names `lock_` first (clang warns with `-Wreorder`). Destruction is the exact reverse: the destructor body (`commit`) runs, then `lock_`, then `journal_`.\n\n**Temporary:** `Trace("validate");` is an unnamed temporary destroyed at the end of the full expression, so `-validate` comes immediately.\n\n**Locals:** destroyed in reverse order of construction: `leg`, then `tx`.\n\n**Exception:** throwing unwinds `book`\'s frame (destroying `leg`, then `tx`, which prints `commit`!) before control reaches the `catch` block. `session` dies last when `main` returns.',
        timeLimitSec: 420,
        focusFile: 'txn.h',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace the unwinding',
        prompt: 'Starting from `throw std::runtime_error("limit breach")` in the second call to `book`, put the events in order.',
        items: [
          '`throw` starts unwinding `book`\'s stack frame',
          '`leg` is destroyed (prints `-leg`)',
          '`~Transaction` body runs (prints `commit`)',
          'Member `lock_` is destroyed (prints `-lock`)',
          'Member `journal_` is destroyed (prints `-journal`)',
          'The catch handler in `main` runs (prints `caught limit breach`)',
          '`main` returns and `session` is destroyed (prints `-session`)',
        ],
        hints: ['Locals die in reverse order of construction; for an object, its destructor body runs before its members are destroyed.'],
        explanation:
          'Unwinding destroys every fully-constructed automatic object between the throw and the handler, newest first. For each class object, the destructor body runs first and then members are destroyed in reverse declaration order. Only after the frame is gone does the handler run.',
        timeLimitSec: 240,
        focusFile: 'txn.h',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Why did rejected trades get booked?',
        prompt: 'Click the line in `txn.h` that explains the audit finding, then choose the root cause.',
        file: 'txn.h',
        lines: [18, 19],
        options: [
          'The destructor commits unconditionally, so a transaction abandoned by an exception is committed during unwinding; it should roll back unless `commit()` was called explicitly',
          'The initialiser list order means the lock is taken after the journal is opened',
          'The destructor must be `virtual`',
          'The destructor must be `noexcept(false)` so the exception can propagate',
        ],
        correct: 0,
        hints: ['Look at the log for the breach case. What gets printed between `-leg` and `-lock`?'],
        explanation:
          'A destructor cannot tell success from failure on its own, so the safe RAII pattern is *rollback by default*: add an explicit `void commit()` that sets `committed_ = true`, and have the destructor roll back when `committed_` is false. The member-order warning (line 14 vs 23-24) is real and worth fixing (the lock should normally be acquired first), but it is not what booked rejected trades. `Transaction` is not used polymorphically, so `virtual` is irrelevant.',
        timeLimitSec: 180,
        focusFile: 'txn.h',
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 5
  {
    id: 'l2-b-cpp-exposure-map',
    title: 'Exposure by Symbol',
    level: 2,
    rating: 1250,
    lang: 'cpp',
    domain: 'risk',
    companies: ['blackrock', 'optiver', 'amazon', 'generic'],
    tags: ['std-map', 'ordering', 'operator-brackets', 'comparators'],
    summary: 'std::map sorts. But in which order, and what does operator[] do to a lookup?',
    context:
      'The end-of-day exposure report aggregates fills per symbol with `std::map`. A second map holds the bid ladder.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <functional>
#include <iostream>
#include <map>
#include <string>
#include <vector>

struct Fill {
    std::string symbol;
    long qty;
};

int main() {
    std::vector<Fill> fills = {
        {"MSFT", 10}, {"aapl", 5}, {"AAPL", 7}, {"BRK.B", 3},
        {"10Y", 2}, {"AAPL", -7}, {"Zinc", 1},
    };

    std::map<std::string, long> exposure;
    for (const auto& f : fills) exposure[f.symbol] += f.qty;

    for (const auto& [sym, qty] : exposure) std::cout << sym << "=" << qty << " ";
    std::cout << '\\n';

    if (exposure["GOOG"] == 0) std::cout << "GOOG flat" << '\\n';
    std::cout << exposure.size() << '\\n';

    std::map<int, long, std::greater<int>> bids = {{10050, 300}, {10100, 200}, {9990, 500}};
    std::cout << "best bid " << bids.begin()->first << '\\n';
    auto it = bids.lower_bound(10000);
    std::cout << "lower_bound " << it->first << '\\n';
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the report',
        prompt: 'Predict exactly what `main.cpp` prints (trailing spaces are ignored).',
        entry: 'main.cpp',
        answer: '10Y=2 AAPL=0 BRK.B=3 MSFT=10 Zinc=1 aapl=5\nGOOG flat\n7\nbest bid 10100\nlower_bound 9990',
        options: [
          '10Y=2 AAPL=0 BRK.B=3 MSFT=10 Zinc=1 aapl=5\nGOOG flat\n7\nbest bid 10100\nlower_bound 9990',
          'AAPL=0 aapl=5 BRK.B=3 MSFT=10 Zinc=1 10Y=2\nGOOG flat\n6\nbest bid 10100\nlower_bound 10050',
          '10Y=2 AAPL=0 BRK.B=3 MSFT=10 Zinc=1 aapl=5\nGOOG flat\n6\nbest bid 9990\nlower_bound 10050',
          'MSFT=10 aapl=5 AAPL=0 BRK.B=3 10Y=2 Zinc=1\nGOOG flat\n7\nbest bid 10100\nlower_bound 9990',
        ],
        hints: [
          '`std::string` compares byte by byte: digits < upper-case letters < lower-case letters in ASCII.',
          '`exposure["GOOG"]` on a missing key inserts it.',
          'With `std::greater<int>`, "lower_bound" means the first key `k` for which `k > 10000` is false.',
        ],
        explanation:
          '`std::map` keeps keys sorted by its comparator (`std::less<std::string>` = lexicographic by `char` value). ASCII order puts `1` (0x31) before `A`-`Z` (0x41-0x5A) before `a`-`z` (0x61-0x7A), so `Zinc` comes before `aapl`. The AAPL fills net to 0 but the key stays.\n\n`operator[]` default-inserts `GOOG=0`, so the comparison is true and the size grows from 6 to **7**. Use `find`/`contains` for read-only lookups.\n\nWith `std::greater<int>` the map is ordered descending, so `begin()` is the highest bid, 10100. `lower_bound(k)` returns the first element not ordered before `k`, i.e. the first key `<= 10000` in descending order: **9990**.',
        timeLimitSec: 300,
        focusFile: 'main.cpp',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'Read-only lookups',
        prompt: 'The report function receives `const std::map<std::string, long>& exposure`. Which expressions compile **and** do not modify the map? Select all that apply.',
        options: [
          '`exposure.find("GOOG") != exposure.end()`',
          '`exposure.contains("GOOG")` (C++20)',
          '`exposure["GOOG"]`',
          '`exposure.at("GOOG")` (throws `std::out_of_range` if missing)',
          '`exposure.count("GOOG")`',
        ],
        correct: [0, 1, 3, 4],
        hints: ['`operator[]` has no `const` overload. Why not?'],
        explanation:
          '`operator[]` must be able to insert a default value, so it is non-const and will not compile on a `const` map. That is a feature: it forces you to choose `find`, `contains`, `count` or `at`, none of which insert.',
        timeLimitSec: 150,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 6
  {
    id: 'l2-b-cpp-fx-integer-math',
    title: 'FX Conversion in Cents',
    level: 2,
    rating: 1150,
    lang: 'cpp',
    domain: 'fx',
    companies: ['stripe', 'jpmorgan', 'amazon', 'apple'],
    tags: ['integer-division', 'casting', 'truncation', 'signed-unsigned'],
    summary: 'Truncating casts, integer division and a signed/unsigned comparison walk into a bank.',
    context:
      'The FX desk\'s helper header converts amounts held in integer cents. Reconciliation is off by a cent here and there, and the average price report never shows decimals.',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <vector>
#include "fx.h"

int main() {
    std::cout << convertCents(100, 0.29) << '\\n';
    std::cout << averagePrice({10010, 10020}, {1, 2}) << '\\n';
    std::cout << lotsNeeded(250, 100) << " " << -250 / 100 << " " << -250 % 100 << '\\n';

    int threshold = -1;
    std::vector<long> fills{5, 6, 7};
    std::cout << (threshold < fills.size() ? "below" : "not below") << '\\n';
}
`,
      },
      {
        path: 'fx.h',
        content: `#pragma once
#include <cstddef>
#include <vector>

// Converts an amount in minor units (cents) at a quoted rate, to whole cents.
inline long convertCents(long cents, double rate) {
    return static_cast<long>(cents * rate);
}

// Volume-weighted average fill price, in cents.
inline double averagePrice(const std::vector<long>& pxCents, const std::vector<long>& qty) {
    long notional = 0;
    long volume = 0;
    for (std::size_t i = 0; i < pxCents.size(); ++i) {
        notional += pxCents[i] * qty[i];
        volume += qty[i];
    }
    return notional / volume;
}

// Round lots required to cover a share quantity.
inline int lotsNeeded(int shares, int lotSize) {
    return shares / lotSize;
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Predict the numbers',
        prompt: 'Predict exactly what `main.cpp` prints.',
        entry: 'main.cpp',
        answer: '28\n10016\n2 -2 -50\nnot below',
        options: [
          '29\n10016.7\n3 -3 50\nbelow',
          '28\n10016\n2 -2 -50\nnot below',
          '29\n10016\n2 -3 50\nbelow',
          '28\n10016.7\n2 -2 -50\nbelow',
        ],
        hints: [
          '0.29 is not exactly representable in binary. Is it slightly above or below 0.29?',
          'In `averagePrice`, what type is `notional / volume` computed in, *before* it is converted to `double`?',
          'Integer division truncates toward zero in C++, and `%` takes the sign of the dividend.',
          'In `threshold < fills.size()`, `size()` is unsigned. What happens to `-1`?',
        ],
        explanation:
          '`100 * 0.29` is `28.999999999999996`; `static_cast<long>` truncates → **28**, a cent lost. Use `std::llround`.\n\n`averagePrice`: `30050 / 3` is evaluated in `long` arithmetic (= 10016) and only then converted to `double`, so the return type does not help.\n\n`250 / 100` = 2 (should be 3 lots to *cover* 250 shares). C++ truncates toward zero: `-250 / 100 = -2` and `-250 % 100 = -50` (unlike Python\'s floor semantics, which would give -3 and 50).\n\n`threshold < fills.size()` converts `-1` to `size_t`, i.e. 18446744073709551615, so it is **not** below 3. Compilers warn with `-Wsign-compare`; C++20 offers `std::cmp_less`.',
        timeLimitSec: 300,
        focusFile: 'fx.h',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'Fix the average price',
        prompt: 'Click the line that loses the fractional part of the average price, then choose the fix.',
        file: 'fx.h',
        lines: [18],
        options: [
          '`return static_cast<double>(notional) / volume;`',
          '`return static_cast<double>(notional / volume);`',
          'Change the return type to `long double`',
          '`return (notional / volume) * 1.0;`',
        ],
        correct: 0,
        hints: ['At least one operand must be floating point **before** the division happens.'],
        explanation:
          'Casting one operand converts the other via the usual arithmetic conversions, so the division happens in `double`. Casting the result, multiplying by `1.0` afterwards, or widening the return type all operate on the already-truncated `long` quotient. (A real VWAP should also guard against `volume == 0`, which is integer division by zero: undefined behaviour.)',
        timeLimitSec: 120,
        focusFile: 'fx.h',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Lots to cover an order',
        prompt: '`lotsNeeded(250, 100)` should return 3 (you cannot buy a partial lot, so round **up**). Assuming `shares >= 0` and `lotSize > 0`, which implementations are correct? Select all that apply.',
        options: [
          '`return (shares + lotSize - 1) / lotSize;`',
          '`return shares / lotSize + (shares % lotSize != 0);`',
          '`return static_cast<int>(std::ceil(shares / lotSize));`',
          '`return shares / lotSize + 1;`',
        ],
        correct: [0, 1],
        hints: ['Try `shares = 200` and `shares = 250` for each.', 'What does `std::ceil` receive in option C?'],
        explanation:
          'Both integer ceil-division idioms work (the first can overflow near `INT_MAX`, the second cannot). `std::ceil(shares / lotSize)` receives the already-truncated integer 2, so it returns 2. `+ 1` is wrong for exact multiples: 200 shares would need 3 lots.',
        timeLimitSec: 180,
      },
    ],
  },

  // ───────────────────────────────────────────────────────────── C++ 7
  {
    id: 'l2-b-cpp-snapshot-moves',
    title: 'Zero-Copy Book Snapshots',
    level: 2,
    rating: 1600,
    lang: 'cpp',
    domain: 'market-data',
    companies: ['hrt', 'jane-street', 'optiver', 'google'],
    tags: ['move-semantics', 'copy-elision', 'const', 'emplace'],
    summary: 'Count the copies and moves. std::move does not always move.',
    context:
      'The market-data publisher snapshots the order book many times per second. Profiling shows more vector copies than expected. `BookSnapshot` is instrumented to count copies and moves.',
    persona: 'confident-intern',
    files: [
      {
        path: 'main.cpp',
        content: `#include <iostream>
#include <utility>
#include <vector>
#include "snapshot.h"

int main() {
    BookSnapshot a(std::vector<long>{100, 101, 102});
    BookSnapshot b = a;
    BookSnapshot c = std::move(a);
    const BookSnapshot d = b;
    BookSnapshot e = std::move(d);
    BookSnapshot f = BookSnapshot(std::vector<long>{5});

    std::vector<BookSnapshot> history;
    history.reserve(4);
    history.push_back(b);
    history.push_back(std::move(b));
    history.push_back(BookSnapshot(std::vector<long>{1}));
    history.emplace_back(std::vector<long>{2, 3});

    std::cout << a.levels.size() << " " << c.levels.size() << " " << e.levels.size() << '\\n';
    std::cout << "copies=" << BookSnapshot::copies << " moves=" << BookSnapshot::moves << '\\n';
}
`,
      },
      {
        path: 'snapshot.h',
        content: `#pragma once
#include <utility>
#include <vector>

struct BookSnapshot {
    std::vector<long> levels;

    static inline int copies = 0;
    static inline int moves = 0;

    explicit BookSnapshot(std::vector<long> l) : levels(std::move(l)) {}

    BookSnapshot(const BookSnapshot& o) : levels(o.levels) { ++copies; }
    BookSnapshot(BookSnapshot&& o) noexcept : levels(std::move(o.levels)) { ++moves; }

    BookSnapshot& operator=(const BookSnapshot&) = default;
    BookSnapshot& operator=(BookSnapshot&&) = default;
};
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Count copies and moves',
        prompt: 'Predict exactly what `main.cpp` prints. (A moved-from `std::vector` is guaranteed empty after its move constructor.)',
        entry: 'main.cpp',
        answer: '0 3 3\ncopies=4 moves=3',
        options: ['0 3 3\ncopies=3 moves=5', '0 3 3\ncopies=4 moves=3', '3 3 3\ncopies=4 moves=3', '0 3 0\ncopies=3 moves=4'],
        hints: [
          '`std::move` is only a cast to an rvalue reference. What does `std::move` of a **const** object bind to?',
          'Since C++17, initialising from a prvalue of the same type (`T x = T(...)`) constructs directly: no move.',
          '`emplace_back` forwards the arguments to the constructor inside the vector.',
        ],
        explanation:
          'Copies: `b = a` (1), `d = b` (2), `e = std::move(d)`: `d` is const, so `std::move(d)` is `const BookSnapshot&&`, which cannot bind to `BookSnapshot&&` and falls back to the copy constructor (3), `push_back(b)` (4).\n\nMoves: `c = std::move(a)` (1), `push_back(std::move(b))` (2), `push_back(BookSnapshot(...))` binds the temporary to `push_back(T&&)` and moves it into the buffer (3).\n\nNot counted: `f` uses guaranteed copy elision; `emplace_back` constructs in place via the `vector<long>` constructor; `reserve(4)` prevents any reallocation moves.\n\n`a` was moved from, so its vector is empty (0); `c` and `e` both hold 3 levels.',
        timeLimitSec: 360,
        focusFile: 'snapshot.h',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Make publish zero-copy',
        prompt: 'The assistant claims this makes publishing zero-copy. Would you merge it?',
        persona: 'confident-intern',
        request: 'publish() shows up in the profiler copying snapshots. Make it zero-copy.',
        aiReply: `Wrap it in \`std::move\` and the vector buffer is stolen instead of copied:

\`\`\`cpp
void publish(std::vector<BookSnapshot>& out, const BookSnapshot& snap) {
    out.push_back(std::move(snap));   // zero-copy now
}
\`\`\`

Callers don't need to change anything. 🎯`,
        options: [
          'Accept: `std::move` turns the push into a move',
          'Reject: `snap` is `const&`, so `std::move(snap)` is `const BookSnapshot&&`, which selects the copy constructor; take `BookSnapshot snap` by value (or `BookSnapshot&&`) and move from that',
          'Reject: `push_back` cannot accept rvalues; use `emplace_back`',
          'Reject: moving makes the caller\'s snapshot empty, which is undefined behaviour to read',
        ],
        correct: 1,
        hints: ['Look at the result for `e` in the previous stage.'],
        explanation:
          'You cannot move out of a `const` object: the move constructor needs a non-const rvalue to steal the buffer. The code compiles and silently copies, exactly like `e = std::move(d)` above. A sink parameter by value (`void publish(std::vector<BookSnapshot>& out, BookSnapshot snap) { out.push_back(std::move(snap)); }`) lets callers choose: they pass `std::move(x)` to move or an lvalue to copy. `push_back(T&&)` exists. A moved-from vector is in a valid state; reading it is not UB.',
        timeLimitSec: 210,
      },
    ],
  },
];

export default problems;
