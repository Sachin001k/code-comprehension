import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
import { Code2, Flame, LayoutDashboard, ListChecks, Zap, Swords, Trophy, User, Moon, Sun, LogIn, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useStore, streak } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabaseEnabled } from '../lib/supabase';
import { RatingPill } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/problems', label: 'Problems', icon: ListChecks },
  { to: '/drills', label: 'Drills', icon: Zap },
  { to: '/mock', label: 'Mock interview', icon: Swords },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

export function useThemeSync() {
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('cc-theme', theme); } catch { /* ignore */ }
  }, [theme]);
}

export function ThemeToggle() {
  const theme = useStore((s) => s.settings.theme);
  const set = useStore((s) => s.setSettings);
  return (
    <button className="btn-subtle !px-2" aria-label="Toggle theme" onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-ink"><Code2 size={16} strokeWidth={2.75} /></span>
      <span className="text-[15px]">CodeComprehend<span className="text-accent"> Arena</span></span>
    </Link>
  );
}

export default function Layout() {
  useThemeSync();
  const rating = useStore((s) => s.rating);
  const activity = useStore((s) => s.activity);
  const { session } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const st = streak(activity);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Brand />
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg')}>
                <n.icon size={15} /> {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1 text-xs font-semibold text-warn sm:flex" title="Daily streak"><Flame size={15} /> {st}</span>
            <span className="hidden rounded-lg border border-line bg-panel px-2 py-1 sm:block" title="Your rating"><RatingPill rating={rating} /></span>
            <ThemeToggle />
            {supabaseEnabled && !session ? (
              <button className="btn-primary !py-1.5" onClick={() => nav('/login')}><LogIn size={15} /> Sign in</button>
            ) : (
              <NavLink to="/profile" className="btn-subtle !px-2" aria-label="Profile"><User size={17} /></NavLink>
            )}
            <button className="btn-subtle !px-2 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-line px-4 py-2 md:hidden">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => clsx('flex items-center gap-2 rounded-lg px-2 py-2 text-sm', isActive ? 'bg-panel-2 text-fg' : 'text-muted')}>
                <n.icon size={16} /> {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-faint">
        Practice platform for the code comprehension round. Company formats are reported and change often; your recruiter’s invitation is the source of truth.
      </footer>
    </div>
  );
}
