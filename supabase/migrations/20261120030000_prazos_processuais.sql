-- Prazos processuais (dentro do sistema Processos) e calendário de feriados por tribunal.
create table public.prazos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  processo_id uuid not null references public.processos(id) on delete cascade,
  publicacao_id uuid references public.publicacoes(id) on delete set null,
  descricao text not null,
  tribunal text,
  base_tipo text not null default 'disponibilizacao' check (base_tipo in ('disponibilizacao', 'publicacao', 'inicio')),
  base_data date not null,
  dias integer not null check (dias between 1 and 730),
  contagem text not null default 'uteis' check (contagem in ('uteis', 'corridos')),
  em_dobro boolean not null default false,
  data_publicacao date,
  inicio date not null,
  vencimento date not null,
  cumprido_em date,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prazos_user_venc_idx on public.prazos(user_id, vencimento) where cumprido_em is null;
create index prazos_processo_idx on public.prazos(processo_id);
create index prazos_publicacao_idx on public.prazos(publicacao_id);
alter table public.prazos enable row level security;
create policy "dono lê prazos"     on public.prazos for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria prazos"   on public.prazos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono altera prazos" on public.prazos for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono apaga prazos"  on public.prazos for delete to authenticated using ((select auth.uid()) = user_id);
create policy "precisa de acesso ao sistema" on public.prazos as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));

-- o processo do prazo precisa ser do mesmo usuário
create or replace function public.prazo_confere_dono() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.processos p where p.id = new.processo_id and p.user_id = new.user_id) then
    raise exception 'processo inválido';
  end if;
  if new.publicacao_id is not null and not exists (select 1 from public.publicacoes x where x.id = new.publicacao_id and x.user_id = new.user_id) then
    raise exception 'publicação inválida';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger prazos_confere_dono before insert or update on public.prazos for each row execute function public.prazo_confere_dono();

-- publicação do DJEN: prazo definido, ou marcada como "sem prazo" (null = aguardando decisão)
alter table public.publicacoes add column prazo_status text check (prazo_status in ('definido', 'sem_prazo'));

-- Feriados e suspensões. user_id nulo = padrão do sistema (vale para todos); tribunal nulo = todos os tribunais.
-- tipo: feriado (sem expediente) | suspensao (há expediente, mas o prazo não corre) | parcial (expediente reduzido:
-- conta como dia útil, mas o prazo não começa nem termina nele — CPC art. 224, § 1º).
create table public.feriados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  tribunal text,
  data date not null,
  ate date,
  anual boolean not null default false,
  tipo text not null default 'feriado' check (tipo in ('feriado', 'suspensao', 'parcial')),
  descricao text not null,
  created_at timestamptz not null default now(),
  check (ate is null or ate >= data)
);
create index feriados_data_idx on public.feriados(data);
alter table public.feriados enable row level security;
create policy "lê padrão e os próprios" on public.feriados for select to authenticated using (user_id is null or (select auth.uid()) = user_id);
create policy "cria os próprios"   on public.feriados for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "altera os próprios" on public.feriados for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "apaga os próprios"  on public.feriados for delete to authenticated using ((select auth.uid()) = user_id);
create policy "precisa de acesso ao sistema" on public.feriados as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));

-- Padrões do sistema (os nacionais, Páscoa, Lei 5.010/66 e recesso são calculados no navegador)
insert into public.feriados (user_id, tribunal, data, anual, tipo, descricao) values
  (null, 'TJRJ', '2026-04-23', true, 'feriado', 'Dia de São Jorge (Lei Estadual RJ 5.198/2008)'),
  (null, 'TRF2', '2026-04-23', true, 'feriado', 'Dia de São Jorge (feriado estadual RJ)'),
  (null, 'TRT1', '2026-04-23', true, 'feriado', 'Dia de São Jorge (feriado estadual RJ)');
