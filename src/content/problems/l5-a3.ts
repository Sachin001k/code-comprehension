import type { Problem } from '../types';

/**
 * L5 Grandmaster set A (part 3): Java.
 * JMM (visibility, DCL, final-field semantics), mutable HashMap keys + ConcurrentHashMap,
 * class/instance initialisation order, overload resolution / boxing / string identity.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 12. Java Memory Model: store buffering, visibility, DCL and final fields
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-java-jmm-dcl',
    title: 'Happens-Before or It Didn\'t Happen',
    level: 5,
    rating: 2950,
    lang: 'java',
    domain: 'concurrency',
    companies: ['hrt', 'citadel', 'jane-street', 'optiver', 'goldman'],
    tags: ['jmm', 'volatile', 'happens-before', 'double-checked-locking', 'final-fields', 'data-race'],
    summary: 'Litmus tests, a spin-on-flag publisher, and a DCL "proof" that final fields make volatile unnecessary.',
    context:
      'The low-latency pricing JVM avoids locks on hot paths. A strategy thread occasionally NPEs right after startup, and in another JVM it spins forever. A reviewer is also proposing to drop `volatile` from a singleton because "the config is immutable".',
    persona: 'confident-intern',
    files: [
      {
        path: 'QuotePublisher.java',
        content: `/** Single writer (feed handler thread), many readers (strategy threads). */
public final class QuotePublisher {
    private double[] bids;
    private double[] asks;
    private boolean ready;
    private long seq;

    /** Called once by the feed thread when the first full book arrives. */
    public void publishInitial(double[] bidLevels, double[] askLevels) {
        bids = bidLevels.clone();
        asks = askLevels.clone();
        seq = 1;
        ready = true;
    }

    /** Called by strategy threads; spins until the initial book is available. */
    public double mid() {
        while (!ready) {
            Thread.onSpinWait();
        }
        return (bids[0] + asks[0]) / 2.0;
    }

    public long seq() {
        return seq;
    }
}
`,
      },
      {
        path: 'PricingConfig.java',
        content: `import java.util.Map;

public final class PricingConfig {
    private static PricingConfig instance;

    private final Map<String, Double> spreads;
    private final double defaultSpread;

    private PricingConfig(Map<String, Double> spreads, double defaultSpread) {
        this.spreads = Map.copyOf(spreads);
        this.defaultSpread = defaultSpread;
    }

    public static PricingConfig get() {
        if (instance == null) {
            synchronized (PricingConfig.class) {
                if (instance == null) {
                    instance = new PricingConfig(loadSpreads(), 0.01);
                }
            }
        }
        return instance;
    }

    public double spread(String sym) {
        return spreads.getOrDefault(sym, defaultSpread);
    }

    private static Map<String, Double> loadSpreads() {
        return Map.of("AAPL", 0.01, "TSLA", 0.05);
    }
}
`,
      },
      {
        path: 'Litmus.java',
        content: `/** Store-buffering litmus test. Each method runs on its own thread, once, starting from x = y = 0. */
class Litmus {
    int x, y;      // plain fields (variants below change this)
    int r1, r2;

    void thread1() {
        x = 1;
        r1 = y;
    }

