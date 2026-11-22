-- Anexos dos contratos de honorários (contrato assinado, aditivos…): bucket privado "contratos".
-- Caminho dos arquivos: <user_id>/<contrato_id>/<uuid>-<nome>
insert into storage.buckets (id, name, public, file_size_limit)
values ('contratos', 'contratos', false, 52428800)
on conflict (id) do nothing;

create policy "dono lê contratos"    on storage.objects for select to authenticated
  using (bucket_id = 'contratos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dono envia contratos" on storage.objects for insert to authenticated
  with check (bucket_id = 'contratos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dono apaga contratos" on storage.objects for delete to authenticated
  using (bucket_id = 'contratos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "precisa de acesso aos contratos" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'contratos' or public.tem_acesso('clientes'))
  with check (bucket_id <> 'contratos' or public.tem_acesso('clientes'));

create table public.contratos_anexos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  nome text not null,
  storage_path text not null unique,
  tamanho bigint,
  tipo text,
  created_at timestamptz not null default now()
);
create index contratos_anexos_contrato_idx on public.contratos_anexos(contrato_id);
alter table public.contratos_anexos enable row level security;
create policy "dono lê"     on public.contratos_anexos for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono cria"   on public.contratos_anexos for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono apaga"  on public.contratos_anexos for delete to authenticated using ((select auth.uid()) = user_id);
create policy "precisa de acesso ao sistema" on public.contratos_anexos as restrictive for all to authenticated
  using (public.tem_acesso('clientes')) with check (public.tem_acesso('clientes'));

-- o anexo precisa ser de um contrato do mesmo usuário, e o arquivo, da pasta dele
create or replace function public.anexo_confere_dono() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.contratos c where c.id = new.contrato_id and c.user_id = new.user_id)
     or split_part(new.storage_path, '/', 1) <> new.user_id::text then
    raise exception 'anexo inválido';
  end if;
  return new;
end $$;
revoke execute on function public.anexo_confere_dono() from public, anon, authenticated;
create trigger contratos_anexos_dono before insert or update on public.contratos_anexos for each row execute function public.anexo_confere_dono();
