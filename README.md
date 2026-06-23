# Commission Projector

Hosted, single-user Commission Projector. The `CommissionProjector` component is
the finished design and is reused verbatim — the only changes from the original
artifact are the two storage helpers (now backed by Supabase) and an auth gate.

## Stack
- Vite + React (app shell)
- Supabase — magic-link auth + Postgres (synced storage, one JSON row per user)
- Vercel — hosting

## Local development
1. Fill in `.env.local` with your Supabase project values:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```
2. `npm install`
3. `npm run dev`

## Supabase setup
Run this in the Supabase SQL editor:

```sql
create table projector_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table projector_state enable row level security;

create policy "own row - select" on projector_state
  for select using (auth.uid() = user_id);
create policy "own row - upsert" on projector_state
  for insert with check (auth.uid() = user_id);
create policy "own row - update" on projector_state
  for update using (auth.uid() = user_id);
```

Enable the **Email** auth provider (magic link is on by default).

## Deploy (Vercel)
1. Push to a private GitHub repo.
2. Import the repo in Vercel; add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   as environment variables.
3. Deploy, then add the production URL to Supabase → Auth → URL configuration
   (Site URL + Redirect URLs).

State is stored as a single JSON blob (`{ accounts, settings, proj }`) in one
`projector_state` row, keyed to the logged-in user. Last-write-wins across devices.
