-- Busca no DJEN 3 vezes por dia: 8h, 13h e 19h de Brasília (11h, 16h e 22h UTC).
-- A função roda em São Paulo (x-region), porque a API do CNJ só aceita acesso do Brasil.
select cron.schedule('djen-publicacoes', '0 11,16,22 * * *', $$
  select net.http_post(
    url := 'https://wlgehyqvzqniorgtodrg.supabase.co/functions/v1/djen',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'sa-east-1',
      'x-aviso-token', (select decrypted_secret from vault.decrypted_secrets where name = 'aviso_diario_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
