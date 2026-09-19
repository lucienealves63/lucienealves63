-- =============================================================================
-- Censura 18 — conferência da base (rodar por último)
--
-- Um painel só de SELECTs e NOTICEs: mostra se o bloco "Base — Agora" de
-- docs/CREDENCIAIS.md está de pé. Nada aqui altera dados.
-- Expectativa com tudo pronto:
--   • 3 extensões (pg_cron, pg_net, supabase_vault);
--   • app.settings.supabase_url preenchida e sem "SEU-PROJETO";
--   • 5 agendamentos c18-*;
--   • INTEGRATION_WORKER_SECRET no Vault com 64 caracteres;
--   • pelo menos 1 perfil admin ativo;
--   • 9 canais de venda semeados e a loja ECOMMERCE-C18 como estoque central.
-- =============================================================================

/* ------------------------------------------------------- 1. extensões */
select extname, extversion
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;

/* --------------------------------- 2. URL do projeto vista pelo banco */
select case
         when coalesce(nullif(current_setting('app.settings.supabase_url', true), ''), '') = ''
           then 'VAZIA — rode supabase/setup/00_pre_requisitos.sql'
         when position('SEU-PROJETO' in current_setting('app.settings.supabase_url', true)) > 0
           then 'PLACEHOLDER — troque pela URL real do projeto'
         else current_setting('app.settings.supabase_url', true)
       end as url_do_projeto;

/* ------------------------------------------- 3. agendamentos (pg_cron) */
do $$
declare
  v_linha record;
  v_total integer := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '3. AGENDAMENTOS — pg_cron não habilitado: as rotinas precisam de disparo externo (POST com x-worker-secret).';
    return;
  end if;
  raise notice '3. AGENDAMENTOS';
  for v_linha in
    select jobname, schedule, active from cron.job order by jobname
  loop
    v_total := v_total + 1;
    raise notice '   % | % | ativa: %', v_linha.jobname, v_linha.schedule, v_linha.active;
  end loop;
  if v_total = 0 then
    raise notice '   nenhum agendamento criado — rode 00_pre_requisitos.sql, depois as migrations 202609180006 e 202609210001 outra vez.';
  elsif v_total < 5 then
    raise notice '   só % de 5 agendamentos esperados (c18-analytics-purge, c18-marketing-events-flush, c18-channel-publish, c18-integration-worker, c18-google-ads-conversions).', v_total;
  else
    raise notice '   % agendamentos — como esperado.', v_total;
  end if;
end $$;

-- Últimas execuções (só aparece depois que o relógio roda pela primeira vez):
do $$
declare
  v_ultima record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  select jobid, status, return_message, start_time
    into v_ultima
  from cron.job_run_details
  order by start_time desc
  limit 1;
  if v_ultima.jobid is null then
    raise notice '   nenhuma execução registrada ainda em cron.job_run_details.';
  else
    raise notice '   última execução: job % → % (%)', v_ultima.jobid, v_ultima.status, v_ultima.start_time;
  end if;
end $$;

/* ------------------------------- 4. segredo do agendador no Vault */
do $$
declare
  v_tamanho integer;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'vault' and table_name = 'decrypted_secrets'
  ) then
    raise notice '4. VAULT — indisponível (habilite supabase_vault).';
    return;
  end if;
  select char_length(decrypted_secret) into v_tamanho
  from vault.decrypted_secrets
  where name = 'INTEGRATION_WORKER_SECRET'
  limit 1;
  if v_tamanho is null then
    raise notice '4. VAULT — INTEGRATION_WORKER_SECRET AUSENTE: rode supabase/setup/01_vault_worker_secret.sql.';
  else
    raise notice '4. VAULT — INTEGRATION_WORKER_SECRET presente, % caracteres.', v_tamanho;
  end if;
end $$;

/* ------------------------------------------- 5. perfis e administradores */
select p.role, count(*) filter (where p.active) as ativos, count(*) as total
from public.profiles p
group by p.role
order by p.role;

select u.email, p.full_name, p.role, p.active
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin'
order by u.email;

/* ------------------------------------- 6. canais de venda semeados */
select id, name, kind, enabled, status, feed_format
from public.sales_channels
order by id;

/* --------------------------------------- 7. loja do estoque central */
select code, name, fulfills_stock, active
from public.stores
order by fulfills_stock desc, code;

/* ---------------------------------------------- 8. volume de dados */
select
  (select count(*) from public.products)          as produtos,
  (select count(*) from public.product_variants)  as variantes,
  (select count(*) from public.orders)            as pedidos,
  (select count(*) from public.customers)         as clientes,
  (select count(*) from public.channel_listings)  as publicacoes_de_canal,
  (select count(*) from public.analytics_events)  as eventos_de_audiencia;
