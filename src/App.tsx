import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout, { useThemeSync } from './components/Layout';
import Dashboard from './pages/Dashboard';
import Problems from './pages/Problems';
import Drills from './pages/Drills';
import Mock from './pages/Mock';
import Leaderboard from './pages/Leaderboard';
import Profile from './pages/Profile';
import Login from './pages/Login';

// The workspace pulls in Monaco; load it on demand.
const Workspace = lazy(() => import('./pages/Workspace'));

function Loading() {
  return <div className="flex h-screen items-center justify-center text-sm text-muted">Loading workspace…</div>;
}

export default function App() {
  useThemeSync();
  return (
    <Routes>
      <Route path="/p/:id" element={<Suspense fallback={<Loading />}><Workspace /></Suspense>} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/drills" element={<Drills />} />
        <Route path="/mock" element={<Mock />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<div className="text-muted">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
