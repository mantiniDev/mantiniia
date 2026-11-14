create extension if not exists pg_cron;
create extension if not exists pg_net;  -- movida para o schema extensions na migração seguinte

-- Código secreto aleatório que o agendador envia para a função de e-mail (fica só no Vault).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'aviso_diario_token', 'Token do agendador para a função aviso-diario');

-- A função de e-mail (com service_role) confere o token chamando esta RPC.
create or replace function public.verifica_token_aviso(token text) returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'aviso_diario_token' and decrypted_secret = token);
$$;
revoke all on function public.verifica_token_aviso(text) from public, anon, authenticated;
grant execute on function public.verifica_token_aviso(text) to service_role;

-- Todo dia às 07:00 de Brasília (10:00 UTC).
select cron.schedule('aviso-diario-processos', '0 10 * * *', $$
  select net.http_post(
    url := 'https://wlgehyqvzqniorgtodrg.supabase.co/functions/v1/aviso-diario',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-aviso-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aviso_diario_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);
