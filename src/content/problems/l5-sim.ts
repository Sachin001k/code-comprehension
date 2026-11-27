import type { Problem } from '../types';

/**
 * L5 full interview simulations (part 1 of the l5-sim series).
 *   1. Google-style: OT collaboration server, caret transform bugs.
 *   2. Meta-style: ads event log aggregator, attribution bug + streaming / heap top-k.
 */
const problems: Problem[] = [
  {
    id: 'l5-sim-google-collab-ot',
    title: 'Simulation: Collaborative Editor (OT)',
    level: 5,
    rating: 2450,
    lang: 'typescript',
    domain: 'collaboration',
    companies: ['google'],
    tags: ['simulation', 'operational-transform', 'distributed-state', 'revisions', 'idempotency', 'presence'],
    summary: 'A server-authoritative OT engine for plain-text docs. Carets jump after big deletes. Orient, trace, reproduce, fix, review, extend, and scale it.',
    context: `**Google-style code comprehension round (60 min, single AI assistant, read-heavy).**

You have just joined the team behind *quill-collab*, the real-time engine for a notes product. It is a classic
server-authoritative operational-transformation (OT) system: one server per document orders every edit, clients
transform their unacknowledged work against whatever the server sends.

Ticket **COLLAB-412**: *"After someone deletes a chunk of text, other people's carets jump to the wrong word, sometimes to the end of the document."*

The round has 7 stages on the same codebase: orient, trace, reproduce, fix, review an assistant's patch, add a feature, and a design follow-up.
Read \`README.md\` first: it states the protocol contracts the code is supposed to honour. The assistant in the side panel only ever looks at the file you have open.`,
    persona: 'tunnel-vision',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# quill-collab

Real-time collaborative plain-text editing for the Quill notes product.
Server-authoritative operational transformation (OT), in the style of
Jupiter / Google Wave: one central server orders every operation, clients
transform their unacknowledged work against whatever the server sends them.

## Layout

\`\`\`
src/ot/          pure OT kernel (no I/O)
  types.ts       Op = insert | delete, Submission envelope
  apply.ts       validate + apply an op to a string
  transform.ts   transform(a, b, aFirst)  -- the TP1 function
  cursor.ts      transformCursor(pos, op, isAuthor)
src/server/
  session.ts     DocumentSession: text, history, presence, ordering
  presence.ts    PresenceTracker: where everyone's caret is
  broadcaster.ts in-process pub/sub fan-out
  hub.ts         CollabHub: routes protocol messages to sessions
src/protocol/
  messages.ts    wire messages + runtime validation
src/client/
  client.ts      CollabClient: inflight/buffer state machine
src/util/        logger, ids
config/collab.json
demo/main.ts     scripted three-user scenario (npm run demo)
tests/           example tests (CI runs more)
\`\`\`

## Revisions

The server keeps \`history\`, an append-only list of applied ops.
\`revision === history.length\`. A client stamps every submission with
\`baseRev\`: the number of server ops it had applied when it produced the op.
The server transforms the op against \`history.slice(baseRev)\` before applying.

## Presence

Clients report their caret as \`{ pos, baseRev }\`. Clients only send presence
when they have **no unacknowledged ops**, so \`pos\` is a position in the
document *as of server revision \`baseRev\`*.

Caret rules when an op is applied:

* insert strictly before the caret pushes it right;
* insert exactly at the caret pushes it right only for the author
  (you type, your caret moves; someone else types at your caret, it stays);
* delete before the caret pulls it left; a caret inside a deleted range
  collapses to the start of the range.

## Tie-breaking

Two inserts at the same position are ordered by client id (lexicographically
smaller id goes first / ends up on the left). The server and every client
must use the same rule or documents diverge.
`,
      },
      {
        path: 'config/collab.json',
        language: 'json',
        content: `{
  "maxDocLength": 1000000,
  "presenceThrottleMs": 50,
  "snapshotEveryNOps": 500,
  "logLevel": "info"
}
`,
      },
      {
        path: 'demo/main.ts',
        content: `import { CollabHub } from '../src/server/hub';
import { insert, del } from '../src/ot/types';

// Scripted repro of ticket COLLAB-412: "carets jump to the wrong place after a big delete".
const docs: Record<string, string> = { 'doc-1': 'Launch plan: ship v2 on Friday' };
const hub = new CollabHub((id) => docs[id]);

for (const who of ['alice', 'bob', 'carol']) hub.handle({ type: 'join', docId: 'doc-1', clientId: who });

// rev 0: everybody is in sync.
hub.handle({ type: 'cursor', docId: 'doc-1', clientId: 'bob', pos: 19, baseRev: 0 });   // between "v" and "2"
hub.handle({ type: 'cursor', docId: 'doc-1', clientId: 'alice', pos: 13, baseRev: 0 }); // before "ship"

// alice deletes "ship v2 " (8 chars at 13) -> rev 1
hub.handle({ type: 'submit', docId: 'doc-1', clientId: 'alice', seq: 1, baseRev: 0, op: del(13, 8) });

// carol has not received rev 1 yet; she clicks just before "Friday" in HER copy (rev 0).
hub.handle({ type: 'cursor', docId: 'doc-1', clientId: 'carol', pos: 24, baseRev: 0 });

// bob, also still at rev 0, types "!" at the very end of his copy (position 30).
hub.handle({ type: 'submit', docId: 'doc-1', clientId: 'bob', seq: 1, baseRev: 0, op: insert(30, '!') });

const s = hub.get('doc-1')!;
console.log(\`rev=\${s.revision} text=\${JSON.stringify(s.content)}\`);
for (const c of s.join('alice').cursors) {
  console.log(\`\${c.clientId}@\${c.pos} -> \${JSON.stringify(s.content.slice(c.pos, c.pos + 3))}\`);
}
`,
      },
      {
        path: 'package.json',
        language: 'json',
        content: `{
  "name": "quill-collab",
  "private": true,
  "version": "0.9.3",
  "scripts": {
    "test": "jest",
    "demo": "ts-node demo/main.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
`,
      },
      {
        path: 'src/client/client.ts',
        content: `import { Op, Submission, HistoryEntry } from '../ot/types';
import { apply } from '../ot/apply';
import { transform, goesFirst } from '../ot/transform';
import { transformCursor } from '../ot/cursor';

export type Send = (sub: Submission) => void;

/**
 * Client-side OT state machine.
 *
 *   inflight: the one op sent to the server and not yet acknowledged
 *   buffer:   local ops made while \`inflight\` is outstanding (not yet sent)
 *
 * Invariant: text === apply(serverText@rev, inflight, ...buffer)
 */
export class CollabClient {
  text: string;
  rev: number;
  caret = 0;
  private seq = 0;
  private inflight: Submission | null = null;
  private buffer: Op[] = [];

  constructor(readonly clientId: string, snapshot: { text: string; rev: number }, private readonly send: Send) {
    this.text = snapshot.text;
    this.rev = snapshot.rev;
  }

  get pending(): number {
    return (this.inflight ? 1 : 0) + this.buffer.length;
  }

  /** The local user edited the document. */
  edit(op: Op): void {
    this.text = apply(this.text, op);
    this.caret = transformCursor(this.caret, op, true);
    if (this.inflight) {
      this.buffer.push(op);
    } else {
      this.flush(op);
    }
  }

  private flush(op: Op): void {
    this.inflight = { clientId: this.clientId, seq: ++this.seq, baseRev: this.rev, op };
    this.send(this.inflight);
  }

  /** The server acknowledged our inflight op at revision \`rev\`. */
  ack(rev: number): void {
    if (!this.inflight) throw new Error('ack with nothing in flight');
    if (rev !== this.rev + 1) throw new Error(\`ack for rev \${rev}, expected \${this.rev + 1}\`);
    this.rev = rev;
    this.inflight = null;
    const next = this.buffer.shift();
    if (next) this.flush(next);
  }

  /** A peer's op arrived from the server. */
  receive(entry: HistoryEntry): void {
    if (entry.rev !== this.rev + 1) throw new Error(\`gap: got rev \${entry.rev}, at \${this.rev}\`);
    let remote = entry.op;
    if (this.inflight) {
      const mine = this.inflight.op;
      this.inflight = { ...this.inflight, op: transform(mine, remote, goesFirst(this.clientId, entry.clientId)) };
      remote = transform(remote, mine, goesFirst(entry.clientId, this.clientId));
    }
    this.buffer = this.buffer.map((mine) => {
      const t = transform(mine, remote, goesFirst(this.clientId, entry.clientId));
      remote = transform(remote, mine, goesFirst(entry.clientId, this.clientId));
      return t;
    });
    this.text = apply(this.text, remote);
    this.caret = transformCursor(this.caret, remote, false);
    this.rev = entry.rev;
  }
}
`,
      },
      {
        path: 'src/ot/apply.ts',
        content: `import { Op } from './types';

export class OpError extends Error {}

export function validate(doc: string, op: Op): void {
  if (!Number.isInteger(op.pos) || op.pos < 0 || op.pos > doc.length) {
    throw new OpError(\`position \${op.pos} out of range for length \${doc.length}\`);
  }
  if (op.type === 'delete') {
    if (!Number.isInteger(op.len) || op.len < 0 || op.pos + op.len > doc.length) {
      throw new OpError(\`delete [\${op.pos}, \${op.pos + op.len}) out of range for length \${doc.length}\`);
    }
  }
}

export function apply(doc: string, op: Op): string {
  validate(doc, op);
  if (op.type === 'insert') return doc.slice(0, op.pos) + op.text + doc.slice(op.pos);
  return doc.slice(0, op.pos) + doc.slice(op.pos + op.len);
}

/** Empty inserts / zero-length deletes are legal and change nothing. */
export function isNoop(op: Op): boolean {
  return op.type === 'insert' ? op.text.length === 0 : op.len === 0;
}

export function describe(op: Op): string {
  return op.type === 'insert'
    ? \`ins@\${op.pos}(\${JSON.stringify(op.text)})\`
    : \`del@\${op.pos}+\${op.len}\`;
}
`,
      },
      {
        path: 'src/ot/cursor.ts',
        content: `import { Op } from './types';

/**
 * Move a caret position across an applied op.
 *
 * @param pos       caret position in the document BEFORE \`op\`
 * @param op        the op being applied
 * @param isAuthor  true if the caret belongs to the user who made \`op\`
 */
export function transformCursor(pos: number, op: Op, isAuthor: boolean): number {
  if (op.type === 'insert') {
    if (op.pos < pos || (op.pos === pos && isAuthor)) return pos + op.text.length;
    return pos;
  }
  if (pos > op.pos) {
    // never let a caret go negative
    return Math.max(pos - op.len, 0);
  }
  return pos;
}

export function clampCursor(pos: number, docLength: number): number {
  if (!Number.isFinite(pos)) return docLength;
  return Math.min(Math.max(0, Math.trunc(pos)), docLength);
}
`,
      },
      {
        path: 'src/ot/transform.ts',
        content: `import { ClientId, Op } from './types';

/**
 * TP1 transform.
 *
 * Given two ops \`a\` and \`b\` that were produced concurrently against the SAME
 * document, returns a' such that
 *
 *     apply(apply(doc, b), transform(a, b, aFirst))
 *       === apply(apply(doc, a), transform(b, a, !aFirst))
 *
 * \`aFirst\` only matters when both ops insert at the same position: the op that
 * goes first ends up on the left.
 *
 * Policy for an insert that lands strictly inside a concurrently deleted range:
 * "delete wins" -- the insert becomes a no-op and the delete grows to swallow
 * the inserted text. Both orders converge on a document without that text.
 */
export function transform(a: Op, b: Op, aFirst: boolean): Op {
  if (a.type === 'insert' && b.type === 'insert') {
    if (a.pos < b.pos || (a.pos === b.pos && aFirst)) return a;
    return { ...a, pos: a.pos + b.text.length };
  }

  if (a.type === 'insert' && b.type === 'delete') {
    if (a.pos <= b.pos) return a;
    if (a.pos >= b.pos + b.len) return { ...a, pos: a.pos - b.len };
    return { type: 'insert', pos: b.pos, text: '' };
  }

  if (a.type === 'delete' && b.type === 'insert') {
    if (b.pos <= a.pos) return { ...a, pos: a.pos + b.text.length };
    if (b.pos >= a.pos + a.len) return a;
    return { ...a, len: a.len + b.text.length };
  }

  // delete vs delete
  const da = a as Extract<Op, { type: 'delete' }>;
  const db = b as Extract<Op, { type: 'delete' }>;
  const aEnd = da.pos + da.len;
  const bEnd = db.pos + db.len;
  if (aEnd <= db.pos) return da;
  if (da.pos >= bEnd) return { ...da, pos: da.pos - db.len };
  // Overlap: only delete what b has not already deleted. The surviving part
  // of a always starts at min(a.pos, b.pos) in b's output document.
  const overlap = Math.min(aEnd, bEnd) - Math.max(da.pos, db.pos);
  return { type: 'delete', pos: Math.min(da.pos, db.pos), len: da.len - overlap };
}

/** Shared tie-break rule. Server and clients MUST agree on it. */
export function goesFirst(a: ClientId, b: ClientId): boolean {
  return a < b;
}

/** Transform \`op\` (by \`author\`) through a list of ops that were applied after its base. */
export function transformThrough(
  op: Op,
  author: ClientId,
  applied: readonly { op: Op; clientId: ClientId }[],
): Op {
  let out = op;
  for (const h of applied) out = transform(out, h.op, goesFirst(author, h.clientId));
  return out;
}
`,
      },
      {
        path: 'src/ot/types.ts',
        content: `export type ClientId = string;

export interface InsertOp {
  type: 'insert';
  pos: number;
  text: string;
}

export interface DeleteOp {
  type: 'delete';
  pos: number;
  len: number;
}

export type Op = InsertOp | DeleteOp;

/** An op as it travels from a client to the server. */
export interface Submission {
  clientId: ClientId;
  /** Per-client sequence number. The first op a client sends has seq 1. */
  seq: number;
  /** Number of server ops the client had applied when it created \`op\`. */
  baseRev: number;
  op: Op;
}

/** An op the server has applied, as stored in history and broadcast to peers. */
export interface HistoryEntry {
  /** Revision AFTER this op was applied (first op => rev 1). */
  rev: number;
  clientId: ClientId;
  seq: number;
  op: Op;
}

export interface Ack {
  rev: number;
  /** The op as actually applied (after server-side transformation). */
  op: Op;
  duplicate?: boolean;
}

export const insert = (pos: number, text: string): InsertOp => ({ type: 'insert', pos, text });
export const del = (pos: number, len: number): DeleteOp => ({ type: 'delete', pos, len });
`,
      },
      {
        path: 'src/protocol/messages.ts',
        content: `import { Op, Submission, HistoryEntry } from '../ot/types';
import { CursorView } from '../server/presence';

// ---- client -> server ----

export interface JoinMsg {
  type: 'join';
  docId: string;
  clientId: string;
}

export interface SubmitMsg extends Submission {
  type: 'submit';
  docId: string;
}

export interface CursorMsg {
  type: 'cursor';
  docId: string;
  clientId: string;
  pos: number;
  /** Server revision the position refers to. Only sent with no ops in flight. */
  baseRev: number;
}

export type ClientMsg = JoinMsg | SubmitMsg | CursorMsg;

// ---- server -> client ----

export interface SnapshotMsg {
  type: 'snapshot';
  rev: number;
  text: string;
  cursors: CursorView[];
}

export interface OpMsg extends HistoryEntry {
  type: 'op';
}

export interface AckMsg {
  type: 'ack';
  rev: number;
  seq: number;
  duplicate?: boolean;
}

export interface PresenceMsg {
  type: 'presence';
  cursors: CursorView[];
}

export interface ErrorMsg {
  type: 'error';
  code: 'bad-request' | 'conflict' | 'not-found';
  message: string;
}

export type ServerMsg = SnapshotMsg | OpMsg | AckMsg | PresenceMsg | ErrorMsg;

export class ProtocolError extends Error {
  constructor(public code: ErrorMsg['code'], message: string) {
    super(message);
  }
}

function isOp(x: any): x is Op {
  if (!x || typeof x !== 'object' || !Number.isInteger(x.pos)) return false;
  if (x.type === 'insert') return typeof x.text === 'string';
  if (x.type === 'delete') return Number.isInteger(x.len);
  return false;
}

export function parseClientMsg(raw: unknown): ClientMsg {
  const m = raw as any;
  if (!m || typeof m.docId !== 'string' || typeof m.clientId !== 'string') {
    throw new ProtocolError('bad-request', 'docId and clientId required');
  }
  switch (m.type) {
    case 'join':
      return { type: 'join', docId: m.docId, clientId: m.clientId };
    case 'submit':
      if (!Number.isInteger(m.seq) || m.seq < 1) throw new ProtocolError('bad-request', 'seq must be >= 1');
      if (!Number.isInteger(m.baseRev) || m.baseRev < 0) throw new ProtocolError('bad-request', 'bad baseRev');
      if (!isOp(m.op)) throw new ProtocolError('bad-request', 'bad op');
      return { type: 'submit', docId: m.docId, clientId: m.clientId, seq: m.seq, baseRev: m.baseRev, op: m.op };
    case 'cursor':
      if (!Number.isInteger(m.pos) || !Number.isInteger(m.baseRev)) {
        throw new ProtocolError('bad-request', 'bad cursor');
      }
      return { type: 'cursor', docId: m.docId, clientId: m.clientId, pos: m.pos, baseRev: m.baseRev };
    default:
      throw new ProtocolError('bad-request', \`unknown type \${m.type}\`);
  }
}
`,
      },
      {
        path: 'src/server/broadcaster.ts',
        content: `export type Listener<M> = (msg: M) => void;

interface Sub<M> {
  clientId: string;
  fn: Listener<M>;
}

/**
 * In-process fan-out. In production this sits behind the websocket gateway;
 * here it is synchronous so tests are deterministic.
 */
export class Broadcaster<M> {
  private topics = new Map<string, Set<Sub<M>>>();
  public delivered = 0;

  subscribe(topic: string, clientId: string, fn: Listener<M>): () => void {
    let subs = this.topics.get(topic);
    if (!subs) {
      subs = new Set();
      this.topics.set(topic, subs);
    }
    const sub = { clientId, fn };
    subs.add(sub);
    return () => {
      subs!.delete(sub);
    };
  }

  /** Deliver to every subscriber of \`topic\` except \`exceptClientId\`. */
  publish(topic: string, msg: M, exceptClientId?: string): void {
    const subs = this.topics.get(topic);
    if (!subs) return;
    // Copy first: a listener may unsubscribe (or subscribe someone) while we iterate.
    for (const sub of [...subs]) {
      if (sub.clientId === exceptClientId) continue;
      this.delivered++;
      sub.fn(msg);
    }
  }

  subscriberCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0;
  }
}
`,
      },
      {
        path: 'src/server/hub.ts',
        content: `import config from '../../config/collab.json';
import { DocumentSession } from './session';
import { Broadcaster, Listener } from './broadcaster';
import { ClientMsg, ServerMsg, ProtocolError, parseClientMsg } from '../protocol/messages';
import { Logger, nullLogger } from '../util/logger';

/**
 * Routes protocol messages to the right DocumentSession and turns results into
 * server messages. One hub per server process.
 */
export class CollabHub {
  readonly bus = new Broadcaster<ServerMsg>();
  private sessions = new Map<string, DocumentSession>();

  constructor(
    private readonly loadDoc: (docId: string) => string | undefined,
    private readonly log: Logger = nullLogger,
  ) {}

  private session(docId: string): DocumentSession {
    let s = this.sessions.get(docId);
    if (!s) {
      const text = this.loadDoc(docId);
      if (text === undefined) throw new ProtocolError('not-found', \`no document \${docId}\`);
      s = new DocumentSession(docId, text, this.bus, { maxDocLength: config.maxDocLength }, this.log);
      this.sessions.set(docId, s);
    }
    return s;
  }

  connect(docId: string, clientId: string, onMessage: Listener<ServerMsg>): () => void {
    const unsubscribe = this.bus.subscribe(docId, clientId, onMessage);
    return () => {
      unsubscribe();
      this.sessions.get(docId)?.leave(clientId);
    };
  }

  /** Handle one raw message from \`clientId\`. Returns the direct reply. */
  handle(raw: unknown): ServerMsg {
    let msg: ClientMsg;
    try {
      msg = parseClientMsg(raw);
    } catch (e) {
      return toError(e);
    }
    try {
      const s = this.session(msg.docId);
      switch (msg.type) {
        case 'join': {
          const snap = s.join(msg.clientId);
          return { type: 'snapshot', rev: snap.rev, text: snap.text, cursors: snap.cursors };
        }
        case 'submit': {
          const ack = s.submit(msg);
          return { type: 'ack', rev: ack.rev, seq: msg.seq, duplicate: ack.duplicate };
        }
        case 'cursor': {
          s.moveCursor(msg.clientId, msg.pos, msg.baseRev);
          return { type: 'presence', cursors: s.join(msg.clientId).cursors };
        }
      }
    } catch (e) {
      return toError(e);
    }
  }

  get(docId: string): DocumentSession | undefined {
    return this.sessions.get(docId);
  }
}

function toError(e: unknown): ServerMsg {
  if (e instanceof ProtocolError) return { type: 'error', code: e.code, message: e.message };
  throw e;
}
`,
      },
      {
        path: 'src/server/presence.ts',
        content: `import { ClientId, Op } from '../ot/types';
import { transformCursor } from '../ot/cursor';

export interface CursorView {
  clientId: ClientId;
  pos: number;
  color: string;
}

const PALETTE = ['#e8710a', '#1a73e8', '#188038', '#d93025', '#9334e6', '#f9ab00'];

/**
 * Where everybody's caret is, in CURRENT document coordinates.
 * The session is responsible for handing us positions that are already in
 * current coordinates; after that we keep them up to date via onOp().
 */
export class PresenceTracker {
  private carets = new Map<ClientId, number>();
  private colors = new Map<ClientId, string>();

  join(clientId: ClientId): void {
    if (!this.colors.has(clientId)) {
      this.colors.set(clientId, PALETTE[this.colors.size % PALETTE.length]);
    }
    if (!this.carets.has(clientId)) this.carets.set(clientId, 0);
  }

  leave(clientId: ClientId): void {
    this.carets.delete(clientId);
    // keep the colour so a reconnecting user gets the same one back
  }

  set(clientId: ClientId, pos: number): void {
    this.join(clientId);
    this.carets.set(clientId, pos);
  }

  get(clientId: ClientId): number | undefined {
    return this.carets.get(clientId);
  }

  /** Called by the session after every applied op. */
  onOp(op: Op, author: ClientId): void {
    for (const [id, pos] of this.carets) {
      this.carets.set(id, transformCursor(pos, op, id === author));
    }
  }

  snapshot(): CursorView[] {
    return [...this.carets]
      .map(([clientId, pos]) => ({ clientId, pos, color: this.colors.get(clientId)! }))
      .sort((a, b) => (a.clientId < b.clientId ? -1 : 1));
  }
}
`,
      },
      {
        path: 'src/server/session.ts',
        content: `import { Ack, ClientId, HistoryEntry, Submission } from '../ot/types';
import { apply, OpError } from '../ot/apply';
import { transformThrough } from '../ot/transform';
import { clampCursor } from '../ot/cursor';
import { PresenceTracker, CursorView } from './presence';
import { Broadcaster } from './broadcaster';
import { ServerMsg, ProtocolError } from '../protocol/messages';
import { Logger, nullLogger } from '../util/logger';

export interface SessionOptions {
  maxDocLength: number;
}

/**
 * One live document. Single-threaded: every call runs to completion before the
 * next message is processed, so the history order IS the global order.
 */
export class DocumentSession {
  private text: string;
  private readonly history: HistoryEntry[] = [];
  private readonly presence = new PresenceTracker();

  constructor(
    readonly docId: string,
    initialText: string,
    private readonly bus: Broadcaster<ServerMsg>,
    private readonly opts: SessionOptions,
    private readonly log: Logger = nullLogger,
  ) {
    this.text = initialText;
  }

  get revision(): number {
    return this.history.length;
  }

  get content(): string {
    return this.text;
  }

  join(clientId: ClientId): { rev: number; text: string; cursors: CursorView[] } {
    this.presence.join(clientId);
    return { rev: this.revision, text: this.text, cursors: this.presence.snapshot() };
  }

  leave(clientId: ClientId): void {
    this.presence.leave(clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
  }

  submit(sub: Submission): Ack {
    if (sub.baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${sub.baseRev} is ahead of server rev \${this.revision}\`);
    }
    const concurrent = this.history.slice(sub.baseRev);
    const op = transformThrough(sub.op, sub.clientId, concurrent);

    let next: string;
    try {
      next = apply(this.text, op);
    } catch (e) {
      if (e instanceof OpError) throw new ProtocolError('bad-request', e.message);
      throw e;
    }
    if (next.length > this.opts.maxDocLength) {
      throw new ProtocolError('bad-request', 'document too large');
    }

    this.text = next;
    const entry: HistoryEntry = { rev: this.revision + 1, clientId: sub.clientId, seq: sub.seq, op };
    this.history.push(entry);
    this.presence.onOp(op, sub.clientId);
    this.log.debug('applied', { docId: this.docId, rev: entry.rev, by: sub.clientId });

    this.bus.publish(this.docId, { type: 'op', ...entry }, sub.clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
    return { rev: entry.rev, op };
  }

  /** \`pos\` is a caret position in the document as of server revision \`baseRev\`. */
  moveCursor(clientId: ClientId, pos: number, baseRev: number): number {
    if (baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${baseRev} is ahead of server rev \${this.revision}\`);
    }
    const current = clampCursor(pos, this.text.length);
    this.presence.set(clientId, current);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() }, clientId);
    return current;
  }

  cursorOf(clientId: ClientId): number | undefined {
    return this.presence.get(clientId);
  }

  opsSince(rev: number): HistoryEntry[] {
    return this.history.slice(rev);
  }
}
`,
      },
      {
        path: 'src/util/ids.ts',
        content: `/**
 * Client ids are compared lexicographically for OT tie-breaking, so they must
 * be fixed-width: "c10" < "c9" would otherwise surprise people.
 */
export function clientIdFor(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) throw new RangeError('client number out of range');
  return 'c' + n.toString(16).padStart(6, '0');
}

export function isClientId(s: string): boolean {
  return /^[a-z][a-z0-9-]{0,31}$/.test(s);
}
`,
      },
      {
        path: 'src/util/logger.ts',
        content: `export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
};

export function consoleLogger(prefix: string, minLevel: 'debug' | 'info' | 'warn' = 'info'): Logger {
  const order = { debug: 0, info: 1, warn: 2 };
  const emit = (lvl: keyof typeof order) => (msg: string, fields?: Record<string, unknown>) => {
    if (order[lvl] < order[minLevel]) return;
    console.log(\`[\${prefix}] \${lvl} \${msg}\${fields ? ' ' + JSON.stringify(fields) : ''}\`);
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn') };
}
`,
      },
      {
        path: 'tests/session.test.ts',
        content: `import { CollabHub } from '../src/server/hub';
import { CollabClient } from '../src/client/client';
import { Submission, insert, del } from '../src/ot/types';
import { ServerMsg } from '../src/protocol/messages';

function setup(text: string) {
  const hub = new CollabHub((id) => (id === 'd' ? text : undefined));
  const outbox: Submission[] = [];
  const mk = (id: string) => {
    const snap = hub.handle({ type: 'join', docId: 'd', clientId: id }) as Extract<ServerMsg, { type: 'snapshot' }>;
    const c = new CollabClient(id, snap, (s) => outbox.push(s));
    const inbox: ServerMsg[] = [];
    hub.connect('d', id, (m) => inbox.push(m));
    return { c, inbox };
  };
  return { hub, outbox, mk };
}

test('two clients converge through the server', () => {
  const { hub, outbox, mk } = setup('hello');
  const a = mk('a');
  const b = mk('b');
  a.c.edit(insert(5, ' world'));
  b.c.edit(del(0, 1));
  // deliver both submissions in the order they were sent; replies share the
  // per-client channel with broadcasts, so they go into the same inbox.
  for (const sub of outbox.splice(0)) {
    const owner = sub.clientId === 'a' ? a : b;
    owner.inbox.push(hub.handle({ type: 'submit', docId: 'd', ...sub }));
  }
  for (const x of [a, b]) {
    for (const m of x.inbox.splice(0)) {
      if (m.type === 'op') x.c.receive(m);
      if (m.type === 'ack') x.c.ack(m.rev);
    }
  }
  expect(hub.get('d')!.content).toBe('ello world');
  expect(a.c.text).toBe('ello world');
  expect(b.c.text).toBe('ello world');
});

test('a submission ahead of the server is rejected', () => {
  const { hub } = setup('x');
  const r = hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 3, op: insert(0, 'y') });
  expect(r.type).toBe('error');
});
`,
      },
      {
        path: 'tests/transform.test.ts',
        content: `import { apply } from '../src/ot/apply';
import { transform } from '../src/ot/transform';
import { Op, insert, del } from '../src/ot/types';

// Tiny deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomOp(doc: string, r: () => number): Op {
  if (doc.length === 0 || r() < 0.5) {
    const pos = Math.floor(r() * (doc.length + 1));
    return insert(pos, 'xyz'.slice(0, 1 + Math.floor(r() * 3)));
  }
  const pos = Math.floor(r() * doc.length);
  const len = 1 + Math.floor(r() * Math.min(4, doc.length - pos));
  return del(pos, len);
}

test('TP1: both orders converge (2000 random pairs)', () => {
  const r = rng(42);
  for (let i = 0; i < 2000; i++) {
    const doc = 'abcdefghij'.slice(0, Math.floor(r() * 11));
    const a = randomOp(doc, r);
    const b = randomOp(doc, r);
    const left = apply(apply(doc, a), transform(b, a, false));
    const right = apply(apply(doc, b), transform(a, b, true));
    expect(left).toBe(right);
  }
});

test('same-position inserts are ordered by the tie-break', () => {
  const a = insert(1, 'A');
  const b = insert(1, 'B');
  expect(apply(apply('xy', a), transform(b, a, false))).toBe('xABy');
});

test('insert inside a concurrently deleted range is dropped', () => {
  const d = del(1, 3); // removes "bcd"
  const i = insert(2, 'Z');
  expect(apply(apply('abcde', d), transform(i, d, true))).toBe('ae');
  expect(apply(apply('abcde', i), transform(d, i, false))).toBe('ae');
});
`,
      },
      {
        path: 'tsconfig.json',
        language: 'json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src", "demo", "tests"]
}
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: what does baseRev buy you?',
        prompt: `The server's \`revision\` is **7**. It receives \`{ clientId: 'bob', seq: 4, baseRev: 3, op: insert(10, 'x') }\`.

Which statements are true for this codebase? **Select all that apply.**`,
        options: [
          'The server transforms bob\'s op against the history entries that produced revisions 4..7 (`history.slice(3)`) before applying it.',
          'The server rejects the op with a `conflict` error because bob is 4 revisions behind.',
          'None of the ops in `history.slice(3)` can be bob\'s own: a client only sends its next op after the previous one is acked, and it then stamps `baseRev` with a revision that already includes that op.',
          'If one of those concurrent ops is `insert(10, \'y\')` by `alice`, every replica ends up with `y` to the left of `x`.',
          'Presence carets are stored in revision-`baseRev` coordinates and converted to current coordinates lazily when `snapshot()` is called.',
          'Because `Broadcaster.publish` is synchronous, peers can receive revision 9 before revision 8.',
        ],
        correct: [0, 2, 3],
        hints: [
          'Read `DocumentSession.submit`: when does it throw, and what does it slice?',
          'Look at `CollabClient.flush` and `ack`: when is `baseRev` stamped, relative to the previous ack?',
          '`goesFirst(a, b)` is `a < b`, and the op that goes first ends up on the left.',
        ],
        explanation: `**True:**
- \`submit\` only rejects ops whose \`baseRev\` is *ahead* of the server. Being behind is the normal case: it transforms through \`history.slice(baseRev)\`, i.e. the ops for revisions 4, 5, 6, 7.
- The client keeps at most one op in flight; the buffer is only flushed from \`ack()\`, after \`this.rev\` has been advanced past the acked op. So a client's own ops are never in its concurrent window. (This invariant is exactly what makes the "transform against the history suffix" approach correct.)
- Tie-break: on the server, bob's op is transformed against alice's with \`goesFirst('bob', 'alice') === false\`, so bob's insert is shifted right and alice's \`y\` stays left. Clients apply the same rule, so all replicas agree.

**False:**
- Presence carets are stored in *current* coordinates. \`PresenceTracker\`'s own doc comment says the session must hand it positions that are already current; whether the session actually does that is what COLLAB-412 is about.
- Revision order is total: one session, one \`history\`, synchronous publish in apply order. Reordering would need an async transport, not this code.`,
        timeLimitSec: 360,
        focusFile: 'src/server/session.ts',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace one keystroke',
        prompt: 'Bob has nothing in flight and types a character. Put the steps in the order they execute, ending with bob learning that the server accepted his op.',
        items: [
          'CollabClient.edit applies the op locally and moves bob\'s caret',
          'flush() stamps seq and baseRev = client.rev, then calls send()',
          'CollabHub.handle runs parseClientMsg and looks up the document\'s session',
          'DocumentSession.submit checks baseRev is not ahead, then transformThrough(history.slice(baseRev))',
          'apply() validates the transformed op against the current text and builds the new text',
          'A HistoryEntry (rev = revision + 1) is appended and PresenceTracker.onOp moves every caret',
          'Broadcaster.publish sends the op to every subscriber except bob, then a presence snapshot to everyone',
          'handle() returns { type: \'ack\', rev, seq } and bob\'s client.ack() flushes his next buffered op',
        ],
        hints: [
          'Start in `src/client/client.ts`, then follow the submission into `hub.ts`.',
          'Inside `submit`, the op is transformed *before* it is validated against the current text.',
        ],
        explanation: `Client: \`edit\` applies optimistically and, with nothing in flight, \`flush\`es immediately with \`baseRev = this.rev\`.
Server: \`handle\` parses/validates the *shape* of the message, \`submit\` rebases the op through the concurrent suffix of history, and only then does \`apply\` check bounds (bounds only make sense in current coordinates). The entry is appended, carets moved, peers notified (author excluded from the \`op\` broadcast), and the direct return value is the ack.

Note the ack is the *return value* of \`handle\`, so in this in-process setup peers are notified before the author is acked. Over a real socket the per-client channel ordering is what matters: the ack must not overtake broadcasts already queued to the same client, which is what \`tests/session.test.ts\` models with a single inbox per client.`,
        timeLimitSec: 360,
        focusFile: 'src/server/session.ts',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce COLLAB-412',
        prompt: `\`demo/main.ts\` is the repro script attached to the ticket. Predict **exactly** what it prints.

(Index help: \`"Launch plan: ship v2 on Friday"\` has length 30; \`s\` of \`ship\` is index 13, \`v\` is 18, \`F\` is 24.)`,
        entry: 'demo/main.ts',
        answer: `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@11 -> ": o"
carol@22 -> "!"`,
        options: [
          `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@13 -> "on "
carol@16 -> "Fri"`,
          `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@11 -> ": o"
carol@22 -> "!"`,
          `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@13 -> "on "
carol@22 -> "!"`,
          `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@11 -> ": o"
carol@16 -> "Fri"`,
          `rev=2 text="Launch plan: on Friday!"
alice@13 -> "on "
bob@11 -> ": o"
carol@23 -> ""`,
        ],
        hints: [
          'Bob\'s caret (19) is inside the deleted range [13, 21). Read the delete branch of `transformCursor` literally.',
          'Carol\'s caret is reported with `baseRev: 0` after revision 1 exists. What does `moveCursor` do with `baseRev` besides the "ahead" check?',
          'Bob\'s insert at 30 is rebased through the delete to 22. Carol is not its author, so an insert exactly at her caret does not move her.',
        ],
        explanation: `Two independent bugs show up in one run:

1. **Bob** sits at 19, inside the deleted range [13, 21). \`transformCursor\` does \`max(19 - 8, 0) = 11\`: the "never go negative" clamp hides the real problem, which is that a caret *inside* a deleted range must collapse to the start of the range (13), not move left by the whole length.
2. **Carol** reports \`pos: 24\` in revision-0 coordinates, but \`moveCursor\` never rebases it through revision 1. It just clamps 24 to the current length 22 (another clamp that hides a bug). Correct would be 24 - 8 = 16, right before "Friday".

Bob's own insert at 30 (baseRev 0) is correctly rebased through the delete to 22, so the text is right; this is why "the doc is fine but the carets are wrong" is the symptom. Alice is unaffected (her caret is at the start of the deleted range, so \`pos > op.pos\` is false). Carol at 22 is not the author of the insert at 22, so she stays put and now sits on the \`!\`.`,
        timeLimitSec: 480,
        focusFile: 'demo/main.ts',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix the carets',
        prompt: `Fix COLLAB-412. The hidden tests check:

- \`transformCursor\` for every caret position relative to a delete (before, at start, inside, at end, after), with the insert rules unchanged;
- that the session rebases a caret reported at an **old** \`baseRev\` through every op applied since, using the same author rule as everywhere else;
- the full repro from \`demo/main.ts\`: every caret stays on the text it was on.

You may edit \`src/ot/cursor.ts\` and \`src/server/session.ts\`.`,
        editable: ['src/ot/cursor.ts', 'src/server/session.ts'],
        tests: [
          {
            path: 'tests/cursor.hidden.test.ts',
            content: `import { CollabHub } from '../src/server/hub';
import { transformCursor } from '../src/ot/cursor';
import { insert, del } from '../src/ot/types';

function hubWith(text: string, ...clients: string[]) {
  const hub = new CollabHub((id) => (id === 'd' ? text : undefined));
  for (const c of clients) hub.handle({ type: 'join', docId: 'd', clientId: c });
  return hub;
}
const cursorOf = (hub: CollabHub, id: string) => hub.get('d')!.cursorOf(id);

test('transformCursor: delete before / at end / inside / after the caret', () => {
  expect(transformCursor(10, del(2, 3), false)).toBe(7);
  expect(transformCursor(5, del(2, 3), false)).toBe(2);
  expect(transformCursor(4, del(2, 3), false)).toBe(2);
  expect(transformCursor(3, del(2, 3), true)).toBe(2);
  expect(transformCursor(2, del(2, 3), false)).toBe(2);
  expect(transformCursor(1, del(2, 3), false)).toBe(1);
});

test('transformCursor: insert rules are unchanged', () => {
  expect(transformCursor(4, insert(4, 'ab'), false)).toBe(4);
  expect(transformCursor(4, insert(4, 'ab'), true)).toBe(6);
  expect(transformCursor(4, insert(1, 'ab'), false)).toBe(6);
  expect(transformCursor(4, insert(9, 'ab'), false)).toBe(4);
});

test('caret inside a remotely deleted range collapses to the start of the range', () => {
  const hub = hubWith('0123456789', 'a', 'b');
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'b', pos: 6, baseRev: 0 });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: del(3, 5) });
  expect(cursorOf(hub, 'b')).toBe(3);
});

test('stale caret reports are rebased through ops the client had not seen', () => {
  const hub = hubWith('0123456789', 'a', 'b');
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: del(0, 4) });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 2, baseRev: 1, op: insert(0, 'XY') });
  // b is still at rev 0 and puts the caret before "8"
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'b', pos: 8, baseRev: 0 });
  const s = hub.get('d')!;
  expect(s.content).toBe('XY456789');
  expect(s.content.slice(cursorOf(hub, 'b')!)).toBe('89');
});

test('a stale caret at a concurrent insert point is not pushed by someone else\\'s typing', () => {
  const hub = hubWith('abcdef', 'a', 'b');
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(3, 'ZZ') });
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'b', pos: 3, baseRev: 0 });
  expect(cursorOf(hub, 'b')).toBe(3);
});

test('COLLAB-412 repro: every caret stays on the text it was on', () => {
  const hub = hubWith('Launch plan: ship v2 on Friday', 'alice', 'bob', 'carol');
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'bob', pos: 19, baseRev: 0 });
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'alice', pos: 13, baseRev: 0 });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'alice', seq: 1, baseRev: 0, op: del(13, 8) });
  hub.handle({ type: 'cursor', docId: 'd', clientId: 'carol', pos: 24, baseRev: 0 });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'bob', seq: 1, baseRev: 0, op: insert(30, '!') });
  const s = hub.get('d')!;
  expect(s.content).toBe('Launch plan: on Friday!');
  expect(cursorOf(hub, 'alice')).toBe(13);
  expect(cursorOf(hub, 'bob')).toBe(13);
  expect(s.content.slice(cursorOf(hub, 'carol')!, cursorOf(hub, 'carol')! + 6)).toBe('Friday');
});
`,
          },
        ],
        solution: {
          'src/ot/cursor.ts': `import { Op } from './types';

/**
 * Move a caret position across an applied op.
 *
 * @param pos       caret position in the document BEFORE \`op\`
 * @param op        the op being applied
 * @param isAuthor  true if the caret belongs to the user who made \`op\`
 */
export function transformCursor(pos: number, op: Op, isAuthor: boolean): number {
  if (op.type === 'insert') {
    if (op.pos < pos || (op.pos === pos && isAuthor)) return pos + op.text.length;
    return pos;
  }
  if (pos <= op.pos) return pos;
  if (pos >= op.pos + op.len) return pos - op.len;
  // caret was inside the deleted range: collapse to where the range was
  return op.pos;
}

export function clampCursor(pos: number, docLength: number): number {
  if (!Number.isFinite(pos)) return docLength;
  return Math.min(Math.max(0, Math.trunc(pos)), docLength);
}
`,
          'src/server/session.ts': `import { Ack, ClientId, HistoryEntry, Submission } from '../ot/types';
import { apply, OpError } from '../ot/apply';
import { transformThrough } from '../ot/transform';
import { clampCursor, transformCursor } from '../ot/cursor';
import { PresenceTracker, CursorView } from './presence';
import { Broadcaster } from './broadcaster';
import { ServerMsg, ProtocolError } from '../protocol/messages';
import { Logger, nullLogger } from '../util/logger';

export interface SessionOptions {
  maxDocLength: number;
}

/**
 * One live document. Single-threaded: every call runs to completion before the
 * next message is processed, so the history order IS the global order.
 */
export class DocumentSession {
  private text: string;
  private readonly history: HistoryEntry[] = [];
  private readonly presence = new PresenceTracker();

  constructor(
    readonly docId: string,
    initialText: string,
    private readonly bus: Broadcaster<ServerMsg>,
    private readonly opts: SessionOptions,
    private readonly log: Logger = nullLogger,
  ) {
    this.text = initialText;
  }

  get revision(): number {
    return this.history.length;
  }

  get content(): string {
    return this.text;
  }

  join(clientId: ClientId): { rev: number; text: string; cursors: CursorView[] } {
    this.presence.join(clientId);
    return { rev: this.revision, text: this.text, cursors: this.presence.snapshot() };
  }

  leave(clientId: ClientId): void {
    this.presence.leave(clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
  }

  submit(sub: Submission): Ack {
    if (sub.baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${sub.baseRev} is ahead of server rev \${this.revision}\`);
    }
    const concurrent = this.history.slice(sub.baseRev);
    const op = transformThrough(sub.op, sub.clientId, concurrent);

    let next: string;
    try {
      next = apply(this.text, op);
    } catch (e) {
      if (e instanceof OpError) throw new ProtocolError('bad-request', e.message);
      throw e;
    }
    if (next.length > this.opts.maxDocLength) {
      throw new ProtocolError('bad-request', 'document too large');
    }

    this.text = next;
    const entry: HistoryEntry = { rev: this.revision + 1, clientId: sub.clientId, seq: sub.seq, op };
    this.history.push(entry);
    this.presence.onOp(op, sub.clientId);
    this.log.debug('applied', { docId: this.docId, rev: entry.rev, by: sub.clientId });

    this.bus.publish(this.docId, { type: 'op', ...entry }, sub.clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
    return { rev: entry.rev, op };
  }

  /** \`pos\` is a caret position in the document as of server revision \`baseRev\`. */
  moveCursor(clientId: ClientId, pos: number, baseRev: number): number {
    if (baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${baseRev} is ahead of server rev \${this.revision}\`);
    }
    // Rebase the caret from revision baseRev onto the current document.
    let rebased = pos;
    for (const h of this.history.slice(baseRev)) {
      rebased = transformCursor(rebased, h.op, h.clientId === clientId);
    }
    const current = clampCursor(rebased, this.text.length);
    this.presence.set(clientId, current);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() }, clientId);
    return current;
  }

  cursorOf(clientId: ClientId): number | undefined {
    return this.presence.get(clientId);
  }

  opsSince(rev: number): HistoryEntry[] {
    return this.history.slice(rev);
  }
}
`,
        },
        hints: [
          'There are two bugs. One is in pure OT code, one is in how the server uses it.',
          'A delete of `[p, p + len)` maps a caret `c` to `c` if `c <= p`, to `c - len` if `c >= p + len`, else to `p`.',
          'In `moveCursor`, fold `transformCursor` over `this.history.slice(baseRev)` *before* clamping. `isAuthor` is `h.clientId === clientId`.',
        ],
        explanation: `**cursor.ts:** a delete is a piecewise map: positions before the range are fixed, positions after shift left by \`len\`, positions inside collapse to \`op.pos\`. The original \`Math.max(pos - len, 0)\` is only right for the "after" case; the clamp to 0 made it look defensive while hiding the "inside" case. (\`Math.max(pos - len, op.pos)\` is an equivalent one-liner.)

**session.ts:** a caret is a coordinate in a specific revision, exactly like an op. The server already rebases ops through \`history.slice(baseRev)\`; carets need the same treatment, with \`transformCursor\` standing in for \`transform\`. The clamp is still useful as a last line of defence against malicious input, but it must run *after* rebasing, not instead of it.

The general lesson: in any OT/CRDT system, *every* position that crosses the wire (ops, carets, selections, comments anchors) is relative to a version and must be transformed with it. Clamping to the current length is a smell that a version was ignored.`,
        timeLimitSec: 900,
        focusFile: 'src/ot/cursor.ts',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review: bounding history',
        prompt: 'Memory on long-lived documents keeps growing, so you ask the assistant (which can only see `session.ts`) for a fix. Review its patch.',
        persona: 'tunnel-vision',
        request: 'History grows forever on long-lived docs. Cap it so a session never holds more than 1000 ops.',
        aiReply: `Good catch, \`history\` is the only unbounded structure here. Trim it right after we append:

\`\`\`ts
const MAX_HISTORY = 1000;

// in submit(), after this.history.push(entry):
    this.history.push(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
\`\`\`

Clients that are within 1000 ops of the head are unaffected because \`submit\` only ever looks at \`history.slice(baseRev)\`, and anyone further behind would need a fresh snapshot anyway. Memory is now O(1) per document. 🚀`,
        options: [
          'Accept: memory is bounded and clients within the window behave exactly as before.',
          'Reject: `revision` is `history.length`, so after trimming it is stuck at 1000 and every new op is stamped rev 1001; and `slice(baseRev)` now uses a revision number as an array index, so ops are rebased against the wrong ops or none. History needs a base-revision offset and an explicit "too far behind, resync" error.',
          'Reject: `splice` mutates `history` while `Broadcaster.publish` may still be iterating over it, corrupting in-flight broadcasts.',
          'Reject: correct, but `splice(0, n)` is O(n) per op; it should use a ring buffer to avoid making `submit` quadratic.',
          'Reject: trimming history breaks the TP1 property of `transform`, so documents diverge.',
        ],
        correct: 1,
        hints: [
          'How is `revision` computed?',
          'After 1500 ops, a client with `baseRev = 1400` sends an op. What does `history.slice(1400)` return when `history.length === 1000`?',
        ],
        explanation: `The patch silently conflates two things the original code could treat as the same: **a revision number** and **an index into \`history\`**. Once you drop a prefix they diverge:

- \`get revision() { return this.history.length }\` stops growing at 1000, so every new entry gets \`rev: 1001\`. Clients then throw \`ack for rev 1001, expected ...\` and \`receive\` sees gaps.
- \`history.slice(baseRev)\` with \`baseRev = 1400\` on a 1000-element array returns \`[]\`: the op is applied **untransformed** against 100 concurrent ops. Silent divergence, the worst possible OT failure.

A correct version keeps \`baseRev\` (the revision of \`history[0]\`), computes \`revision = baseRev + history.length\`, slices with \`baseRev - this.baseRev\`, and rejects \`baseRev < this.baseRev\` with an error that makes the client fetch a snapshot. The O(n) \`splice\` is a real but minor cost (amortise with a chunked trim); broadcasts never iterate \`history\`; TP1 is a property of \`transform\`, which is untouched. Classic tunnel vision: the assistant reasoned only about the lines it was shown.`,
        timeLimitSec: 420,
        focusFile: 'src/server/session.ts',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'feature',
        title: 'Feature: idempotent resends',
        prompt: `Mobile clients drop their socket all the time. On reconnect they **resend their in-flight op with the same \`clientId\` and \`seq\`** (possibly with a newer \`baseRev\`). Today the server applies it twice.

Implement in \`DocumentSession.submit\`:

1. Track the last applied \`seq\` per client.
2. \`seq <= lastSeq\` → **duplicate**: do not apply, do not broadcast, return \`{ rev, op, duplicate: true }\` where \`rev\`/\`op\` are those of the **original** application of that \`(clientId, seq)\`.
3. \`seq > lastSeq + 1\` → throw \`ProtocolError('conflict', ...)\` and change nothing.
4. Otherwise apply as today. The first op from a client has \`seq\` 1.

\`CollabHub\` already forwards \`ack.duplicate\` to the client.`,
        editable: ['src/server/session.ts'],
        tests: [
          {
            path: 'tests/resend.hidden.test.ts',
            content: `import { CollabHub } from '../src/server/hub';
import { insert, del } from '../src/ot/types';
import { ServerMsg } from '../src/protocol/messages';

function setup(text: string) {
  const hub = new CollabHub((id) => (id === 'd' ? text : undefined));
  const seen: Record<string, ServerMsg[]> = { a: [], b: [] };
  for (const id of ['a', 'b']) {
    hub.handle({ type: 'join', docId: 'd', clientId: id });
    hub.connect('d', id, (m) => seen[id].push(m));
  }
  return { hub, seen };
}
const ops = (msgs: ServerMsg[]) => msgs.filter((m) => m.type === 'op');

test('a resent submission is acknowledged with the original revision and not re-applied', () => {
  const { hub, seen } = setup('abc');
  const sub = { type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(3, 'd') };
  const first = hub.handle(sub);
  const again = hub.handle(sub);
  expect(first).toEqual({ type: 'ack', rev: 1, seq: 1, duplicate: undefined });
  expect(again).toEqual({ type: 'ack', rev: 1, seq: 1, duplicate: true });
  expect(hub.get('d')!.content).toBe('abcd');
  expect(hub.get('d')!.revision).toBe(1);
  expect(ops(seen.b)).toHaveLength(1);
});

test('resend after other clients moved on (different baseRev) is still a duplicate', () => {
  const { hub, seen } = setup('abc');
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(0, 'X') });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'b', seq: 1, baseRev: 1, op: del(1, 1) });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'b', seq: 2, baseRev: 2, op: insert(0, '>') });
  const r = hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 3, op: insert(1, 'X') });
  expect(r).toEqual({ type: 'ack', rev: 1, seq: 1, duplicate: true });
  expect(hub.get('d')!.content).toBe('>Xbc');
  expect(ops(seen.b).filter((m) => m.type === 'op' && m.clientId === 'a')).toHaveLength(1);
});

test('older duplicates return their own original revision', () => {
  const { hub } = setup('');
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(0, 'x') });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'b', seq: 1, baseRev: 1, op: insert(1, 'y') });
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 2, baseRev: 2, op: insert(2, 'z') });
  const r = hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(0, 'x') });
  expect(r).toEqual({ type: 'ack', rev: 1, seq: 1, duplicate: true });
  expect(hub.get('d')!.content).toBe('xyz');
});

test('a sequence gap is a conflict and changes nothing', () => {
  const { hub } = setup('abc');
  hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(0, '1') });
  const r = hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 3, baseRev: 1, op: insert(0, '3') });
  expect(r.type).toBe('error');
  expect(r.type === 'error' && r.code).toBe('conflict');
  expect(hub.get('d')!.content).toBe('1abc');
  const ok = hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 2, baseRev: 1, op: insert(0, '2') });
  expect(ok).toEqual({ type: 'ack', rev: 2, seq: 2, duplicate: undefined });
});

test('sequence numbers are tracked per client', () => {
  const { hub } = setup('');
  expect(hub.handle({ type: 'submit', docId: 'd', clientId: 'a', seq: 1, baseRev: 0, op: insert(0, 'a') }).type).toBe('ack');
  expect(hub.handle({ type: 'submit', docId: 'd', clientId: 'b', seq: 1, baseRev: 1, op: insert(0, 'b') }).type).toBe('ack');
  expect(hub.get('d')!.content).toBe('ba');
});
`,
          },
        ],
        solution: {
          'src/server/session.ts': `import { Ack, ClientId, HistoryEntry, Submission } from '../ot/types';
import { apply, OpError } from '../ot/apply';
import { transformThrough } from '../ot/transform';
import { clampCursor, transformCursor } from '../ot/cursor';
import { PresenceTracker, CursorView } from './presence';
import { Broadcaster } from './broadcaster';
import { ServerMsg, ProtocolError } from '../protocol/messages';
import { Logger, nullLogger } from '../util/logger';

export interface SessionOptions {
  maxDocLength: number;
}

/**
 * One live document. Single-threaded: every call runs to completion before the
 * next message is processed, so the history order IS the global order.
 */
export class DocumentSession {
  private text: string;
  private readonly history: HistoryEntry[] = [];
  private readonly presence = new PresenceTracker();
  private readonly lastSeq = new Map<ClientId, number>();
  private readonly applied = new Map<string, HistoryEntry>();

  constructor(
    readonly docId: string,
    initialText: string,
    private readonly bus: Broadcaster<ServerMsg>,
    private readonly opts: SessionOptions,
    private readonly log: Logger = nullLogger,
  ) {
    this.text = initialText;
  }

  get revision(): number {
    return this.history.length;
  }

  get content(): string {
    return this.text;
  }

  join(clientId: ClientId): { rev: number; text: string; cursors: CursorView[] } {
    this.presence.join(clientId);
    return { rev: this.revision, text: this.text, cursors: this.presence.snapshot() };
  }

  leave(clientId: ClientId): void {
    this.presence.leave(clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
  }

  submit(sub: Submission): Ack {
    const last = this.lastSeq.get(sub.clientId) ?? 0;
    if (sub.seq <= last) {
      // A resend (e.g. after a reconnect). Never re-apply: answer with the original ack.
      const original = this.applied.get(\`\${sub.clientId}:\${sub.seq}\`)!;
      return { rev: original.rev, op: original.op, duplicate: true };
    }
    if (sub.seq !== last + 1) {
      throw new ProtocolError('conflict', \`seq gap for \${sub.clientId}: expected \${last + 1}, got \${sub.seq}\`);
    }
    if (sub.baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${sub.baseRev} is ahead of server rev \${this.revision}\`);
    }
    const concurrent = this.history.slice(sub.baseRev);
    const op = transformThrough(sub.op, sub.clientId, concurrent);

    let next: string;
    try {
      next = apply(this.text, op);
    } catch (e) {
      if (e instanceof OpError) throw new ProtocolError('bad-request', e.message);
      throw e;
    }
    if (next.length > this.opts.maxDocLength) {
      throw new ProtocolError('bad-request', 'document too large');
    }

    this.text = next;
    const entry: HistoryEntry = { rev: this.revision + 1, clientId: sub.clientId, seq: sub.seq, op };
    this.history.push(entry);
    this.lastSeq.set(sub.clientId, sub.seq);
    this.applied.set(\`\${sub.clientId}:\${sub.seq}\`, entry);
    this.presence.onOp(op, sub.clientId);
    this.log.debug('applied', { docId: this.docId, rev: entry.rev, by: sub.clientId });

    this.bus.publish(this.docId, { type: 'op', ...entry }, sub.clientId);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() });
    return { rev: entry.rev, op };
  }

  /** \`pos\` is a caret position in the document as of server revision \`baseRev\`. */
  moveCursor(clientId: ClientId, pos: number, baseRev: number): number {
    if (baseRev > this.revision) {
      throw new ProtocolError('conflict', \`baseRev \${baseRev} is ahead of server rev \${this.revision}\`);
    }
    // Rebase the caret from revision baseRev onto the current document.
    let rebased = pos;
    for (const h of this.history.slice(baseRev)) {
      rebased = transformCursor(rebased, h.op, h.clientId === clientId);
    }
    const current = clampCursor(rebased, this.text.length);
    this.presence.set(clientId, current);
    this.bus.publish(this.docId, { type: 'presence', cursors: this.presence.snapshot() }, clientId);
    return current;
  }

  cursorOf(clientId: ClientId): number | undefined {
    return this.presence.get(clientId);
  }

  opsSince(rev: number): HistoryEntry[] {
    return this.history.slice(rev);
  }
}
`,
        },
        hints: [
          'The dedupe check must happen before transformation and before the `baseRev` checks have any side effects.',
          '`HistoryEntry` already carries `clientId` and `seq`; a `Map` keyed by `` `${clientId}:${seq}` `` gives O(1) lookup of the original entry.',
          'Older duplicates (seq < lastSeq) must return *their own* original revision, not the latest one.',
        ],
        explanation: `Exactly-once *effect* over an at-least-once transport needs a dedupe key the client controls; \`(clientId, seq)\` is that key, and \`seq\` doubles as a gap detector.

Key points the tests probe:
- **Check before transforming.** A resend may carry a newer \`baseRev\` (the client caught up while reconnecting), so the op bytes differ from the original. Identity is \`(clientId, seq)\`, never the op contents.
- **Return the original ack.** The client's state machine expects \`ack(rev)\` with the revision of its op; answering with the current revision would desync it.
- **Gaps are errors, not "apply anyway".** A gap means the server never saw an op the client thinks it sent; applying later ops would build on a missing edit.

Production concerns to mention in an interview: the \`applied\` map grows with history (it can be trimmed together with history, since a resend older than the history window must resync anyway), and if sessions move between servers the last-seq table must move with the document state.`,
        timeLimitSec: 900,
        focusFile: 'src/server/session.ts',
      },
      {
        id: 's7',
        kind: 'mcq',
        title: 'Follow-up: the all-hands doc',
        prompt: `A company all-hands puts **300 people** in one document, each producing ~5 ops/s, and a few on bad mobile links lag **~2,000 revisions** behind. What is true about this design under that load? **Select all that apply.**`,
        options: [
          'Each `submit` costs O(lag) transforms, so badly lagging clients make per-op server CPU grow with their lag; cap the window and force a snapshot resync beyond it.',
          'Every applied op triggers `PresenceTracker.onOp` over all carets and a full presence snapshot to every subscriber: ~1,500 ops/s × 300 recipients × 300 carets ≈ 135M caret entries/s. Presence must be throttled/coalesced (`presenceThrottleMs` exists in config but nothing uses it).',
          'Since each session is single-threaded, you can spread one document\'s ops round-robin across several server processes to use more cores.',
          'Doubling the load can make replicas diverge, because `transform` is only correct when ops arrive slowly.',
          'Shard by `docId` with sticky routing: each document has exactly one sequencer. Total capacity scales with the number of documents, but one hot document is bounded by one core.',
        ],
        correct: [0, 1, 4],
        hints: [
          'What determines the length of `history.slice(baseRev)`?',
          'Count what `submit` publishes per op, and to how many subscribers.',
          'Where does the total order of ops come from?',
        ],
        explanation: `- **Lag cost (true):** rebasing is linear in the number of concurrent ops. That is why real systems bound the window and fall back to snapshot + replay.
- **Presence fan-out (true):** presence is O(N) per op *and* is broadcast as a full O(N) snapshot to O(N) subscribers, so it is O(N²) per op. It is usually the first thing to fall over in big rooms, long before OT itself. Throttle per client, send deltas, and cap visible carets.
- **Round-robin one doc (false):** correctness depends on a single total order, the \`history\` array. Two processes appending independently would produce two histories. You can only scale a single document vertically or by partitioning the *document* (e.g. per section/block).
- **Divergence under load (false):** OT convergence is a logical property (TP1 + a single sequencer); load changes latency, not correctness.
- **Sticky sharding (true):** standard for Docs-like systems: route by document id to an owner process; hot documents are the scaling limit.`,
        timeLimitSec: 420,
        focusFile: 'config/collab.json',
      },
    ],
  },
  {
    id: 'l5-sim-meta-ads-aggregator',
    title: 'Simulation: Ads Event Aggregator',
    level: 5,
    rating: 2600,
    lang: 'python',
    domain: 'log-processor',
    companies: ['meta'],
    tags: ['simulation', 'streaming', 'heap', 'top-k', 'attribution', 'dedupe', 'performance', 'ai-review'],
    summary: 'An hourly ads aggregation job credits conversions to the wrong ad and times out on real traffic. Debug the attribution, review a model\'s heap patch, then make it stream.',
    context: `**Meta-style AI-enabled coding round (60 min, 7 stages, one codebase).**

You are on the Ads Measurement team. \`adsagg\` turns the hourly ads event log into per-ad stats and a "top ads" leaderboard.
Two problems landed this week:

- **ADS-2291:** an advertiser says conversions are being credited to the wrong ad.
- **ADS-2304:** the job now times out on full-hour files (~120k events in the test env, millions in prod).

The assistant panel lets you **switch models** (a fast model and a slower reasoning model). In this round the interviewer cares less about which
model you use and more about whether you *verify* what comes back. \`README.md\` is the spec: treat it as the source of truth over code comments.`,
    persona: 'confident-intern',
    files: [
      {
        path: 'README.md',
        language: 'markdown',
        content: `# adsagg

Hourly aggregation of the ads event log into per-ad performance stats and a
"top ads" leaderboard used by the advertiser dashboard.

\`\`\`
log shipper --> events-YYYYMMDD-HH.jsonl --> adsagg --> report / dashboard
\`\`\`

## Event log

One JSON object per line (see \`adsagg/schema.py\`):

| field          | notes                                                       |
|----------------|-------------------------------------------------------------|
| \`event_id\`     | unique per event; the shipper is at-least-once, so repeats happen |
| \`ts\`           | event time, epoch seconds. Lines are written in non-decreasing \`ts\` order |
| \`kind\`         | \`impression\`, \`click\` or \`conversion\`                       |
| \`ad_id\`        | empty for conversions (they come from the advertiser pixel) |
| \`user_id\`      | hashed user id                                              |
| \`cost_micros\`  | what we charge for this impression/click                    |
| \`value_micros\` | conversion value reported by the advertiser                 |

A redelivered event always arrives within \`dedupe_window_s\` of the original.

## Attribution

Last-click: a conversion is credited to the ad of the user's **most recent**
click, if that click happened at most \`attribution_window_s\` seconds before
the conversion (inclusive). Otherwise the conversion is counted as
\`unattributed\`.

## Ranking

\`top_k(stats, k, metric)\` returns the k best ads by \`metric\`, best first.
Ties on the metric are broken by **ascending \`ad_id\`** so the dashboard is
stable between runs.

## Running

\`\`\`
python -m adsagg.cli data/sample_events.jsonl --k 5 --metric spend
python tools/gen_events.py 100000 > /tmp/events.jsonl   # synthetic load
\`\`\`

## Layout

\`\`\`
adsagg/schema.py       Event + parse_line
adsagg/reader.py       read_events(path)
adsagg/dedupe.py       Deduper (windowed, by event_id)
adsagg/attribution.py  LastClickAttributor
adsagg/aggregate.py    AdStats + Aggregator
adsagg/metrics.py      ctr / cpc / roas
adsagg/topk.py         top_k
adsagg/pipeline.py     run_pipeline -- wires everything together
adsagg/report.py       text rendering
adsagg/cli.py          entry point
tools/gen_events.py    deterministic synthetic log generator
\`\`\`
`,
      },
      {
        path: 'adsagg/__init__.py',
        content: `"""adsagg: hourly ads event aggregation."""

__version__ = "2.4.1"
`,
      },
      {
        path: 'adsagg/aggregate.py',
        content: `from dataclasses import dataclass


@dataclass
class AdStats:
    impressions: int = 0
    clicks: int = 0
    conversions: int = 0
    spend_micros: int = 0
    value_micros: int = 0


class Aggregator:
    def __init__(self):
        self.by_ad = {}

    def _get(self, ad_id):
        s = self.by_ad.get(ad_id)
        if s is None:
            s = self.by_ad[ad_id] = AdStats()
        return s

    def add(self, event, credited_ad=None):
        if event.kind == "impression":
            s = self._get(event.ad_id)
            s.impressions += 1
            s.spend_micros += event.cost_micros
        elif event.kind == "click":
            s = self._get(event.ad_id)
            s.clicks += 1
            s.spend_micros += event.cost_micros
        elif event.kind == "conversion" and credited_ad is not None:
            s = self._get(credited_ad)
            s.conversions += 1
            s.value_micros += event.value_micros

    def merge(self, other):
        """Combine partial aggregates (e.g. from parallel workers)."""
        for ad_id, o in other.by_ad.items():
            s = self._get(ad_id)
            s.impressions += o.impressions
            s.clicks += o.clicks
            s.conversions += o.conversions
            s.spend_micros += o.spend_micros
            s.value_micros += o.value_micros
        return self
`,
      },
      {
        path: 'adsagg/attribution.py',
        content: `from collections import namedtuple

Click = namedtuple("Click", "ts ad_id")


class LastClickAttributor:
    """Credits each conversion to the user's most recent click within the window."""

    def __init__(self, window_s):
        self.window_s = window_s
        self._last_click = {}  # user_id -> Click
        self.unattributed = 0

    def observe(self, event):
        """Feed every accepted event in stream order.

        Returns the ad_id a conversion is credited to, or None (also None for
        non-conversion events).
        """
        if event.kind == "click":
            self._last_click.setdefault(event.user_id, Click(event.ts, event.ad_id))
            return None
        if event.kind != "conversion":
            return None
        click = self._last_click.get(event.user_id)
        if click is None or event.ts - click.ts > self.window_s:
            self.unattributed += 1
            return None
        return click.ad_id

    def tracked_users(self):
        return len(self._last_click)
`,
      },
      {
        path: 'adsagg/cli.py',
        content: `import argparse
import sys

from adsagg.pipeline import load_config, run_pipeline
from adsagg.report import render


def main(argv=None):
    p = argparse.ArgumentParser(prog="adsagg")
    p.add_argument("path")
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--metric", default="spend")
    p.add_argument("--config", default=None)
    args = p.parse_args(argv)
    cfg = load_config(args.config) if args.config else load_config()
    report = run_pipeline(args.path, k=args.k, metric=args.metric, config=cfg)
    print(render(report, args.metric))
    return 0


if __name__ == "__main__":
    sys.exit(main())
`,
      },
      {
        path: 'adsagg/dedupe.py',
        content: `class Deduper:
    """Drops events whose event_id was already accepted within the last \`window_s\` seconds.

    The shipper is at-least-once and always redelivers within the window, so we
    only need to remember recent ids. Memory is bounded by the window.
    """

    def __init__(self, window_s):
        self.window_s = window_s
        self._recent = []  # (ts, event_id) in arrival order
        self.dropped = 0

    def _evict(self, now):
        horizon = now - self.window_s
        while self._recent and self._recent[0][0] < horizon:
            self._recent.pop(0)

    def accept(self, event):
        self._evict(event.ts)
        for _, seen_id in self._recent:
            if seen_id == event.event_id:
                self.dropped += 1
                return False
        self._recent.append((event.ts, event.event_id))
        return True
`,
      },
      {
        path: 'adsagg/metrics.py',
        content: `"""Derived metrics. Money stays in integer micros until the very end."""

MICROS = 1_000_000


def spend(s):
    return s.spend_micros


def clicks(s):
    return s.clicks


def conversions(s):
    return s.conversions


def ctr(s):
    # 0 impressions => 0.0, never ZeroDivisionError
    return s.clicks / s.impressions if s.impressions else 0.0


def cpc_micros(s):
    return s.spend_micros // s.clicks if s.clicks else 0


def roas(s):
    return s.value_micros / s.spend_micros if s.spend_micros else 0.0


METRICS = {
    "spend": spend,
    "clicks": clicks,
    "conversions": conversions,
    "ctr": ctr,
    "roas": roas,
}


def dollars(micros):
    return "%.2f" % (micros / MICROS)
`,
      },
      {
        path: 'adsagg/pipeline.py',
        content: `import json
import os
from dataclasses import dataclass, field

from adsagg.aggregate import Aggregator
from adsagg.attribution import LastClickAttributor
from adsagg.dedupe import Deduper
from adsagg.reader import ReadStats, read_events
from adsagg.topk import top_k

_CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "pipeline.json")


def load_config(path=_CONFIG):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


@dataclass
class Report:
    stats: dict
    top: list
    events: int = 0
    bad_records: int = 0
    duplicates: int = 0
    unattributed: int = 0
    notes: list = field(default_factory=list)


def run_pipeline(path, k=10, metric="spend", config=None):
    cfg = config if config is not None else load_config()
    read_stats = ReadStats()
    dedupe = Deduper(cfg["dedupe_window_s"])
    attributor = LastClickAttributor(cfg["attribution_window_s"])
    agg = Aggregator()

    n = 0
    for event in read_events(path, read_stats):
        n += 1
        if not dedupe.accept(event):
            continue
        credited = attributor.observe(event)
        agg.add(event, credited)

    report = Report(
        stats=agg.by_ad,
        top=top_k(agg.by_ad, k, metric),
        events=n,
        bad_records=read_stats.bad,
        duplicates=dedupe.dropped,
        unattributed=attributor.unattributed,
    )
    if read_stats.bad:
        report.notes.append("skipped %d malformed lines" % read_stats.bad)
    return report
`,
      },
      {
        path: 'adsagg/reader.py',
        content: `import gzip

from adsagg.schema import BadRecord, parse_line


class ReadStats:
    def __init__(self):
        self.lines = 0
        self.bad = 0
        self.samples = []  # first few bad lines, for the run log

    def record_bad(self, line, err):
        self.bad += 1
        if len(self.samples) < 5:
            self.samples.append((line[:120], str(err)))


def _open(path):
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")


def read_events(path, stats=None):
    """Return the parsed events in file order. Malformed lines are counted and skipped."""
    stats = stats if stats is not None else ReadStats()
    with _open(path) as fh:
        lines = fh.read().splitlines()
    events = []
    for line in lines:
        if not line.strip():
            continue
        stats.lines += 1
        try:
            events.append(parse_line(line))
        except BadRecord as e:
            stats.record_bad(line, e)
    return events
`,
      },
      {
        path: 'adsagg/report.py',
        content: `from adsagg.metrics import ctr, dollars


def render(report, metric):
    lines = []
    lines.append("events=%d dup=%d bad=%d unattributed=%d" % (
        report.events, report.duplicates, report.bad_records, report.unattributed))
    for ad_id in sorted(report.stats):
        s = report.stats[ad_id]
        lines.append("%s imp=%d clk=%d conv=%d spend=%s ctr=%.2f" % (
            ad_id, s.impressions, s.clicks, s.conversions, dollars(s.spend_micros), ctr(s)))
    lines.append("top by %s: %s" % (metric, ", ".join(ad for ad, _ in report.top)))
    for note in report.notes:
        lines.append("note: " + note)
    return "\\n".join(lines)
`,
      },
      {
        path: 'adsagg/schema.py',
        content: `import json
from dataclasses import dataclass

KINDS = ("impression", "click", "conversion")


class BadRecord(ValueError):
    pass


@dataclass(frozen=True)
class Event:
    event_id: str
    ts: int
    kind: str
    ad_id: str
    user_id: str
    cost_micros: int = 0
    value_micros: int = 0


def parse_line(line):
    """Parse one JSONL line into an Event. Raises BadRecord on anything malformed."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as e:
        raise BadRecord("not json: %s" % e) from None
    if not isinstance(raw, dict):
        raise BadRecord("not an object")
    try:
        kind = raw["kind"]
        if kind not in KINDS:
            raise BadRecord("unknown kind %r" % (kind,))
        ev = Event(
            event_id=str(raw["event_id"]),
            ts=int(raw["ts"]),
            kind=kind,
            ad_id=str(raw.get("ad_id") or ""),
            user_id=str(raw["user_id"]),
            cost_micros=int(raw.get("cost_micros", 0)),
            value_micros=int(raw.get("value_micros", 0)),
        )
    except (KeyError, TypeError, ValueError) as e:
        if isinstance(e, BadRecord):
            raise
        raise BadRecord("bad field: %s" % e) from None
    if kind != "conversion" and not ev.ad_id:
        raise BadRecord("%s without ad_id" % kind)
    return ev
`,
      },
      {
        path: 'adsagg/sinks.py',
        content: `"""Where finished reports go. The dashboard ingests the JSON sink."""
import csv
import io
import json

from adsagg.metrics import METRICS, cpc_micros


def to_rows(report):
    rows = []
    for ad_id in sorted(report.stats):
        s = report.stats[ad_id]
        rows.append({
            "ad_id": ad_id,
            "impressions": s.impressions,
            "clicks": s.clicks,
            "conversions": s.conversions,
            "spend_micros": s.spend_micros,
            "value_micros": s.value_micros,
            "cpc_micros": cpc_micros(s),
            "ctr": round(METRICS["ctr"](s), 6),
            "roas": round(METRICS["roas"](s), 6),
        })
    return rows


def to_csv(report):
    buf = io.StringIO()
    rows = to_rows(report)
    if not rows:
        return ""
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), lineterminator="\\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def to_json(report, hour):
    return json.dumps({
        "hour": hour,
        "events": report.events,
        "duplicates": report.duplicates,
        "bad_records": report.bad_records,
        "unattributed": report.unattributed,
        "top": [{"ad_id": a, "value": v} for a, v in report.top],
        "ads": to_rows(report),
    }, sort_keys=True)
`,
      },
      {
        path: 'adsagg/timeutil.py',
        content: `"""Hour-bucket helpers. All times are UTC epoch seconds."""
import re
from datetime import datetime, timezone

_HOURLY = re.compile(r"events-(\\d{8})-(\\d{2})\\.jsonl(\\.gz)?$")


def hour_of(ts):
    return ts - ts % 3600


def hour_label(ts):
    return datetime.fromtimestamp(hour_of(ts), tz=timezone.utc).strftime("%Y%m%d-%H")


def hour_from_filename(name):
    """events-20240501-13.jsonl -> epoch seconds of 2024-05-01T13:00Z, or None."""
    m = _HOURLY.search(name)
    if not m:
        return None
    day, hh = m.group(1), int(m.group(2))
    dt = datetime.strptime(day, "%Y%m%d").replace(hour=hh, tzinfo=timezone.utc)
    return int(dt.timestamp())
`,
      },
      {
        path: 'adsagg/topk.py',
        content: `from adsagg.metrics import METRICS


def top_k(stats_by_ad, k, metric="spend"):
    """Return [(ad_id, value)] for the k best ads by \`metric\`, best first.

    Ties on the metric value go to the smaller ad_id.
    """
    if metric not in METRICS:
        raise ValueError("unknown metric %r" % (metric,))
    fn = METRICS[metric]
    remaining = dict(stats_by_ad)
    out = []
    while remaining and len(out) < k:
        best_id, best_v = None, None
        for ad_id, s in remaining.items():
            v = fn(s)
            if best_id is None or v > best_v or (v == best_v and ad_id < best_id):
                best_id, best_v = ad_id, v
        out.append((best_id, best_v))
        del remaining[best_id]
    return out
`,
      },
      {
        path: 'benchmarks/bench_pipeline.py',
        content: `"""Rough local benchmark: python benchmarks/bench_pipeline.py 200000"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adsagg.pipeline import run_pipeline  # noqa: E402
from tools.gen_events import generate, write_jsonl  # noqa: E402


def main(n):
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w") as fh:
        write_jsonl(generate(n), fh)
    t = time.perf_counter()
    r = run_pipeline(path, k=100)
    dt = time.perf_counter() - t
    os.remove(path)
    print("%d events in %.2fs (%.0f ev/s), %d ads" % (n, dt, n / dt, len(r.stats)))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 50_000)
`,
      },
      {
        path: 'config/pipeline.json',
        language: 'json',
        content: `{
  "dedupe_window_s": 600,
  "attribution_window_s": 3600,
  "default_metric": "spend",
  "default_k": 10
}
`,
      },
      {
        path: 'data/sample_events.jsonl',
        language: 'text',
        content: `{"event_id":"e1","ts":1000,"kind":"impression","ad_id":"ad_a","user_id":"u1","cost_micros":2000}
{"event_id":"e2","ts":1000,"kind":"impression","ad_id":"ad_b","user_id":"u2","cost_micros":2000}
{"event_id":"e3","ts":1005,"kind":"click","ad_id":"ad_a","user_id":"u1","cost_micros":300000}
{"event_id":"e3","ts":1005,"kind":"click","ad_id":"ad_a","user_id":"u1","cost_micros":300000}
{"event_id":"e4","ts":1010,"kind":"impression","ad_id":"ad_b","user_id":"u1","cost_micros":2000}
{"event_id":"e5","ts":1020,"kind":"click","ad_id":"ad_b","user_id":"u1","cost_micros":250000}
{"event_id":"e6","ts":1030,"kind":"click","ad_id":"ad_b","user_id":"u2","cost_micros":250000}
{"event_id":"e7","ts":"soon","kind":"click","ad_id":"ad_c","user_id":"u3"}
{"event_id":"e8","ts":1500,"kind":"conversion","user_id":"u1","value_micros":5000000}
{"event_id":"e9","ts":4630,"kind":"conversion","user_id":"u2","value_micros":2000000}
{"event_id":"e10","ts":4700,"kind":"impression","ad_id":"ad_c","user_id":"u3","cost_micros":2000}
{"event_id":"e11","ts":4800,"kind":"conversion","user_id":"u3","value_micros":1000000}
{"event_id":"e12","ts":4900,"kind":"click","ad_id":"ad_a","user_id":"u2","cost_micros":300000}
{"event_id":"e13","ts":5000,"kind":"conversion","user_id":"u2","value_micros":4000000}
`,
      },
      {
        path: 'main.py',
        content: `"""Repro for ADS-2291: "advertiser says conversions are credited to the wrong ad"."""
from adsagg.pipeline import run_pipeline
from adsagg.report import render

report = run_pipeline("data/sample_events.jsonl", k=3, metric="conversions")
print(render(report, "conversions"))
`,
      },
      {
        path: 'pyproject.toml',
        language: 'text',
        content: `[project]
name = "adsagg"
version = "2.4.1"
requires-python = ">=3.10"
description = "Hourly ads event aggregation"

[project.scripts]
adsagg = "adsagg.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
      },
      {
        path: 'tests/test_basics.py',
        content: `from adsagg.aggregate import AdStats
from adsagg.metrics import ctr, roas, dollars
from adsagg.schema import BadRecord, parse_line
from adsagg.topk import top_k


def test_ctr_and_roas_handle_zero():
    assert ctr(AdStats()) == 0.0
    assert roas(AdStats()) == 0.0
    assert ctr(AdStats(impressions=4, clicks=1)) == 0.25


def test_dollars_formatting():
    assert dollars(1_234_567) == "1.23"


def test_parse_rejects_click_without_ad():
    try:
        parse_line('{"event_id":"x","ts":1,"kind":"click","user_id":"u"}')
        assert False, "expected BadRecord"
    except BadRecord:
        pass


def test_top_k_orders_best_first():
    stats = {
        "ad1": AdStats(spend_micros=10),
        "ad2": AdStats(spend_micros=30),
        "ad3": AdStats(spend_micros=20),
    }
    assert top_k(stats, 2, "spend") == [("ad2", 30), ("ad3", 20)]
`,
      },
      {
        path: 'tests/test_pipeline_sample.py',
        content: `import os

from adsagg.pipeline import run_pipeline
from adsagg.timeutil import hour_from_filename, hour_label

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_sample_counts():
    r = run_pipeline(os.path.join(ROOT, "data", "sample_events.jsonl"))
    assert r.events == 13
    assert r.duplicates == 1
    assert r.bad_records == 1
    assert r.stats["ad_c"].impressions == 1


def test_hour_helpers_round_trip():
    ts = hour_from_filename("events-20240501-13.jsonl.gz")
    assert hour_label(ts + 1799) == "20240501-13"
`,
      },
      {
        path: 'tools/gen_events.py',
        content: `"""Deterministic synthetic event log.

    python tools/gen_events.py N [seed] > events.jsonl

Shape: N events over ~N/40 seconds, ~3% redelivered duplicates (emitted in
the same second as the original), clicks follow impressions, conversions
follow clicks.
"""
import json
import sys


def lcg(seed):
    s = seed & 0xFFFFFFFF
    while True:
        s = (1103515245 * s + 12345) & 0x7FFFFFFF
        yield s


def generate(n, seed=7, n_ads=2000, n_users=20000, start_ts=1_700_000_000):
    r = lcg(seed)
    ts = start_ts
    out = []
    i = 0
    while len(out) < n:
        if next(r) % 40 == 0:
            ts += 1
        u = "u%05d" % (next(r) % n_users)
        ad = "ad%04d" % (next(r) % n_ads)
        roll = next(r) % 100
        if roll < 80:
            ev = {"event_id": "e%d" % i, "ts": ts, "kind": "impression", "ad_id": ad, "user_id": u,
                  "cost_micros": 1000 + next(r) % 4000}
        elif roll < 95:
            ev = {"event_id": "e%d" % i, "ts": ts, "kind": "click", "ad_id": ad, "user_id": u,
                  "cost_micros": 50000 + next(r) % 450000}
        else:
            ev = {"event_id": "e%d" % i, "ts": ts, "kind": "conversion", "ad_id": "", "user_id": u,
                  "value_micros": 1000000 + next(r) % 9000000}
        i += 1
        out.append(ev)
        if next(r) % 33 == 0 and len(out) < n:
            out.append(dict(ev))  # redelivery, same second
    return out


def write_jsonl(events, fh):
    for ev in events:
        fh.write(json.dumps(ev, separators=(",", ":")))
        fh.write("\\n")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    seed = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    write_jsonl(generate(n, seed), sys.stdout)
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation',
        prompt: 'Skim `README.md`, `adsagg/pipeline.py` and the modules it calls. Which statements are true? **Select all that apply.**',
        options: [
          'Events are deduplicated before attribution sees them, so a redelivered click is never counted twice in `clicks` or `spend`.',
          'The whole input file is read into memory before the first event is processed.',
          'A conversion is credited to the `ad_id` field carried on the conversion event itself.',
          '`dedupe_window_s` and `attribution_window_s` are the same setting.',
          'A malformed line aborts the run with `BadRecord`.',
        ],
        correct: [0, 1],
        hints: [
          'Follow the loop in `run_pipeline`: what is called first for each event?',
          'Look at what `read_events` does before it returns.',
          'Check the README table for `ad_id` on conversions, and `config/pipeline.json`.',
        ],
        explanation: `- **True:** \`run_pipeline\` calls \`dedupe.accept\` first and \`continue\`s on duplicates, so neither the attributor nor the aggregator sees them.
- **True:** \`read_events\` does \`fh.read().splitlines()\` and builds a full \`events\` list before returning. That is both a memory problem (prod files are GBs) and the reason nothing streams; keep it in mind for stage 6.
- **False:** conversions come from the advertiser pixel and have an **empty** \`ad_id\`; crediting is done by \`LastClickAttributor\` via the user's click history.
- **False:** 600 s vs 3600 s in \`config/pipeline.json\`.
- **False:** \`read_events\` catches \`BadRecord\`, counts it in \`ReadStats\`, and skips the line; the report adds a note.`,
        timeLimitSec: 300,
        focusFile: 'adsagg/pipeline.py',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace one hour',
        prompt: 'Running `python -m adsagg.cli events.jsonl --metric spend`: put the steps in execution order.',
        items: [
          'cli.main parses arguments and load_config reads config/pipeline.json',
          'run_pipeline builds Deduper, LastClickAttributor and Aggregator',
          'read_events reads every line of the file into memory',
          'parse_line turns each line into an Event; malformed lines are counted and skipped',
          'Deduper.accept drops the event if its event_id was accepted within the window',
          'LastClickAttributor.observe records a click or resolves a conversion to an ad_id',
          'Aggregator.add updates the AdStats for the event (or the credited ad)',
          'top_k ranks all ads by the metric and render formats the report',
        ],
        hints: ['`read_events` parses every line before it returns a list; the dedupe/attribute/aggregate steps happen per event inside the pipeline loop afterwards.'],
        explanation: `Because \`read_events\` returns a list, *all* reading and parsing finishes before the first \`accept\` call: the pipeline is batch-shaped even though the loop body looks streaming. Once \`read_events\` becomes a generator (stage 6), parse and process interleave per line, with no code change in \`run_pipeline\`. Ranking and rendering run once at the end over the aggregated \`by_ad\` dict.`,
        timeLimitSec: 300,
        focusFile: 'adsagg/pipeline.py',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce ADS-2291',
        prompt: `\`main.py\` runs the pipeline over \`data/sample_events.jsonl\` (14 lines). Predict **exactly** what it prints.`,
        entry: 'main.py',
        answer: `events=13 dup=1 bad=1 unattributed=2
ad_a imp=1 clk=2 conv=1 spend=0.60 ctr=2.00
ad_b imp=2 clk=2 conv=1 spend=0.50 ctr=1.00
ad_c imp=1 clk=0 conv=0 spend=0.00 ctr=0.00
top by conversions: ad_a, ad_b, ad_c
note: skipped 1 malformed lines`,
        options: [
          `events=13 dup=1 bad=1 unattributed=1
ad_a imp=1 clk=2 conv=1 spend=0.60 ctr=2.00
ad_b imp=2 clk=2 conv=2 spend=0.50 ctr=1.00
ad_c imp=1 clk=0 conv=0 spend=0.00 ctr=0.00
top by conversions: ad_b, ad_a, ad_c
note: skipped 1 malformed lines`,
          `events=13 dup=1 bad=1 unattributed=2
ad_a imp=1 clk=2 conv=1 spend=0.60 ctr=2.00
ad_b imp=2 clk=2 conv=1 spend=0.50 ctr=1.00
ad_c imp=1 clk=0 conv=0 spend=0.00 ctr=0.00
top by conversions: ad_a, ad_b, ad_c
note: skipped 1 malformed lines`,
          `events=12 dup=1 bad=1 unattributed=2
ad_a imp=1 clk=2 conv=1 spend=0.60 ctr=2.00
ad_b imp=2 clk=2 conv=1 spend=0.50 ctr=1.00
ad_c imp=1 clk=0 conv=0 spend=0.00 ctr=0.00
top by conversions: ad_a, ad_b, ad_c
note: skipped 1 malformed lines`,
          `events=13 dup=1 bad=1 unattributed=3
ad_a imp=1 clk=2 conv=1 spend=0.60 ctr=2.00
ad_b imp=2 clk=2 conv=0 spend=0.50 ctr=1.00
ad_c imp=1 clk=0 conv=0 spend=0.00 ctr=0.00
top by conversions: ad_a, ad_b, ad_c
note: skipped 1 malformed lines`,
        ],
        hints: [
          '`events` counts every successfully parsed event, including the duplicate that dedupe later drops.',
          'What does `dict.setdefault` do when the key is already present?',
          'u2\'s conversion at 4630 is exactly 3600 s after their click at 1030. Is the window check `>` or `>=`?',
        ],
        explanation: `Walk the 14 lines:
- Line 8 (\`"ts":"soon"\`) fails \`int()\` → \`bad=1\`. The other 13 parse, so \`events=13\`; the second \`e3\` is a redelivery → \`dup=1\`.
- **The bug:** \`_last_click.setdefault(user, ...)\` only stores a user's **first** click; later clicks never overwrite it. That turns last-click into first-click attribution.
  - u1 clicked ad_a (1005) then ad_b (1020) and converted at 1500 → credited to **ad_a** (should be ad_b).
  - u2's first click is ad_b at 1030. Conversion at 4630: 4630 - 1030 = 3600, not \`> 3600\`, so it is inside the inclusive window → ad_b.
  - u3 never clicked → unattributed.
  - u2 clicks ad_a at 4900 (ignored by \`setdefault\`!) and converts at 5000: 5000 - 1030 = 3970 > 3600 → **unattributed** (should be ad_a).
- So conversions: ad_a 1, ad_b 1, unattributed 2. Ranking by conversions ties ad_a/ad_b at 1, broken by ascending id → \`ad_a, ad_b, ad_c\`.

Spend: ad_a = 2,000 + 300,000 + 300,000 micros = $0.60; ad_b = 2×2,000 + 2×250,000 = $0.50; ad_c's 2,000 micros prints as 0.00. The first option is what the *spec* says should happen.`,
        timeLimitSec: 540,
        focusFile: 'adsagg/attribution.py',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix attribution',
        prompt: `Fix ADS-2291 so attribution matches the README: a conversion goes to the user's **most recent** click, if it happened at most \`attribution_window_s\` seconds before the conversion (inclusive); otherwise it is \`unattributed\`.

Hidden tests exercise \`LastClickAttributor\` directly and run the pipeline end-to-end on \`data/sample_events.jsonl\`.`,
        editable: ['adsagg/attribution.py'],
        tests: [
          {
            path: 'tests/test_attribution_hidden.py',
            content: `import os

from adsagg.attribution import LastClickAttributor
from adsagg.pipeline import run_pipeline
from adsagg.schema import Event

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ev(eid, ts, kind, ad="", user="u1"):
    return Event(eid, ts, kind, ad, user, 0, 0)


def test_most_recent_click_wins():
    a = LastClickAttributor(3600)
    a.observe(ev("1", 100, "click", "ad_x"))
    a.observe(ev("2", 200, "click", "ad_y"))
    assert a.observe(ev("3", 300, "conversion")) == "ad_y"


def test_window_measured_from_latest_click_and_inclusive():
    a = LastClickAttributor(100)
    a.observe(ev("1", 0, "click", "ad_x"))
    a.observe(ev("2", 50, "click", "ad_y"))
    assert a.observe(ev("3", 150, "conversion")) == "ad_y"
    assert a.observe(ev("4", 151, "conversion")) is None
    assert a.unattributed == 1


def test_users_are_independent():
    a = LastClickAttributor(100)
    a.observe(ev("1", 0, "click", "ad_x", user="u1"))
    a.observe(ev("2", 10, "click", "ad_y", user="u2"))
    a.observe(ev("3", 20, "click", "ad_z", user="u1"))
    assert a.observe(ev("4", 30, "conversion", user="u2")) == "ad_y"
    assert a.observe(ev("5", 40, "conversion", user="u1")) == "ad_z"
    assert a.observe(ev("6", 50, "conversion", user="u3")) is None


def test_sample_log_end_to_end():
    r = run_pipeline(os.path.join(ROOT, "data", "sample_events.jsonl"), k=3, metric="conversions")
    assert r.unattributed == 1
    assert r.stats["ad_a"].conversions == 1
    assert r.stats["ad_b"].conversions == 2
    assert r.stats["ad_b"].value_micros == 7_000_000
    assert r.top == [("ad_b", 2), ("ad_a", 1), ("ad_c", 0)]
`,
          },
        ],
        solution: {
          'adsagg/attribution.py': `from collections import namedtuple

Click = namedtuple("Click", "ts ad_id")


class LastClickAttributor:
    """Credits each conversion to the user's most recent click within the window."""

    def __init__(self, window_s):
        self.window_s = window_s
        self._last_click = {}  # user_id -> Click
        self.unattributed = 0

    def observe(self, event):
        """Feed every accepted event in stream order.

        Returns the ad_id a conversion is credited to, or None (also None for
        non-conversion events).
        """
        if event.kind == "click":
            # overwrite: the MOST RECENT click wins
            self._last_click[event.user_id] = Click(event.ts, event.ad_id)
            return None
        if event.kind != "conversion":
            return None
        click = self._last_click.get(event.user_id)
        if click is None or event.ts - click.ts > self.window_s:
            self.unattributed += 1
            return None
        return click.ad_id

    def tracked_users(self):
        return len(self._last_click)
`,
        },
        hints: [
          'You found the line in stage 3.',
          'The window check is already inclusive; the window just has to be measured from the right click.',
        ],
        explanation: `Replace \`self._last_click.setdefault(user, click)\` with \`self._last_click[user] = click\`.

\`setdefault\` reads like "set" but means "get, and only set if missing". It is a common source of first-wins vs last-wins bugs in Python because both versions pass a test with a single click per user, which is exactly what the original unit tests had.

Note the stream-order assumption: overwriting is only "most recent" because the log is in non-decreasing \`ts\` order (README). If events could arrive out of order, you would compare timestamps before overwriting, and a conversion could arrive before the click that should explain it, which is a much harder (windowed join) problem.`,
        timeLimitSec: 480,
        focusFile: 'adsagg/attribution.py',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review the fast model\'s heap patch',
        prompt: 'You switch the assistant to the **fast** model and ask it to speed up `top_k`. Review the reply before you use it in the next stage.',
        persona: 'confident-intern',
        request: 'top_k is O(n*k). Rewrite it with a heap; keep the same output contract.',
        aiReply: `Easy win, \`heapq\` does exactly this in O(n log k):

\`\`\`python
import heapq

from adsagg.metrics import METRICS


def top_k(stats_by_ad, k, metric="spend"):
    if metric not in METRICS:
        raise ValueError("unknown metric %r" % (metric,))
    fn = METRICS[metric]
    return heapq.nlargest(
        k,
        ((ad_id, fn(s)) for ad_id, s in stats_by_ad.items()),
        key=lambda t: (t[1], t[0]),
    )
\`\`\`

Including \`ad_id\` in the key makes ties deterministic, and \`nlargest\` already returns best-first. Same contract, ~100x faster on big inputs ✅`,
        options: [
          'Accept: it is O(n log k), deterministic, and returns best-first like the original.',
          'Reject: on ties it ranks the *larger* `ad_id` first, but the contract (README and the original loop) puts the smaller `ad_id` first. Use `heapq.nsmallest(k, items, key=lambda t: (-t[1], t[0]))`.',
          'Reject: `nlargest` materialises the whole generator into a list and sorts it, so it is still O(n log n).',
          'Reject: `nlargest` returns results in ascending order, so the leaderboard would be reversed.',
          'Reject: it raises `IndexError` when `k` is larger than the number of ads.',
        ],
        correct: 1,
        hints: [
          'With key `(value, ad_id)`, which of `("ad2", 3)` and `("ad9", 3)` is "larger"?',
          'Re-read the docstring of the original `top_k` and the README "Ranking" section.',
        ],
        explanation: `\`nlargest\` with key \`(value, ad_id)\` treats \`(3, "ad9") > (3, "ad2")\`, so among equal values the **larger** id wins: the opposite of the documented tie-break. With \`conversions\` (small integers, lots of ties) this reorders the leaderboard every hour. You cannot negate a string, so flip the problem: the best-first, smaller-id-on-tie order is the ascending order of \`(-value, ad_id)\`, which is \`heapq.nsmallest\`.

The other claims are false: \`nlargest\` keeps a k-sized heap (O(n log k), O(k) memory), returns results best-first, and returns everything when \`k >= n\`. The model's "same contract" claim is the tell: it was never checked against the tie-break rule, and the visible test has no ties.`,
        timeLimitSec: 420,
        focusFile: 'adsagg/topk.py',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'optimise',
        title: 'Make the hour fit (ADS-2304)',
        prompt: `Full-hour files now time out. The hidden test generates **120,000 events** with \`tools/gen_events.py\` and requires:

- \`read_events\` to be **lazy** (a generator) so memory no longer scales with file size;
- \`run_pipeline\` on the full file in **under 4 s**, with results identical to the documented semantics (dedupe, last-click attribution, all stats, leaderboard);
- \`top_k\` over 200,000 ads with \`k = 2000\` in under 2 s, with the README tie-break.

Profile before you optimise: one hot spot is not where most people look. Your attribution fix from stage 4 must be included (re-apply it if your editor was reset).`,
        editable: ['adsagg/reader.py', 'adsagg/dedupe.py', 'adsagg/topk.py', 'adsagg/attribution.py', 'adsagg/pipeline.py'],
        tests: [
          {
            path: 'tests/test_scale_hidden.py',
            content: `import inspect
import os
import tempfile
import time

from adsagg.aggregate import AdStats
from adsagg.pipeline import run_pipeline
from adsagg.reader import read_events
from adsagg.topk import top_k
from tools.gen_events import generate, write_jsonl

N = 120_000
CFG = {"dedupe_window_s": 600, "attribution_window_s": 3600}


def _write(events):
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w") as fh:
        write_jsonl(events, fh)
    return path


def _reference(events):
    """Straightforward dict-based model of the documented semantics."""
    accepted_at, last_click, stats = {}, {}, {}
    dups = unattributed = 0
    for e in events:
        eid, ts = e["event_id"], e["ts"]
        if eid in accepted_at and accepted_at[eid] >= ts - CFG["dedupe_window_s"]:
            dups += 1
            continue
        accepted_at[eid] = ts
        if e["kind"] == "conversion":
            c = last_click.get(e["user_id"])
            if c is None or ts - c[0] > CFG["attribution_window_s"]:
                unattributed += 1
                continue
            s = stats.setdefault(c[1], [0, 0, 0, 0, 0])
            s[2] += 1
            s[4] += e["value_micros"]
            continue
        s = stats.setdefault(e["ad_id"], [0, 0, 0, 0, 0])
        if e["kind"] == "impression":
            s[0] += 1
        else:
            s[1] += 1
            last_click[e["user_id"]] = (ts, e["ad_id"])
        s[3] += e["cost_micros"]
    return stats, dups, unattributed


def _expected_top(ref, k, idx):
    return [(a, v[idx]) for a, v in sorted(ref.items(), key=lambda kv: (-kv[1][idx], kv[0]))[:k]]


def test_read_events_is_lazy():
    path = _write(generate(50, seed=3))
    try:
        it = read_events(path)
        assert inspect.isgenerator(it), "read_events must yield events lazily"
        assert next(it).event_id == "e0"
    finally:
        os.remove(path)


def test_top_k_ties_go_to_smaller_ad_id():
    stats = {
        "ad9": AdStats(conversions=3),
        "ad2": AdStats(conversions=3),
        "ad5": AdStats(conversions=7),
        "ad1": AdStats(conversions=1),
        "ad3": AdStats(conversions=3),
    }
    assert top_k(stats, 3, "conversions") == [("ad5", 7), ("ad2", 3), ("ad3", 3)]
    assert top_k(stats, 10, "conversions")[-1] == ("ad1", 1)
    assert top_k(stats, 0, "conversions") == []


def test_top_k_large_k_is_fast():
    stats = {"ad%06d" % i: AdStats(spend_micros=(i * 7919) % 100_003) for i in range(200_000)}
    t = time.perf_counter()
    got = top_k(stats, 2000, "spend")
    elapsed = time.perf_counter() - t
    expected = sorted(((a, s.spend_micros) for a, s in stats.items()), key=lambda t: (-t[1], t[0]))[:2000]
    assert got == expected
    assert elapsed < 2.0, "top_k took %.2fs" % elapsed


def test_full_hour_matches_reference_within_budget():
    events = generate(N, seed=11)
    path = _write(events)
    try:
        t = time.perf_counter()
        r = run_pipeline(path, k=25, metric="conversions", config=CFG)
        elapsed = time.perf_counter() - t
    finally:
        os.remove(path)
    ref, dups, unattributed = _reference(events)
    assert r.events == len(events)
    assert r.duplicates == dups
    assert r.unattributed == unattributed
    assert len(r.stats) == len(ref)
    for ad_id, v in ref.items():
        s = r.stats[ad_id]
        assert [s.impressions, s.clicks, s.conversions, s.spend_micros, s.value_micros] == v, ad_id
    assert r.top == _expected_top(ref, 25, 2)
    assert elapsed < 4.0, "pipeline took %.2fs" % elapsed
`,
          },
        ],
        solution: {
          'adsagg/reader.py': `import gzip

from adsagg.schema import BadRecord, parse_line


class ReadStats:
    def __init__(self):
        self.lines = 0
        self.bad = 0
        self.samples = []  # first few bad lines, for the run log

    def record_bad(self, line, err):
        self.bad += 1
        if len(self.samples) < 5:
            self.samples.append((line[:120], str(err)))


def _open(path):
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")


def read_events(path, stats=None):
    """Yield parsed events in file order, one line at a time. Malformed lines are counted and skipped."""
    stats = stats if stats is not None else ReadStats()
    with _open(path) as fh:
        for line in fh:  # file objects iterate lazily, one buffered line at a time
            if not line.strip():
                continue
            stats.lines += 1
            try:
                yield parse_line(line)
            except BadRecord as e:
                stats.record_bad(line, e)
`,
          'adsagg/dedupe.py': `from collections import deque


class Deduper:
    """Drops events whose event_id was already accepted within the last \`window_s\` seconds.

    The shipper is at-least-once and always redelivers within the window, so we
    only need to remember recent ids. Memory is bounded by the window.
    """

    def __init__(self, window_s):
        self.window_s = window_s
        self._order = deque()  # (ts, event_id) in arrival order, for eviction
        self._live = {}        # event_id -> ts it was accepted at (O(1) membership)
        self.dropped = 0

    def _evict(self, now):
        horizon = now - self.window_s
        order, live = self._order, self._live
        while order and order[0][0] < horizon:
            ts, eid = order.popleft()
            if live.get(eid) == ts:
                del live[eid]

    def accept(self, event):
        self._evict(event.ts)
        if event.event_id in self._live:
            self.dropped += 1
            return False
        self._live[event.event_id] = event.ts
        self._order.append((event.ts, event.event_id))
        return True
`,
          'adsagg/topk.py': `import heapq

from adsagg.metrics import METRICS


def top_k(stats_by_ad, k, metric="spend"):
    """Return [(ad_id, value)] for the k best ads by \`metric\`, best first.

    Ties on the metric value go to the smaller ad_id.
    """
    if metric not in METRICS:
        raise ValueError("unknown metric %r" % (metric,))
    if k <= 0:
        return []
    fn = METRICS[metric]
    # "Best first, ties by ascending ad_id" == smallest by (-value, ad_id).
    # nsmallest keeps a k-sized heap: O(n log k) time, O(k) extra memory.
    return heapq.nsmallest(
        k,
        ((ad_id, fn(s)) for ad_id, s in stats_by_ad.items()),
        key=lambda t: (-t[1], t[0]),
    )
`,
          'adsagg/attribution.py': `from collections import namedtuple

Click = namedtuple("Click", "ts ad_id")


class LastClickAttributor:
    """Credits each conversion to the user's most recent click within the window."""

    def __init__(self, window_s):
        self.window_s = window_s
        self._last_click = {}  # user_id -> Click
        self.unattributed = 0

    def observe(self, event):
        """Feed every accepted event in stream order.

        Returns the ad_id a conversion is credited to, or None (also None for
        non-conversion events).
        """
        if event.kind == "click":
            # overwrite: the MOST RECENT click wins
            self._last_click[event.user_id] = Click(event.ts, event.ad_id)
            return None
        if event.kind != "conversion":
            return None
        click = self._last_click.get(event.user_id)
        if click is None or event.ts - click.ts > self.window_s:
            self.unattributed += 1
            return None
        return click.ad_id

    def tracked_users(self):
        return len(self._last_click)
`,
        },
        timeoutMs: 8000,
        hints: [
          '`Deduper` looks bounded, but how many ids are inside a 600 s window at ~20 events/s, and how is membership checked?',
          '`list.pop(0)` is O(n) too. `collections.deque` + a dict of live ids gives O(1) amortised accept/evict.',
          'For `read_events`, iterate the file object (`for line in fh`) and `yield`. For `top_k`, see the corrected version from stage 5.',
        ],
        explanation: `Three changes, in order of impact:

1. **Dedupe (the real hot spot).** The "bounded" window still holds ~12k ids at test rates (millions at prod rates), and every \`accept\` linearly scanned them: O(n × window). Keep a \`dict\` of live ids for O(1) membership plus a \`deque\` of \`(ts, id)\` for FIFO eviction; on eviction only delete the dict entry if it still belongs to that deque entry. This alone takes the test from minutes to well under a second. Lesson: "bounded" is not the same as "small", and a comment saying *memory is bounded* says nothing about time.
2. **Stream the input.** \`for line in fh: ... yield\` makes memory O(1) in file size; \`run_pipeline\` already iterates, so it needs no change. (For prod-sized gz files this is the difference between OOM and done.)
3. **Heap top-k.** \`heapq.nsmallest(k, ..., key=lambda t: (-t[1], t[0]))\`: O(n log k) time and O(k) memory, with the README tie-break (the stage 5 trap).

Attribution stays O(1) per event; its memory is one entry per active user, which you could also expire with the attribution window if users are unbounded.`,
        timeLimitSec: 1080,
        focusFile: 'adsagg/dedupe.py',
      },
      {
        id: 's7',
        kind: 'mcq',
        title: 'Follow-up: 50 GB an hour',
        prompt: 'Traffic grows to 50 GB of events per hour, so the job must run on many workers in parallel. Which designs produce **correct** results? **Select all that apply.**',
        options: [
          'Partition events by `hash(ad_id)`; each worker computes its own top-k; merging the W per-worker top-k lists and taking the top k overall is exact.',
          'Partition events by `hash(event_id)`; each worker computes its own top-k; merging the per-worker top-k lists is exact, because duplicates still land on the same worker.',
          'Attribution needs a user\'s clicks and conversions together: partition by `hash(user_id)` for dedupe + attribution, emit (credited ad, deltas), then re-partition by `ad_id` to aggregate and rank.',
          'Partition by `hash(ad_id)` for the whole job, including attribution, since conversions are always attributed to an ad.',
          'Keep a single worker but replace the dedupe dict with a Bloom filter sized for the hour: memory drops and counts stay exact.',
        ],
        correct: [0, 2],
        hints: [
          'For a merged top-k to be exact, each ad\'s total must be complete on exactly one worker.',
          'Which key does a conversion event actually carry?',
          'What kind of errors can a Bloom filter make?',
        ],
        explanation: `- **By \`ad_id\` then merge (exact):** every ad's full total lives on one worker, so the global top-k is contained in the union of per-worker top-k lists.
- **By \`event_id\` (wrong):** dedupe works, but each ad's events are scattered, so each worker sees **partial sums**. An ad ranked 11th everywhere can be 1st globally: merging local top-k lists of partial sums is not exact (that is the classic distributed top-k pitfall; you need a full re-aggregation by ad or a threshold algorithm).
- **user_id shuffle then ad_id shuffle (exact):** attribution is a per-user join, so it needs per-user co-location; aggregation needs per-ad co-location. Two shuffles, two keys: the standard map-reduce shape for this job. (Duplicates share \`event_id\`, \`user_id\` and everything else, so dedupe also works after partitioning by user.)
- **\`ad_id\` for attribution (wrong):** conversions have an **empty** \`ad_id\`; you cannot route them to the worker holding the user's clicks.
- **Bloom filter (wrong for exact counts):** false positives drop real events as "duplicates". Fine for approximate dashboards, not for billing-adjacent numbers like spend.`,
        timeLimitSec: 420,
        focusFile: 'README.md',
      },
    ],
  },
];

export default problems;
