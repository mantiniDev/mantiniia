-- Bloqueio vale na hora: mesmo com um token ainda válido, a conta bloqueada perde acesso aos dados.
create table public.bloqueados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.bloqueados enable row level security;
create policy "usuário vê se está bloqueado" on public.bloqueados for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.tem_acesso(p_sistema text) returns boolean
language sql security invoker set search_path = '' stable as $$
  select exists (select 1 from public.acessos where user_id = (select auth.uid()) and sistema = p_sistema)
     and not exists (select 1 from public.bloqueados where user_id = (select auth.uid()));
$$;
create or replace function public.meus_sistemas() returns text[]
language sql security invoker set search_path = '' stable as $$
  select case when exists (select 1 from public.bloqueados where user_id = (select auth.uid())) then '{}'::text[]
    else coalesce((select array_agg(sistema order by sistema) from public.acessos where user_id = (select auth.uid())), '{}') end;
$$;
