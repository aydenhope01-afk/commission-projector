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
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

> The `with check` clause on the update policy is required for isolation: `using`
> decides which rows a user may target, while `with check` constrains the *new*
> row values. Without it, a user could update their own row and rewrite `user_id`
> to another user's id, overwriting their data.

Enable the **Email** auth provider (magic link is on by default).

### Restrict sign-up to @freighttasker.com

The login form rejects other domains client-side, but that can be bypassed by
calling the Supabase API directly. To enforce it server-side, run this in the
SQL editor — it blocks creation of any account whose email isn't `@freighttasker.com`:

```sql
create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null
     or lower(split_part(new.email, '@', 2)) <> 'freighttasker.com' then
    raise exception 'Only @freighttasker.com email addresses are allowed';
  end if;
  return new;
end;
$$;

create trigger enforce_email_domain_trg
  before insert on auth.users
  for each row execute function public.enforce_email_domain();
```

Notes:
- This blocks *new* account creation. Any non-`@freighttasker.com` users created
  before the trigger was added still exist — delete them in Auth → Users if needed.
- To change the allowed domain later, update both the SQL function above and
  `ALLOWED_DOMAIN` in `src/Login.jsx`.

## Deploy (Vercel)
1. Push to a private GitHub repo.
2. Import the repo in Vercel; add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   as environment variables.
3. Deploy, then add the production URL to Supabase → Auth → URL configuration
   (Site URL + Redirect URLs).

State is stored as a single JSON blob (`{ accounts, settings, proj }`) in one
`projector_state` row, keyed to the logged-in user. Last-write-wins across devices.
The signed-in user's offline mirror (`localStorage` key `cp-state:<uid>`) is cleared
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
