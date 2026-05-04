-- Supabase RLS — grant SELECT and INSERT on `signatures` and `engine_config` for steffandiago311@gmail.com
-- Execute in Supabase SQL editor. Ensure `alter table ... enable row level security` is applied if required.

drop policy if exists "steffandiago_signatures_select" on public.signatures;
drop policy if exists "steffandiago_signatures_insert" on public.signatures;

create policy "steffandiago_signatures_select"
  on public.signatures
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'steffandiago311@gmail.com');

create policy "steffandiago_signatures_insert"
  on public.signatures
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'steffandiago311@gmail.com');

drop policy if exists "steffandiago_engine_config_select" on public.engine_config;
drop policy if exists "steffandiago_engine_config_insert" on public.engine_config;

create policy "steffandiago_engine_config_select"
  on public.engine_config
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'steffandiago311@gmail.com');

create policy "steffandiago_engine_config_insert"
  on public.engine_config
  for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'steffandiago311@gmail.com');
