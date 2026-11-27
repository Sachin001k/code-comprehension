# CodeComprehend Arena

A practice platform for the **code comprehension / AI-assisted repository interview round** (Google, Meta, Atlassian, Canva, Apple, banks and quant firms). Candidates land in an unfamiliar codebase and must orient, trace, predict, debug, extend and verify code, often next to a deliberately imperfect AI assistant.

- **Levels L1 → L5** with chess-style difficulty ratings (600 → 3000) and an Elo rating per user.
- **Six stage types**: predict output, find the bug (click the line + root cause), reasoning MCQ, trace the call path (drag to order), verify AI output, and hands-on code (hidden tests run in the browser).
- **Real execution in the browser**: JS/TS run in a Web Worker; Python runs on Pyodide (WebAssembly).
- **Imperfect-AI personas** (Confident Intern, API Dreamer, Tunnel Vision, Lazy Copier, …) via a Supabase Edge Function calling Claude, plus an offline fallback assistant.
- **Mock interviews** with company presets (strict mode: one attempt, no hints, single clock), **drills** (spot-the-AI-bug, predict flashcards), daily challenge, streaks, skill radar, leaderboard and a rubric scorecard.

## Quick start (guest mode, no backend)

```bash
npm install
npm run dev
```

Progress is stored in the browser. To test every level without unlocking them, set `VITE_UNLOCK_ALL=true` in `.env` or tick **Profile → Unlock all levels**.

## Connect Supabase

1. Create a project at supabase.com.
2. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
3. In the SQL editor, run `supabase/migrations/0001_init.sql`, then:
   ```bash
   npm run gen:seed        # writes supabase/seed_problems.sql from the content bank
   ```
   and run `supabase/seed_problems.sql`. Re-run both steps whenever problems are added or ratings change.
4. Auth → Providers: email is on by default. Enable GitHub/Google if you want OAuth, and add your site URL to Auth → URL configuration.

Ratings are computed server-side by the `submit_problem` RPC from the trusted `problems` table; only the first completion of a problem is rated.

## Live AI assistant (optional)

```bash
supabase functions deploy ai-assistant
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
# optional
supabase secrets set AI_MODEL=claude-opus-5-5 AI_DAILY_LIMIT=80
```

Signed-in users then chat with the selected persona. Degraded personas tag any flaw they inject; the platform strips the tag and reveals it once the stage is finished. Usage is capped per user per day (`ai_usage` table). Without the function, an offline assistant answers symbol/file lookups and Socratic hints.

## Content

Problems live in `src/content/problems/*.ts` (schema: `src/content/types.ts`, examples: `00-examples.ts`).

```bash
npm run validate                 # executes every problem
npm run validate -- l3-a         # only files whose name contains "l3-a"
```

The validator runs predict programs with real toolchains (node, python3, javac/java, clang++) and compares stdout. It also checks that every code stage's hidden tests **fail** on the original code and **pass** with the reference solution. Java and C++ content needs a JDK and clang++ (or g++) on the machine running the validator; the browser never needs them.

## Deploy

`npm run build` produces a static site in `dist/` (Vercel, Netlify, Cloudflare Pages, or Supabase hosting). Configure SPA fallback to `index.html`.

## Notes

- Answers for non-code stages ship in the client bundle. This is fine for a practice platform, but don't reuse this content for graded assessments.
- Company formats are reported publicly and change often; the recruiter’s invitation is the source of truth.
