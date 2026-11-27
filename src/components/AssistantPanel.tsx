import { useEffect, useRef, useState } from 'react';
import { Send, Bot, AlertTriangle } from 'lucide-react';
import type { PersonaId, Problem, Stage } from '../content/types';
import { PERSONAS, PERSONA_LIST } from '../content/personas';
import { askAssistant, type ChatMsg } from '../lib/ai';
import { Md } from './ui';

interface Props {
  problem: Problem;
  stage: Stage;
  files: Record<string, string>;
  openFile?: string;
  persona: PersonaId;
  setPersona: (p: PersonaId) => void;
  allowed: PersonaId[] | null; // null = all
  switching: boolean;
  revealFlaws: boolean;
  onPrompt: (text: string) => void;
}

export default function AssistantPanel({ problem, stage, files, openFile, persona, setPersona, allowed, switching, revealFlaws, onPrompt }: Props) {
  const [chats, setChats] = useState<Record<string, ChatMsg[]>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const key = `${stage.id}`;
  const msgs = chats[key] ?? [];
  const p = PERSONAS[persona];
  const sentThisStage = msgs.filter((m) => m.role === 'user').length;
  const budgetLeft = p.messageBudget ? p.messageBudget - sentThisStage : null;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, busy]);

  if (allowed && allowed.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
        <Bot size={28} className="text-faint" />
        <div className="font-semibold text-fg">No AI in this round</div>
        This preset simulates a round without an assistant. Rely on reading, tracing and tests.
      </div>
    );
  }

  const send = async () => {
    const text = input.trim();
    if (!text || busy || (budgetLeft !== null && budgetLeft <= 0)) return;
    onPrompt(text);
    const next: ChatMsg[] = [...msgs, { role: 'user', content: text }];
    setChats((c) => ({ ...c, [key]: next }));
    setInput('');
    setBusy(true);
    const visibleFiles = problem.files.filter((f) => !f.hidden).map((f) => ({ path: f.path, content: files[f.path] ?? f.content }));
    const reply = await askAssistant({ persona, messages: next, files: visibleFiles, openFile, problem, stage }).catch((e) => ({ role: 'assistant' as const, content: `⚠️ ${String(e)}`, offline: true }));
    setChats((c) => ({ ...c, [key]: [...next, reply] }));
    setBusy(false);
  };

  const options = (allowed ?? PERSONA_LIST.map((x) => x.id)).map((id) => PERSONAS[id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{p.emoji}</span>
          <select
            className="input !w-auto !py-1 font-semibold"
            value={persona}
            disabled={!switching}
            onChange={(e) => setPersona(e.target.value as PersonaId)}
            aria-label="AI persona"
          >
            {options.map((o) => <option key={o.id} value={o.id}>{o.name} {'★'.repeat(o.strength)}</option>)}
          </select>
          {budgetLeft !== null && <span className="ml-auto chip">{budgetLeft} msgs left</span>}
        </div>
        <div className="mt-1.5 text-xs text-muted">{p.behaviour} <span className="text-faint">Trains: {p.trains}.</span></div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.length && (
          <div className="rounded-lg border border-dashed border-line-strong p-3 text-xs text-muted">
            Ask about the code: <em>“Where is <code>book</code> called from?”</em>, <em>“What does src/time.ts assume about ranges?”</em>.
            Good candidates read first, state the problem precisely, give file paths, and <b>verify</b> every answer. This assistant may be wrong on purpose.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[88%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm' : 'rounded-xl border border-line bg-bg-2 px-3 py-2'}>
              {m.role === 'user' ? m.content : <Md className="[&_pre]:max-h-72">{m.content}</Md>}
              {m.flaw && revealFlaws && (
                <div className="mt-2 flex gap-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />
                  <span><b>Injected flaw ({m.flaw.type}):</b> {m.flaw.detail}</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted">{p.emoji} thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-2">
        <div className="flex items-end gap-2">
          <textarea
            className="input max-h-40 min-h-[42px] resize-none"
            rows={2}
            placeholder={budgetLeft === 0 ? 'Message budget used up for this stage' : `Ask ${p.name}… (Enter to send)`}
            value={input}
            disabled={budgetLeft === 0}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          />
          <button className="btn-primary !p-2.5" onClick={send} disabled={busy || !input.trim() || budgetLeft === 0} aria-label="Send"><Send size={16} /></button>
        </div>
        {openFile && <div className="mt-1 truncate text-[11px] text-faint">Context: {PERSONAS[persona].singleFileContext ? `only ${openFile}` : `repo · open file ${openFile}`}</div>}
      </div>
    </div>
  );
}
