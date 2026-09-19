-- =============================================================================
-- Censura 18 — INTEGRATION_WORKER_SECRET no Vault
--
-- A senha do agendador vive em DOIS lugares, sempre com o mesmo valor:
--   1. Supabase Secrets (Project Settings → Edge Functions → Secrets) — é o que
--      as Edge Functions comparam com o cabeçalho x-worker-secret;
--   2. Vault (este arquivo) — é de onde o pg_cron lê o cabeçalho no momento da
--      execução, sem gravar segredo em texto dentro de cron.job.
--
-- O valor é gerado por scripts/credenciais-base.sh (openssl rand -hex 32) e
-- fica guardado no seu .env.local, fora do Git.
-- =============================================================================

do $$
declare
  -- ← TROQUE AQUI pelo mesmo valor cadastrado em Supabase Secrets
  --   (scripts/credenciais-base.sh comandos → bloco 2)
  v_secret text := 'COLE_AQUI_INTEGRATION_WORKER_SECRET';
  v_id uuid;
begin
  if position('COLE_AQUI' in v_secret) > 0 then
    raise exception 'Cole o valor real de INTEGRATION_WORKER_SECRET no arquivo antes de executar.';
  end if;
  if char_length(v_secret) < 32 then
    raise exception 'Segredo curto demais (% caracteres). Use o gerado pelo script: openssl rand -hex 32 → 64 caracteres.', char_length(v_secret);
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    raise exception 'Vault indisponível: habilite supabase_vault (supabase/setup/00_pre_requisitos.sql) e rode de novo.';
  end if;

  select id into v_id from vault.secrets where name = 'INTEGRATION_WORKER_SECRET' limit 1;
  if v_id is null then
    perform vault.create_secret(
      v_secret,
      'INTEGRATION_WORKER_SECRET',
      'Senha do agendador: pg_cron envia no cabeçalho x-worker-secret das Edge Functions'
    );
    raise notice 'INTEGRATION_WORKER_SECRET criado no Vault.';
  else
    perform vault.update_secret(v_id, v_secret);
    raise notice 'INTEGRATION_WORKER_SECRET atualizado no Vault (rotação).';
  end if;
end $$;

/* ------------------------------------------------------------- conferência */
-- Mostra apenas o tamanho: o valor não precisa aparecer na tela de novo.
select name, description, char_length(decrypted_secret) as tamanho, created_at, updated_at
from vault.decrypted_secrets
where name = 'INTEGRATION_WORKER_SECRET';

-- Agendamentos que dependem deste segredo (vazios se 00_pre_requisitos.sql não
-- tiver sido executado ANTES das migrations):
do $$
declare
  v_jobs text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não está habilitado — nenhum agendamento criado ainda (rode 00_pre_requisitos.sql e as migrations).';
    return;
  end if;
  select coalesce(string_agg(jobname || ' → ' || schedule, ' | ' order by jobname), '(nenhum)')
    into v_jobs
  from cron.job
  where jobname in ('c18-marketing-events-flush', 'c18-channel-publish', 'c18-integration-worker');
  raise notice 'Agendamentos que usam este segredo: %', v_jobs;
end $$;
