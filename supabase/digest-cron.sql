-- Schedules the tower-digest Edge Function every day at 13:00 UTC (8 or 9 AM New York).
-- Requires pg_cron and pg_net, the function deployed with "Verify JWT" off, and its DIGEST_SECRET also
-- stored in kova_private.settings (key 'digest_secret'), so the secret is never written into cron.job:
--   insert into kova_private.settings (key, value) values ('digest_secret', '<DIGEST_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- After switching from the old schedule (secret inline in the command): rotate DIGEST_SECRET and run
--   delete from cron.job_run_details where command like '%x-digest-secret%';
-- Rerunnable.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per scheduled run. The HTTP outcome is copied from pg_net (which keeps responses for about
-- six hours) by a settle job every 10 minutes, so the history survives. A run that could not be sent
-- (missing secret) is recorded with its reason instead of vanishing.
create table if not exists kova_private.digest_runs (request_id bigint primary key, at timestamptz not null default now());
alter table kova_private.digest_runs add column if not exists id bigint generated always as identity;
alter table kova_private.digest_runs add column if not exists status_code integer;
alter table kova_private.digest_runs add column if not exists detail text;
alter table kova_private.digest_runs add column if not exists settled_at timestamptz;
alter table kova_private.digest_runs add column if not exists timed_out boolean;
-- sent | skipped | failed | timed_out | not_sent
alter table kova_private.digest_runs add column if not exists outcome text;
alter table kova_private.digest_runs drop constraint if exists digest_runs_pkey;
alter table kova_private.digest_runs alter column request_id drop not null;
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'digest_runs_id_pkey') then
        alter table kova_private.digest_runs add constraint digest_runs_id_pkey primary key (id);
    end if;
end $$;
alter table kova_private.digest_runs enable row level security;
revoke all on kova_private.digest_runs from public, anon, authenticated;

-- One classifier for a digest response: 'sent' needs a positive integer "sent", 'skipped' a text
-- "skipped" reason; anything else 2xx is 'unknown', non-2xx 'failed'. Bad JSON never raises.
create or replace function kova_private.digest_outcome(status integer, timed_out boolean, content text)
returns text language plpgsql immutable set search_path = ''
as $$
declare j jsonb;
begin
    if timed_out then return 'timed_out'; end if;
    if status is null then return null; end if;
    if status not between 200 and 299 then return 'failed'; end if;
    begin j := content::jsonb; exception when others then return 'unknown'; end;
    if jsonb_typeof(j) <> 'object' then return 'unknown'; end if;
    if jsonb_typeof(j->'sent') = 'number' and (j->>'sent') ~ '^[0-9]+$' and (j->>'sent')::int > 0 and coalesce(jsonb_typeof(j->'skipped'), '') <> 'string' then return 'sent'; end if;
    if jsonb_typeof(j->'skipped') = 'string' then return 'skipped'; end if;
    return 'unknown';
end $$;
revoke all on function kova_private.digest_outcome(integer, boolean, text) from public, anon, authenticated;

create or replace function kova_private.settle_digest_runs()
returns void language plpgsql security definer set search_path = ''
as $$ begin
    -- Copies each response before pg_net expires it (about six hours).
    update kova_private.digest_runs r
       set status_code = h.status_code, timed_out = coalesce(h.timed_out, false), settled_at = now(),
           outcome = kova_private.digest_outcome(h.status_code, coalesce(h.timed_out, false), h.content::text),
           detail = left(case when h.timed_out then 'timed out after 20 s'
                              when h.content::text like '%"skipped"%' then 'skipped: ' || coalesce(substring(h.content::text from '"skipped":"([^"]*)"'), '')
                              when h.content::text like '%"sent"%' then 'sent to ' || coalesce(substring(h.content::text from '"sent":([0-9]+)'), '?')
                              else coalesce(h.error_msg, h.content::text) end, 300)
      from net._http_response h
     where h.id = r.request_id and r.settled_at is null;
    -- Requests whose response expired before being settled (should not happen with a 10-minute settle).
    update kova_private.digest_runs set settled_at = now(), outcome = 'failed', detail = coalesce(detail, 'no response recorded')
     where settled_at is null and request_id is not null and at < now() - interval '5 hours';
    delete from kova_private.digest_runs where at < now() - interval '60 days';
end $$;
revoke all on function kova_private.settle_digest_runs() from public, anon, authenticated;
-- Rows settled before outcomes existed: keep what is known, mark the rest unknown.
update kova_private.digest_runs set outcome = case when status_code between 200 and 299 then 'unknown' when status_code is not null then 'failed' else 'unknown' end
 where settled_at is not null and outcome is null;

create or replace function kova_private.run_tower_digest()
returns void language plpgsql security definer set search_path = ''
as $$
declare s text; u text; rid bigint;
begin
    select value into s from kova_private.settings where key = 'digest_secret';
    select coalesce((select value from kova_private.settings where key = 'digest_url'),
                    'https://fbumdslhguoytlhlrkyr.supabase.co/functions/v1/tower-digest') into u;
    if coalesce(trim(s), '') = '' then
        insert into kova_private.digest_runs (outcome, detail, settled_at) values ('not_sent', 'digest_secret is not set in kova_private.settings', now());
        return;
    end if;
    select net.http_post(url := u, body := '{}'::jsonb, timeout_milliseconds := 20000,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-digest-secret', s)) into rid;
    insert into kova_private.digest_runs (request_id) values (rid);
end $$;
revoke all on function kova_private.run_tower_digest() from public, anon, authenticated;

select cron.unschedule('tower-digest') where exists (select 1 from cron.job where jobname = 'tower-digest');
select cron.schedule('tower-digest', '0 13 * * *', 'select kova_private.run_tower_digest()');
select cron.unschedule('tower-digest-settle') where exists (select 1 from cron.job where jobname = 'tower-digest-settle');
select cron.schedule('tower-digest-settle', '*/10 * * * *', 'select kova_private.settle_digest_runs()');

-- Last runs and their outcomes, for Tower's Admins page (Daily digest → Recent sends).
create or replace function public.admin_digest_runs()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_agg(x order by x.at desc), '[]'::json) from (
        select r.at, case when r.settled_at is not null then r.status_code else h.status_code end as status_code,
               coalesce(r.outcome,
                        case when r.settled_at is not null then 'unknown'
                             when h.id is null then 'sending'
                             else coalesce(kova_private.digest_outcome(h.status_code, coalesce(h.timed_out, false), h.content::text), 'sending') end) as outcome,
               coalesce(r.detail, left(coalesce(h.error_msg, h.content::text), 300)) as detail
          from kova_private.digest_runs r left join net._http_response h on h.id = r.request_id
         order by r.at desc limit 10) x);
end $$;
revoke all on function public.admin_digest_runs() from public, anon;
grant execute on function public.admin_digest_runs() to authenticated;
