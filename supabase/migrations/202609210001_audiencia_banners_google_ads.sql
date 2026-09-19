-- Censura 18 — audiência: banners mais clicados, compra no checkout,
-- ids de clique dos anúncios e canal Google Ads.
-- Executar após 202609200001_hero_stats.sql (e depois de 202609180004/5/6).
--
-- O que muda (o site já envia tudo isso — assets/js/analytics.js):
--   • novos eventos: banner_click (clique dentro do hero/banner de
--     categoria) e purchase (pedido criado no checkout, Pix ou cartão);
--   • analytics_events ganha banner_id/banner_name (qual arte foi vista ou
--     clicada) e o controle do upload de conversões ao Google Ads;
--   • track_site_events aceita os novos eventos e guarda os ids de clique
--     dos anúncios (gclid/gbraid/wbraid/fbclid) junto da UTM da sessão;
--   • audience_report passa a contar a compra como conversão, o funil
--     ganha a etapa "Fechou o pedido (Pix/cartão)" e o JSON traz "banners"
--     (exibições, cliques, CTR, sessões, conversões e CTA mais clicado);
--   • canal google-ads em sales_channels: as vendas voltam ao anúncio pela
--     Edge Function google-ads-conversions (API) ou pelo CSV de upload.
--
-- Os valores novos do enum são adicionados sem serem usados nesta mesma
-- transação em DDL (só dentro de funções plpgsql, avaliadas em execução),
-- como o Postgres exige.

-- =====================================================================
-- Novos tipos de evento
-- =====================================================================

alter type public.analytics_event_kind add value if not exists 'banner_click';
alter type public.analytics_event_kind add value if not exists 'purchase';

-- =====================================================================
-- Colunas novas
-- =====================================================================

alter table public.analytics_events
  add column if not exists banner_id text
    check (banner_id is null or char_length(banner_id) <= 80),
  add column if not exists banner_name text
    check (banner_name is null or char_length(banner_name) <= 120),
  -- controle da Edge Function google-ads-conversions: cada compra com id
  -- de clique sobe uma única vez para o Google Ads
  add column if not exists ads_uploaded_at timestamptz,
  add column if not exists ads_upload_error text
    check (ads_upload_error is null or char_length(ads_upload_error) <= 300);

comment on column public.analytics_events.banner_id is
  'Id do banner (painel → Banners) visto ou clicado; banner_view/banner_click.';
comment on column public.analytics_events.ads_uploaded_at is
  'Quando a conversão (purchase/whatsapp com gclid) subiu ao Google Ads.';

create index if not exists analytics_events_banner_idx
  on public.analytics_events (banner_id, occurred_at)
  where banner_id is not null;

-- fila do upload ao Google Ads: eventos com id de clique ainda não enviados
create index if not exists analytics_events_ads_pending_idx
  on public.analytics_events (occurred_at)
  where ads_uploaded_at is null
    and (utm ? 'gclid' or utm ? 'gbraid' or utm ? 'wbraid');

-- =====================================================================
-- Escrita: track_site_events (substitui a versão de 202609180004)
-- =====================================================================

