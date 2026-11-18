-- DJEN (Comunicações processuais do CNJ): OABs monitoradas e publicações encontradas.
create table public.oabs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  numero text not null check (numero ~ '^[0-9]{1,8}[A-Z]?$'),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  nome text,
  ativo boolean not null default true,
  ultima_busca timestamptz,
  ultimo_resultado text,
  created_at timestamptz not null default now(),
  unique (user_id, numero, uf)
);
alter table public.oabs enable row level security;
create policy "dono lê oabs"     on public.oabs for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria oabs"   on public.oabs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono altera oabs" on public.oabs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga oabs"  on public.oabs for delete to authenticated using ((select auth.uid()) = user_id);
create policy "precisa de acesso ao sistema" on public.oabs as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));

create table public.publicacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  comunicacao_id bigint not null,
  hash text,
  processo_id uuid references public.processos(id) on delete set null,
  numero_processo text not null,
  numero_mascara text,
  sigla_tribunal text,
  tipo_comunicacao text,
  tipo_documento text,
  nome_orgao text,
  nome_classe text,
  texto text,
  link text,
  partes jsonb,
  data_disponibilizacao date not null,
  oabs text[] not null default '{}',
  lida boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, comunicacao_id)
);
create index publicacoes_user_data_idx on public.publicacoes(user_id, data_disponibilizacao desc);
create index publicacoes_processo_idx on public.publicacoes(processo_id);
create unique index publicacoes_user_hash_idx on public.publicacoes(user_id, hash) where hash is not null;
alter table public.publicacoes enable row level security;
create policy "dono lê publicações"     on public.publicacoes for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono altera publicações" on public.publicacoes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga publicações"  on public.publicacoes for delete to authenticated using ((select auth.uid()) = user_id);
create policy "precisa de acesso ao sistema" on public.publicacoes as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));
-- (inserção só pelo servidor, que busca no DJEN)

alter table public.andamentos add column origem text not null default 'manual' check (origem in ('manual', 'djen'));
alter table public.andamentos add column publicacao_id uuid unique references public.publicacoes(id) on delete set null;
