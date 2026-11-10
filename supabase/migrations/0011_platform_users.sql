-- Migration 0011: users per platform.
-- Every app (iOS, Android, web) already calls report_client once per launch with its install id and,
-- when signed in, the account. This keeps one row per install per day so Tower can show daily, weekly
-- and monthly active users per platform, how many are signed in, and a 30-day trend.
-- Local and test builds (build 'dev' or empty) are not counted.
-- Apply after 0010_registry_guards.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

create table if not exists public.app_client_days (
    day date not null,
    platform text not null check (platform in ('ios', 'android', 'web')),
    install_id uuid not null,
    user_id uuid references auth.users(id) on delete set null,
    primary key (day, platform, install_id)
);
create index if not exists app_client_days_user_idx on public.app_client_days (user_id) where user_id is not null;
alter table public.app_client_days enable row level security;
revoke all on public.app_client_days from anon, authenticated;
grant select on public.app_client_days to authenticated;
drop policy if exists "Admins read client days" on public.app_client_days;
create policy "Admins read client days" on public.app_client_days for select to authenticated using (public.is_admin());

-- Seed today's and earlier activity from what app_clients already knows (last_seen day per install).
insert into public.app_client_days (day, platform, install_id, user_id)
select (c.last_seen at time zone 'utc')::date, c.platform, c.install_id, c.user_id
  from public.app_clients c where coalesce(c.build, '') not in ('', 'dev')
on conflict do nothing;

create or replace function public.report_client(install_id uuid, platform text, app_version text, build text default null, os_version text default null)
returns void language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
    if report_client.platform not in ('ios', 'android', 'web') then raise exception 'Unknown platform' using errcode = '22023'; end if;
    insert into public.app_clients (install_id, platform, app_version, build, os_version, user_id)
    values (report_client.install_id, report_client.platform, left(report_client.app_version, 32), left(report_client.build, 32),
            left(report_client.os_version, 64), auth.uid())
    on conflict (install_id) do update set platform = excluded.platform, app_version = excluded.app_version,
        build = excluded.build, os_version = excluded.os_version,
        user_id = coalesce(excluded.user_id, public.app_clients.user_id), last_seen = now();
    if coalesce(report_client.build, '') not in ('', 'dev') then
        insert into public.app_client_days (day, platform, install_id, user_id)
        values ((now() at time zone 'utc')::date, report_client.platform, report_client.install_id, auth.uid())
        on conflict (day, platform, install_id) do update
            set user_id = coalesce(excluded.user_id, public.app_client_days.user_id);
    end if;
end $$;
revoke all on function public.report_client(uuid, text, text, text, text) from public;
grant execute on function public.report_client(uuid, text, text, text, text) to anon, authenticated;

-- Per platform: active installs (1/7/30 days), signed-in accounts among them, all-time installs,
-- new installs this week, and a 30-day daily series. Plus distinct accounts across all platforms.
create or replace function public.admin_platform_users()
returns json language plpgsql stable security definer set search_path = ''
as $$
declare today date := (now() at time zone 'utc')::date;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'platforms', (select json_object_agg(p.platform, json_build_object(
            'dau', (select count(distinct d.install_id) from public.app_client_days d where d.platform = p.platform and d.day = today),
            'wau', (select count(distinct d.install_id) from public.app_client_days d where d.platform = p.platform and d.day > today - 7),
            'mau', (select count(distinct d.install_id) from public.app_client_days d where d.platform = p.platform and d.day > today - 30),
            'signed_in_30d', (select count(distinct d.user_id) from public.app_client_days d where d.platform = p.platform and d.day > today - 30),
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') not in ('', 'dev')),
            'new_7d', (select count(*) from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') not in ('', 'dev') and c.first_seen > now() - interval '7 days'),
            'daily', (select json_agg(json_build_object('day', g.day, 'n', coalesce(x.n, 0)) order by g.day)
                        from generate_series(today - 29, today, interval '1 day') g(day)
                        left join (select d.day, count(*) as n from public.app_client_days d
                                   where d.platform = p.platform and d.day > today - 30 group by d.day) x on x.day = g.day::date)))
            from (values ('ios'), ('android'), ('web')) p(platform)),
        'accounts_30d', (select count(distinct d.user_id) from public.app_client_days d where d.day > today - 30),
        'accounts_multi_platform_30d', (select count(*) from (select d.user_id from public.app_client_days d
                                         where d.day > today - 30 and d.user_id is not null
                                         group by d.user_id having count(distinct d.platform) > 1) m));
end $$;
revoke all on function public.admin_platform_users() from public;
grant execute on function public.admin_platform_users() to authenticated;

notify pgrst, 'reload schema';
commit;