create or replace function public.track_site_events(p_events jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_event jsonb;
  v_key text;
  v_session text;
  v_kind text;
  v_channel text;
  v_device text;
  v_path text;
  v_recent integer;
  v_accepted integer := 0;
  v_utm jsonb;
  v_region jsonb;
  v_click text;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'Lista de eventos inválida';
  end if;
  if jsonb_array_length(p_events) > 40 then
    raise exception 'Lote grande demais (máximo de 40 eventos por envio)';
  end if;

  for v_event in select * from jsonb_array_elements(p_events)
  loop
    v_session := left(trim(coalesce(v_event ->> 'session_id', '')), 64);
    -- sessão inválida é descartada em silêncio: o visitante não recebe
    -- erro de rastreamento e o banco não guarda lixo
    if v_session !~ '^[A-Za-z0-9._-]{6,64}$' then
      continue;
    end if;

    v_kind := lower(trim(coalesce(v_event ->> 'kind', '')));
    if v_kind not in (
      'page_view', 'click', 'scroll', 'engagement', 'product_view',
      'category_view', 'add_to_cart', 'search', 'checkout_intent',
      'whatsapp', 'banner_view', 'banner_click', 'purchase'
    ) then
      continue;
    end if;

    v_path := left(trim(coalesce(v_event ->> 'path', '/')), 200);
    if v_path = '' then
      v_path := '/';
    end if;

    v_channel := lower(trim(coalesce(v_event ->> 'channel', 'direct')));
    if v_channel not in ('direct', 'organic', 'social', 'email', 'referral', 'paid', 'campaign') then
      v_channel := 'direct';
    end if;

    v_device := lower(trim(coalesce(v_event ->> 'device', 'desktop')));
    if v_device not in ('desktop', 'mobile', 'tablet', 'other') then
      v_device := 'other';
    end if;

    -- anti-abuso: no máximo 120 eventos por sessão a cada minuto
    select count(*) into v_recent
    from public.analytics_events
    where session_id = v_session and occurred_at > now() - interval '1 minute';
    if v_recent > 120 then
      continue;
    end if;

    -- UTM e região só entram com as chaves conhecidas (nada de payload livre)
    v_utm := '{}'::jsonb;
    foreach v_key in array array['source', 'medium', 'campaign', 'content', 'term']
    loop
      if coalesce(v_event -> 'utm' ? v_key, false) then
        v_utm := v_utm || jsonb_build_object(v_key, left(trim(coalesce(v_event -> 'utm' ->> v_key, '')), 120));
      end if;
    end loop;
    -- ids do clique no anúncio (Google Ads: gclid/gbraid/wbraid · Meta: fbclid):
    -- é o que permite devolver a venda ao anúncio. São ids do clique, não da
    -- pessoa, e só entram no formato que as plataformas emitem.
    foreach v_key in array array['gclid', 'gbraid', 'wbraid', 'fbclid']
    loop
      v_click := trim(coalesce(v_event -> 'utm' ->> v_key, ''));
      if v_click ~ '^[A-Za-z0-9._-]{4,200}$' then
        v_utm := v_utm || jsonb_build_object(v_key, v_click);
      end if;
    end loop;

    v_region := '{}'::jsonb;
    foreach v_key in array array['city', 'state', 'country']
    loop
      if coalesce(v_event -> 'region' ? v_key, false) then
        v_region := v_region || jsonb_build_object(v_key, left(trim(coalesce(v_event -> 'region' ->> v_key, '')), 80));
      end if;
    end loop;

    insert into public.analytics_events (
      kind, session_id, visitor_id, occurred_at, path, title, channel,
      referrer_host, landing_path, utm, device, screen, language, region,
      zone, target, x_ratio, y_ratio, scroll_ratio, value, product_id, category,
      banner_id, banner_name
    ) values (
      v_kind::public.analytics_event_kind,
      v_session,
      nullif(left(trim(coalesce(v_event ->> 'visitor_id', '')), 64), ''),
      -- data do evento limitada a "agora" (evita evento com data futura)
      least(coalesce(nullif(trim(coalesce(v_event ->> 'occurred_at', '')), '')::timestamptz, now()), now()),
      v_path,
      nullif(left(trim(coalesce(v_event ->> 'title', '')), 160), ''),
      v_channel::public.traffic_channel,
      nullif(left(trim(coalesce(v_event ->> 'referrer_host', '')), 160), ''),
      nullif(left(trim(coalesce(v_event ->> 'landing_path', '')), 200), ''),
      v_utm,
      v_device::public.device_type,
      nullif(left(trim(coalesce(v_event ->> 'screen', '')), 20), ''),
      nullif(left(trim(coalesce(v_event ->> 'language', '')), 10), ''),
      v_region,
      nullif(left(trim(coalesce(v_event ->> 'zone', '')), 40), ''),
      nullif(left(trim(coalesce(v_event ->> 'target', '')), 120), ''),
      least(1, greatest(0, coalesce((v_event ->> 'x_ratio')::numeric, 0))),
      least(1, greatest(0, coalesce((v_event ->> 'y_ratio')::numeric, 0))),
      least(1, greatest(0, coalesce((v_event ->> 'scroll_ratio')::numeric, 0))),
      nullif(coalesce((v_event ->> 'value')::numeric, 0), 0),
      nullif(left(trim(coalesce(v_event ->> 'product_id', '')), 80), ''),
      nullif(left(trim(coalesce(v_event ->> 'category', '')), 60), ''),
      -- banner visto/clicado (hero da home ou banner de categoria)
      nullif(left(trim(coalesce(v_event ->> 'banner_id', '')), 80), ''),
      nullif(left(trim(coalesce(v_event ->> 'banner_name', '')), 120), '')
    );

    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object('accepted', v_accepted);
end;
$$;

-- =====================================================================
-- Leitura agregada
-- =====================================================================

-- Nome amigável das páginas (mesma tabela de assets/js/analytics.js) —
-- agora com o checkout e a conta do cliente.
create or replace function public.analytics_page_label(p_path text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_path
    when '/' then 'Home'
    when '/index.html' then 'Home'
    when '/produtos.html' then 'Catálogo'
    when '/produto.html' then 'Página do produto'
    when '/lojas.html' then 'Lojas'
    when '/sobre.html' then 'A marca'
    when '/contato.html' then 'Contato'
    when '/cartao-presente.html' then 'Cartão presente'
    when '/checkout.html' then 'Checkout'
    when '/conta.html' then 'Minha conta'
    when '/privacidade.html' then 'Privacidade'
    when '/404.html' then 'Página 404'
    else coalesce(nullif(regexp_replace(coalesce(p_path, ''), '^/|\.html$', '', 'g'), ''), 'Página')
  end;
$$;

/* Janela de agregação (substitui a versão de 202609180004): conversões
   incluem a compra no checkout, o funil ganha a etapa "Fechou o pedido" e
   o relatório traz "banners" — o painel lê o mesmo JSON do modo demo. */
create or replace function public.audience_report_window(
  p_from timestamptz,
  p_to timestamptz,
  p_path text default null,
  p_cols integer default 12,
  p_rows integer default 18
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_totals jsonb;
  v_counts jsonb;
  v_heat_max integer := 0;
  v_heat jsonb;
begin
  -- ------------------------------------------------------------ totais
  select jsonb_build_object(
    'sessions', count(*),
    'pageviews', coalesce(sum(pageviews), 0),
    'visitors', count(distinct visitor_id),
    'conversions', coalesce(sum(conversions), 0),
    'pagesPerSession', round(coalesce(sum(pageviews), 0)::numeric / nullif(count(*), 0), 2),
    'avgSeconds', round(coalesce(avg(seconds), 0)),
    'bounceRate', round(100.0 * coalesce(sum(case when pageviews <= 1 and seconds < 10 then 1 else 0 end), 0)
                        / nullif(count(*), 0), 1),
    'avgScroll', round(100.0 * coalesce(avg(scroll_max) filter (where scroll_max > 0), 0)),
    'conversionRate', round(100.0 * coalesce(sum(conversions), 0) / nullif(count(*), 0), 1)
  )
  into v_totals
  from (
    select
      session_id,
      max(coalesce(visitor_id, session_id)) as visitor_id,
      count(*) filter (where kind = 'page_view') as pageviews,
      count(*) filter (where kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase')) as conversions,
      coalesce(sum(value) filter (where kind = 'engagement'), 0) as seconds,
      coalesce(max(scroll_ratio) filter (where kind = 'scroll'), 0) as scroll_max
    from public.analytics_events
    where occurred_at >= p_from and occurred_at < p_to
    group by session_id
  ) as sess;

  v_result := jsonb_build_object('totals', coalesce(v_totals, '{}'::jsonb));

  -- ------------------------------------------- contagem por tipo (canais)
  select coalesce(jsonb_object_agg(kind, total), '{}'::jsonb)
  into v_counts
  from (
    select kind::text as kind, count(*) as total
    from public.analytics_events
    where occurred_at >= p_from and occurred_at < p_to
    group by kind
  ) as counts;
  v_result := v_result || jsonb_build_object('counts', coalesce(v_counts, '{}'::jsonb));

  -- -------------------------------------------------------- evolução diária
  v_result := v_result || jsonb_build_object('trend', coalesce((
    select jsonb_agg(row order by row ->> 'date')
    from (
      select jsonb_build_object(
        'date', to_char(day.day, 'YYYY-MM-DD'),
        'sessions', day.sessions,
        'pageviews', day.pageviews,
        'conversions', day.conversions
      ) as row
      from (
        select (occurred_at at time zone 'America/Sao_Paulo')::date as day,
               count(distinct session_id) filter (where kind = 'page_view') as sessions,
               count(*) filter (where kind = 'page_view') as pageviews,
               count(*) filter (where kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase')) as conversions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to
        group by 1
      ) as day
    ) as days
  ), '[]'::jsonb));

  -- -------------------------------------------------- páginas mais visitadas
  /* A conversão é atribuída à página vista na sessão: se o evento de compra
     acontece num caminho sem page_view no período, vale a página de entrada
     (mesma regra de assets/js/analytics.js). */
  v_result := v_result || jsonb_build_object('pages', coalesce((
    select jsonb_agg(row order by (row ->> 'views')::integer desc)
    from (
      select jsonb_build_object(
        'path', pv.path,
        'label', public.analytics_page_label(pv.path),
        'views', pv.views,
        'sessions', pv.sessions,
        'share', round(100.0 * pv.views / nullif(sum(pv.views) over (), 0), 1),
        'conversions', coalesce(cv.conversions, 0)
      ) as row
      from (
        select path, count(*) as views, count(distinct session_id) as sessions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
        group by path
      ) pv
      left join (
        select coalesce(viewed.path, landing.path) as path, count(*) as conversions
        from public.analytics_events e
        left join (
          select distinct path
          from public.analytics_events
          where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
        ) viewed on viewed.path = e.path
        left join (
          select distinct on (session_id) session_id, path
          from public.analytics_events
          where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
          order by session_id, occurred_at
        ) landing on landing.session_id = e.session_id
        where e.occurred_at >= p_from and e.occurred_at < p_to
          and e.kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase')
          and coalesce(viewed.path, landing.path) is not null
        group by 1
      ) cv on cv.path = pv.path
    ) as pages
  ), '[]'::jsonb));

  -- ------------------------------------------------------ origem do tráfego
  /* Conversão atribuída ao canal da SESSÃO (o visitante entra pelo anúncio,
     navega sem o parâmetro e compra depois). */
  v_result := v_result || jsonb_build_object('sources', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'channel', pv.channel,
        'label', public.analytics_channel_label(pv.channel),
        'sessions', pv.sessions,
        'pageviews', pv.pageviews,
        'conversions', coalesce(cv.conversions, 0),
        'share', round(100.0 * pv.sessions / nullif(sum(pv.sessions) over (), 0), 1)
      ) as row
      from (
        select channel::text as channel, count(distinct session_id) as sessions, count(*) as pageviews
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
        group by channel
      ) pv
      left join (
        select coalesce(first_channel.channel, seen.channel) as channel, count(*) as conversions
        from public.analytics_events e
        left join (
          select distinct on (session_id) session_id, channel::text as channel
          from public.analytics_events
          where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
          order by session_id, occurred_at
        ) first_channel on first_channel.session_id = e.session_id
        left join (
          select channel::text as channel
          from public.analytics_events
          where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
          group by channel
        ) seen on seen.channel = e.channel::text
        where e.occurred_at >= p_from and e.occurred_at < p_to
          and e.kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase')
          and coalesce(first_channel.channel, seen.channel) is not null
        group by 1
      ) cv on cv.channel = pv.channel
    ) as sources
  ), '[]'::jsonb));

  -- ------------------------------------------------------ campanhas (UTM)
  v_result := v_result || jsonb_build_object('campaigns', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'source', cm.source,
        'medium', cm.medium,
        'campaign', cm.campaign,
        'sessions', cm.sessions,
        'pageviews', cm.pageviews,
        'conversions', coalesce(cv.conversions, 0)
      ) as row
      from (
        select coalesce(nullif(utm ->> 'source', ''), '—') as source,
               coalesce(nullif(utm ->> 'medium', ''), '—') as medium,
               coalesce(nullif(utm ->> 'campaign', ''), '—') as campaign,
               count(distinct session_id) as sessions,
               count(*) as pageviews
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to
          and kind = 'page_view' and utm <> '{}'::jsonb
        group by 1, 2, 3
        order by 4 desc
        limit 20
      ) cm
      left join (
        select coalesce(nullif(utm ->> 'source', ''), '—') as source,
               coalesce(nullif(utm ->> 'medium', ''), '—') as medium,
               coalesce(nullif(utm ->> 'campaign', ''), '—') as campaign,
               count(*) as conversions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to
          and kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase') and utm <> '{}'::jsonb
        group by 1, 2, 3
      ) cv on cv.source = cm.source and cv.medium = cm.medium and cv.campaign = cm.campaign
    ) as campaigns
  ), '[]'::jsonb));

  -- --------------------------------------------------- sites de referência
  v_result := v_result || jsonb_build_object('referrers', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'host', referrer_host,
        'sessions', count(distinct session_id),
        'pageviews', count(*)
      ) as row
      from public.analytics_events
      where occurred_at >= p_from and occurred_at < p_to
        and kind = 'page_view'
        and referrer_host is not null and referrer_host <> ''
      group by referrer_host
      order by count(distinct session_id) desc
      limit 12
    ) as referrers
  ), '[]'::jsonb));

  -- ---------------------------------------------------------- dispositivos
  v_result := v_result || jsonb_build_object('devices', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'type', dv.device,
        'label', case dv.device
          when 'desktop' then 'Computador'
          when 'mobile' then 'Celular'
          when 'tablet' then 'Tablet'
          else 'Outros' end,
        'sessions', dv.sessions,
        'share', round(100.0 * dv.sessions / nullif(sum(dv.sessions) over (), 0), 1)
      ) as row
      from (
        select device::text as device, count(distinct session_id) as sessions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
        group by device::text
      ) dv
    ) as devices
  ), '[]'::jsonb));

  -- --------------------------------------------------------------- cidades
  -- (só quando o navegador informa a região; nunca por geolocalização de IP)
  v_result := v_result || jsonb_build_object('locations', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'name', place,
        'sessions', count(distinct session_id),
        'share', round(100.0 * count(distinct session_id)
                       / nullif(sum(count(distinct session_id)) over (), 0), 1)
      ) as row
      from (
        select session_id,
               btrim(concat_ws(' · ', nullif(region ->> 'city', ''), nullif(region ->> 'state', '')), ' ·') as place
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
      ) as places
      where place <> ''
      group by place
      order by count(distinct session_id) desc
      limit 12
    ) as locations
  ), '[]'::jsonb));

  -- ------------------------------------- regiões de calor e pontos quentes
  v_result := v_result || jsonb_build_object('zones', coalesce((
    select jsonb_agg(row order by (row ->> 'clicks')::integer desc)
    from (
      select jsonb_build_object(
        'path', path,
        'zone', zone,
        'label', zone,
        'clicks', count(*),
        'share', round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1)
      ) as row
      from public.analytics_events
      where occurred_at >= p_from and occurred_at < p_to
        and kind = 'click' and zone is not null
      group by path, zone
    ) as zones
  ), '[]'::jsonb));

  v_result := v_result || jsonb_build_object('targets', coalesce((
    select jsonb_agg(row order by (row ->> 'clicks')::integer desc)
    from (
      select jsonb_build_object('path', path, 'target', target, 'clicks', count(*)) as row
      from public.analytics_events
      where occurred_at >= p_from and occurred_at < p_to
        and kind = 'click' and target is not null
      group by path, target
      order by count(*) desc
      limit 12
    ) as targets
  ), '[]'::jsonb));

  -- -------------------------------------------------- rolagem por página
  v_result := v_result || jsonb_build_object('scroll', coalesce((
    select jsonb_agg(row order by (row ->> 'sessions')::integer desc)
    from (
      select jsonb_build_object(
        'path', path,
        'label', public.analytics_page_label(path),
        'sessions', count(*),
        'average', round(100 * avg(scroll_ratio)),
        'milestones', jsonb_build_object(
          '25', round(100.0 * count(*) filter (where scroll_ratio >= 0.25) / nullif(count(*), 0)),
          '50', round(100.0 * count(*) filter (where scroll_ratio >= 0.5) / nullif(count(*), 0)),
          '75', round(100.0 * count(*) filter (where scroll_ratio >= 0.75) / nullif(count(*), 0)),
          '100', round(100.0 * count(*) filter (where scroll_ratio >= 1) / nullif(count(*), 0))
        )
      ) as row
      from public.analytics_events
      where occurred_at >= p_from and occurred_at < p_to and kind = 'scroll'
      group by path
    ) as scroll
  ), '[]'::jsonb));

  -- ------------------------------------------------- banners mais clicados
  /* Exibições (banner_view) e cliques (banner_click) por arte — hero da
     home e banner de categoria. "sessions" são as sessões distintas que
     clicaram e "conversions" quantas delas converteram depois (mesma
     regra do aggregate() de assets/js/analytics.js). */
  v_result := v_result || jsonb_build_object('banners', coalesce((
    select jsonb_agg(row order by (row ->> 'clicks')::integer desc, (row ->> 'views')::integer desc)
    from (
      select jsonb_build_object(
        'id', b.banner_id,
        'name', b.banner_name,
        'position', b.position,
        'positionLabel', case b.position
          when 'home-hero' then 'Home — hero principal'
          when 'category-hero' then 'Banner de categoria'
          else b.position end,
        'path', b.path,
        'views', b.views,
        'clicks', b.clicks,
        'sessions', b.click_sessions,
        'ctr', case when b.views > 0 then round(100.0 * b.clicks / b.views, 1) else 0 end,
        'conversions', coalesce(cv.converted, 0),
        'topTarget', coalesce(tt.target, '')
      ) as row
      from (
        select banner_id,
               max(coalesce(banner_name, banner_id)) as banner_name,
               coalesce(max(zone), 'home-hero') as position,
               min(path) as path,
               count(*) filter (where kind = 'banner_view') as views,
               count(*) filter (where kind = 'banner_click') as clicks,
               count(distinct session_id) filter (where kind = 'banner_click') as click_sessions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to
          and kind in ('banner_view', 'banner_click') and banner_id is not null
        group by banner_id
      ) b
      left join lateral (
        select count(distinct c.session_id) as converted
        from public.analytics_events c
        where c.occurred_at >= p_from and c.occurred_at < p_to
          and c.kind = 'banner_click' and c.banner_id = b.banner_id
          and exists (
            select 1 from public.analytics_events k
            where k.session_id = c.session_id
              and k.occurred_at >= p_from and k.occurred_at < p_to
              and k.kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'purchase')
          )
      ) cv on true
      left join lateral (
        select t.target
        from public.analytics_events t
        where t.occurred_at >= p_from and t.occurred_at < p_to
          and t.kind = 'banner_click' and t.banner_id = b.banner_id and t.target is not null
        group by t.target
        order by count(*) desc
        limit 1
      ) tt on true
    ) as banners
  ), '[]'::jsonb));

  -- ------------------------------------------------- funil da jornada
  v_result := v_result || jsonb_build_object('funnel', coalesce((
    select jsonb_agg(row order by step)
    from (
      select steps.step as step, jsonb_build_object(
        'kind', steps.kind,
        'label', steps.label,
        'sessions', counter.sessions,
        'share', round(100.0 * counter.sessions / nullif(total.sessions, 0))
      ) as row
      from (
        values
          (1, 'page_view', 'Visitou o site'),
          (2, 'product_view', 'Viu um produto'),
          (3, 'add_to_cart', 'Adicionou ao carrinho'),
          (4, 'checkout_intent', 'Iniciou a finalização'),
          (5, 'purchase', 'Fechou o pedido (Pix/cartão)'),
          (6, 'whatsapp', 'Falou no WhatsApp')
      ) as steps(step, kind, label)
      cross join lateral (
        select count(distinct e.session_id)::integer as sessions
        from public.analytics_events e
        where e.occurred_at >= p_from and e.occurred_at < p_to and e.kind::text = steps.kind
      ) as counter
      cross join lateral (
        select count(distinct session_id)::integer as sessions
        from public.analytics_events
        where occurred_at >= p_from and occurred_at < p_to and kind = 'page_view'
      ) as total
    ) as funnel
  ), '[]'::jsonb));

  -- --------------------------------------- grade do mapa de calor da página
  select coalesce(max(clicks.clicks), 0) into v_heat_max
  from (
    select count(*) as clicks
    from public.analytics_events
    where occurred_at >= p_from and occurred_at < p_to
      and kind = 'click' and x_ratio is not null and y_ratio is not null
      and (p_path is null or path = p_path)
    group by least(p_cols - 1, floor(x_ratio * p_cols)::int),
             least(p_rows - 1, floor(y_ratio * p_rows)::int)
  ) as clicks;

  select jsonb_build_object(
    'path', coalesce(p_path, '/'),
    'cols', p_cols,
    'rows', p_rows,
    'max', v_heat_max,
    'cells', coalesce(jsonb_agg(jsonb_build_object(
      'key', grid.col || 'x' || grid.row,
      'col', grid.col,
      'row', grid.row,
      'clicks', grid.clicks,
      'intensity', round(coalesce(grid.clicks::numeric / nullif(v_heat_max, 0), 0), 2)
    ) order by grid.row, grid.col), '[]'::jsonb)
  )
  into v_heat
  from (
    select gx.col, gy.row, coalesce(clicks.clicks, 0) as clicks
    from generate_series(0, p_cols - 1) as gx(col)
    cross join generate_series(0, p_rows - 1) as gy(row)
    left join (
      select least(p_cols - 1, floor(x_ratio * p_cols)::int) as col,
             least(p_rows - 1, floor(y_ratio * p_rows)::int) as row,
             count(*)::integer as clicks
      from public.analytics_events
      where occurred_at >= p_from and occurred_at < p_to
        and kind = 'click' and x_ratio is not null and y_ratio is not null
        and (p_path is null or path = p_path)
      group by 1, 2
    ) as clicks on clicks.col = gx.col and clicks.row = gy.row
  ) as grid;

  v_result := v_result || jsonb_build_object('heat', coalesce(v_heat, '{}'::jsonb));

  return v_result;
