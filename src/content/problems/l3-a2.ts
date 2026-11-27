import type { Problem } from '../types';

/**
 * Level 3 "Module Navigator" — slice A, part 2.
 * NOTE: code lives in template literals, so backticks are escaped as \` and `${` as \${.
 */
const problems: Problem[] = [
  // ---------------------------------------------------------------------------
  // 1. Python — chat message store with pagination cursors
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-py-chat-cursor-pagination',
    title: 'Chat History: The Vanishing Messages',
    level: 3,
    rating: 1640,
    lang: 'python',
    domain: 'chat',
    companies: ['meta', 'atlassian', 'canva'],
    tags: ['pagination', 'cursors', 'tuple-ordering', 'event-bus', 'tracing'],
    summary: 'Scrolling back through a busy channel silently skips messages. Follow the cursor across four modules.',
    context:
      'You have joined the messaging team. Support tickets say that when a busy channel is scrolled back, some messages "disappear" and occasionally an empty page is loaded. The history endpoint uses opaque cursors so that clients never see database keys. Nobody has touched the pagination code in a year.',
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# chat-history

Stores channel messages and serves history newest-first with **opaque cursors**.

## Layout

| Module | Responsibility |
| --- | --- |
| \`chat/app.py\` | Composition root: builds the bus, store, service and API |
| \`chat/api.py\` | HTTP-ish handlers (\`get_history\`, \`post_message\`), input validation |
| \`chat/service.py\` | Business logic: posting, building pages and next cursors |
| \`chat/cursor.py\` | Encodes/decodes the opaque cursor token |
| \`chat/store.py\` | In-memory stand-in for the \`messages\` table |
| \`chat/events.py\` | Tiny synchronous pub/sub bus |
| \`chat/unread.py\` | Unread counters, fed by \`message.posted\` events |

## Ordering contract

Messages are ordered by the key **(ts, id)** descending. \`ts\` is the server clock in
milliseconds and is *not* unique: several messages routinely share a millisecond in busy
channels. \`id\` is unique and breaks ties.

A cursor identifies the **last message the client has already seen**. The next page must
contain the messages strictly *older* than that key, so that paging through a channel
returns every message exactly once.
`,
      },
      {
        path: 'chat/config.py',
        content: `DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
`,
      },
      {
        path: 'chat/models.py',
        content: `from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class Message:
    id: int
    channel: str
    author: str
    ts: int  # server clock, milliseconds; NOT unique
    text: str


@dataclass
class Page:
    items: List[Message]
    next_cursor: Optional[str]
`,
      },
      {
        path: 'chat/events.py',
        content: `class EventBus:
    """Synchronous in-process pub/sub. Handlers run in subscription order."""

    def __init__(self):
        self._subs = {}

    def subscribe(self, topic, handler):
        self._subs.setdefault(topic, []).append(handler)

    def publish(self, topic, payload):
        for handler in self._subs.get(topic, []):
            handler(payload)
`,
      },
      {
        path: 'chat/unread.py',
        content: `class UnreadCounter:
    """Counts messages per channel since the last mark_read()."""

    def __init__(self, bus):
        self.counts = {}
        bus.subscribe("message.posted", self._on_posted)

    def _on_posted(self, msg):
        self.counts[msg.channel] = self.counts.get(msg.channel, 0) + 1

    def mark_read(self, channel):
        self.counts[channel] = 0
`,
      },
      {
        path: 'chat/cursor.py',
        content: `import base64


class InvalidCursor(ValueError):
    pass


def encode_cursor(msg):
    """Opaque token for the (ts, id) key of the last message on a page."""
    raw = f"{msg.ts}:{msg.id}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(token):
    """Returns the (ts, id) key the client has already seen."""
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        ts, msg_id = raw.split(":")
        return int(ts), int(msg_id)
    except Exception as exc:
        raise InvalidCursor(token) from exc
`,
      },
      {
        path: 'chat/store.py',
        content: `from chat.models import Message


class MessageStore:
    """In-memory stand-in for the messages table, indexed on (channel, ts, id)."""

    def __init__(self):
        self._rows = {}
        self._next_id = 1

    def insert(self, channel, author, ts, text):
        msg = Message(self._next_id, channel, author, ts, text)
        self._next_id += 1
        self._rows.setdefault(channel, []).append(msg)
        return msg

    def scan_older(self, channel, before=None, limit=50):
        """Newest-first scan. \`before\` is a (ts, id) key; only strictly older rows are returned."""
        rows = sorted(self._rows.get(channel, []), key=lambda m: (m.ts, m.id), reverse=True)
        if before is not None:
            rows = [m for m in rows if m.ts < before[0]]
        return rows[:limit]
`,
      },
      {
        path: 'chat/service.py',
        content: `from chat.cursor import decode_cursor, encode_cursor
from chat.models import Page


class ChatService:
    def __init__(self, store, clock, bus):
        self._store = store
        self._clock = clock
        self._bus = bus

    def post(self, channel, author, text):
        text = text.strip()
        if not text:
            raise ValueError("empty message")
        msg = self._store.insert(channel, author, self._clock(), text)
        self._bus.publish("message.posted", msg)
        return msg

    def history(self, channel, cursor=None, limit=20):
        before = decode_cursor(cursor) if cursor else None
        # fetch one extra row so we know whether another page exists
        rows = self._store.scan_older(channel, before=before, limit=limit + 1)
        items = rows[:limit]
        has_more = len(rows) > limit
        next_cursor = encode_cursor(items[-1]) if has_more else None
        return Page(items=items, next_cursor=next_cursor)
`,
      },
      {
        path: 'chat/api.py',
        content: `from chat import config
from chat.cursor import InvalidCursor


def parse_limit(raw):
    if raw is None:
        return config.DEFAULT_PAGE_SIZE
    limit = int(raw)
    if limit < 1:
        raise ValueError("limit must be >= 1")
    return min(limit, config.MAX_PAGE_SIZE)


class ChatApi:
    def __init__(self, service):
        self._service = service

    def get_history(self, channel, query):
        try:
            limit = parse_limit(query.get("limit"))
            page = self._service.history(channel, cursor=query.get("cursor"), limit=limit)
        except InvalidCursor:
            return 400, {"error": "bad cursor"}
        except ValueError as exc:
            return 400, {"error": str(exc)}
        return 200, {
            "messages": [{"id": m.id, "author": m.author, "text": m.text} for m in page.items],
            "next_cursor": page.next_cursor,
        }

    def post_message(self, channel, body):
        try:
            msg = self._service.post(channel, body["author"], body.get("text", ""))
        except (KeyError, ValueError) as exc:
            return 400, {"error": str(exc)}
        return 201, {"id": msg.id}
`,
      },
      {
        path: 'chat/app.py',
        content: `from chat.api import ChatApi
from chat.events import EventBus
from chat.service import ChatService
from chat.store import MessageStore
from chat.unread import UnreadCounter


def build_app(clock):
    bus = EventBus()
    store = MessageStore()
    unread = UnreadCounter(bus)
    service = ChatService(store, clock, bus)
    return ChatApi(service), unread
`,
      },
      {
        path: 'main.py',
        content: `from chat.app import build_app

# a busy channel: several messages land in the same millisecond
ticks = iter([1000, 1000, 1001, 1002, 1002, 1002, 1003])
api, unread = build_app(clock=lambda: next(ticks))

for i in range(7):
    api.post_message("general", {"author": "ana", "text": f"msg {i + 1}"})

cursor = None
page_no = 1
while True:
    query = {"limit": "2"}
    if cursor:
        query["cursor"] = cursor
    status, body = api.get_history("general", query)
    print(page_no, [m["id"] for m in body["messages"]])
    cursor = body["next_cursor"]
    if not cursor:
        break
    page_no += 1
print("unread", unread.counts["general"])
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Who owns what?',
        prompt:
          'Before debugging, get your bearings. Which statements are true about this codebase? Select all that apply.',
        options: [
          '`ChatService.history` decides whether a `next_cursor` is returned, by asking the store for one row more than the page size',
          '`chat/cursor.py` talks to the store to look up the message a cursor points at',
          'The unread counter is updated because `ChatService.post` publishes `message.posted` and `UnreadCounter` subscribed to it in its constructor',
          'A malformed cursor produces a 400 with `"bad cursor"`, even though `InvalidCursor` is also a `ValueError`',
          '`parse_limit` silently clamps `limit=500` to 100',
          '`chat/app.py` is the only place where concrete classes are wired together',
        ],
        correct: [0, 2, 3, 4, 5],
        hints: [
          'Open `chat/cursor.py`: does it import anything from the store?',
          'Python checks `except` clauses top to bottom — which one comes first in `get_history`?',
        ],
        explanation:
          '`cursor.py` is pure encoding (base64 of `"ts:id"`) and never touches the store. Everything else is true: the service fetches `limit + 1` rows and only emits a cursor when the extra row exists; `UnreadCounter.__init__` subscribes to the bus that the service publishes on (observer pattern wired in `app.py`); `except InvalidCursor` is listed **before** `except ValueError`, so the more specific handler wins; `parse_limit` uses `min(limit, MAX_PAGE_SIZE)`.',
        timeLimitSec: 240,
        focusFile: 'chat/app.py',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a "load older messages" request',
        prompt:
          'A client calls `api.get_history("general", {"limit": "2", "cursor": token})`. Order the steps as they execute on the success path.',
        items: [
          'ChatApi.get_history receives the query dict',
          'parse_limit clamps the limit using chat/config.py',
          'ChatService.history calls decode_cursor(token) → (ts, id)',
          'MessageStore.scan_older sorts the channel newest-first by (ts, id)',
          'scan_older filters rows older than the cursor and slices to limit + 1',
          'ChatService.history trims to limit and encode_cursor(items[-1]) builds next_cursor',
          'ChatApi.get_history serialises messages and returns (200, body)',
        ],
        hints: ['Start in `chat/api.py`, then follow the `self._service` call.', 'Where is the extra `+ 1` row removed again?'],
        explanation:
          'API (validation) → service (decode cursor) → store (sort, filter, slice) → service (trim to `limit`, build the cursor from the **last item actually returned**) → API (serialise). Note that the cursor is built from `items[-1]`, not from the extra look-ahead row: the next page must start right after what the client has seen.',
        timeLimitSec: 300,
        focusFile: 'chat/api.py',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce the ticket',
        prompt:
          '`main.py` posts 7 messages (ids 1-7) using a fake clock where several share a millisecond, then pages through history 2 at a time. What does it print?',
        entry: 'main.py',
        answer: '1 [7, 6]\n2 [3, 2]\n3 []\nunread 7',
        options: [
          '1 [7, 6]\n2 [5, 4]\n3 [3, 2]\n4 [1]\nunread 7',
          '1 [7, 6]\n2 [3, 2]\n3 []\nunread 7',
          '1 [7, 6]\n2 [3, 2]\n3 [1]\nunread 7',
          '1 [7, 6]\n2 [6, 5]\n3 [4, 3]\n4 [2, 1]\nunread 7',
        ],
        hints: [
          'Write down (ts, id) for each message: ids 1..7 get ts 1000, 1000, 1001, 1002, 1002, 1002, 1003.',
          'After page 1, the cursor is (1002, 6). Which rows pass the filter in `scan_older`?',
        ],
        explanation:
          'Page 1: no cursor, store returns [7, 6, 5] (limit + 1), so items = [7, 6] and the cursor is (1002, 6). Page 2: the filter keeps only `ts < 1002`, dropping 5 and 4, which share ts 1002 with the cursor message. Store returns [3, 2, 1], so items = [3, 2] with cursor (1000, 2). Page 3: `ts < 1000` removes message 1 too, so the page is empty and there is no cursor. Messages 5, 4 and 1 were never shown. That matches both symptoms: "missing messages" and "an empty page". The unread counter saw all 7 posts through the bus.',
        timeLimitSec: 360,
        focusFile: 'main.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'The intern has a one-liner',
        prompt: 'The assistant proposes a fix for `scan_older`. Should you accept it?',
        persona: 'confident-intern',
        request: 'Messages with the same timestamp as the cursor get skipped. Fix scan_older.',
        aiReply: `Easy, the filter is just too strict. Include the boundary millisecond and exclude only the cursor message itself:

\`\`\`python
        if before is not None:
            before_ts, before_id = before
            rows = [m for m in rows if m.ts <= before_ts and m.id != before_id]
\`\`\`

Now messages 5 and 4 show up on page 2. Ship it! 🚀`,
        options: [
          'Accept: it includes same-millisecond messages and still excludes the cursor row',
          'Reject: a message that shares the cursor\'s ts but has a larger id (newer, already shown) is returned again, so pages contain duplicates',
          'Reject: `before` is a string token here and cannot be unpacked',
          'Reject: it changes the sort order of the result',
        ],
        correct: 1,
        hints: [
          'Imagine a page that ends at message 5, so the cursor is (1002, 5). Which rows pass `m.ts <= 1002 and m.id != 5`?',
        ],
        explanation:
          'With cursor (1002, 5), message 6 (ts 1002, id 6) passes the new filter even though it is **newer** and was already on the previous page, so it is duplicated. The condition must express "strictly older in (ts, id) order": `(m.ts, m.id) < before`, i.e. `m.ts < ts or (m.ts == ts and m.id < id)`. `before` is already a decoded tuple: `ChatService.history` calls `decode_cursor` before calling the store.',
        timeLimitSec: 240,
        focusFile: 'chat/store.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix pagination',
        prompt:
          'Fix the bug so that paging through a channel with any page size returns **every message exactly once**, newest-first, even when many messages share a timestamp. Keep the cursor format unchanged.',
        editable: ['chat/store.py', 'chat/service.py'],
        tests: [
          {
            path: 'tests/test_pagination.py',
            content: `from chat.app import build_app


def make(ticks):
    it = iter(ticks)
    api, unread = build_app(clock=lambda: next(it))
    for i in range(len(ticks)):
        api.post_message("c", {"author": "u", "text": "m%d" % i})
    return api


def walk(api, limit):
    seen, pages, cursor = [], 0, None
    while True:
        q = {"limit": str(limit)}
        if cursor:
            q["cursor"] = cursor
        status, body = api.get_history("c", q)
        assert status == 200
        pages += 1
        seen.extend(m["id"] for m in body["messages"])
        cursor = body["next_cursor"]
        if not cursor:
            return seen, pages


def test_same_millisecond_messages_not_skipped():
    api = make([1000, 1000, 1001, 1002, 1002, 1002, 1003])
    seen, _ = walk(api, 2)
    assert seen == [7, 6, 5, 4, 3, 2, 1]


def test_all_page_sizes_exactly_once():
    ticks = [5, 5, 5, 5, 6, 6, 7, 7, 7, 7, 7, 8]
    for limit in range(1, 14):
        api = make(ticks)
        seen, _ = walk(api, limit)
        assert seen == list(range(12, 0, -1)), (limit, seen)


def test_no_trailing_empty_page():
    api = make([1, 2, 3, 4])
    seen, pages = walk(api, 2)
    assert seen == [4, 3, 2, 1]
    assert pages == 2


def test_bad_cursor_is_400():
    api = make([1, 2])
    status, body = api.get_history("c", {"cursor": "!!!"})
    assert status == 400
`,
          },
        ],
        solution: {
          'chat/store.py': `from chat.models import Message


class MessageStore:
    """In-memory stand-in for the messages table, indexed on (channel, ts, id)."""

    def __init__(self):
        self._rows = {}
        self._next_id = 1

    def insert(self, channel, author, ts, text):
        msg = Message(self._next_id, channel, author, ts, text)
        self._next_id += 1
        self._rows.setdefault(channel, []).append(msg)
        return msg

    def scan_older(self, channel, before=None, limit=50):
        """Newest-first scan. \`before\` is a (ts, id) key; only strictly older rows are returned."""
        rows = sorted(self._rows.get(channel, []), key=lambda m: (m.ts, m.id), reverse=True)
        if before is not None:
            rows = [m for m in rows if (m.ts, m.id) < tuple(before)]
        return rows[:limit]
`,
        },
        hints: [
          'The sort key is `(m.ts, m.id)`. The filter should compare against the cursor using the same key.',
          'Python compares tuples lexicographically: `(1002, 4) < (1002, 6)` is `True`.',
        ],
        explanation:
          'The sort and the filter must agree on the key. Comparing the full `(ts, id)` tuple keeps the rows that share the cursor\'s millisecond but have a smaller id, and drops the ones with a larger id. This is the in-memory version of the SQL keyset predicate `WHERE (ts, id) < (:ts, :id) ORDER BY ts DESC, id DESC`. The service\'s `limit + 1` look-ahead was already correct and also prevents a trailing empty page.',
        timeLimitSec: 600,
        focusFile: 'chat/store.py',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 2. TypeScript — job scheduler with retries / exponential backoff
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-ts-job-scheduler-backoff',
    title: 'Job Scheduler: Retrying the Unretryable',
    level: 3,
    rating: 1720,
    lang: 'typescript',
    domain: 'scheduler',
    companies: ['amazon', 'stripe', 'atlassian'],
    tags: ['retries', 'exponential-backoff', 'error-subclassing', 'event-bus', 'dependency-injection'],
    summary: 'Declined cards are charged four times. Follow a failed job through backoff, the queue and the dead-letter store.',
    context:
      'You are on call for the background jobs platform. Finance noticed that customers whose card was **declined** get charged up to four times, minutes apart. Handlers are supposed to throw `PermanentError` for failures that retrying cannot fix. The scheduler is wired with constructor injection so that tests can use a fake clock.',
    persona: 'api-dreamer',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# jobs

A small in-process job scheduler with retries and exponential backoff.

## Concepts

- **Job**: \`{ id, type, payload, runAt, attempts }\`. \`attempts\` counts runs *started*.
- **Handler**: registered per job type in \`HandlerRegistry\`. May be sync or async.
- **Retry policy** (\`src/config.ts\`): \`maxAttempts\` is the total number of runs including the
  first. Before retry *n* (1 = first retry) we wait \`min(base * 2^(n-1), maxDelay)\`.
- **Permanent failures**: a handler throws \`PermanentError\` (\`src/errors.ts\`) when retrying
  cannot help (card declined, malformed payload). Such jobs go **straight** to the dead-letter
  store, with no retries.

## Events (\`EventBus\`)

| event | payload | emitted by |
| --- | --- | --- |
| \`job.enqueued\` | job | \`Scheduler.enqueue\` |
| \`job.succeeded\` | job | \`Scheduler.runOne\` |
| \`job.retrying\` | \`{ job, delay }\` | \`Scheduler.onFailure\` |
| \`job.dead\` | job | \`Scheduler.onFailure\` |

\`DeadLetterStore\` subscribes to \`job.dead\`. \`runUntilIdle\` (\`src/runner.ts\`) drives a
\`FakeClock\` in tests and scripts.
`,
      },
      {
        path: 'src/config.ts',
        content: `export interface RetryConfig {
  /** Total runs allowed, including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetryConfig: RetryConfig = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 300,
};
`,
      },
      {
        path: 'src/types.ts',
        content: `export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  runAt: number;
  /** Runs started so far. */
  attempts: number;
  lastError?: string;
}

export type Handler = (job: Job) => Promise<void> | void;
`,
      },
      {
        path: 'src/clock.ts',
        content: `export interface Clock {
  now(): number;
}

export class FakeClock implements Clock {
  constructor(private t = 0) {}

  now(): number {
    return this.t;
  }

  advanceTo(t: number): void {
    if (t > this.t) this.t = t;
  }
}
`,
      },
      {
        path: 'src/errors.ts',
        content: `/** Throw from a handler when retrying cannot help (bad payload, card declined, 4xx...). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function isPermanent(err: unknown): boolean {
  return err instanceof Error && err.name === 'PermanentError';
}
`,
      },
      {
        path: 'src/backoff.ts',
        content: `import { RetryConfig } from './config';

/** Delay before retry number \`retry\` (1 = first retry). Exponential, capped at maxDelayMs. */
export function backoffDelay(retry: number, cfg: RetryConfig): number {
  const raw = cfg.baseDelayMs * Math.pow(2, retry - 1);
  return Math.min(raw, cfg.maxDelayMs);
}
`,
      },
      {
        path: 'src/events.ts',
        content: `type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(event: string, fn: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  emit(event: string, payload: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}
`,
      },
      {
        path: 'src/queue.ts',
        content: `import { Job } from './types';

/** Ordered by (runAt, id). Production uses a Postgres table with SKIP LOCKED. */
export class JobQueue {
  private jobs: Job[] = [];
  private nextId = 1;

  add(type: string, payload: Record<string, unknown>, runAt: number): Job {
    const job: Job = { id: this.nextId++, type, payload, runAt, attempts: 0 };
    this.jobs.push(job);
    return job;
  }

  requeue(job: Job, runAt: number): void {
    job.runAt = runAt;
    this.jobs.push(job);
  }

  /** Removes and returns every job due at or before \`now\`, earliest first. */
  takeDue(now: number): Job[] {
    const due = this.jobs.filter((j) => j.runAt <= now);
    this.jobs = this.jobs.filter((j) => j.runAt > now);
    return due.sort((a, b) => a.runAt - b.runAt || a.id - b.id);
  }

  nextRunAt(): number | undefined {
    if (this.jobs.length === 0) return undefined;
    return Math.min(...this.jobs.map((j) => j.runAt));
  }

  size(): number {
    return this.jobs.length;
  }
}
`,
      },
      {
        path: 'src/registry.ts',
        content: `import { Handler } from './types';

export class HandlerRegistry {
  private handlers = new Map<string, Handler>();

  register(type: string, handler: Handler): this {
    if (this.handlers.has(type)) throw new Error('duplicate handler: ' + type);
    this.handlers.set(type, handler);
    return this;
  }

  get(type: string): Handler {
    const h = this.handlers.get(type);
    if (!h) throw new Error('no handler for ' + type);
    return h;
  }
}
`,
      },
      {
        path: 'src/scheduler.ts',
        content: `import { backoffDelay } from './backoff';
import { Clock } from './clock';
import { RetryConfig } from './config';
import { isPermanent } from './errors';
import { EventBus } from './events';
import { JobQueue } from './queue';
import { HandlerRegistry } from './registry';
import { Job } from './types';

export class Scheduler {
  constructor(
    private queue: JobQueue,
    private registry: HandlerRegistry,
    private clock: Clock,
    private cfg: RetryConfig,
    private bus: EventBus,
  ) {}

  enqueue(type: string, payload: Record<string, unknown> = {}, delayMs = 0): Job {
    const job = this.queue.add(type, payload, this.clock.now() + delayMs);
    this.bus.emit('job.enqueued', job);
    return job;
  }

  /** Runs every job that is due now, one at a time. Returns how many ran. */
  async tick(): Promise<number> {
    const due = this.queue.takeDue(this.clock.now());
    for (const job of due) {
      await this.runOne(job);
    }
    return due.length;
  }

  private async runOne(job: Job): Promise<void> {
    job.attempts += 1;
    try {
      const handler = this.registry.get(job.type);
      await handler(job);
      this.bus.emit('job.succeeded', job);
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      this.onFailure(job, err);
    }
  }

  private onFailure(job: Job, err: unknown): void {
    if (isPermanent(err) || job.attempts >= this.cfg.maxAttempts) {
      this.bus.emit('job.dead', job);
      return;
    }
    const delay = backoffDelay(job.attempts, this.cfg);
    this.queue.requeue(job, this.clock.now() + delay);
    this.bus.emit('job.retrying', { job, delay });
  }
}
`,
      },
      {
        path: 'src/deadLetter.ts',
        content: `import { EventBus } from './events';
import { Job } from './types';

export class DeadLetterStore {
  readonly jobs: Job[] = [];

  constructor(bus: EventBus) {
    bus.on('job.dead', (job: Job) => this.jobs.push(job));
  }
}
`,
      },
      {
        path: 'src/runner.ts',
        content: `import { FakeClock } from './clock';
import { JobQueue } from './queue';
import { Scheduler } from './scheduler';

/** Test/script helper: jump the fake clock to the next due job and tick, until the queue drains. */
export async function runUntilIdle(s: Scheduler, q: JobQueue, clock: FakeClock, maxTicks = 100): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    const next = q.nextRunAt();
    if (next === undefined) return;
    clock.advanceTo(next);
    await s.tick();
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { FakeClock } from './clock';
import { defaultRetryConfig } from './config';
import { DeadLetterStore } from './deadLetter';
import { PermanentError } from './errors';
import { EventBus } from './events';
import { JobQueue } from './queue';
import { HandlerRegistry } from './registry';
import { runUntilIdle } from './runner';
import { Scheduler } from './scheduler';
import { Job } from './types';

const clock = new FakeClock(0);
const bus = new EventBus();
const queue = new JobQueue();
const registry = new HandlerRegistry();
const dead = new DeadLetterStore(bus);
const scheduler = new Scheduler(queue, registry, clock, defaultRetryConfig, bus);

let emailCalls = 0;
registry
  .register('email', () => {
    emailCalls++;
    if (emailCalls < 3) throw new Error('smtp timeout');
  })
  .register('charge', (job) => {
    throw new PermanentError('card declined for ' + job.payload.user);
  });

bus.on('job.succeeded', (job: Job) => console.log('t=' + clock.now() + ' ok ' + job.type + ' after ' + job.attempts));
bus.on('job.retrying', (e: { job: Job; delay: number }) => console.log('t=' + clock.now() + ' retry ' + e.job.type + ' in ' + e.delay));
bus.on('job.dead', (job: Job) => console.log('t=' + clock.now() + ' dead ' + job.type + ': ' + job.lastError));

scheduler.enqueue('charge', { user: 'u1' });
scheduler.enqueue('email', { to: 'a@example.com' }, 50);

runUntilIdle(scheduler, queue, clock).then(() => console.log('dead letters: ' + dead.jobs.length));
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Find your way around',
        prompt: 'Which statements about this codebase are true? Select all that apply.',
        options: [
          'The delay before a retry is computed in `backoff.ts` but *chosen* (which retry number to pass) by `Scheduler.onFailure`',
          '`DeadLetterStore` is called directly by the scheduler when a job dies',
          'If a job type has no registered handler, the job is retried with backoff like any other failure',
          '`JobQueue.takeDue` removes due jobs from the queue, so a failed job only runs again if it is explicitly requeued',
          'The scheduler reads `Date.now()` directly, which is why tests are flaky',
        ],
        correct: [0, 2, 3],
        hints: [
          'Search for `DeadLetterStore` usages: who constructs it, and what does its constructor do?',
          '`registry.get` throws for unknown types. Is that call inside or outside the `try`?',
        ],
        explanation:
          'The scheduler never references `DeadLetterStore`. It emits `job.dead`, and the store subscribed in its own constructor (observer pattern), so the two stay decoupled. `registry.get` is called **inside** the `try`, so "no handler for X" is treated as an ordinary retryable failure. Arguably it should be permanent, but that is how the code behaves today. Time comes from the injected `Clock`, so tests can use `FakeClock`.',
        timeLimitSec: 240,
        focusFile: 'src/scheduler.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Replay the incident',
        prompt:
          '`src/main.ts` enqueues a `charge` job (its handler always throws `PermanentError`) at t=0 and an `email` job (fails twice, then succeeds) at t=50. What does it print?',
        entry: 'src/main.ts',
        answer:
          't=0 retry charge in 100\nt=50 retry email in 100\nt=100 retry charge in 200\nt=150 retry email in 200\nt=300 retry charge in 300\nt=350 ok email after 3\nt=600 dead charge: card declined for u1\ndead letters: 1',
        options: [
          't=0 dead charge: card declined for u1\nt=50 retry email in 100\nt=150 retry email in 200\nt=350 ok email after 3\ndead letters: 1',
          't=0 retry charge in 100\nt=50 retry email in 100\nt=100 retry charge in 200\nt=150 retry email in 200\nt=300 retry charge in 300\nt=350 ok email after 3\nt=600 dead charge: card declined for u1\ndead letters: 1',
          't=0 retry charge in 100\nt=50 retry email in 100\nt=100 retry charge in 200\nt=150 retry email in 200\nt=300 retry charge in 400\nt=350 ok email after 3\nt=700 dead charge: card declined for u1\ndead letters: 1',
          't=0 retry charge in 200\nt=50 retry email in 200\nt=200 retry charge in 300\nt=250 retry email in 300\nt=500 dead charge: card declined for u1\nt=550 ok email after 3\ndead letters: 1',
        ],
        hints: [
          'Check how `isPermanent` decides. What is `err.name` for an instance of a class that extends `Error` but never sets `name`?',
          'Backoff for retries 1, 2, 3 with base 100 and cap 300 is 100, 200, 300.',
        ],
        explanation:
          '`PermanentError` never assigns `this.name`, so `err.name` is inherited from `Error.prototype` and equals `"Error"`. `isPermanent` therefore returns false, and the charge is retried like a transient failure. Timeline: charge fails at 0 (retry in 100). Email fails at 50 (retry in 100, at 150). Charge fails at 100 (retry in 200, at 300). Email fails at 150 (retry in 200, at 350). Charge fails at 300; retry 3 would wait 400, capped to 300, so it runs at 600. Email succeeds at 350 on attempt 3. Charge fails at 600 with `attempts = 4 = maxAttempts`, so it dies. The card was charged four times, which is the incident.',
        timeLimitSec: 420,
        focusFile: 'src/main.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Pin the root cause',
        prompt: 'Click the line that makes permanent failures look retryable, then choose the root cause.',
        file: 'src/errors.ts',
        lines: [9],
        options: [
          '`err.name` is `"Error"` for `PermanentError` instances because the subclass never sets `name`, so the name check never matches',
          '`instanceof` does not work for classes that extend `Error`',
          '`super(message)` must be called after setting fields',
          '`isPermanent` should be checked after the attempts check, not before',
        ],
        correct: 0,
        hints: ['Log `new PermanentError("x").name` in your head: where does `name` come from?'],
        explanation:
          'Subclassing `Error` does not change `name`: it is looked up on the prototype chain and resolves to `Error.prototype.name === "Error"`. Either set `this.name = "PermanentError"` in the constructor or, better, test with `err instanceof PermanentError`. In modern ES2015+ output, `instanceof` works correctly for `Error` subclasses. Option 2 is a myth that dates from ES5 transpilation. The order of the `||` clauses is irrelevant.',
        timeLimitSec: 240,
        focusFile: 'src/errors.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'The assistant suggests a fix',
        prompt: 'You ask the assistant to make permanent errors skip retries. Should you accept its patch?',
        persona: 'api-dreamer',
        request: 'PermanentError jobs are still retried. Make them go straight to the dead-letter store.',
        aiReply: `The cleanest approach is to short-circuit in the scheduler and use the queue's built-in dead-letter support:

\`\`\`ts
  private onFailure(job: Job, err: unknown): void {
    if (err instanceof PermanentError) {
      this.queue.deadLetter(job, { reason: job.lastError });
      return;
    }
    if (job.attempts >= this.cfg.maxAttempts) {
      this.bus.emit('job.dead', job);
      return;
    }
    const delay = backoffDelay(job.attempts, this.cfg);
    this.queue.requeue(job, this.clock.now() + delay);
    this.bus.emit('job.retrying', { job, delay });
  }
\`\`\`

\`JobQueue.deadLetter\` persists the job to the DLQ table and is idempotent, so this is safe to retry.`,
        options: [
          'Accept: `instanceof` is the right check and the DLQ call is idempotent',
          'Reject: `JobQueue` has no `deadLetter` method. Dead jobs reach `DeadLetterStore` only through the `job.dead` event, so permanent failures would crash or vanish and no `job.dead` listener would fire',
          'Reject: `instanceof PermanentError` cannot work because errors cross an `await`',
          'Reject: permanent errors should still be retried once before dead-lettering',
        ],
        correct: 1,
        hints: ['Open `src/queue.ts`. Which methods does `JobQueue` actually expose?'],
        explanation:
          'The `instanceof` idea is good, but `queue.deadLetter` does not exist. The assistant invented an API. In this repo the dead-letter path is purely event-driven: `onFailure` emits `job.dead` and `DeadLetterStore` (plus any alerting listeners) react. The minimal correct change is `if (err instanceof PermanentError || job.attempts >= max) emit("job.dead")`, or fixing `name` in `errors.ts`.',
        timeLimitSec: 240,
        focusFile: 'src/queue.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Stop charging declined cards',
        prompt:
          'Make jobs that fail with `PermanentError` (or any subclass of it) go straight to the dead-letter store after a single attempt, with **no** `job.retrying` event. Transient failures must keep the existing retry/backoff behaviour.',
        editable: ['src/errors.ts', 'src/scheduler.ts'],
        tests: [
          {
            path: 'tests/scheduler.test.ts',
            content: `import { FakeClock } from '../src/clock';
import { defaultRetryConfig } from '../src/config';
import { DeadLetterStore } from '../src/deadLetter';
import { PermanentError } from '../src/errors';
import { EventBus } from '../src/events';
import { JobQueue } from '../src/queue';
import { HandlerRegistry } from '../src/registry';
import { runUntilIdle } from '../src/runner';
import { Scheduler } from '../src/scheduler';

class CardDeclined extends PermanentError {}

function setup() {
  const clock = new FakeClock(0);
  const bus = new EventBus();
  const queue = new JobQueue();
  const registry = new HandlerRegistry();
  const dead = new DeadLetterStore(bus);
  const s = new Scheduler(queue, registry, clock, defaultRetryConfig, bus);
  const retries: number[] = [];
  bus.on('job.retrying', (e: any) => retries.push(e.delay));
  return { clock, bus, queue, registry, dead, s, retries };
}

test('PermanentError is dead-lettered after one attempt', async () => {
  const t = setup();
  let calls = 0;
  t.registry.register('charge', () => { calls++; throw new PermanentError('declined'); });
  t.s.enqueue('charge');
  await runUntilIdle(t.s, t.queue, t.clock);
  expect(calls).toBe(1);
  expect(t.retries).toEqual([]);
  expect(t.dead.jobs).toHaveLength(1);
  expect(t.dead.jobs[0].lastError).toBe('declined');
  expect(t.clock.now()).toBe(0);
});

test('subclasses of PermanentError are permanent too', async () => {
  const t = setup();
  let calls = 0;
  t.registry.register('charge', async () => { calls++; throw new CardDeclined('nope'); });
  t.s.enqueue('charge');
  await runUntilIdle(t.s, t.queue, t.clock);
  expect(calls).toBe(1);
  expect(t.dead.jobs).toHaveLength(1);
});

test('transient errors still retry with capped backoff', async () => {
  const t = setup();
  let calls = 0;
  t.registry.register('sync', () => { calls++; throw new Error('timeout'); });
  t.s.enqueue('sync');
  await runUntilIdle(t.s, t.queue, t.clock);
  expect(calls).toBe(4);
  expect(t.retries).toEqual([100, 200, 300]);
  expect(t.clock.now()).toBe(600);
  expect(t.dead.jobs).toHaveLength(1);
});
`,
          },
        ],
        solution: {
          'src/errors.ts': `/** Throw from a handler when retrying cannot help (bad payload, card declined, 4xx...). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export function isPermanent(err: unknown): boolean {
  return err instanceof PermanentError;
}
`,
        },
        hints: [
          'You only need to change how permanence is detected; `onFailure` already has the right shape.',
          'Which check also covers subclasses like `class CardDeclined extends PermanentError {}`?',
        ],
        explanation:
          '`err instanceof PermanentError` matches the class and every subclass, and does not depend on string names, which subclasses could override. Setting `this.name` as well keeps logs readable. `onFailure` already short-circuits on `isPermanent`, so the fix belongs in `errors.ts`. Fixing the predicate in one place also fixes every other caller.',
        timeLimitSec: 480,
        focusFile: 'src/errors.ts',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 3. JavaScript — auth/session middleware with RBAC
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-js-auth-rbac-middleware',
    title: 'Docs API: The Viewer Who Could Write',
    level: 3,
    rating: 1580,
    lang: 'javascript',
    domain: 'auth',
    companies: ['atlassian', 'canva', 'microsoft'],
    tags: ['middleware', 'rbac', 'sessions', 'onion-model', 'security'],
    summary: 'A read-only user edited a document. Walk the middleware onion to find out why.',
    context:
      'You have joined the platform team behind a collaborative docs API. The audit log shows a user with only the `viewer` role saving changes to a document. The API uses a Koa-style middleware stack: session lookup, then RBAC checks, then route handlers.',
    persona: 'lazy-copier',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# docs-api

Koa-style HTTP layer for the docs product (framework-free so it runs anywhere).

## Request pipeline

\`\`\`
router.handle(req)
  -> requestLog      (global)  logs on the way in AND on the way out
  -> session         (global)  cookie "sid" -> ctx.state.user / ctx.state.sessionId
  -> requirePermission(perm)   per route; 401 if anonymous, 403 if missing permission
  -> handler                   per route
\`\`\`

Middleware signature: \`async (ctx, next) => {}\`. A middleware **stops the chain by not
calling \`next()\`**. Code after \`await next()\` runs after everything downstream finished.

## Roles

Defined in \`src/auth/roles.js\`. Roles inherit permissions:
\`admin\` ⊃ \`editor\` ⊃ \`viewer\`.

## Sessions

Sliding expiry: every authenticated request pushes \`expiresAt\` to \`now + idleTimeoutMs\`.
`,
      },
      {
        path: 'src/config.js',
        content: `module.exports = {
  cookieName: 'sid',
  idleTimeoutMs: 30 * 60 * 1000,
};
`,
      },
      {
        path: 'src/http/compose.js',
        content: `/**
 * Koa-style composition. Each middleware receives (ctx, next) and decides whether
 * to call next(). Code after \`await next()\` runs on the way back out.
 */
function compose(middlewares) {
  return function run(ctx) {
    let index = -1;
    function dispatch(i) {
      if (i <= index) return Promise.reject(new Error('next() called twice'));
      index = i;
      const fn = middlewares[i];
      if (!fn) return Promise.resolve();
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return dispatch(0);
  };
}

module.exports = { compose };
`,
      },
      {
        path: 'src/http/router.js',
        content: `const { compose } = require('./compose');

function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i];
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

class Router {
  constructor() {
    this.global = [];
    this.routes = [];
  }

  use(mw) {
    this.global.push(mw);
    return this;
  }

  add(method, pattern, ...chain) {
    this.routes.push({ method, pattern, chain });
    return this;
  }

  async handle(req) {
    const ctx = { req, params: {}, status: 404, body: { error: 'not found' }, state: {} };
    let chain = this.global;
    for (const r of this.routes) {
      const params = r.method === req.method ? match(r.pattern, req.path) : null;
      if (params) {
        ctx.params = params;
        chain = [...this.global, ...r.chain];
        break;
      }
    }
    await compose(chain)(ctx);
    return { status: ctx.status, body: ctx.body };
  }
}

module.exports = { Router };
`,
      },
      {
        path: 'src/auth/roles.js',
        content: `const ROLES = {
  viewer: { inherits: [], grants: ['doc:read'] },
  editor: { inherits: ['viewer'], grants: ['doc:write'] },
  admin: { inherits: ['editor'], grants: ['doc:delete', 'user:manage'] },
};

/** All permissions granted by a list of role names, following inheritance. */
function permissionsFor(roleNames) {
  const perms = new Set();
  const visit = (name) => {
    const role = ROLES[name];
    if (!role) return; // unknown roles grant nothing
    role.grants.forEach((p) => perms.add(p));
    role.inherits.forEach(visit);
  };
  roleNames.forEach(visit);
  return perms;
}

module.exports = { ROLES, permissionsFor };
`,
      },
      {
        path: 'src/auth/sessionStore.js',
        content: `class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.seq = 0;
  }

  create(userId, roles, expiresAt) {
    const sid = 's' + ++this.seq;
    this.sessions.set(sid, { userId, roles, expiresAt });
    return sid;
  }

  get(sid) {
    return this.sessions.get(sid);
  }

  touch(sid, expiresAt) {
    const s = this.sessions.get(sid);
    if (s) s.expiresAt = expiresAt;
  }

  destroy(sid) {
    return this.sessions.delete(sid);
  }
}

module.exports = { SessionStore };
`,
      },
      {
        path: 'src/middleware/session.js',
        content: `function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

function session(store, clock, config) {
  return async (ctx, next) => {
    const sid = parseCookies(ctx.req.headers.cookie)[config.cookieName];
    const s = sid ? store.get(sid) : undefined;
    if (s && s.expiresAt > clock.now()) {
      store.touch(sid, clock.now() + config.idleTimeoutMs);
      ctx.state.user = { id: s.userId, roles: s.roles };
      ctx.state.sessionId = sid;
    }
    await next();
  };
}

module.exports = { session, parseCookies };
`,
      },
      {
        path: 'src/middleware/rbac.js',
        content: `const { permissionsFor } = require('../auth/roles');

function requirePermission(perm) {
  return async (ctx, next) => {
    const user = ctx.state.user;
    if (!user) {
      ctx.status = 401;
      ctx.body = { error: 'login required' };
      return;
    }
    if (!permissionsFor(user.roles).has(perm)) {
      ctx.status = 403;
      ctx.body = { error: 'missing ' + perm };
    }
    await next();
  };
}

module.exports = { requirePermission };
`,
      },
      {
        path: 'src/middleware/requestLog.js',
        content: `function requestLog(lines) {
  return async (ctx, next) => {
    lines.push('-> ' + ctx.req.method + ' ' + ctx.req.path);
    await next();
    const who = ctx.state.user ? ' as ' + ctx.state.user.id : '';
    lines.push('<- ' + ctx.status + who);
  };
}

module.exports = { requestLog };
`,
      },
      {
        path: 'src/services/docService.js',
        content: `class DocService {
  constructor() {
    this.docs = new Map([['d1', { id: 'd1', title: 'Roadmap', body: 'v1', updatedBy: 'system' }]]);
  }

  read(id) {
    return this.docs.get(id) || null;
  }

  update(id, body, userId) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    doc.body = body;
    doc.updatedBy = userId;
    return doc;
  }

  remove(id) {
    return this.docs.delete(id);
  }
}

module.exports = { DocService };
`,
      },
      {
        path: 'src/routes/docs.js',
        content: `const { requirePermission } = require('../middleware/rbac');

function docRoutes(router, docs) {
  router.add('GET', '/docs/:id', requirePermission('doc:read'), async (ctx) => {
    const doc = docs.read(ctx.params.id);
    ctx.status = doc ? 200 : 404;
    ctx.body = doc || { error: 'no such doc' };
  });

  router.add('PUT', '/docs/:id', requirePermission('doc:write'), async (ctx) => {
    const doc = docs.update(ctx.params.id, ctx.req.body.body, ctx.state.user.id);
    ctx.status = doc ? 200 : 404;
    ctx.body = doc || { error: 'no such doc' };
  });

  router.add('DELETE', '/docs/:id', requirePermission('doc:delete'), async (ctx) => {
    ctx.status = docs.remove(ctx.params.id) ? 204 : 404;
    ctx.body = null;
  });
}

module.exports = { docRoutes };
`,
      },
      {
        path: 'src/app.js',
        content: `const config = require('./config');
const { Router } = require('./http/router');
const { requestLog } = require('./middleware/requestLog');
const { session } = require('./middleware/session');
const { docRoutes } = require('./routes/docs');
const { DocService } = require('./services/docService');

function createApp({ clock, store, log }) {
  const docs = new DocService();
  const router = new Router();
  router.use(requestLog(log)).use(session(store, clock, config));
  docRoutes(router, docs);
  return { router, docs };
}

module.exports = { createApp };
`,
      },
      {
        path: 'main.js',
        content: `const { createApp } = require('./src/app');
const { SessionStore } = require('./src/auth/sessionStore');

let now = 1000;
const clock = { now: () => now };
const store = new SessionStore();
const log = [];
const { router, docs } = createApp({ clock, store, log });

const vic = store.create('vic', ['viewer'], 5000);
const ada = store.create('ada', ['admin'], 5000);

async function call(method, path, sid, body) {
  const headers = sid ? { cookie: 'theme=dark; sid=' + sid } : {};
  const res = await router.handle({ method, path, headers, body });
  console.log(method + ' ' + path + ' ' + res.status);
}

(async () => {
  await call('GET', '/docs/d1', vic);
  await call('PUT', '/docs/d1', vic, { body: 'hacked' });
  await call('DELETE', '/docs/d1');
  now = 6000;
  await call('GET', '/docs/d1', ada);
  await call('GET', '/docs/d1', vic);
  const d = docs.read('d1');
  console.log('body=' + d.body + ' by ' + d.updatedBy);
})();
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'The onion',
        prompt:
          'An anonymous `GET /docs/d1` (no cookie) arrives. Which statements are true? Select all that apply.',
        options: [
          '`requestLog` writes `-> GET /docs/d1` before the session middleware runs and `<- 401` after the RBAC middleware returns',
          'The route handler for `GET /docs/:id` runs and overwrites the 401',
          '`session` calls `next()` even though no user was found',
          'The router matched the route, so the chain is `[requestLog, session, requirePermission("doc:read"), handler]`',
          'Because the RBAC middleware returns without calling `next()`, `requestLog` never writes its `<-` line',
        ],
        correct: [0, 2, 3],
        hints: [
          'Read `compose.js`: what happens to the outer middleware when an inner one returns without calling `next()`?',
          'Look at the `!user` branch in `rbac.js`. Does it `return`?',
        ],
        explanation:
          'Composition is an onion. `requestLog` runs first and awaits `next()`. `session` finds no user but still calls `next()`, because authentication is optional at that layer. `requirePermission` sets 401 and **returns** without calling `next()`, so the handler never runs. That promise resolves and the stack unwinds back into `requestLog`, which logs `<- 401`. Not calling `next()` stops the chain *inward*; it does not prevent outer middleware from finishing.',
        timeLimitSec: 240,
        focusFile: 'src/http/compose.js',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Reproduce the audit finding',
        prompt: 'Predict the output of `main.js`.',
        entry: 'main.js',
        answer: 'GET /docs/d1 200\nPUT /docs/d1 200\nDELETE /docs/d1 401\nGET /docs/d1 401\nGET /docs/d1 200\nbody=hacked by vic',
        options: [
          'GET /docs/d1 200\nPUT /docs/d1 403\nDELETE /docs/d1 401\nGET /docs/d1 401\nGET /docs/d1 401\nbody=v1 by system',
          'GET /docs/d1 200\nPUT /docs/d1 200\nDELETE /docs/d1 401\nGET /docs/d1 401\nGET /docs/d1 200\nbody=hacked by vic',
          'GET /docs/d1 200\nPUT /docs/d1 200\nDELETE /docs/d1 401\nGET /docs/d1 200\nGET /docs/d1 200\nbody=hacked by vic',
          'GET /docs/d1 200\nPUT /docs/d1 403\nDELETE /docs/d1 401\nGET /docs/d1 401\nGET /docs/d1 200\nbody=hacked by vic',
        ],
        hints: [
          'In `rbac.js`, after setting 403, what is the next statement executed?',
          'Both sessions start with `expiresAt = 5000`. Which one gets touched before `now = 6000`?',
        ],
        explanation:
          'The 403 branch in `requirePermission` sets status and body but then **falls through** to `await next()`. The PUT handler runs, saves the doc, and overwrites the status with 200. DELETE without a cookie gets 401. Sessions are sliding: vic\'s requests at t=1000 pushed her `expiresAt` to 1000 + 30 min, while ada\'s session was never used, so it expired at 5000. At t=6000 ada gets 401 even though she is an admin, and vic still gets 200. The doc body is `hacked`, written by `vic`.',
        timeLimitSec: 360,
        focusFile: 'main.js',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Find the hole',
        prompt: 'Click the line responsible for letting viewers write, and pick the root cause.',
        file: 'src/middleware/rbac.js',
        lines: [11, 12, 13, 14, 15],
        options: [
          'The 403 branch does not `return`, so `next()` still runs the handler, which overwrites the status',
          '`permissionsFor` ignores inherited roles',
          '`compose` runs every middleware regardless of `next()`',
          'The session middleware should reject anonymous requests with 401',
        ],
        correct: 0,
        hints: ['Compare the 401 branch and the 403 branch line by line.'],
        explanation:
          'The 401 branch ends with `return`. The 403 branch does not, so control reaches `await next()`. In Koa/Express-style stacks, "deny" must mean "do not call next". Setting a status is not enough, because downstream code can overwrite it and, worse, perform the side effect. `permissionsFor` and `compose` are correct.',
        timeLimitSec: 180,
        focusFile: 'src/middleware/rbac.js',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the refactor',
        prompt:
          'A teammate asked the assistant to "simplify rbac.js". Should this be merged?',
        persona: 'lazy-copier',
        request: 'Simplify requirePermission and fix the 403 fall-through.',
        aiReply: `Here's a tighter version. Throwing is cleaner than juggling status codes:

\`\`\`js
function requirePermission(perm) {
  return async (ctx, next) => {
    if (!permissionsFor(ctx.state.user.roles).has(perm)) {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    }
    await next();
  };
}
\`\`\`

The framework's error handler will turn that into a 403 response. Rest of the file unchanged.`,
        options: [
          'Accept: throwing is idiomatic and the 403 can no longer fall through',
          'Reject: anonymous requests now crash with a TypeError on `ctx.state.user.roles`, and nothing in this repo catches thrown errors, so `router.handle` rejects instead of returning 401/403',
          'Reject: `permissionsFor` returns an array, so `.has` does not exist',
          'Reject: `await next()` must come before the permission check',
        ],
        correct: 1,
        hints: [
          'What is `ctx.state.user` for a request without a cookie?',
          'Search the repo for a `try`/`catch` around `compose(chain)(ctx)`. Is there an error-handling middleware?',
        ],
        explanation:
          'The reply silently dropped the 401 branch. For anonymous users `ctx.state.user` is `undefined`, so `.roles` throws a TypeError. It also relies on "the framework\'s error handler", but this repo has no error middleware and `Router.handle` does not catch. Any denial now rejects the request promise (a 500 or a crash) instead of returning 401/403. The minimal fix is to add `return;` after setting 403.',
        timeLimitSec: 240,
        focusFile: 'src/middleware/rbac.js',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'feature',
        title: 'Fix the hole and add logout',
        prompt:
          '1. Fix `requirePermission` so a missing permission returns **403** and the handler does **not** run.\n2. Add `DELETE /sessions/current` (logout). It must return **401** for anonymous requests. Otherwise it destroys the caller\'s session and returns **204** with `body: null`. Any role, including `viewer`, may log out. After logout, the same `sid` must get 401 on protected routes.\n\nFollow the existing patterns: a middleware for the auth check, a route module for the route, wired in `createApp`.',
        editable: ['src/middleware/rbac.js', 'src/routes/docs.js', 'src/app.js'],
        tests: [
          {
            path: 'tests/auth.test.js',
            content: `const { createApp } = require('../src/app');
const { SessionStore } = require('../src/auth/sessionStore');

function setup() {
  let now = 1000;
  const clock = { now: () => now };
  const store = new SessionStore();
  const app = createApp({ clock, store, log: [] });
  const call = (method, path, sid, body) =>
    app.router.handle({ method, path, headers: sid ? { cookie: 'sid=' + sid } : {}, body });
  return { ...app, store, call, setNow: (t) => { now = t; } };
}

test('viewer cannot write and handler does not run', async () => {
  const t = setup();
  const vic = t.store.create('vic', ['viewer'], 99999);
  const res = await t.call('PUT', '/docs/d1', vic, { body: 'hacked' });
  expect(res.status).toBe(403);
  expect(t.docs.read('d1').body).toBe('v1');
});

test('editor writes, admin inherits delete', async () => {
  const t = setup();
  const ed = t.store.create('ed', ['editor'], 99999);
  const ada = t.store.create('ada', ['admin'], 99999);
  expect((await t.call('PUT', '/docs/d1', ed, { body: 'v2' })).status).toBe(200);
  expect((await t.call('DELETE', '/docs/d1', ed)).status).toBe(403);
  expect(t.docs.read('d1').body).toBe('v2');
  expect((await t.call('DELETE', '/docs/d1', ada)).status).toBe(204);
});

test('anonymous gets 401', async () => {
  const t = setup();
  expect((await t.call('GET', '/docs/d1')).status).toBe(401);
  expect((await t.call('DELETE', '/sessions/current')).status).toBe(401);
});

test('logout destroys the session', async () => {
  const t = setup();
  const vic = t.store.create('vic', ['viewer'], 99999);
  expect((await t.call('GET', '/docs/d1', vic)).status).toBe(200);
  const res = await t.call('DELETE', '/sessions/current', vic);
  expect(res.status).toBe(204);
  expect(res.body).toBeNull();
  expect(t.store.get(vic)).toBeUndefined();
  expect((await t.call('GET', '/docs/d1', vic)).status).toBe(401);
});

test('logout only affects the caller', async () => {
  const t = setup();
  const a = t.store.create('a', ['viewer'], 99999);
  const b = t.store.create('b', ['viewer'], 99999);
  await t.call('DELETE', '/sessions/current', a);
  expect((await t.call('GET', '/docs/d1', b)).status).toBe(200);
});
`,
          },
        ],
        solution: {
          'src/middleware/rbac.js': `const { permissionsFor } = require('../auth/roles');

function requireLogin() {
  return async (ctx, next) => {
    if (!ctx.state.user) {
      ctx.status = 401;
      ctx.body = { error: 'login required' };
      return;
    }
    await next();
  };
}

function requirePermission(perm) {
  return async (ctx, next) => {
    const user = ctx.state.user;
    if (!user) {
      ctx.status = 401;
      ctx.body = { error: 'login required' };
      return;
    }
    if (!permissionsFor(user.roles).has(perm)) {
      ctx.status = 403;
      ctx.body = { error: 'missing ' + perm };
      return;
    }
    await next();
  };
}

module.exports = { requirePermission, requireLogin };
`,
          'src/app.js': `const config = require('./config');
const { Router } = require('./http/router');
const { requestLog } = require('./middleware/requestLog');
const { session } = require('./middleware/session');
const { requireLogin } = require('./middleware/rbac');
const { docRoutes } = require('./routes/docs');
const { DocService } = require('./services/docService');

function createApp({ clock, store, log }) {
  const docs = new DocService();
  const router = new Router();
  router.use(requestLog(log)).use(session(store, clock, config));
  docRoutes(router, docs);
  router.add('DELETE', '/sessions/current', requireLogin(), async (ctx) => {
    store.destroy(ctx.state.sessionId);
    ctx.status = 204;
    ctx.body = null;
  });
  return { router, docs };
}

module.exports = { createApp };
`,
        },
        hints: [
          'Part 1 is a single statement.',
          'For logout you need "logged in, any role". `requirePermission` checks a permission; consider a sibling `requireLogin()` middleware.',
          'The session middleware already stores `ctx.state.sessionId`, and `createApp` has the `store`.',
        ],
        explanation:
          'Denying in middleware means *not calling `next()`*. For logout, a `requireLogin` middleware mirrors the 401 branch of `requirePermission`, so authentication is still enforced in the stack and not ad hoc in the handler. The handler uses `ctx.state.sessionId`, populated by the session middleware, and the `SessionStore` injected into `createApp`. A `routes/sessions.js` module would be equally valid.',
        timeLimitSec: 720,
        focusFile: 'src/middleware/rbac.js',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 4. Python — search indexing pipeline
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-py-search-indexing',
    title: 'Product Search: Boots Not Found',
    level: 3,
    rating: 1760,
    lang: 'python',
    domain: 'search',
    companies: ['amazon', 'google', 'canva'],
    tags: ['inverted-index', 'analyzers', 'event-driven', 'reindexing', 'tracing'],
    summary: 'Searching "boots" finds nothing and edited products rank on words they no longer contain. Two bugs, three layers.',
    context:
      'You have joined the catalog search team. Two tickets landed on the same day. **SEARCH-101**: searching for `boots` returns nothing, although several products have "boots" in the title. **SEARCH-102**: after a merchant edits a product description, the product keeps ranking for the *old* words and rises in the results every time it is edited.',
    persona: 'helpful-senior',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# catalog-search

Event-driven indexing of catalog documents into an in-memory inverted index.

\`\`\`
DocumentRepository.save/update/delete
      | publishes "doc.saved" / "doc.deleted" on the EventBus
      v
IndexingPipeline  --(published docs only)-->  InvertedIndex
                                                   ^
SearchApi.get_search -> QueryService.search --------+
\`\`\`

## Analysis

Index-time and query-time text **must go through the same analyzer** (\`search/tokenizer.py\`):
\`analyze(text) = [stem(t) for t in tokenize(text)]\`. \`tokenize\` lowercases, splits,
and drops stopwords. \`stem\` strips a few English suffixes.

## Scoring

\`score(doc) = sum over distinct query terms of weighted_tf(term, doc)\`, where each occurrence
counts \`FIELD_WEIGHTS[field]\` (title 3, body 1). Ties are broken by doc id.

## Re-indexing

Saving an existing document must *replace* its postings, not add to them.
`,
      },
      {
        path: 'search/config.py',
        content: `STOPWORDS = {"the", "a", "an", "and", "or", "for", "of", "with", "to", "in"}
MIN_TOKEN_LEN = 2
FIELD_WEIGHTS = {"title": 3, "body": 1}
DEFAULT_LIMIT = 10
MAX_LIMIT = 50
`,
      },
      {
        path: 'search/events.py',
        content: `class EventBus:
    def __init__(self):
        self._subs = {}

    def subscribe(self, topic, handler):
        self._subs.setdefault(topic, []).append(handler)

    def publish(self, topic, payload):
        for handler in self._subs.get(topic, []):
            handler(payload)
`,
      },
      {
        path: 'search/tokenizer.py',
        content: `import re

from search import config

_WORD = re.compile(r"[a-z0-9]+")


def tokenize(text):
    """Lowercase, split on non-alphanumerics, drop stopwords and very short tokens."""
    return [
        t
        for t in _WORD.findall(text.lower())
        if t not in config.STOPWORDS and len(t) >= config.MIN_TOKEN_LEN
    ]


def stem(token):
    """Deliberately tiny stemmer: boots -> boot, hiking -> hik, painted -> paint."""
    for suffix in ("ing", "ed", "s"):
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def analyze(text):
    return [stem(t) for t in tokenize(text)]
`,
      },
      {
        path: 'search/repository.py',
        content: `from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    body: str
    published: bool = True


class DocumentRepository:
    def __init__(self, bus):
        self._docs = {}
        self._bus = bus

    def save(self, doc):
        self._docs[doc.id] = doc
        self._bus.publish("doc.saved", doc)
        return doc

    def update(self, doc_id, **changes):
        doc = replace(self._docs[doc_id], **changes)
        return self.save(doc)

    def delete(self, doc_id):
        if self._docs.pop(doc_id, None) is not None:
            self._bus.publish("doc.deleted", doc_id)

    def get(self, doc_id):
        return self._docs.get(doc_id)
`,
      },
      {
        path: 'search/index.py',
        content: `from search import config
from search.tokenizer import analyze


class InvertedIndex:
    def __init__(self):
        self._postings = {}   # term -> {doc_id: weighted term frequency}
        self._doc_terms = {}  # doc_id -> set of terms, so deletes are cheap

    def add_document(self, doc):
        terms = set(self._doc_terms.get(doc.id, set()))
        for field, weight in config.FIELD_WEIGHTS.items():
            for term in analyze(getattr(doc, field)):
                postings = self._postings.setdefault(term, {})
                postings[doc.id] = postings.get(doc.id, 0) + weight
                terms.add(term)
        self._doc_terms[doc.id] = terms

    def remove_document(self, doc_id):
        for term in self._doc_terms.pop(doc_id, set()):
            postings = self._postings.get(term)
            if postings is not None:
                postings.pop(doc_id, None)
                if not postings:
                    del self._postings[term]

    def postings(self, term):
        return self._postings.get(term, {})

    def term_count(self):
        return len(self._postings)
`,
      },
      {
        path: 'search/pipeline.py',
        content: `class IndexingPipeline:
    """Keeps the index in sync with the repository via domain events."""

    def __init__(self, bus, index):
        self._index = index
        self.indexed = 0
        bus.subscribe("doc.saved", self._on_saved)
        bus.subscribe("doc.deleted", self._on_deleted)

    def _on_saved(self, doc):
        if not doc.published:
            # drafts must never be searchable
            self._index.remove_document(doc.id)
            return
        self._index.add_document(doc)
        self.indexed += 1

    def _on_deleted(self, doc_id):
        self._index.remove_document(doc_id)
`,
      },
      {
        path: 'search/query.py',
        content: `from search import config
from search.tokenizer import tokenize


class QueryService:
    def __init__(self, index, repo):
        self._index = index
        self._repo = repo

    def search(self, text, limit=config.DEFAULT_LIMIT, mode="or"):
        terms = list(dict.fromkeys(tokenize(text)))  # distinct, in query order
        if not terms:
            return []
        scores, matched = {}, {}
        for term in terms:
            for doc_id, weight in self._index.postings(term).items():
                scores[doc_id] = scores.get(doc_id, 0) + weight
                matched[doc_id] = matched.get(doc_id, 0) + 1
        if mode == "and":
            scores = {d: s for d, s in scores.items() if matched[d] == len(terms)}
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        return [(self._repo.get(d).title, s) for d, s in ranked[:limit]]
`,
      },
      {
        path: 'search/api.py',
        content: `from search import config


class SearchApi:
    def __init__(self, query_service):
        self._qs = query_service

    def get_search(self, params):
        q = params.get("q", "").strip()
        if not q:
            return 400, {"error": "q is required"}
        mode = params.get("mode", "or")
        if mode not in ("or", "and"):
            return 400, {"error": "mode must be 'or' or 'and'"}
        limit = min(int(params.get("limit", config.DEFAULT_LIMIT)), config.MAX_LIMIT)
        hits = self._qs.search(q, limit=limit, mode=mode)
        return 200, {"hits": [{"title": t, "score": s} for t, s in hits]}
`,
      },
      {
        path: 'search/app.py',
        content: `from search.api import SearchApi
from search.events import EventBus
from search.index import InvertedIndex
from search.pipeline import IndexingPipeline
from search.query import QueryService
from search.repository import DocumentRepository


def build():
    bus = EventBus()
    index = InvertedIndex()
    repo = DocumentRepository(bus)
    IndexingPipeline(bus, index)
    api = SearchApi(QueryService(index, repo))
    return api, repo, index
`,
      },
      {
        path: 'main.py',
        content: `from search.app import build
from search.repository import Document

api, repo, index = build()
repo.save(Document("d1", "Waterproof hiking boots", "Leather boots for muddy trails"))
repo.save(Document("d2", "Trail running shoes", "Light shoes for the trail"))
repo.save(Document("d3", "Rain jacket", "Waterproof jacket with hood", published=False))
repo.update("d2", body="Light shoes for road racing")

for q in ["boots", "trail", "waterproof", "boot trail"]:
    status, body = api.get_search({"q": q})
    print(q, "->", [(h["title"], h["score"]) for h in body["hits"]])
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace an edit',
        prompt:
          'A merchant edits a product: `repo.update("d2", body="...")`. Order the steps that run until the index reflects the change.',
        items: [
          'DocumentRepository.update builds a new frozen Document with dataclasses.replace',
          'DocumentRepository.save stores it and publishes "doc.saved"',
          'EventBus.publish calls each "doc.saved" subscriber',
          'IndexingPipeline._on_saved checks doc.published',
          'InvertedIndex.add_document loops over FIELD_WEIGHTS (title, then body)',
          'analyze() runs tokenize then stem on each field',
          'Each term\'s postings[doc.id] is incremented by the field weight',
        ],
        hints: [
          'Nothing calls the index directly from the repository. Find who subscribed to the event.',
          'Where does `analyze` get called: in the pipeline or in the index?',
        ],
        explanation:
          'The repository knows nothing about search: it only publishes `doc.saved`. `IndexingPipeline` subscribed in its constructor (wired in `app.py`), filters drafts, and delegates to `InvertedIndex.add_document`, which analyzes each weighted field. Note what is missing: nothing removes the document\'s **previous** postings before adding new ones.',
        timeLimitSec: 300,
        focusFile: 'search/repository.py',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Run the reproduction script',
        prompt: 'Predict the output of `main.py`. (`d3` is a draft. `d2`\'s body is edited after it was first indexed.)',
        entry: 'main.py',
        answer:
          "boots -> []\ntrail -> [('Trail running shoes', 7), ('Waterproof hiking boots', 1)]\nwaterproof -> [('Waterproof hiking boots', 3)]\nboot trail -> [('Trail running shoes', 7), ('Waterproof hiking boots', 5)]",
        options: [
          "boots -> [('Waterproof hiking boots', 4)]\ntrail -> [('Trail running shoes', 3), ('Waterproof hiking boots', 1)]\nwaterproof -> [('Waterproof hiking boots', 3)]\nboot trail -> [('Waterproof hiking boots', 5), ('Trail running shoes', 3)]",
          "boots -> []\ntrail -> [('Trail running shoes', 7), ('Waterproof hiking boots', 1)]\nwaterproof -> [('Waterproof hiking boots', 3)]\nboot trail -> [('Trail running shoes', 7), ('Waterproof hiking boots', 5)]",
          "boots -> []\ntrail -> [('Trail running shoes', 4), ('Waterproof hiking boots', 1)]\nwaterproof -> [('Waterproof hiking boots', 3), ('Rain jacket', 1)]\nboot trail -> [('Waterproof hiking boots', 5), ('Trail running shoes', 4)]",
          "boots -> []\ntrail -> [('Trail running shoes', 7), ('Waterproof hiking boots', 1)]\nwaterproof -> [('Waterproof hiking boots', 3)]\nboot trail -> [('Trail running shoes', 7)]",
        ],
        hints: [
          'The index stores stemmed terms (`boot`, `trail`). Which function does the query side use?',
          'After the update, `d2` was added a second time without removing the first postings. What happens to `trail` for d2 (title weight 3, original body weight 1)?',
        ],
        explanation:
          'Index side: d1 has `boot` = 3 (title) + 1 (body) = 4 and `trail` = 1 (from "trails"). Query side uses `tokenize` **without** `stem`, so the query term `boots` never matches the indexed term `boot`, giving `[]` (SEARCH-101). `d2` was indexed once with trail = 3 + 1 = 4. The update re-added the title (+3) and the new body has no "trail", so trail = 7, a stale and inflated score (SEARCH-102). `d3` is a draft and is never indexed. For "boot trail", d1 scores 4 + 1 = 5 and d2 scores 7.',
        timeLimitSec: 480,
        focusFile: 'main.py',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'SEARCH-101 root cause',
        prompt: 'Click the line that causes `boots` to find nothing, and pick the root cause.',
        file: 'search/query.py',
        lines: [2, 11],
        options: [
          'The query side uses `tokenize` while the index side uses `analyze`, so query terms are never stemmed and miss the stemmed index terms',
          '`dict.fromkeys` drops repeated query terms',
          'The stemmer is wrong: `boots` should stay `boots`',
          'Postings are keyed by title instead of doc id',
        ],
        correct: 0,
        hints: ['Compare the import in `query.py` with the one in `index.py`.'],
        explanation:
          'A search system has two analysis paths, index-time and query-time, and they must use the same analyzer. `index.py` uses `analyze` (tokenize + stem), but `query.py` imports and calls `tokenize`. Any inflected query word (`boots`, `trails`, `hiking`) is therefore looked up unstemmed and misses. The README states the contract; the fix is `from search.tokenizer import analyze` and `terms = list(dict.fromkeys(analyze(text)))`.',
        timeLimitSec: 240,
        focusFile: 'search/query.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Review the SEARCH-102 patch',
        prompt: 'A senior engineer\'s assistant proposes this patch for SEARCH-102. Should you accept it?',
        persona: 'helpful-senior',
        request: 'Edited documents keep their old terms and their scores grow on every save. Fix it.',
        aiReply: `Re-indexing should be "replace", not "merge". The index already knows how to remove a document, so reuse that at the top of \`add_document\` and start from an empty term set:

\`\`\`python
    def add_document(self, doc):
        self.remove_document(doc.id)
        terms = set()
        for field, weight in config.FIELD_WEIGHTS.items():
            for term in analyze(getattr(doc, field)):
                postings = self._postings.setdefault(term, {})
                postings[doc.id] = postings.get(doc.id, 0) + weight
                terms.add(term)
        self._doc_terms[doc.id] = terms
\`\`\`

Putting it inside the index (not the pipeline) means any future caller of \`add_document\` gets replace semantics too.`,
        options: [
          'Accept: removing the old postings first makes re-indexing idempotent, and doing it in the index protects every caller',
          'Reject: `remove_document` deletes terms whose postings become empty, so other documents lose those terms too',
          'Reject: the fix belongs only in `IndexingPipeline._on_saved`; changing the index breaks first-time inserts',
          'Reject: it still double counts a word that appears in both title and body',
        ],
        correct: 0,
        hints: [
          'What does `remove_document` do for a doc id it has never seen?',
          'A word in both title and body *should* get 3 + 1. Is that double counting or intended weighting?',
        ],
        explanation:
          'The patch is correct. `remove_document` only pops this doc\'s id from each posting list, and deletes a term only when **no** document remains. For an unseen id, `_doc_terms.pop(id, set())` makes it a no-op, so first inserts are fine. Summing title and body weights for a word that appears in both is the documented scoring. Sometimes the right review is "ship it", and the reasoning about why matters.',
        timeLimitSec: 240,
        focusFile: 'search/index.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Close both tickets',
        prompt:
          'Fix **SEARCH-101** (inflected query words must match) and **SEARCH-102** (re-saving a document must replace its postings, and unpublishing must remove it). Keep the public APIs unchanged.',
        editable: ['search/query.py', 'search/index.py', 'search/pipeline.py'],
        tests: [
          {
            path: 'tests/test_search.py',
            content: `from search.app import build
from search.repository import Document


def hits(api, q, mode="or"):
    status, body = api.get_search({"q": q, "mode": mode})
    assert status == 200
    return [(h["title"], h["score"]) for h in body["hits"]]


def seed():
    api, repo, index = build()
    repo.save(Document("d1", "Waterproof hiking boots", "Leather boots for muddy trails"))
    repo.save(Document("d2", "Trail running shoes", "Light shoes for the trail"))
    return api, repo, index


def test_inflected_query_matches():
    api, repo, _ = seed()
    assert hits(api, "boots") == [("Waterproof hiking boots", 4)]
    assert hits(api, "trails") == [("Trail running shoes", 4), ("Waterproof hiking boots", 1)]


def test_update_replaces_postings():
    api, repo, index = seed()
    before = index.term_count()
    repo.update("d2", body="Light shoes for road racing")
    assert hits(api, "trail") == [("Trail running shoes", 3), ("Waterproof hiking boots", 1)]
    assert hits(api, "racing") == [("Trail running shoes", 1)]
    repo.update("d2", body="Light shoes for road racing")
    assert hits(api, "shoes") == [("Trail running shoes", 4)]
    assert index.term_count() == before + 2  # road, rac


def test_unpublish_and_delete():
    api, repo, index = seed()
    repo.update("d1", published=False)
    assert hits(api, "boots") == []
    repo.delete("d2")
    assert hits(api, "trail") == []
    assert index.term_count() == 0


def test_and_mode():
    api, repo, _ = seed()
    assert hits(api, "leather trails", mode="and") == [("Waterproof hiking boots", 2)]
`,
          },
        ],
        solution: {
          'search/query.py': `from search import config
from search.tokenizer import analyze


class QueryService:
    def __init__(self, index, repo):
        self._index = index
        self._repo = repo

    def search(self, text, limit=config.DEFAULT_LIMIT, mode="or"):
        terms = list(dict.fromkeys(analyze(text)))  # distinct, in query order
        if not terms:
            return []
        scores, matched = {}, {}
        for term in terms:
            for doc_id, weight in self._index.postings(term).items():
                scores[doc_id] = scores.get(doc_id, 0) + weight
                matched[doc_id] = matched.get(doc_id, 0) + 1
        if mode == "and":
            scores = {d: s for d, s in scores.items() if matched[d] == len(terms)}
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
        return [(self._repo.get(d).title, s) for d, s in ranked[:limit]]
`,
          'search/index.py': `from search import config
from search.tokenizer import analyze


class InvertedIndex:
    def __init__(self):
        self._postings = {}   # term -> {doc_id: weighted term frequency}
        self._doc_terms = {}  # doc_id -> set of terms, so deletes are cheap

    def add_document(self, doc):
        self.remove_document(doc.id)
        terms = set()
        for field, weight in config.FIELD_WEIGHTS.items():
            for term in analyze(getattr(doc, field)):
                postings = self._postings.setdefault(term, {})
                postings[doc.id] = postings.get(doc.id, 0) + weight
                terms.add(term)
        self._doc_terms[doc.id] = terms

    def remove_document(self, doc_id):
        for term in self._doc_terms.pop(doc_id, set()):
            postings = self._postings.get(term)
            if postings is not None:
                postings.pop(doc_id, None)
                if not postings:
                    del self._postings[term]

    def postings(self, term):
        return self._postings.get(term, {})

    def term_count(self):
        return len(self._postings)
`,
        },
        hints: [
          'SEARCH-101 is a one-word change in `query.py`.',
          'SEARCH-102: the index already has `remove_document`. When should it run?',
        ],
        explanation:
          'Use the same analyzer on both sides (`analyze`), and make `add_document` remove the document first, then rebuild its term set from scratch. Unpublishing already worked through `_on_saved`\'s draft branch once removal is correct. Replace semantics make indexing **idempotent**: re-delivering the same `doc.saved` event (common with at-least-once buses) no longer inflates scores.',
        timeLimitSec: 600,
        focusFile: 'search/query.py',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 5. TypeScript — CSV import pipeline with validation
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-ts-csv-import-validation',
    title: 'Customer Import: Downgraded by Excel',
    level: 3,
    rating: 1820,
    lang: 'typescript',
    domain: 'data-pipeline',
    companies: ['atlassian', 'canva', 'amazon'],
    tags: ['csv', 'validation', 'crlf', 'normalisation', 'deduplication'],
    summary: 'Imports from Windows silently downgrade every customer to the free plan, and duplicates overwrite real accounts.',
    context:
      'You have joined the growth-tools team that owns bulk customer import. Two escalations came in this week. (1) A large customer uploaded a CSV exported from Excel on Windows, and **every** imported user landed on the `free` plan, although the file says `pro` and `team`. (2) An existing customer\'s name and plan were overwritten by a row that only differed in the email\'s letter case.',
    persona: 'agent-mode',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# customer-import

\`POST /imports/customers\` with \`{ csv: string }\`.

## Pipeline

1. \`parseCsv\` (\`src/csv/parse.ts\`) splits lines and cells (quoted cells may contain commas).
   Blank lines are ignored. **Line numbers are 1-based physical lines of the uploaded file**
   (header = line 1) and are shown to users in the error report, so they must stay accurate.
2. \`mapHeader\` (\`src/import/mapper.ts\`) maps schema fields to column indexes, case-insensitively.
   A missing *required* column aborts the import with 400. Optional columns may be absent.
3. Each row is validated field by field (\`src/import/validators.ts\`). Validators return the
   **normalised** value (emails lower-cased, enums lower-cased, ints parsed).
4. Valid rows are de-duplicated against existing customers by **normalised** email and inserted.
5. After \`maxErrors\` field errors the import stops (\`aborted\`, HTTP 422).
6. \`import.completed\` is emitted; \`AuditLog\` records a summary line.

Files come from Excel, Google Sheets and hand-written scripts, so expect \`\\r\\n\` line endings,
stray spaces in headers, and mixed-case values.
`,
      },
      {
        path: 'src/config.ts',
        content: `export interface ImportConfig {
  /** Stop processing once this many field errors have been collected. */
  maxErrors: number;
  defaultPlan: string;
}

export const importConfig: ImportConfig = {
  maxErrors: 3,
  defaultPlan: 'free',
};
`,
      },
      {
        path: 'src/events.ts',
        content: `type Listener = (payload: any) => void;

export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(event: string, fn: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
  }

  emit(event: string, payload: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }
}
`,
      },
      {
        path: 'src/csv/parse.ts',
        content: `/**
 * Minimal RFC-4180-ish parser: comma separated; double-quoted cells may contain commas
 * and escaped quotes (""). Newlines inside quotes are NOT supported.
 */
export function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface CsvRow {
  /** 1-based physical line in the file (header is line 1). */
  line: number;
  cells: string[];
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const lines = text.split('\\n');
  const header = parseLine(lines[0]);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue; // blank lines, trailing newline
    rows.push({ line: i + 1, cells: parseLine(lines[i]) });
  }
  return { header, rows };
}
`,
      },
      {
        path: 'src/import/schema.ts',
        content: `export type FieldType = 'string' | 'int' | 'email' | 'enum';

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  values?: string[];
  min?: number;
  max?: number;
}

export const customerSchema: FieldSpec[] = [
  { name: 'email', type: 'email', required: true },
  { name: 'name', type: 'string', required: true },
  { name: 'age', type: 'int', required: false, min: 13, max: 120 },
  { name: 'plan', type: 'enum', required: false, values: ['free', 'pro', 'team'] },
];
`,
      },
      {
        path: 'src/import/mapper.ts',
        content: `import { FieldSpec } from './schema';

export class HeaderError extends Error {}

/** Maps schema field name -> column index. Matching is case-insensitive. */
export function mapHeader(header: string[], schema: FieldSpec[]): Map<string, number> {
  const normalized = header.map((h) => h.toLowerCase());
  const columns = new Map<string, number>();
  for (const spec of schema) {
    const idx = normalized.indexOf(spec.name);
    if (idx === -1) {
      if (spec.required) throw new HeaderError('missing required column: ' + spec.name);
      continue; // optional column absent: every row gets the default
    }
    columns.set(spec.name, idx);
  }
  return columns;
}
`,
      },
      {
        path: 'src/import/validators.ts',
        content: `import { FieldSpec } from './schema';

export type Result = { ok: true; value: string | number | undefined } | { ok: false; error: string };

const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i;

export function validateField(spec: FieldSpec, raw: string | undefined): Result {
  const v = (raw ?? '').trim();
  if (v === '') {
    return spec.required ? { ok: false, error: 'required' } : { ok: true, value: undefined };
  }
  switch (spec.type) {
    case 'string':
      return { ok: true, value: v };
    case 'email':
      return EMAIL.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: 'invalid email' };
    case 'int': {
      if (!/^-?\\d+$/.test(v)) return { ok: false, error: 'not an integer' };
      const n = Number(v);
      if (spec.min !== undefined && n < spec.min) return { ok: false, error: 'must be >= ' + spec.min };
      if (spec.max !== undefined && n > spec.max) return { ok: false, error: 'must be <= ' + spec.max };
      return { ok: true, value: n };
    }
    case 'enum': {
      const lower = v.toLowerCase();
      return spec.values!.includes(lower)
        ? { ok: true, value: lower }
        : { ok: false, error: 'must be one of ' + spec.values!.join('|') };
    }
  }
}
`,
      },
      {
        path: 'src/import/repo.ts',
        content: `export interface Customer {
  email: string;
  name: string;
  age?: number;
  plan: string;
}

/** Keyed by normalised (lower-case) email. */
export class CustomerRepo {
  private byEmail = new Map<string, Customer>();

  has(email: string): boolean {
    return this.byEmail.has(email);
  }

  insert(c: Customer): void {
    this.byEmail.set(c.email, c);
  }

  all(): Customer[] {
    return [...this.byEmail.values()];
  }
}
`,
      },
      {
        path: 'src/import/importer.ts',
        content: `import { ImportConfig } from '../config';
import { parseCsv } from '../csv/parse';
import { EventBus } from '../events';
import { mapHeader } from './mapper';
import { CustomerRepo } from './repo';
import { customerSchema } from './schema';
import { validateField } from './validators';

export interface RowError {
  line: number;
  field: string;
  message: string;
}

export interface ImportReport {
  imported: number;
  skipped: number;
  errors: RowError[];
  aborted: boolean;
}

export class CustomerImporter {
  constructor(private repo: CustomerRepo, private bus: EventBus, private cfg: ImportConfig) {}

  run(text: string): ImportReport {
    const { header, rows } = parseCsv(text);
    const columns = mapHeader(header, customerSchema); // may throw HeaderError
    const report: ImportReport = { imported: 0, skipped: 0, errors: [], aborted: false };

    for (const row of rows) {
      if (report.errors.length >= this.cfg.maxErrors) {
        report.aborted = true;
        break;
      }
      const record: Record<string, any> = {};
      const rowErrors: RowError[] = [];
      for (const spec of customerSchema) {
        const idx = columns.get(spec.name);
        const res = validateField(spec, idx === undefined ? undefined : row.cells[idx]);
        if (res.ok) record[spec.name] = res.value;
        else rowErrors.push({ line: row.line, field: spec.name, message: res.error });
      }
      if (rowErrors.length > 0) {
        report.errors.push(...rowErrors);
        report.skipped++;
        continue;
      }
      const email = row.cells[columns.get('email')!].trim();
      if (this.repo.has(email)) {
        report.skipped++;
        continue;
      }
      this.repo.insert({
        email: record.email,
        name: record.name,
        age: record.age,
        plan: record.plan ?? this.cfg.defaultPlan,
      });
      report.imported++;
    }

    this.bus.emit('import.completed', report);
    return report;
  }
}
`,
      },
      {
        path: 'src/import/audit.ts',
        content: `import { EventBus } from '../events';
import { ImportReport } from './importer';

export class AuditLog {
  readonly entries: string[] = [];

  constructor(bus: EventBus) {
    bus.on('import.completed', (r: ImportReport) => {
      this.entries.push('imported=' + r.imported + ' skipped=' + r.skipped + ' aborted=' + r.aborted);
    });
  }
}
`,
      },
      {
        path: 'src/import/controller.ts',
        content: `import { CustomerImporter } from './importer';
import { HeaderError } from './mapper';

export class ImportController {
  constructor(private importer: CustomerImporter) {}

  upload(body: { csv?: unknown }): { status: number; body: unknown } {
    if (typeof body.csv !== 'string' || body.csv.length === 0) {
      return { status: 400, body: { error: 'csv is required' } };
    }
    try {
      const report = this.importer.run(body.csv);
      return { status: report.aborted ? 422 : 200, body: report };
    } catch (e) {
      if (e instanceof HeaderError) return { status: 400, body: { error: e.message } };
      throw e;
    }
  }
}
`,
      },
      {
        path: 'src/main.ts',
        content: `import { importConfig } from './config';
import { EventBus } from './events';
import { AuditLog } from './import/audit';
import { ImportController } from './import/controller';
import { CustomerImporter, ImportReport } from './import/importer';
import { CustomerRepo } from './import/repo';

const repo = new CustomerRepo();
repo.insert({ email: 'ana@shop.io', name: 'Ana', plan: 'team' });
const bus = new EventBus();
const audit = new AuditLog(bus);
const controller = new ImportController(new CustomerImporter(repo, bus, importConfig));

const csv = [
  'Email,Name,Age,Plan',
  'bo@shop.io,Bo,34,pro',
  'Ana@Shop.io,Ana B,,',
  'cy@shop,Cy,abc,gold',
  'dee@shop.io,"Dee, Jr",40,TEAM',
  '',
].join('\\n');

const res = controller.upload({ csv });
const report = res.body as ImportReport;
console.log(res.status);
for (const e of report.errors) console.log('line ' + e.line + ' ' + e.field + ': ' + e.message);
console.log(audit.entries[0]);
for (const c of repo.all()) console.log(c.email + ' ' + c.name + ' ' + c.plan);
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace an upload',
        prompt: 'Order what happens for `controller.upload({ csv })` with a well-formed file.',
        items: [
          'ImportController.upload checks that csv is a non-empty string',
          'CustomerImporter.run calls parseCsv to split header and rows',
          'mapHeader maps schema fields to column indexes',
          'validateField runs for every schema field of a row',
          'The row is de-duplicated with CustomerRepo.has',
          'CustomerRepo.insert stores the normalised record',
          'bus.emit("import.completed") lets AuditLog record a summary',
          'The controller maps report.aborted to 422 or 200',
        ],
        hints: [
          'Start in `controller.ts`. Which method does it delegate to?',
          'The event is emitted once per import, after the loop, not per row.',
        ],
        explanation:
          'Controller (input check, HTTP mapping) → importer (orchestration) → parser → header mapper → per-row validators → repository. The importer never calls the audit log directly: it emits `import.completed` after the loop and `AuditLog` reacts. The status code is chosen last, from `report.aborted`.',
        timeLimitSec: 300,
        focusFile: 'src/import/controller.ts',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict the report',
        prompt: 'Ana already exists as `ana@shop.io` on the `team` plan. What does `src/main.ts` print?',
        entry: 'src/main.ts',
        answer:
          '422\nline 4 email: invalid email\nline 4 age: not an integer\nline 4 plan: must be one of free|pro|team\nimported=2 skipped=1 aborted=true\nana@shop.io Ana B free\nbo@shop.io Bo pro',
        options: [
          '422\nline 4 email: invalid email\nline 4 age: not an integer\nline 4 plan: must be one of free|pro|team\nimported=2 skipped=1 aborted=true\nana@shop.io Ana B free\nbo@shop.io Bo pro',
          '200\nline 4 email: invalid email\nline 4 age: not an integer\nline 4 plan: must be one of free|pro|team\nimported=2 skipped=2 aborted=false\nana@shop.io Ana team\nbo@shop.io Bo pro\ndee@shop.io Dee, Jr team',
          '422\nline 3 email: invalid email\nline 3 age: not an integer\nline 3 plan: must be one of free|pro|team\nimported=1 skipped=2 aborted=true\nana@shop.io Ana team\nbo@shop.io Bo pro',
          '200\nline 4 email: invalid email\nline 4 age: not an integer\nline 4 plan: must be one of free|pro|team\nimported=3 skipped=1 aborted=false\nana@shop.io Ana B free\nbo@shop.io Bo pro\ndee@shop.io Dee, Jr team',
        ],
        hints: [
          '`repo.has` is called with the trimmed raw cell. Is `"Ana@Shop.io"` a key in the map?',
          'The `maxErrors` check happens at the **top** of each iteration and counts field errors, not rows.',
          '`Map.set` on an existing key keeps the key\'s original insertion position.',
        ],
        explanation:
          'Row line 2 (bo) imports. Line 3: the validator lower-cases the email to `ana@shop.io`, but the duplicate check uses the raw `Ana@Shop.io`, which misses. `insert` then **overwrites** Ana with name "Ana B" and the default plan `free`. Line 4 collects 3 field errors (`cy@shop` has no TLD, `abc`, `gold`). At the top of the next iteration `errors.length (3) >= maxErrors (3)`, so the import aborts before Dee, and the controller returns 422. `Map` iteration order is insertion order of *keys*, so Ana (overwritten in place) still comes before Bo.',
        timeLimitSec: 480,
        focusFile: 'src/main.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Why was Ana overwritten?',
        prompt: 'Click the line that lets a differently-cased duplicate overwrite an existing customer.',
        file: 'src/import/importer.ts',
        lines: [48, 49],
        options: [
          'The duplicate check uses the raw cell value, but the repo is keyed by the normalised (lower-cased) email the validator returned',
          '`CustomerRepo.insert` should throw on duplicates',
          'The email regex is case-sensitive',
          '`report.skipped` is incremented twice',
        ],
        correct: 0,
        hints: ['What key does `insert` store under, and what key does `has` look up?'],
        explanation:
          'The validator already produced the canonical value in `record.email`. Re-reading `row.cells[...]` bypasses normalisation, so the lookup key and the storage key differ. Check `this.repo.has(record.email)`. General rule: once a value has been validated and normalised, never go back to the raw input.',
        timeLimitSec: 240,
        focusFile: 'src/import/importer.ts',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'Agent-mode fixes the Windows bug',
        prompt:
          'You asked the agent to fix the Windows/Excel issue (every user ends up on `free`). It edited several files. Review the diff.',
        persona: 'agent-mode',
        request: 'CSV files with \\r\\n line endings import everyone on the free plan. Fix it.',
        aiReply: `Found it: the header's last cell is \`"Plan\\r"\`, so \`mapHeader\` never finds \`plan\` and every row gets the default. I fixed it at the source and tidied a few things while I was there:

\`\`\`diff
--- src/csv/parse.ts
 export function parseCsv(text: string) {
-  const lines = text.split('\\n');
+  const lines = text.split(/\\r?\\n/).filter((l) => l.trim() !== '');
   const header = parseLine(lines[0]);
   const rows: CsvRow[] = [];
   for (let i = 1; i < lines.length; i++) {
-    if (lines[i].trim() === '') continue; // blank lines, trailing newline
     rows.push({ line: i + 1, cells: parseLine(lines[i]) });
   }

--- src/import/mapper.ts
-  const normalized = header.map((h) => h.toLowerCase());
+  const normalized = header.map((h) => h.trim().toLowerCase());
\`\`\`

All existing tests pass. ✅`,
        options: [
          'Accept: both edits are needed and the blank-line filter is just a simplification',
          'Reject: filtering blank lines *before* numbering shifts every reported line number after a blank line, breaking the "physical line" contract users rely on to fix their files',
          'Reject: `/\\r?\\n/` does not match Windows line endings',
          'Reject: trimming headers breaks case-insensitive matching',
        ],
        correct: 1,
        hints: [
          'Take a file whose line 3 is blank and whose line 4 has a bad age. Which line number does the error report now say?',
        ],
        explanation:
          'The CRLF split and the header `trim()` are both good. The "tidy-up" is not: once blank lines are removed from the array, the index `i` no longer corresponds to the physical line, so the error for line 4 is reported as line 3. The README makes line accuracy part of the contract, and no existing test covered blank lines, so "all tests pass" proves nothing. Agent-mode diffs need review of every hunk, especially the ones you did not ask for.',
        timeLimitSec: 300,
        focusFile: 'src/csv/parse.ts',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'fix',
        title: 'Fix both escalations',
        prompt:
          'Make imports correct for files with `\\r\\n` line endings and stray spaces in header names, and make de-duplication use the normalised email (both against existing customers **and** within the same file). Reported line numbers must remain 1-based physical lines.',
        editable: ['src/csv/parse.ts', 'src/import/mapper.ts', 'src/import/importer.ts'],
        tests: [
          {
            path: 'tests/import.test.ts',
            content: `import { importConfig } from '../src/config';
import { EventBus } from '../src/events';
import { CustomerImporter } from '../src/import/importer';
import { CustomerRepo } from '../src/import/repo';

function setup() {
  const repo = new CustomerRepo();
  const importer = new CustomerImporter(repo, new EventBus(), { ...importConfig, maxErrors: 10 });
  return { repo, importer };
}

test('CRLF files keep the plan column', () => {
  const { repo, importer } = setup();
  const r = importer.run('email,name,age,plan\\r\\nbo@x.io,Bo,30,pro\\r\\ncy@x.io,Cy,,TEAM\\r\\n');
  expect(r.imported).toBe(2);
  expect(repo.all().map((c) => c.plan)).toEqual(['pro', 'team']);
});

test('header cells with spaces are matched', () => {
  const { repo, importer } = setup();
  const r = importer.run(' Email , Name ,Plan \\nbo@x.io,Bo,pro\\n');
  expect(r.errors).toEqual([]);
  expect(repo.all()[0].plan).toBe('pro');
});

test('line numbers stay physical with blank lines and CRLF', () => {
  const { importer } = setup();
  const r = importer.run('email,name,age\\r\\nbo@x.io,Bo,30\\r\\n\\r\\ncy@x.io,Cy,abc\\r\\n');
  expect(r.errors).toEqual([{ line: 4, field: 'age', message: 'not an integer' }]);
});

test('case-insensitive duplicate does not overwrite an existing customer', () => {
  const { repo, importer } = setup();
  repo.insert({ email: 'ana@shop.io', name: 'Ana', plan: 'team' });
  const r = importer.run('email,name\\nAna@Shop.io,Imposter\\n');
  expect(r.imported).toBe(0);
  expect(r.skipped).toBe(1);
  expect(repo.all()).toEqual([{ email: 'ana@shop.io', name: 'Ana', plan: 'team' }]);
});

test('duplicates within one file: first row wins', () => {
  const { repo, importer } = setup();
  const r = importer.run('email,name\\nDee@x.io,First\\ndee@X.IO,Second\\n');
  expect(r.imported).toBe(1);
  expect(r.skipped).toBe(1);
  expect(repo.all()[0].name).toBe('First');
});

test('quoted cells with commas still parse', () => {
  const { repo, importer } = setup();
  importer.run('email,name\\r\\nq@x.io,"Quinn, ""Q"" Jr"\\r\\n');
  expect(repo.all()[0].name).toBe('Quinn, "Q" Jr');
});
`,
          },
        ],
        solution: {
          'src/csv/parse.ts': `/**
 * Minimal RFC-4180-ish parser: comma separated; double-quoted cells may contain commas
 * and escaped quotes (""). Newlines inside quotes are NOT supported.
 */
export function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface CsvRow {
  /** 1-based physical line in the file (header is line 1). */
  line: number;
  cells: string[];
}

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const lines = text.split(/\\r?\\n/);
  const header = parseLine(lines[0]);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue; // blank lines, trailing newline
    rows.push({ line: i + 1, cells: parseLine(lines[i]) });
  }
  return { header, rows };
}
`,
          'src/import/mapper.ts': `import { FieldSpec } from './schema';

export class HeaderError extends Error {}

/** Maps schema field name -> column index. Matching is case-insensitive. */
export function mapHeader(header: string[], schema: FieldSpec[]): Map<string, number> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const columns = new Map<string, number>();
  for (const spec of schema) {
    const idx = normalized.indexOf(spec.name);
    if (idx === -1) {
      if (spec.required) throw new HeaderError('missing required column: ' + spec.name);
      continue; // optional column absent: every row gets the default
    }
    columns.set(spec.name, idx);
  }
  return columns;
}
`,
          'src/import/importer.ts': `import { ImportConfig } from '../config';
import { parseCsv } from '../csv/parse';
import { EventBus } from '../events';
import { mapHeader } from './mapper';
import { CustomerRepo } from './repo';
import { customerSchema } from './schema';
import { validateField } from './validators';

export interface RowError {
  line: number;
  field: string;
  message: string;
}

export interface ImportReport {
  imported: number;
  skipped: number;
  errors: RowError[];
  aborted: boolean;
}

export class CustomerImporter {
  constructor(private repo: CustomerRepo, private bus: EventBus, private cfg: ImportConfig) {}

  run(text: string): ImportReport {
    const { header, rows } = parseCsv(text);
    const columns = mapHeader(header, customerSchema); // may throw HeaderError
    const report: ImportReport = { imported: 0, skipped: 0, errors: [], aborted: false };

    for (const row of rows) {
      if (report.errors.length >= this.cfg.maxErrors) {
        report.aborted = true;
        break;
      }
      const record: Record<string, any> = {};
      const rowErrors: RowError[] = [];
      for (const spec of customerSchema) {
        const idx = columns.get(spec.name);
        const res = validateField(spec, idx === undefined ? undefined : row.cells[idx]);
        if (res.ok) record[spec.name] = res.value;
        else rowErrors.push({ line: row.line, field: spec.name, message: res.error });
      }
      if (rowErrors.length > 0) {
        report.errors.push(...rowErrors);
        report.skipped++;
        continue;
      }
      if (this.repo.has(record.email)) {
        report.skipped++;
        continue;
      }
      this.repo.insert({
        email: record.email,
        name: record.name,
        age: record.age,
        plan: record.plan ?? this.cfg.defaultPlan,
      });
      report.imported++;
    }

    this.bus.emit('import.completed', report);
    return report;
  }
}
`,
        },
        hints: [
          'Where does the `\\r` end up in a CRLF file? Look at the last header cell.',
          'Header cells are never trimmed, but values are (in `validateField`).',
          'De-dup should use the value the validator returned. Rows inserted earlier in the same file are already in the repo.',
        ],
        explanation:
          'Split on `/\\r?\\n/` so no cell carries a trailing `\\r`, and trim header cells in `mapHeader`, since values are already trimmed by the validators. Keep the `continue` for blank lines inside the loop so `i + 1` remains the physical line number. For de-duplication, look up `record.email`, the normalised value. Because each valid row is inserted immediately, within-file duplicates are caught by the same check.',
        timeLimitSec: 720,
        focusFile: 'src/csv/parse.ts',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 6. Java — inventory reservations (no code stage)
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-java-inventory-reservations',
    title: 'Inventory Holds: The Negative Reservation',
    level: 3,
    rating: 1690,
    lang: 'java',
    domain: 'inventory',
    companies: ['amazon', 'apple', 'blackrock'],
    tags: ['state-machine', 'reservations', 'ttl', 'observer', 'invariants'],
    summary: 'Warehouse dashboards show a negative reserved count and the shop oversells lamps. Follow a hold from checkout to expiry.',
    context:
      'You have joined the fulfilment team. During checkout the shop places a **hold** (reservation) on stock for 10 seconds. A background sweeper expires holds that were never confirmed. This morning a dashboard showed `reserved=-2` for a SKU, and the warehouse could not fulfil orders the shop had accepted.',
    persona: 'tunnel-vision',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# inventory-holds

Stock reservations ("holds") for checkout.

## Model

- \`StockLevel\`: \`onHand\` (physically in the warehouse) and \`reserved\` (held by open
  checkouts). \`available = onHand - reserved\`. **Invariant: 0 <= reserved <= onHand.**
- \`Reservation\`: \`PENDING -> CONFIRMED | RELEASED | EXPIRED\`. Only PENDING holds may change
  state. Every transition out of PENDING happens exactly once.

## Flow

| Who | Calls | Effect |
| --- | --- | --- |
| checkout | \`InventoryController.post\` -> \`ReservationService.reserve\` | reserved += qty |
| payment ok | \`confirm\` | reserved -= qty, onHand -= qty |
| user cancels | \`release\` (idempotent) | reserved -= qty |
| sweeper (every few seconds) | \`expireStale\` | reserved -= qty for holds past \`expiresAt\` |

Every stock change is published through \`EventPublisher\` to \`StockListener\`s, such as
\`LowStockAlerter\`. Wiring happens in \`Main\`. The service receives its \`Clock\` by constructor
injection, so tests use \`ManualClock\`.
`,
      },
      {
        path: 'inventory/Clock.java',
        content: `package inventory;

public interface Clock {
    long now();
}
`,
      },
      {
        path: 'inventory/ManualClock.java',
        content: `package inventory;

/** Test clock: time only moves when advance() is called. */
public class ManualClock implements Clock {
    private long t;

    public ManualClock(long start) {
        this.t = start;
    }

    @Override
    public long now() {
        return t;
    }

    public void advance(long ms) {
        t += ms;
    }
}
`,
      },
      {
        path: 'inventory/StockLevel.java',
        content: `package inventory;

public final class StockLevel {
    private int onHand;
    private int reserved;

    public StockLevel(int onHand) {
        this.onHand = onHand;
    }

    public int onHand() { return onHand; }

    public int reserved() { return reserved; }

    public int available() { return onHand - reserved; }

    // package-private: only the service may mutate stock
    void reserve(int qty) { reserved += qty; }

    void release(int qty) { reserved -= qty; }

    void commit(int qty) {
        reserved -= qty;
        onHand -= qty;
    }

    @Override
    public String toString() {
        return "onHand=" + onHand + " reserved=" + reserved + " available=" + available();
    }
}
`,
      },
      {
        path: 'inventory/StockRepository.java',
        content: `package inventory;

import java.util.LinkedHashMap;
import java.util.Map;

public class StockRepository {
    private final Map<String, StockLevel> levels = new LinkedHashMap<>();

    public void put(String sku, int onHand) {
        levels.put(sku, new StockLevel(onHand));
    }

    public StockLevel get(String sku) {
        StockLevel level = levels.get(sku);
        if (level == null) throw new IllegalArgumentException("unknown sku " + sku);
        return level;
    }
}
`,
      },
      {
        path: 'inventory/Reservation.java',
        content: `package inventory;

public final class Reservation {
    public enum Status { PENDING, CONFIRMED, RELEASED, EXPIRED }

    private final String id;
    private final String sku;
    private final int qty;
    private final long expiresAt;
    private Status status = Status.PENDING;

    Reservation(String id, String sku, int qty, long expiresAt) {
        this.id = id;
        this.sku = sku;
        this.qty = qty;
        this.expiresAt = expiresAt;
    }

    public String id() { return id; }
    public String sku() { return sku; }
    public int qty() { return qty; }
    public long expiresAt() { return expiresAt; }
    public Status status() { return status; }

    void setStatus(Status status) { this.status = status; }
}
`,
      },
      {
        path: 'inventory/InsufficientStockException.java',
        content: `package inventory;

public class InsufficientStockException extends RuntimeException {
    public InsufficientStockException(String sku, int wanted, int available) {
        super(sku + ": wanted " + wanted + ", available " + available);
    }
}
`,
      },
      {
        path: 'inventory/EventPublisher.java',
        content: `package inventory;

import java.util.ArrayList;
import java.util.List;

public class EventPublisher {
    public interface StockListener {
        void onChange(String sku, StockLevel level, String reason);
    }

    private final List<StockListener> listeners = new ArrayList<>();

    public void subscribe(StockListener listener) {
        listeners.add(listener);
    }

    public void publish(String sku, StockLevel level, String reason) {
        for (StockListener l : listeners) l.onChange(sku, level, reason);
    }
}
`,
      },
      {
        path: 'inventory/LowStockAlerter.java',
        content: `package inventory;

public class LowStockAlerter implements EventPublisher.StockListener {
    private final int threshold;

    public LowStockAlerter(int threshold) {
        this.threshold = threshold;
    }

    @Override
    public void onChange(String sku, StockLevel level, String reason) {
        if (level.available() < threshold) {
            System.out.println("ALERT " + sku + " available=" + level.available() + " after " + reason);
        }
    }
}
`,
      },
      {
        path: 'inventory/ReservationService.java',
        content: `package inventory;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.NoSuchElementException;

public class ReservationService {
    private final StockRepository stock;
    private final Clock clock;
    private final EventPublisher events;
    private final long ttlMs;
    private final Map<String, Reservation> reservations = new LinkedHashMap<>();
    private int seq = 0;

    public ReservationService(StockRepository stock, Clock clock, EventPublisher events, long ttlMs) {
        this.stock = stock;
        this.clock = clock;
        this.events = events;
        this.ttlMs = ttlMs;
    }

    public Reservation reserve(String sku, int qty) {
        if (qty <= 0) throw new IllegalArgumentException("qty must be positive");
        StockLevel level = stock.get(sku);
        if (level.available() < qty) throw new InsufficientStockException(sku, qty, level.available());
        level.reserve(qty);
        Reservation r = new Reservation("R" + (++seq), sku, qty, clock.now() + ttlMs);
        reservations.put(r.id(), r);
        events.publish(sku, level, "reserved " + r.id());
        return r;
    }

    public void confirm(String id) {
        Reservation r = find(id);
        if (r.status() != Reservation.Status.PENDING) {
            throw new IllegalStateException(id + " is " + r.status());
        }
        StockLevel level = stock.get(r.sku());
        level.commit(r.qty());
        r.setStatus(Reservation.Status.CONFIRMED);
        events.publish(r.sku(), level, "confirmed " + id);
    }

    /** Idempotent: releasing a non-pending hold is a no-op. */
    public void release(String id) {
        Reservation r = find(id);
        if (r.status() != Reservation.Status.PENDING) return;
        StockLevel level = stock.get(r.sku());
        level.release(r.qty());
        r.setStatus(Reservation.Status.RELEASED);
        events.publish(r.sku(), level, "released " + id);
    }

    /** Run by the sweeper every few seconds. Returns how many holds expired. */
    public int expireStale() {
        int expired = 0;
        long now = clock.now();
        for (Reservation r : reservations.values()) {
            if (r.status() == Reservation.Status.PENDING && r.expiresAt() <= now) {
                StockLevel level = stock.get(r.sku());
                level.release(r.qty());
                events.publish(r.sku(), level, "expired " + r.id());
                expired++;
            }
        }
        return expired;
    }

    private Reservation find(String id) {
        Reservation r = reservations.get(id);
        if (r == null) throw new NoSuchElementException(id);
        return r;
    }
}
`,
      },
      {
        path: 'inventory/InventoryController.java',
        content: `package inventory;

import java.util.NoSuchElementException;

/** HTTP adapter. Returns "status body" strings to keep the example framework-free. */
public class InventoryController {
    private final ReservationService service;

    public InventoryController(ReservationService service) {
        this.service = service;
    }

    public String post(String sku, int qty) {
        try {
            return "201 " + service.reserve(sku, qty).id();
        } catch (InsufficientStockException e) {
            return "409 " + e.getMessage();
        } catch (IllegalArgumentException e) {
            return "400 " + e.getMessage();
        }
    }

    public String confirm(String id) {
        try {
            service.confirm(id);
            return "200";
        } catch (NoSuchElementException e) {
            return "404";
        } catch (IllegalStateException e) {
            return "409 " + e.getMessage();
        }
    }
}
`,
      },
      {
        path: 'inventory/Main.java',
        content: `package inventory;

public class Main {
    public static void main(String[] args) {
        StockRepository stock = new StockRepository();
        stock.put("LAMP", 5);
        ManualClock clock = new ManualClock(0);
        EventPublisher events = new EventPublisher();
        events.subscribe(new LowStockAlerter(2));
        ReservationService service = new ReservationService(stock, clock, events, 10_000);
        InventoryController api = new InventoryController(service);

        System.out.println(api.post("LAMP", 3));
        System.out.println(api.post("LAMP", 3));
        clock.advance(10_000);
        System.out.println("expired " + service.expireStale());
        System.out.println(api.post("LAMP", 4));
        clock.advance(5_000);
        System.out.println("expired " + service.expireStale());
        System.out.println(api.confirm("R1"));
        System.out.println(stock.get("LAMP"));
    }
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Map the module',
        prompt: 'Which statements about this codebase are true? Select all that apply.',
        options: [
          'Only `StockLevel` mutates `onHand`/`reserved`, and its mutators are package-private, so they are reachable only from classes in `inventory`',
          '`ReservationService` calls `LowStockAlerter` directly after each change',
          '`InventoryController` turns `InsufficientStockException` into a 409 and an unknown SKU into a 400',
          'The hold TTL is a constructor argument of `ReservationService`, supplied by `Main`',
          'Calling `release` on a CONFIRMED hold throws `IllegalStateException`',
        ],
        correct: [0, 2, 3],
        hints: [
          '`StockRepository.get` throws which exception for an unknown SKU? Which `catch` in the controller handles it?',
          'Read `release` carefully: what does it do for non-PENDING holds?',
        ],
        explanation:
          'The service only knows `EventPublisher`. The alerter was subscribed in `Main` (observer pattern), so (2) is false. An unknown SKU raises `IllegalArgumentException`, which falls into the controller\'s second `catch` and returns 400. `InsufficientStockException` is a plain `RuntimeException`, so it is caught by the first. `release` is documented as idempotent and silently returns for non-PENDING holds; only `confirm` throws.',
        timeLimitSec: 240,
        focusFile: 'inventory/ReservationService.java',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace a successful hold',
        prompt: 'Order the calls for `api.post("LAMP", 4)` when enough stock is available and the alert fires.',
        items: [
          'InventoryController.post',
          'ReservationService.reserve validates qty > 0',
          'StockRepository.get("LAMP")',
          'StockLevel.available() compared with qty',
          'StockLevel.reserve(qty)',
          'new Reservation(id, sku, qty, clock.now() + ttlMs) stored in the map',
          'EventPublisher.publish → LowStockAlerter.onChange prints ALERT',
          'Controller returns "201 R2"',
        ],
        hints: ['The alert is printed **before** the controller returns. Why?'],
        explanation:
          'Publishing is synchronous: `publish` loops over listeners on the caller\'s thread, so the alert line is printed inside `reserve`, before `post` builds its `"201 ..."` string. Expiry is computed from the injected clock at reservation time.',
        timeLimitSec: 300,
        focusFile: 'inventory/InventoryController.java',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Replay the incident',
        prompt: 'Predict the exact output of `inventory/Main.java`.',
        entry: 'inventory/Main.java',
        answer:
          '201 R1\n409 LAMP: wanted 3, available 2\nexpired 1\nALERT LAMP available=1 after reserved R2\n201 R2\nexpired 1\n200\nonHand=2 reserved=-2 available=4',
        options: [
          '201 R1\n409 LAMP: wanted 3, available 2\nexpired 1\nALERT LAMP available=1 after reserved R2\n201 R2\nexpired 0\n409 R1 is EXPIRED\nonHand=5 reserved=4 available=1',
          '201 R1\n409 LAMP: wanted 3, available 2\nexpired 1\nALERT LAMP available=1 after reserved R2\n201 R2\nexpired 1\n200\nonHand=2 reserved=-2 available=4',
          '201 R1\n409 LAMP: wanted 3, available 2\nexpired 1\n201 R2\nALERT LAMP available=1 after reserved R2\nexpired 1\n200\nonHand=2 reserved=-2 available=4',
          '201 R1\n409 LAMP: wanted 3, available 2\nexpired 1\nALERT LAMP available=1 after reserved R2\n201 R2\nexpired 1\n200\nonHand=2 reserved=1 available=1',
        ],
        hints: [
          'After the first sweep, what is R1\'s `status()`?',
          'The second sweep runs at t=15000. Which holds satisfy `PENDING && expiresAt <= now`?',
        ],
        explanation:
          'R1 holds 3 (available 2), and the second request for 3 gets 409. At t=10000 the sweep releases R1 (reserved 0) but **never changes its status**, so R1 stays PENDING. R2 holds 4 (available 1 < 2), so the alert prints inside `reserve`, before `201 R2`. At t=15000 the sweep finds R1 again (still PENDING, expired) and releases another 3: reserved = 4 - 3 = 1. `confirm("R1")` passes the PENDING check and commits 3: reserved = -2, onHand = 2, so available = 4, while only 2 lamps exist and R2 still expects 4. That is the negative reserved count and the oversell.',
        timeLimitSec: 480,
        focusFile: 'inventory/Main.java',
      },
      {
        id: 's4',
        kind: 'find-bug',
        title: 'Root cause',
        prompt: 'Click the line(s) where the state machine is broken, then choose the explanation.',
        file: 'inventory/ReservationService.java',
        lines: [59, 60, 61, 62, 63],
        options: [
          '`expireStale` releases stock but never moves the hold to EXPIRED, so later sweeps release it again and `confirm` still accepts it',
          '`expiresAt() <= now` should be `<`; the off-by-one expires holds one millisecond early',
          '`StockLevel.commit` should not decrement `reserved`',
          'Iterating a `LinkedHashMap` while calling `release` causes a ConcurrentModificationException',
        ],
        correct: 0,
        hints: ['Compare `expireStale` with `release`: which line does `release` have that the sweeper lacks?'],
        explanation:
          '`release` and `confirm` both call `r.setStatus(...)` after mutating stock. `expireStale` forgot `r.setStatus(Reservation.Status.EXPIRED)`, so the PENDING guard never closes: every sweep re-releases the hold, and the hold can still be confirmed. The `<=` boundary is a product decision, not this bug. No structural modification of the map happens during iteration, so there is no CME.',
        timeLimitSec: 240,
        focusFile: 'inventory/ReservationService.java',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'A one-file fix',
        prompt: 'The assistant only had `confirm` open when you asked it for a fix. Should you accept?',
        persona: 'tunnel-vision',
        request: 'Customers can confirm expired holds and we oversell. Fix confirm().',
        aiReply: `The problem is that \`confirm\` doesn't check the TTL. Add a guard:

\`\`\`java
    public void confirm(String id) {
        Reservation r = find(id);
        if (r.status() != Reservation.Status.PENDING || r.expiresAt() <= clock.now()) {
            throw new IllegalStateException(id + " is expired or " + r.status());
        }
        StockLevel level = stock.get(r.sku());
        level.commit(r.qty());
        r.setStatus(Reservation.Status.CONFIRMED);
        events.publish(r.sku(), level, "confirmed " + id);
    }
\`\`\`

Expired holds can no longer be confirmed, so no more oversells.`,
        options: [
          'Accept: expired holds are now rejected, which was the bug',
          'Reject: it blocks the confirm, but `expireStale` still leaves holds PENDING and re-releases them on every sweep, so `reserved` keeps going negative and `available` is still inflated',
          'Reject: `clock` is not accessible inside `ReservationService`',
          'Reject: `IllegalStateException` is not handled by the controller',
        ],
        correct: 1,
        hints: ['Run `Main` in your head with the patch. What does the second `expired` line print, and what is `reserved` at the end?'],
        explanation:
          'The patch treats a symptom in the one method it could see. The root cause is in the sweeper, which is a different caller of the same state machine. With the patch, the second sweep still releases R1 again (reserved 4 → 1), so available reads 4 while 4 units are genuinely held. The fix is to set `EXPIRED` in `expireStale`; then `confirm`\'s existing PENDING guard rejects expired holds without needing any extra check.',
        timeLimitSec: 240,
        focusFile: 'inventory/ReservationService.java',
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // 7. Python — market-data candle aggregation
  // ---------------------------------------------------------------------------
  {
    id: 'l3-a-py-candle-aggregation',
    title: 'Candles: When 99.50 Beats 101.00',
    level: 3,
    rating: 1900,
    lang: 'python',
    domain: 'market-data',
    companies: ['jane-street', 'citadel', 'optiver', 'hrt'],
    tags: ['ohlcv', 'decimal', 'type-contracts', 'event-bus', 'time-bucketing'],
    summary: 'Charting shows highs below lows. Follow raw ticks through the normaliser, aggregator and store.',
    context:
      'You have joined the market-data team at a trading firm. Traders report that 1-minute candles on the internal chart sometimes have a **high below the low**, and a garbage tick from a flaky venue was rendered as a price of `-`. The pipeline is normaliser → aggregator → event bus → candle store, and the team promises "Decimal end to end".',
    persona: 'outdated-docs',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# marketdata-candles

Builds 1-minute OHLCV candles from a time-ordered trade feed.

\`\`\`
raw dict --parse_trade--> Trade --CandleAggregator.on_trade--> open Candle
                                        | bucket rolls over / flush()
                                        v
                            bus "candle.closed" --> CandleStore --> CandleService.candles()
\`\`\`

## Contracts

- **Prices are \`decimal.Decimal\` end to end, never \`float\`.** The wire sends prices as
  strings precisely so that \`Decimal(text)\` is exact.
- \`parse_trade\` is the validation boundary: anything malformed raises \`BadMessage\` and is
  counted as *rejected* by \`CandleService.ingest\`.
- Buckets are half-open \`[start, start + INTERVAL_MS)\` in epoch milliseconds.
- A trade older than the symbol's currently open candle is *late*: it is dropped and counted
  in \`CandleAggregator.late_trades\`. Closed candles are immutable.
`,
      },
      {
        path: 'marketdata/config.py',
        content: `INTERVAL_MS = 60_000
SYMBOLS = {"ACME", "INIT"}
`,
      },
      {
        path: 'marketdata/models.py',
        content: `from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Trade:
    symbol: str
    ts_ms: int
    price: Decimal
    qty: int


@dataclass
class Candle:
    symbol: str
    start_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int = 0
    trades: int = 0

    def label(self):
        return (
            f"{self.symbol} {self.start_ms // 1000}s "
            f"O={self.open} H={self.high} L={self.low} C={self.close} V={self.volume}"
        )
`,
      },
      {
        path: 'marketdata/bus.py',
        content: `class EventBus:
    def __init__(self):
        self._subs = {}

    def subscribe(self, topic, handler):
        self._subs.setdefault(topic, []).append(handler)

    def publish(self, topic, payload):
        for handler in self._subs.get(topic, []):
            handler(payload)
`,
      },
      {
        path: 'marketdata/feed.py',
        content: `from decimal import Decimal, InvalidOperation

from marketdata import config
from marketdata.models import Trade


class BadMessage(ValueError):
    pass


def parse_trade(raw):
    """Wire format: {"s": "ACME", "t": 1700000000123, "p": "101.25", "q": "40"}."""
    try:
        symbol = raw["s"]
        ts = int(raw["t"])
        price = raw["p"].strip()
        qty = int(raw["q"])
    except (KeyError, ValueError, AttributeError) as exc:
        raise BadMessage(str(raw)) from exc
    if symbol not in config.SYMBOLS:
        raise BadMessage("unknown symbol " + symbol)
    if qty <= 0:
        raise BadMessage("non-positive qty")
    return Trade(symbol, ts, price, qty)
`,
      },
      {
        path: 'marketdata/bucketing.py',
        content: `def bucket_start(ts_ms, interval_ms):
    """Start of the half-open interval [start, start + interval) containing ts_ms."""
    return ts_ms - ts_ms % interval_ms
`,
      },
      {
        path: 'marketdata/aggregator.py',
        content: `from marketdata.bucketing import bucket_start
from marketdata.models import Candle


class CandleAggregator:
    """Builds OHLCV candles per symbol from a time-ordered trade stream."""

    def __init__(self, interval_ms, bus):
        self._interval = interval_ms
        self._bus = bus
        self._open = {}  # symbol -> Candle currently being built
        self.late_trades = 0

    def on_trade(self, trade):
        start = bucket_start(trade.ts_ms, self._interval)
        current = self._open.get(trade.symbol)
        if current is not None and start < current.start_ms:
            self.late_trades += 1  # that candle is already closed downstream
            return
        if current is not None and start > current.start_ms:
            self._close(current)
            current = None
        if current is None:
            p = trade.price
            current = Candle(trade.symbol, start, p, p, p, p)
            self._open[trade.symbol] = current
        current.high = max(current.high, trade.price)
        current.low = min(current.low, trade.price)
        current.close = trade.price
        current.volume += trade.qty
        current.trades += 1

    def flush(self):
        """End of session: close every open candle, in symbol order."""
        for symbol in sorted(self._open):
            self._close(self._open[symbol])
        self._open.clear()

    def _close(self, candle):
        self._bus.publish("candle.closed", candle)
`,
      },
      {
        path: 'marketdata/store.py',
        content: `class CandleStore:
    """Closed candles only. Subscribes to the bus; never talks to the aggregator."""

    def __init__(self, bus):
        self._by_symbol = {}
        bus.subscribe("candle.closed", self._on_closed)

    def _on_closed(self, candle):
        self._by_symbol.setdefault(candle.symbol, []).append(candle)

    def range(self, symbol, start_ms, end_ms):
        return [c for c in self._by_symbol.get(symbol, []) if start_ms <= c.start_ms < end_ms]
`,
      },
      {
        path: 'marketdata/service.py',
        content: `from marketdata.feed import BadMessage, parse_trade


class CandleService:
    def __init__(self, aggregator, store):
        self._agg = aggregator
        self._store = store

    def ingest(self, raw_messages):
        accepted = rejected = 0
        for raw in raw_messages:
            try:
                trade = parse_trade(raw)
            except BadMessage:
                rejected += 1
                continue
            self._agg.on_trade(trade)
            accepted += 1
        return accepted, rejected

    def candles(self, symbol, start_ms, end_ms):
        return self._store.range(symbol, start_ms, end_ms)
`,
      },
      {
        path: 'marketdata/app.py',
        content: `from marketdata import config
from marketdata.aggregator import CandleAggregator
from marketdata.bus import EventBus
from marketdata.service import CandleService
from marketdata.store import CandleStore


def build():
    bus = EventBus()
    store = CandleStore(bus)
    aggregator = CandleAggregator(config.INTERVAL_MS, bus)
    return CandleService(aggregator, store), aggregator
`,
      },
      {
        path: 'main.py',
        content: `from marketdata.app import build

service, aggregator = build()
T0 = 1_700_000_040_000  # a minute boundary

msgs = [
    {"s": "ACME", "t": T0 + 1_000, "p": "99.50", "q": "10"},
    {"s": "ACME", "t": T0 + 15_000, "p": "101.00", "q": "5"},
    {"s": "ACME", "t": T0 + 30_000, "p": "100.25", "q": "5"},
    {"s": "INIT", "t": T0 + 31_000, "p": "12.10", "q": "100"},
    {"s": "ACME", "t": T0 + 61_000, "p": "100.75", "q": "20"},
    {"s": "ACME", "t": T0 + 59_000, "p": "98.00", "q": "1"},
    {"s": "ACME", "t": T0 + 62_000, "p": "-", "q": "3"},
    {"s": "XYZ", "t": T0 + 63_000, "p": "1.00", "q": "1"},
]
accepted, rejected = service.ingest(msgs)
aggregator.flush()
print("accepted", accepted, "rejected", rejected, "late", aggregator.late_trades)
for c in service.candles("ACME", T0, T0 + 120_000):
    print(c.label())
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'trace',
        title: 'Trace a bucket rollover',
        prompt:
          'An ACME trade arrives in a **new** minute while the previous ACME candle is still open. Order the steps from `CandleService.ingest` until the trade is reflected in a candle.',
        items: [
          'CandleService.ingest calls parse_trade(raw)',
          'parse_trade validates fields, symbol and qty and returns a Trade',
          'CandleAggregator.on_trade computes bucket_start(ts, INTERVAL_MS)',
          'start > current.start_ms, so _close(current) is called',
          'bus.publish("candle.closed") → CandleStore._on_closed appends the old candle',
          'A new Candle is opened with O=H=L=C = trade price',
          'high/low/close/volume/trades are updated with the trade',
        ],
        hints: [
          'The store is never called by the aggregator directly. What sits between them?',
          'Is the new candle created before or after the old one is closed?',
        ],
        explanation:
          'The service owns error accounting, the feed owns validation, the aggregator owns bucketing and candle state, and the store only reacts to `candle.closed`. The old candle is published **before** the new one is created; then the generic update code runs for the new trade, which is a no-op for O/H/L on a fresh candle but adds volume and the trade count.',
        timeLimitSec: 300,
        focusFile: 'marketdata/aggregator.py',
      },
      {
        id: 's2',
        kind: 'predict',
        title: 'Predict the candles',
        prompt: 'Predict the exact output of `main.py`.',
        entry: 'main.py',
        answer:
          'accepted 7 rejected 1 late 1\nACME 1700000040s O=99.50 H=99.50 L=100.25 C=100.25 V=20\nACME 1700000100s O=100.75 H=100.75 L=- C=- V=23',
        options: [
          'accepted 6 rejected 2 late 1\nACME 1700000040s O=99.50 H=101.00 L=99.50 C=100.25 V=20\nACME 1700000100s O=100.75 H=100.75 L=100.75 C=100.75 V=20',
          'accepted 7 rejected 1 late 1\nACME 1700000040s O=99.50 H=99.50 L=100.25 C=100.25 V=20\nACME 1700000100s O=100.75 H=100.75 L=- C=- V=23',
          'accepted 7 rejected 1 late 0\nACME 1700000040s O=99.50 H=99.50 L=98.00 C=98.00 V=21\nACME 1700000100s O=100.75 H=100.75 L=- C=- V=23',
          'accepted 7 rejected 1 late 1\nACME 1700000040s O=99.50 H=101.00 L=99.50 C=100.25 V=20\nACME 1700000100s O=100.75 H=100.75 L=- C=- V=23',
        ],
        hints: [
          'What type is `trade.price` when it leaves `parse_trade`? Check the return statement, not the dataclass annotation.',
          'Strings compare character by character: is `"99.50" > "101.00"`?',
          'The 98.00 trade at T0+59s arrives after a T0+61s trade has opened the next minute.',
        ],
        explanation:
          '`parse_trade` strips the price but never converts it, so `Trade.price` is a **str**; dataclass annotations are not enforced. `max`/`min` then compare lexicographically: `"99.50" > "101.00"` because `"9" > "1"`, so H=99.50 and L=100.25. The `"-"` tick is not rejected (no `Decimal` conversion, so nothing raises); `"100.75" > "-"` because `"1"` (0x31) > `"-"` (0x2D), so it becomes the low and the close. XYZ is the only rejection. The 98.00 trade belongs to the first minute, which closed when the T0+61s trade rolled the bucket, so it is late. Volumes: 10 + 5 + 5 = 20 and 20 + 3 = 23.',
        timeLimitSec: 540,
        focusFile: 'main.py',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'Find the contract violation',
        prompt: 'Click the line that breaks the "Decimal end to end" contract.',
        file: 'marketdata/feed.py',
        lines: [16],
        options: [
          'The price string is never converted to `Decimal`, so every downstream comparison is a string comparison and malformed prices are not rejected',
          '`int(raw["t"])` truncates the millisecond timestamp',
          '`bucket_start` uses `%` which is wrong for timestamps',
          '`max`/`min` do not work on `Decimal` values',
        ],
        correct: 0,
        hints: ['`Decimal` and `InvalidOperation` are imported in `feed.py`. Are they used?'],
        explanation:
          'The validation boundary must also be the **conversion** boundary. `price = Decimal(raw["p"].strip())`, with `InvalidOperation` added to the caught exceptions, rejects `"-"` and makes `max`/`min` numeric. Python type hints on the dataclass gave a false sense of safety, because they are never checked at runtime. The unused imports are the clue left behind by a careless refactor.',
        timeLimitSec: 240,
        focusFile: 'marketdata/feed.py',
      },
      {
        id: 's4',
        kind: 'review-ai',
        title: 'The assistant quotes the docs',
        prompt: 'The assistant proposes a parsing fix. Should you accept it?',
        persona: 'outdated-docs',
        request: 'parse_trade leaves the price as a string. Convert it properly.',
        aiReply: `According to the decimal docs, constructing \`Decimal\` directly from strings is legacy behaviour; the recommended path is via \`from_float\`:

\`\`\`python
        price = Decimal.from_float(float(raw["p"]))
\`\`\`

\`float()\` also raises \`ValueError\` for garbage like \`"-"\`, which your existing \`except\` already catches, so no other change is needed.`,
        options: [
          'Accept: it converts to Decimal and rejects garbage through the existing ValueError handler',
          'Reject: the price round-trips through binary float, so `"101.10"` becomes `Decimal("101.099999999999994315658...")`. `Decimal(str)` is the exact, recommended constructor',
          'Reject: `from_float` does not exist on `Decimal`',
          'Reject: `float("-")` returns `nan` and would be accepted',
        ],
        correct: 1,
        hints: ['What exact binary value does `float("101.10")` hold, and what does `from_float` preserve?'],
        explanation:
          '`Decimal.from_float` is real, but it faithfully preserves the binary approximation of the float, so most two-decimal prices become 50-digit decimals and candle equality or tick-size checks break. Constructing `Decimal` from a string is exact and is the normal way to parse prices. That is why the wire format sends strings. It is true that `float("-")` raises `ValueError`; the conversion through float is the flaw.',
        timeLimitSec: 240,
        focusFile: 'marketdata/feed.py',
      },
      {
        id: 's5',
        kind: 'code',
        task: 'feature',
        title: 'Fix parsing and add VWAP',
        prompt:
          '1. Make `parse_trade` return `Decimal` prices and reject malformed prices (e.g. `"-"`, `"abc"`) or non-positive prices with `BadMessage`.\n2. Add VWAP to candles: give `Candle` a `notional` field (default `Decimal("0")`) that the aggregator accumulates as `price * qty`, and a `vwap()` method returning `notional / volume` quantized to `Decimal("0.01")` with `ROUND_HALF_UP`.',
        editable: ['marketdata/feed.py', 'marketdata/models.py', 'marketdata/aggregator.py'],
        tests: [
          {
            path: 'tests/test_candles.py',
            content: `from decimal import Decimal

from marketdata.app import build

T0 = 1_700_000_040_000


def run(msgs):
    service, agg = build()
    counts = service.ingest(msgs)
    agg.flush()
    return service, agg, counts


def t(sym, dt, p, q):
    return {"s": sym, "t": T0 + dt, "p": p, "q": q}


def test_high_low_are_numeric():
    service, _, _ = run([t("ACME", 1000, "99.50", "10"), t("ACME", 2000, "101.00", "5"), t("ACME", 3000, "100.25", "5")])
    (c,) = service.candles("ACME", T0, T0 + 60_000)
    assert c.high == Decimal("101.00") and c.low == Decimal("99.50")
    assert isinstance(c.close, Decimal)
    assert c.label().endswith("O=99.50 H=101.00 L=99.50 C=100.25 V=20")


def test_malformed_prices_rejected():
    _, _, counts = run([t("ACME", 1000, "-", "1"), t("ACME", 1000, "abc", "1"), t("ACME", 1000, "0", "1"), t("ACME", 1000, "1.5", "1")])
    assert counts == (1, 3)


def test_vwap():
    service, _, _ = run([t("ACME", 1000, "99.50", "10"), t("ACME", 2000, "101.00", "5"), t("ACME", 3000, "100.25", "5")])
    (c,) = service.candles("ACME", T0, T0 + 60_000)
    assert c.notional == Decimal("2001.25")
    assert c.vwap() == Decimal("100.06")


def test_vwap_rounds_half_up_and_ignores_late_trades():
    service, agg, _ = run([
        t("ACME", 1000, "10.00", "1"),
        t("ACME", 2000, "10.01", "1"),
        t("ACME", 61_000, "20.00", "3"),
        t("ACME", 59_000, "1.00", "100"),
    ])
    first, second = service.candles("ACME", T0, T0 + 120_000)
    assert first.vwap() == Decimal("10.01")
    assert second.vwap() == Decimal("20.00")
    assert agg.late_trades == 1


def test_new_candle_defaults():
    from marketdata.models import Candle
    c = Candle("ACME", 0, Decimal("1"), Decimal("1"), Decimal("1"), Decimal("1"))
    assert c.notional == Decimal("0") and c.volume == 0
`,
          },
        ],
        solution: {
          'marketdata/feed.py': `from decimal import Decimal, InvalidOperation

from marketdata import config
from marketdata.models import Trade


class BadMessage(ValueError):
    pass


def parse_trade(raw):
    """Wire format: {"s": "ACME", "t": 1700000000123, "p": "101.25", "q": "40"}."""
    try:
        symbol = raw["s"]
        ts = int(raw["t"])
        price = Decimal(raw["p"].strip())
        qty = int(raw["q"])
    except (KeyError, ValueError, AttributeError, InvalidOperation) as exc:
        raise BadMessage(str(raw)) from exc
    if symbol not in config.SYMBOLS:
        raise BadMessage("unknown symbol " + symbol)
    if not price.is_finite() or price <= 0:
        raise BadMessage("bad price")
    if qty <= 0:
        raise BadMessage("non-positive qty")
    return Trade(symbol, ts, price, qty)
`,
          'marketdata/models.py': `from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class Trade:
    symbol: str
    ts_ms: int
    price: Decimal
    qty: int


@dataclass
class Candle:
    symbol: str
    start_ms: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int = 0
    trades: int = 0
    notional: Decimal = field(default_factory=lambda: Decimal("0"))

    def vwap(self):
        return (self.notional / self.volume).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def label(self):
        return (
            f"{self.symbol} {self.start_ms // 1000}s "
            f"O={self.open} H={self.high} L={self.low} C={self.close} V={self.volume}"
        )
`,
          'marketdata/aggregator.py': `from marketdata.bucketing import bucket_start
from marketdata.models import Candle


class CandleAggregator:
    """Builds OHLCV candles per symbol from a time-ordered trade stream."""

    def __init__(self, interval_ms, bus):
        self._interval = interval_ms
        self._bus = bus
        self._open = {}  # symbol -> Candle currently being built
        self.late_trades = 0

    def on_trade(self, trade):
        start = bucket_start(trade.ts_ms, self._interval)
        current = self._open.get(trade.symbol)
        if current is not None and start < current.start_ms:
            self.late_trades += 1  # that candle is already closed downstream
            return
        if current is not None and start > current.start_ms:
            self._close(current)
            current = None
        if current is None:
            p = trade.price
            current = Candle(trade.symbol, start, p, p, p, p)
            self._open[trade.symbol] = current
        current.high = max(current.high, trade.price)
        current.low = min(current.low, trade.price)
        current.close = trade.price
        current.volume += trade.qty
        current.notional += trade.price * trade.qty
        current.trades += 1

    def flush(self):
        """End of session: close every open candle, in symbol order."""
        for symbol in sorted(self._open):
            self._close(self._open[symbol])
        self._open.clear()

    def _close(self, candle):
        self._bus.publish("candle.closed", candle)
`,
        },
        hints: [
          '`decimal.InvalidOperation` is **not** a subclass of `ValueError`. Add it to the `except`.',
          'A dataclass field with a default must come after fields without defaults. `Decimal("0")` is immutable, so a plain default is fine too.',
          'Where is `volume` accumulated? Accumulate `notional` right next to it.',
        ],
        explanation:
          'Converting at the boundary restores numeric ordering everywhere downstream without touching the aggregator\'s comparison logic. `Decimal("abc")` raises `InvalidOperation` (an `ArithmeticError`), which must be caught explicitly. Also reject `NaN`, `Infinity` and non-positive prices. VWAP is the sum of price × qty divided by the sum of qty, kept as an exact running `notional` in `Decimal`, and rounding happens only once, at presentation, with an explicit rounding mode. Late trades never reach a candle, so they cannot distort a closed candle\'s VWAP.',
        timeLimitSec: 720,
        focusFile: 'marketdata/feed.py',
      },
    ],
  },
];

export default problems;
