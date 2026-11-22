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

-- One parser for a digest response, giving both the outcome and the detail shown in Tower:
-- 'sent' needs a positive number "sent"; 'skipped' a text "skipped" reason; any other 2xx is 'unknown';
-- non-2xx, or a pg_net error with no HTTP status, is 'failed'; a timeout is 'timed_out'. Never raises.
drop function if exists kova_private.digest_outcome(integer, boolean, text);
create or replace function kova_private.digest_result(status integer, timed_out boolean, content text, error_msg text)
returns table (outcome text, detail text) language plpgsql immutable set search_path = ''
as $$
declare j jsonb;
begin
    if coalesce(timed_out, false) then outcome := 'timed_out'; detail := 'timed out after 20 s'; return next; return; end if;
    if status is null then
        outcome := 'failed'; detail := coalesce(left(error_msg, 300), 'no HTTP status');
        return next; return;
    end if;
    if status not between 200 and 299 then outcome := 'failed'; detail := left('HTTP ' || status || ': ' || coalesce(error_msg, content, ''), 300); return next; return; end if;
    begin j := content::jsonb; exception when others then j := null; end;
    if j is not null and jsonb_typeof(j) = 'object' then
        if jsonb_typeof(j->'skipped') = 'string' then outcome := 'skipped'; detail := left('skipped: ' || (j->>'skipped'), 300); return next; return; end if;
        if jsonb_typeof(j->'sent') = 'number' and (j->>'sent')::numeric > 0 then outcome := 'sent'; detail := left('sent to ' || (j->>'sent'), 60); return next; return; end if;
    end if;
    outcome := 'unknown'; detail := left(coalesce(content, ''), 300); return next;
end $$;
revoke all on function kova_private.digest_result(integer, boolean, text, text) from public, anon, authenticated;

create or replace function kova_private.settle_digest_runs()
returns void language plpgsql security definer set search_path = ''
as $$ begin
    -- Copies each response before pg_net expires it (about six hours).
    update kova_private.digest_runs r
       set status_code = h.status_code, timed_out = coalesce(h.timed_out, false), settled_at = now(),
           outcome = d.outcome, detail = d.detail
      from net._http_response h, kova_private.digest_result(h.status_code, h.timed_out, h.content::text, h.error_msg) d
     where h.id = r.request_id and r.settled_at is null;
    -- Requests whose response expired before being settled (should not happen with a 10-minute settle).
    update kova_private.digest_runs set settled_at = now(), outcome = 'failed', detail = coalesce(detail, 'no response recorded')
     where settled_at is null and request_id is not null and at < now() - interval '5 hours';
    delete from kova_private.digest_runs where at < now() - interval '60 days';
end $$;
revoke all on function kova_private.settle_digest_runs() from public, anon, authenticated;
-- Rows settled before outcomes existed, or marked unknown by an earlier backfill that misread the stored
-- detail: the settle job wrote detail as 'sent to N' or 'skipped: reason', so classify from that text.
update kova_private.digest_runs set outcome = case
        when request_id is null then 'not_sent'
        when detail ilike '%timed out%' then 'timed_out'
        when status_code between 200 and 299 and detail ~ '^sent to [1-9][0-9]*$' then 'sent'
        when status_code between 200 and 299 and detail like 'skipped:%' then 'skipped'
        when status_code between 200 and 299 then 'unknown'
        when status_code is not null then 'failed'
        else 'unknown' end
 where settled_at is not null and (outcome is null or (outcome = 'unknown' and status_code between 200 and 299));

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
        select r.at, coalesce(r.status_code, h.status_code) as status_code,
               case when r.settled_at is not null then coalesce(r.outcome, 'unknown')
                    when h.id is null then 'sending'
                    else coalesce(d.outcome, 'failed') end as outcome,
               case when r.settled_at is not null then r.detail else d.detail end as detail
          from kova_private.digest_runs r left join net._http_response h on h.id = r.request_id
          left join lateral kova_private.digest_result(h.status_code, h.timed_out, h.content::text, h.error_msg) d on true
         order by r.at desc limit 10) x);
end $$;
revoke all on function public.admin_digest_runs() from public, anon;
grant execute on function public.admin_digest_runs() to authenticated;
