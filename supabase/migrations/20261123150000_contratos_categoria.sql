-- Tipo do contrato (honorários advocatícios por padrão; também prestação de serviços, consultoria, locação…)
alter table public.contratos add column categoria text not null default 'Honorários advocatícios'
  check (length(trim(categoria)) between 1 and 80);
