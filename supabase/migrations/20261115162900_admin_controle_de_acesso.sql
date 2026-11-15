-- Admin do mantini.ia.br: quem é admin, quem acessa cada sistema, e registro de auditoria.
-- Já aplicada no projeto Supabase "mantini-ia". (Funções revistas na migração seguinte.)
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create table public.acessos (
  user_id uuid not null references auth.users(id) on delete cascade,
  sistema text not null check (sistema in ('in_clock', 'processos')),
  created_at timestamptz not null default now(),
  primary key (user_id, sistema)
);
alter table public.acessos enable row level security;

create table public.admin_log (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  admin_email text,
  acao text not null,
  alvo text,
  detalhe jsonb
);
alter table public.admin_log enable row level security;  -- sem políticas: só o servidor lê/escreve
create index admin_log_quando_idx on public.admin_log(quando desc);

-- Encerrar todas as sessões de um usuário (só o servidor do admin chama).
create or replace function public.admin_encerrar_sessoes(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_encerrar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.admin_encerrar_sessoes(uuid) to service_role;

-- Acesso ao sistema Processos exigido também no banco (política restritiva: soma-se às do dono).
-- tem_acesso() é criada/atualizada nas migrações seguintes.
create or replace function public.tem_acesso(p_sistema text) returns boolean
language sql security invoker set search_path = '' stable as $$
  select exists (select 1 from public.acessos where user_id = (select auth.uid()) and sistema = p_sistema);
$$;
create policy "precisa de acesso ao sistema" on public.processos  as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));
create policy "precisa de acesso ao sistema" on public.andamentos as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));
create policy "precisa de acesso ao sistema" on public.documentos as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));
create policy "precisa de acesso ao sistema" on public.audiencias as restrictive for all to authenticated using (public.tem_acesso('processos')) with check (public.tem_acesso('processos'));
create policy "precisa de acesso aos documentos" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documentos' or public.tem_acesso('processos'))
  with check (bucket_id <> 'documentos' or public.tem_acesso('processos'));

-- Situação na criação: o único usuário existente (o dono) vira admin e tem acesso aos dois sistemas.
insert into public.admins (user_id) select id from auth.users;
insert into public.acessos (user_id, sistema) select id, s from auth.users, unnest(array['in_clock', 'processos']) s;
