-- Censura 18 — agendamentos de crescimento (pg_cron + pg_net)
-- Executar por último (depois de 202609180004 e 202609180005).
--
-- Três rotinas fecham o ciclo sem ninguém clicar:
--   1. retenção LGPD da audiência  → purge_analytics_events() (SQL puro)
--   2. conversões para Meta CAPI/GA4 → Edge Function marketing-events
--   3. fila de publicação dos canais → Edge Function channel-publish
--
-- Nada aqui guarda segredo em texto: as chamadas resolvem o
-- INTEGRATION_WORKER_SECRET no Vault do Supabase no momento da execução.
-- Se pg_cron/pg_net/Vault não estiverem disponíveis, a migration apenas
-- avisa (NOTICE) e as rotinas podem ser disparadas por um agendador externo
-- com o mesmo corpo — passo a passo em docs/DASHBOARD-OPERACOES.md.

do $$
declare
  v_has_cron boolean;
  v_has_net boolean;
  v_has_vault boolean;
  v_url text;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;
  if not v_has_cron then
    raise notice 'pg_cron não está habilitado: agende purge_analytics_events, marketing-events e channel-publish fora do banco (docs/DASHBOARD-OPERACOES.md).';
    return;
  end if;

  /* ---------------------------------------------------- retenção (LGPD) */
  perform cron.schedule(
    'c18-analytics-purge',
    '30 3 1 * *',
    $job$ select public.purge_analytics_events() $job$
  );

  /* ------------------------------------------- dependências das funções */
  select exists (select 1 from pg_extension where extname = 'pg_net') into v_has_net;
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) into v_has_vault;

  begin
    v_url := nullif(current_setting('app.settings.supabase_url', true), '');
  exception when others then
    v_url := null;
  end;

  if not v_has_net or not v_has_vault or v_url is null then
    raise notice 'pg_net, Vault ou app.settings.supabase_url indisponíveis: o flush de conversões e a fila de canais precisam de um disparo externo (POST com x-worker-secret).';
    return;
  end if;

  /* ------------------------------------- conversões → Meta CAPI e GA4 */
  perform cron.schedule(
    'c18-marketing-events-flush',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/marketing-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', coalesce(
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'INTEGRATION_WORKER_SECRET' limit 1),
            ''
          )
        ),
        body := '{"flush": true, "limit": 500}'::jsonb,
        timeout_milliseconds := 60000
      )
    $job$
  );

  /* --------------------------------------- fila de publicação de canais */
  perform cron.schedule(
    'c18-channel-publish',
    '*/30 * * * *',
    $job$
      select net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/channel-publish',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', coalesce(
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'INTEGRATION_WORKER_SECRET' limit 1),
            ''
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )
    $job$
  );

  /* A fila antiga (Alterdata/Rede/ClearSale) continua no mesmo ritmo. */
  perform cron.schedule(
    'c18-integration-worker',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/integration-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', coalesce(
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'INTEGRATION_WORKER_SECRET' limit 1),
            ''
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      )
    $job$
  );

  raise notice 'Agendamentos criados: retenção de audiência (mensal), conversões Meta/GA4 (15 min), publicação de canais (30 min) e fila de integração (5 min).';
end;
$$;

-- Conferência rápida depois de rodar a migration:
--   select jobid, jobname, schedule, active from cron.job order by jobname;
--   select * from cron.job_run_details order by start_time desc limit 20;
