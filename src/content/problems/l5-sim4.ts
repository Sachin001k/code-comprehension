import type { Problem } from '../types';

const problems: Problem[] = [
  {
    id: "l5-sim-gs-jpm-fx-ledger",
    title: "GL Core: Month-End FX Revaluation",
    level: 5,
    rating: 2650,
    lang: "java",
    domain: "ledger",
    companies: [
      "goldman",
      "jpmorgan",
    ],
    tags: [
      "double-entry",
      "bigdecimal",
      "fx-revaluation",
      "rounding",
      "idempotency",
      "concurrency",
      "interview-simulation",
    ],
    summary: "A Java double-entry ledger with FX pricing, rounding plugs and month-end revaluation. Controllers say LOAN_EUR moved by $10k overnight.",
    context: `**Goldman / JPMorgan-style code comprehension round: 7 stages, one codebase, ~55 minutes, no code execution in the panel.**

You've joined the **GL Core** team that books journal entries for legal entity GSX-LDN-01 (functional currency USD). After the March month-end run, Product Control flagged that the unrealised FX P&L for the entity is **-$10,786.32**, roughly a thousand times what the desk expected, yet the trial balance still nets to zero, so the automated runbook gate passed.

The interviewer will walk you from orientation to root cause to review and design. You can read every file; \`Main.java\` is the month-end dry run from the runbook. Conventions that matter: **amounts are signed, debit-positive**; balances are held in the account currency *and* in USD; rounding is \`HALF_EVEN\`.`,
    persona: "confident-intern",
    files: [
      {
        path: "README.md",
        content: `# gl-core: double-entry general ledger with FX revaluation

Books journal entries for one legal entity whose **functional currency is USD**.
Every account holds a balance in its own currency *and* its USD equivalent.

## Conventions

* **Signed amounts, debit-positive.** A debit is \`+\`, a credit is \`-\`. Asset
  and expense balances are normally positive, liability / equity / income
  balances normally negative. There is no separate "side" column: \`Posting.side()\`
  derives it from the sign.
* Amounts are \`BigDecimal\` at the currency's minor-unit scale (\`JPY\` 0, \`KWD\` 3).
  \`Posting.debit/credit\` refuse to round silently.
* Entries must balance **in USD** (after conversion), not per currency.
  Per-leg rounding residue up to 0.05 USD is plugged to \`ROUNDING\`.
* Rounding is \`HALF_EVEN\` (banker's rounding), once per posting.
* \`post()\` is idempotent on entry id. A rejected entry does not burn its id.

## Flow of \`Ledger.post\`

\`EntryValidator\` (structure) -> \`Pricer\` (FX conversion + rounding plug) ->
balance update -> journal append.

## Month-end revaluation (\`Revaluer\`)

For each **monetary** (asset/liability) account not in USD: restate the
USD balance at the closing rate (last fixing on or before the as-of date),
book \`restated - carried\` to the account (functional-only posting) against
\`FX_UNREALISED\`. Equity and P&L accounts stay at historical rates (IAS 21).
Entry ids are \`REVAL-<date>-<account>\` so a rerun is a no-op.

## Run

    javac -d out $(find src -name '*.java')
    java -cp out ledger.Main            # month-end dry run
    java -cp out ledger.LedgerExamples  # example checks
`,
        language: "markdown",
      },
      {
        path: "config/ledger.yaml",
        content: `# Ledger service configuration (entity: GSX-LDN-01)
entity: GSX-LDN-01
functional_currency: USD
rounding:
  mode: HALF_EVEN            # group accounting policy GAP-7
  plug_account: ROUNDING
  plug_tolerance: "0.05"     # max functional residue per entry, USD
fx:
  source: WMR_4PM_LONDON
  weekend_policy: LAST_AVAILABLE_FIXING
revaluation:
  schedule: "0 30 22 L * ?"  # last calendar day of month, 22:30 London
  pnl_account: FX_UNREALISED
  account_types: [ASSET, LIABILITY]
consumers:
  trade_capture_partitions: 12
`,
        language: "yaml",
      },
      {
        path: "src/main/java/ledger/Account.java",
        content: `package ledger;

import java.util.Objects;

public final class Account {
    private final String id;
    private final AccountType type;
    private final Currency currency;

    public Account(String id, AccountType type, Currency currency) {
        this.id = Objects.requireNonNull(id);
        this.type = Objects.requireNonNull(type);
        this.currency = Objects.requireNonNull(currency);
    }

    public String id() { return id; }
    public AccountType type() { return type; }
    public Currency currency() { return currency; }

    @Override
    public boolean equals(Object o) {
        return o instanceof Account a && a.id.equals(id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }

    @Override
    public String toString() {
        return id;
    }
}
`,
      },
      {
        path: "src/main/java/ledger/AccountType.java",
        content: `package ledger;

public enum AccountType {
    ASSET(true), LIABILITY(true), EQUITY(false), INCOME(false), EXPENSE(false);

    /**
     * Monetary items (cash, receivables, loans) are revalued at the closing
     * rate. Non-monetary items (equity, P&L) stay at their historical rate
     * (IAS 21.23).
     */
    private final boolean monetary;

    AccountType(boolean monetary) {
        this.monetary = monetary;
    }

    public boolean isMonetary() {
        return monetary;
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Balance.java",
        content: `package ledger;

import java.math.BigDecimal;

/** Running balance of one account: transaction-currency and functional (USD). */
public record Balance(BigDecimal amount, BigDecimal functional) {
    public static Balance zero(Currency ccy) {
        return new Balance(BigDecimal.ZERO.setScale(ccy.minorUnits()),
                           BigDecimal.ZERO.setScale(Currency.FUNCTIONAL.minorUnits()));
    }

    public Balance plus(Posting p) {
        return new Balance(amount.add(p.amount()), functional.add(p.functional()));
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Currency.java",
        content: `package ledger;

/** ISO 4217 currencies the ledger books in, with their minor-unit scale. */
public enum Currency {
    USD(2), EUR(2), GBP(2), JPY(0), KWD(3);

    /** The reporting / functional currency of this legal entity. */
    public static final Currency FUNCTIONAL = USD;

    private final int minorUnits;

    Currency(int minorUnits) {
        this.minorUnits = minorUnits;
    }

    public int minorUnits() {
        return minorUnits;
    }
}
`,
      },
      {
        path: "src/main/java/ledger/EntryValidator.java",
        content: `package ledger;

import java.util.Map;

/** Structural checks that do not need FX rates. */
public final class EntryValidator {

    public void validate(JournalEntry e, Map<String, Account> chart) {
        if (e.id() == null || e.id().isBlank()) {
            throw new LedgerException("entry id required");
        }
        if (e.postings().size() < 2) {
            throw new LedgerException("entry " + e.id() + " needs at least two postings");
        }
        for (Posting p : e.postings()) {
            Account known = chart.get(p.account().id());
            if (known == null) {
                throw new LedgerException("unknown account " + p.account().id());
            }
            if (p.amount().scale() != known.currency().minorUnits()) {
                throw new LedgerException("bad scale on " + p.account().id());
            }
            if (p.amount().signum() == 0 && (p.functional() == null || p.functional().signum() == 0)) {
                throw new LedgerException("empty posting on " + p.account().id());
            }
        }
        // NOTE: entries are NOT required to balance per currency. An FX deal
        // (Dr EUR cash / Cr USD cash) never does. They must balance in the
        // functional currency, which Pricer enforces after conversion.
    }
}
`,
      },
      {
        path: "src/main/java/ledger/FxRateProvider.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.time.LocalDate;

public interface FxRateProvider {
    /** Units of {@code to} per one unit of {@code from}, effective on {@code date}. */
    BigDecimal rate(Currency from, Currency to, LocalDate date);
}
`,
      },
      {
        path: "src/main/java/ledger/InMemoryFxRates.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * Closing rates quoted against USD (units of USD per 1 unit of currency).
 * Weekends/holidays have no fixing: the most recent earlier fixing applies.
 */
public final class InMemoryFxRates implements FxRateProvider {
    private final Map<Currency, NavigableMap<LocalDate, BigDecimal>> usdPer = new EnumMap<>(Currency.class);

    public InMemoryFxRates put(Currency ccy, LocalDate date, String usdPerUnit) {
        usdPer.computeIfAbsent(ccy, c -> new TreeMap<>()).put(date, new BigDecimal(usdPerUnit));
        return this;
    }

    @Override
    public BigDecimal rate(Currency from, Currency to, LocalDate date) {
        if (from == to) {
            return BigDecimal.ONE;
        }
        BigDecimal fromUsd = usdPerUnit(from, date);
        BigDecimal toUsd = usdPerUnit(to, date);
        // Cross via USD. DECIMAL64 = 16 significant digits; the result is only
        // ever multiplied into an amount that is then rounded to minor units.
        return fromUsd.divide(toUsd, MathContext.DECIMAL64);
    }

    private BigDecimal usdPerUnit(Currency ccy, LocalDate date) {
        if (ccy == Currency.USD) {
            return BigDecimal.ONE;
        }
        NavigableMap<LocalDate, BigDecimal> series = usdPer.get(ccy);
        Map.Entry<LocalDate, BigDecimal> e = series == null ? null : series.floorEntry(date);
        if (e == null) {
            throw new LedgerException("no " + ccy + " fixing on or before " + date);
        }
        return e.getValue();
    }
}
`,
      },
      {
        path: "src/main/java/ledger/JournalEntry.java",
        content: `package ledger;

import java.time.LocalDate;
import java.util.List;

public record JournalEntry(String id, LocalDate valueDate, String memo, List<Posting> postings) {
    public JournalEntry {
        postings = List.copyOf(postings);
    }

    public static JournalEntry of(String id, LocalDate valueDate, String memo, Posting... postings) {
        return new JournalEntry(id, valueDate, memo, List.of(postings));
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Ledger.java",
        content: `package ledger;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * General ledger for one legal entity.
 *
 * Thread-safety: post() is called concurrently by the trade-capture consumers
 * (one per Kafka partition) and by the month-end revaluation job.
 */
public final class Ledger {
    private final Map<String, Account> chart = new LinkedHashMap<>();
    private final ConcurrentHashMap<String, Balance> balances = new ConcurrentHashMap<>();
    private final Set<String> postedIds = ConcurrentHashMap.newKeySet();
    private final List<JournalEntry> journal = Collections.synchronizedList(new ArrayList<>());
    private final EntryValidator validator = new EntryValidator();
    private final Pricer pricer;

    public Ledger(FxRateProvider rates, Account rounding) {
        this.pricer = new Pricer(rates, rounding);
        open(rounding);
    }

    public Ledger open(Account a) {
        chart.put(a.id(), a);
        return this;
    }

    public Account account(String id) {
        Account a = chart.get(id);
        if (a == null) {
            throw new LedgerException("unknown account " + id);
        }
        return a;
    }

    public Collection<Account> accounts() {
        return Collections.unmodifiableCollection(chart.values());
    }

    public Balance balance(Account a) {
        return balances.getOrDefault(a.id(), Balance.zero(a.currency()));
    }

    public List<JournalEntry> journal() {
        synchronized (journal) {
            return List.copyOf(journal);
        }
    }

    public PostResult post(JournalEntry e) {
        // Idempotency: upstream redelivers on consumer restart.
        if (!postedIds.add(e.id())) {
            return PostResult.DUPLICATE;
        }
        try {
            validator.validate(e, chart);
            List<Posting> priced = pricer.price(e);
            for (Posting p : priced) {
                String id = p.account().id();
                Balance current = balances.getOrDefault(id, Balance.zero(p.account().currency()));
                balances.put(id, current.plus(p));
            }
            journal.add(new JournalEntry(e.id(), e.valueDate(), e.memo(), priced));
            return PostResult.POSTED;
        } catch (LedgerException | ArithmeticException ex) {
            // Rejected entries do not burn the id: ops resubmit the corrected
            // entry under the same id.
            postedIds.remove(e.id());
            throw ex;
        }
    }
}
`,
      },
      {
        path: "src/main/java/ledger/LedgerException.java",
        content: `package ledger;

public class LedgerException extends RuntimeException {
    public LedgerException(String message) {
        super(message);
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Main.java",
        content: `package ledger;

import java.time.LocalDate;

/** Month-end dry run used in the runbook. */
public final class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2024, 3, 28);
        LocalDate monthEnd = LocalDate.of(2024, 3, 31);   // a Sunday

        InMemoryFxRates fx = new InMemoryFxRates()
                .put(Currency.EUR, d, "1.0825")
                .put(Currency.EUR, d.plusDays(1), "1.0790")
                .put(Currency.JPY, d, "0.006612")
                .put(Currency.JPY, d.plusDays(1), "0.006615");

        Account rounding = new Account("ROUNDING", AccountType.EXPENSE, Currency.USD);
        Ledger gl = new Ledger(fx, rounding);
        Account cashUsd = new Account("CASH_USD", AccountType.ASSET, Currency.USD);
        Account cashEur = new Account("CASH_EUR", AccountType.ASSET, Currency.EUR);
        Account cashJpy = new Account("CASH_JPY", AccountType.ASSET, Currency.JPY);
        Account loanEur = new Account("LOAN_EUR", AccountType.LIABILITY, Currency.EUR);
        Account intEur = new Account("INT_EUR", AccountType.INCOME, Currency.EUR);
        Account equity = new Account("EQUITY", AccountType.EQUITY, Currency.USD);
        Account fxPnl = new Account("FX_UNREALISED", AccountType.INCOME, Currency.USD);
        gl.open(cashUsd).open(cashEur).open(cashJpy).open(loanEur).open(intEur).open(equity).open(fxPnl);

        JournalEntry e2 = JournalEntry.of("E2", d, "EUR term loan drawdown",
                Posting.debit(cashEur, "5000"), Posting.credit(loanEur, "5000"));

        submit(gl, JournalEntry.of("E1", d, "capital",
                Posting.debit(cashUsd, "10000"), Posting.credit(equity, "10000")));
        submit(gl, e2);
        submit(gl, JournalEntry.of("E3", d, "buy JPY 151,000 dealt at USD 1,000.00",
                Posting.debit(cashJpy, "151000").priced(new java.math.BigDecimal("1000.00")),
                Posting.credit(cashUsd, "1000")));
        submit(gl, JournalEntry.of("E4", d, "two coupons received",
                Posting.debit(cashEur, "626.02"),
                Posting.credit(intEur, "313.01"), Posting.credit(intEur, "313.01")));
        submit(gl, e2);
        submit(gl, JournalEntry.of("E5", d, "EUR top-up",
                Posting.debit(cashEur, "100"), Posting.credit(cashUsd, "100")));
        submit(gl, JournalEntry.of("E5", d, "EUR top-up (corrected)",
                Posting.debit(cashEur, "100"), Posting.credit(cashUsd, "108.25")));

        Revaluer reval = new Revaluer(fx, "FX_UNREALISED");
        for (JournalEntry r : reval.run(gl, monthEnd)) {
            System.out.println(r.id() + " " + r.postings().get(0).functional().toPlainString());
        }
        // Runbook gate: the trial balance must net to zero after revaluation.
        java.util.List<String> tb = TrialBalance.lines(gl);
        System.out.println(tb.get(tb.size() - 1));
    }

    private static void submit(Ledger gl, JournalEntry e) {
        try {
            System.out.println(e.id() + " " + gl.post(e));
        } catch (LedgerException ex) {
            System.out.println(e.id() + " REJECTED " + ex.getMessage());
        }
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Posting.java",
        content: `package ledger;

import java.math.BigDecimal;

/**
 * One leg of a journal entry.
 *
 * Amounts are SIGNED with the debit-positive convention: a debit is +, a
 * credit is -. {@code amount} is in the account's currency; {@code functional}
 * is the USD equivalent. A posting created with {@code functional == null} is
 * priced by the ledger at the value-date rate. Revaluation postings are
 * "functional-only": amount 0, functional = the adjustment.
 */
public record Posting(Account account, BigDecimal amount, BigDecimal functional) {

    public static Posting debit(Account a, String amount) {
        return new Posting(a, scaled(a, new BigDecimal(amount)), null);
    }

    public static Posting credit(Account a, String amount) {
        return new Posting(a, scaled(a, new BigDecimal(amount)).negate(), null);
    }

    public static Posting functionalOnly(Account a, BigDecimal functional) {
        return new Posting(a, BigDecimal.ZERO.setScale(a.currency().minorUnits()), functional);
    }

    public Posting priced(BigDecimal functional) {
        return new Posting(account, amount, functional);
    }

    public boolean isPriced() {
        return functional != null;
    }

    public Side side() {
        BigDecimal basis = amount.signum() != 0 ? amount : functional;
        return basis.signum() >= 0 ? Side.DEBIT : Side.CREDIT;
    }

    private static BigDecimal scaled(Account a, BigDecimal v) {
        if (v.signum() < 0) {
            throw new IllegalArgumentException("use debit()/credit() with a positive amount");
        }
        // setScale without a rounding mode throws if precision would be lost:
        // 10.005 EUR is a data error, not something to round silently.
        return v.setScale(a.currency().minorUnits());
    }

    public enum Side { DEBIT, CREDIT }
}
`,
      },
      {
        path: "src/main/java/ledger/PostResult.java",
        content: `package ledger;

public enum PostResult { POSTED, DUPLICATE }
`,
      },
      {
        path: "src/main/java/ledger/Pricer.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * Converts each posting to functional currency at the value-date rate and
 * enforces the functional balance. Rounding each leg independently can leave
 * a residue of a cent or two; residues within tolerance are plugged to the
 * ROUNDING account so the entry balances exactly.
 */
public final class Pricer {
    private final FxRateProvider rates;
    private final Account rounding;

    public Pricer(FxRateProvider rates, Account rounding) {
        this.rates = rates;
        this.rounding = rounding;
    }

    public List<Posting> price(JournalEntry e) {
        List<Posting> out = new ArrayList<>(e.postings().size() + 1);
        BigDecimal residue = BigDecimal.ZERO;
        for (Posting p : e.postings()) {
            Posting priced = p;
            if (!p.isPriced()) {
                BigDecimal rate = rates.rate(p.account().currency(), Currency.FUNCTIONAL, e.valueDate());
                priced = p.priced(RoundingPolicy.toMinor(p.amount().multiply(rate), Currency.FUNCTIONAL));
            }
            residue = residue.add(priced.functional());
            out.add(priced);
        }
        if (residue.signum() != 0) {
            if (residue.abs().compareTo(RoundingPolicy.PLUG_TOLERANCE) > 0) {
                throw new LedgerException("functional imbalance " + residue.toPlainString() + " in " + e.id());
            }
            out.add(Posting.functionalOnly(rounding, residue.negate()));
        }
        return out;
    }
}
`,
      },
      {
        path: "src/main/java/ledger/Revaluer.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Month-end unrealised FX revaluation.
 *
 * For every monetary account held in a foreign currency, restate its
 * functional balance at the closing rate and book the difference against
 * FX_UNREALISED. The adjustment is functional-only: the account's
 * transaction-currency balance does not change.
 */
public final class Revaluer {
    private final FxRateProvider rates;
    private final String fxPnlAccountId;

    public Revaluer(FxRateProvider rates, String fxPnlAccountId) {
        this.rates = rates;
        this.fxPnlAccountId = fxPnlAccountId;
    }

    public List<JournalEntry> run(Ledger ledger, LocalDate asOf) {
        Account fxPnl = ledger.account(fxPnlAccountId);
        List<JournalEntry> booked = new ArrayList<>();
        for (Account a : ledger.accounts()) {
            if (a.currency() == Currency.FUNCTIONAL || !a.type().isMonetary()) {
                continue;
            }
            Balance bal = ledger.balance(a);
            BigDecimal rate = rates.rate(a.currency(), Currency.FUNCTIONAL, asOf);
            BigDecimal restated = RoundingPolicy.toMinor(bal.amount().abs().multiply(rate), Currency.FUNCTIONAL);
            BigDecimal delta = restated.subtract(bal.functional());
            if (delta.signum() == 0) {
                continue;
            }
            JournalEntry e = JournalEntry.of(
                    "REVAL-" + asOf + "-" + a.id(), asOf, "unrealised FX " + a.currency(),
                    Posting.functionalOnly(a, delta),
                    Posting.functionalOnly(fxPnl, delta.negate()));
            if (ledger.post(e) == PostResult.POSTED) {
                booked.add(e);
            }
        }
        return booked;
    }
}
`,
      },
      {
        path: "src/main/java/ledger/RoundingPolicy.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Group accounting policy: banker's rounding, applied once per posting. */
public final class RoundingPolicy {
    public static final RoundingMode MODE = RoundingMode.HALF_EVEN;
    /** Max absolute functional residue per entry that may be plugged to ROUNDING. */
    public static final BigDecimal PLUG_TOLERANCE = new BigDecimal("0.05");

    private RoundingPolicy() {}

    public static BigDecimal toMinor(BigDecimal v, Currency ccy) {
        return v.setScale(ccy.minorUnits(), MODE);
    }
}
`,
      },
      {
        path: "src/main/java/ledger/TrialBalance.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class TrialBalance {
    private TrialBalance() {}

    public static List<String> lines(Ledger ledger) {
        List<Account> sorted = new ArrayList<>(ledger.accounts());
        sorted.sort(Comparator.comparing(Account::id));
        List<String> out = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        for (Account a : sorted) {
            Balance b = ledger.balance(a);
            if (b.amount().signum() == 0 && b.functional().signum() == 0) {
                continue;
            }
            total = total.add(b.functional());
            out.add(a.id() + " " + a.currency() + " " + b.amount().toPlainString() + " " + b.functional().toPlainString());
        }
        out.add("TOTAL USD " + total.toPlainString());
        return out;
    }
}
`,
      },
      {
        path: "src/test/java/ledger/LedgerExamples.java",
        content: `package ledger;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Example checks (the build runs these via \`make examples\`; the full JUnit
 * suite lives in the ledger-it repo). Plain main() so it runs anywhere.
 */
public final class LedgerExamples {
    private static final LocalDate D = LocalDate.of(2024, 1, 31);

    public static void main(String[] args) {
        rejectsUnbalancedEntry();
        plugsRoundingResidue();
        duplicateIdIsIgnored();
        revaluesForeignCashGain();
        System.out.println("examples OK");
    }

    private static Ledger fresh(InMemoryFxRates fx) {
        Ledger gl = new Ledger(fx, new Account("ROUNDING", AccountType.EXPENSE, Currency.USD));
        gl.open(new Account("CASH_USD", AccountType.ASSET, Currency.USD))
          .open(new Account("CASH_EUR", AccountType.ASSET, Currency.EUR))
          .open(new Account("EQUITY", AccountType.EQUITY, Currency.USD))
          .open(new Account("FX_UNREALISED", AccountType.INCOME, Currency.USD));
        return gl;
    }

    static void rejectsUnbalancedEntry() {
        Ledger gl = fresh(new InMemoryFxRates().put(Currency.EUR, D, "1.10"));
        try {
            gl.post(JournalEntry.of("X", D, "bad",
                    Posting.debit(gl.account("CASH_EUR"), "100"),
                    Posting.credit(gl.account("CASH_USD"), "100")));
            throw new AssertionError("expected rejection");
        } catch (LedgerException expected) {
            check(expected.getMessage().contains("imbalance"), "message");
        }
    }

    static void plugsRoundingResidue() {
        Ledger gl = fresh(new InMemoryFxRates().put(Currency.EUR, D, "1.0825"));
        gl.open(new Account("INT_EUR", AccountType.INCOME, Currency.EUR));
        gl.post(JournalEntry.of("C", D, "coupons",
                Posting.debit(gl.account("CASH_EUR"), "626.02"),
                Posting.credit(gl.account("INT_EUR"), "313.01"),
                Posting.credit(gl.account("INT_EUR"), "313.01")));
        check(gl.balance(gl.account("ROUNDING")).functional().compareTo(new BigDecimal("-0.01")) == 0, "plug");
    }

    static void duplicateIdIsIgnored() {
        Ledger gl = fresh(new InMemoryFxRates());
        JournalEntry e = JournalEntry.of("K", D, "capital",
                Posting.debit(gl.account("CASH_USD"), "50"), Posting.credit(gl.account("EQUITY"), "50"));
        check(gl.post(e) == PostResult.POSTED, "first");
        check(gl.post(e) == PostResult.DUPLICATE, "second");
        check(gl.balance(gl.account("CASH_USD")).amount().compareTo(new BigDecimal("50")) == 0, "once");
    }

    static void revaluesForeignCashGain() {
        InMemoryFxRates fx = new InMemoryFxRates()
                .put(Currency.EUR, D, "1.10")
                .put(Currency.EUR, D.plusDays(1), "1.20");
        Ledger gl = fresh(fx);
        gl.post(JournalEntry.of("F", D, "buy EUR",
                Posting.debit(gl.account("CASH_EUR"), "100"), Posting.credit(gl.account("CASH_USD"), "110")));
        List<JournalEntry> r = new Revaluer(fx, "FX_UNREALISED").run(gl, D.plusDays(1));
        check(r.size() == 1, "one reval entry");
        check(gl.balance(gl.account("CASH_EUR")).functional().compareTo(new BigDecimal("120.00")) == 0, "restated");
        check(gl.balance(gl.account("FX_UNREALISED")).functional().compareTo(new BigDecimal("-10.00")) == 0, "gain");
    }

    private static void check(boolean ok, String what) {
        if (!ok) {
            throw new AssertionError(what);
        }
    }
}
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: what does this ledger promise?",
        prompt: "Skim `README.md`, `Posting.java`, `EntryValidator.java`, `Ledger.java` and `InMemoryFxRates.java`. Which statements about the **current code** are true? Select all that apply.",
        options: [
          "An FX deal booked as Dr CASH_EUR 100 / Cr CASH_USD 108.25 is accepted even though the EUR and USD amounts differ.",
          "`Posting.debit(cashJpy, \"100.5\")` is rounded to 100 (HALF_EVEN) because JPY has zero minor units.",
          "An EUR-denominated INCOME account (e.g. INT_EUR) is left at historical rates by the month-end revaluation.",
          "If there is no fixing on the month-end date (e.g. a Sunday), `rate()` throws and revaluation aborts.",
          "An entry rejected by the Pricer can be resubmitted later under the same entry id.",
          "Balances store only the account-currency amount; USD equivalents are recomputed from today's rate when read.",
        ],
        correct: [0, 2, 4],
        hints: [
          "Check where per-currency balancing is (not) enforced, and read the comment at the end of `EntryValidator.validate`.",
          "`BigDecimal.setScale(n)` with **no rounding mode** throws `ArithmeticException` if digits would be lost. `floorEntry` returns the closest key at or before the date.",
        ],
        explanation: `**True:**
- **(A)** Entries balance in the *functional* currency after conversion, not per currency. 100 EUR at 1.0825 is 108.25 USD, so the legs cancel in USD. \`EntryValidator\` says so explicitly.
- **(C)** \`Revaluer\` skips accounts whose \`AccountType.isMonetary()\` is false. EQUITY, INCOME and EXPENSE stay at historical rates (IAS 21). Only ASSET and LIABILITY accounts are restated.
- **(E)** \`Ledger.post\` removes the id from \`postedIds\` when validation or pricing throws, so a rejected entry does not use up its id. \`Main\` relies on this for E5.

**False:**
- **(B)** \`Posting.scaled\` calls \`setScale(minorUnits)\` with no rounding mode, so \`100.5\` JPY throws \`ArithmeticException\` *before* the ledger sees it. The code refuses to round silently.
- **(D)** \`usdPerUnit\` uses \`floorEntry(date)\`, so a Sunday month-end picks up Friday's fixing. This is the configured \`LAST_AVAILABLE_FIXING\` policy.
- **(F)** \`Balance\` holds two numbers, \`amount\` and \`functional\`. The USD side is the historical sum of priced postings, and only revaluation moves it to closing rates. That is why revaluation is needed at all.`,
        timeLimitSec: 360,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace E4 through Ledger.post",
        prompt: "In `Main.java`, entry **E4** (\"two coupons received\": Dr CASH_EUR 626.02, Cr INT_EUR 313.01 twice, EUR at 1.0825) is accepted. Put the steps of `Ledger.post(E4)` in execution order.",
        items: [
          "`postedIds.add(\"E4\")` returns true, so the entry is not a duplicate",
          "`EntryValidator.validate` checks there are at least two legs, every account is known, and amounts are at minor-unit scale",
          "`Pricer.price` asks `rates.rate(EUR, USD, 2024-03-28)` for each unpriced leg",
          "`RoundingPolicy.toMinor` rounds each leg's USD value HALF_EVEN (677.67, -338.83, -338.83)",
          "The summed residue (+0.01) is compared against `PLUG_TOLERANCE` (0.05)",
          "A functional-only posting of -0.01 to ROUNDING is appended to the priced legs",
          "Each priced posting is added to its account's `Balance` in `balances`",
          "The priced entry (now 4 legs) is appended to `journal` and `POSTED` is returned",
        ],
        hints: [
          "Idempotency is checked first, before any validation.",
          "The ROUNDING leg is created by the Pricer, so it exists before any balance changes.",
        ],
        explanation: `\`post\` claims the id first (\`postedIds.add\`), then runs structural validation, then pricing. The Pricer converts each leg at the value-date rate: 626.02 × 1.0825 = 677.66665, which rounds to **677.67**. Each 313.01 × 1.0825 = 338.833325, which rounds to **338.83**, so the credits total 677.66. Rounding each leg separately leaves a **+0.01** residue. That is within the 0.05 tolerance, so the Pricer appends a **-0.01** functional-only leg to ROUNDING. Only after pricing succeeds are balances mutated and the entry journaled.

Ordering matters for failure handling. Everything that can throw (validator, rate lookup, tolerance check) runs *before* any balance changes, so the \`catch\` block only has to release the id. Nothing needs rolling back.`,
        timeLimitSec: 360,
        focusFile: "src/main/java/ledger/Ledger.java",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Predict the month-end dry run",
        prompt: `The interviewer asks you to "run" the runbook dry-run **in your head**. What does \`Main.java\` print?

Rates (USD per unit): EUR 1.0825 on 28 Mar, 1.0790 on 29 Mar. JPY 0.006612 on 28 Mar, 0.006615 on 29 Mar. Month-end is Sunday 31 Mar.`,
        entry: "src/main/java/ledger/Main.java",
        answer: `E1 POSTED
E2 POSTED
E3 POSTED
E4 POSTED
E2 DUPLICATE
E5 REJECTED functional imbalance 8.25 in E5
E5 POSTED
REVAL-2024-03-31-CASH_EUR -20.04
REVAL-2024-03-31-CASH_JPY -1.14
REVAL-2024-03-31-LOAN_EUR 10807.50
TOTAL USD 0.00`,
        options: [
          `E1 POSTED
E2 POSTED
E3 POSTED
E4 POSTED
E2 DUPLICATE
E5 REJECTED functional imbalance 8.25 in E5
E5 POSTED
REVAL-2024-03-31-CASH_EUR -20.04
REVAL-2024-03-31-CASH_JPY -1.14
REVAL-2024-03-31-LOAN_EUR 17.50
TOTAL USD 0.00`,
          `E1 POSTED
E2 POSTED
E3 POSTED
E4 POSTED
E2 DUPLICATE
E5 REJECTED functional imbalance 8.25 in E5
E5 POSTED
REVAL-2024-03-31-CASH_EUR -20.04
REVAL-2024-03-31-CASH_JPY -1.14
REVAL-2024-03-31-LOAN_EUR 10807.50
TOTAL USD 0.00`,
          `E1 POSTED
E2 POSTED
E3 POSTED
E4 POSTED
E2 DUPLICATE
E5 REJECTED functional imbalance 8.25 in E5
E5 POSTED
REVAL-2024-03-31-CASH_EUR -20.04
REVAL-2024-03-31-CASH_JPY -1.13
REVAL-2024-03-31-LOAN_EUR 10807.50
TOTAL USD 0.00`,
          `E1 POSTED
E2 POSTED
E3 POSTED
E4 POSTED
E2 DUPLICATE
E5 REJECTED functional imbalance 8.25 in E5
E5 DUPLICATE
REVAL-2024-03-31-CASH_EUR -19.69
REVAL-2024-03-31-CASH_JPY -1.14
REVAL-2024-03-31-LOAN_EUR 10807.50
TOTAL USD 0.00`,
        ],
        hints: [
          "E5 is submitted twice. The first copy is unbalanced in USD by 8.25, so does its id get burned?",
          "Revaluation uses the *closing* rate (floorEntry on Sunday 31 Mar gives the 29 Mar fixing). CASH_JPY: 151000 × 0.006615 = 998.865 exactly. What does HALF_EVEN do with that?",
          "LOAN_EUR carries a balance of -5000.00 EUR / -5412.50 USD. Look closely at how `Revaluer` computes `restated`.",
        ],
        explanation: `Walk it:
- E1 to E4 post. The second E2 is an exact redelivery and returns **DUPLICATE**.
- E5 v1: Dr 100 EUR = 108.25 USD vs Cr 100 USD. The residue of 8.25 is above the 0.05 tolerance, so it is **REJECTED** and \`post\` releases the id. E5 v2 balances and **POSTS**.
- **Revaluation at 29 Mar rates** (Sunday falls back to Friday's fixing):
  - CASH_EUR: 5000 + 626.02 + 100 = 5726.02 EUR, carried at 5412.50 + 677.67 + 108.25 = 6198.42 USD. Restated 5726.02 × 1.0790 = 6178.37558, which rounds to 6178.38, so Δ = **-20.04**.
  - CASH_JPY: carried at the dealt 1000.00. 151000 × 0.006615 = **998.865** exactly. HALF_EVEN keeps the even digit, giving 998.86, so Δ = **-1.14**. HALF_UP would give -1.13.
  - LOAN_EUR: balance **-5000.00** EUR, carried at -5412.50 USD. \`bal.amount().abs()\` restates it as **+5395.00**, so Δ = 5395.00 - (-5412.50) = **10807.50**. With the sign kept, it would be -5395.00 - (-5412.50) = **17.50**.
- **TOTAL USD 0.00.** Every reval entry is itself balanced (the account leg vs the FX_UNREALISED leg), so the trial balance still nets to zero. The runbook gate cannot catch a wrong revaluation amount. It only checks double-entry integrity.

That last point is the lesson. A trial balance proves *balance*, not *correctness*. The bug moved $10.8k from the loan into P&L symmetrically.`,
        timeLimitSec: 720,
        focusFile: "src/main/java/ledger/Main.java",
      },
      {
        id: "s4",
        kind: "find-bug",
        title: "Root-cause the $10k swing",
        prompt: "Click the line responsible for the LOAN_EUR revaluation of +10,807.50, then choose the root cause.",
        file: "src/main/java/ledger/Revaluer.java",
        lines: [34],
        options: [
          "`abs()` throws away the sign of the account-currency balance, so a credit-balance (liability) account is restated as if it were an asset.",
          "The closing rate should come from each original posting's value date, not the as-of date.",
          "Revaluation must also restate EQUITY and INCOME accounts, otherwise the entry cannot balance.",
          "`toMinor` uses HALF_EVEN, but revaluation must use HALF_UP to agree with the desk's numbers.",
        ],
        correct: 0,
        hints: [
          "Compare the sign of `restated` with the sign of `bal.functional()` for a liability.",
          "Under the debit-positive convention a liability balance is negative. What does `abs()` do to it?",
        ],
        explanation: `Line 34 computes \`restated = toMinor(|amount| × rate)\`. For an asset with a debit balance that is harmless. For a liability the balance is **negative**, so \`restated\` comes out positive and \`delta = restated - functional\` adds *twice* the carried USD value: 5395.00 + 5412.50 = 10807.50.

The fix is to keep the sign: \`toMinor(bal.amount().multiply(rate), FUNCTIONAL)\`. The signed-amount convention exists precisely so that one formula works for every account type and every balance direction.

The other options are plausible-sounding distractors:
- Revaluation always uses the **closing** rate. That is the whole point.
- Non-monetary items are deliberately excluded (IAS 21.23).
- The rounding mode here only changes the result by at most a cent.`,
        timeLimitSec: 300,
        focusFile: "src/main/java/ledger/Revaluer.java",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Review the assistant's revaluation fix",
        prompt: "You asked the assistant for a fix. Would you merge it?",
        persona: "confident-intern",
        request: "Revaluer gives LOAN_EUR a +10,807.50 delta. Fix it with a minimal change.",
        aiReply: `Found it! Liabilities carry **credit** balances, so after taking the magnitude we need to put the sign back for them. Assets are unaffected, so this is a minimal, targeted change:

\`\`\`java
            Balance bal = ledger.balance(a);
            BigDecimal rate = rates.rate(a.currency(), Currency.FUNCTIONAL, asOf);
            BigDecimal restated = RoundingPolicy.toMinor(bal.amount().abs().multiply(rate), Currency.FUNCTIONAL);
            if (a.type() == AccountType.LIABILITY) {
                restated = restated.negate();   // liabilities are credit-normal
            }
            BigDecimal delta = restated.subtract(bal.functional());
\`\`\`

With this, LOAN_EUR restates to -5395.00 and the delta is +17.50 (a gain, since EUR weakened). ✅ Verified against the dry run.`,
        options: [
          "Accept: it reproduces the expected +17.50 on the dry run and leaves assets untouched.",
          "Reject: the sign comes from the account *type* instead of the *balance*. An overdrawn nostro (ASSET with a credit balance) or a LIABILITY in debit is still restated with the wrong sign. Drop `abs()` and use the signed amount.",
          "Reject: `BigDecimal.negate()` loses the scale, so `delta.signum()` will misfire for zero deltas.",
          "Reject: the delta for a liability must be `bal.functional() - restated`, otherwise the gain is booked as a loss.",
        ],
        correct: 1,
        hints: [
          "Is a liability *always* in credit? Is cash *always* in debit?",
          "What problem was `abs()` solving in the first place?",
        ],
        explanation: `The patch fixes the one case in the dry run and keeps the real defect. The ledger's convention is **signed, debit-positive** amounts, and the sign of the balance already says which way the account is. Replacing that with "liabilities are negative" breaks whenever a balance is on its *abnormal* side:
- An overdrawn EUR nostro (ASSET, balance -200 EUR) would be restated as **+** and get a huge swing again.
- A LIABILITY in debit (e.g. an over-repaid loan) would be flipped negative.

Abnormal balances are routine on a trading desk (nostros go overdrawn intraday all the time), so this would recur.

The minimal *correct* change is deletion: \`toMinor(bal.amount().multiply(rate), FUNCTIONAL)\`.
- \`negate()\` preserves scale, so option C is false.
- Option D would flip the sign of every adjustment. \`delta = restated - carried\` is booked to the account, and the opposite amount goes to FX_UNREALISED, which is already right.

Review lesson: "verified against the dry run" only proves the one path the dry run exercises.`,
        timeLimitSec: 420,
      },
      {
        id: "s6",
        kind: "review-ai",
        title: "Lost updates under 12 consumers",
        prompt: "Separately, a production incident showed CASH_USD occasionally drifting from the journal by exactly one posting. You asked the assistant to make the balance update safe. Would you merge this patch?",
        persona: "helpful-senior",
        request: "Ledger.post is called by 12 trade-capture consumers concurrently. CASH_USD sometimes drifts from the sum of the journal. Make the balance update safe without serialising the whole ledger.",
        aiReply: `The drift is a classic lost update: \`getOrDefault\` then \`put\` is a read-modify-write across two separate map operations. Two consumers posting to CASH_USD can both read the same \`current\`, and one \`put\` overwrites the other.

\`ConcurrentHashMap.compute\` runs the remapping function atomically for that key, so the update can't be lost, and other keys aren't blocked:

\`\`\`java
            for (Posting p : priced) {
                balances.compute(p.account().id(), (id, cur) ->
                        (cur == null ? Balance.zero(p.account().currency()) : cur).plus(p));
            }
\`\`\`

\`Balance\` is an immutable record, so returning a new instance from the lambda is safe. Caveat: this gives per-account atomicity, not per-entry atomicity. A concurrent reader can briefly see one leg of an entry before the other, so anything that needs a consistent cross-account view (trial balance, revaluation) should run on a quiesced or snapshotted ledger.`,
        options: [
          "Accept: `compute` makes each per-account read-modify-write atomic, `Balance` is immutable, and the caveat about cross-account consistency is accurate.",
          "Reject: `ConcurrentHashMap.compute` may invoke the remapping function more than once under contention, so a posting can be applied twice.",
          "Reject: `compute` holds a lock on the whole map while the lambda runs, which serialises every consumer.",
          "Reject: the only correct fix is to make `post` `synchronized`. Anything finer-grained can still lose updates.",
        ],
        correct: 0,
        hints: [
          "Read the `ConcurrentHashMap.compute` Javadoc contract: how many times is the function applied, and what is locked?",
          "Is there shared mutable state inside the lambda?",
        ],
        explanation: `This one is correct. \`ConcurrentHashMap.compute\` is documented to perform the entire method invocation **atomically**, applying the function **at most once** per call. It locks only the bin for that key, so consumers posting to different accounts proceed in parallel.
- Option B describes the default method on the \`ConcurrentMap\` *interface* (and \`ConcurrentSkipListMap\`), which may retry. CHM overrides it.
- Option C is false: CHM uses bin-level locking.
- Option D's \`synchronized\` would also work, but it is over-serialised and not "the only correct fix".

The caveat is the senior part of the answer. Per-key atomicity does not give per-*entry* atomicity, and the Revaluer runs concurrently. The design stage builds on this.`,
        timeLimitSec: 420,
        focusFile: "src/main/java/ledger/Ledger.java",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Design follow-up: month-end under load",
        prompt: "Volumes double and the entity starts booking heavily in JPY and KWD. The 12 consumers keep running while the 22:30 revaluation job executes (as `Ledger`'s Javadoc says). Assume the `abs()` bug and the lost-update bug are fixed. Which of these are **real** risks in the current design? Select all that apply.",
        options: [
          "A consumer redelivers entry X while the first copy of X is still being priced. The redelivery returns DUPLICATE. If the first copy then fails pricing, its id is released, but neither copy is booked and the consumer has already committed the redelivery's offset.",
          "An entry dated on or before the as-of date can be applied after the Revaluer has read that account's balance. It stays at the historical rate, and rerunning the job does not fix it because `REVAL-<date>-<account>` is already posted, so `post` returns DUPLICATE.",
          "KWD has 3 minor units, so `Posting.debit(kwdAccount, \"1.5\")` throws `ArithmeticException`.",
          "Large JPY tickets will breach the 0.05 plug tolerance because the `DECIMAL64` division in `rate()` truncates the JPY rate.",
          "Adding a monitor that alerts when `TrialBalance` TOTAL ≠ 0.00 after each reval run would have caught the LOAN_EUR bug.",
        ],
        correct: [0, 1],
        hints: [
          "Follow `postedIds` for two copies of the same id that overlap in time, where the first one fails.",
          "What id does a revaluation entry get, and what does `post` do with an id it has already seen?",
          "For JPY→USD, what is `toUsd` in `rate()`? And does the rounding residue grow with notional?",
        ],
        explanation: `**(A) Real.** \`postedIds.add\` is claimed *before* validation and pricing. A concurrent redelivery sees the id taken and returns DUPLICATE. If the original then fails, the \`catch\` releases the id, but by then the redelivery has already been acked. The entry is lost unless someone replays it. Fixes:
- Make the dedup state *tri-state* (in-flight / posted / failed) and have duplicates of an in-flight id wait or retry.
- Or only claim the id after a successful pricing, with a per-id lock.

**(B) Real.** This is a cutoff race. Per-account atomicity does not stop an entry dated 31 Mar from landing just after the Revaluer has read CASH_EUR. Because revaluation ids are deterministic (deliberately, so a crashed job can be rerun), the rerun returns DUPLICATE and never restates the late entry. Production ledgers handle this with:
- a period **close** (stop accepting back-dated entries, then revalue);
- or revaluing on a consistent snapshot / sequence number;
- or making the reval id a function of the input snapshot.

**(C) False.** \`new BigDecimal("1.5").setScale(3)\` is \`1.500\`. *Increasing* scale never loses digits, so it never throws.

**(D) False.**
- For X→USD, \`rate()\` divides by \`BigDecimal.ONE\`, so the rate is exact.
- Rounding residue is bounded by half a cent **per leg**, regardless of notional.

The tolerance can only be breached by entries with many legs, or by genuinely unbalanced input.

**(E) False.** Stage 3 showed the trial balance at 0.00 *with* the bug. Each reval entry is internally balanced. A useful monitor is a **reasonableness check**: alert when |Δ| for an account exceeds, say, |balance × rate move| + tolerance, or when FX_UNREALISED moves more than N bp of foreign-currency exposure.`,
        timeLimitSec: 540,
        focusFile: "src/main/java/ledger/Ledger.java",
      },
    ],
  },
  {
    id: "l5-sim-js-matching-engine",
    title: "Crossing Venue: Matching Engine Certification",
    level: 5,
    rating: 2850,
    lang: "python",
    domain: "orderbook",
    companies: [
      "jane-street",
    ],
    tags: [
      "price-time-priority",
      "order-book",
      "self-trade-prevention",
      "lazy-deletion",
      "ioc",
      "concurrency",
      "interview-simulation",
    ],
    summary: "A price-time priority matching engine with lazy cancels and STP fails exchange certification. Fix it, then ship IOC orders.",
    context: `**Jane Street-style code comprehension round: 7 stages, one codebase, ~70 minutes.**

You're pairing with the venue team on \`xyz-match\`, the single-symbol matching engine behind the internal crossing venue. The exchange-certification suite is red. Overnight, \`tools/replay.py\` crashed on the sample session with \`AttributeError: 'NoneType' object has no attribute 'account'\`, and a client says a sell order got a worse price than the bid it hit.

The interviewer expects you to orient quickly, reason precisely about the order book's lazy data structures, fix the engine, then extend it with **IOC (immediate-or-cancel)** orders, ticket XM-212. Prices are integer ticks. The engine is single-threaded by contract.`,
    persona: "confident-intern",
    files: [
      {
        path: "README.md",
        content: `# xyz-match: single-symbol matching engine

Continuous limit order book with **price-time priority**, used by the internal
crossing venue. One \`MatchingEngine\` instance per symbol; the gateway
serialises every request for that symbol onto a single queue, so the engine is
deliberately single-threaded and lock-free.

## Layout

| Path | What |
|------|------|
| \`engine/types.py\` | \`Order\`, \`Trade\`, enums. Prices are **integer ticks**, never floats. |
| \`engine/matcher.py\` | \`MatchingEngine.submit / cancel / end_of_day\`, the matching loop. |
| \`engine/order_book.py\` | Two \`BookSide\`s plus an index of resting orders. |
| \`engine/book_side.py\` | \`price -> PriceLevel\` dict + heap of prices (bids negated). |
| \`engine/price_level.py\` | FIFO queue per price with lazy cancel purging. |
| \`engine/stp.py\` | Self-trade prevention policies. |
| \`engine/validation.py\` | Static order checks (lot size, collar...). |
| \`engine/risk.py\` | Post-trade positions for drop-copy. |
| \`engine/events.py\` | Event log (\`Accepted\`, \`Rested\`, \`Cancelled\`, \`Decremented\`, \`Trade\`). |
| \`tools/replay.py\` | Deterministic replay of an order CSV. |
| \`tools/demo.py\` | Scripted session from the onboarding doc. |

## Matching rules

1. An incoming order matches against the best opposite level while it crosses.
2. Within a level, the oldest order (lowest \`seq\`) trades first.
3. **Trades print at the resting order's price** (the resting order set the
   price; the aggressor gets any price improvement).
4. Partially filled resting orders keep their place in the queue.
5. Reducing a resting order's size keeps priority; anything else is a
   cancel/replace and goes to the back.
6. Self-trade prevention runs *before* a trade is created, per the account's
   configured \`StpMode\`.
7. MARKET orders never rest; any unfilled remainder is cancelled with
   reason \`NO_LIQUIDITY\`.

## Time in force

\`GTC\` (default) and \`DAY\` (cancelled by \`end_of_day()\`).
\`IOC\` is on the roadmap (ticket XM-212).

## Running

    python3 tools/demo.py
    python3 tools/replay.py data/sample_orders.csv
    python3 -m pytest tests/
`,
        language: "markdown",
      },
      {
        path: "config/engine.toml",
        content: `# Engine configuration for symbol XYZ (prices are integer ticks of $0.01)
symbol = "XYZ"
lot_size = 50
max_order_qty = 100000
collar_pct = 10
reference_price = 10050
stp_mode = "CANCEL_RESTING"
`,
        language: "text",
      },
      {
        path: "engine/__init__.py",
        content: `"""Single-symbol limit order book and matching engine.

Public entry point is MatchingEngine (engine.matcher). Everything else is an
implementation detail that the gateway and the market-data publisher reach
into only through the engine's read APIs (best_bid, best_ask, depth).
"""
from engine.types import Side, OrderType, TimeInForce, Order, Trade
from engine.matcher import MatchingEngine
from engine.stp import StpMode

__all__ = [
    "Side", "OrderType", "TimeInForce", "Order", "Trade",
    "MatchingEngine", "StpMode",
]
`,
      },
      {
        path: "engine/matcher.py",
        content: `from __future__ import annotations

from typing import List, Optional, Set

from engine import stp
from engine.clock import SequenceClock
from engine.config import EngineConfig
from engine.events import Accepted, Cancelled, Decremented, EventLog, Rejected, Rested
from engine.order_book import OrderBook
from engine.risk import PositionTracker
from engine.types import Order, OrderType, Side, Status, TimeInForce, Trade
from engine.validation import validate


class MatchingEngine:
    """Price-time priority matching for a single symbol.

    Single-threaded by design: the gateway serialises all requests for a
    symbol onto one queue, so nothing here takes a lock.
    """

    def __init__(self, config: Optional[EngineConfig] = None,
                 clock: Optional[SequenceClock] = None,
                 events: Optional[EventLog] = None) -> None:
        self.config = config or EngineConfig()
        self.book = OrderBook(self.config.symbol)
        self.clock = clock or SequenceClock()
        self.events = events or EventLog()
        self.positions = PositionTracker()
        self._seen_ids: Set[str] = set()

    # ------------------------------------------------------------------ API

    def submit(self, order: Order) -> List[Trade]:
        reason = validate(order, self.config)
        if reason is None and order.order_id in self._seen_ids:
            reason = "DUPLICATE_ID"
        if reason is not None:
            order.status = Status.REJECTED
            self.events.emit(Rejected(order.order_id, reason))
            return []
        self._seen_ids.add(order.order_id)
        order.seq = self.clock.next()
        self.events.emit(Accepted(order.order_id, order.seq))

        trades = self._match(order)

        if order.is_live:
            if order.order_type is OrderType.MARKET:
                self._cancel_incoming(order, "NO_LIQUIDITY")
            else:
                self.book.rest(order)
                self.events.emit(Rested(order.order_id, order.price, order.remaining))
        return trades

    def cancel(self, order_id: str) -> bool:
        order = self.book.cancel(order_id)
        if order is None:
            return False
        self.events.emit(Cancelled(order_id, order.remaining, "USER"))
        return True

    def end_of_day(self) -> int:
        expired = [o for o in self.book.orders.values() if o.tif is TimeInForce.DAY]
        for o in expired:
            self.book.cancel(o.order_id)
            self.events.emit(Cancelled(o.order_id, o.remaining, "EOD"))
        return len(expired)

    def best_bid(self) -> Optional[int]:
        return self.book.best_bid()

    def best_ask(self) -> Optional[int]:
        return self.book.best_ask()

    # ------------------------------------------------------------- internals

    def _crosses(self, incoming: Order, level_price: int) -> bool:
        if incoming.order_type is OrderType.MARKET:
            return True
        if incoming.side is Side.BUY:
            return level_price <= incoming.price
        return level_price >= incoming.price

    def _cancel_incoming(self, order: Order, reason: str) -> None:
        remaining = order.remaining
        order.status = Status.CANCELLED
        self.events.emit(Cancelled(order.order_id, remaining, reason))

    def _match(self, incoming: Order) -> List[Trade]:
        trades: List[Trade] = []
        opposite = self.book.side(incoming.side.opposite())

        while incoming.is_live:
            level = opposite.best_level()
            if level is None or not self._crosses(incoming, level.price):
                break
            resting = level.head()

            if stp.is_self_trade(incoming, resting):
                action = stp.resolve(self.config.stp_mode, incoming, resting)
                if action.decrement:
                    self.book.reduce(resting.order_id, action.decrement)
                    incoming.remaining -= action.decrement
                    self.events.emit(Decremented(resting.order_id, action.decrement))
                    self.events.emit(Decremented(incoming.order_id, action.decrement))
                    if resting.remaining == 0 or resting.status is Status.CANCELLED:
                        self.events.emit(Cancelled(resting.order_id, 0, "STP"))
                    if incoming.remaining == 0:
                        self._cancel_incoming(incoming, "STP")
                    continue
                if action.cancel_resting:
                    self.book.cancel(resting.order_id)
                    self.events.emit(Cancelled(resting.order_id, resting.remaining, "STP"))
                if action.cancel_incoming:
                    self._cancel_incoming(incoming, "STP")
                continue

            qty = min(incoming.remaining, resting.remaining)
            if incoming.price is None:
                price = resting.price
            else:
                price = min(incoming.price, resting.price)
            level.fill_head(qty)
            incoming.remaining -= qty
            incoming.status = Status.FILLED if incoming.remaining == 0 else Status.PARTIAL
            if resting.status is Status.FILLED:
                self.book.remove_filled(resting)

            buy, sell = (incoming, resting) if incoming.side is Side.BUY else (resting, incoming)
            trade = Trade(
                seq=self.clock.next(), price=price, qty=qty,
                aggressor_id=incoming.order_id, resting_id=resting.order_id,
                aggressor_side=incoming.side,
                buy_account=buy.account, sell_account=sell.account,
            )
            self.positions.on_trade(trade)
            self.events.emit(trade)
            trades.append(trade)
        return trades
`,
      },
      {
        path: "data/sample_orders.csv",
        content: `action,order_id,account,side,qty,price,type,tif
NEW,o1,MM1,SELL,100,10050,LIMIT,GTC
NEW,o2,MM2,SELL,200,10050,LIMIT,GTC
NEW,o3,MM1,SELL,300,10060,LIMIT,DAY
NEW,o4,MM2,BUY,150,10040,LIMIT,GTC
NEW,o5,FUND7,BUY,250,10055,LIMIT,GTC
CXL,o3,,,,,,
NEW,o6,FUND9,BUY,100,,MARKET,GTC
`,
        language: "text",
      },
      {
        path: "engine/book_side.py",
        content: `from __future__ import annotations

import heapq
from typing import Dict, List, Optional, Tuple

from engine.price_level import PriceLevel
from engine.types import Order, Side


class BookSide:
    """One side of the book: price -> PriceLevel, plus a heap of prices.

    The heap is a min-heap of keys. Bids store the negated price so the best
    (highest) bid is at heap[0]; asks store the price as-is. Negation is its
    own inverse, so _key() both encodes and decodes.

    Empty levels are removed lazily, the next time they surface at the top.
    """

    def __init__(self, side: Side) -> None:
        self.side = side
        self.levels: Dict[int, PriceLevel] = {}
        self._heap: List[int] = []

    def _key(self, price: int) -> int:
        return -price if self.side is Side.BUY else price

    def add(self, order: Order) -> None:
        assert order.price is not None
        level = self.levels.get(order.price)
        if level is None:
            level = PriceLevel(order.price)
            self.levels[order.price] = level
            heapq.heappush(self._heap, self._key(order.price))
        level.append(order)

    def best_level(self) -> Optional[PriceLevel]:
        while self._heap:
            price = self._key(self._heap[0])
            level = self.levels.get(price)
            if level is not None and not level.is_empty():
                return level
            heapq.heappop(self._heap)
            self.levels.pop(price, None)
        return None

    def depth(self, n: int) -> List[Tuple[int, int]]:
        live = [lvl for lvl in self.levels.values() if not lvl.is_empty()]
        live.sort(key=lambda lvl: self._key(lvl.price))
        return [(lvl.price, lvl.total_qty) for lvl in live[:n]]

    def __bool__(self) -> bool:
        return self.best_level() is not None
`,
      },
      {
        path: "engine/clock.py",
        content: `class SequenceClock:
    """Monotonic sequence numbers. The engine never reads wall-clock time:
    priority is decided by sequence, which makes a replay of the same input
    produce byte-identical output."""

    def __init__(self, start: int = 0) -> None:
        self._seq = start

    def next(self) -> int:
        self._seq += 1
        return self._seq

    @property
    def current(self) -> int:
        return self._seq
`,
      },
      {
        path: "engine/config.py",
        content: `from __future__ import annotations

from dataclasses import dataclass

from engine.stp import StpMode


@dataclass(frozen=True)
class EngineConfig:
    symbol: str = "XYZ"
    lot_size: int = 1
    max_order_qty: int = 1_000_000
    # Price collar: limit orders more than collar_pct percent away from the
    # reference price are rejected. 0 disables the collar.
    collar_pct: int = 0
    reference_price: int = 0
    stp_mode: StpMode = StpMode.CANCEL_RESTING

    @staticmethod
    def from_dict(raw: dict) -> "EngineConfig":
        stp = raw.get("stp_mode", StpMode.CANCEL_RESTING.value)
        return EngineConfig(
            symbol=raw.get("symbol", "XYZ"),
            lot_size=int(raw.get("lot_size", 1)),
            max_order_qty=int(raw.get("max_order_qty", 1_000_000)),
            collar_pct=int(raw.get("collar_pct", 0)),
            reference_price=int(raw.get("reference_price", 0)),
            stp_mode=StpMode(stp),
        )
`,
      },
      {
        path: "engine/events.py",
        content: `from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Type, TypeVar, Union

from engine.types import Trade


@dataclass(frozen=True)
class Accepted:
    order_id: str
    seq: int


@dataclass(frozen=True)
class Rejected:
    order_id: str
    reason: str


@dataclass(frozen=True)
class Rested:
    order_id: str
    price: int
    qty: int


@dataclass(frozen=True)
class Cancelled:
    order_id: str
    remaining: int
    reason: str          # USER | STP | NO_LIQUIDITY | EOD


@dataclass(frozen=True)
class Decremented:
    order_id: str
    by: int
    reason: str = "STP"


Event = Union[Accepted, Rejected, Rested, Cancelled, Decremented, Trade]
E = TypeVar("E")


class EventLog:
    """Append-only, in-process event sink. Production wires a publisher that
    serialises these onto the drop-copy and market-data channels."""

    def __init__(self) -> None:
        self.events: List[Event] = []
        self._subscribers: List[Callable[[Event], None]] = []

    def subscribe(self, fn: Callable[[Event], None]) -> None:
        self._subscribers.append(fn)

    def emit(self, event: Event) -> None:
        self.events.append(event)
        for fn in self._subscribers:
            fn(event)

    def of_type(self, kind: Type[E]) -> List[E]:
        return [e for e in self.events if isinstance(e, kind)]

    def for_order(self, order_id: str) -> List[Event]:
        out = []
        for e in self.events:
            if getattr(e, "order_id", None) == order_id:
                out.append(e)
            elif isinstance(e, Trade) and order_id in (e.aggressor_id, e.resting_id):
                out.append(e)
        return out
`,
      },
      {
        path: "engine/order_book.py",
        content: `from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from engine.book_side import BookSide
from engine.types import Order, Side, Status


class OrderBook:
    def __init__(self, symbol: str) -> None:
        self.symbol = symbol
        self.bids = BookSide(Side.BUY)
        self.asks = BookSide(Side.SELL)
        # Only orders currently resting in the book.
        self.orders: Dict[str, Order] = {}

    def side(self, side: Side) -> BookSide:
        return self.bids if side is Side.BUY else self.asks

    def rest(self, order: Order) -> None:
        self.side(order.side).add(order)
        self.orders[order.order_id] = order

    def remove_filled(self, order: Order) -> None:
        self.orders.pop(order.order_id, None)

    def cancel(self, order_id: str) -> Optional[Order]:
        order = self.orders.pop(order_id, None)
        if order is None or not order.is_live:
            return None
        level = self.side(order.side).levels[order.price]
        level.on_cancel(order)
        order.status = Status.CANCELLED
        return order

    def reduce(self, order_id: str, by: int) -> Optional[Order]:
        """Reduce a resting order's quantity in place. Keeps queue priority
        (a smaller order cannot disadvantage anyone behind it)."""
        order = self.orders.get(order_id)
        if order is None or by <= 0:
            return None
        if by >= order.remaining:
            return self.cancel(order_id)
        level = self.side(order.side).levels[order.price]
        order.remaining -= by
        level.total_qty -= by
        return order

    def best_bid(self) -> Optional[int]:
        lvl = self.bids.best_level()
        return lvl.price if lvl else None

    def best_ask(self) -> Optional[int]:
        lvl = self.asks.best_level()
        return lvl.price if lvl else None

    def depth(self, side: Side, n: int = 5) -> List[Tuple[int, int]]:
        return self.side(side).depth(n)

    def snapshot(self, n: int = 5) -> str:
        bids = " ".join(f"{q}@{p}" for p, q in self.depth(Side.BUY, n)) or "-"
        asks = " ".join(f"{q}@{p}" for p, q in self.depth(Side.SELL, n)) or "-"
        return f"BIDS {bids} | ASKS {asks}"
`,
      },
      {
        path: "engine/price_level.py",
        content: `from __future__ import annotations

from collections import deque
from typing import Deque, Iterator, Optional

from engine.types import Order, Status


class PriceLevel:
    """FIFO queue of orders at one price.

    Cancels are O(1): the order is marked CANCELLED and its quantity is taken
    out of total_qty, but it stays in the deque until it reaches the head and
    is purged lazily by head().
    """

    __slots__ = ("price", "_orders", "total_qty")

    def __init__(self, price: int) -> None:
        self.price = price
        self._orders: Deque[Order] = deque()
        self.total_qty = 0

    def append(self, order: Order) -> None:
        self._orders.append(order)
        self.total_qty += order.remaining

    def head(self) -> Optional[Order]:
        while self._orders and not self._orders[0].is_live:
            self._orders.popleft()
        return self._orders[0] if self._orders else None

    def fill_head(self, qty: int) -> Order:
        order = self.head()
        assert order is not None and qty <= order.remaining
        order.remaining -= qty
        self.total_qty -= qty
        if order.remaining == 0:
            order.status = Status.FILLED
            self._orders.popleft()
        else:
            order.status = Status.PARTIAL
        return order

    def on_cancel(self, order: Order) -> None:
        self.total_qty -= order.remaining

    def is_empty(self) -> bool:
        return len(self._orders) == 0

    def live_orders(self) -> Iterator[Order]:
        return (o for o in self._orders if o.is_live)

    def __len__(self) -> int:
        return sum(1 for _ in self.live_orders())

    def __repr__(self) -> str:
        return f"PriceLevel({self.price}, qty={self.total_qty}, n={len(self)})"
`,
      },
      {
        path: "engine/risk.py",
        content: `from __future__ import annotations

from collections import defaultdict
from typing import Dict

from engine.types import Side, Trade


class PositionTracker:
    """Post-trade net position per account (in lots). Pre-trade limits are
    enforced by the gateway; the engine only keeps positions for drop-copy."""

    def __init__(self) -> None:
        self.net: Dict[str, int] = defaultdict(int)

    def on_trade(self, t: Trade) -> None:
        # A self-trade never reaches here (STP runs before a trade is created),
        # so buy_account != sell_account and both legs must be booked.
        self.net[t.buy_account] += t.qty
        self.net[t.sell_account] -= t.qty

    def position(self, account: str) -> int:
        return self.net.get(account, 0)

    def gross_traded(self, trades, side: Side, account: str) -> int:
        total = 0
        for t in trades:
            acct = t.buy_account if side is Side.BUY else t.sell_account
            if acct == account:
                total += t.qty
        return total
`,
      },
      {
        path: "engine/stp.py",
        content: `from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from engine.types import Order


class StpMode(str, Enum):
    CANCEL_RESTING = "CANCEL_RESTING"     # cancel the resting order, keep matching
    CANCEL_INCOMING = "CANCEL_INCOMING"   # cancel the rest of the incoming order
    CANCEL_BOTH = "CANCEL_BOTH"
    DECREMENT = "DECREMENT"               # shrink both by the overlap, no trade


@dataclass(frozen=True)
class StpAction:
    cancel_resting: bool = False
    cancel_incoming: bool = False
    decrement: int = 0


def is_self_trade(incoming: Order, resting: Order) -> bool:
    return incoming.account == resting.account


def resolve(mode: StpMode, incoming: Order, resting: Order) -> StpAction:
    if mode is StpMode.CANCEL_RESTING:
        return StpAction(cancel_resting=True)
    if mode is StpMode.CANCEL_INCOMING:
        return StpAction(cancel_incoming=True)
    if mode is StpMode.CANCEL_BOTH:
        return StpAction(cancel_resting=True, cancel_incoming=True)
    if mode is StpMode.DECREMENT:
        return StpAction(decrement=min(incoming.remaining, resting.remaining))
    raise ValueError(f"unknown STP mode {mode}")
`,
      },
      {
        path: "engine/types.py",
        content: `from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"

    def opposite(self) -> "Side":
        return Side.SELL if self is Side.BUY else Side.BUY


class OrderType(str, Enum):
    LIMIT = "LIMIT"
    MARKET = "MARKET"


class TimeInForce(str, Enum):
    GTC = "GTC"   # good till cancelled
    DAY = "DAY"   # cancelled by end_of_day()


class Status(str, Enum):
    NEW = "NEW"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


@dataclass
class Order:
    order_id: str
    account: str
    side: Side
    qty: int
    price: Optional[int] = None          # integer ticks; None for MARKET
    order_type: OrderType = OrderType.LIMIT
    tif: TimeInForce = TimeInForce.GTC
    remaining: int = field(init=False)
    seq: int = 0                         # assigned by the engine on accept
    status: Status = Status.NEW

    def __post_init__(self) -> None:
        self.remaining = self.qty

    @property
    def is_live(self) -> bool:
        return self.status in (Status.NEW, Status.PARTIAL) and self.remaining > 0

    @property
    def filled(self) -> int:
        return self.qty - self.remaining


@dataclass(frozen=True)
class Trade:
    seq: int
    price: int
    qty: int
    aggressor_id: str
    resting_id: str
    aggressor_side: Side
    buy_account: str
    sell_account: str

    def __str__(self) -> str:
        return (f"TRADE #{self.seq} {self.qty}@{self.price} "
                f"aggr={self.aggressor_id}({self.aggressor_side.value}) rest={self.resting_id}")
`,
      },
      {
        path: "engine/validation.py",
        content: `from __future__ import annotations

from typing import Optional

from engine.config import EngineConfig
from engine.types import Order, OrderType


def validate(order: Order, cfg: EngineConfig) -> Optional[str]:
    """Return a reject reason, or None if the order is acceptable."""
    if order.qty <= 0:
        return "QTY_NOT_POSITIVE"
    if order.qty % cfg.lot_size != 0:
        return "QTY_NOT_LOT_MULTIPLE"
    if order.qty > cfg.max_order_qty:
        return "QTY_ABOVE_MAX"
    if order.order_type is OrderType.MARKET:
        if order.price is not None:
            return "MARKET_WITH_PRICE"
        return None
    if order.price is None or order.price <= 0:
        return "BAD_PRICE"
    if cfg.collar_pct and cfg.reference_price:
        # Integer-only arithmetic: |p - ref| / ref > pct / 100
        # <=> |p - ref| * 100 > ref * pct. No float rounding at the boundary.
        if abs(order.price - cfg.reference_price) * 100 > cfg.reference_price * cfg.collar_pct:
            return "OUTSIDE_COLLAR"
    return None
`,
      },
      {
        path: "tests/__init__.py",
        content: "",
      },
      {
        path: "tests/test_examples.py",
        content: `"""Example tests kept in the repo. CI runs these plus the hidden regression
suite owned by the exchange-certification team."""
from engine import MatchingEngine, Order, Side, StpMode, OrderType
from engine.config import EngineConfig
from engine.events import Rested, Rejected


def eng(**kw):
    return MatchingEngine(EngineConfig(**kw))


def test_buy_sweeps_two_levels_at_resting_prices():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM", Side.SELL, 5, 102))
    trades = e.submit(Order("b1", "F", Side.BUY, 8, 103))
    assert [(t.qty, t.price) for t in trades] == [(5, 101), (3, 102)]
    assert e.best_ask() == 102
    assert e.book.depth(Side.SELL) == [(102, 2)]


def test_time_priority_within_level():
    e = eng()
    e.submit(Order("a1", "MM1", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM2", Side.SELL, 5, 101))
    trades = e.submit(Order("b1", "F", Side.BUY, 6, 101))
    assert [t.resting_id for t in trades] == ["a1", "a2"]


def test_non_crossing_order_rests():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.submit(Order("b1", "F", Side.BUY, 5, 100))
    assert e.best_bid() == 100 and e.best_ask() == 101
    assert e.events.of_type(Rested)[-1].order_id == "b1"


def test_market_order_never_rests():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 3, 101))
    trades = e.submit(Order("m1", "F", Side.BUY, 5, None, OrderType.MARKET))
    assert sum(t.qty for t in trades) == 3
    assert e.best_bid() is None


def test_collar_rejects_far_away_price():
    e = eng(collar_pct=10, reference_price=1000)
    e.submit(Order("b1", "F", Side.BUY, 1, 1101))
    assert e.events.of_type(Rejected)[0].reason == "OUTSIDE_COLLAR"
    e.submit(Order("b2", "F", Side.BUY, 1, 1100))
    assert e.best_bid() == 1100


def test_stp_cancel_resting_keeps_matching():
    e = eng(stp_mode=StpMode.CANCEL_RESTING)
    e.submit(Order("a1", "F", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM", Side.SELL, 5, 101))
    trades = e.submit(Order("b1", "F", Side.BUY, 5, 101))
    assert [(t.resting_id, t.qty) for t in trades] == [("a2", 5)]
`,
      },
      {
        path: "tools/__init__.py",
        content: "",
      },
      {
        path: "tools/demo.py",
        content: `"""Scripted session used in the onboarding doc. Run: python3 tools/demo.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import MatchingEngine, Order, Side, StpMode
from engine.config import EngineConfig
from engine.events import Cancelled, Decremented

eng = MatchingEngine(EngineConfig(symbol="XYZ", stp_mode=StpMode.DECREMENT))


def sell(oid, acct, qty, px):
    return eng.submit(Order(oid, acct, Side.SELL, qty, px))


def buy(oid, acct, qty, px):
    return eng.submit(Order(oid, acct, Side.BUY, qty, px))


sell("S1", "A", 5, 101)
sell("S2", "B", 3, 101)
sell("S3", "C", 4, 101)
sell("S4", "A", 6, 103)
buy("B1", "C", 4, 99)
buy("B2", "A", 2, 99)
buy("B3", "D", 5, 97)

for t in buy("X", "B", 10, 102) + sell("Y", "C", 7, 98):
    print(f"{t.aggressor_id}<-{t.resting_id} {t.qty}@{t.price}")

eng.cancel("S4")

for e in eng.events.events:
    if isinstance(e, Decremented):
        print(f"DEC {e.order_id} -{e.by}")
    elif isinstance(e, Cancelled):
        print(f"CXL {e.order_id} rem={e.remaining} {e.reason}")

print(eng.book.snapshot())
print("pos", {a: eng.positions.position(a) for a in "ABCD"})
`,
      },
      {
        path: "tools/replay.py",
        content: `"""Replay an order CSV through a fresh engine and print the trade tape.

    python3 tools/replay.py data/sample_orders.csv

Columns: action,order_id,account,side,qty,price,type,tif
action is NEW or CXL. Replays are deterministic: same file, same tape.
"""
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine import MatchingEngine, Order, OrderType, Side, TimeInForce
from engine.config import EngineConfig


def load_config(path):
    raw = {}
    if os.path.exists(path):
        with open(path) as fh:
            for line in fh:
                line = line.split("#", 1)[0].strip()
                if "=" in line:
                    k, v = (s.strip() for s in line.split("=", 1))
                    raw[k] = v.strip('"')
    return EngineConfig.from_dict(raw)


def replay(path, cfg):
    eng = MatchingEngine(cfg)
    tape = []
    with open(path) as fh:
        for row in csv.DictReader(fh):
            if row["action"] == "CXL":
                eng.cancel(row["order_id"])
                continue
            otype = OrderType(row.get("type") or "LIMIT")
            price = int(row["price"]) if row["price"] else None
            order = Order(
                row["order_id"], row["account"], Side(row["side"]), int(row["qty"]),
                price, otype, TimeInForce(row.get("tif") or "GTC"),
            )
            tape.extend(eng.submit(order))
    return eng, tape


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = load_config(os.path.join(root, "config", "engine.toml"))
    eng, tape = replay(sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "data", "sample_orders.csv"), cfg)
    for t in tape:
        print(t)
    print(eng.book.snapshot())
`,
      },
    ],
    stages: [
      {
        id: "s1",
        kind: "mcq",
        title: "Orientation: how is the book built?",
        prompt: "Read `README.md`, `engine/book_side.py`, `engine/price_level.py` and `engine/order_book.py`. Which statements about the code are true? Select all that apply.",
        options: [
          "Bids are stored as negated prices in a min-heap, so `heap[0]` decodes to the best (highest) bid.",
          "Cancelling an order removes it from its `PriceLevel` deque immediately.",
          "The README specifies that a trade prints at the resting order's price.",
          "`OrderBook.reduce` sends the reduced order to the back of its price level's queue.",
          "Prices are floats in dollars, so the collar check compares them with a tolerance.",
          "Self-trade prevention is evaluated before a `Trade` object is created, so `PositionTracker` never books a self-trade.",
        ],
        correct: [0, 2, 5],
        hints: [
          "Look at `BookSide._key` and the class docstring.",
          "Read the `PriceLevel` docstring about cancels, and the `reduce` docstring.",
        ],
        explanation: `**True:**
- **(A)** \`_key\` negates bid prices, and negation is its own inverse, so the same function encodes and decodes.
- **(C)** README rule 3: the resting order sets the price.
- **(F)** In \`_match\`, the STP branch \`continue\`s before any \`Trade\` is built. \`risk.py\` relies on this explicitly.

**False:**
- **(B)** Cancels are **lazy**. The order is marked \`CANCELLED\` and its qty is removed from \`total_qty\`, but it stays in the deque until \`head()\` purges it. Remember this: it matters in stages 3 and 4.
- **(D)** \`reduce\` mutates the order in place and keeps its priority. Shrinking an order cannot hurt anyone queued behind it.
- **(E)** Prices are integer ticks. The collar check is integer-only, \`|p - ref| * 100 > ref * pct\`, which is exactly why there is no boundary rounding.`,
        timeLimitSec: 300,
        focusFile: "README.md",
      },
      {
        id: "s2",
        kind: "trace",
        title: "Trace a crossing limit order",
        prompt: "The book has asks **a1 5@101** (account MM) and **a2 5@103** (account MM). Account F submits **BUY 8@102 GTC**. Order the steps of `MatchingEngine.submit` as they execute.",
        items: [
          "`validate(order, config)` returns None",
          "The order id is checked against `_seen_ids` and then added to it",
          "`clock.next()` assigns `order.seq` and `Accepted` is emitted",
          "`_match`: `asks.best_level()` returns the 101 level",
          "`_crosses(order, 101)` is True and `level.head()` returns a1",
          "`stp.is_self_trade` is False (F vs MM)",
          "`level.fill_head(5)` fills a1, which `remove_filled` drops from `book.orders`",
          "`positions.on_trade` books the trade, then the `Trade` event is emitted",
          "`best_level()` returns 103, `_crosses` is False, and the loop breaks",
          "`book.rest(order)` adds the 3-lot remainder at 102 and `Rested` is emitted",
        ],
        hints: [
          "Validation and duplicate detection happen before a sequence number is assigned.",
          "Inside the loop, STP is checked per resting order, before quantity is computed.",
        ],
        explanation: `\`submit\` runs validate → duplicate check → seq/Accepted → \`_match\` → rest-or-cancel.

Inside \`_match\` each iteration does:
1. Pick the best opposite level and check that it crosses.
2. Take the head order and run STP.
3. Fill: \`fill_head\` pops a fully filled head from the deque, and \`remove_filled\` removes it from the id index.
4. Build the Trade, then book positions and emit.

After a1 fills, the next best level is 103 > 102, so the loop exits and the 3-lot remainder rests at 102. Its \`seq\` was assigned at accept time, so its time priority is when it *arrived*, not when it rested.`,
        timeLimitSec: 420,
        focusFile: "engine/matcher.py",
      },
      {
        id: "s3",
        kind: "predict",
        title: "Predict the onboarding demo",
        prompt: "`tools/demo.py` is the scripted session from the onboarding doc (STP mode **DECREMENT**). What does it print **with the current code**?",
        entry: "tools/demo.py",
        answer: `X<-S1 5@101
X<-S3 2@101
Y<-B2 2@98
DEC S2 -3
DEC X -3
CXL S2 rem=0 STP
DEC B1 -4
DEC Y -4
CXL B1 rem=0 STP
CXL S4 rem=6 USER
BIDS 5@97 | ASKS 1@98 2@101 0@103
pos {'A': -3, 'B': 7, 'C': -4, 'D': 0}`,
        options: [
          `X<-S1 5@101
X<-S3 2@101
Y<-B2 2@99
DEC S2 -3
DEC X -3
CXL S2 rem=0 STP
DEC B1 -4
DEC Y -4
CXL B1 rem=0 STP
CXL S4 rem=6 USER
BIDS 5@97 | ASKS 1@98 2@101
pos {'A': -3, 'B': 7, 'C': -4, 'D': 0}`,
          `X<-S1 5@101
X<-S3 2@101
Y<-B2 2@99
DEC S2 -3
DEC X -3
CXL S2 rem=3 STP
DEC B1 -4
DEC Y -4
CXL B1 rem=4 STP
CXL S4 rem=6 USER
BIDS 5@97 | ASKS 1@98 2@101 0@103
pos {'A': -3, 'B': 7, 'C': -4, 'D': 0}`,
          `X<-S1 5@101
X<-S3 2@101
Y<-B2 2@98
DEC S2 -3
DEC X -3
CXL S2 rem=0 STP
DEC B1 -4
DEC Y -4
CXL B1 rem=0 STP
CXL S4 rem=6 USER
BIDS 5@97 | ASKS 1@98 2@101 0@103
pos {'A': -3, 'B': 7, 'C': -4, 'D': 0}`,
          `X<-S1 5@101
X<-S3 2@101
Y<-B2 2@98
DEC S2 -3
DEC X -3
CXL S2 rem=0 STP
DEC B1 -4
DEC Y -4
CXL B1 rem=0 STP
CXL S4 rem=6 USER
BIDS 5@97 | ASKS 1@98 2@101
pos {'A': -3, 'B': 7, 'C': -4, 'D': 0}`,
        ],
        hints: [
          "X (account B) hits S1 (A), then meets S2, which is also account B. DECREMENT shrinks both by min(5, 3) and `reduce` cancels S2 outright. Which `remaining` does the matcher print in that Cancelled event?",
          "Y is a SELL at 98 hitting B2's bid at 99. Read the trade price line in `_match` carefully for a sell aggressor.",
          "After `cancel(\"S4\")`, S4 stays in its level's deque. What does `PriceLevel.is_empty()` check, and what does `depth()` then show?",
        ],
        explanation: `Step by step:
1. **X** (B, buy 10@102) trades 5@101 with S1.
2. X meets S2 (also B). DECREMENT gives \`min(5, 3) = 3\`. \`reduce(S2, 3)\` with 3 ≥ remaining cancels S2, and X drops to 2. The matcher emits \`DEC S2\`, \`DEC X\`, then \`Cancelled(S2, 0, "STP")\`. It hard-codes \`0\`.
3. X trades 2@101 with S3.
4. **Y** (C, sell 7@98) meets B1 (also C). DECREMENT 4 cancels B1, and Y drops to 3.
5. Y trades with B2 (A) for 2. Price is \`min(98, 99)\` = **98**. That is the bug: the sell aggressor gets *its own* limit instead of the resting bid of 99, so client A buys 2 lots 1 tick cheaper than they bid, and Y's seller is short-changed.
6. The 99 level is now empty. 97 doesn't cross 98, so Y rests 1@98.
7. \`cancel("S4")\` marks S4 cancelled, but it stays in the 103 deque. \`is_empty()\` checks \`len(deque) == 0\`, so the level is not "empty" and \`depth\` shows a **phantom \`0@103\`**. \`best_level()\` would also return that level, and \`head()\` would then return \`None\`. That is exactly the replay crash.
8. Positions: A = -5 + 2 = **-3**, B = +5 + 2 = **7**, C = -2 - 2 = **-4**, D = **0**.

Two bugs are visible in the output: the **2@98** print and the **0@103** phantom level.`,
        timeLimitSec: 720,
        focusFile: "tools/demo.py",
      },
      {
        id: "s4",
        kind: "code",
        task: "fix",
        title: "Fix the certification failures",
        prompt: `Make the hidden certification regression suite pass. It covers the two defects you just saw:

1. A **sell** aggressor must trade at the **resting bid's** price (README rule 3), exactly like a buy aggressor trades at the resting ask.
2. After the last live order at a price is cancelled, that price must vanish: \`best_bid/best_ask\`, \`depth\` and \`snapshot\` must not report it, and a crossing or market order must move on to the next level instead of crashing.

Keep cancels O(1) amortised (no scanning deques on cancel). The existing example tests must keep passing.`,
        editable: [
          "engine/matcher.py",
          "engine/price_level.py",
          "engine/book_side.py",
        ],
        tests: [
          {
            path: "tests/test_hidden_regressions.py",
            content: `from engine import MatchingEngine, Order, Side, StpMode
from engine.config import EngineConfig
from engine.events import Cancelled


def eng(**kw):
    return MatchingEngine(EngineConfig(**kw))


def test_sell_aggressor_trades_at_resting_bid():
    e = eng()
    e.submit(Order("b1", "MM", Side.BUY, 5, 101))
    e.submit(Order("b2", "MM", Side.BUY, 5, 100))
    trades = e.submit(Order("s1", "F", Side.SELL, 8, 99))
    assert [(t.qty, t.price) for t in trades] == [(5, 101), (3, 100)]


def test_buy_aggressor_still_trades_at_resting_ask():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 99))
    trades = e.submit(Order("b1", "F", Side.BUY, 5, 105))
    assert [(t.qty, t.price) for t in trades] == [(5, 99)]


def test_cancelled_top_level_disappears():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM", Side.SELL, 5, 103))
    e.submit(Order("b1", "MM", Side.BUY, 5, 99))
    assert e.cancel("a1") is True
    assert e.cancel("b1") is True
    assert e.best_ask() == 103
    assert e.best_bid() is None
    assert e.book.depth(Side.SELL) == [(103, 5)]
    assert e.book.depth(Side.BUY) == []
    assert e.book.snapshot() == "BIDS - | ASKS 5@103"


def test_crossing_after_cancel_does_not_crash():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM2", Side.SELL, 5, 102))
    e.cancel("a1")
    trades = e.submit(Order("b1", "F", Side.BUY, 5, 102))
    assert [(t.resting_id, t.qty, t.price) for t in trades] == [("a2", 5, 102)]


def test_market_order_skips_level_of_cancelled_orders():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.submit(Order("a2", "MM", Side.SELL, 5, 101))
    e.submit(Order("a3", "MM", Side.SELL, 4, 104))
    e.cancel("a1")
    e.cancel("a2")
    from engine.types import OrderType
    trades = e.submit(Order("m1", "F", Side.BUY, 6, None, OrderType.MARKET))
    assert [(t.qty, t.price) for t in trades] == [(4, 104)]
    nl = [c for c in e.events.of_type(Cancelled) if c.order_id == "m1"]
    assert nl == [Cancelled("m1", 2, "NO_LIQUIDITY")]


def test_price_level_reused_after_cancel():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 5, 101))
    e.cancel("a1")
    assert e.best_ask() is None
    e.submit(Order("a2", "MM", Side.SELL, 3, 101))
    assert e.best_ask() == 101
    trades = e.submit(Order("b1", "F", Side.BUY, 3, 101))
    assert [(t.resting_id, t.price) for t in trades] == [("a2", 101)]
`,
          },
        ],
        solution: {
          "engine/matcher.py": `from __future__ import annotations

from typing import List, Optional, Set

from engine import stp
from engine.clock import SequenceClock
from engine.config import EngineConfig
from engine.events import Accepted, Cancelled, Decremented, EventLog, Rejected, Rested
from engine.order_book import OrderBook
from engine.risk import PositionTracker
from engine.types import Order, OrderType, Side, Status, TimeInForce, Trade
from engine.validation import validate


class MatchingEngine:
    """Price-time priority matching for a single symbol.

    Single-threaded by design: the gateway serialises all requests for a
    symbol onto one queue, so nothing here takes a lock.
    """

    def __init__(self, config: Optional[EngineConfig] = None,
                 clock: Optional[SequenceClock] = None,
                 events: Optional[EventLog] = None) -> None:
        self.config = config or EngineConfig()
        self.book = OrderBook(self.config.symbol)
        self.clock = clock or SequenceClock()
        self.events = events or EventLog()
        self.positions = PositionTracker()
        self._seen_ids: Set[str] = set()

    # ------------------------------------------------------------------ API

    def submit(self, order: Order) -> List[Trade]:
        reason = validate(order, self.config)
        if reason is None and order.order_id in self._seen_ids:
            reason = "DUPLICATE_ID"
        if reason is not None:
            order.status = Status.REJECTED
            self.events.emit(Rejected(order.order_id, reason))
            return []
        self._seen_ids.add(order.order_id)
        order.seq = self.clock.next()
        self.events.emit(Accepted(order.order_id, order.seq))

        trades = self._match(order)

        if order.is_live:
            if order.order_type is OrderType.MARKET:
                self._cancel_incoming(order, "NO_LIQUIDITY")
            else:
                self.book.rest(order)
                self.events.emit(Rested(order.order_id, order.price, order.remaining))
        return trades

    def cancel(self, order_id: str) -> bool:
        order = self.book.cancel(order_id)
        if order is None:
            return False
        self.events.emit(Cancelled(order_id, order.remaining, "USER"))
        return True

    def end_of_day(self) -> int:
        expired = [o for o in self.book.orders.values() if o.tif is TimeInForce.DAY]
        for o in expired:
            self.book.cancel(o.order_id)
            self.events.emit(Cancelled(o.order_id, o.remaining, "EOD"))
        return len(expired)

    def best_bid(self) -> Optional[int]:
        return self.book.best_bid()

    def best_ask(self) -> Optional[int]:
        return self.book.best_ask()

    # ------------------------------------------------------------- internals

    def _crosses(self, incoming: Order, level_price: int) -> bool:
        if incoming.order_type is OrderType.MARKET:
            return True
        if incoming.side is Side.BUY:
            return level_price <= incoming.price
        return level_price >= incoming.price

    def _cancel_incoming(self, order: Order, reason: str) -> None:
        remaining = order.remaining
        order.status = Status.CANCELLED
        self.events.emit(Cancelled(order.order_id, remaining, reason))

    def _match(self, incoming: Order) -> List[Trade]:
        trades: List[Trade] = []
        opposite = self.book.side(incoming.side.opposite())

        while incoming.is_live:
            level = opposite.best_level()
            if level is None or not self._crosses(incoming, level.price):
                break
            resting = level.head()

            if stp.is_self_trade(incoming, resting):
                action = stp.resolve(self.config.stp_mode, incoming, resting)
                if action.decrement:
                    self.book.reduce(resting.order_id, action.decrement)
                    incoming.remaining -= action.decrement
                    self.events.emit(Decremented(resting.order_id, action.decrement))
                    self.events.emit(Decremented(incoming.order_id, action.decrement))
                    if resting.remaining == 0 or resting.status is Status.CANCELLED:
                        self.events.emit(Cancelled(resting.order_id, 0, "STP"))
                    if incoming.remaining == 0:
                        self._cancel_incoming(incoming, "STP")
                    continue
                if action.cancel_resting:
                    self.book.cancel(resting.order_id)
                    self.events.emit(Cancelled(resting.order_id, resting.remaining, "STP"))
                if action.cancel_incoming:
                    self._cancel_incoming(incoming, "STP")
                continue

            qty = min(incoming.remaining, resting.remaining)
            # The resting order set the price; the aggressor gets any improvement.
            price = resting.price
            level.fill_head(qty)
            incoming.remaining -= qty
            incoming.status = Status.FILLED if incoming.remaining == 0 else Status.PARTIAL
            if resting.status is Status.FILLED:
                self.book.remove_filled(resting)

            buy, sell = (incoming, resting) if incoming.side is Side.BUY else (resting, incoming)
            trade = Trade(
                seq=self.clock.next(), price=price, qty=qty,
                aggressor_id=incoming.order_id, resting_id=resting.order_id,
                aggressor_side=incoming.side,
                buy_account=buy.account, sell_account=sell.account,
            )
            self.positions.on_trade(trade)
            self.events.emit(trade)
            trades.append(trade)
        return trades
`,
          "engine/price_level.py": `from __future__ import annotations

from collections import deque
from typing import Deque, Iterator, Optional

from engine.types import Order, Status


class PriceLevel:
    """FIFO queue of orders at one price.

    Cancels are O(1): the order is marked CANCELLED and its quantity is taken
    out of total_qty, but it stays in the deque until it reaches the head and
    is purged lazily by head().
    """

    __slots__ = ("price", "_orders", "total_qty")

    def __init__(self, price: int) -> None:
        self.price = price
        self._orders: Deque[Order] = deque()
        self.total_qty = 0

    def append(self, order: Order) -> None:
        self._orders.append(order)
        self.total_qty += order.remaining

    def head(self) -> Optional[Order]:
        while self._orders and not self._orders[0].is_live:
            self._orders.popleft()
        return self._orders[0] if self._orders else None

    def fill_head(self, qty: int) -> Order:
        order = self.head()
        assert order is not None and qty <= order.remaining
        order.remaining -= qty
        self.total_qty -= qty
        if order.remaining == 0:
            order.status = Status.FILLED
            self._orders.popleft()
        else:
            order.status = Status.PARTIAL
        return order

    def on_cancel(self, order: Order) -> None:
        self.total_qty -= order.remaining

    def is_empty(self) -> bool:
        # Cancelled orders stay in the deque until purged, so "no live order"
        # is the real emptiness test. head() purges dead orders as a side effect.
        return self.head() is None

    def live_orders(self) -> Iterator[Order]:
        return (o for o in self._orders if o.is_live)

    def __len__(self) -> int:
        return sum(1 for _ in self.live_orders())

    def __repr__(self) -> str:
        return f"PriceLevel({self.price}, qty={self.total_qty}, n={len(self)})"
`,
        },
        hints: [
          "For the price: who set the price, according to the README? Does the answer depend on the aggressor's side?",
          "`BookSide.best_level` trusts `PriceLevel.is_empty()`. With lazy cancels, a deque can be non-empty yet hold no live order.",
          "`PriceLevel.head()` already purges dead orders from the front. Emptiness can be defined in terms of it.",
        ],
        explanation: `**Price.** \`min(incoming.price, resting.price)\` only happens to be right for buy aggressors, where the resting ask ≤ the buy limit. For a sell aggressor, the resting bid ≥ the sell limit, so \`min\` picks the *aggressor's* limit. The rule is side-independent: \`price = resting.price\`. That also removes the special case for market orders.

**Phantom levels.** Lazy deletion has one invariant: every reader must treat dead entries as absent. \`best_level\` asked \`is_empty()\`, which counted dead orders. So:
- a level holding only cancelled orders survived;
- \`head()\` returned \`None\`;
- \`stp.is_self_trade(incoming, None)\` blew up.

Defining \`is_empty()\` as \`self.head() is None\` purges dead orders and answers truthfully. It stays amortised O(1), because each order is popped at most once. \`best_level\` then pops the heap entry and drops the dict entry, and a later order at that price creates a fresh level.

(\`total_qty == 0\` would also work, since \`total_qty\` tracks live quantity, but it leaves dead orders in the deque for longer.)`,
        timeLimitSec: 900,
        focusFile: "engine/matcher.py",
      },
      {
        id: "s5",
        kind: "review-ai",
        title: "Review the assistant's IOC patch",
        prompt: "Next ticket: XM-212, IOC orders. Before writing it yourself, you ask the assistant for a first cut. Would you merge it?",
        persona: "confident-intern",
        request: "Add IOC (immediate-or-cancel) time-in-force to the engine: trade whatever crosses immediately, cancel the rest, never rest on the book.",
        aiReply: `IOC and MARKET orders share the key property that they **never rest**, so we can reuse the existing MARKET path instead of adding a new branch. Smallest possible diff:

\`\`\`python
# engine/types.py
class TimeInForce(str, Enum):
    GTC = "GTC"   # good till cancelled
    DAY = "DAY"   # cancelled by end_of_day()
    IOC = "IOC"   # immediate or cancel
\`\`\`

\`\`\`python
# engine/matcher.py  (in submit, after validation and Accepted)
        if order.tif is TimeInForce.IOC:
            order.order_type = OrderType.MARKET   # IOC never rests, same as MARKET

        trades = self._match(order)
\`\`\`

The leftover quantity is cancelled by the existing \`NO_LIQUIDITY\` branch, so no new cancel code is needed. Validation already ran, so the \`MARKET_WITH_PRICE\` check won't reject it. ✅`,
        options: [
          "Accept: reusing the MARKET path is the minimal change, and validation has already run.",
          "Reject: turning the order into a MARKET order discards its limit. `_crosses` returns True for MARKET, so an IOC buy @101 would sweep 102, 103, … (and the cancel reason is reported as NO_LIQUIDITY rather than IOC).",
          "Reject: a `str`-mixin Enum cannot gain new members without breaking `TimeInForce(\"GTC\")` parsing in the replay tool.",
          "Reject: an IOC remainder must rest until `end_of_day()`, just like DAY orders.",
        ],
        correct: 1,
        hints: [
          "What does `_crosses` do for a MARKET order?",
          "IOC is a *limit* order with a different time-in-force. Which property of MARKET is it *not* supposed to share?",
        ],
        explanation: `IOC and MARKET share "never rests", but IOC keeps a **limit price**. \`_crosses\` short-circuits to \`True\` for MARKET, so the converted order matches at *any* price. An IOC buy @101 would happily lift 102, 103 and beyond. That is a price-protection failure a client would report on the first day, and the hidden IOC tests check exactly this.

Secondary problems:
- Mutating \`order_type\` corrupts the order's record for drop-copy and audit.
- The cancel reason becomes \`NO_LIQUIDITY\`.

The other options are false:
- Adding a member to a \`str\` Enum is fine.
- IOC by definition never rests.

The right shape is a separate branch after matching, when the order is still live: cancel with reason \`IOC\`, otherwise rest.`,
        timeLimitSec: 420,
      },
      {
        id: "s6",
        kind: "code",
        task: "feature",
        title: "Ship IOC (XM-212)",
        prompt: `Implement **IOC** time-in-force:

- \`TimeInForce.IOC\` (wire value \`"IOC"\`).
- An IOC limit order trades against everything that crosses its limit price, in normal price-time priority.
- Any unfilled remainder is cancelled immediately with a \`Cancelled(order_id, remaining, "IOC")\` event. It never rests, never emits \`Rested\`, and never appears in \`book.orders\`. Its status ends as \`CANCELLED\` (or \`FILLED\` if fully filled, with no Cancelled event).
- If STP already cancelled the IOC order, it must get **exactly one** Cancelled event (the STP one).
- GTC and DAY behaviour is unchanged.

Your editable files start from the original code. Keep your stage-4 fixes (the reference solution includes them).`,
        editable: [
          "engine/types.py",
          "engine/matcher.py",
          "engine/price_level.py",
        ],
        tests: [
          {
            path: "tests/test_hidden_ioc.py",
            content: `from engine import MatchingEngine, Order, Side, StpMode, TimeInForce
from engine.config import EngineConfig
from engine.events import Cancelled, Rested


def eng(**kw):
    return MatchingEngine(EngineConfig(**kw))


def ioc(oid, acct, side, qty, px):
    return Order(oid, acct, side, qty, px, tif=TimeInForce.IOC)


def cancels(e, oid):
    return [c for c in e.events.of_type(Cancelled) if c.order_id == oid]


def test_ioc_respects_limit_and_cancels_remainder():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 4, 100))
    e.submit(Order("a2", "MM", Side.SELL, 3, 101))
    e.submit(Order("a3", "MM", Side.SELL, 5, 102))
    o = ioc("i1", "F", Side.BUY, 10, 101)
    trades = e.submit(o)
    assert [(t.qty, t.price) for t in trades] == [(4, 100), (3, 101)]
    assert cancels(e, "i1") == [Cancelled("i1", 3, "IOC")]
    assert e.best_bid() is None
    assert e.best_ask() == 102
    assert "i1" not in e.book.orders
    assert o.status.value == "CANCELLED"
    assert not [r for r in e.events.of_type(Rested) if r.order_id == "i1"]


def test_ioc_that_does_not_cross_is_cancelled_in_full():
    e = eng()
    e.submit(Order("a1", "MM", Side.SELL, 4, 105))
    trades = e.submit(ioc("i1", "F", Side.BUY, 6, 104))
    assert trades == []
    assert cancels(e, "i1") == [Cancelled("i1", 6, "IOC")]
    assert e.best_bid() is None


def test_fully_filled_ioc_emits_no_cancel():
    e = eng()
    e.submit(Order("b1", "MM", Side.BUY, 9, 100))
    o = ioc("i1", "F", Side.SELL, 5, 100)
    trades = e.submit(o)
    assert [(t.qty, t.price) for t in trades] == [(5, 100)]
    assert cancels(e, "i1") == []
    assert o.status.value == "FILLED"


def test_ioc_cancelled_by_stp_gets_exactly_one_cancel():
    e = eng(stp_mode=StpMode.CANCEL_INCOMING)
    e.submit(Order("a1", "F", Side.SELL, 5, 100))
    trades = e.submit(ioc("i1", "F", Side.BUY, 5, 100))
    assert trades == []
    assert cancels(e, "i1") == [Cancelled("i1", 5, "STP")]
    assert e.best_ask() == 100


def test_ioc_is_parsed_from_wire_value():
    assert TimeInForce("IOC") is TimeInForce.IOC


def test_gtc_and_day_still_rest():
    e = eng()
    e.submit(Order("g1", "F", Side.BUY, 5, 99))
    e.submit(Order("d1", "F", Side.BUY, 5, 98, tif=TimeInForce.DAY))
    assert e.book.depth(Side.BUY) == [(99, 5), (98, 5)]
    assert e.end_of_day() == 1
`,
          },
        ],
        solution: {
          "engine/types.py": `from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"

    def opposite(self) -> "Side":
        return Side.SELL if self is Side.BUY else Side.BUY


class OrderType(str, Enum):
    LIMIT = "LIMIT"
    MARKET = "MARKET"


class TimeInForce(str, Enum):
    GTC = "GTC"   # good till cancelled
    DAY = "DAY"   # cancelled by end_of_day()
    IOC = "IOC"   # immediate or cancel: never rests


class Status(str, Enum):
    NEW = "NEW"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


@dataclass
class Order:
    order_id: str
    account: str
    side: Side
    qty: int
    price: Optional[int] = None          # integer ticks; None for MARKET
    order_type: OrderType = OrderType.LIMIT
    tif: TimeInForce = TimeInForce.GTC
    remaining: int = field(init=False)
    seq: int = 0                         # assigned by the engine on accept
    status: Status = Status.NEW

    def __post_init__(self) -> None:
        self.remaining = self.qty

    @property
    def is_live(self) -> bool:
        return self.status in (Status.NEW, Status.PARTIAL) and self.remaining > 0

    @property
    def filled(self) -> int:
        return self.qty - self.remaining


@dataclass(frozen=True)
class Trade:
    seq: int
    price: int
    qty: int
    aggressor_id: str
    resting_id: str
    aggressor_side: Side
    buy_account: str
    sell_account: str

    def __str__(self) -> str:
        return (f"TRADE #{self.seq} {self.qty}@{self.price} "
                f"aggr={self.aggressor_id}({self.aggressor_side.value}) rest={self.resting_id}")
`,
          "engine/matcher.py": `from __future__ import annotations

from typing import List, Optional, Set

from engine import stp
from engine.clock import SequenceClock
from engine.config import EngineConfig
from engine.events import Accepted, Cancelled, Decremented, EventLog, Rejected, Rested
from engine.order_book import OrderBook
from engine.risk import PositionTracker
from engine.types import Order, OrderType, Side, Status, TimeInForce, Trade
from engine.validation import validate


class MatchingEngine:
    """Price-time priority matching for a single symbol.

    Single-threaded by design: the gateway serialises all requests for a
    symbol onto one queue, so nothing here takes a lock.
    """

    def __init__(self, config: Optional[EngineConfig] = None,
                 clock: Optional[SequenceClock] = None,
                 events: Optional[EventLog] = None) -> None:
        self.config = config or EngineConfig()
        self.book = OrderBook(self.config.symbol)
        self.clock = clock or SequenceClock()
        self.events = events or EventLog()
        self.positions = PositionTracker()
        self._seen_ids: Set[str] = set()

    # ------------------------------------------------------------------ API

    def submit(self, order: Order) -> List[Trade]:
        reason = validate(order, self.config)
        if reason is None and order.order_id in self._seen_ids:
            reason = "DUPLICATE_ID"
        if reason is not None:
            order.status = Status.REJECTED
            self.events.emit(Rejected(order.order_id, reason))
            return []
        self._seen_ids.add(order.order_id)
        order.seq = self.clock.next()
        self.events.emit(Accepted(order.order_id, order.seq))

        trades = self._match(order)

        if order.is_live:
            if order.order_type is OrderType.MARKET:
                self._cancel_incoming(order, "NO_LIQUIDITY")
            elif order.tif is TimeInForce.IOC:
                # Immediate-or-cancel: trade what crosses now, never rest.
                self._cancel_incoming(order, "IOC")
            else:
                self.book.rest(order)
                self.events.emit(Rested(order.order_id, order.price, order.remaining))
        return trades

    def cancel(self, order_id: str) -> bool:
        order = self.book.cancel(order_id)
        if order is None:
            return False
        self.events.emit(Cancelled(order_id, order.remaining, "USER"))
        return True

    def end_of_day(self) -> int:
        expired = [o for o in self.book.orders.values() if o.tif is TimeInForce.DAY]
        for o in expired:
            self.book.cancel(o.order_id)
            self.events.emit(Cancelled(o.order_id, o.remaining, "EOD"))
        return len(expired)

    def best_bid(self) -> Optional[int]:
        return self.book.best_bid()

    def best_ask(self) -> Optional[int]:
        return self.book.best_ask()

    # ------------------------------------------------------------- internals

    def _crosses(self, incoming: Order, level_price: int) -> bool:
        if incoming.order_type is OrderType.MARKET:
            return True
        if incoming.side is Side.BUY:
            return level_price <= incoming.price
        return level_price >= incoming.price

    def _cancel_incoming(self, order: Order, reason: str) -> None:
        remaining = order.remaining
        order.status = Status.CANCELLED
        self.events.emit(Cancelled(order.order_id, remaining, reason))

    def _match(self, incoming: Order) -> List[Trade]:
        trades: List[Trade] = []
        opposite = self.book.side(incoming.side.opposite())

        while incoming.is_live:
            level = opposite.best_level()
            if level is None or not self._crosses(incoming, level.price):
                break
            resting = level.head()

            if stp.is_self_trade(incoming, resting):
                action = stp.resolve(self.config.stp_mode, incoming, resting)
                if action.decrement:
                    self.book.reduce(resting.order_id, action.decrement)
                    incoming.remaining -= action.decrement
                    self.events.emit(Decremented(resting.order_id, action.decrement))
                    self.events.emit(Decremented(incoming.order_id, action.decrement))
                    if resting.remaining == 0 or resting.status is Status.CANCELLED:
                        self.events.emit(Cancelled(resting.order_id, 0, "STP"))
                    if incoming.remaining == 0:
                        self._cancel_incoming(incoming, "STP")
                    continue
                if action.cancel_resting:
                    self.book.cancel(resting.order_id)
                    self.events.emit(Cancelled(resting.order_id, resting.remaining, "STP"))
                if action.cancel_incoming:
                    self._cancel_incoming(incoming, "STP")
                continue

            qty = min(incoming.remaining, resting.remaining)
            # The resting order set the price; the aggressor gets any improvement.
            price = resting.price
            level.fill_head(qty)
            incoming.remaining -= qty
            incoming.status = Status.FILLED if incoming.remaining == 0 else Status.PARTIAL
            if resting.status is Status.FILLED:
                self.book.remove_filled(resting)

            buy, sell = (incoming, resting) if incoming.side is Side.BUY else (resting, incoming)
            trade = Trade(
                seq=self.clock.next(), price=price, qty=qty,
                aggressor_id=incoming.order_id, resting_id=resting.order_id,
                aggressor_side=incoming.side,
                buy_account=buy.account, sell_account=sell.account,
            )
            self.positions.on_trade(trade)
            self.events.emit(trade)
            trades.append(trade)
        return trades
`,
          "engine/price_level.py": `from __future__ import annotations

from collections import deque
from typing import Deque, Iterator, Optional

from engine.types import Order, Status


class PriceLevel:
    """FIFO queue of orders at one price.

    Cancels are O(1): the order is marked CANCELLED and its quantity is taken
    out of total_qty, but it stays in the deque until it reaches the head and
    is purged lazily by head().
    """

    __slots__ = ("price", "_orders", "total_qty")

    def __init__(self, price: int) -> None:
        self.price = price
        self._orders: Deque[Order] = deque()
        self.total_qty = 0

    def append(self, order: Order) -> None:
        self._orders.append(order)
        self.total_qty += order.remaining

    def head(self) -> Optional[Order]:
        while self._orders and not self._orders[0].is_live:
            self._orders.popleft()
        return self._orders[0] if self._orders else None

    def fill_head(self, qty: int) -> Order:
        order = self.head()
        assert order is not None and qty <= order.remaining
        order.remaining -= qty
        self.total_qty -= qty
        if order.remaining == 0:
            order.status = Status.FILLED
            self._orders.popleft()
        else:
            order.status = Status.PARTIAL
        return order

    def on_cancel(self, order: Order) -> None:
        self.total_qty -= order.remaining

    def is_empty(self) -> bool:
        # Cancelled orders stay in the deque until purged, so "no live order"
        # is the real emptiness test. head() purges dead orders as a side effect.
        return self.head() is None

    def live_orders(self) -> Iterator[Order]:
        return (o for o in self._orders if o.is_live)

    def __len__(self) -> int:
        return sum(1 for _ in self.live_orders())

    def __repr__(self) -> str:
        return f"PriceLevel({self.price}, qty={self.total_qty}, n={len(self)})"
`,
        },
        hints: [
          "Matching is unchanged for IOC: `_crosses` should still compare against the limit price.",
          "The decision happens after `_match` returns, in the `if order.is_live:` block, alongside the MARKET branch.",
          "Reuse `_cancel_incoming(order, \"IOC\")`. An order that STP cancelled is no longer `is_live`, so it won't be cancelled twice.",
        ],
        explanation: `The whole feature is one enum member and one branch:

\`\`\`python
        if order.is_live:
            if order.order_type is OrderType.MARKET:
                self._cancel_incoming(order, "NO_LIQUIDITY")
            elif order.tif is TimeInForce.IOC:
                self._cancel_incoming(order, "IOC")
            else:
                self.book.rest(order)
                ...
\`\`\`

Why it goes there:
- **Matching is untouched.** IOC must respect its limit and normal priority.
- **The \`is_live\` guard gives the edge cases for free.** A fully filled IOC is \`FILLED\`, and an STP-cancelled IOC is \`CANCELLED\`, so neither gets a second cancel.
- **Never resting means never calling \`book.rest\`.** The order therefore never enters the id index or a price level, which is what a cancel-on-arrival venue needs.

FOK (fill-or-kill) is the natural follow-up. It needs a *pre-check* of crossable liquidity, net of STP, before any trade is printed. You cannot "undo" trades that have already been emitted.`,
        timeLimitSec: 900,
        focusFile: "engine/matcher.py",
      },
      {
        id: "s7",
        kind: "mcq",
        title: "Design follow-up: a cancel thread",
        prompt: "To cut cancel latency, the gateway team proposes calling `engine.cancel()` from a **second thread** while the main thread keeps running `submit()`. There are no other changes and no locks. Which failures become possible? Select all that apply.",
        options: [
          "A cancel lands between `resting = level.head()` and `level.fill_head(qty)`. `fill_head` purges the now-dead head and fills the *next* order in the queue, while the Trade is still attributed to `resting` and STP was never checked against the order that actually traded.",
          "`PriceLevel.total_qty` can end up wrong, because `self.total_qty -= x` is a read-modify-write that can interleave between threads even under the GIL.",
          "Two trades can receive the same `seq`, because `cancel()` also advances the `SequenceClock`.",
          "Nothing breaks. The GIL makes each engine method call atomic, so `cancel` and `submit` cannot interleave.",
          "A client can receive both a fill and a cancel acknowledgement for the same quantity: `cancel` reads `is_live`/`remaining` while the matching thread is filling that order.",
        ],
        correct: [0, 1, 4],
        hints: [
          "The GIL makes individual bytecodes atomic, not Python methods or statements.",
          "Does `MatchingEngine.cancel` or `OrderBook.cancel` ever call `clock.next()`?",
        ],
        explanation: `The engine's design ("the gateway serialises every request for a symbol onto one queue") is load-bearing. Every structure is mutated with multi-step check-then-act sequences.

**Real failures:**
- **(A)** \`head()\` purges lazily, so a cancel slipping in between \`head()\` and \`fill_head()\` makes \`fill_head\` operate on a different order than the one the matcher reasoned about. The result is wrong attribution, a skipped STP check, or an assertion failure if the next order is smaller.
- **(B)** \`x -= y\` compiles to a load, a subtract and a store. A thread switch between them loses an update, and the GIL does not prevent that.
- **(E)** This is a classic overfill / double-report.

**Not failures:**
- **(C)** \`cancel\` never touches the clock.
- **(D)** This is the GIL misconception.

**The right design** keeps a single writer: the cancel goes onto the *same* per-symbol queue, ideally with priority (many venues process cancels ahead of new orders in the same batch). If latency is the goal, shard by symbol across cores, which preserves single-writer per book. A lock around the engine would also be correct but adds contention on the hottest path.

**What to monitor if you ever do go multi-threaded:**
- the invariant \`total_qty == sum(live remaining)\` per level;
- that each order's filled + cancelled ≤ its original qty.`,
        timeLimitSec: 480,
        focusFile: "engine/price_level.py",
      },
    ],
  },
];

export default problems;
