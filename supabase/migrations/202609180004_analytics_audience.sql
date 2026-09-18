-- Censura 18 — audiência do site (medição própria)
-- Executar após 202609170001_operations.sql.
--
-- O site (assets/js/analytics.js) envia eventos SOMENTE depois que o
-- visitante aceita o aviso de privacidade (assets/js/lgpd.js). Nenhum
-- dado pessoal é coletado: não há IP, user-agent, e-mail nem cookie de
-- terceiro. O visitante é um id aleatório de sessão que expira após
-- 30 minutos de inatividade.
--
--   track_site_events(jsonb)  → escrita (anon, validada e limitada)
--   audience_report(...)      → leitura agregada (admin e viewer)
--   purge_analytics_events()  → retenção LGPD (admin)
--
-- O formato devolvido por audience_report é o mesmo que a função
-- aggregate() de assets/js/analytics.js produz no modo demonstração,
-- então o painel (admin/ → Audiência) usa um único código de desenho.

-- =====================================================================
-- Tipos
-- =====================================================================

create type public.analytics_event_kind as enum (
  'page_view', 'click', 'scroll', 'engagement', 'product_view',
  'category_view', 'add_to_cart', 'search', 'checkout_intent',
  'whatsapp', 'banner_view'
);

create type public.traffic_channel as enum (
  'direct', 'organic', 'social', 'email', 'referral', 'paid', 'campaign'
);

create type public.device_type as enum ('desktop', 'mobile', 'tablet', 'other');

-- =====================================================================
-- Tabela de eventos
-- =====================================================================

create table public.analytics_events (
  id bigint generated always as identity primary key,
  kind public.analytics_event_kind not null,
  session_id text not null check (session_id ~ '^[A-Za-z0-9._-]{6,64}$'),
  visitor_id text check (visitor_id is null or visitor_id ~ '^[A-Za-z0-9._-]{6,64}$'),
  occurred_at timestamptz not null default now(),
  path text not null check (char_length(path) between 1 and 200),
  title text check (title is null or char_length(title) <= 160),
  channel public.traffic_channel not null default 'direct',
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 160),
  landing_path text check (landing_path is null or char_length(landing_path) <= 200),
  utm jsonb not null default '{}'::jsonb,
  device public.device_type not null default 'desktop',
  screen text check (screen is null or char_length(screen) <= 20),
  language text check (language is null or char_length(language) <= 10),
  region jsonb not null default '{}'::jsonb,
  zone text check (zone is null or char_length(zone) <= 40),
  target text check (target is null or char_length(target) <= 120),
  x_ratio numeric(5,4) check (x_ratio is null or (x_ratio >= 0 and x_ratio <= 1)),
  y_ratio numeric(5,4) check (y_ratio is null or (y_ratio >= 0 and y_ratio <= 1)),
  scroll_ratio numeric(5,4) check (scroll_ratio is null or (scroll_ratio >= 0 and scroll_ratio <= 1)),
  value numeric(14,2) check (value is null or value >= 0),
  product_id text check (product_id is null or char_length(product_id) <= 80),
  category text check (category is null or char_length(category) <= 60),
  -- controle da Edge Function marketing-events (Meta CAPI + GA4): o evento
  -- do site é encaminhado uma única vez, mesmo se a função repetir
  forwarded_at timestamptz,
  forward_error text check (forward_error is null or char_length(forward_error) <= 300)
);

create index analytics_events_time_idx on public.analytics_events (occurred_at desc);
create index analytics_events_range_idx on public.analytics_events (occurred_at, path);
create index analytics_events_session_idx on public.analytics_events (session_id, occurred_at);
create index analytics_events_kind_idx on public.analytics_events (kind, occurred_at);
create index analytics_events_channel_idx on public.analytics_events (channel, occurred_at);
create index analytics_events_forward_idx on public.analytics_events (occurred_at)
  where forwarded_at is null and kind in ('add_to_cart', 'checkout_intent', 'whatsapp', 'product_view', 'category_view', 'search', 'page_view');

-- =====================================================================
-- RLS: ninguém lê eventos crus pela chave anônima. A escrita passa pela
-- RPC (que valida e limita) e a leitura agregada é da equipe.
-- =====================================================================

alter table public.analytics_events enable row level security;

