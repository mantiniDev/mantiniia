-- Lixeira também para documentos: apagar só marca a data; 30 dias para restaurar.
alter table public.documentos add column excluido_em timestamptz;
create index documentos_lixeira_idx on public.documentos(user_id, excluido_em) where excluido_em is not null;
-- "um processo completo por processo" vale só para os que não estão na lixeira
drop index public.documentos_um_completo_por_processo;
create unique index documentos_um_completo_por_processo
  on public.documentos(processo_id) where categoria = 'processo_completo' and excluido_em is null;
