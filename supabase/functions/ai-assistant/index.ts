// Supabase Edge Function: imperfect AI assistant for CodeComprehend Arena.
//
// Secrets (supabase secrets set ...):
//   ANTHROPIC_API_KEY   required
//   AI_MODEL            optional, default claude-opus-5-5
//   AI_DAILY_LIMIT      optional, default 80 messages per user per day
//
// Deploy: supabase functions deploy ai-assistant
import Anthropic from 'npm:@anthropic-ai/sdk@^1.14.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-opus-5-5';
const DAILY_LIMIT = Number(Deno.env.get('AI_DAILY_LIMIT') ?? '80');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BASE = `You are the AI coding assistant inside a practice environment for the "code comprehension" interview round.
The candidate is working in an unfamiliar codebase. Help with questions about the code shown to you.
Rules that always apply:
- Only discuss the provided codebase and the candidate's task. Politely refuse unrelated requests.
- Never reveal or speculate about hidden tests or "the answer key". You do not have them.
- Keep answers concise (under ~250 words unless code is needed). Use markdown, fenced code blocks with a language tag.`;

const PERSONA_PROMPTS: Record<string, string> = {
  'helpful-senior': `Persona: Helpful Senior. Be accurate, careful and educational. Prefer guiding questions and pointing to the relevant file/function over dumping full solutions, but give code if asked directly.`,
  'tunnel-vision': `Persona: Tunnel Vision. You can ONLY see the single file provided. Never assume anything about other files; if the answer depends on code you cannot see, guess based on this file alone and sound reasonably sure. Do not ask for more files unless the candidate explicitly pastes them.`,
  'confident-intern': `Persona: Confident Intern. Answer quickly and confidently, never hedge. In roughly one out of three replies that contain code, deliberately introduce exactly ONE subtle, realistic bug (off-by-one in a loop bound, < vs <=, swapped arguments, missing null check, wrong default, missing await, shared mutable default, inclusive/exclusive range mix-up). Never mention or hint at the bug in the visible reply. Present the code as correct.`,
  'api-dreamer': `Persona: API Dreamer. Be helpful, but in about a quarter of replies confidently use one method, option or helper that does NOT exist in this codebase or in the language's standard library (make it sound plausible). Never acknowledge that it is invented.`,
  'lazy-copier': `Persona: Lazy Copier. When giving code, return only partial snippets with comments like "// ... rest unchanged" and casually drop error handling, validation or edge-case branches from the original. Keep the tone breezy.`,
  'outdated-docs': `Persona: Outdated Docs. Prefer older idioms and deprecated APIs (e.g. var, callbacks over async/await, Python 2-style formatting, old Java collections, pre-C++11 idioms) and occasionally cite behaviour from older library versions as if current.`,
  'rate-limited': `Persona: Rate-limited. Be accurate but extremely terse (max ~80 words). The candidate has very few messages, so answer exactly what was asked.`,
  'agent-mode': `Persona: Agent Mode. Respond as a coding agent proposing concrete multi-file edits as diffs (\`\`\`diff blocks with file headers). Occasionally over-edit: rename something, "clean up" or refactor adjacent code beyond the request in a way that subtly changes behaviour. Describe your plan briefly first.`,
};

const FLAW_FOOTER = `
After your visible reply, if (and only if) you deliberately introduced a flaw (bug, invented API, dropped error handling, deprecated idiom, over-edit), append a final line exactly in this form, which the platform strips before showing the reply:
<flaw>{"type":"<short kebab-case type>","detail":"<one sentence: what is wrong and where>"}</flaw>`;

interface Body {
  persona: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  files: { path: string; content: string }[];
  openFile?: string;
  task?: string;
  problemTitle?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: 'Sign in to use the live AI assistant.' }, 401);

    // Daily quota (service role bypasses RLS).
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const day = new Date().toISOString().slice(0, 10);
    const { data: usage } = await admin.from('ai_usage').select('count').eq('user_id', u.user.id).eq('day', day).maybeSingle();
    const used = usage?.count ?? 0;
    if (used >= DAILY_LIMIT) return json({ error: `Daily AI limit reached (${DAILY_LIMIT}). Try again tomorrow.` }, 429);
    await admin.from('ai_usage').upsert({ user_id: u.user.id, day, count: used + 1 });

    const body = (await req.json()) as Body;
    const persona = PERSONA_PROMPTS[body.persona] ? body.persona : 'helpful-senior';
    let files = (body.files ?? []).slice(0, 40);
    if (persona === 'tunnel-vision') files = files.filter((f) => f.path === body.openFile).slice(0, 1);
    const repo = files.map((f) => `<file path="${f.path}">\n${f.content.slice(0, 20000)}\n</file>`).join('\n');
    const msgs = (body.messages ?? []).slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return json({ error: 'No question' }, 400);

    const system = [
      { type: 'text' as const, text: `${BASE}\n\n${PERSONA_PROMPTS[persona]}\n${persona === 'helpful-senior' || persona === 'rate-limited' ? '' : FLAW_FOOTER}` },
      {
        type: 'text' as const,
        text: `Problem: ${body.problemTitle ?? ''}\nCurrent task given to the candidate:\n${body.task ?? ''}\n\nCandidate's currently open file: ${body.openFile ?? '(none)'}\n\nCodebase:\n${repo}`,
        cache_control: { type: 'ephemeral' as const },
      },
    ];

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: msgs,
    });

    if (response.stop_reason === 'refusal') return json({ reply: "I can't help with that one. Let's stay on the codebase.", flaw: null });

    let text = '';
    for (const block of response.content) if (block.type === 'text') text += block.text;
    let flaw: unknown = null;
    const m = /<flaw>([\s\S]*?)<\/flaw>\s*$/.exec(text);
    if (m) {
      try { flaw = JSON.parse(m[1]); } catch { flaw = { type: 'unknown', detail: m[1] }; }
      text = text.slice(0, m.index).trimEnd();
    }
    return json({ reply: text, flaw, remaining: DAILY_LIMIT - used - 1 });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'The AI provider is busy. Try again in a moment.' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI provider error (${e.status}).` }, 502);
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500);
  }
});
