import type { Problem } from '../types';

/**
 * L5 full interview simulations (part 2): Atlassian-style workflow engine and
 * Canva-style export queue. Generated from real files and validated with
 * `npm run validate -- l5-sim2.ts`.
 */
const problems: Problem[] = [
  {
    id: 'l5-sim-atlassian-workflow',
    title: 'Simulation: Jira-style Workflow Engine',
    level: 5,
    rating: 2400,
    lang: 'typescript',
    domain: 'workflow',
    companies: ['atlassian'],
    tags: ['interview-simulation', 'state-machine', 'permissions', 'webhooks', 'aliasing', 'agent-mode', 'feature'],
    summary: 'Orient in an issue workflow engine, root-cause a missing webhook changelog, review an agent\'s multi-file fix, then ship the "which buttons do I show?" API.',
    context: `**Atlassian-style AI-enabled repo round: 7 stages, one codebase, ~65 minutes.**

You have joined the team that owns the engine behind the transition buttons on every issue ("Start progress", "Done", "Reopen"). It owns workflow definitions, permission schemes and the outbound webhooks that the Slack and CI integrations consume.

The assistant panel runs in **agent mode**: it can plan and edit several files at once. It is fast, and it tends to over-edit. You decide what ships.

Start with \`README.md\`, then \`src/engine/transitionService.ts\`. The interviewer cares about how you navigate, how you verify, and whether you can explain *why*.`,
    persona: 'agent-mode',
    files: [
      {
        path: "README.md",
        language: 'markdown',
        content: `# issue-workflow-engine

The service behind the transition buttons on every issue ("Start progress",
"Done", "Reopen"...). It owns workflow definitions, permission checks and the
outbound webhooks that Slack / CI integrations consume.

## Layout

| Path | What lives there |
| --- | --- |
| \`src/domain/types.ts\` | \`Issue\`, \`User\`, \`WorkflowError\`, changelog types |
| \`src/workflow/\` | Workflow definitions (\`softwareWorkflow.ts\`) and the per-project registry |
| \`src/permissions/\` | Permission scheme, project roles, \`PermissionChecker\` |
| \`src/engine/\` | \`TransitionService\` plus the rule plug-ins: conditions, validators, post-functions, changelog |
| \`src/store/\` | \`IssueRepository\` (in-memory here, Postgres in prod; same compare-and-set contract) |
| \`src/events/\` | Synchronous in-process \`EventBus\` |
| \`src/webhooks/\` | Subscription matching, payload builder, outbox + \`flush()\` |
| \`src/app.ts\` | Composition root used by tests and \`scripts/demo.ts\` |

## Transition pipeline

1. Load the issue (the repository always hands out a **private copy**).
2. Hide issues the actor cannot browse (\`NOT_FOUND\`, never \`FORBIDDEN\`).
3. Check the transition exists and is available from the current status.
4. **Conditions**: is this transition offered to this user? (side-effect free; the UI calls them too)
5. **Validators**: are the values on the transition screen acceptable?
6. Apply status, screen values, then **post-functions** (in definition order).
7. \`repo.save(issue, expectedVersion)\`: compare-and-set; a concurrent writer gets \`CONFLICT\`.
8. Publish \`issue_transitioned\` with a field-level changelog. The webhook dispatcher
   matches subscriptions synchronously but only *enqueues*; a scheduler calls \`flush()\`.

## Conventions

- Site admins (\`jira-admins\`) bypass permission schemes. This is intentional.
- Global transitions (\`from: '*'\`) are offered from every status except their own target.
- Webhook consumers rely on \`changelog.items\` to see *what* changed, and on
  \`issue.version\` to drop stale/out-of-order deliveries.

## Known issues

- PAY-812: the Slack integration says "Lena moved PAY-1 to Done" but never shows
  the resolution or the new assignee, even though the issue view shows them.
`,
      },
      {
        path: "src/app.ts",
        content: `import type { Issue, IssueFields, User } from './domain/types';
import { InMemoryIssueRepository } from './store/issueRepository';
import { WorkflowRegistry } from './workflow/definition';
import { softwareWorkflow } from './workflow/softwareWorkflow';
import { ProjectRoles } from './permissions/permissionScheme';
import type { RoleTable } from './permissions/permissionScheme';
import { PermissionChecker } from './permissions/permissionChecker';
import { defaultScheme } from './permissions/permissionScheme';
import { EventBus } from './events/eventBus';
import { WebhookDispatcher } from './webhooks/webhookDispatcher';
import type { HttpClient, Subscription } from './webhooks/webhookDispatcher';
import { TransitionService } from './engine/transitionService';
import { FixedClock } from './util/clock';

export interface AppOptions {
  roles: RoleTable;
  subscriptions?: Subscription[];
  http?: HttpClient;
  startTime?: string;
}

/** Composition root. Production wiring lives in server.ts (not part of this exercise). */
export function createApp(opts: AppOptions) {
  const clock = new FixedClock(opts.startTime ?? '2024-03-01T09:00:00.000Z');
  const repo = new InMemoryIssueRepository();
  const workflows = new WorkflowRegistry();
  workflows.register(softwareWorkflow);
  for (const project of Object.keys(opts.roles)) workflows.assign(project, softwareWorkflow.id);
  const permissions = new PermissionChecker(defaultScheme, new ProjectRoles(opts.roles));
  const bus = new EventBus();
  const http: HttpClient = opts.http ?? { post: () => ({ status: 200 }) };
  const webhooks = new WebhookDispatcher(opts.subscriptions ?? [], http);
  webhooks.attach(bus);
  const transitions = new TransitionService({ repo, workflows, permissions, bus, clock });

  let seq = 0;
  function createIssue(
    project: string,
    reporter: string,
    fields: Partial<IssueFields> = {},
    extra: Partial<Pick<Issue, 'type' | 'parentKey'>> = {},
  ): Issue {
    seq++;
    const now = clock.now();
    return repo.insert({
      key: \`\${project}-\${seq}\`,
      project,
      type: extra.type ?? 'story',
      status: workflows.forIssue({ project, type: extra.type ?? 'story' }).initialStatus,
      parentKey: extra.parentKey ?? null,
      fields: {
        summary: 'Untitled',
        assignee: null,
        reporter,
        resolution: null,
        labels: [],
        dueDate: null,
        storyPoints: null,
        ...fields,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { clock, repo, workflows, permissions, bus, webhooks, transitions, createIssue };
}

export function user(id: string, groups: string[] = []): User {
  return { id, displayName: id, groups };
}
`,
      },
      {
        path: "src/domain/types.ts",
        content: `/**
 * Core domain types for the issue workflow engine.
 * Dates are real Date objects everywhere inside the engine; they are only
 * converted to ISO strings at the edge (webhook payloads, REST responses).
 */

export type IssueType = 'story' | 'bug' | 'task' | 'subtask';

export interface IssueFields {
  summary: string;
  assignee: string | null;
  reporter: string;
  resolution: string | null;
  labels: string[];
  dueDate: Date | null;
  storyPoints: number | null;
}

export type FieldName = keyof IssueFields;

export interface Issue {
  key: string;
  project: string;
  type: IssueType;
  status: string;
  parentKey: string | null;
  fields: IssueFields;
  /** Incremented by the repository on every successful save (optimistic locking). */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  displayName: string;
  groups: string[];
}

export interface ChangeItem {
  field: string;
  from: unknown;
  to: unknown;
}

export interface TransitionInput {
  /** Values entered on the transition screen. Fields not on the screen are ignored. */
  fields?: Partial<IssueFields>;
  /** Version the user was looking at when they clicked the button. */
  expectedVersion?: number;
}

export interface TransitionResult {
  issue: Issue;
  changelog: ChangeItem[];
}

export type WorkflowErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'CONDITION_FAILED'
  | 'VALIDATION_FAILED'
  | 'CONFLICT';

export class WorkflowError extends Error {
  constructor(public code: WorkflowErrorCode, message: string, public details: string[] = []) {
    super(message);
    this.name = 'WorkflowError';
  }
}
`,
      },
      {
        path: "src/engine/changelog.ts",
        content: `import type { ChangeItem, FieldName, Issue } from '../domain/types';

/** Order in which changed fields appear in the changelog (matches the issue view). */
export const FIELD_ORDER: FieldName[] = [
  'summary',
  'assignee',
  'reporter',
  'resolution',
  'labels',
  'dueDate',
  'storyPoints',
];

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/** Field-level diff between two snapshots of the same issue. */
export function diffIssues(before: Issue, after: Issue): ChangeItem[] {
  const items: ChangeItem[] = [];
  if (before.status !== after.status) {
    items.push({ field: 'status', from: before.status, to: after.status });
  }
  for (const f of FIELD_ORDER) {
    const a = before.fields[f];
    const b = after.fields[f];
    if (!sameValue(a, b)) items.push({ field: f, from: a, to: b });
  }
  return items;
}
`,
      },
      {
        path: "src/engine/conditions.ts",
        content: `import type { ConditionRef } from '../workflow/definition';
import { statusCategory } from '../workflow/definition';
import type { Issue, User } from '../domain/types';
import type { PermissionChecker } from '../permissions/permissionChecker';
import type { IssueRepository } from '../store/issueRepository';
import type { Clock } from '../util/clock';
import type { WorkflowDef } from '../workflow/definition';

/** Everything a condition / validator / post-function may look at. */
export interface RuleContext {
  issue: Issue;
  actor: User;
  workflow: WorkflowDef;
  permissions: PermissionChecker;
  repo: IssueRepository;
  clock: Clock;
}

/**
 * Conditions decide whether a transition is *offered* to a user at all.
 * They must be side-effect free: the UI evaluates them to decide which
 * buttons to render.
 *
 * Returns the reason for the first failing condition, or null if all pass.
 */
export function evaluateConditions(conditions: ConditionRef[], ctx: RuleContext): string | null {
  for (const c of conditions) {
    const reason = check(c, ctx);
    if (reason) return reason;
  }
  return null;
}

function check(c: ConditionRef, ctx: RuleContext): string | null {
  switch (c.type) {
    case 'permission':
      return ctx.permissions.has(ctx.actor, c.permission, ctx.issue)
        ? null
        : \`missing permission \${c.permission}\`;
    case 'onlyAssignee':
      return ctx.issue.fields.assignee === ctx.actor.id ? null : 'only the assignee can do this';
    case 'subtasksDone': {
      const open = ctx.repo
        .findChildren(ctx.issue.key)
        .filter((child) => statusCategory(ctx.workflow, child.status) !== 'done');
      return open.length === 0 ? null : \`\${open.length} open subtask(s)\`;
    }
  }
}
`,
      },
      {
        path: "src/engine/postFunctions.ts",
        content: `import type { PostFunctionRef } from '../workflow/definition';
import type { RuleContext } from './conditions';

/**
 * Post-functions run after the status has changed and mutate ctx.issue in place.
 * Order matters and follows the workflow definition.
 */
export function applyPostFunctions(fns: PostFunctionRef[], ctx: RuleContext): void {
  for (const fn of fns) {
    switch (fn.type) {
      case 'setResolution':
        // Keep a resolution the user picked on the screen; otherwise use the default.
        if (!ctx.issue.fields.resolution) ctx.issue.fields.resolution = fn.value;
        break;
      case 'clearResolution':
        ctx.issue.fields.resolution = null;
        break;
      case 'assignToReporter':
        ctx.issue.fields.assignee = ctx.issue.fields.reporter;
        break;
      case 'assignToActorIfUnassigned':
        if (ctx.issue.fields.assignee === null) ctx.issue.fields.assignee = ctx.actor.id;
        break;
    }
  }
}
`,
      },
      {
        path: "src/engine/transitionService.ts",
        content: `import { WorkflowError } from '../domain/types';
import type { Issue, TransitionInput, TransitionResult, User } from '../domain/types';
import { findTransition } from '../workflow/definition';
import type { TransitionDef } from '../workflow/definition';
import type { WorkflowRegistry } from '../workflow/definition';
import type { PermissionChecker } from '../permissions/permissionChecker';
import type { IssueRepository } from '../store/issueRepository';
import type { EventBus } from '../events/eventBus';
import type { Clock } from '../util/clock';
import type { RuleContext } from './conditions';
import { evaluateConditions } from './conditions';
import { pickScreenFields, runValidators } from './validators';
import { applyPostFunctions } from './postFunctions';
import { diffIssues } from './changelog';

export interface TransitionServiceDeps {
  repo: IssueRepository;
  workflows: WorkflowRegistry;
  permissions: PermissionChecker;
  bus: EventBus;
  clock: Clock;
}

export class TransitionService {
  constructor(private deps: TransitionServiceDeps) {}

  transition(key: string, transitionId: string, actor: User, input: TransitionInput = {}): TransitionResult {
    const { repo, workflows, permissions, bus, clock } = this.deps;

    const issue = repo.get(key);
    // Users who cannot browse the project must not learn that the issue exists.
    if (!issue || !permissions.has(actor, 'BROWSE_PROJECTS', issue)) {
      throw new WorkflowError('NOT_FOUND', \`issue \${key} not found\`);
    }

    const workflow = workflows.forIssue(issue);
    const t = findTransition(workflow, transitionId);
    if (!t || !this.isAvailableFrom(t, issue.status)) {
      throw new WorkflowError('INVALID_TRANSITION', \`\${transitionId} is not available from \${issue.status}\`);
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== issue.version) {
      throw new WorkflowError('CONFLICT', \`issue \${key} was modified (v\${issue.version})\`);
    }

    const ctx: RuleContext = { issue, actor, workflow, permissions, repo, clock };

    const failed = evaluateConditions(t.conditions, ctx);
    if (failed) throw new WorkflowError('CONDITION_FAILED', failed);

    const screenValues = pickScreenFields(t, input.fields);
    const errors = runValidators(t.validators, ctx, screenValues);
    if (errors.length) throw new WorkflowError('VALIDATION_FAILED', 'validation failed', errors);

    const before: Issue = { ...issue };

    issue.status = t.to;
    Object.assign(issue.fields, screenValues);
    applyPostFunctions(t.postFunctions, ctx);
    issue.updatedAt = clock.now();

    const saved = repo.save(issue, before.version);
    const changelog = diffIssues(before, saved);

    bus.publish({
      type: 'issue_transitioned',
      at: clock.now(),
      actor: actor.id,
      issue: saved,
      transition: { id: t.id, name: t.name, from: before.status, to: t.to },
      changelog,
    });

    return { issue: saved, changelog };
  }

  private isAvailableFrom(t: TransitionDef, status: string): boolean {
    // A global transition is offered from every status except its own target.
    if (t.from === '*') return t.to !== status;
    return t.from.includes(status);
  }
}
`,
      },
      {
        path: "src/engine/validators.ts",
        content: `import type { IssueFields } from '../domain/types';
import type { TransitionDef, ValidatorRef } from '../workflow/definition';
import type { RuleContext } from './conditions';

/**
 * Keep only the inputs that are on the transition's screen. Anything else the
 * client sent is silently dropped (clients routinely send the whole form).
 */
export function pickScreenFields(t: TransitionDef, input: Partial<IssueFields> | undefined): Partial<IssueFields> {
  const out: Partial<IssueFields> = {};
  if (!input) return out;
  for (const f of t.screen) {
    if (f in input) (out as Record<string, unknown>)[f] = input[f];
  }
  return out;
}

/**
 * Validators run after conditions, against the issue *as it would look* with
 * the screen values applied. Returns every message (the UI shows them all).
 */
export function runValidators(
  validators: ValidatorRef[],
  ctx: RuleContext,
  screenValues: Partial<IssueFields>,
): string[] {
  const merged: IssueFields = { ...ctx.issue.fields, ...screenValues };
  const errors: string[] = [];
  for (const v of validators) {
    if (v.type === 'fieldRequired') {
      const value = merged[v.field];
      const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
      if (empty) errors.push(v.message);
    }
  }
  return errors;
}
`,
      },
      {
        path: "src/events/eventBus.ts",
        content: `import type { ChangeItem, Issue } from '../domain/types';

export interface IssueTransitionedEvent {
  type: 'issue_transitioned';
  at: Date;
  actor: string;
  issue: Issue;
  transition: { id: string; name: string; from: string; to: string };
  changelog: ChangeItem[];
}

export type DomainEvent = IssueTransitionedEvent;
export type Handler = (e: DomainEvent) => void;

/**
 * Synchronous in-process bus. A failing subscriber is logged and skipped:
 * the transition has already been committed, so a broken integration must
 * not turn a successful user action into an error.
 */
export class EventBus {
  private handlers: Handler[] = [];
  readonly errors: string[] = [];

  subscribe(h: Handler): () => void {
    this.handlers.push(h);
    return () => {
      this.handlers = this.handlers.filter((x) => x !== h);
    };
  }

  publish(e: DomainEvent): void {
    for (const h of [...this.handlers]) {
      try {
        h(e);
      } catch (err) {
        this.errors.push(\`\${e.type}: \${(err as Error).message}\`);
      }
    }
  }
}
`,
      },
      {
        path: "src/permissions/permissionChecker.ts",
        content: `import type { Issue, User } from '../domain/types';
import type { Grant, Holder, Permission } from './permissionScheme';
import type { ProjectRoles } from './permissionScheme';

/** Site administrators bypass project permission schemes entirely (product decision, see README). */
export const SITE_ADMIN_GROUP = 'jira-admins';

export class PermissionChecker {
  constructor(private scheme: Grant[], private roles: ProjectRoles) {}

  has(user: User, permission: Permission, issue: Issue): boolean {
    if (user.groups.includes(SITE_ADMIN_GROUP)) return true;
    return this.scheme.some((g) => g.permission === permission && this.holds(user, g.holder, issue));
  }

  private holds(user: User, holder: Holder, issue: Issue): boolean {
    switch (holder.type) {
      case 'role':
        return this.roles.rolesOf(user.id, issue.project).includes(holder.role);
      case 'group':
        return user.groups.includes(holder.group);
      case 'reporter':
        return issue.fields.reporter === user.id;
      case 'assignee':
        // An unassigned issue (assignee === null) must never match a real user id.
        return issue.fields.assignee !== null && issue.fields.assignee === user.id;
    }
  }
}
`,
      },
      {
        path: "src/permissions/permissionScheme.ts",
        content: `export type Permission =
  | 'BROWSE_PROJECTS'
  | 'TRANSITION_ISSUES'
  | 'RESOLVE_ISSUES'
  | 'ASSIGN_ISSUES'
  | 'ADMINISTER_PROJECTS';

export type Holder =
  | { type: 'role'; role: string }
  | { type: 'group'; group: string }
  | { type: 'reporter' }
  | { type: 'assignee' };

export interface Grant {
  permission: Permission;
  holder: Holder;
}

/**
 * Default permission scheme shared by all projects unless overridden.
 * Note: 'reporter' and 'assignee' holders are evaluated against the issue,
 * so the same user can hold a permission on one issue and not on another.
 */
export const defaultScheme: Grant[] = [
  { permission: 'BROWSE_PROJECTS', holder: { type: 'role', role: 'viewer' } },
  { permission: 'BROWSE_PROJECTS', holder: { type: 'role', role: 'developer' } },
  { permission: 'BROWSE_PROJECTS', holder: { type: 'role', role: 'lead' } },
  { permission: 'TRANSITION_ISSUES', holder: { type: 'role', role: 'developer' } },
  { permission: 'TRANSITION_ISSUES', holder: { type: 'role', role: 'lead' } },
  { permission: 'RESOLVE_ISSUES', holder: { type: 'role', role: 'lead' } },
  { permission: 'RESOLVE_ISSUES', holder: { type: 'assignee' } },
  { permission: 'ASSIGN_ISSUES', holder: { type: 'role', role: 'lead' } },
  { permission: 'ADMINISTER_PROJECTS', holder: { type: 'role', role: 'lead' } },
];

/** project key -> role name -> user ids */
export type RoleTable = Record<string, Record<string, string[]>>;

export class ProjectRoles {
  constructor(private table: RoleTable) {}

  rolesOf(userId: string, project: string): string[] {
    const roles = this.table[project] ?? {};
    return Object.keys(roles).filter((role) => roles[role].includes(userId));
  }

  add(project: string, role: string, userId: string): void {
    const p = (this.table[project] ??= {});
    const members = (p[role] ??= []);
    if (!members.includes(userId)) members.push(userId);
  }
}
`,
      },
      {
        path: "src/store/issueRepository.ts",
        content: `import { WorkflowError } from '../domain/types';
import type { Issue } from '../domain/types';

export interface IssueRepository {
  /** Returns a private copy; mutating it does not affect the store until save(). */
  get(key: string): Issue | undefined;
  /** Compare-and-set on version. Returns the stored copy with the new version. */
  save(issue: Issue, expectedVersion: number): Issue;
  insert(issue: Issue): Issue;
  findChildren(parentKey: string): Issue[];
}

export function cloneIssue(i: Issue): Issue {
  return {
    ...i,
    fields: {
      ...i.fields,
      labels: [...i.fields.labels],
      dueDate: i.fields.dueDate ? new Date(i.fields.dueDate.getTime()) : null,
    },
    createdAt: new Date(i.createdAt.getTime()),
    updatedAt: new Date(i.updatedAt.getTime()),
  };
}

export class InMemoryIssueRepository implements IssueRepository {
  private rows = new Map<string, Issue>();

  get(key: string): Issue | undefined {
    const row = this.rows.get(key);
    return row ? cloneIssue(row) : undefined;
  }

  insert(issue: Issue): Issue {
    if (this.rows.has(issue.key)) throw new Error(\`duplicate key \${issue.key}\`);
    const row = cloneIssue({ ...issue, version: 1 });
    this.rows.set(row.key, row);
    return cloneIssue(row);
  }

  save(issue: Issue, expectedVersion: number): Issue {
    const current = this.rows.get(issue.key);
    if (!current) throw new WorkflowError('NOT_FOUND', \`issue \${issue.key} not found\`);
    // In Postgres this is: UPDATE issues SET ... WHERE key = $1 AND version = $2
    if (current.version !== expectedVersion) {
      throw new WorkflowError('CONFLICT', \`issue \${issue.key} was modified concurrently\`);
    }
    const row = cloneIssue({ ...issue, version: expectedVersion + 1 });
    this.rows.set(row.key, row);
    return cloneIssue(row);
  }

  findChildren(parentKey: string): Issue[] {
    return [...this.rows.values()].filter((r) => r.parentKey === parentKey).map(cloneIssue);
  }
}
`,
      },
      {
        path: "src/util/clock.ts",
        content: `export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Deterministic clock for tests and the demo script. */
export class FixedClock implements Clock {
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
`,
      },
      {
        path: "src/webhooks/webhookDispatcher.ts",
        content: `import type { DomainEvent, EventBus } from '../events/eventBus';
import type { IssueTransitionedEvent } from '../events/eventBus';

export interface WebhookPayload {
  webhookEvent: 'jira:issue_updated';
  timestamp: string;
  user: string;
  issue: {
    key: string;
    version: number;
    fields: { status: string; summary: string; assignee: string | null; resolution: string | null };
  };
  transition: { id: string; name: string; from: string; to: string };
  changelog: { items: { field: string; fromString: string | null; toString: string | null }[] };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(' ');
  return String(v);
}

export function buildPayload(e: IssueTransitionedEvent): WebhookPayload {
  return {
    webhookEvent: 'jira:issue_updated',
    timestamp: e.at.toISOString(),
    user: e.actor,
    issue: {
      key: e.issue.key,
      version: e.issue.version,
      fields: {
        status: e.issue.status,
        summary: e.issue.fields.summary,
        assignee: e.issue.fields.assignee,
        resolution: e.issue.fields.resolution,
      },
    },
    transition: e.transition,
    changelog: {
      items: e.changelog.map((c) => ({ field: c.field, fromString: str(c.from), toString: str(c.to) })),
    },
  };
}

export interface Subscription {
  id: string;
  url: string;
  /** Only events for these projects; empty = all projects. */
  projects: string[];
  /** Only these target statuses; empty = every transition. */
  toStatuses: string[];
}

export interface HttpClient {
  post(url: string, body: WebhookPayload): { status: number };
}

export interface OutboxEntry {
  subscriptionId: string;
  url: string;
  payload: WebhookPayload;
  attempts: number;
}

/**
 * Matching happens synchronously when the event is published, but delivery
 * does not: entries go to an outbox that a scheduler drains with flush().
 * This keeps slow customer endpoints out of the transition's latency.
 */
export class WebhookDispatcher {
  readonly outbox: OutboxEntry[] = [];
  readonly deadLetters: OutboxEntry[] = [];
  readonly delivered: OutboxEntry[] = [];

  constructor(
    private subs: Subscription[],
    private http: HttpClient,
    private maxAttempts = 3,
  ) {}

  attach(bus: EventBus): void {
    bus.subscribe((e) => this.onEvent(e));
  }

  onEvent(e: DomainEvent): void {
    if (e.type !== 'issue_transitioned') return;
    for (const s of this.subs) {
      if (s.projects.length && !s.projects.includes(e.issue.project)) continue;
      if (s.toStatuses.length && !s.toStatuses.includes(e.transition.to)) continue;
      this.outbox.push({ subscriptionId: s.id, url: s.url, payload: buildPayload(e), attempts: 0 });
    }
  }

  /** Called by the scheduler every few seconds. Returns number delivered. */
  flush(): number {
    let ok = 0;
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const entry of pending) {
      entry.attempts++;
      let status: number;
      try {
        status = this.http.post(entry.url, entry.payload).status;
      } catch {
        status = 0;
      }
      if (status >= 200 && status < 300) {
        this.delivered.push(entry);
        ok++;
      } else if (entry.attempts < this.maxAttempts) {
        this.outbox.push(entry);
      } else {
        this.deadLetters.push(entry);
      }
    }
    return ok;
  }
}
`,
      },
      {
        path: "src/workflow/definition.ts",
        content: `import type { FieldName, Issue } from '../domain/types';
import type { Permission } from '../permissions/permissionScheme';

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
}

export type ConditionRef =
  | { type: 'permission'; permission: Permission }
  | { type: 'onlyAssignee' }
  | { type: 'subtasksDone' };

export type ValidatorRef = { type: 'fieldRequired'; field: FieldName; message: string };

export type PostFunctionRef =
  | { type: 'setResolution'; value: string }
  | { type: 'clearResolution' }
  | { type: 'assignToReporter' }
  | { type: 'assignToActorIfUnassigned' };

export interface TransitionDef {
  id: string;
  name: string;
  /** Source statuses, or '*' for a global transition (available from every other status). */
  from: string[] | '*';
  to: string;
  /** Display order of the buttons in the issue view. */
  order: number;
  conditions: ConditionRef[];
  validators: ValidatorRef[];
  postFunctions: PostFunctionRef[];
  /** Fields the user may fill in on the transition screen. */
  screen: FieldName[];
}

export interface WorkflowDef {
  id: string;
  name: string;
  initialStatus: string;
  statuses: StatusDef[];
  transitions: TransitionDef[];
}

export function findTransition(wf: WorkflowDef, id: string): TransitionDef | undefined {
  return wf.transitions.find((t) => t.id === id);
}

export function statusCategory(wf: WorkflowDef, statusId: string): StatusCategory {
  const s = wf.statuses.find((x) => x.id === statusId);
  if (!s) throw new Error(\`unknown status \${statusId} in workflow \${wf.id}\`);
  return s.category;
}

/** Throws at startup if a workflow references statuses that do not exist. */
export function assertWellFormed(wf: WorkflowDef): void {
  const ids = new Set(wf.statuses.map((s) => s.id));
  if (!ids.has(wf.initialStatus)) throw new Error(\`\${wf.id}: bad initial status\`);
  for (const t of wf.transitions) {
    if (!ids.has(t.to)) throw new Error(\`\${wf.id}/\${t.id}: unknown target \${t.to}\`);
    if (t.from !== '*') for (const f of t.from) if (!ids.has(f)) throw new Error(\`\${wf.id}/\${t.id}: unknown source \${f}\`);
  }
}

/**
 * Maps (project, issue type) to a workflow. Projects can override the
 * workflow for individual issue types; everything else uses the project default.
 */
export class WorkflowRegistry {
  private byId = new Map<string, WorkflowDef>();
  private projectDefault = new Map<string, string>();
  private typeOverrides = new Map<string, string>();

  register(wf: WorkflowDef): void {
    assertWellFormed(wf);
    this.byId.set(wf.id, wf);
  }

  assign(project: string, workflowId: string, issueType?: string): void {
    if (!this.byId.has(workflowId)) throw new Error(\`unknown workflow \${workflowId}\`);
    if (issueType) this.typeOverrides.set(\`\${project}:\${issueType}\`, workflowId);
    else this.projectDefault.set(project, workflowId);
  }

  forIssue(issue: Pick<Issue, 'project' | 'type'>): WorkflowDef {
    const id =
      this.typeOverrides.get(\`\${issue.project}:\${issue.type}\`) ?? this.projectDefault.get(issue.project);
    const wf = id ? this.byId.get(id) : undefined;
    if (!wf) throw new Error(\`no workflow for project \${issue.project}\`);
    return wf;
  }
}
`,
      },
      {
        path: "src/workflow/softwareWorkflow.ts",
        content: `import type { WorkflowDef } from './definition';

/**
 * The default "Software Simplified" workflow.
 *
 *   TODO -> IN_PROGRESS -> IN_REVIEW -> DONE
 *                ^             |
 *                +-------------+          (Back to progress)
 *   any  -> WONT_DO                       (global transition)
 *   DONE / WONT_DO -> TODO                (Reopen)
 */
export const softwareWorkflow: WorkflowDef = {
  id: 'software-simplified',
  name: 'Software Simplified',
  initialStatus: 'TODO',
  statuses: [
    { id: 'TODO', name: 'To Do', category: 'todo' },
    { id: 'IN_PROGRESS', name: 'In Progress', category: 'in_progress' },
    { id: 'IN_REVIEW', name: 'In Review', category: 'in_progress' },
    { id: 'DONE', name: 'Done', category: 'done' },
    { id: 'WONT_DO', name: "Won't Do", category: 'done' },
  ],
  transitions: [
    {
      id: 'start',
      name: 'Start progress',
      from: ['TODO'],
      to: 'IN_PROGRESS',
      order: 10,
      conditions: [{ type: 'permission', permission: 'TRANSITION_ISSUES' }],
      validators: [],
      postFunctions: [{ type: 'assignToActorIfUnassigned' }],
      screen: [],
    },
    {
      id: 'request-review',
      name: 'Request review',
      from: ['IN_PROGRESS'],
      to: 'IN_REVIEW',
      order: 20,
      conditions: [{ type: 'onlyAssignee' }],
      validators: [],
      postFunctions: [],
      screen: ['storyPoints'],
    },
    {
      id: 'back-to-progress',
      name: 'Back to progress',
      from: ['IN_REVIEW'],
      to: 'IN_PROGRESS',
      order: 30,
      conditions: [{ type: 'permission', permission: 'TRANSITION_ISSUES' }],
      validators: [],
      postFunctions: [],
      screen: [],
    },
    {
      id: 'done',
      name: 'Done',
      from: ['IN_REVIEW'],
      to: 'DONE',
      order: 40,
      conditions: [
        { type: 'permission', permission: 'RESOLVE_ISSUES' },
        { type: 'subtasksDone' },
      ],
      validators: [],
      postFunctions: [{ type: 'setResolution', value: 'Done' }],
      screen: [],
    },
    {
      id: 'wont-do',
      name: "Won't do",
      from: '*',
      to: 'WONT_DO',
      order: 90,
      conditions: [{ type: 'permission', permission: 'RESOLVE_ISSUES' }],
      validators: [{ type: 'fieldRequired', field: 'resolution', message: 'Choose a resolution' }],
      postFunctions: [],
      screen: ['resolution'],
    },
    {
      id: 'reopen',
      name: 'Reopen',
      from: ['DONE', 'WONT_DO'],
      to: 'TODO',
      order: 100,
      conditions: [{ type: 'permission', permission: 'TRANSITION_ISSUES' }],
      validators: [],
      postFunctions: [{ type: 'clearResolution' }, { type: 'assignToReporter' }],
      screen: [],
    },
  ],
};
`,
      },
      {
        path: "config/workflow.config.json",
        language: 'json',
        content: `{
  "defaultWorkflow": "software-simplified",
  "webhooks": {
    "flushIntervalMs": 5000,
    "maxAttempts": 3
  },
  "siteAdminGroup": "jira-admins"
}
`,
      },
      {
        path: "package.json",
        language: 'json',
        content: `{
  "name": "issue-workflow-engine",
  "private": true,
  "version": "3.14.0",
  "scripts": {
    "test": "jest",
    "demo": "ts-node scripts/demo.ts"
  }
}
`,
      },
      {
        path: "scripts/demo.ts",
        content: `import { createApp, user } from '../src/app';

// Walk one issue through the happy path and print what the Slack integration receives.
const app = createApp({
  roles: { PAY: { lead: ['lena'], developer: ['dev'], viewer: ['val'] } },
  subscriptions: [{ id: 'slack', url: 'https://hooks.example/slack', projects: ['PAY'], toStatuses: [] }],
});

const lena = user('lena');
const dev = user('dev');
const issue = app.createIssue('PAY', 'lena', { summary: 'Refund API returns 500', dueDate: new Date('2024-03-08T00:00:00Z') });

app.transitions.transition(issue.key, 'start', dev);
app.clock.advance(60_000);
app.transitions.transition(issue.key, 'request-review', dev, { fields: { storyPoints: 3 } });
app.clock.advance(60_000);
app.transitions.transition(issue.key, 'done', lena);

app.webhooks.flush();
for (const d of app.webhooks.delivered) {
  const items = d.payload.changelog.items.map((i) => \`\${i.field}:\${i.fromString}->\${i.toString}\`);
  console.log(\`\${d.payload.transition.name} v\${d.payload.issue.version} [\${items.join(', ')}]\`);
}
`,
      },
      {
        path: "tests/transitions.test.ts",
        content: `import { createApp, user } from '../src/app';
import { PermissionChecker } from '../src/permissions/permissionChecker';
import { ProjectRoles, defaultScheme } from '../src/permissions/permissionScheme';

const roles = { PAY: { lead: ['lena'], developer: ['dev'], viewer: ['val'] } };

test('developer can start progress and is auto-assigned', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  const r = app.transitions.transition(i.key, 'start', user('dev'));
  expect(r.issue.status).toBe('IN_PROGRESS');
  expect(r.issue.fields.assignee).toBe('dev');
  expect(r.issue.version).toBe(2);
});

test('viewer cannot start progress', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  expect(() => app.transitions.transition(i.key, 'start', user('val'))).toThrow('missing permission');
});

test('outsiders get NOT_FOUND, not FORBIDDEN', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  expect(() => app.transitions.transition(i.key, 'start', user('mallory'))).toThrow('not found');
});

test("won't do requires a resolution on the screen", () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  expect(() => app.transitions.transition(i.key, 'wont-do', user('lena'))).toThrow('validation failed');
  const r = app.transitions.transition(i.key, 'wont-do', user('lena'), { fields: { resolution: 'Duplicate' } });
  expect(r.issue.status).toBe('WONT_DO');
});

test('status change shows up in the changelog', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  const r = app.transitions.transition(i.key, 'start', user('dev'));
  expect(r.changelog[0]).toEqual({ field: 'status', from: 'TODO', to: 'IN_PROGRESS' });
});

test('assignee may resolve their own issue', () => {
  const app = createApp({ roles: { PAY: { developer: ['dev'] } } });
  const i = app.createIssue('PAY', 'lena', { assignee: 'dev' });
  const pc = new PermissionChecker(defaultScheme, new ProjectRoles({ PAY: { developer: ['dev'] } }));
  expect(pc.has(user('dev'), 'RESOLVE_ISSUES', i)).toBe(true);
  expect(pc.has(user('other'), 'RESOLVE_ISSUES', i)).toBe(false);
});

test('site admins bypass the scheme', () => {
  const app = createApp({ roles: { PAY: {} } });
  const i = app.createIssue('PAY', 'lena');
  const pc = new PermissionChecker(defaultScheme, new ProjectRoles({}));
  expect(pc.has(user('root', ['jira-admins']), 'ADMINISTER_PROJECTS', i)).toBe(true);
});
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: what does this engine guarantee?',
        prompt: `Spend a few minutes in \`README.md\`, \`src/engine/\` and \`src/permissions/\`. Which statements about the **current** code are true? Select all that apply.`,
        options: [
          'Conditions run before validators, and input for fields that are not on the transition\'s `screen` is dropped before validators or post-functions see it.',
          'A user without `BROWSE_PROJECTS` who calls `transition()` gets `INVALID_TRANSITION`.',
          'A member of `jira-admins` passes every condition of every transition, including `onlyAssignee`.',
          'If a webhook endpoint returns 500, the transition is rolled back.',
          'The `wont-do` transition is available from every status except `WONT_DO` itself.',
          'Conditions receive the very object stored in the repository, so a buggy condition could corrupt stored data.',
        ],
        correct: [0, 4],
        hints: [
          'Read `transition()` top to bottom and note the order of each check. Then look at what `pickScreenFields` does to `input.fields`.',
          'The admin bypass lives in `PermissionChecker.has`. Which conditions actually call it?',
          'Check what `InMemoryIssueRepository.get` returns, and where webhook HTTP calls actually happen.',
        ],
        explanation: `**True:**
- **(A)** \`transition()\` evaluates conditions, then calls \`pickScreenFields\`, which copies only the fields listed in \`t.screen\`. Validators and the \`Object.assign\` onto the issue only ever see that filtered object.
- **(E)** \`isAvailableFrom\` treats \`from: '*'\` as "every status except \`t.to\`". So \`DONE → WONT_DO\` is allowed and \`WONT_DO → WONT_DO\` is not.

**False:**
- **(B)** If the actor cannot browse the project, the code throws \`NOT_FOUND\` *before* it looks up the transition. This is deliberate: it doesn't reveal that the issue exists.
- **(C)** The admin bypass is inside \`PermissionChecker.has\`, so it only affects **permission** conditions. \`onlyAssignee\` compares \`issue.fields.assignee === actor.id\` and never asks the permission checker. Assuming an admin flag bypasses *everything* is a common mistake.
- **(D)** The dispatcher only pushes to an outbox during \`publish\`. HTTP happens later in \`flush()\`, after the save has committed. The bus also catches subscriber errors.
- **(F)** \`get()\` returns \`cloneIssue(row)\`, a private copy. Nothing reaches the store until \`save()\` does its compare-and-set.`,
        timeLimitSec: 300,
        focusFile: 'README.md',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace: Lena clicks "Done" on PAY-1',
        prompt: `PAY-1 is \`IN_REVIEW\`. Lena (project lead) clicks **Done**, and a Slack webhook subscription matches the event. Put the steps in the order they execute, ending with the HTTP call to Slack.`,
        items: [
          '`repo.get(\'PAY-1\')` returns a private copy of the issue',
          '`permissions.has(lena, \'BROWSE_PROJECTS\', issue)`',
          '`workflows.forIssue` → `findTransition(\'done\')` → source-status check',
          '`evaluateConditions`: RESOLVE_ISSUES permission, then `subtasksDone` via `repo.findChildren`',
          '`pickScreenFields` + `runValidators`',
          'status := DONE, screen values applied, then `applyPostFunctions` (setResolution)',
          '`repo.save(issue, before.version)` compare-and-set',
          '`diffIssues(before, saved)` then `bus.publish(issue_transitioned)`',
          '`WebhookDispatcher.onEvent` builds the payload and pushes it to the outbox',
          'Scheduler calls `webhooks.flush()` → `http.post` to Slack',
        ],
        hints: [
          'Start at `TransitionService.transition` and only follow calls. Composition happens in `app.ts`, but that isn\'t part of the request path.',
          'Conditions are listed in the workflow definition in a fixed order. Look at the `done` transition in `softwareWorkflow.ts`.',
          'Webhooks are matched synchronously during `publish`, but they are delivered later.',
        ],
        explanation: `The pipeline is load → **hide** → resolve the transition → **conditions** (is the button offered?) → **validators** (is the screen input acceptable?) → mutate → **compare-and-set save** → diff and publish → outbox → later flush.

Two details catch people out:
- \`subtasksDone\` is a *condition*, not a validator, and it reads children through the repository.
- \`diffIssues\` runs **after** \`save\`. It compares the \`before\` snapshot with the saved copy, so whatever \`before\` really holds decides what the changelog says. That matters for the next stage.`,
        timeLimitSec: 420,
        focusFile: 'src/engine/transitionService.ts',
      },
      {
        id: 's3',
        kind: 'find-bug',
        title: 'PAY-812: Slack never shows the resolution',
        prompt: `Support escalated **PAY-812**: the Slack integration says "Lena moved PAY-1 to Done" but never mentions the resolution or the new assignee. Running \`scripts/demo.ts\` prints:

\`\`\`
Start progress v2 [status:TODO->IN_PROGRESS]
Request review v3 [status:IN_PROGRESS->IN_REVIEW]
Done v4 [status:IN_REVIEW->DONE]
\`\`\`

The issue view shows \`assignee: dev\`, \`storyPoints: 3\` and \`resolution: Done\`, so the data is saved correctly. Click the line that causes the changelog to lose every field change, then pick the root cause.`,
        file: 'src/engine/transitionService.ts',
        lines: [55],
        options: [
          '`{ ...issue }` is a shallow copy: `before.fields` is the same object that the screen values and post-functions mutate, so every field diff compares an object with itself',
          '`repo.get` hands out the stored row, so post-functions mutate the store before `save` and the diff sees no difference',
          '`diffIssues` compares Dates and arrays by reference, so it cannot detect changes in them',
          'Post-functions run before the screen values are applied and overwrite them',
          'The event is published before `save`, so the webhook payload holds the pre-transition issue',
        ],
        correct: 0,
        hints: [
          'Status changes do appear, but field changes don\'t. What is different about where `status` and `fields.resolution` live on the object?',
          'After `const before = { ...issue }`, does `before.fields === issue.fields` hold?',
        ],
        explanation: `Object spread copies **one level**. \`before.status\` is a primitive, so it keeps \`'IN_REVIEW'\` while \`issue.status\` becomes \`'DONE'\`. That is why status changes do show up. \`before.fields\`, however, *is the same object* as \`issue.fields\`. \`Object.assign(issue.fields, screenValues)\` and every post-function then mutate the object that \`before\` points at too. Later \`diffIssues(before, saved)\` compares the already-mutated fields with the saved fields, finds them equal, and emits nothing.

The other options are good red herrings to rule out:
- \`get()\` returns \`cloneIssue(row)\`, so the store is not aliased.
- \`sameValue\` *does* handle Dates (\`getTime\`) and arrays (element-wise).
- Screen values are applied before post-functions. \`setResolution\` even reads them.
- \`publish\` runs after \`save\`.

This is the classic "snapshot by spread" bug. It surfaces wherever a before/after diff, an undo stack or an audit log takes a shallow copy of a nested object.`,
        timeLimitSec: 480,
        focusFile: 'src/engine/transitionService.ts',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Fix the changelog',
        prompt: `Fix PAY-812 so that the transition result's \`changelog\`, and therefore the webhook payload, includes every field that actually changed: assignee, screen values, resolution and so on.

Requirements:
- The status item still comes first, then fields in \`FIELD_ORDER\`.
- Fields that did not change must **not** appear. That includes \`dueDate\` (a Date) and \`labels\` (an array) on issues that have them.
- Keep the fix in \`src/engine/transitionService.ts\`. The repository and changelog code are correct.`,
        editable: ['src/engine/transitionService.ts'],
        tests: [
          { path: "tests/changelog.hidden.test.ts", content: `import { createApp, user } from '../src/app';

const roles = { PAY: { lead: ['lena'], developer: ['dev'], viewer: ['val'] } };
const due = new Date('2024-03-08T00:00:00Z');

function walkToReview() {
  const app = createApp({ roles, subscriptions: [{ id: 'slack', url: 'https://hooks.example/slack', projects: [], toStatuses: [] }] });
  const i = app.createIssue('PAY', 'lena', { summary: 'Refund API returns 500', dueDate: due, labels: ['api'] });
  const start = app.transitions.transition(i.key, 'start', user('dev'));
  const review = app.transitions.transition(i.key, 'request-review', user('dev'), { fields: { storyPoints: 3 } });
  return { app, i, start, review };
}

test('start: assignee change is in the changelog', () => {
  const { start } = walkToReview();
  expect(start.changelog).toEqual([
    { field: 'status', from: 'TODO', to: 'IN_PROGRESS' },
    { field: 'assignee', from: null, to: 'dev' },
  ]);
});

test('request-review: screen value is in the changelog', () => {
  const { review } = walkToReview();
  expect(review.changelog).toEqual([
    { field: 'status', from: 'IN_PROGRESS', to: 'IN_REVIEW' },
    { field: 'storyPoints', from: null, to: 3 },
  ]);
});

test('done: resolution reaches the webhook payload', () => {
  const { app, i } = walkToReview();
  app.transitions.transition(i.key, 'done', user('lena'));
  app.webhooks.flush();
  const last = app.webhooks.delivered[app.webhooks.delivered.length - 1].payload;
  expect(last.transition.name).toBe('Done');
  expect(last.changelog.items).toEqual([
    { field: 'status', fromString: 'IN_REVIEW', toString: 'DONE' },
    { field: 'resolution', fromString: null, toString: 'Done' },
  ]);
});

test('reopen: resolution cleared and reassigned to reporter', () => {
  const { app, i } = walkToReview();
  app.transitions.transition(i.key, 'done', user('lena'));
  const r = app.transitions.transition(i.key, 'reopen', user('lena'));
  expect(r.changelog).toEqual([
    { field: 'status', from: 'DONE', to: 'TODO' },
    { field: 'assignee', from: 'dev', to: 'lena' },
    { field: 'resolution', from: 'Done', to: null },
  ]);
});

test('unchanged date and array fields never appear in the changelog', () => {
  const { start, review } = walkToReview();
  const fields = [...start.changelog, ...review.changelog].map((c) => c.field);
  expect(fields).not.toContain('dueDate');
  expect(fields).not.toContain('labels');
});
` },
        ],
        solution: {
          "src/engine/transitionService.ts": `import { WorkflowError } from '../domain/types';
import type { Issue, TransitionInput, TransitionResult, User } from '../domain/types';
import { findTransition } from '../workflow/definition';
import type { TransitionDef } from '../workflow/definition';
import type { WorkflowRegistry } from '../workflow/definition';
import type { PermissionChecker } from '../permissions/permissionChecker';
import { cloneIssue } from '../store/issueRepository';
import type { IssueRepository } from '../store/issueRepository';
import type { EventBus } from '../events/eventBus';
import type { Clock } from '../util/clock';
import type { RuleContext } from './conditions';
import { evaluateConditions } from './conditions';
import { pickScreenFields, runValidators } from './validators';
import { applyPostFunctions } from './postFunctions';
import { diffIssues } from './changelog';

export interface TransitionServiceDeps {
  repo: IssueRepository;
  workflows: WorkflowRegistry;
  permissions: PermissionChecker;
  bus: EventBus;
  clock: Clock;
}

export class TransitionService {
  constructor(private deps: TransitionServiceDeps) {}

  transition(key: string, transitionId: string, actor: User, input: TransitionInput = {}): TransitionResult {
    const { repo, workflows, permissions, bus, clock } = this.deps;

    const issue = repo.get(key);
    // Users who cannot browse the project must not learn that the issue exists.
    if (!issue || !permissions.has(actor, 'BROWSE_PROJECTS', issue)) {
      throw new WorkflowError('NOT_FOUND', \`issue \${key} not found\`);
    }

    const workflow = workflows.forIssue(issue);
    const t = findTransition(workflow, transitionId);
    if (!t || !this.isAvailableFrom(t, issue.status)) {
      throw new WorkflowError('INVALID_TRANSITION', \`\${transitionId} is not available from \${issue.status}\`);
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== issue.version) {
      throw new WorkflowError('CONFLICT', \`issue \${key} was modified (v\${issue.version})\`);
    }

    const ctx: RuleContext = { issue, actor, workflow, permissions, repo, clock };

    const failed = evaluateConditions(t.conditions, ctx);
    if (failed) throw new WorkflowError('CONDITION_FAILED', failed);

    const screenValues = pickScreenFields(t, input.fields);
    const errors = runValidators(t.validators, ctx, screenValues);
    if (errors.length) throw new WorkflowError('VALIDATION_FAILED', 'validation failed', errors);

    // Deep snapshot: post-functions mutate issue.fields in place.
    const before: Issue = cloneIssue(issue);

    issue.status = t.to;
    Object.assign(issue.fields, screenValues);
    applyPostFunctions(t.postFunctions, ctx);
    issue.updatedAt = clock.now();

    const saved = repo.save(issue, before.version);
    const changelog = diffIssues(before, saved);

    bus.publish({
      type: 'issue_transitioned',
      at: clock.now(),
      actor: actor.id,
      issue: saved,
      transition: { id: t.id, name: t.name, from: before.status, to: t.to },
      changelog,
    });

    return { issue: saved, changelog };
  }

  private isAvailableFrom(t: TransitionDef, status: string): boolean {
    // A global transition is offered from every status except its own target.
    if (t.from === '*') return t.to !== status;
    return t.from.includes(status);
  }
}
`,
        },
        hints: [
          'You need a snapshot of `issue` whose nested objects are independent of the original.',
          'The repository already has a helper that deep-copies an issue and keeps Dates as Dates. Look at `src/store/issueRepository.ts`.',
          'Avoid `JSON.parse(JSON.stringify(...))`: think about what it does to `dueDate`.',
        ],
        explanation: `Replace the spread with \`const before = cloneIssue(issue)\`, using the helper the repository already uses to hand out private copies. It deep-copies \`fields\`, copies the \`labels\` array, and creates new \`Date\` objects, so the types stay the same.

Why not the alternatives?
- \`{ ...issue, fields: { ...issue.fields } }\` works today, but it relies on no post-function ever mutating an array in place (\`labels.push\`), and \`labels\` would still be aliased.
- \`structuredClone\` is correct as well, and preserves Dates.
- \`JSON.parse(JSON.stringify(...))\` turns Dates into strings. The hidden test with a \`dueDate\` would then fail, because \`sameValue(string, Date)\` is false on every transition.

Reusing the domain's own clone function means there is one definition of "a copy of an issue". The next time someone adds a nested field, there is only one place to update.`,
        timeLimitSec: 720,
        focusFile: 'src/engine/transitionService.ts',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'Review the agent\'s fix',
        prompt: 'A teammate gave the same ticket to the agent before you got to it, and it opened a PR. Review the PR as if you were the approver.',
        persona: 'agent-mode',
        request: 'Fix PAY-812 so webhook changelogs include field changes (assignee, resolution, story points). Edit whatever you need and run the tests.',
        aiReply: `**Agent mode**: planned 3 edits, applied 3, ran \`npm test\`: **7 passed, 0 failed** ✅

**Root cause:** \`before\` was a shallow copy, so post-functions mutated it too.

**1. \`src/engine/transitionService.ts\`**
\`\`\`diff
-    const before: Issue = { ...issue };
+    // Deep snapshot so post-functions can't leak into \`before\`.
+    const before: Issue = JSON.parse(JSON.stringify(issue));
\`\`\`

**2. \`src/webhooks/webhookDispatcher.ts\`** (tidy-up, no behaviour change)
\`\`\`diff
-function str(v: unknown): string | null {
+function toDisplayString(v: unknown): string | null {
\`\`\`
(and the one call site)

**3. \`src/engine/changelog.ts\`**: added JSDoc to \`sameValue\`.

Verified with \`scripts/demo.ts\`:
\`\`\`
Start progress v2 [status:TODO->IN_PROGRESS, assignee:null->dev, dueDate:2024-03-08T00:00:00.000Z->2024-03-08T00:00:00.000Z]
Request review v3 [status:IN_PROGRESS->IN_REVIEW, dueDate:2024-03-08T00:00:00.000Z->2024-03-08T00:00:00.000Z, storyPoints:null->3]
Done v4 [status:IN_REVIEW->DONE, resolution:null->Done, dueDate:2024-03-08T00:00:00.000Z->2024-03-08T00:00:00.000Z]
\`\`\`
Changelog now includes field changes. Ready to merge.`,
        options: [
          'Approve: the deep copy fixes the aliasing, the extra edits are harmless, and the tests pass',
          'Request changes: the JSON round-trip turns `before.fields.dueDate` into an ISO string, so `sameValue(string, Date)` is false and every transition of an issue with a due date reports a phantom `dueDate` change. The agent\'s own demo output shows it.',
          'Request changes: JSON drops `null` values, so `before.fields.assignee` becomes `undefined` and the changelog shows `undefined -> dev`',
          'Request changes: `JSON.parse` loses `version`, so `repo.save(issue, before.version)` always throws CONFLICT',
          'Request changes: post-functions now mutate the clone instead of `issue`, so the resolution is never saved',
        ],
        correct: 1,
        hints: [
          'Read the agent\'s *own* demo output line by line. Is every reported change a real change?',
          'What does `JSON.stringify` do to a `Date`, and what does `JSON.parse` give you back?',
        ],
        explanation: `\`JSON.stringify\` calls \`Date.prototype.toJSON\`, and \`JSON.parse\` gives back a **string**. In \`before\`, \`dueDate\` is \`"2024-03-08T00:00:00.000Z"\`; in \`after\` it is a \`Date\`. \`sameValue\` only takes the Date path when *both* sides are Dates, so it falls through to \`===\` and reports a change on every transition. The proof is in the PR description: \`dueDate:X->X\`. Slack users would see "Due date changed" on every move.

Why the others are wrong:
- JSON **keeps** \`null\`; it only drops \`undefined\`.
- \`version\` is a number and round-trips fine.
- Post-functions still run on \`ctx.issue\`, which is \`issue\`, not the clone.

**Agent-mode review habits this stage practises:**
1. "Tests pass" only means the *visible* tests pass. None of them sets a \`dueDate\`.
2. Read the evidence the agent attaches. Here it disproves the agent's own claim.
3. Reject drive-by renames in a bug-fix PR. They're harmless, but they make the diff harder to review and the revert harder to do.`,
        timeLimitSec: 420,
        focusFile: 'src/engine/changelog.ts',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'feature',
        title: 'Feature: which buttons should the UI show?',
        prompt: `The issue view currently renders every transition and lets the server reject clicks, which users hate. Add a read-only method to \`TransitionService\`:

\`\`\`ts
availableTransitions(key: string, actor: User): { id: string; name: string; to: string }[]
\`\`\`

Rules (the hidden tests check each one):
1. Same visibility rule as \`transition()\`: an unknown issue, or an actor without \`BROWSE_PROJECTS\`, throws a \`WorkflowError\` whose message contains \`not found\`.
2. Same source-status rule as \`transition()\`, including the rule for global transitions.
3. Every **condition** must pass for this actor. **Validators are not run**, because the screen hasn't been filled in yet.
4. Sort the result by \`order\` ascending. Projects can register workflows whose \`transitions\` array is in any order.
5. Strictly read-only: no save, no version bump, no events.

Your earlier changelog fix is already included in the reference solution. Keep it.`,
        editable: ['src/engine/transitionService.ts'],
        tests: [
          { path: "tests/available.hidden.test.ts", content: `import { createApp, user } from '../src/app';
import { softwareWorkflow } from '../src/workflow/softwareWorkflow';

const roles = { PAY: { lead: ['lena'], developer: ['dev'], viewer: ['val'] } };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test('TODO: developer sees start only, lead also sees wont-do', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  expect(ids(app.transitions.availableTransitions(i.key, user('dev')))).toEqual(['start']);
  expect(app.transitions.availableTransitions(i.key, user('lena'))).toEqual([
    { id: 'start', name: 'Start progress', to: 'IN_PROGRESS' },
    { id: 'wont-do', name: "Won't do", to: 'WONT_DO' },
  ]);
  expect(ids(app.transitions.availableTransitions(i.key, user('val')))).toEqual([]);
});

test('IN_PROGRESS: onlyAssignee and assignee-resolve permission', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  app.transitions.transition(i.key, 'start', user('dev'));
  expect(ids(app.transitions.availableTransitions(i.key, user('dev')))).toEqual(['request-review', 'wont-do']);
  expect(ids(app.transitions.availableTransitions(i.key, user('lena')))).toEqual(['wont-do']);
});

test('global transition is not offered to its own target status', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  app.transitions.transition(i.key, 'wont-do', user('lena'), { fields: { resolution: 'Duplicate' } });
  expect(ids(app.transitions.availableTransitions(i.key, user('lena')))).toEqual(['reopen']);
});

test('open subtasks hide Done', () => {
  const app = createApp({ roles });
  const parent = app.createIssue('PAY', 'lena', { assignee: 'dev' });
  const sub = app.createIssue('PAY', 'lena', {}, { type: 'subtask', parentKey: parent.key });
  app.transitions.transition(parent.key, 'start', user('dev'));
  app.transitions.transition(parent.key, 'request-review', user('dev'));
  expect(ids(app.transitions.availableTransitions(parent.key, user('lena')))).toEqual(['back-to-progress', 'wont-do']);
  app.transitions.transition(sub.key, 'wont-do', user('lena'), { fields: { resolution: 'Obsolete' } });
  expect(ids(app.transitions.availableTransitions(parent.key, user('lena')))).toEqual(['back-to-progress', 'done', 'wont-do']);
});

test('outsiders get NOT_FOUND', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  expect(() => app.transitions.availableTransitions(i.key, user('mallory'))).toThrow('not found');
  expect(() => app.transitions.availableTransitions('PAY-999', user('lena'))).toThrow('not found');
});

test('sorted by order, not by definition order', () => {
  const app = createApp({ roles });
  app.workflows.register({
    ...softwareWorkflow,
    id: 'reversed',
    transitions: [...softwareWorkflow.transitions].reverse(),
  });
  app.workflows.assign('PAY', 'reversed');
  const i = app.createIssue('PAY', 'lena');
  expect(ids(app.transitions.availableTransitions(i.key, user('lena')))).toEqual(['start', 'wont-do']);
});

test('read-only: no version bump, no events', () => {
  const app = createApp({ roles });
  const i = app.createIssue('PAY', 'lena');
  let events = 0;
  app.bus.subscribe(() => events++);
  app.transitions.availableTransitions(i.key, user('lena'));
  expect(events).toBe(0);
  expect(app.repo.get(i.key)!.version).toBe(1);
  expect(app.repo.get(i.key)!.fields.assignee).toBeNull();
});
` },
        ],
        solution: {
          "src/engine/transitionService.ts": `import { WorkflowError } from '../domain/types';
import type { Issue, TransitionInput, TransitionResult, User } from '../domain/types';

export interface AvailableTransition {
  id: string;
  name: string;
  to: string;
}
import { findTransition } from '../workflow/definition';
import type { TransitionDef } from '../workflow/definition';
import type { WorkflowRegistry } from '../workflow/definition';
import type { PermissionChecker } from '../permissions/permissionChecker';
import { cloneIssue } from '../store/issueRepository';
import type { IssueRepository } from '../store/issueRepository';
import type { EventBus } from '../events/eventBus';
import type { Clock } from '../util/clock';
import type { RuleContext } from './conditions';
import { evaluateConditions } from './conditions';
import { pickScreenFields, runValidators } from './validators';
import { applyPostFunctions } from './postFunctions';
import { diffIssues } from './changelog';

export interface TransitionServiceDeps {
  repo: IssueRepository;
  workflows: WorkflowRegistry;
  permissions: PermissionChecker;
  bus: EventBus;
  clock: Clock;
}

export class TransitionService {
  constructor(private deps: TransitionServiceDeps) {}

  transition(key: string, transitionId: string, actor: User, input: TransitionInput = {}): TransitionResult {
    const { repo, workflows, permissions, bus, clock } = this.deps;

    const issue = repo.get(key);
    // Users who cannot browse the project must not learn that the issue exists.
    if (!issue || !permissions.has(actor, 'BROWSE_PROJECTS', issue)) {
      throw new WorkflowError('NOT_FOUND', \`issue \${key} not found\`);
    }

    const workflow = workflows.forIssue(issue);
    const t = findTransition(workflow, transitionId);
    if (!t || !this.isAvailableFrom(t, issue.status)) {
      throw new WorkflowError('INVALID_TRANSITION', \`\${transitionId} is not available from \${issue.status}\`);
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== issue.version) {
      throw new WorkflowError('CONFLICT', \`issue \${key} was modified (v\${issue.version})\`);
    }

    const ctx: RuleContext = { issue, actor, workflow, permissions, repo, clock };

    const failed = evaluateConditions(t.conditions, ctx);
    if (failed) throw new WorkflowError('CONDITION_FAILED', failed);

    const screenValues = pickScreenFields(t, input.fields);
    const errors = runValidators(t.validators, ctx, screenValues);
    if (errors.length) throw new WorkflowError('VALIDATION_FAILED', 'validation failed', errors);

    // Deep snapshot: post-functions mutate issue.fields in place.
    const before: Issue = cloneIssue(issue);

    issue.status = t.to;
    Object.assign(issue.fields, screenValues);
    applyPostFunctions(t.postFunctions, ctx);
    issue.updatedAt = clock.now();

    const saved = repo.save(issue, before.version);
    const changelog = diffIssues(before, saved);

    bus.publish({
      type: 'issue_transitioned',
      at: clock.now(),
      actor: actor.id,
      issue: saved,
      transition: { id: t.id, name: t.name, from: before.status, to: t.to },
      changelog,
    });

    return { issue: saved, changelog };
  }

  /**
   * Transitions the UI should render as buttons for this actor, sorted by order.
   * Same visibility + source-status rules as transition(); conditions must pass,
   * validators are not run (the screen has not been filled in yet). Read-only.
   */
  availableTransitions(key: string, actor: User): AvailableTransition[] {
    const { repo, workflows, permissions, clock } = this.deps;
    const issue = repo.get(key);
    if (!issue || !permissions.has(actor, 'BROWSE_PROJECTS', issue)) {
      throw new WorkflowError('NOT_FOUND', \`issue \${key} not found\`);
    }
    const workflow = workflows.forIssue(issue);
    const ctx: RuleContext = { issue, actor, workflow, permissions, repo, clock };
    return workflow.transitions
      .filter((t) => this.isAvailableFrom(t, issue.status))
      .filter((t) => evaluateConditions(t.conditions, ctx) === null)
      .sort((a, b) => a.order - b.order)
      .map((t) => ({ id: t.id, name: t.name, to: t.to }));
  }

  private isAvailableFrom(t: TransitionDef, status: string): boolean {
    // A global transition is offered from every status except its own target.
    if (t.from === '*') return t.to !== status;
    return t.from.includes(status);
  }
}
`,
        },
        hints: [
          '`transition()` already contains the visibility rule, the source-status rule (`isAvailableFrom`) and the `RuleContext` construction. Reuse them; don\'t re-implement them.',
          '`evaluateConditions` returns `null` when every condition passes. Conditions are documented as side-effect free, which is why the UI is allowed to call them.',
          '`Array.prototype.sort` mutates the array in place. Filter (which creates a new array) before you sort, so you never reorder the workflow definition itself.',
        ],
        explanation: `The reference implementation reuses the existing building blocks:

\`\`\`ts
const issue = repo.get(key);
if (!issue || !permissions.has(actor, 'BROWSE_PROJECTS', issue)) throw new WorkflowError('NOT_FOUND', ...);
const workflow = workflows.forIssue(issue);
const ctx = { issue, actor, workflow, permissions, repo, clock };
return workflow.transitions
  .filter((t) => this.isAvailableFrom(t, issue.status))
  .filter((t) => evaluateConditions(t.conditions, ctx) === null)
  .sort((a, b) => a.order - b.order)
  .map(({ id, name, to }) => ({ id, name, to }));
\`\`\`

The tests check several things:
- **Conditions are evaluated per actor**: \`onlyAssignee\` hides "Request review" from the lead, and the \`assignee\` grant gives the developer "Won't do".
- **Conditions that read other issues**: \`subtasksDone\` hides "Done" until the subtask is closed.
- **The global-transition rule**: "Won't do" is not offered on a \`WONT_DO\` issue.
- **Sorting**: if you call \`.sort\` directly on \`workflow.transitions\`, you would also reorder the shared definition in place.

Why not run validators? They judge *input*, and the user hasn't typed any yet. If you ran them, "Won't do" would never be offered, because its required \`resolution\` is only entered on the screen. Keeping "is this offered?" (conditions) separate from "is this input valid?" (validators) is the main design point of Jira-style workflow engines.`,
        timeLimitSec: 1200,
        focusFile: 'src/engine/transitionService.ts',
      },
      {
        id: 's7',
        kind: 'mcq',
        title: 'Follow-up: four nodes, double the traffic',
        prompt: `The interviewer moves to design: "We're moving from one process to **4 stateless app nodes** behind a load balancer, sharing one Postgres. Webhook volume will double." Which statements are correct? Select all that apply.`,
        options: [
          'If two users click "Done" on the same issue at the same moment on different nodes, `save()`\'s version check means only one commit wins, provided Postgres implements it as an atomic `UPDATE ... WHERE key = $1 AND version = $2` and checks the row count.',
          'The outbox is an in-memory array filled after the commit. A node that crashes between `save()` and `flush()` silently loses those webhooks. A transactional outbox table (written in the same DB transaction as the issue) fixes this.',
          'The client-supplied `expectedVersion` is redundant once `save()` does compare-and-set, so it can be removed.',
          'Slow customer webhook endpoints add their latency to every user\'s transition request, so doubling webhook volume will slow the UI.',
          'With several nodes flushing in parallel, deliveries for the same issue can arrive out of order. Consumers should use `issue.version` in the payload to drop stale events.',
          'Raising `maxAttempts` from 3 to 10 is enough to make webhook delivery at-least-once across node restarts.',
        ],
        correct: [0, 1, 4],
        hints: [
          'Find where `outbox` lives and when `flush()` runs relative to the transition.',
          '`expectedVersion` and the repository check protect against two different races. One of them involves a human looking at a stale screen.',
        ],
        explanation: `**Correct:**
- **(A)** The repository contract is compare-and-set, and the code comment even gives the SQL. Across nodes it only holds if the database does the check atomically. A read-then-write in application code would reintroduce the race.
- **(B)** Delivery state only exists in process memory. Persisting outbox rows in the same transaction as the issue update ("transactional outbox") is the standard fix, combined with idempotent consumers.
- **(E)** Parallel flushers and retries (a failed entry goes back to the end of the outbox) reorder deliveries. The payload already carries \`issue.version\`, so consumers can discard anything older than what they've already seen.

**Incorrect:**
- **(C)** The two checks guard different things. The repository's version check guards the server's own read-modify-write against a concurrent save. \`expectedVersion\` guards the *user's decision*: they clicked "Done" while looking at v3, but someone reopened the issue at v4. Removing it lets users unknowingly overwrite each other.
- **(D)** \`onEvent\` only pushes to the outbox. HTTP happens in \`flush()\`, which a scheduler calls separately. This decoupling is the reason the outbox exists.
- **(F)** Retries can't help when the entries are lost with the process. Durability comes from persistence, not from retry count.`,
        timeLimitSec: 480,
        focusFile: 'src/webhooks/webhookDispatcher.ts',
      },
    ],
  },
  {
    id: 'l5-sim-canva-export-queue',
    title: 'Simulation: Design Export Queue',
    level: 5,
    rating: 2500,
    lang: 'javascript',
    domain: 'scheduler',
    companies: ['canva'],
    tags: ['interview-simulation', 'job-queue', 'leases', 'fencing', 'retries', 'async', 'review-ai', 'feature'],
    summary: 'Duplicate "export ready" emails: trace a lease-based retry queue on a virtual clock, fix the fencing bug, catch the AI\'s mistakes, and ship cancellation.',
    context: `**Canva-style "work with AI" round: 7 stages, one codebase, ~68 minutes.**

You're on the team behind "Download as PDF / PNG / MP4". Exports go through a lease-based job queue with retries, and the user gets an email when the file is ready. Incident **EXP-2291**: some users get the "export ready" email *twice* for a single click, mostly for big PDFs at peak time.

Canva's version of this round is about **catching AI mistakes**. You'll get assistant output in several stages. Some of it is right and some isn't, and you're graded on telling the two apart.

Everything runs on a deterministic \`VirtualClock\`. Read its header comment before you start reasoning about timing.`,
    persona: 'confident-intern',
    files: [
      {
        path: "README.md",
        language: 'markdown',
        content: `# design-export-queue

Turns "Download as PDF / PNG / MP4" clicks in the editor into files on the
export CDN, then emails the user a link.

## Flow

\`\`\`
POST /exports ─▶ ExportService.createExport ─▶ JobQueue.enqueue
                                                   │ onReady
                                                   ▼
                       WorkerPool.pump ─▶ JobQueue.lease() ─▶ ExportWorker.process
                                                                  │
                     render (FakeRenderer) ─▶ upload (FakeAssetStore) ─▶ ack ─▶ notify
                                     │ error
                                     ▼
                       classifyError ─▶ retry: nack(delay)  /  fatal: fail + notify
\`\`\`

- **Leases.** \`lease()\` hands a job to one worker for \`leaseMs\`. The reaper
  (\`src/queue/reaper.js\`) returns expired leases to the ready list, so a crashed
  worker never strands a job. Each lease has a unique \`leaseId\`; \`ack\`, \`nack\`
  and \`fail\` must present it (fencing).
- **Retries.** \`attempts\` counts leases. Retryable errors (5xx, 408, 429,
  transient network codes) are retried with equal-jitter exponential backoff
  until \`maxAttempts\`; then the job fails and the user is told.
- **Job records** (\`src/store/jobStore.js\`) are what the UI polls. Only the
  worker that owns the lease may update them.

## Determinism

Everything runs on \`VirtualClock\` (\`src/clock/virtualClock.js\`). Timers due at
the same virtual time fire in creation order, and all promise callbacks are
drained after each timer before the next one fires. \`scripts/simulate.js\`
replays incidents.

## Open incidents

- **EXP-2291**: some users get the "export ready" email twice for one click.
  Mostly large PDFs, mostly at peak.
`,
      },
      {
        path: "src/api/exportService.js",
        content: `import { validateExportRequest } from '../render/formats';

/**
 * Entry point for POST /exports and GET /exports/:id.
 *
 * Idempotency keys are scoped per user: the editor sends the same key when a
 * user double-clicks "Download", and two users can never collide.
 */
export class ExportService {
  constructor({ queue, jobs }) {
    this.queue = queue;
    this.jobs = jobs;
    this.idempotency = new Map();
    this.seq = 0;
  }

  createExport({ userId, designId, format, pages = 1, plan = 'free', idempotencyKey }) {
    validateExportRequest({ format, pages });
    const idemKey = idempotencyKey ? \`\${userId}:\${idempotencyKey}\` : null;
    if (idemKey && this.idempotency.has(idemKey)) {
      return this.jobs.get(this.idempotency.get(idemKey));
    }
    const id = \`job-\${++this.seq}\`;
    const record = this.jobs.create({ id, userId, designId, format, pages, state: 'queued', attempts: 0 });
    if (idemKey) this.idempotency.set(idemKey, id);
    this.queue.enqueue({
      id,
      priority: plan === 'pro' ? 1 : 0,
      attempts: 0,
      payload: { userId, designId, format, pages },
    });
    return record;
  }

  getStatus(jobId, userId) {
    const r = this.jobs.get(jobId);
    if (!r || r.userId !== userId) return null;
    return r;
  }
}
`,
      },
      {
        path: "src/app.js",
        content: `import { exportConfig } from '../config/exportConfig';
import { VirtualClock } from './clock/virtualClock';
import { JobQueue } from './queue/jobQueue';
import { startReaper } from './queue/reaper';
import { ExportWorker } from './workers/exportWorker';
import { WorkerPool } from './workers/workerPool';
import { FakeRenderer } from './render/renderer';
import { FakeAssetStore } from './storage/assetStore';
import { JobStore } from './store/jobStore';
import { InMemoryNotifier } from './notify/notifier';
import { Metrics } from './metrics';
import { ExportService } from './api/exportService';
import { createRng } from './queue/backoff';

/** Composition root. Everything runs on one VirtualClock so tests are deterministic. */
export function createExportSystem({ config = {}, renderScript = {} } = {}) {
  const cfg = { ...exportConfig, ...config, backoff: { ...exportConfig.backoff, ...(config.backoff ?? {}) } };
  const clock = new VirtualClock(0);
  const metrics = new Metrics();
  const queue = new JobQueue({ clock, leaseMs: cfg.leaseMs });
  const jobs = new JobStore(clock);
  const notifier = new InMemoryNotifier(clock);
  const storage = new FakeAssetStore();
  const renderer = new FakeRenderer({ clock, script: renderScript });
  const worker = new ExportWorker({
    queue, renderer, storage, notifier, jobs, clock, config: cfg, rng: createRng(cfg.seed), metrics,
  });
  const pool = new WorkerPool({ queue, worker, concurrency: cfg.concurrency });
  const service = new ExportService({ queue, jobs });
  const reaper = startReaper({ queue, clock, intervalMs: cfg.reapIntervalMs, metrics });
  pool.start();
  return {
    cfg, clock, metrics, queue, jobs, notifier, storage, renderer, worker, pool, service,
    shutdown: () => {
      pool.stop();
      clock.clearInterval(reaper);
    },
  };
}
`,
      },
      {
        path: "src/clock/virtualClock.js",
        content: `/**
 * Deterministic clock. Nothing in the pipeline reads Date.now() or calls the
 * global setTimeout directly; everything goes through a clock instance.
 *
 * Timers due at the same virtual time fire in the order they were *created*.
 * After every timer callback the clock drains all pending promise callbacks
 * (microtasks) before firing the next timer.
 */
export function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class VirtualClock {
  constructor(start = 0) {
    this.t = start;
    this.seq = 0;
    this.timers = new Map();
  }

  now() {
    return this.t;
  }

  setTimeout(fn, ms) {
    const id = ++this.seq;
    this.timers.set(id, { id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  setInterval(fn, ms) {
    const handle = { id: 0 };
    const tick = () => {
      handle.id = this.setTimeout(tick, ms);
      fn();
    };
    handle.id = this.setTimeout(tick, ms);
    return handle;
  }

  clearInterval(handle) {
    this.clearTimeout(handle.id);
  }

  sleep(ms) {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  /** Fire every timer due at or before \`t\`, in (time, creation) order. */
  async runUntil(t) {
    await flushMicrotasks();
    for (;;) {
      let next = null;
      for (const tm of this.timers.values()) {
        if (tm.at > t) continue;
        if (!next || tm.at < next.at || (tm.at === next.at && tm.id < next.id)) next = tm;
      }
      if (!next) break;
      this.timers.delete(next.id);
      this.t = next.at;
      next.fn();
      await flushMicrotasks();
    }
    this.t = t;
  }

  runFor(ms) {
    return this.runUntil(this.t + ms);
  }
}
`,
      },
      {
        path: "src/errors.js",
        content: `export class ExportError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, headers?: Record<string,string>, retryable?: boolean }} info
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'ExportError';
    this.status = info.status;
    this.code = info.code;
    this.headers = info.headers ?? {};
    if (info.retryable !== undefined) this.retryable = info.retryable;
  }
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// OOM usually means the node was shared with another huge job; a retry lands elsewhere.
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'RENDER_OOM']);

/** Decide whether a failure is worth another attempt. */
export function classifyError(err) {
  if (err && err.retryable === false) return 'fatal';
  const status = err && err.status;
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return 'retry';
  if (err && TRANSIENT_CODES.has(err.code)) return 'retry';
  return 'fatal';
}
`,
      },
      {
        path: "src/metrics.js",
        content: `export class Metrics {
  constructor() {
    this.counters = new Map();
  }
  inc(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  get(name) {
    return this.counters.get(name) ?? 0;
  }
}
`,
      },
      {
        path: "src/notify/notifier.js",
        content: `/** Records user-facing notifications (email + in-app toast in production). */
export class InMemoryNotifier {
  constructor(clock) {
    this.clock = clock;
    this.sent = [];
  }

  exportReady(userId, jobId, url) {
    this.sent.push({ t: this.clock.now(), type: 'ready', userId, jobId, url });
  }

  exportFailed(userId, jobId, reason) {
    this.sent.push({ t: this.clock.now(), type: 'failed', userId, jobId, reason });
  }
}
`,
      },
      {
        path: "src/queue/backoff.js",
        content: `/**
 * Exponential backoff with "equal jitter": half of the window is fixed, half
 * is random. \`attempt\` is the attempt that just failed (1 = first try), so the
 * first retry waits between baseMs/2 and baseMs.
 */
export function computeBackoff(attempt, { baseMs, maxMs }, rng) {
  const window = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(window / 2 + rng() * (window / 2));
}

/** mulberry32: tiny seeded PRNG so backoff jitter is reproducible in tests. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
`,
      },
      {
        path: "src/queue/jobQueue.js",
        content: `/**
 * In-memory lease-based job queue (the production one is Redis-backed with the
 * same semantics).
 *
 *   ready    --lease()-->  leased  --ack()/fail()-->  (gone)
 *     ^                      |
 *     |                      +--nack(delay)--> delayed --timer--> ready
 *     +----requeueExpired()--+
 *
 * Every lease gets a fresh leaseId. Workers must present it to settle the job,
 * so a worker whose lease expired cannot settle a job someone else now owns.
 */
export class JobQueue {
  constructor({ clock, leaseMs }) {
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.ready = [];
    this.delayed = new Map();
    this.leases = new Map();
    this.leaseSeq = 0;
    this.enqueueSeq = 0;
    this.listeners = [];
  }

  onReady(fn) {
    this.listeners.push(fn);
  }

  enqueue(job) {
    job.enqueueSeq = ++this.enqueueSeq;
    this._insert(job);
    this._notify();
  }

  /** Highest priority first; FIFO (by original enqueue order) within a priority. */
  _insert(job) {
    const i = this.ready.findIndex(
      (j) => j.priority < job.priority || (j.priority === job.priority && j.enqueueSeq > job.enqueueSeq),
    );
    if (i === -1) this.ready.push(job);
    else this.ready.splice(i, 0, job);
  }

  _notify() {
    for (const fn of this.listeners) fn();
  }

  lease() {
    const job = this.ready.shift();
    if (!job) return null;
    job.attempts += 1;
    const leaseId = \`L\${++this.leaseSeq}\`;
    this.leases.set(job.id, { leaseId, job, expiresAt: this.clock.now() + this.leaseMs });
    return { job, leaseId };
  }

  /**
   * Fencing check: only the holder of the current lease may settle a job.
   * A worker whose lease was taken over by another worker gets \`false\`.
   */
  _owns(jobId, leaseId) {
    const current = this.leases.get(jobId);
    return !(current && current.leaseId !== leaseId);
  }

  /** Job finished successfully. Returns false if the caller no longer owns it. */
  ack(jobId, leaseId) {
    if (!this._owns(jobId, leaseId)) return false;
    this.leases.delete(jobId);
    return true;
  }

  /** Job failed permanently. Same ownership rules as ack(). */
  fail(jobId, leaseId) {
    return this.ack(jobId, leaseId);
  }

  /** Retryable failure: park the job and make it ready again after \`delayMs\`. */
  nack(job, leaseId, delayMs) {
    if (!this._owns(job.id, leaseId)) return false;
    this.leases.delete(job.id);
    const timer = this.clock.setTimeout(() => {
      this.delayed.delete(job.id);
      this._insert(job);
      this._notify();
    }, delayMs);
    this.delayed.set(job.id, { job, timer });
    return true;
  }

  /** Called by the reaper. Leases past their deadline go back to \`ready\`. */
  requeueExpired() {
    const now = this.clock.now();
    let n = 0;
    for (const [jobId, lease] of this.leases) {
      if (lease.expiresAt > now) continue;
      this.leases.delete(jobId);
      this._insert(lease.job);
      n++;
    }
    if (n) this._notify();
    return n;
  }

  stats() {
    return { ready: this.ready.length, delayed: this.delayed.size, leased: this.leases.size };
  }
}
`,
      },
      {
        path: "src/queue/reaper.js",
        content: `/**
 * Periodically returns expired leases to the queue. A lease expires when a
 * worker crashed, hung, or is simply slower than leaseMs.
 */
export function startReaper({ queue, clock, intervalMs, metrics }) {
  return clock.setInterval(() => {
    const n = queue.requeueExpired();
    if (n) metrics.inc('queue.lease_expired', n);
  }, intervalMs);
}
`,
      },
      {
        path: "src/render/formats.js",
        content: `import { ValidationError } from '../errors';

export const FORMATS = {
  png: { ext: 'png', contentType: 'image/png', maxPages: 1, msPerPage: 800 },
  pdf: { ext: 'pdf', contentType: 'application/pdf', maxPages: 200, msPerPage: 300 },
  mp4: { ext: 'mp4', contentType: 'video/mp4', maxPages: 50, msPerPage: 2500 },
};

export function validateExportRequest({ format, pages }) {
  const spec = FORMATS[format];
  if (!spec) throw new ValidationError(\`unsupported format \${format}\`);
  if (!Number.isInteger(pages) || pages < 1) throw new ValidationError('pages must be a positive integer');
  if (pages > spec.maxPages) throw new ValidationError(\`\${format} supports at most \${spec.maxPages} pages\`);
}

export function estimateRenderMs({ format, pages }) {
  return FORMATS[format].msPerPage * pages;
}
`,
      },
      {
        path: "src/render/renderer.js",
        content: `import { ExportError } from '../errors';
import { FORMATS, estimateRenderMs } from './formats';

/**
 * Stand-in for the headless render farm. \`script\` lets tests decide, per
 * design, how long each successive render takes and whether it fails:
 *
 *   { 'd-1': [{ ms: 7000 }, { ms: 2000, error: { status: 503 } }] }
 *
 * The last step repeats once the script runs out. Designs without a script
 * take estimateRenderMs().
 */
export class FakeRenderer {
  constructor({ clock, script = {} }) {
    this.clock = clock;
    this.script = script;
    this.calls = new Map();
    this.renders = 0;
  }

  async render(payload) {
    const n = (this.calls.get(payload.designId) ?? 0) + 1;
    this.calls.set(payload.designId, n);
    this.renders++;
    const steps = this.script[payload.designId] ?? [];
    const step = steps[n - 1] ?? steps[steps.length - 1] ?? { ms: estimateRenderMs(payload) };
    await this.clock.sleep(step.ms);
    if (step.error) throw new ExportError(step.error.message ?? 'render failed', step.error);
    const spec = FORMATS[payload.format];
    return { ext: spec.ext, contentType: spec.contentType, bytes: payload.pages * 1024 };
  }
}
`,
      },
      {
        path: "src/storage/assetStore.js",
        content: `import { ExportError } from '../errors';

/**
 * Fake of the export CDN bucket. put() is idempotent per key: writing the same
 * key twice overwrites the object (the URL stays the same).
 *
 * When the CDN throttles us it answers 429 with a standard HTTP
 * \`retry-after\` header (delta-seconds, or an HTTP date).
 */
export class FakeAssetStore {
  constructor() {
    this.objects = new Map();
    this.puts = [];
    this.throttleQueue = [];
  }

  /** Make the next \`n\` puts fail with 429 + retry-after. */
  throttle(n, retryAfter = '30') {
    for (let i = 0; i < n; i++) this.throttleQueue.push(retryAfter);
  }

  async put(key, file) {
    if (this.throttleQueue.length) {
      const retryAfter = this.throttleQueue.shift();
      throw new ExportError('cdn throttled', { status: 429, headers: { 'retry-after': retryAfter } });
    }
    this.puts.push(key);
    this.objects.set(key, file);
    return \`https://export.cdn.example/\${key}\`;
  }
}
`,
      },
      {
        path: "src/store/jobStore.js",
        content: `/**
 * Job records shown to users (GET /exports/:id). The queue holds the *work*;
 * this store holds the *status*. They are updated by different components,
 * so keep transitions here explicit and recorded.
 */
export class JobStore {
  constructor(clock) {
    this.clock = clock;
    this.records = new Map();
    this.history = [];
  }

  create(record) {
    const r = { ...record, createdAt: this.clock.now(), updatedAt: this.clock.now() };
    this.records.set(r.id, r);
    this.history.push({ t: this.clock.now(), id: r.id, state: r.state });
    return { ...r };
  }

  get(id) {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  update(id, patch) {
    const r = this.records.get(id);
    if (!r) throw new Error(\`unknown job \${id}\`);
    Object.assign(r, patch, { updatedAt: this.clock.now() });
    if (patch.state) this.history.push({ t: this.clock.now(), id, state: patch.state });
    return { ...r };
  }
}
`,
      },
      {
        path: "src/workers/exportWorker.js",
        content: `import { classifyError } from '../errors';
import { computeBackoff } from '../queue/backoff';

/**
 * Processes one leased job: render -> upload -> settle -> tell the user.
 * Settling (ack / nack / fail) is fenced by the leaseId; if the queue says we
 * no longer own the job, we must not touch the job record or notify anyone.
 */
export class ExportWorker {
  constructor({ queue, renderer, storage, notifier, jobs, clock, config, rng, metrics }) {
    this.queue = queue;
    this.renderer = renderer;
    this.storage = storage;
    this.notifier = notifier;
    this.jobs = jobs;
    this.clock = clock;
    this.config = config;
    this.rng = rng;
    this.metrics = metrics;
  }

  async process({ job, leaseId }) {
    const { payload } = job;
    this.jobs.update(job.id, { state: 'rendering', attempts: job.attempts });
    try {
      const file = await this.renderer.render(payload);
      const key = \`exports/\${payload.designId}/\${job.id}.\${file.ext}\`;
      const url = await this.storage.put(key, file);
      if (!this.queue.ack(job.id, leaseId)) {
        this.metrics.inc('export.stale_ack');
        return;
      }
      this.jobs.update(job.id, { state: 'done', url });
      this.notifier.exportReady(payload.userId, job.id, url);
      this.metrics.inc('export.completed');
    } catch (err) {
      this.handleFailure(job, leaseId, err);
    }
  }

  handleFailure(job, leaseId, err) {
    const verdict = classifyError(err);
    if (verdict === 'retry' && job.attempts < this.config.maxAttempts) {
      const delay = computeBackoff(job.attempts, this.config.backoff, this.rng);
      if (!this.queue.nack(job, leaseId, delay)) {
        this.metrics.inc('export.stale_nack');
        return;
      }
      this.jobs.update(job.id, {
        state: 'retry_scheduled',
        lastError: err.message,
        nextAttemptAt: this.clock.now() + delay,
      });
      this.metrics.inc('export.retried');
      return;
    }
    if (!this.queue.fail(job.id, leaseId)) {
      this.metrics.inc('export.stale_fail');
      return;
    }
    this.jobs.update(job.id, { state: 'failed', lastError: err.message });
    this.notifier.exportFailed(job.payload.userId, job.id, err.message);
    this.metrics.inc('export.failed');
  }
}
`,
      },
      {
        path: "src/workers/workerPool.js",
        content: `/**
 * Runs up to \`concurrency\` ExportWorker.process() calls at once and pulls the
 * next lease whenever a slot frees up or the queue signals new work.
 */
export class WorkerPool {
  constructor({ queue, worker, concurrency }) {
    this.queue = queue;
    this.worker = worker;
    this.concurrency = concurrency;
    this.active = 0;
    this.running = false;
    this.crashes = [];
    queue.onReady(() => this.pump());
  }

  start() {
    this.running = true;
    this.pump();
  }

  stop() {
    this.running = false;
  }

  pump() {
    while (this.running && this.active < this.concurrency) {
      const lease = this.queue.lease();
      if (!lease) return;
      this.active++;
      this.worker
        .process(lease)
        .catch((err) => this.crashes.push(err))
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}
`,
      },
      {
        path: "config/exportConfig.js",
        content: `/**
 * Export pipeline settings. Production overrides come from the deploy
 * manifest; tests pass overrides to createExportSystem().
 */
export const exportConfig = {
  /** Jobs rendered in parallel per node. Bounded by renderer memory (~1.5GB per PDF job). */
  concurrency: 2,
  /** How long a worker owns a job before the reaper hands it to someone else. */
  leaseMs: 5000,
  reapIntervalMs: 1000,
  /** Total attempts including the first one. */
  maxAttempts: 4,
  backoff: { baseMs: 1000, maxMs: 30000 },
  seed: 42,
};
`,
      },
      {
        path: "package.json",
        language: 'json',
        content: `{
  "name": "design-export-queue",
  "private": true,
  "version": "2.8.1",
  "scripts": {
    "test": "jest",
    "simulate": "node scripts/simulate.js"
  }
}
`,
      },
      {
        path: "scripts/simulate.js",
        content: `import { createExportSystem } from '../src/app';

// Reproduction for EXP-2291 ("I got the 'export ready' email twice").
// Defaults from config/exportConfig.js: concurrency 2, leaseMs 5000, reap every 1000ms.
async function main() {
  const sys = createExportSystem({
    renderScript: {
      // 40-page brochure PDF: the cold render is slower than the lease,
      // a re-render is faster because fonts/images are cached by then.
      'd-1': [{ ms: 7000 }, { ms: 2000 }],
      'd-2': [{ ms: 3000 }],
      'd-3': [{ ms: 4000 }],
    },
  });
  sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'pdf', pages: 40 });
  sys.service.createExport({ userId: 'u-2', designId: 'd-2', format: 'png' });
  sys.service.createExport({ userId: 'u-3', designId: 'd-3', format: 'png' });

  await sys.clock.runUntil(20000);
  sys.shutdown();

  for (const n of sys.notifier.sent) console.log(\`[\${n.t}] \${n.type} \${n.jobId}\`);
  console.log(\`renders=\${sys.renderer.renders} stale_acks=\${sys.metrics.get('export.stale_ack')}\`);
}

main();
`,
      },
      {
        path: "tests/queue.test.js",
        content: `import { computeBackoff } from '../src/queue/backoff';
import { createRng } from '../src/queue/backoff';
import { createExportSystem } from '../src/app';

test('happy path: one render, one upload, one notification', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 1200 }] } });
  const job = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  await sys.clock.runFor(5000);
  sys.shutdown();
  expect(sys.service.getStatus(job.id, 'u-1').state).toBe('done');
  expect(sys.notifier.sent).toHaveLength(1);
});

test('idempotency key dedupes double clicks per user', () => {
  const sys = createExportSystem();
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png', idempotencyKey: 'k1' });
  const b = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png', idempotencyKey: 'k1' });
  const c = sys.service.createExport({ userId: 'u-2', designId: 'd-1', format: 'png', idempotencyKey: 'k1' });
  sys.shutdown();
  expect(b.id).toBe(a.id);
  expect(c.id).not.toBe(a.id);
});

test('a 503 is retried and then succeeds', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 500, error: { status: 503 } }, { ms: 500 }] } });
  const job = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  await sys.clock.runFor(10000);
  sys.shutdown();
  const s = sys.service.getStatus(job.id, 'u-1');
  expect(s.state).toBe('done');
  expect(s.attempts).toBe(2);
});

test('first retry waits between base/2 and base', () => {
  const rng = createRng(1);
  for (let i = 0; i < 50; i++) {
    const d = computeBackoff(1, { baseMs: 1000, maxMs: 30000 }, rng);
    expect(d).toBeGreaterThanOrEqual(500);
    expect(d).toBeLessThanOrEqual(1000);
  }
});

test('window is capped at maxMs', () => {
  const rng = createRng(2);
  const d = computeBackoff(20, { baseMs: 1000, maxMs: 30000 }, rng);
  expect(d).toBeLessThanOrEqual(30000);
  expect(d).toBeGreaterThanOrEqual(15000);
});
`,
      },
    ],
    stages: [
      {
        id: 's1',
        kind: 'mcq',
        title: 'Orientation: queue semantics',
        prompt: 'Read `README.md`, `src/queue/jobQueue.js`, `src/workers/exportWorker.js` and `src/errors.js`. Which statements about the **current** code are true? Select all that apply.',
        options: [
          'A job\'s `attempts` is incremented when it is leased, not when it fails.',
          'A retryable error on the last allowed attempt marks the job `failed` and emails the user.',
          'Every 4xx response from the asset CDN is treated as fatal.',
          'The reaper puts an expired job back in `ready` without waiting for, or telling, the worker that is still processing it.',
          'Two different users who send the same `idempotencyKey` share one export job.',
          'A newly enqueued `pro` job can take over a worker slot from a `free` job that is already leased.',
        ],
        correct: [0, 1, 3],
        hints: [
          'Find every place that touches `job.attempts`.',
          'In `classifyError`, look at the explicit status checks before the fallback.',
          '`priority` is only used in one method. Which one?',
        ],
        explanation: `**True:**
- **(A)** \`lease()\` does \`job.attempts += 1\`. Nothing else increments it, so a lease that expires still uses up an attempt.
- **(B)** \`handleFailure\` retries only while \`job.attempts < maxAttempts\`. On attempt 4 of 4, a 503 goes to \`fail()\`, the job state becomes \`failed\`, and \`exportFailed\` is sent.
- **(D)** \`requeueExpired\` deletes the lease and calls \`_insert\` again. The original worker is still inside \`process()\` and has no idea. That is by design: it's how a queue recovers from crashed workers. It's also the reason fencing has to work.

**False:**
- **(C)** 408 and 429 are 4xx statuses, and both are retried.
- **(E)** Idempotency keys are scoped as \`\${userId}:\${key}\`.
- **(F)** Priority only affects the position in \`ready\` (\`_insert\`). A leased job is never preempted.`,
        timeLimitSec: 300,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's2',
        kind: 'trace',
        title: 'Trace: a 503, then success',
        prompt: 'A free user exports a PNG. The first render fails with HTTP 503 and the second succeeds. Order the steps as they execute.',
        items: [
          '`ExportService.createExport` validates, creates the job record, calls `queue.enqueue`',
          '`onReady` listener → `WorkerPool.pump` → `queue.lease()` (attempts = 1, leaseId L1)',
          '`ExportWorker.process` → `renderer.render` rejects with status 503',
          '`classifyError` returns `retry`; `computeBackoff(1, …)` picks a delay',
          '`queue.nack(job, L1, delay)` parks the job; job record → `retry_scheduled`',
          'Clock timer fires → job re-inserted into `ready` → `pump` → `lease()` (attempts = 2, L2)',
          'Render succeeds → `storage.put` uploads the file',
          '`queue.ack(job.id, L2)` returns true → record `done` → `notifier.exportReady`',
        ],
        hints: [
          'The pool never polls. Something has to call `pump()` when work appears.',
          'Look at where the record\'s state is updated relative to the `nack` / `ack` call.',
        ],
        explanation: `The queue drives the pool through the \`onReady\` callback: \`enqueue\`, the nack timer and \`requeueExpired\` all call \`_notify()\`, and \`pump()\` also runs whenever a slot frees up (\`finally\`).

The worker only updates the job record **after** the queue confirms that it still owns the lease (\`nack\`/\`ack\` returned \`true\`). That ownership check is the design's single line of defence against a stale worker. It's worth keeping in mind for the next stage.`,
        timeLimitSec: 420,
        focusFile: 'src/workers/exportWorker.js',
      },
      {
        id: 's3',
        kind: 'predict',
        title: 'Reproduce EXP-2291',
        prompt: `\`scripts/simulate.js\` replays the incident with the default config (concurrency 2, \`leaseMs\` 5000, reaper every 1000 ms). Three exports are created at t=0. The first render of \`d-1\` takes 7000 ms; a re-render takes 2000 ms.

What does it print? Trace the virtual clock carefully. Remember that timers due at the same time fire in **creation order**, and that all promise callbacks are drained after each timer.`,
        entry: 'scripts/simulate.js',
        answer: `[3000] ready job-2
[7000] ready job-1
[7000] ready job-3
[9000] ready job-1
renders=4 stale_acks=0`,
        options: [
          `[3000] ready job-2
[7000] ready job-1
[7000] ready job-3
[9000] ready job-1
renders=4 stale_acks=0`,
          `[3000] ready job-2
[7000] ready job-3
[9000] ready job-1
renders=4 stale_acks=1`,
          `[3000] ready job-2
[7000] ready job-1
[7000] ready job-3
renders=3 stale_acks=0`,
          `[3000] ready job-2
[7000] ready job-3
[7000] ready job-1
[9000] ready job-1
renders=4 stale_acks=0`,
          `[3000] ready job-2
[7000] ready job-1
[7000] ready job-3
[9000] ready job-1
renders=4 stale_acks=1`,
        ],
        hints: [
          't=0: job-1 (L1, expires 5000) and job-2 (L2) are leased. t=3000: job-2 finishes and job-3 is leased (L3). What does the reaper do at t=5000, and is a worker slot free at that moment?',
          'At t=7000 the worker that still holds the reaped job-1 calls `ack(\'job-1\', \'L1\')`. Where is job-1 at that moment: leased, ready, or delayed? Evaluate `_owns` for that case.',
          'Two timers are due at t=7000: job-1\'s render (created at t=0) and job-3\'s render (created at t=3000). The first one\'s whole promise chain, including `pump()`, runs before the second fires.',
        ],
        explanation: `Timeline:
- **t=0**: job-1 is leased (L1, expires 5000) and job-2 is leased (L2).
- **t=3000**: job-2 is acked and emailed. The slot frees, and job-3 is leased (L3).
- **t=5000**: the reaper finds L1 expired (\`expiresAt > now\` is false), deletes the lease and puts job-1 back in \`ready\`. Both slots are busy (the old job-1 worker is still rendering), so it waits.
- **t=7000, first timer**: the old worker finishes job-1 and calls \`ack('job-1', 'L1')\`. job-1 is in \`ready\`, so **it has no lease**, and \`_owns\` returns \`!(undefined && …)\`, which is \`true\`. The stale worker settles the job, marks it \`done\` and sends the first email. Its \`finally\` frees a slot, and \`pump\` leases job-1 **again** (L4, a 2000 ms re-render).
- **t=7000, second timer**: job-3 finishes and is emailed.
- **t=9000**: L4 acks legitimately, and a **second email** goes out for job-1.

That gives 4 renders and no stale acks, because the check meant to detect them never fired.

The root cause is that fencing **fails open**. \`_owns\` only rejects a caller when *some other* lease exists. "No lease at all" (reaped and waiting, parked in \`delayed\`, or already acked) is treated as "you own it". Option 2 is what the *fixed* code prints.`,
        timeLimitSec: 600,
        focusFile: 'scripts/simulate.js',
      },
      {
        id: 's4',
        kind: 'code',
        task: 'fix',
        title: 'Make fencing fail closed',
        prompt: `Fix EXP-2291 in \`src/queue/jobQueue.js\`. \`ack\`, \`nack\` and \`fail\` must succeed **only** for the caller that holds the job's *current* lease. In every other situation they return \`false\` and change nothing:
- the job was reaped and is waiting in \`ready\`;
- the job is parked in \`delayed\`;
- the job was already settled;
- someone else now holds the lease.

After the fix, \`scripts/simulate.js\` must send exactly one email per job, and the stale worker must be counted in \`export.stale_ack\`.`,
        editable: ['src/queue/jobQueue.js'],
        tests: [
          { path: "tests/fencing.hidden.test.js", content: `import { JobQueue } from '../src/queue/jobQueue';
import { VirtualClock } from '../src/clock/virtualClock';
import { createExportSystem } from '../src/app';

function q() {
  const clock = new VirtualClock(0);
  return { clock, queue: new JobQueue({ clock, leaseMs: 1000 }) };
}
const job = (id) => ({ id, priority: 0, attempts: 0, payload: {} });

test('ack with a reaped lease is rejected while the job waits in ready', async () => {
  const { clock, queue } = q();
  queue.enqueue(job('a'));
  const l1 = queue.lease();
  await clock.runFor(1500);
  expect(queue.requeueExpired()).toBe(1);
  expect(queue.ack('a', l1.leaseId)).toBe(false);
  expect(queue.stats()).toEqual({ ready: 1, delayed: 0, leased: 0 });
});

test('double ack: the second one is rejected', () => {
  const { queue } = q();
  queue.enqueue(job('a'));
  const l1 = queue.lease();
  expect(queue.ack('a', l1.leaseId)).toBe(true);
  expect(queue.ack('a', l1.leaseId)).toBe(false);
  expect(queue.fail('a', l1.leaseId)).toBe(false);
});

test('stale nack does not duplicate the job', async () => {
  const { clock, queue } = q();
  queue.enqueue(job('a'));
  const l1 = queue.lease();
  await clock.runFor(1500);
  queue.requeueExpired();
  expect(queue.nack(l1.job, l1.leaseId, 100)).toBe(false);
  await clock.runFor(500);
  expect(queue.stats()).toEqual({ ready: 1, delayed: 0, leased: 0 });
});

test('the current lease holder can still settle', async () => {
  const { clock, queue } = q();
  queue.enqueue(job('a'));
  const l1 = queue.lease();
  await clock.runFor(1500);
  queue.requeueExpired();
  const l2 = queue.lease();
  expect(queue.ack('a', l1.leaseId)).toBe(false);
  expect(queue.ack('a', l2.leaseId)).toBe(true);
});

test('EXP-2291: one email per export even when a lease expires under load', async () => {
  const sys = createExportSystem({
    renderScript: { 'd-1': [{ ms: 7000 }, { ms: 2000 }], 'd-2': [{ ms: 3000 }], 'd-3': [{ ms: 4000 }] },
  });
  sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'pdf', pages: 40 });
  sys.service.createExport({ userId: 'u-2', designId: 'd-2', format: 'png' });
  sys.service.createExport({ userId: 'u-3', designId: 'd-3', format: 'png' });
  await sys.clock.runUntil(20000);
  sys.shutdown();
  const ready = sys.notifier.sent.filter((n) => n.type === 'ready').map((n) => \`\${n.jobId}@\${n.t}\`);
  expect(ready).toEqual(['job-2@3000', 'job-3@7000', 'job-1@9000']);
  expect(sys.metrics.get('export.stale_ack')).toBe(1);
  expect(sys.service.getStatus('job-1', 'u-1').state).toBe('done');
});
` },
        ],
        solution: {
          "src/queue/jobQueue.js": `/**
 * In-memory lease-based job queue (the production one is Redis-backed with the
 * same semantics).
 *
 *   ready    --lease()-->  leased  --ack()/fail()-->  (gone)
 *     ^                      |
 *     |                      +--nack(delay)--> delayed --timer--> ready
 *     +----requeueExpired()--+
 *
 * Every lease gets a fresh leaseId. Workers must present it to settle the job,
 * so a worker whose lease expired cannot settle a job someone else now owns.
 */
export class JobQueue {
  constructor({ clock, leaseMs }) {
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.ready = [];
    this.delayed = new Map();
    this.leases = new Map();
    this.leaseSeq = 0;
    this.enqueueSeq = 0;
    this.listeners = [];
  }

  onReady(fn) {
    this.listeners.push(fn);
  }

  enqueue(job) {
    job.enqueueSeq = ++this.enqueueSeq;
    this._insert(job);
    this._notify();
  }

  /** Highest priority first; FIFO (by original enqueue order) within a priority. */
  _insert(job) {
    const i = this.ready.findIndex(
      (j) => j.priority < job.priority || (j.priority === job.priority && j.enqueueSeq > job.enqueueSeq),
    );
    if (i === -1) this.ready.push(job);
    else this.ready.splice(i, 0, job);
  }

  _notify() {
    for (const fn of this.listeners) fn();
  }

  lease() {
    const job = this.ready.shift();
    if (!job) return null;
    job.attempts += 1;
    const leaseId = \`L\${++this.leaseSeq}\`;
    this.leases.set(job.id, { leaseId, job, expiresAt: this.clock.now() + this.leaseMs });
    return { job, leaseId };
  }

  /**
   * Fencing check: only the holder of the current lease may settle a job.
   * A worker whose lease was taken over by another worker gets \`false\`.
   */
  _owns(jobId, leaseId) {
    const current = this.leases.get(jobId);
    // No current lease means the job was reaped (or already settled): the caller does NOT own it.
    return current !== undefined && current.leaseId === leaseId;
  }

  /** Job finished successfully. Returns false if the caller no longer owns it. */
  ack(jobId, leaseId) {
    if (!this._owns(jobId, leaseId)) return false;
    this.leases.delete(jobId);
    return true;
  }

  /** Job failed permanently. Same ownership rules as ack(). */
  fail(jobId, leaseId) {
    return this.ack(jobId, leaseId);
  }

  /** Retryable failure: park the job and make it ready again after \`delayMs\`. */
  nack(job, leaseId, delayMs) {
    if (!this._owns(job.id, leaseId)) return false;
    this.leases.delete(job.id);
    const timer = this.clock.setTimeout(() => {
      this.delayed.delete(job.id);
      this._insert(job);
      this._notify();
    }, delayMs);
    this.delayed.set(job.id, { job, timer });
    return true;
  }

  /** Called by the reaper. Leases past their deadline go back to \`ready\`. */
  requeueExpired() {
    const now = this.clock.now();
    let n = 0;
    for (const [jobId, lease] of this.leases) {
      if (lease.expiresAt > now) continue;
      this.leases.delete(jobId);
      this._insert(lease.job);
      n++;
    }
    if (n) this._notify();
    return n;
  }

  stats() {
    return { ready: this.ready.length, delayed: this.delayed.size, leased: this.leases.size };
  }
}
`,
        },
        hints: [
          'Write the truth table for `_owns`: (no lease), (lease with my id), (lease with another id). Which cases return `true` today?',
          'A stale `nack` is worse than a stale `ack`. Trace what it does to a job that is already back in `ready`.',
        ],
        explanation: `The one-line fix is \`return current !== undefined && current.leaseId === leaseId;\`. Ownership has to be **proven**, never assumed.

Why the old version was dangerous across all three operations:
- **stale ack** → duplicate emails (the incident).
- **stale nack** → the job is now in \`ready\` *and* gets inserted again by the backoff timer. Two copies of the job exist, and both get rendered.
- **double ack** → the second call succeeds, so a retry bug turns into duplicate side effects.

**A deeper consequence to raise with your interviewer:** now that fencing works, a job whose render *always* takes longer than \`leaseMs + reapIntervalMs\` **can never complete**. Every lease is reaped before its render finishes, and every ack is rightly rejected. In the incident the second render was faster (warm cache), which hid this. The real fix for long jobs is lease **heartbeats** (\`extend(jobId, leaseId)\` while rendering). Fencing protects correctness, and heartbeats protect progress.`,
        timeLimitSec: 720,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's5',
        kind: 'review-ai',
        title: 'The assistant handles CDN throttling',
        prompt: 'Peak traffic also triggers CDN throttling (see `FakeAssetStore.throttle`). You ask the assistant to make retries respect it. Review its patch.',
        persona: 'confident-intern',
        request: 'When the export CDN throttles us (429), honour its Retry-After instead of our own backoff. Patch ExportWorker.handleFailure.',
        aiReply: `Great idea. The CDN already tells us how long to wait, so let's listen! 🎯

\`\`\`js
handleFailure(job, leaseId, err) {
  const verdict = classifyError(err);
  if (verdict === 'retry' && job.attempts < this.config.maxAttempts) {
    // Honour the CDN's Retry-After when throttled; otherwise back off as usual.
    const retryAfter = Number(err.headers?.['retry-after']);
    const delay = retryAfter || computeBackoff(job.attempts, this.config.backoff, this.rng);
    if (!this.queue.nack(job, leaseId, delay)) {
      this.metrics.inc('export.stale_nack');
      return;
    }
    // ...unchanged...
\`\`\`

- \`Number(...)\` gives \`NaN\` for missing or garbage headers, and \`NaN || backoff\` falls back cleanly.
- \`?.\` guards against errors without headers.
- The injected \`rng\` keeps tests deterministic.

This is safe to ship as is. ✅`,
        options: [
          'Accept: Retry-After is honoured, and the fallback covers missing or malformed headers',
          'Reject: `retry-after` is in **seconds** (or an HTTP date), but `nack` takes milliseconds. `"30"` becomes a 30 ms delay, so the job is re-leased almost immediately, re-renders, hits the still-throttled CDN again, and burns through `maxAttempts` long before the 30 s window ends, adding load to the service that asked us to back off.',
          'Reject: `ExportError.headers` can be `undefined`, so `err.headers?.[...]` throws a TypeError',
          'Reject: `Number()` throws on an HTTP-date value like `Wed, 21 Oct 2015 07:28:00 GMT`',
          'Reject: the only problem is `||`. `retry-after: 0` should mean "retry now", not "use our backoff"',
        ],
        correct: 1,
        hints: [
          'Open `src/storage/assetStore.js` and read the doc comment about the header format.',
          'What unit does `queue.nack(job, leaseId, delayMs)` expect?',
        ],
        explanation: `HTTP \`Retry-After\` is **delta-seconds** or an HTTP-date. \`FakeAssetStore\` sends \`'30'\`, the assistant passes \`30\` to an API measured in **milliseconds**, and the retry fires 1000× too early. Because each retry re-renders and re-uploads, the job uses up all 4 attempts during the throttle window and then fails permanently. Meanwhile it has added load to the CDN that asked us to slow down.

Why the others are wrong:
- \`ExportError\` defaults \`headers\` to \`{}\`, and \`?.\` handles errors from other sources.
- \`Number('Wed, …')\` returns \`NaN\`; it doesn't throw. (Ignoring HTTP-dates is a minor gap, not the blocker.)
- Treating \`0\` as "use backoff" is a harmless deviation and not "the only problem".

A correct version: \`const sec = Number(h); const delay = Number.isFinite(sec) ? Math.max(sec * 1000, backoff) : backoff\`, plus HTTP-date parsing, and ideally a cap at \`backoff.maxMs\` so a hostile header can't park a job for a day.

The *confident-intern* pattern is a fluent justification of the parts that are right (NaN fallback, \`?.\`, rng) that distracts from the one part that's wrong: the **unit**.`,
        timeLimitSec: 420,
        focusFile: 'src/storage/assetStore.js',
      },
      {
        id: 's6',
        kind: 'code',
        task: 'feature',
        title: 'Feature: cancel an export',
        prompt: `Product wants a **Cancel** button next to running exports. Implement \`ExportService.cancel(jobId, userId)\`, which returns \`true\` if the export will now produce **no file and no email**, and \`false\` otherwise.

| Job is... | Expected |
| --- | --- |
| unknown, or owned by another user | \`false\` |
| \`done\`, \`failed\` or already \`cancelled\` | \`false\`, nothing changes |
| waiting in \`ready\` | removed, record → \`cancelled\`, never rendered |
| parked in \`delayed\` (retry backoff) | removed; **the pending retry timer must not bring it back** |
| being rendered | \`true\` and record → \`cancelled\` immediately. When the render finishes: no upload, no email, lease released. If the render *fails*, it is not retried. If the lease expires meanwhile, no other worker picks it up. |

Afterwards, \`queue.stats()\` must show no trace of the job. You may edit the queue, the worker and the service. Keep the fencing fix from the previous stage.`,
        editable: ['src/api/exportService.js', 'src/queue/jobQueue.js', 'src/workers/exportWorker.js'],
        tests: [
          { path: "tests/cancel.hidden.test.js", content: `import { createExportSystem } from '../src/app';

test('cancel a queued job: never rendered, never notified', async () => {
  const sys = createExportSystem({ config: { concurrency: 1 }, renderScript: { 'd-1': [{ ms: 2000 }], 'd-2': [{ ms: 1000 }] } });
  sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  const b = sys.service.createExport({ userId: 'u-2', designId: 'd-2', format: 'png' });
  expect(sys.service.cancel(b.id, 'u-2')).toBe(true);
  await sys.clock.runFor(10000);
  sys.shutdown();
  expect(sys.renderer.calls.get('d-2')).toBeUndefined();
  expect(sys.service.getStatus(b.id, 'u-2').state).toBe('cancelled');
  expect(sys.notifier.sent.map((n) => n.jobId)).toEqual(['job-1']);
});

test('cancel during retry backoff: the retry timer must not resurrect it', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 500, error: { status: 503 } }, { ms: 500 }] } });
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  await sys.clock.runFor(600);
  expect(sys.service.getStatus(a.id, 'u-1').state).toBe('retry_scheduled');
  expect(sys.service.cancel(a.id, 'u-1')).toBe(true);
  await sys.clock.runFor(60000);
  sys.shutdown();
  expect(sys.renderer.renders).toBe(1);
  expect(sys.service.getStatus(a.id, 'u-1').state).toBe('cancelled');
  expect(sys.notifier.sent).toHaveLength(0);
  expect(sys.queue.stats()).toEqual({ ready: 0, delayed: 0, leased: 0 });
});

test('cancel while rendering: no upload, no email, lease released', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 3000 }] } });
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  await sys.clock.runFor(1000);
  expect(sys.service.cancel(a.id, 'u-1')).toBe(true);
  await sys.clock.runFor(10000);
  sys.shutdown();
  expect(sys.storage.puts).toEqual([]);
  expect(sys.notifier.sent).toHaveLength(0);
  expect(sys.service.getStatus(a.id, 'u-1').state).toBe('cancelled');
  expect(sys.queue.stats()).toEqual({ ready: 0, delayed: 0, leased: 0 });
});

test('cancel while rendering, render then fails: not retried', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 3000, error: { status: 503 } }, { ms: 100 }] } });
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  await sys.clock.runFor(1000);
  sys.service.cancel(a.id, 'u-1');
  await sys.clock.runFor(60000);
  sys.shutdown();
  expect(sys.renderer.renders).toBe(1);
  expect(sys.notifier.sent).toHaveLength(0);
  expect(sys.service.getStatus(a.id, 'u-1').state).toBe('cancelled');
});

test('slow render cancelled: the reaper must not hand it to another worker', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 8000 }] } });
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'pdf', pages: 40 });
  await sys.clock.runFor(1000);
  sys.service.cancel(a.id, 'u-1');
  await sys.clock.runFor(30000);
  sys.shutdown();
  expect(sys.renderer.renders).toBe(1);
  expect(sys.notifier.sent).toHaveLength(0);
});

test('cannot cancel finished, foreign or unknown jobs', async () => {
  const sys = createExportSystem({ renderScript: { 'd-1': [{ ms: 500 }] } });
  const a = sys.service.createExport({ userId: 'u-1', designId: 'd-1', format: 'png' });
  const b = sys.service.createExport({ userId: 'u-1', designId: 'd-2', format: 'png' });
  expect(sys.service.cancel(b.id, 'u-2')).toBe(false);
  await sys.clock.runFor(5000);
  sys.shutdown();
  expect(sys.service.cancel(a.id, 'u-1')).toBe(false);
  expect(sys.service.cancel('job-404', 'u-1')).toBe(false);
  expect(sys.service.getStatus(a.id, 'u-1').state).toBe('done');
});
` },
        ],
        solution: {
          "src/api/exportService.js": `import { validateExportRequest } from '../render/formats';

/**
 * Entry point for POST /exports and GET /exports/:id.
 *
 * Idempotency keys are scoped per user: the editor sends the same key when a
 * user double-clicks "Download", and two users can never collide.
 */
export class ExportService {
  constructor({ queue, jobs }) {
    this.queue = queue;
    this.jobs = jobs;
    this.idempotency = new Map();
    this.seq = 0;
  }

  createExport({ userId, designId, format, pages = 1, plan = 'free', idempotencyKey }) {
    validateExportRequest({ format, pages });
    const idemKey = idempotencyKey ? \`\${userId}:\${idempotencyKey}\` : null;
    if (idemKey && this.idempotency.has(idemKey)) {
      return this.jobs.get(this.idempotency.get(idemKey));
    }
    const id = \`job-\${++this.seq}\`;
    const record = this.jobs.create({ id, userId, designId, format, pages, state: 'queued', attempts: 0 });
    if (idemKey) this.idempotency.set(idemKey, id);
    this.queue.enqueue({
      id,
      priority: plan === 'pro' ? 1 : 0,
      attempts: 0,
      payload: { userId, designId, format, pages },
    });
    return record;
  }

  /** Returns true if the job will not produce a file or a notification. */
  cancel(jobId, userId) {
    const r = this.jobs.get(jobId);
    if (!r || r.userId !== userId) return false;
    if (r.state === 'done' || r.state === 'failed' || r.state === 'cancelled') return false;
    if (!this.queue.cancel(jobId)) return false;
    this.jobs.update(jobId, { state: 'cancelled' });
    return true;
  }

  getStatus(jobId, userId) {
    const r = this.jobs.get(jobId);
    if (!r || r.userId !== userId) return null;
    return r;
  }
}
`,
          "src/queue/jobQueue.js": `/**
 * In-memory lease-based job queue (the production one is Redis-backed with the
 * same semantics).
 *
 *   ready    --lease()-->  leased  --ack()/fail()-->  (gone)
 *     ^                      |
 *     |                      +--nack(delay)--> delayed --timer--> ready
 *     +----requeueExpired()--+
 *
 * Every lease gets a fresh leaseId. Workers must present it to settle the job,
 * so a worker whose lease expired cannot settle a job someone else now owns.
 */
export class JobQueue {
  constructor({ clock, leaseMs }) {
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.ready = [];
    this.delayed = new Map();
    this.leases = new Map();
    this.leaseSeq = 0;
    this.enqueueSeq = 0;
    this.listeners = [];
  }

  onReady(fn) {
    this.listeners.push(fn);
  }

  enqueue(job) {
    job.enqueueSeq = ++this.enqueueSeq;
    this._insert(job);
    this._notify();
  }

  /** Highest priority first; FIFO (by original enqueue order) within a priority. */
  _insert(job) {
    const i = this.ready.findIndex(
      (j) => j.priority < job.priority || (j.priority === job.priority && j.enqueueSeq > job.enqueueSeq),
    );
    if (i === -1) this.ready.push(job);
    else this.ready.splice(i, 0, job);
  }

  _notify() {
    for (const fn of this.listeners) fn();
  }

  lease() {
    const job = this.ready.shift();
    if (!job) return null;
    job.attempts += 1;
    const leaseId = \`L\${++this.leaseSeq}\`;
    this.leases.set(job.id, { leaseId, job, expiresAt: this.clock.now() + this.leaseMs });
    return { job, leaseId };
  }

  /**
   * Fencing check: only the holder of the current lease may settle a job.
   * A worker whose lease was taken over by another worker gets \`false\`.
   */
  _owns(jobId, leaseId) {
    const current = this.leases.get(jobId);
    // No current lease means the job was reaped (or already settled): the caller does NOT own it.
    return current !== undefined && current.leaseId === leaseId;
  }

  /** Job finished successfully. Returns false if the caller no longer owns it. */
  ack(jobId, leaseId) {
    if (!this._owns(jobId, leaseId)) return false;
    this.leases.delete(jobId);
    return true;
  }

  /** Job failed permanently. Same ownership rules as ack(). */
  fail(jobId, leaseId) {
    return this.ack(jobId, leaseId);
  }

  /** Retryable failure: park the job and make it ready again after \`delayMs\`. */
  nack(job, leaseId, delayMs) {
    if (!this._owns(job.id, leaseId)) return false;
    this.leases.delete(job.id);
    const timer = this.clock.setTimeout(() => {
      this.delayed.delete(job.id);
      this._insert(job);
      this._notify();
    }, delayMs);
    this.delayed.set(job.id, { job, timer });
    return true;
  }

  /** Called by the reaper. Leases past their deadline go back to \`ready\`. */
  requeueExpired() {
    const now = this.clock.now();
    let n = 0;
    for (const [jobId, lease] of this.leases) {
      if (lease.expiresAt > now) continue;
      this.leases.delete(jobId);
      if (lease.job.cancelled) continue; // never resurrect a cancelled job
      this._insert(lease.job);
      n++;
    }
    if (n) this._notify();
    return n;
  }

  /**
   * Cancel a job wherever it is. Returns 'removed' if it was waiting (ready or
   * delayed), 'running' if a worker holds it (the worker must observe
   * job.cancelled), or null if the queue no longer knows the job.
   */
  cancel(jobId) {
    const i = this.ready.findIndex((j) => j.id === jobId);
    if (i !== -1) {
      const [job] = this.ready.splice(i, 1);
      job.cancelled = true;
      return 'removed';
    }
    const parked = this.delayed.get(jobId);
    if (parked) {
      this.clock.clearTimeout(parked.timer);
      this.delayed.delete(jobId);
      parked.job.cancelled = true;
      return 'removed';
    }
    const lease = this.leases.get(jobId);
    if (lease) {
      lease.job.cancelled = true;
      return 'running';
    }
    return null;
  }

  stats() {
    return { ready: this.ready.length, delayed: this.delayed.size, leased: this.leases.size };
  }
}
`,
          "src/workers/exportWorker.js": `import { classifyError } from '../errors';
import { computeBackoff } from '../queue/backoff';

/**
 * Processes one leased job: render -> upload -> settle -> tell the user.
 * Settling (ack / nack / fail) is fenced by the leaseId; if the queue says we
 * no longer own the job, we must not touch the job record or notify anyone.
 */
export class ExportWorker {
  constructor({ queue, renderer, storage, notifier, jobs, clock, config, rng, metrics }) {
    this.queue = queue;
    this.renderer = renderer;
    this.storage = storage;
    this.notifier = notifier;
    this.jobs = jobs;
    this.clock = clock;
    this.config = config;
    this.rng = rng;
    this.metrics = metrics;
  }

  async process({ job, leaseId }) {
    const { payload } = job;
    this.jobs.update(job.id, { state: 'rendering', attempts: job.attempts });
    try {
      const file = await this.renderer.render(payload);
      if (job.cancelled) {
        // User cancelled while we were rendering: release the lease, no upload, no email.
        this.queue.ack(job.id, leaseId);
        this.metrics.inc('export.cancelled_in_flight');
        return;
      }
      const key = \`exports/\${payload.designId}/\${job.id}.\${file.ext}\`;
      const url = await this.storage.put(key, file);
      if (!this.queue.ack(job.id, leaseId)) {
        this.metrics.inc('export.stale_ack');
        return;
      }
      this.jobs.update(job.id, { state: 'done', url });
      this.notifier.exportReady(payload.userId, job.id, url);
      this.metrics.inc('export.completed');
    } catch (err) {
      this.handleFailure(job, leaseId, err);
    }
  }

  handleFailure(job, leaseId, err) {
    if (job.cancelled) {
      this.queue.fail(job.id, leaseId);
      return;
    }
    const verdict = classifyError(err);
    if (verdict === 'retry' && job.attempts < this.config.maxAttempts) {
      const delay = computeBackoff(job.attempts, this.config.backoff, this.rng);
      if (!this.queue.nack(job, leaseId, delay)) {
        this.metrics.inc('export.stale_nack');
        return;
      }
      this.jobs.update(job.id, {
        state: 'retry_scheduled',
        lastError: err.message,
        nextAttemptAt: this.clock.now() + delay,
      });
      this.metrics.inc('export.retried');
      return;
    }
    if (!this.queue.fail(job.id, leaseId)) {
      this.metrics.inc('export.stale_fail');
      return;
    }
    this.jobs.update(job.id, { state: 'failed', lastError: err.message });
    this.notifier.exportFailed(job.payload.userId, job.id, err.message);
    this.metrics.inc('export.failed');
  }
}
`,
        },
        hints: [
          'The job can be in three places inside the queue: `ready`, `delayed` (with a clock timer), or `leases`. Write `queue.cancel(jobId)` that handles each case and tells the caller which one it was.',
          'For a running job you can\'t interrupt the render. Mark the shared job object (e.g. `job.cancelled = true`) and have the worker check it after `render()` resolves and before anything with side effects.',
          'Two more paths can resurrect a cancelled job: the `nack` backoff timer (clear it) and `requeueExpired` (skip cancelled jobs). The worker\'s failure path has to check the flag too.',
        ],
        explanation: `Cancellation in a queue with retries is mostly about finding **every path that can bring a job back**:
1. \`ready\` → splice it out.
2. \`delayed\` → \`clock.clearTimeout(timer)\`. Otherwise the timer calls \`_insert\` later and the job comes back from the dead.
3. Leased → you can't preempt a render, so set \`job.cancelled = true\` on the object the worker shares. The worker checks it **after the await and before any side effect** (upload, email), then releases its lease with \`ack\`.
4. A failed render of a cancelled job → \`handleFailure\` must not \`nack\`.
5. Reaper → \`requeueExpired\` must drop cancelled jobs instead of re-inserting them. Otherwise a slow cancelled render gets handed to a new worker.

The job record is set to \`cancelled\` by the service. The worker deliberately leaves it alone on the cancel path, so the user-visible state never flips back to \`done\`.

There's one race the tests can't show here: in production the check-then-upload in the worker isn't atomic with the user's click. Clicking Cancel just after the check still produces a file. That's acceptable if the email is suppressed, or if the UI says "cancelling…". Saying this out loud in the interview earns credit.`,
        timeLimitSec: 1200,
        focusFile: 'src/queue/jobQueue.js',
      },
      {
        id: 's7',
        kind: 'review-ai',
        title: 'Follow-up: holiday traffic plan',
        prompt: 'Last question. The interviewer pastes a senior engineer\'s answer to a capacity question and asks: "Would you sign off on this plan? If not, what\'s wrong with it?"',
        persona: 'helpful-senior',
        request: 'Fencing is fixed. Holiday campaign: export traffic will double and PDF p99 render time is ~9 s. What should we change before then, and what should we alert on?',
        aiReply: `Here's what I'd do, in priority order.

**1. Leases vs. render time.** \`leaseMs\` is 5 s and the PDF p99 is 9 s. With fencing now correct, any render that outlives its lease is wasted: the reaper gives the job to a second worker and the first worker's ack is rejected. A job that *consistently* takes longer than \`leaseMs + reapIntervalMs\` never completes at all. Add **heartbeats**: while rendering, the worker calls \`queue.extend(jobId, leaseId)\` every ~leaseMs/3, fenced by the same leaseId. Keep \`leaseMs\` short so a crashed worker is still detected in seconds. Don't just raise it to minutes.

**2. Scale out, not up.** Per-node concurrency is bounded by renderer memory (~1.5 GB per PDF). Add render nodes; the production queue is shared, so workers scale horizontally.

**3. Fairness.** Ordering is plan priority, then FIFO. One user exporting 200 designs would delay everyone in their tier. Add a per-user in-flight cap or round-robin across users within a priority.

**4. Retries under load.** Retries multiply load during incidents. Keep equal jitter and the attempt cap, and add a circuit breaker on CDN 429s so we pause uploads instead of re-rendering into a throttle.

**5. Alerts.**
- Age of the oldest \`ready\` job (this is the user-facing latency SLO; depth alone doesn't say whether we're keeping up)
- \`queue.lease_expired\` and \`export.stale_ack\` rates (wasted renders)
- Retry rate by error class, and \`export.failed\` rate
- p50/p99 render time per format, compared with \`leaseMs\``,
        options: [
          'Sign off: the plan is sound and addresses lease sizing, capacity, fairness, retry amplification and the right signals',
          'Don\'t sign off: heartbeats are unnecessary now that fencing rejects stale acks, because duplicates can no longer happen',
          'Don\'t sign off: the simpler fix is `leaseMs = 120000`; how fast we detect crashed workers doesn\'t matter for exports',
          'Don\'t sign off: "age of the oldest ready job" is redundant with queue depth, so alerting on depth is enough',
          'Don\'t sign off: per-user fairness is unnecessary because `priority` already separates pro and free users',
        ],
        correct: 0,
        hints: [
          'Check each claim against the code: what happens today to a 9 s render with a 5 s lease? (You worked this out in stage 4.)',
          'For each rejection option, ask whether it is actually true or just sounds cautious.',
        ],
        explanation: `The answer is correct and grounded in this codebase, so it's right to sign off. Recognising a good answer is part of the skill too. Rejecting everything that comes from an AI is just as miscalibrated as accepting everything.

Why each objection fails:
- **Heartbeats vs. fencing.** Fencing stops *double settlement*; it does nothing about *wasted or never-ending re-renders*. At a 9 s p99 with a 5 s lease, the slow tail would be rendered repeatedly and never acked.
- **\`leaseMs = 120000\`.** A crashed worker's job would then sit invisible for up to two minutes. Heartbeats give you short crash detection *and* long jobs.
- **Depth vs. age.** 10k queued jobs might drain in 30 s or in 30 min. Oldest-job age measures what users actually experience.
- **Priority vs. fairness.** Priority separates *tiers*. Inside a tier the ordering is FIFO, so one user with a big batch can starve every other user in that tier.`,
        timeLimitSec: 420,
        focusFile: 'config/exportConfig.js',
      },
    ],
  },
];

export default problems;
