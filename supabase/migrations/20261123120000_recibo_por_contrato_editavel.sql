-- Recibos: numeração própria de cada contrato (1, 2, 3…) e texto editável guardado na parcela.
alter table public.contratos add column proximo_recibo integer not null default 1;
alter table public.parcelas add column recibo_dados jsonb;
alter table public.emitente add column servico_padrao text;

-- renumera os recibos já emitidos dentro de cada contrato, na ordem dos pagamentos
with r as (
  select id, row_number() over (partition by contrato_id order by coalesce(pago_em, vencimento), created_at) n
  from public.parcelas where recibo_numero is not null
)
update public.parcelas p set recibo_numero = r.n from r where p.id = r.id;
update public.contratos c set proximo_recibo = coalesce((select max(recibo_numero) from public.parcelas p where p.contrato_id = c.id), 0) + 1;

create or replace function public.proximo_recibo_contrato(p_contrato uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  update public.contratos set proximo_recibo = proximo_recibo + 1
    where id = p_contrato and user_id = (select auth.uid())
    returning proximo_recibo - 1 into n;
  if n is null then raise exception 'contrato não encontrado'; end if;
  return n;
end $$;
revoke execute on function public.proximo_recibo_contrato(uuid) from public, anon;
grant execute on function public.proximo_recibo_contrato(uuid) to authenticated;
drop function if exists public.proximo_recibo();
