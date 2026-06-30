-- ============================================================================
-- Commission Projector — Supabase security setup
-- ============================================================================
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent: safe to re-run.
--
-- This file is the source of truth for the app's two security boundaries:
--   1. Row-Level Security on projector_state  — each user can only ever touch
--      their own row. This is the ONLY thing stopping one signed-in user from
--      reading/overwriting another's commission data (the client ships the
--      anon key, so access control lives entirely in the database).
--   2. An email-domain allowlist enforced at user-creation time, so the
--      "@freighttasker.com only" rule is real rather than a client-side hint
--      that can be bypassed by calling the auth API directly.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Per-user state table + Row-Level Security
-- ----------------------------------------------------------------------------
-- One row per user. user_id is the primary key, which also gives the client's
-- upsert({ user_id, data, updated_at }) a conflict target to update on.
create table if not exists public.projector_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.projector_state enable row level security;

-- Drop-and-recreate so re-running this script always lands the latest policy.
drop policy if exists "projector_state_select_own" on public.projector_state;
drop policy if exists "projector_state_insert_own" on public.projector_state;
drop policy if exists "projector_state_update_own" on public.projector_state;
drop policy if exists "projector_state_delete_own" on public.projector_state;

create policy "projector_state_select_own"
  on public.projector_state for select
  to authenticated
  using (auth.uid() = user_id);

create policy "projector_state_insert_own"
  on public.projector_state for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "projector_state_update_own"
  on public.projector_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "projector_state_delete_own"
  on public.projector_state for delete
  to authenticated
  using (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2. Enforce the @freighttasker.com email-domain allowlist server-side
-- ----------------------------------------------------------------------------
-- The client (Login.jsx) checks the domain for fast feedback, but that check is
-- cosmetic — anyone could call supabase.auth.signInWithOtp() directly with any
-- address (signInWithOtp defaults to shouldCreateUser: true). This BEFORE INSERT
-- trigger on auth.users rejects the account creation itself, so a magic link is
-- never issued for an off-domain address.
--
-- To allow more domains later, add them to the allowed_domains array below.
create or replace function public.enforce_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_domains text[] := array['freighttasker.com'];
  email_domain    text;
begin
  email_domain := lower(split_part(coalesce(new.email, ''), '@', 2));
  if not (email_domain = any (allowed_domains)) then
    raise exception 'Sign-ups are restricted to these domains: %', array_to_string(allowed_domains, ', ')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_email_domain on auth.users;
create trigger enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();


-- ----------------------------------------------------------------------------
-- Verification (optional — run after the above to confirm)
-- ----------------------------------------------------------------------------
-- RLS enabled?
--   select relname, relrowsecurity from pg_class where relname = 'projector_state';
-- Policies present?
--   select polname, cmd from pg_policies where tablename = 'projector_state';
-- Trigger present?
--   select tgname from pg_trigger where tgname = 'enforce_email_domain';
