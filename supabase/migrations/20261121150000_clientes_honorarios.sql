-- Sistema "Clientes": clientes, vínculo com processos, contratos de honorários, parcelas e dados do emitente do recibo.
alter table public.acessos drop constraint acessos_sistema_check;
alter table public.acessos add constraint acessos_sistema_check check (sistema in ('in_clock', 'processos', 'clientes'));

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  tipo text not null default 'PF' check (tipo in ('PF', 'PJ')),
  documento text,                 -- CPF ou CNPJ, só números
  email text,
  telefone text,
  endereco text,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clientes_user_idx on public.clientes(user_id, nome);
create unique index clientes_user_doc_idx on public.clientes(user_id, documento) where documento is not null and documento <> '';

create table public.clientes_processos (
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  processo_id uuid not null references public.processos(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cliente_id, processo_id)
);
create index clientes_processos_proc_idx on public.clientes_processos(processo_id);

create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  processo_id uuid references public.processos(id) on delete set null,
  descricao text not null check (length(trim(descricao)) > 0),
  tipo text not null default 'fixo' check (tipo in ('fixo', 'mensal', 'exito', 'misto')),
  valor_total numeric(12,2) check (valor_total is null or valor_total >= 0),
  percentual_exito numeric(5,2) check (percentual_exito is null or (percentual_exito >= 0 and percentual_exito <= 100)),
  data_contrato date not null default current_date,
  status text not null default 'ativo' check (status in ('ativo', 'encerrado')),
  observacoes text,
  created_at timestamptz not null default now()
);
create index contratos_cliente_idx on public.contratos(cliente_id);

create table public.parcelas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  numero integer not null default 1,
  descricao text,
  vencimento date not null,
  valor numeric(12,2) not null check (valor > 0),
  pago_em date,
  valor_pago numeric(12,2) check (valor_pago is null or valor_pago > 0),
  forma text check (forma in ('pix', 'transferencia', 'dinheiro', 'cartao', 'boleto', 'cheque', 'outro')),
  recibo_numero integer,
  observacao text,
  created_at timestamptz not null default now()
);
create index parcelas_user_venc_idx on public.parcelas(user_id, vencimento) where pago_em is null;
create index parcelas_contrato_idx on public.parcelas(contrato_id);

-- quem emite o recibo (um registro por usuário)
create table public.emitente (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  documento text,
  oab text,
  endereco text,
  cidade text,
  chave_pix text,
  proximo_recibo integer not null default 1,
  updated_at timestamptz not null default now()
);

-- RLS: cada um só vê o que é seu, e só com acesso ao sistema "clientes"
do $$
declare t text;
begin
  foreach t in array array['clientes', 'clientes_processos', 'contratos', 'parcelas', 'emitente'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "dono lê" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono cria" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono altera" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono apaga" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "precisa de acesso ao sistema" on public.%I as restrictive for all to authenticated using (public.tem_acesso(''clientes'')) with check (public.tem_acesso(''clientes''))', t);
  end loop;
end $$;

-- os vínculos precisam apontar para registros do mesmo usuário
create or replace function public.clientes_confere_dono() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'clientes_processos' then
    if not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.user_id = new.user_id)
       or not exists (select 1 from public.processos p where p.id = new.processo_id and p.user_id = new.user_id) then
      raise exception 'vínculo inválido';
    end if;
  elsif tg_table_name = 'contratos' then
    if not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.user_id = new.user_id)
       or (new.processo_id is not null and not exists (select 1 from public.processos p where p.id = new.processo_id and p.user_id = new.user_id)) then
      raise exception 'contrato inválido';
    end if;
  elsif tg_table_name = 'parcelas' then
    if not exists (select 1 from public.contratos c where c.id = new.contrato_id and c.user_id = new.user_id) then
      raise exception 'parcela inválida';
    end if;
  elsif tg_table_name = 'clientes' then
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.clientes_confere_dono() from public, anon, authenticated;
create trigger clientes_atualizado before update on public.clientes for each row execute function public.clientes_confere_dono();
create trigger clientes_processos_dono before insert or update on public.clientes_processos for each row execute function public.clientes_confere_dono();
create trigger contratos_dono before insert or update on public.contratos for each row execute function public.clientes_confere_dono();
create trigger parcelas_dono before insert or update on public.parcelas for each row execute function public.clientes_confere_dono();

-- número do recibo: sequência própria de cada usuário
create or replace function public.proximo_recibo() returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.emitente (user_id) values ((select auth.uid())) on conflict (user_id) do nothing;
  update public.emitente set proximo_recibo = proximo_recibo + 1, updated_at = now()
    where user_id = (select auth.uid()) returning proximo_recibo - 1 into n;
  return n;
end $$;
revoke execute on function public.proximo_recibo() from public, anon;
grant execute on function public.proximo_recibo() to authenticated;
