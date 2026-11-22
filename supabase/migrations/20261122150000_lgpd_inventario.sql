-- Kit LGPD (consultoria): empresas atendidas e inventário das operações de tratamento (ROPA, LGPD art. 37).
alter table public.acessos drop constraint acessos_sistema_check;
alter table public.acessos add constraint acessos_sistema_check check (sistema in ('in_clock', 'processos', 'clientes', 'lgpd'));

create table public.organizacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  nome text not null check (length(trim(nome)) > 0),
  cnpj text,
  setor text,
  endereco text,
  encarregado_nome text,
  encarregado_email text,
  encarregado_tel text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizacoes_user_idx on public.organizacoes(user_id, nome);

create table public.tratamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),       -- processo/atividade (ex.: Folha de pagamento)
  area text,                                               -- área ou departamento
  responsavel text,
  papel text not null default 'controlador' check (papel in ('controlador', 'operador', 'controlador_conjunto')),
  finalidade text,
  base_legal text,                                         -- código: a7_i … a7_x, a11_i, a11_ii_a … a11_ii_g
  base_legal_justificativa text,
  titulares text[] not null default '{}',
  titulares_outros text,
  dados text[] not null default '{}',
  dados_outros text,
  dados_sensiveis text[] not null default '{}',
  criancas boolean not null default false,
  volume text,
  fonte text,
  formato text check (formato is null or formato in ('digital', 'fisico', 'ambos')),
  sistemas text,
  compartilhamento text,
  operadores text,
  transferencia boolean not null default false,
  transferencia_paises text,
  transferencia_mecanismo text,
  retencao text,
  descarte text,
  seguranca text[] not null default '{}',
  seguranca_outros text,
  risco text check (risco is null or risco in ('baixo', 'medio', 'alto')),
  status text not null default 'rascunho' check (status in ('rascunho', 'revisado')),
  revisado_em date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tratamentos_org_idx on public.tratamentos(organizacao_id, nome);

do $$
declare t text;
begin
  foreach t in array array['organizacoes', 'tratamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "dono lê" on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono cria" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono altera" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "dono apaga" on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "precisa de acesso ao sistema" on public.%I as restrictive for all to authenticated using (public.tem_acesso(''lgpd'')) with check (public.tem_acesso(''lgpd''))', t);
  end loop;
end $$;

-- vínculos sempre com registros do mesmo usuário; updated_at automático
create or replace function public.lgpd_confere_dono() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'organizacoes' then
    if new.cliente_id is not null and not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.user_id = new.user_id) then
      raise exception 'cliente inválido';
    end if;
  else
    if not exists (select 1 from public.organizacoes o where o.id = new.organizacao_id and o.user_id = new.user_id) then
      raise exception 'empresa inválida';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.lgpd_confere_dono() from public, anon, authenticated;
create trigger organizacoes_dono before insert or update on public.organizacoes for each row execute function public.lgpd_confere_dono();
create trigger tratamentos_dono before insert or update on public.tratamentos for each row execute function public.lgpd_confere_dono();