end;
$$;

-- =====================================================================
-- Canal Google Ads (sales_channels) — espelho de admin/assets/channels.js
-- =====================================================================

insert into public.sales_channels (id, name, kind, enabled, status, environment, config, metadata, feed_format)
values
  ('google-ads', 'Google Ads', 'measurement', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 0))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'csv')
on conflict (id) do nothing;

/* Campos públicos obrigatórios de cada canal (espelho de channels.js).
   Habilitar sem eles é erro: o feed sairia rejeitado no provedor. */
create or replace function public.channel_required_fields(p_channel text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_channel
    when 'google-merchant' then array['merchant_id', 'country']
    when 'meta-ads' then array['pixel_id']
    when 'ga4' then array['measurement_id']
    when 'google-ads' then array['customer_id', 'conversion_name']
    when 'mercadolivre' then array['seller_id', 'site_id']
    when 'shopee' then array['shop_id']
    when 'amazon' then array['seller_id', 'marketplace_id']
    when 'magalu' then array['seller_id']
    when 'americanas' then array['seller_id']
    else array[]::text[]
  end;
$$;

create or replace function public.channel_feed_format(p_channel text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_channel
    when 'google-merchant' then 'xml'
    when 'meta-ads' then 'csv'
    when 'google-ads' then 'csv'
    when 'amazon' then 'tsv'
    else 'json'
  end;
$$;

create or replace function public.channel_kind_of(p_channel text)
returns public.channel_kind
language sql
immutable
set search_path = public
as $$
  select case
    when p_channel in ('mercadolivre', 'shopee', 'amazon', 'magalu', 'americanas')
      then 'marketplace'::public.channel_kind
    when p_channel in ('ga4', 'google-ads') then 'measurement'::public.channel_kind
    else 'feed'::public.channel_kind
  end;
$$;

-- =====================================================================
-- Agendamento: conversões → Google Ads (a cada hora, com x-worker-secret)
-- Mesmo padrão de 202609180006_growth_schedules.sql; sem pg_cron/pg_net/
-- Vault a migration só avisa e o disparo fica para um agendador externo.
-- =====================================================================

do $$
declare
  v_has_cron boolean;
  v_has_net boolean;
  v_has_vault boolean;
  v_url text;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_has_cron;
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

  if not v_has_cron or not v_has_net or not v_has_vault or v_url is null then
    raise notice 'pg_cron/pg_net/Vault indisponíveis: dispare google-ads-conversions {"flush":true} por um agendador externo (docs/DASHBOARD-OPERACOES.md).';
    return;
  end if;

  perform cron.schedule(
    'c18-google-ads-conversions',
    '20 * * * *',
    $job$
      select net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/google-ads-conversions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', coalesce(
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'INTEGRATION_WORKER_SECRET' limit 1),
            ''
          )
        ),
        body := '{"flush": true, "limit": 200}'::jsonb,
        timeout_milliseconds := 60000
      )
    $job$
  );

  raise notice 'Agendamento criado: conversões → Google Ads (a cada hora).';
end;
$$;

-- Conferência depois de rodar:
--   select enum_range(null::public.analytics_event_kind);
--   select public.audience_report(now() - interval '7 days') -> 'banners';
