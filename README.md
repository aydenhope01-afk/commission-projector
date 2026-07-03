# Commission Projector

Hosted, single-user Commission Projector for Freight Tasker sales reps: project
qualifying GP against the commission line, track quarterly actuals year over
year, model multi-year earnings, and compare saved scenarios.

## Stack
- Vite + React (app shell; UI in `src/CommissionProjector.jsx`)
- `src/engine.js` — pure calculation engine (commission tiers, projections,
  actuals rollups), framework-free and unit-tested
- Supabase — magic-link auth + Postgres (synced storage, one JSON row per user)
- Vercel — hosting
- Vitest — test suite for the engine (`src/engine.test.js`)

## Local development
1. Fill in `.env.local` with your Supabase project values:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
2. `npm install`
3. `npm run dev`

## Tests
```
npm test         # run the suite once
npm run test:watch
```
CI (`.github/workflows/ci.yml`) runs lint + tests + build on every push and PR.

## Supabase setup

**The single source of truth is [`supabase/setup.sql`](supabase/setup.sql).**
Run its contents in the Supabase SQL editor (Dashboard → SQL Editor → New
query). It is idempotent — safe to re-run — and applies both security
boundaries the app depends on:

1. **Row-Level Security on `projector_state`** — per-user select / insert /
   update / delete policies (`auth.uid() = user_id`). Because the client ships
   the anon key, these policies are the only thing preventing one signed-in
   user from reading or overwriting another's data. The update policy's
   `with check` clause is required: without it a user could rewrite their row's
   `user_id` to another user's id.
2. **Email-domain allowlist trigger on `auth.users`** — blocks account creation
   for any address outside the allowed domains (`freighttasker.com`). The login
   form's client-side domain check is UX-only and bypassable by calling the
   Supabase API directly; the trigger is the real enforcement. To change the
   allowed domains, edit the `allowed_domains` array in `setup.sql` AND
   `ALLOWED_DOMAIN` in `src/Login.jsx`, then re-run the SQL. The trigger only
   blocks *new* accounts — delete any pre-existing off-domain users in
   Auth → Users.

Also enable the **Email** auth provider (magic link is on by default).

## Deploy (Vercel)
1. Push to a private GitHub repo.
2. Import the repo in Vercel; add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   as environment variables.
3. Deploy, then add the production URL to Supabase → Auth → URL configuration
   (Site URL + Redirect URLs).

## Data model

State is stored as a single JSON blob
(`{ accounts, settings, proj, actuals, scenarios }`) in one `projector_state`
row keyed to the logged-in user:

- `accounts` — the working book: per-account freight lines (type / frequency /
  profit), include toggle, confidence weighting
- `settings` — compensation basis: base, car, threshold multiplier, commission
  rate, accelerator tiers, fiscal-year start, currency, commission target
- `proj` — multi-year assumptions: retention, new business + growth, pay rise,
  NPV discount
- `actuals` — per-year frozen snapshots (comp + forecast) and per-account
  quarterly realised GP
- `scenarios` — named snapshots of `{ accounts, settings, proj }` for
  side-by-side comparison

Sync behaviour: Supabase is the source of truth; a `localStorage` mirror
(`cp-state:<uid>`) keeps the app usable offline. Edits that never reached
Supabase are flagged (`cp-pending:<uid>`) so a later load prefers the mirror
and re-pushes it instead of overwriting it with a stale remote row. Writes are
last-write-wins across devices, but a save that overwrites a row changed
elsewhere since the last sync surfaces a warning toast. The mirror is cleared
on sign-out so figures don't linger on a shared device.

## Security headers

`vercel.json` sets security response headers on every route:

- **Content-Security-Policy** — locks `default-src`/`script-src` to `'self'`, allows
  styles inline + Google Fonts, and restricts `connect-src` to the Supabase host.
  `frame-ancestors 'none'` blocks framing.
- **X-Frame-Options: DENY**, **X-Content-Type-Options: nosniff**,
  **Referrer-Policy: strict-origin-when-cross-origin**, **Strict-Transport-Security**,
  and a restrictive **Permissions-Policy**.

If the Supabase project ref changes, update the `connect-src` host in `vercel.json`.
The CSP can only be verified on Vercel (Vite dev does not apply `vercel.json`); after
deploy, check `curl -sSI https://<prod-url>` and the browser console for blocked resources.
