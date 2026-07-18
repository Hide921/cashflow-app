-- cashflow-app: user_data をSupabase Authのユーザー単位に分離する。
-- 適用前に Authentication > Providers で Email を有効にしてください。
-- 既存の accounts / transactions は、移行後に最初にログインしたユーザーへ
-- claim_legacy_data() で一度だけ安全に引き継がれます。

begin;

alter table public.user_data
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists user_data_user_id_idx
  on public.user_data(user_id);

alter table public.user_data enable row level security;

-- 以前の匿名アクセス用ポリシーを含め、既存ポリシーをすべて除去する。
do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_data'
  loop
    execute format('drop policy if exists %I on public.user_data', policy_row.policyname);
  end loop;
end $$;

revoke all on table public.user_data from anon;
grant select, insert, update, delete on table public.user_data to authenticated;

create policy "users_select_own_data"
  on public.user_data for select to authenticated
  using (auth.uid() = user_id);

create policy "users_insert_own_data"
  on public.user_data for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users_update_own_data"
  on public.user_data for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_delete_own_data"
  on public.user_data for delete to authenticated
  using (auth.uid() = user_id);

create or replace function public.claim_legacy_data()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  claimed boolean := false;
  affected_rows integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  -- 同時に複数ユーザーが引き継げないよう、トランザクションロックを取得する。
  perform pg_advisory_xact_lock(hashtext('cashflow-app-legacy-claim'));

  -- 既に別ユーザーが引き継いだ後は何もしない。
  if exists(select 1 from public.user_data where user_id is not null)
     and not exists(select 1 from public.user_data where user_id = current_user_id) then
    return false;
  end if;

  update public.user_data
     set user_id = current_user_id,
         key = current_user_id::text || ':' || key,
         updated_at = now()
   where user_id is null
     and key in ('accounts','transactions','budgets','skipped','preferences');

  get diagnostics affected_rows = row_count;
  claimed := affected_rows > 0;
  return claimed;
end;
$$;

revoke all on function public.claim_legacy_data() from public, anon;
grant execute on function public.claim_legacy_data() to authenticated;

commit;
