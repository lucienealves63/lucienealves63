-- =============================================================================
-- Censura 18 — pré-requisitos do agendador
-- RODAR ANTES das migrations de supabase/migrations/ (na ordem dos arquivos).
--
-- 202609180006_growth_schedules.sql e 202609210001_audiencia_banners_google_ads.sql
-- montam os agendamentos (pg_cron → pg_net → Edge Function) só se encontrarem:
--   • pg_cron, pg_net e o Vault habilitados;
--   • app.settings.supabase_url apontando para o projeto.
-- Sem isso elas apenas emitem um NOTICE e as rotinas ficam sem disparo
-- automático (docs/CREDENCIAIS-BASE.md, passo 4).
-- =============================================================================

/* ---------------------------------------------------------- extensões (1/2) */
do $$
begin
  begin
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    raise notice 'pg_cron habilitado.';
  exception when others then
    begin
      execute 'create extension if not exists pg_cron';
      raise notice 'pg_cron habilitado.';
    exception when others then
      raise notice 'pg_cron indisponível por SQL (%). Habilite em Database → Extensions e rode este arquivo de novo.', SQLERRM;
    end;
  end;
end $$;

do $$
begin
  begin
    execute 'create extension if not exists pg_net with schema extensions';
    raise notice 'pg_net habilitado.';
  exception when others then
    begin
      execute 'create extension if not exists pg_net';
      raise notice 'pg_net habilitado.';
    exception when others then
      raise notice 'pg_net indisponível por SQL (%). Habilite em Database → Extensions e rode este arquivo de novo.', SQLERRM;
    end;
  end;
end $$;

/* ------------------------------------------------------------ Vault (2/2) */
do $$
begin
  begin
    execute 'create extension if not exists supabase_vault with schema vault';
    raise notice 'Vault habilitado.';
  exception when others then
    raise notice 'Vault indisponível por SQL (%). Habilite supabase_vault em Database → Extensions — é dele que o agendador lê INTEGRATION_WORKER_SECRET.', SQLERRM;
  end;
end $$;

/* ------------------------------------------- URL do projeto vista pelo banco */
-- As migrations montam a URL das Edge Functions com
-- current_setting('app.settings.supabase_url'). Troque o valor abaixo pelo
-- endereço real (Project Settings → API → Project URL) antes de executar.
do $$
declare
  v_url text := 'https://SEU-PROJETO.supabase.co';   -- ← TROQUE AQUI
begin
  if position('SEU-PROJETO' in v_url) > 0 then
    raise exception 'Troque a URL do projeto no arquivo (Project Settings → API → Project URL) antes de executar.';
  end if;
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.(co|in|net)$' then
    raise notice 'URL fora do padrão esperado (%). Se for um domínio próprio de API, siga; caso contrário, confira.', v_url;
  end if;
  execute format('alter database %I set app.settings.supabase_url = %L', current_database(), v_url);
  raise notice 'app.settings.supabase_url definida: %', v_url;
  raise notice 'ABRA UMA NOVA QUERY no SQL Editor antes de rodar as migrations: a configuração só vale para conexões novas.';
end $$;

/* ------------------------------------------------------------- conferência */
select extname, extversion
from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault')
order by extname;

-- Volta vazio nesta mesma sessão (a configuração vale para conexões novas):
-- confira de novo depois de abrir outra query, ou use 03_checagem_base.sql.
select coalesce(nullif(current_setting('app.settings.supabase_url', true), ''), '(ainda não vale para esta sessão)')
  as url_do_projeto_nesta_sessao;
