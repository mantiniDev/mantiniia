-- Cada usuário lê só as próprias linhas (nada de escrita: só o servidor do admin altera).
create policy "usuário vê os próprios acessos" on public.acessos for select to authenticated using ((select auth.uid()) = user_id);
create policy "usuário vê se é admin" on public.admins for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.meus_sistemas() returns text[]
language sql security invoker set search_path = '' stable as $$
  select coalesce(array_agg(sistema order by sistema), '{}') from public.acessos where user_id = (select auth.uid());
$$;
create or replace function public.sou_admin() returns boolean
language sql security invoker set search_path = '' stable as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
grant execute on function public.tem_acesso(text), public.meus_sistemas(), public.sou_admin() to authenticated;
