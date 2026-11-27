import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Mail, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabase) return <div className="card mx-auto max-w-md p-6 text-sm text-muted">Sign-in is disabled: Supabase keys are not configured. You can practise in guest mode; progress is saved in this browser.</div>;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const redirect = window.location.origin;
    const r =
      mode === 'magic'
        ? await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } })
        : mode === 'signup'
          ? await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
          : await supabase!.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message });
    if (mode === 'signin') return nav('/');
    setMsg({ ok: true, text: mode === 'magic' ? 'Check your inbox for a sign-in link.' : 'Account created. Check your inbox to confirm your email.' });
  };

  const oauth = (provider: 'github' | 'google') => supabase!.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });

  return (
    <div className="mx-auto max-w-sm">
      <div className="card p-6">
        <h1 className="text-xl font-extrabold">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-muted">Sync your rating and progress across devices and appear on the leaderboard.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => oauth('github')}>GitHub</button>
          <button className="btn-ghost" onClick={() => oauth('google')}>Google</button>
        </div>
        <div className="my-4 flex items-center gap-3 text-xs text-faint"><div className="h-px flex-1 bg-line" />or<div className="h-px flex-1 bg-line" /></div>
        <form className="space-y-3" onSubmit={submit}>
          <input className="input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {mode !== 'magic' && <input className="input" type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />}
          {msg && <div className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'}`}>{msg.text}</div>}
          <button className="btn-primary w-full" disabled={busy}>
            {mode === 'magic' ? <><Mail size={15} /> Email me a link</> : <><KeyRound size={15} /> {mode === 'signup' ? 'Sign up' : 'Sign in'}</>}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs">
          <button className="text-accent hover:underline" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
          <button className="text-muted hover:text-fg" onClick={() => setMode(mode === 'magic' ? 'signin' : 'magic')}>{mode === 'magic' ? 'Use password' : 'Use magic link'}</button>
        </div>
      </div>
    </div>
  );
}
