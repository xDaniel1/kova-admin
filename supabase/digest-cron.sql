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
alter table kova_private.digest_runs drop constraint if exists digest_runs_pkey;
alter table kova_private.digest_runs alter column request_id drop not null;
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'digest_runs_id_pkey') then
        alter table kova_private.digest_runs add constraint digest_runs_id_pkey primary key (id);
    end if;
end $$;
alter table kova_private.digest_runs enable row level security;
revoke all on kova_private.digest_runs from public, anon, authenticated;

create or replace function kova_private.settle_digest_runs()
returns void language plpgsql security definer set search_path = ''
as $$ begin
    update kova_private.digest_runs r
       set status_code = h.status_code, settled_at = now(),
           detail = left(coalesce(h.error_msg, case when h.timed_out then 'timed out' end, h.content::text), 300)
      from net._http_response h
     where h.id = r.request_id and r.settled_at is null;
    -- Requests whose response expired before being settled.
    update kova_private.digest_runs set settled_at = now(), detail = coalesce(detail, 'no response recorded')
     where settled_at is null and request_id is not null and at < now() - interval '5 hours';
    delete from kova_private.digest_runs where at < now() - interval '60 days';
end $$;
revoke all on function kova_private.settle_digest_runs() from public, anon, authenticated;

create or replace function kova_private.run_tower_digest()
returns void language plpgsql security definer set search_path = ''
as $$
declare s text; u text; rid bigint;
begin
    select value into s from kova_private.settings where key = 'digest_secret';
    select coalesce((select value from kova_private.settings where key = 'digest_url'),
                    'https://fbumdslhguoytlhlrkyr.supabase.co/functions/v1/tower-digest') into u;
    if coalesce(trim(s), '') = '' then
        insert into kova_private.digest_runs (status_code, detail, settled_at) values (null, 'not sent: digest_secret is not set in kova_private.settings', now());
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
        select r.at, coalesce(r.status_code, h.status_code) as status_code, coalesce(h.timed_out, false) as timed_out,
               r.settled_at is not null or h.id is not null as settled,
               coalesce(r.detail, left(coalesce(h.error_msg, h.content::text), 300)) as detail
          from kova_private.digest_runs r left join net._http_response h on h.id = r.request_id
         order by r.at desc limit 10) x);
end $$;
revoke all on function public.admin_digest_runs() from public, anon;
grant execute on function public.admin_digest_runs() to authenticated;
