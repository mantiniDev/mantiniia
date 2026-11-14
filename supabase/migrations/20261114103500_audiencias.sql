-- Audiências por processo (data/hora, tipo, local), com RLS por usuário.
-- Já aplicada no projeto Supabase "mantini-ia".
create table public.audiencias (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data_hora timestamptz not null,
  tipo text,          -- conciliação, instrução, una...
  local text,         -- sala, endereço ou link da videoconferência
  observacao text,
  realizada boolean not null default false,
  created_at timestamptz not null default now()
);
create index audiencias_processo_idx on public.audiencias(processo_id, data_hora);
create index audiencias_user_data_idx on public.audiencias(user_id, data_hora);

alter table public.audiencias enable row level security;
create policy "dono lê audiências"     on public.audiencias for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria audiências"   on public.audiencias for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (select 1 from public.processos p where p.id = processo_id and p.user_id = (select auth.uid())));
create policy "dono altera audiências" on public.audiencias for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga audiências"  on public.audiencias for delete to authenticated using ((select auth.uid()) = user_id);
