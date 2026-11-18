-- Lixeira: "excluir" só marca a data; o processo some das listas e pode ser restaurado por 30 dias.
-- Depois disso, a função aviso-diario apaga de vez (inclusive os arquivos no armazenamento).
alter table public.processos add column excluido_em timestamptz;
create index processos_lixeira_idx on public.processos(user_id, excluido_em) where excluido_em is not null;