    void thread2() {
        y = 1;
        r2 = x;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Store buffering',
        prompt:
          'Both threads of `Litmus` run once, concurrently, after `x = y = 0` has been safely published. Select **all** statements that are true under the Java Memory Model.',
        options: [
          'With plain fields, the outcome `r1 == 0 && r2 == 0` is allowed',
          'With plain fields, `r1 == 0 && r2 == 0` cannot occur on x86 hardware because x86 does not reorder memory operations',
          'Declaring **only** `x` volatile is enough to forbid `r1 == 0 && r2 == 0`',
          'Declaring **both** `x` and `y` volatile forbids `r1 == 0 && r2 == 0`',
          'Wrapping each thread\'s two statements in `synchronized (lock) { ... }` on the same lock forbids `r1 == 0 && r2 == 0`',
        ],
        correct: [0, 3, 4],
        hints: [
          'Volatile accesses are totally ordered by the synchronization order, which is consistent with each thread\'s program order.',
          'x86 is TSO: it has a store buffer, so a later load can complete before an earlier store becomes visible.',
          'With only `x` volatile, is there any happens-before edge that orders T2\'s plain write of `y` before T1\'s plain read of `y`?',
        ],
        explanation: `**Plain fields.** The program has data races on both variables, and the JMM allows each read to see the initial 0. Hardware does exactly this: on x86 (TSO), \`x = 1\` can sit in T1's store buffer while \`r1 = y\` reads 0 from cache, and symmetrically on T2. JIT reordering of independent plain accesses gives the same result.

**Both volatile.** All four accesses are synchronization actions, totally ordered by a synchronization order consistent with program order (sequential consistency for volatile). Whichever write comes first in that order precedes the other thread's read, so at least one thread sees 1. The JIT emits a StoreLoad fence (e.g. \`lock addl\` on x86) after volatile stores for exactly this reason.

**Only x volatile.** If T2's volatile read of \`x\` sees 0, it precedes T1's volatile write in synchronization order. That creates no happens-before edge from T2's plain write of \`y\` to T1's plain read of \`y\`, so T1 may still see 0. Forbidden outcomes need fences on *both* sides.

**Same lock.** The critical sections are totally ordered, and unlock → subsequent lock is a happens-before edge, so the second section sees the first's write.`,
        timeLimitSec: 600,
        focusFile: 'Litmus.java',
      },
      {
        id: 's2',
        kind: 'find-bug',
        title: 'The flag that publishes nothing',
        prompt:
          'Strategy threads call `mid()` while the feed thread calls `publishInitial(...)` once. Symptoms: occasionally an NPE inside `mid()`, and on one host a strategy thread spins forever at 100% CPU. Click the root-cause line and pick the explanation.',
        file: 'QuotePublisher.java',
        lines: [5],
        options: [
          '`ready` is not volatile: there is no happens-before edge from the writes of `bids`/`asks` to the reader, so a reader may see `ready == true` with `bids == null` (NPE), and the JIT may hoist the non-volatile read out of the spin loop so it never observes the update',
          '`bidLevels.clone()` makes a shallow copy, so the feed thread can still mutate the array the readers use',
          '`Thread.onSpinWait()` releases the monitor, letting another thread reset `ready`',
          '`seq` is a `long`, and non-volatile long writes may tear, which corrupts `ready`',
        ],
        correct: 0,
        hints: ['What makes the writes before `ready = true` visible to a thread that reads `ready`?'],
        explanation:
          'Safe publication needs a happens-before edge: a volatile write of `ready` followed by a volatile read that sees it orders every write before the store (the `bids`/`asks` stores) before every read after the load. Without `volatile`: (1) the compiler or CPU may reorder `ready = true` ahead of the array stores (or the reader\'s loads), so a reader sees `true` but a null or stale `bids`; (2) for a plain field, the JIT may legally read `ready` once and turn `while (!ready)` into an infinite loop, since nothing forces a re-read. Fix: `private volatile boolean ready;` (and write it last). The clone is fine (doubles are values), and long tearing (JLS 17.7) affects `seq` itself, not `ready`.',
        timeLimitSec: 420,
        focusFile: 'QuotePublisher.java',
      },
      {
        id: 's3',
        kind: 'review-ai',
        title: '"Immutable, so no volatile needed"',
        prompt:
          '`PricingConfig` uses double-checked locking without `volatile`. A reviewer bot argues it is correct as written. Review the argument.',
        persona: 'helpful-senior',
        request: 'Is the DCL in PricingConfig.get() safe without volatile?',
        aiReply: `Yes, and this is a well-known subtlety. The classic DCL bug is that another thread can see a non-null \`instance\` whose fields are not yet initialised. But **JLS 17.5 (final field semantics)** guarantees that any thread that obtains a reference to an object, even through a data race, sees its \`final\` fields (and everything reachable through them, like the copied map) as they were at the end of the constructor, provided \`this\` does not escape during construction.

\`PricingConfig\` has only \`final\` fields and \`this\` does not escape, so a racy read of \`instance\` can never observe a half-built object. \`volatile\` is unnecessary here; leave \`get()\` exactly as written. ✅`,
        options: [
          'Accept: final-field semantics make the racy publication safe, so `get()` is correct as written',
          'Reject: final-field guarantees do not apply to objects published through a data race; only `volatile` or locking makes fields visible',
          'Reject: the final-field argument is right about the *object*, but `get()` performs **two** unsynchronized reads of `instance` (the null check and the `return`). Under the JMM these racy reads are independent, so the first can see the new reference and the second can still see `null`, and `get()` returns null. It needs a local variable (read once) or `volatile`',
          'Reject: `synchronized (PricingConfig.class)` can deadlock with class initialisation of `PricingConfig`',
        ],
        correct: 2,
        hints: [
          'The final-field part of the argument is actually correct. Look elsewhere.',
          'How many times does `get()` read the static field `instance` outside the lock, and must those reads agree?',
        ],
        explanation: `The bot is right about JLS 17.5: final fields (and objects reachable through them, as of the end of the constructor) are seen correctly even when the reference is obtained through a race. That is what makes immutable objects "safe to publish racily". But the method still has a **second race**: \`if (instance == null)\` and \`return instance\` are two separate plain reads of a field written by another thread without synchronization. The JMM does not require racy reads to be monotonic. The second read can legally see the older value \`null\` even if the first saw the new reference (reads may be reordered, and nothing ties the two reads together). So \`get()\` can return \`null\`.

The correct "final wrapper" variant reads once into a local:
\`\`\`java
PricingConfig local = instance;
if (local == null) {
    synchronized (PricingConfig.class) {
        local = instance;
        if (local == null) instance = local = new PricingConfig(loadSpreads(), 0.01);
    }
}
return local;
\`\`\`
In practice prefer \`volatile\` or, better, the holder-class idiom (class initialisation is lazy and thread-safe per JLS 12.4.2).`,
        timeLimitSec: 600,
        focusFile: 'PricingConfig.java',
      },
      {
        id: 's4',
        kind: 'mcq',
        title: 'Which lazy singletons are correct?',
        prompt: 'Select **all** implementations that are guaranteed by the JMM to (a) never return `null`, (b) never expose an object with unset fields, and (c) construct **at most one** instance, for any number of threads.',
        options: [
          'DCL with `private static volatile PricingConfig instance;` (otherwise identical to the code)',
          'Holder idiom: `private static class Holder { static final PricingConfig I = new PricingConfig(...); }` and `get()` returns `Holder.I`',
          'DCL without volatile, reading `instance` once into a local as shown in the explanation, with `PricingConfig` having only `final` fields and no `this`-escape',
          'DCL without volatile, read once into a local, but `PricingConfig` has a non-final `Map spreads` assigned in the constructor',
          'No locking at all: `if (instance == null) instance = new PricingConfig(...); return instance;` with `instance` volatile',
        ],
        correct: [0, 1, 2],
        hints: ['Check all three properties for each option. Option 5 is fine on (a) and (b); what about (c)?'],
        explanation:
          '1: volatile write/read gives happens-before from construction to use. 2: class initialisation is guarded by the JVM\'s init lock (JLS 12.4.2), and every thread that observes the initialised class sees the static initialiser\'s writes. 3: one read of the reference plus final-field semantics is sufficient. 4: a non-final field gets no 17.5 guarantee, so a racy reader may see `spreads == null`. 5: volatile guarantees (a) and (b) (the second volatile read sees the same or a later, non-null value), but the unsynchronized check-then-act lets two threads both see `null` and both construct, which violates (c).',
        timeLimitSec: 540,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 13. HashMap with a mutable key; ConcurrentHashMap compound operations
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-java-mutable-key-chm',
    title: 'The Price Level That Vanished From the Map',
    level: 5,
    rating: 2450,
    lang: 'java',
    domain: 'orderbook',
    companies: ['goldman', 'jpmorgan', 'blackrock', 'optiver'],
    tags: ['hashmap', 'hashcode', 'mutable-keys', 'concurrenthashmap', 'atomicity'],
    summary: 'A price-level key is "amended" in place while sitting in a HashMap. Then: which ConcurrentHashMap compound updates are atomic?',
    context:
      'The depth aggregator keys resting quantity by `(symbol, priceTicks)`. When an order is amended, the code mutates the key\'s price in place. Depth views now show phantom and missing levels.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'Main.java',
        content: `import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

final class LevelKey {
    final String sym;
    long priceTicks;

    LevelKey(String sym, long priceTicks) {
        this.sym = sym;
        this.priceTicks = priceTicks;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof LevelKey k && k.sym.equals(sym) && k.priceTicks == priceTicks;
    }

    @Override
    public int hashCode() {
        return Objects.hash(sym, priceTicks);
    }
}

public class Main {
    public static void main(String[] args) {
        Map<LevelKey, Integer> depth = new HashMap<>();
        LevelKey k = new LevelKey("ES", 450025);
        depth.put(k, 10);

        k.priceTicks = 450050; // "amend" the level in place
        System.out.println(depth.get(k) + " " + depth.get(new LevelKey("ES", 450025)) + " " + depth.get(new LevelKey("ES", 450050)));
        System.out.println(depth.containsKey(k) + " " + depth.containsValue(10) + " " + depth.keySet().contains(k));

        depth.put(k, 20);
        System.out.println(depth.size() + " " + depth.values().stream().mapToInt(Integer::intValue).sum());

        k.priceTicks = 450025;
        System.out.println(depth.get(k) + " " + depth.remove(k) + " " + depth.size());

        long stale = depth.keySet().stream().filter(x -> x == k).count();
        System.out.println(stale + " " + depth.get(k) + " " + depth.entrySet().iterator().next().getValue());
    }
}
`,
      },
      {
        path: 'PositionBook.java',
        content: `import java.util.concurrent.ConcurrentHashMap;

/** Called concurrently from many fill-handler threads. */
public final class PositionBook {
    private final ConcurrentHashMap<String, Long> positions = new ConcurrentHashMap<>();

    public void onFill(String sym, long signedQty) {
        Long cur = positions.get(sym);
        positions.put(sym, cur == null ? signedQty : cur + signedQty);
    }

    public long position(String sym) {
        return positions.getOrDefault(sym, 0L);
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Where did level 450025 go?',
        prompt:
          'Predict the output of `Main.java` on OpenJDK\'s `HashMap` (which caches each entry\'s hash at insertion and compares the cached hash before calling `equals`). The two prices have different `hashCode`s.',
        answer: 'null null null\nfalse true false\n2 30\n10 10 1\n1 null 20',
        options: [
          'null null null\nfalse true false\n2 30\n10 10 1\n1 null 20',
          '10 null 10\ntrue true true\n1 20\n20 20 0\n0 null 20',
          'null 10 null\nfalse true false\n2 30\n10 10 1\n1 20 20',
          'null null 10\nfalse true true\n1 20\nnull null 1\n1 20 20',
        ],
        hints: [
          'A lookup first selects a bucket by `hash(key)` and then requires `node.hash == hash && (node.key == key || key.equals(node.key))`.',
          'After mutation, the stored node still has the *old* hash but holds the *same object* `k`, whose fields have changed.',
        ],
        explanation: `The entry was stored under h₁ = hash(ES, 450025). After mutation, \`k\` hashes to h₂.
1. \`get(k)\` searches with h₂ and finds no node with hash h₂, so null. \`get(new (ES,450025))\` searches with h₁ and finds the node, but \`equals\` compares against the *mutated* \`k\` (450050), so null. \`get(new (ES,450050))\` uses h₂, so null. The entry is unreachable by any key.
2. \`containsKey\`/\`keySet().contains\` use the same lookup, so false. \`containsValue\` scans all entries, so true.
3. \`put(k, 20)\` finds nothing under h₂ and inserts a **second** entry holding the same key object: size 2, values 10 + 20.
4. Restoring the price makes \`k\` hash to h₁ again. The first node matches by identity, so \`get\` gives 10 and \`remove\` gives 10, leaving size 1.
5. The survivor holds \`k\` but sits under h₂, while \`k\` now hashes to h₁, so it is unreachable again (\`get\` null) yet still iterable (value 20).

The \`Map\` contract says behaviour is **unspecified** if a key is mutated in a way that affects \`equals\`. Never mutate keys: use immutable records and remove + re-insert on amend.`,
        timeLimitSec: 540,
        focusFile: 'Main.java',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Make onFill thread-safe',
        prompt: '`PositionBook.onFill` loses fills under load. Review the assistant\'s fix.',
        persona: 'helpful-senior',
        request: 'onFill is called from 16 threads and positions drift. Fix it without a global lock.',
        aiReply: `\`get\` followed by \`put\` is a check-then-act race: two threads can read the same \`cur\` and one update is lost. ConcurrentHashMap has an atomic primitive for exactly this:

\`\`\`java
public void onFill(String sym, long signedQty) {
    positions.merge(sym, signedQty, Long::sum);
}
\`\`\`

\`merge\` performs the read-combine-write for a key atomically (other updates to the same key block briefly; other keys are unaffected), and inserts \`signedQty\` if the key is absent.`,
        options: [
          'Accept: `ConcurrentHashMap.merge` is atomic per key, inserts when absent, and `Long::sum` is a short, side-effect-free remapping function',
          'Reject: `merge` is only atomic in `Collections.synchronizedMap`; CHM\'s default implementation is get-then-put',
          'Reject: when the position nets to zero, `Long::sum` returns 0 and `merge` removes the key, which then breaks `position()`',
          'Reject: autoboxing inside `merge` creates new `Long` objects, so concurrent updates compare stale references and lose writes',
        ],
        correct: 0,
        hints: ['Read the CHM Javadoc for `merge`: "The entire method invocation is performed atomically."'],
        explanation:
          'The suggestion is correct. `ConcurrentHashMap` overrides `merge`, `compute`, `computeIfAbsent` and `computeIfPresent` so the whole invocation is atomic for that key (it locks the bin). The default `Map.merge` is not atomic, but CHM does not use it. `merge` removes the mapping only when the function returns **null**, not 0, so a flat position stays as `0L` and `position()` works. Boxing creates objects, but nothing compares references. The caveat to remember: keep remapping functions short and never touch other keys of the same map from inside them (that can throw `IllegalStateException: Recursive update` or deadlock).',
        timeLimitSec: 360,
        focusFile: 'PositionBook.java',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'CHM compound operations',
        prompt: 'With `ConcurrentHashMap<String, Long> m` shared by many threads, select **all** snippets that are free of lost updates / check-then-act races.',
        options: [
          '`m.putIfAbsent(k, 0L); m.put(k, m.get(k) + q);`',
          '`m.compute(k, (key, v) -> v == null ? q : v + q);`',
          '`if (!m.containsKey(k)) m.put(k, initial);`',
          '`m.computeIfAbsent(k, key -> expensiveLoad(key));` where `expensiveLoad` does not touch `m`',
          '`Long v = m.get(k); while (!m.replace(k, v, v + q)) v = m.get(k);` assuming the key is already present and never removed',
        ],
        correct: [1, 3, 4],
        hints: ['Each individual CHM call is atomic; a sequence of them is not.', '`replace(k, expected, new)` is a CAS on the mapping (compared with `equals`).'],
        explanation:
          '1: `get` then `put` are two operations, so updates in between are lost. 2: `compute` is atomic per key. 3: classic check-then-act; use `putIfAbsent`. 4: `computeIfAbsent` runs the loader at most once per absent key, atomically (the function must not modify the map). 5: a CAS loop. `replace(k, old, new)` succeeds only if the current value `equals(old)`, so a concurrent change makes it fail and retry. With `Long` values compared by `equals` there is no ABA hazard that matters for a sum.',
        timeLimitSec: 420,
        focusFile: 'PositionBook.java',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 14. Class & instance initialisation order
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-java-init-order',
    title: 'Static Fields Run in Textual Order (Even When It Hurts)',
    level: 5,
    rating: 2700,
    lang: 'java',
    domain: 'language-semantics',
    companies: ['goldman', 'jpmorgan', 'de-shaw', 'generic'],
    tags: ['class-initialization', 'constant-variables', 'constructors', 'virtual-dispatch', 'jls-12.4'],
    summary: 'Constant variables, textual static order, virtual calls from constructors, and an initialiser that kills the class forever.',
    context:
      'The venue registry boots during JVM start-up. The counters are wrong, a subclass logs `null` fields, and in production a fee lookup throws `NoClassDefFoundError` for a class that is definitely on the classpath.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'Main.java',
        content: `class Log {
    static void p(String s) {
        System.out.println(s);
    }
}

class Venue {
    static final String MIC = "XNAS";
    static final Integer LOT = 100;
    static Venue DEFAULT = new Venue("default");
    static int created = 0;

    static {
        Log.p("Venue static block, created=" + created);
    }

    private final String name;
    private String currency = "USD";

    Venue(String name) {
        created++;
        this.name = name;
        describe();
    }

    void describe() {
        Log.p("Venue " + name + " ccy=" + currency + " created=" + created);
    }
}

class DarkPool extends Venue {
    static {
        Log.p("DarkPool static block");
    }

    private String owner = "ACME";
    private final int minQty;
    private final int feeBps = 7;

    DarkPool() {
        super("dark");
        minQty = 500;
        describe();
    }

    @Override
    void describe() {
        Log.p("DarkPool owner=" + owner + " minQty=" + minQty + " fee=" + feeBps);
    }
}

public class Main {
    public static void main(String[] args) {
        Log.p("main " + Venue.MIC);
        Log.p("lot " + Venue.LOT);
        Log.p("created " + Venue.created);
        new DarkPool();
        Log.p("created " + Venue.created);
    }
}
`,
      },
      {
        path: 'FeeSchedule.java',
        content: `import java.util.HashMap;
import java.util.Map;

public final class FeeSchedule {
    private static final FeeSchedule INSTANCE = new FeeSchedule();
    private static final Map<String, Integer> BPS = new HashMap<>();
    private static final int DEFAULT_BPS = 5;

    static {
        BPS.put("XNAS", 3);
        BPS.put("ARCA", 4);
    }

    private final int fallbackBps;

    private FeeSchedule() {
        fallbackBps = BPS.getOrDefault("DEFAULT", DEFAULT_BPS);
    }

    public static FeeSchedule get() {
        return INSTANCE;
    }

    public int bps(String venue) {
        return BPS.getOrDefault(venue, fallbackBps);
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Boot sequence',
        prompt: 'Predict the output of `Main.java`.',
        entry: 'Main.java',
        answer:
          'main XNAS\nVenue default ccy=USD created=1\nVenue static block, created=0\nlot 100\ncreated 0\nDarkPool static block\nDarkPool owner=null minQty=0 fee=7\nDarkPool owner=ACME minQty=500 fee=7\ncreated 1',
        hints: [
          '`static final String MIC = "XNAS"` is a *constant variable*: references to it are inlined at compile time and do not trigger class initialisation. `static final Integer` is not a constant variable.',
          'Static initialisers and static field initialisers run in **textual order**. What happens to `created` after `DEFAULT`\'s constructor increments it?',
          'In `new DarkPool()`, Venue\'s constructor calls the *overridden* `describe()` before DarkPool\'s field initialisers have run. But `feeBps` is a constant variable too.',
        ],
        explanation: `1. \`Venue.MIC\` is a constant variable (final, primitive/String type, constant initialiser), so javac inlines "XNAS" and Venue is **not** initialised (JLS 12.4.1 excludes constant variables).
2. \`Venue.LOT\` is a \`static final Integer\`, not a constant (boxed types never are), so reading it triggers initialisation. Static initialisers run in textual order: \`LOT\` = 100, then \`DEFAULT = new Venue("default")\`. The instance initialisers run (\`currency = "USD"\`), the constructor increments \`created\` from its default 0 to 1, and calls \`describe()\` → \`Venue default ccy=USD created=1\`. **Then** the next textual initialiser \`created = 0\` runs and wipes the count. The static block prints \`created=0\`.
3. \`lot 100\`, \`created 0\`.
4. \`new DarkPool()\` initialises DarkPool (superclass already done) → \`DarkPool static block\`. Construction order: \`super("dark")\` → Venue's field initialisers → Venue's ctor body → \`describe()\` dispatches virtually to **DarkPool.describe**, but DarkPool's own field initialisers have not run yet: \`owner\` = null, \`minQty\` = 0. \`feeBps\` prints 7 because \`private final int feeBps = 7\` is a constant variable, and the simple name \`feeBps\` is a constant expression the compiler inlines.
5. After \`super(...)\` returns, DarkPool's initialisers run (\`owner = "ACME"\`), then the ctor body (\`minQty = 500\`) and the second \`describe()\`.
6. \`created\` = 1.`,
        timeLimitSec: 720,
        focusFile: 'Main.java',
      },
      {
        id: 's2',
        kind: 'mcq',
        title: 'What triggers initialisation?',
        prompt: 'Starting from a fresh JVM where neither `Venue` nor `DarkPool` has been initialised, which expressions cause **`Venue`** to be initialised? Select all that apply.',
        options: [
          '`String s = Venue.MIC;`',
          '`Venue[] arr = new Venue[8];`',
          '`Class<?> c = Venue.class;`',
          '`int n = DarkPool.created;` (inherited static field accessed through the subclass name)',
          '`Class.forName("Venue");`',
          '`new DarkPool();`',
        ],
        correct: [3, 4, 5],
        hints: ['JLS 12.4.1: initialisation happens on `new`, static method invocation, static field use (unless a constant variable), certain reflection, or initialisation of a subclass.'],
        explanation:
          'Constant-variable access is inlined (no trigger). Creating an array of a type does not initialise the element type. A class literal loads but does not initialise. Accessing a static field through a subclass name initialises only the class that *declares* the field (`Venue`), not `DarkPool`. `Class.forName(name)` initialises by default. `new DarkPool()` initialises `DarkPool`, which first initialises its superclass `Venue`.',
        timeLimitSec: 360,
        focusFile: 'Main.java',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'NoClassDefFoundError for a class that exists',
        prompt:
          'The first call to `FeeSchedule.get()` throws `ExceptionInInitializerError`, and every later call throws `NoClassDefFoundError: Could not initialize class FeeSchedule`. Click the line that causes it and pick the root cause.',
        file: 'FeeSchedule.java',
        lines: [5],
        options: [
          '`INSTANCE` is initialised textually before `BPS`, so the constructor runs while `BPS` is still null: NPE inside `<clinit>` → ExceptionInInitializerError, and the class is permanently marked erroneous, so later uses throw NoClassDefFoundError',
          '`DEFAULT_BPS` is read before it is assigned, which throws because constant variables are initialised last',
          '`HashMap` is not thread-safe, so concurrent `<clinit>` corrupts it',
          'A private constructor cannot be invoked from a static initialiser',
        ],
        correct: 0,
        hints: ['Static initialisers run top-to-bottom. What is the value of `BPS` while `new FeeSchedule()` runs?'],
        explanation:
          'Line 5 runs the constructor during `<clinit>`, before line 6 assigns `BPS`. `BPS.getOrDefault` throws NPE, wrapped in `ExceptionInInitializerError`. Per JLS 12.4.2 the class object is then marked **erroneous**, and every subsequent initialisation attempt throws `NoClassDefFoundError` (the root cause is only visible in the first stack trace, so the log is often lost by the time someone looks). `DEFAULT_BPS` is a constant variable and is inlined, so it is fine. Fix: move `INSTANCE` below the map and its static block, or use a holder class.',
        timeLimitSec: 360,
        focusFile: 'FeeSchedule.java',
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // 15. Overload resolution, boxing, conditional expression typing, string identity
  // ---------------------------------------------------------------------------
  {
    id: 'l5-a-java-overload-boxing',
    title: 'Three Phases of Overload Resolution',
    level: 5,
    rating: 2600,
    lang: 'java',
    domain: 'language-semantics',
    companies: ['citadel', 'goldman', 'amazon', 'generic'],
    tags: ['overloading', 'boxing', 'varargs', 'conditional-expression', 'string-interning', 'integer-cache'],
    summary: 'Widening beats boxing beats varargs, `?:` unboxes nulls, and only constant expressions are interned.',
    context:
      'A trading utility library has grown overloads for every numeric type. A refactor that changed a `long` to `Long` in one place started routing calls to different methods, and an order-ID comparison passes in QA but fails in production.',
    persona: 'outdated-docs',
    files: [
      {
        path: 'Main.java',
        content: `public class Main {
    static String f(long x) { return "long"; }
    static String f(Integer x) { return "Integer"; }
    static String f(Object x) { return "Object"; }
    static String f(int... x) { return "int..."; }

    static String g(double x) { return "double"; }
    static String g(Long x) { return "Long"; }

    static String h(Object... xs) {
        return xs == null ? "null array" : "len=" + xs.length;
    }

    public static void main(String[] args) {
        int i = 5;
        char c = 'A';
        Integer boxed = 5;
        System.out.println(f(i) + " " + f(boxed) + " " + f(c) + " " + f());
        System.out.println(g(5) + " " + g(5L) + " " + g(Long.valueOf(5)));
        System.out.println(h(null) + " " + h((Object) null) + " " + h(new String[] {"a", "b"}) + " " + h(new int[] {1, 2}));

        Object n = true ? 1 : 2.0;
        Object o = true ? 1 : "s";
        Object q = true ? null : 0;
        System.out.println(n + " " + o + " " + q);
        Integer missing = null;
        try {
            Object r = false ? 1 : missing;
            System.out.println("r=" + r);
        } catch (NullPointerException e) {
            System.out.println("NPE");
        }

        Integer a = 127, b = 127;
        Long big = 5L;
        System.out.println((a == b) + " " + big.equals(5) + " " + (big == 5) + " " + big.equals(5L));

        char d = 'A';
        d += 1;
        System.out.println(c + 1 + " " + d + c + 1);

        final String root = "ES";
        String root2 = "ES";
        String k1 = root + "Z5";
        String k2 = root2 + "Z5";
        System.out.println((k1 == "ESZ5") + " " + (k2 == "ESZ5") + " " + (k2.intern() == "ESZ5") + " " + k2.equals(k1));
    }
}
`,
      },
      {
        path: 'OrderMatcher.java',
        content: `import java.util.List;

record Order(Long id, String sym, long qty) {}

public final class OrderMatcher {
    /** Returns true if the cancel request refers to the given resting order. */
    static boolean sameOrder(Order resting, Order cancel) {
        return resting.id() == cancel.id();
    }

    static Order find(List<Order> book, Order cancel) {
        for (Order o : book) {
            if (sameOrder(o, cancel)) return o;
        }
        return null;
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'predict',
        title: 'Which overload, which value?',
        prompt: 'Predict the output of `Main.java`. (It compiles, with two varargs warnings.)',
        entry: 'Main.java',
        answer:
          'long Integer long int...\ndouble double Long\nnull array len=1 len=2 len=1\n1.0 1 null\nNPE\ntrue false true true\n66 BA1\ntrue false true true',
        hints: [
          'JLS 15.12.2: phase 1 allows only widening (no boxing, no varargs); phase 2 adds boxing/unboxing; phase 3 adds varargs. The first phase that finds any applicable method wins.',
          'For `?:`, if one operand is a primitive numeric type and the other its box (or another numeric type), the result is the *primitive* (binary numeric promotion), so the box is unboxed.',
          '`+` is left-associative: `c + 1 + " "` adds numbers first. Only *constant expressions* are guaranteed to be interned.',
        ],
        explanation: `**Line 1.** \`f(i)\`: in phase 1 only \`f(long)\` is applicable (int→long widening); \`f(Integer)\`/\`f(Object)\` would need boxing, a phase 2 conversion. \`f(boxed)\`: phase 1, both \`f(Integer)\` and \`f(Object)\` apply by subtyping, and \`Integer\` is more specific. \`f(c)\`: char→long widening. \`f()\`: only varargs applies.
**Line 2.** \`g(5)\` and \`g(5L)\`: widening to \`double\` succeeds in phase 1, so boxing to \`Long\` is never considered (an \`int\` can't box to \`Long\` anyway). \`g(Long)\` matches \`Long\` by identity in phase 1.
**Line 3.** \`h(null)\`: phase 1 already applies \`h(Object[])\` with \`null\` as the array, so \`xs == null\` (hence the warning). \`(Object) null\` is not an \`Object[]\`, so phase 3 wraps it: length 1. \`String[]\` is an \`Object[]\` (array covariance): length 2. \`int[]\` is not an \`Object[]\`, so it is wrapped as one element.
**Line 4.** \`true ? 1 : 2.0\` is a numeric conditional, promoted to \`double\`: 1.0. \`1 : "s"\` is a reference conditional, so \`Integer\` 1. \`null : 0\` has type \`Integer\` (lub of null and Integer), so no unboxing and null.
**Line 5.** \`false ? 1 : missing\` has operands \`int\` and \`Integer\`, so the type is \`int\` and \`missing\` is unboxed: NPE.
**Line 6.** \`Integer\` boxing of −128..127 must return cached instances (JLS 5.1.7), so true. \`Long.equals(Integer)\` is false (different classes). \`big == 5\` unboxes and compares numerically, so true.
**Line 7.** \`c + 1\` = 66 (int), then string concat: \`d\` was incremented by compound assignment (implicit narrowing cast) to 'B', then 'A', then "1".
**Line 8.** \`root\` is a final local with a constant initialiser, a *constant variable*, so \`root + "Z5"\` is a constant expression, interned: true. \`root2\` is not final, so runtime concatenation creates a new String (JLS 15.18.1): false. \`intern()\` returns the canonical instance: true.`,
        timeLimitSec: 900,
        focusFile: 'Main.java',
      },
      {
        id: 's2',
        kind: 'review-ai',
        title: 'Comparing order IDs',
        prompt:
          '`OrderMatcher.find` passes every unit test (IDs 1-50) but in production cancels fail to find resting orders. The assistant reviews `sameOrder`. Evaluate its reply.',
        persona: 'outdated-docs',
        request: 'Is sameOrder correct? Cancels are failing in prod.',
        aiReply: `\`sameOrder\` is fine: Java caches boxed \`Long\` values, so \`==\` on two \`Long\`s with the same value returns the same instance. The failures must come from the gateway sending the wrong IDs. If you want to be extra safe, increase the cache with \`-XX:AutoBoxCacheMax=1000000\` so all realistic order IDs are cached.`,
        options: [
          'Accept: boxed values are cached, so `==` is value equality',
          'Reject: `==` on two `Long`s compares references. `Long.valueOf` only (in practice) caches −128..127, so production IDs are distinct objects, and `AutoBoxCacheMax` affects only `Integer`. Use `Objects.equals(a, b)` (or a primitive `long` id)',
          'Reject: `==` throws NullPointerException when IDs differ',
          'Reject: records generate `equals` that compares IDs by reference, so the fix is to override `Order.equals`',
        ],
        correct: 1,
        hints: ['What does `==` mean when *both* operands are reference types?'],
        explanation:
          'Unboxing happens for `==` only when one operand is primitive. With two `Long`s it is reference comparison. JLS 5.1.7 only *requires* caching for boxed `int`/`short`/`char`/`byte`/`boolean` in small ranges; `Long.valueOf` happens to cache −128..127 in OpenJDK, which is why tests with small IDs pass. `-XX:AutoBoxCacheMax` enlarges only `Integer`\'s cache. Use `Objects.equals` or make the component a primitive `long`. Record `equals` uses `Objects.equals` semantics for reference components, so it was never the problem.',
        timeLimitSec: 360,
        focusFile: 'OrderMatcher.java',
      },
      {
        id: 's3',
        kind: 'mcq',
        title: 'Guaranteed by the JLS?',
        prompt: 'Which of the following are **guaranteed** by the Java Language Specification on every conforming JVM? Select all that apply.',
        options: [
          '`Integer a = 127, b = 127; a == b` is true',
          '`Integer a = 128, b = 128; a == b` is false',
          '`"ES" + "Z5" == "ESZ5"` is true',
          '`new String("x") == "x"` is false',
          '`Long a = 100L, b = 100L; a == b` is true',
        ],
        correct: [0, 2, 3],
        hints: ['JLS 5.1.7 lists exactly which boxed values must be identical.'],
        explanation:
          'JLS 5.1.7 requires identical boxes for `int` values in −128..127 (and some other small types), not for `long`, and it explicitly permits caching *more* values, so `128 == 128` may be true (e.g. with a larger `AutoBoxCacheMax`). Constant expressions of type String are interned (JLS 3.10.5), so `"ES" + "Z5"` is the same instance as the literal. `new` always creates a fresh object, distinct from the interned literal. `Long` caching is a library implementation detail.',
        timeLimitSec: 300,
      },
    ],
  },
];

export default problems;
