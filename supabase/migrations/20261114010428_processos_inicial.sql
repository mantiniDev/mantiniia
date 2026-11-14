-- Controle pessoal de processos: cada usuário só enxerga os próprios registros (RLS).
-- Já aplicada no projeto Supabase "mantini-ia". Guardada aqui como referência/recriação.

create table public.processos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero text not null,
  tribunal text,
  titulo text,                 -- partes / apelido do processo
  observacoes text,
  status text not null default 'ativo' check (status in ('ativo','suspenso','arquivado')),
  ultima_publicacao date,      -- preenchido pelo último andamento
  documento_atual text,        -- em qual documento/fase o processo está
  ultimo_andamento_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index processos_user_idx on public.processos(user_id);

create table public.andamentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data_publicacao date not null,
  documento text not null,
  observacao text,
  created_at timestamptz not null default now()
);
create index andamentos_processo_idx on public.andamentos(processo_id, data_publicacao desc);
create index andamentos_user_idx on public.andamentos(user_id);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.processos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  storage_path text not null unique,
  tipo text,
  tamanho bigint,
  data_documento date,
  created_at timestamptz not null default now()
);
create index documentos_processo_idx on public.documentos(processo_id, created_at desc);
create index documentos_user_idx on public.documentos(user_id);

-- RLS
alter table public.processos  enable row level security;
alter table public.andamentos enable row level security;
alter table public.documentos enable row level security;

create policy "dono lê processos"      on public.processos for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria processos"    on public.processos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono altera processos"  on public.processos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga processos"   on public.processos for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dono lê andamentos"     on public.andamentos for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria andamentos"   on public.andamentos for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (select 1 from public.processos p where p.id = processo_id and p.user_id = (select auth.uid())));
create policy "dono altera andamentos" on public.andamentos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga andamentos"  on public.andamentos for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dono lê documentos"     on public.documentos for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria documentos"   on public.documentos for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (select 1 from public.processos p where p.id = processo_id and p.user_id = (select auth.uid())));
create policy "dono altera documentos" on public.documentos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga documentos"  on public.documentos for delete to authenticated using ((select auth.uid()) = user_id);

-- Mantém no processo o resumo do andamento mais recente (por data de publicação).
create or replace function public.atualiza_resumo_processo() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare pid uuid := coalesce(new.processo_id, old.processo_id);
begin
  update public.processos p set
    ultima_publicacao = a.data_publicacao,
    documento_atual = a.documento,
    ultimo_andamento_em = a.created_at,
    updated_at = now()
  from (select null::int) x
  left join lateral (
    select data_publicacao, documento, created_at from public.andamentos
    where processo_id = pid order by data_publicacao desc, created_at desc limit 1
  ) a on true
  where p.id = pid;
  return null;
end $$;

create trigger andamentos_resumo after insert or update or delete on public.andamentos
for each row execute function public.atualiza_resumo_processo();

create or replace function public.toca_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger processos_updated before update on public.processos
for each row execute function public.toca_updated_at();

-- Armazenamento privado: arquivos ficam em documentos/<user_id>/<processo_id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 52428800);

create policy "dono lê arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dono envia arquivos" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dono apaga arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = (select auth.uid())::text);
