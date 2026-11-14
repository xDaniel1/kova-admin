-- Applied to production on 2026-11-14 (migration speed_limits_in_box_use_overlap_index).
--
-- speed_limits_in_box timed out for signed-out apps (~5.2 s against anon's 3 s statement
-- timeout). With row-level security on speed_limit_segments, Postgres will not use the gist
-- overlap index, because the box && operator is not leakproof, so every call scanned all
-- 1.86 M rows. The function now runs as its owner and applies the same switched-off region and
-- source rules the 0012/0015 policies apply. 0.22-0.45 s for a city view; same rows returned.
create or replace function public.speed_limits_in_box(p_south double precision, p_west double precision, p_north double precision, p_east double precision, p_max integer default 6000)
returns jsonb language sql stable security definer set search_path to 'public' as $f$
    select coalesce(jsonb_agg(jsonb_build_object('mph', t.mph, 'path', t.path, 'authoritative', t.authoritative)), '[]'::jsonb)
    from (
        select s.mph, s.path, s.authoritative
        from public.speed_limit_segments s
        where box(point(s.west, s.south), point(s.east, s.north)) && box(point(p_west, p_south), point(p_east, p_north))
          and s.region <> all (public.disabled_regions('speed_limits'))
          and s.source <> all (public.disabled_regions('speed_limit_sources'))
        order by s.authoritative desc, s.id
        limit least(greatest(p_max, 1), 8000)
    ) t
$f$;
revoke all on function public.speed_limits_in_box(double precision, double precision, double precision, double precision, integer) from public;
grant execute on function public.speed_limits_in_box(double precision, double precision, double precision, double precision, integer) to anon, authenticated, service_role;
