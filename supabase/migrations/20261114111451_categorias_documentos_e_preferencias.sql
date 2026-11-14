-- Tipos de documento: 'andamento' (acumula) e 'processo_completo' (apenas 1 por processo; novo envio substitui).
alter table public.documentos
  add column categoria text not null default 'andamento'
  check (categoria in ('andamento', 'processo_completo'));
create unique index documentos_um_completo_por_processo
  on public.documentos(processo_id) where categoria = 'processo_completo';

-- Preferências de aviso por usuário (usadas pelo site e pelo e-mail diário).
create table public.preferencias (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email_diario boolean not null default true,
  dias_aviso_audiencia int not null default 7 check (dias_aviso_audiencia between 1 and 90),
  dias_sem_andamento int not null default 7 check (dias_sem_andamento between 1 and 365),
  updated_at timestamptz not null default now()
);
alter table public.preferencias enable row level security;
create policy "dono lê preferências"     on public.preferencias for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria preferências"   on public.preferencias for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono altera preferências" on public.preferencias for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
