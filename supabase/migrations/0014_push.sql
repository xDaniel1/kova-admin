-- Migration 0014: push notifications for the Tower app (installed on a phone or desktop).
-- Admins subscribe from Tower (System → Notifications). New feedback and new sign-ups call the
-- tower-push Edge Function through pg_net, which sends Web Push to the subscribed devices.
-- Secrets are NOT in this file: after applying, set them once (see supabase/functions/tower-push/README.md):
--   insert into kova_private.settings (key, value) values ('push_url', …), ('push_secret', …), ('anon_key', …)
--   on conflict (key) do update set value = excluded.value;
-- Additive; a missing setting or a failed call never blocks the insert that triggered it.
-- Apply after 0013_coverage.sql, as the database owner. Rerunnable.
begin;

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
    p256dh text not null check (char_length(p256dh) <= 200),
    auth text not null check (char_length(auth) <= 100),
    user_agent text check (user_agent is null or char_length(user_agent) <= 300),
    topics text[] not null default '{feedback,signups}',
    created_at timestamptz not null default now(),
    last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists "Admins manage their own devices" on public.push_subscriptions;
create policy "Admins manage their own devices" on public.push_subscriptions for all to authenticated
    using (user_id = (select auth.uid()) and (select public.is_admin()))
    with check (user_id = (select auth.uid()) and (select public.is_admin())
                and topics <@ array['feedback', 'signups']::text[]);

create schema if not exists kova_private;
create table if not exists kova_private.settings (key text primary key, value text not null);
revoke all on kova_private.settings from public, anon, authenticated;

create or replace function kova_private.tower_push(event text, title text, body text, url text)
returns void language plpgsql security definer set search_path = ''
as $$
declare u text; s text; k text;
begin
    select value into u from kova_private.settings where key = 'push_url';
    select value into s from kova_private.settings where key = 'push_secret';
    select value into k from kova_private.settings where key = 'anon_key';
    if u is null or s is null or k is null then return; end if;
    perform net.http_post(
        url := u,
        body := jsonb_build_object('event', event, 'title', left(title, 120), 'body', left(body, 240), 'url', url),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || k, 'x-tower-secret', s),
        timeout_milliseconds := 5000);
exception when others then
    return;  -- never block the insert
end $$;
revoke all on function kova_private.tower_push(text, text, text, text) from public, anon, authenticated;

create or replace function kova_private.push_on_feedback()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    perform kova_private.tower_push('feedback',
        'New feedback · ' || coalesce(new.kind, 'other'),
        coalesce(left(new.message, 200), ''),
        '/#/feedback/' || new.id::text);
    return new;
end $$;
drop trigger if exists tower_push on public.feedback;
create trigger tower_push after insert on public.feedback for each row execute function kova_private.push_on_feedback();

create or replace function kova_private.push_on_signup()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    perform kova_private.tower_push('signups', 'New Kova account',
        coalesce(split_part(new.email, '@', 2), 'new user') || ' · ' || coalesce(new.raw_app_meta_data->>'provider', 'email'),
        '/#/users/' || new.id::text);
    return new;
end $$;
drop trigger if exists tower_push on auth.users;
create trigger tower_push after insert on auth.users for each row execute function kova_private.push_on_signup();

commit;
