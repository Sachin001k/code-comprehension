import { supabase } from './supabase';
import type { PersonaId, Problem, Stage } from '../content/types';
import { PERSONAS } from '../content/personas';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  flaw?: { type: string; detail: string } | null;
  offline?: boolean;
}

export interface AskInput {
  persona: PersonaId;
  messages: ChatMsg[];
  files: { path: string; content: string }[];
  openFile?: string;
  problem: Problem;
  stage: Stage;
}

export async function askAssistant(inp: AskInput): Promise<ChatMsg> {
  if (supabase) {
    const { data: s } = await supabase.auth.getSession();
    if (s.session) {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          persona: inp.persona,
          messages: inp.messages.map((m) => ({ role: m.role, content: m.content })),
          files: inp.files,
          openFile: inp.openFile,
          task: `${inp.stage.title}\n${inp.stage.prompt}`,
          problemTitle: inp.problem.title,
        },
      });
      if (!error && data?.reply) return { role: 'assistant', content: data.reply, flaw: data.flaw ?? null };
      let msg = error?.message ?? data?.error;
      try {
        const ctx = (error as { context?: Response } | null)?.context;
        if (ctx) msg = (await ctx.json()).error ?? msg;
      } catch { /* ignore */ }
      if (msg && !/Failed to send|not found|FunctionsFetchError|FunctionsRelayError/i.test(msg)) {
        return { role: 'assistant', content: `⚠️ ${msg}`, offline: true };
      }
    }
  }
  return offlineReply(inp);
}

/** Deterministic local assistant used in guest mode or when the edge function is not deployed. */
function offlineReply(inp: AskInput): ChatMsg {
  const q = inp.messages[inp.messages.length - 1]?.content ?? '';
  const persona = PERSONAS[inp.persona];
  const files = persona.singleFileContext ? inp.files.filter((f) => f.path === inp.openFile) : inp.files;
  const lines: string[] = [];

  // 1. Symbol lookup: find identifiers in the question and locate definitions/usages.
  const idents = [...new Set((q.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []).filter((w) => !STOP.has(w.toLowerCase())))];
  const hits: string[] = [];
  for (const id of idents.slice(0, 6)) {
    const defRe = new RegExp(`(function\\s+${id}\\b|def\\s+${id}\\b|class\\s+${id}\\b|(const|let|var)\\s+${id}\\b|\\b${id}\\s*[:=]\\s*(async\\s*)?\\(|\\b${id}\\s*\\([^)]*\\)\\s*[:{]|\\s${id}\\s*\\([^;]*\\)\\s*(const\\s*)?\\{)`);
    for (const f of files) {
      f.content.split('\n').forEach((ln, i) => {
        if (defRe.test(ln) && hits.length < 6) hits.push(`- \`${id}\` is defined in **${f.path}:${i + 1}** → \`${ln.trim().slice(0, 90)}\``);
      });
    }
    const usedIn = files.filter((f) => new RegExp(`\\b${id}\\b`).test(f.content)).map((f) => f.path);
    if (usedIn.length > 1 && hits.length < 8) hits.push(`- \`${id}\` is referenced in: ${usedIn.map((p) => `\`${p}\``).join(', ')}`);
  }
  if (hits.length) lines.push('Here is what I found in the code I can see:', ...hits);

  // 2. File mention
  const mentioned = inp.files.filter((f) => q.includes(f.path) || q.includes(f.path.split('/').pop()!));
  for (const f of mentioned.slice(0, 2)) {
    const exports = f.content.split('\n').map((l, i) => [l, i + 1] as const).filter(([l]) => /^(export |def |class |function |public |module\.exports)/.test(l.trim())).slice(0, 8);
    if (exports.length) lines.push(`\n**${f.path}** top-level symbols:`, ...exports.map(([l, n]) => `- L${n}: \`${l.trim().slice(0, 80)}\``));
  }

  // 3. Socratic nudge from the stage's hint ladder.
  const hint = inp.stage.hints[Math.min(inp.messages.filter((m) => m.role === 'user').length - 1, inp.stage.hints.length - 1)];
  if (hint) lines.push(`\n💡 Something to check: ${hint}`);

  if (!lines.length) {
    lines.push(
      'I could not match anything specific. Try naming a **function, class or file path** (e.g. "where is `book` defined?" or "what does src/service.ts do?").',
    );
  }

  const flavour: Partial<Record<PersonaId, string>> = {
    'confident-intern': 'Pretty sure this is it. 😎',
    'tunnel-vision': `_(I can only see \`${inp.openFile ?? 'the open file'}\`.)_`,
    'rate-limited': '_(Rate-limited assistant: be precise with your questions.)_',
    'outdated-docs': '_(Note: my docs may be a few versions old.)_',
  };
  if (flavour[inp.persona]) lines.push(`\n${flavour[inp.persona]}`);
  lines.push('\n_Offline assistant. Sign in (with the AI edge function deployed) for the live, imperfect LLM persona._');
  return { role: 'assistant', content: lines.join('\n'), offline: true };
}

const STOP = new Set(
  'the and what does this that where which when why how are for with from into line file code function method class return value values should would could please explain about there their then than have has not but why can you tell show find call calls called define defined does doing done print prints output bug fix'.split(' '),
);