create policy "team read analytics events"
  on public.analytics_events for select
  to authenticated
  using (public.has_role(array['admin', 'viewer']::public.app_role[]));

-- =====================================================================
-- Escrita: track_site_events
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
      'whatsapp', 'banner_view'
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
      zone, target, x_ratio, y_ratio, scroll_ratio, value, product_id, category
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
      nullif(left(trim(coalesce(v_event ->> 'category', '')), 60), '')
    );

    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object('accepted', v_accepted);
end;
$$;

-- =====================================================================
-- Leitura agregada
-- =====================================================================

-- Nome amigável das páginas (mesma tabela de assets/js/analytics.js).
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
    when '/privacidade.html' then 'Privacidade'
    when '/404.html' then 'Página 404'
    else coalesce(nullif(regexp_replace(coalesce(p_path, ''), '^/|\.html$', '', 'g'), ''), 'Página')
  end;
$$;

create or replace function public.analytics_channel_label(p_channel text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_channel
    when 'direct' then 'Direto'
    when 'organic' then 'Busca orgânica'
    when 'social' then 'Redes sociais'
    when 'email' then 'E-mail / newsletter'
    when 'referral' then 'Sites parceiros'
    when 'paid' then 'Tráfego pago'
    when 'campaign' then 'Campanha (UTM)'
    else coalesce(p_channel, 'Direto')
  end;
$$;

/* Janela de agregação. audience_report chama duas vezes: período atual e
   período imediatamente anterior (comparativo dos cartões). */
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
      count(*) filter (where kind in ('add_to_cart', 'checkout_intent', 'whatsapp')) as conversions,
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
               count(*) filter (where kind in ('add_to_cart', 'checkout_intent', 'whatsapp')) as conversions
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
          and e.kind in ('add_to_cart', 'checkout_intent', 'whatsapp')
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
          and e.kind in ('add_to_cart', 'checkout_intent', 'whatsapp')
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
          and kind in ('add_to_cart', 'checkout_intent', 'whatsapp') and utm <> '{}'::jsonb
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
          (5, 'whatsapp', 'Falou no WhatsApp')
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

create or replace function public.audience_report(
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
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
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_path text := nullif(trim(coalesce(p_path, '')), '');
  v_cols integer := greatest(2, least(40, coalesce(p_cols, 12)));
  v_rows integer := greatest(2, least(60, coalesce(p_rows, 18)));
  v_report jsonb;
begin
  if not public.has_role(array['admin', 'viewer']::public.app_role[]) then
    raise exception 'Sem permissão para ver a audiência do site';
  end if;
  if v_to <= v_from then
    raise exception 'O período final precisa ser depois do inicial';
  end if;

  v_report := public.audience_report_window(v_from, v_to, v_path, v_cols, v_rows);

  return v_report || jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'days', greatest(1, round(extract(epoch from (v_to - v_from)) / 86400)::integer),
    'previous', coalesce(
      public.audience_report_window(v_from - (v_to - v_from), v_from, v_path, v_cols, v_rows) -> 'totals',
      '{}'::jsonb
    )
  );
end;
$$;

-- Retenção (LGPD): apaga eventos antigos. Política sugerida: 13 meses.
create or replace function public.purge_analytics_events(p_before timestamptz default now() - interval '13 months')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_limit timestamptz := coalesce(p_before, now() - interval '13 months');
  v_deleted integer;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para apagar a base de audiência';
  end if;
  if v_limit > now() then
    raise exception 'A data de corte precisa estar no passado';
  end if;

  delete from public.analytics_events where occurred_at < v_limit;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', coalesce(v_deleted, 0), 'before', v_limit);
end;
$$;

-- =====================================================================
-- Permissões
-- =====================================================================

grant select on public.analytics_events to authenticated;
grant execute on function public.track_site_events(jsonb) to anon, authenticated;
grant execute on function
  public.audience_report(timestamptz, timestamptz, text, integer, integer),
  public.audience_report_window(timestamptz, timestamptz, text, integer, integer)
to authenticated;
grant execute on function public.purge_analytics_events(timestamptz) to authenticated;
revoke all on function public.track_site_events(jsonb) from public;
revoke all on function
  public.audience_report(timestamptz, timestamptz, text, integer, integer),
  public.audience_report_window(timestamptz, timestamptz, text, integer, integer),
  public.purge_analytics_events(timestamptz)
from public, anon;
