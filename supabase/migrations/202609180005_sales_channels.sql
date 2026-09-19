-- Censura 18 — canais de venda (Google Merchant, Meta Ads, GA4 e marketplaces)
-- Executar após 202609170001_operations.sql (usa inventory_catalog_view e
-- integration_outbox) e 202609180004_analytics_audience.sql.
--
-- Divisão de trabalho:
--   * este arquivo calcula preço/estoque por canal NO BANCO — a política
--     nunca depende do navegador — e grava as listagens + a fila de envio;
--   * a Edge Function channel-publish consome a fila e fala com cada
--     provedor usando os segredos do ambiente (nunca expostos ao painel);
--   * admin/assets/channels.js monta a PRÉVIA e o download no painel com
--     as MESMAS regras (tests/channels.test.js compara os dois lados).
--
-- Segredos (token da CAPI, JSON da conta de serviço, chaves de marketplace)
-- NÃO ficam aqui: vivem no cofre da Edge Function (.env.example lista todos).
-- O painel guarda só identificadores públicos (merchant id, pixel id, seller id).

-- =====================================================================
-- Tipos
-- =====================================================================

create type public.channel_kind as enum ('feed', 'marketplace', 'measurement');

create type public.channel_status as enum (
  'pending', 'connected', 'syncing', 'paused', 'error', 'off'
);

create type public.listing_status as enum (
  'draft', 'published', 'out_of_stock', 'paused', 'error'
);

-- =====================================================================
-- Canais
-- =====================================================================

create table public.sales_channels (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  kind public.channel_kind not null,
  enabled boolean not null default false,
  status public.channel_status not null default 'pending',
  environment text not null default 'A configurar' check (char_length(environment) <= 60),
  -- identificadores públicos do canal; a política fica em config.policy
  config jsonb not null default '{}'::jsonb,
  -- contadores para o painel: {"listings": 12, "errors": 0, "queue": 1}
  metadata jsonb not null default '{}'::jsonb,
  feed_format text not null default 'csv' check (feed_format in ('csv', 'tsv', 'xml', 'json')),
  last_error text,
  last_sync_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_channels_kind_idx on public.sales_channels (kind, enabled);

-- =====================================================================
-- Listagens (o que cada canal publicou / vai publicar)
-- =====================================================================

create table public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null references public.sales_channels (id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 120),
  sku text check (sku is null or char_length(sku) <= 80),
  title text not null check (char_length(title) between 1 and 200),
  price numeric(14,2) not null check (price >= 0),
  base_price numeric(14,2) not null default 0 check (base_price >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  stock integer not null default 0 check (stock >= 0),
  available_stock integer not null default 0 check (available_stock >= 0),
  status public.listing_status not null default 'draft',
  external_id text check (external_id is null or char_length(external_id) <= 160),
  link text check (link is null or char_length(link) <= 500),
  image_link text check (image_link is null or char_length(image_link) <= 1024),
  -- dados normalizados que a Edge Function usa para montar o feed do canal
  payload jsonb not null default '{}'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, item_key)
);

create index channel_listings_channel_idx on public.channel_listings (channel_id, status);
create index channel_listings_item_idx on public.channel_listings (item_key);

create trigger sales_channels_touch before update on public.sales_channels
  for each row execute function public.set_updated_at();
create trigger channel_listings_touch before update on public.channel_listings
  for each row execute function public.set_updated_at();

-- Foto do produto para anúncio/marketplace (opcional: sem ela o feed usa a
-- marca d'água da loja, exatamente como a prévia do painel).
alter table public.products
  add column if not exists image_path text check (image_path is null or char_length(image_path) <= 1024);

-- A fila de integração passa a aceitar o serviço dos canais de venda.
alter table public.integration_outbox
  drop constraint if exists integration_outbox_service_check;
alter table public.integration_outbox
  add constraint integration_outbox_service_check
  check (service in ('alterdata', 'rede', 'clearsale', 'channels'));

-- =====================================================================
-- Regras da política (espelho de admin/assets/channels.js)
-- =====================================================================

create or replace function public.channel_slug(p_value text)
returns text
language sql
stable
set search_path = public
as $$
  select left(
    trim(both '-' from regexp_replace(
      lower(coalesce(public.unaccent(coalesce(p_value, '')), coalesce(p_value, ''))),
      '[^a-z0-9]+', '-', 'g')),
    60);
$$;

/* normalizePolicy() do painel: mesmos padrões, mesmos limites. */
create or replace function public.channel_policy(p_policy jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'markup', coalesce((p_policy ->> 'markup')::numeric, 0),
    'rounding', case
      when p_policy ->> 'rounding' in ('psychological', 'cent', 'none')
        then p_policy ->> 'rounding'
      else 'psychological' end,
    'stockBuffer', greatest(0, floor(coalesce((p_policy ->> 'stockBuffer')::numeric, 1)))::int,
    'maxPublished', greatest(0, floor(coalesce((p_policy ->> 'maxPublished')::numeric, 0)))::int,
    'minPrice', greatest(0, coalesce((p_policy ->> 'minPrice')::numeric, 0)),
    'publishOnlyAvailable', coalesce((p_policy ->> 'publishOnlyAvailable')::boolean, true)
  );
$$;

/* roundPrice() do painel: preço psicológico termina em ,90. */
create or replace function public.channel_round_price(p_value numeric, p_rounding text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_value, 0) <= 0 then 0
    when p_rounding in ('cent', 'none') then round(p_value, 2)
    else greatest(0.9, round(round(p_value, 0) - 0.1, 2))
  end;
$$;

create or replace function public.channel_price(p_base numeric, p_policy jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  with rules as (select public.channel_policy(p_policy) as policy)
  select greatest(
    case when (select (policy ->> 'minPrice')::numeric from rules) > 0
      then public.channel_round_price((select (policy ->> 'minPrice')::numeric from rules),
                                      (select policy ->> 'rounding' from rules))
      else 0 end,
    public.channel_round_price(
      coalesce(p_base, 0) * (1 + (select (policy ->> 'markup')::numeric from rules) / 100),
      (select policy ->> 'rounding' from rules)
    )
  );
$$;

create or replace function public.channel_stock(p_stock integer, p_policy jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  with rules as (select public.channel_policy(p_policy) as policy)
  select case
    when (select (policy ->> 'maxPublished')::int from rules) > 0
      then least(
        greatest(0, coalesce(p_stock, 0) - (select (policy ->> 'stockBuffer')::int from rules)),
        (select (policy ->> 'maxPublished')::int from rules))
    else greatest(0, coalesce(p_stock, 0) - (select (policy ->> 'stockBuffer')::int from rules))
  end;
$$;

/* listingStatus() do painel: pausado > sem preço > publicado/sem estoque. */
create or replace function public.channel_listing_status(
  p_price numeric,
  p_stock integer,
  p_paused boolean default false
)
returns public.listing_status
language sql
immutable
set search_path = public
as $$
  select case
    when p_paused then 'paused'::public.listing_status
    when coalesce(p_price, 0) <= 0 then 'draft'::public.listing_status
    when coalesce(p_stock, 0) > 0 then 'published'::public.listing_status
    else 'out_of_stock'::public.listing_status
  end;
$$;

/* validateFeedRow() do painel: mesmas mensagens, mesmas regras por canal. */
create or replace function public.channel_listing_problems(p_payload jsonb, p_channel text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(problem), '[]'::jsonb)
  from (
    select 'Título vazio' as problem
      where nullif(trim(coalesce(p_payload ->> 'title', '')), '') is null
    union all
    select 'Título acima de 150 caracteres'
      where char_length(coalesce(p_payload ->> 'title', '')) > 150
    union all
    select 'Sem link do produto'
      where p_channel in ('google-merchant', 'meta-ads')
        and nullif(trim(coalesce(p_payload ->> 'link', '')), '') is null
    union all
    select 'Sem imagem'
      where nullif(trim(coalesce(p_payload ->> 'image_link', '')), '') is null
    union all
    select 'Imagem precisa de URL pública (https)'
      where coalesce(p_payload ->> 'image_link', '') !~* '^https?://'
    union all
    select 'Preço inválido'
      where coalesce((p_payload ->> 'price')::numeric, 0) <= 0
    union all
    select 'Sem EAN/GTIN (obrigatório neste marketplace)'
      where p_channel in ('amazon', 'magalu', 'americanas')
        and nullif(trim(coalesce(p_payload ->> 'ean', '')), '') is null
    union all
    select 'Estoque inválido'
      where coalesce((p_payload ->> 'stock')::int, 0) < 0
  ) as problems(problem);
$$;

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
    when p_channel = 'ga4' then 'measurement'::public.channel_kind
    else 'feed'::public.channel_kind
  end;
$$;

-- =====================================================================
-- Catálogo publicável (agrupa SKU por loja em item de feed)
-- =====================================================================

create or replace function public.channel_catalog(p_site_url text default 'https://censura18.com.br')
returns table (
  item_key text,
  slug text,
  sku text,
  title text,
  description text,
  brand text,
  category text,
  collection text,
  base_price numeric,
  stock integer,
  colors text[],
  sizes text[],
  link text,
  image_link text,
  barcode text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    cat.item_key,
    public.channel_slug(cat.item_key || ' ' || cat.title) as slug,
    cat.item_key as sku,
    cat.title,
    cat.description,
    cat.brand,
    cat.category,
    cat.collection,
    cat.base_price,
    cat.stock,
    cat.colors,
    cat.sizes,
    rtrim(coalesce(p_site_url, 'https://censura18.com.br'), '/') || '/produto.html?ref=' || cat.item_key as link,
    case
      when nullif(trim(coalesce(cat.image_path, '')), '') is null
        then rtrim(coalesce(p_site_url, 'https://censura18.com.br'), '/') || '/assets/img/logos/logo-quadro.png'
      when cat.image_path ~* '^https?://' then cat.image_path
      else rtrim(coalesce(p_site_url, 'https://censura18.com.br'), '/') || '/' || ltrim(cat.image_path, '/')
    end as image_link,
    cat.barcode
  from (
    select
      v.reference as item_key,
      v.product_name as title,
      concat_ws(' · ', v.product_name, nullif(v.category, ''), nullif(v.collection, '')) as description,
      coalesce(nullif(v.brand, ''), 'CENSURA 18') as brand,
      coalesce(nullif(v.category, ''), '') as category,
      coalesce(nullif(v.collection, ''), '') as collection,
      max(coalesce(v.retail_price, 0)) as base_price,
      sum(greatest(0, coalesce(v.on_hand, 0) - coalesce(v.reserved, 0)))::integer as stock,
      array_agg(distinct v.color) filter (where v.color is not null) as colors,
      array_agg(distinct v.size) filter (where v.size is not null) as sizes,
      max(p.image_path) as image_path,
      max(pv.barcode) as barcode
    from public.inventory_catalog_view v
    join public.product_variants pv on pv.id = v.variant_id
    join public.products p on p.id = v.product_id
    where nullif(trim(coalesce(v.reference, '')), '') is not null
      and nullif(trim(coalesce(v.product_name, '')), '') is not null
    group by v.reference, v.product_name, v.brand, v.category, v.collection
  ) as cat;
$$;

-- =====================================================================
-- Gravação de canal (configuração pública + política)
-- =====================================================================

create or replace function public.save_sales_channel(p_payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id text;
  v_kind text;
  v_existing public.sales_channels%rowtype;
  v_config jsonb;
  v_policy jsonb;
  v_enabled boolean;
  v_missing text[];
  v_field text;
  v_labels text := '';
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para configurar canais de venda';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Dados do canal inválidos';
  end if;

  v_id := lower(trim(coalesce(p_payload ->> 'id', p_payload ->> 'slug', '')));
  if v_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Canal inválido: %', coalesce(nullif(v_id, ''), '(vazio)');
  end if;

  v_config := coalesce(p_payload -> 'config', '{}'::jsonb);
  v_kind := lower(trim(coalesce(p_payload ->> 'kind', '')));
  if v_kind <> '' and v_kind not in ('feed', 'marketplace', 'measurement') then
    raise exception 'Tipo de canal inválido: %', v_kind;
  end if;
  if jsonb_typeof(v_config) <> 'object' then
    raise exception 'A configuração do canal precisa ser um objeto';
  end if;

  select * into v_existing from public.sales_channels where id = v_id for update;

  -- a política enviada pelo painel (ou a já gravada) passa pelo mesmo
  -- saneamento: o feed nunca usa valor fora das regras
  v_policy := public.channel_policy(coalesce(
    p_payload -> 'policy',
    v_existing.config -> 'policy',
    '{}'::jsonb
  ));
  v_config := (v_config || jsonb_build_object('policy', v_policy)) - 'secrets';

  v_enabled := coalesce((p_payload ->> 'enabled')::boolean, v_existing.enabled, false);

  if v_enabled then
    foreach v_field in array public.channel_required_fields(v_id)
    loop
      if nullif(trim(coalesce(v_config ->> v_field, '')), '') is null then
        v_missing := array_append(v_missing, v_field);
        v_labels := v_labels || case when v_labels = '' then '' else ', ' end || replace(v_field, '_', ' ');
      end if;
    end loop;
    if v_missing is not null then
      raise exception 'Preencha % antes de habilitar o canal', v_labels;
    end if;
  end if;

  if not found then
    insert into public.sales_channels (
      id, name, kind, enabled, status, environment, config, metadata,
      feed_format, created_by
    ) values (
      v_id,
      left(coalesce(
        nullif(trim(p_payload ->> 'name'), ''),
        initcap(replace(v_id, '-', ' '))
      ), 80),
      coalesce(nullif(v_kind, '')::public.channel_kind, public.channel_kind_of(v_id)),
      v_enabled,
      case when v_enabled then 'connected'::public.channel_status else 'pending'::public.channel_status end,
      case when v_enabled then 'Produção' else 'A configurar' end,
      v_config,
      jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0),
      public.channel_feed_format(v_id),
      auth.uid()
    );
  else
    update public.sales_channels set
      name = left(coalesce(nullif(trim(p_payload ->> 'name'), ''), v_existing.name), 80),
      enabled = v_enabled,
      status = case
        when v_enabled then 'connected'::public.channel_status
        else 'pending'::public.channel_status end,
      environment = case when v_enabled then 'Produção' else 'A configurar' end,
      config = v_config,
      feed_format = public.channel_feed_format(v_id)
    where id = v_id;
  end if;

  return jsonb_build_object(
    'id', v_id, 'enabled', v_enabled, 'policy', v_policy,
    'status', case when v_enabled then 'connected' else 'pending' end
  );
end;
$$;

-- =====================================================================
-- Publicação do catálogo em um canal
-- =====================================================================

create or replace function public.publish_catalog_to_channel(
  p_channel_id text,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id text := lower(trim(coalesce(p_channel_id, '')));
  v_channel public.sales_channels%rowtype;
  v_policy jsonb;
  v_site text := rtrim(coalesce(nullif(trim(p_options ->> 'site_url'), ''), 'https://censura18.com.br'), '/');
  v_limit integer := greatest(1, least(50000, coalesce((p_options ->> 'limit')::integer, 5000)));
  v_dry boolean := coalesce((p_options ->> 'dry_run')::boolean, false);
  v_item record;
  v_payload jsonb;
  v_problems jsonb;
  v_price numeric;
  v_stock integer;
  v_paused boolean;
  v_status public.listing_status;
  v_items integer := 0;
  v_publishable integer := 0;
  v_priced integer := 0;
  v_issues integer := 0;
  v_price_sum numeric := 0;
  v_revenue numeric := 0;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para publicar em canais de venda';
  end if;

  select * into v_channel from public.sales_channels where id = v_id for update;
  if not found then
    raise exception 'Canal % não cadastrado — salve a configuração no painel primeiro', v_id;
  end if;
  if v_channel.kind = 'measurement' then
    raise exception '% é um canal de medição: recebe eventos, não catálogo', v_channel.name;
  end if;
  if not v_channel.enabled then
    raise exception 'O canal % está desabilitado — habilite no painel para publicar', v_channel.name;
  end if;

  v_policy := public.channel_policy(coalesce(p_options -> 'policy', v_channel.config -> 'policy', '{}'::jsonb));

  for v_item in
    select * from public.channel_catalog(v_site) order by item_key limit v_limit
  loop
    v_price := public.channel_price(v_item.base_price, v_policy);
    v_stock := public.channel_stock(v_item.stock, v_policy);
    -- publishOnlyAvailable desligado publica até item sem saldo
    v_paused := (v_policy ->> 'publishOnlyAvailable')::boolean and v_stock <= 0;
    v_status := public.channel_listing_status(v_price, v_stock, v_paused);

    v_payload := jsonb_build_object(
      'id', v_item.slug,
      -- mesmos limites do buildFeedRow (150/500) para o servidor e o painel
      -- apontarem as mesmas pendências
      'title', left(v_item.title, 150),
      'description', left(coalesce(nullif(v_item.description, ''), v_item.title), 500),
      'link', v_item.link,
      'image_link', v_item.image_link,
      'price', v_price,
      'base_price', v_item.base_price,
      'currency', 'BRL',
      'stock', v_stock,
      'available_stock', v_item.stock,
      'availability', case when v_stock > 0 then 'in stock' else 'out of stock' end,
      'brand', v_item.brand,
      'category', v_item.category,
      'collection', v_item.collection,
      'colors', to_jsonb(coalesce(v_item.colors, array[]::text[])),
      'sizes', to_jsonb(coalesce(v_item.sizes, array[]::text[])),
      'ean', v_item.barcode,
      'reference', v_item.item_key,
      'sku', v_item.sku,
      'condition', 'new'
    );
    v_problems := public.channel_listing_problems(v_payload, v_id);

    if not v_dry then
      insert into public.channel_listings as cl (
        channel_id, item_key, sku, title, price, base_price, currency, stock,
        available_stock, status, link, image_link, payload, problems, published_at
      ) values (
        v_channel.id, v_item.item_key, v_item.sku, left(v_item.title, 200),
        v_price, v_item.base_price, 'BRL', v_stock, v_item.stock,
        v_status, v_item.link, v_item.image_link, v_payload, v_problems,
        case when v_status = 'published' then now() else null end
      )
      on conflict (channel_id, item_key) do update set
        sku = excluded.sku,
        title = excluded.title,
        price = excluded.price,
        base_price = excluded.base_price,
        stock = excluded.stock,
        available_stock = excluded.available_stock,
        status = excluded.status,
        link = excluded.link,
        image_link = excluded.image_link,
        payload = excluded.payload,
        problems = excluded.problems,
        published_at = excluded.published_at,
        updated_at = now();
    end if;

    v_items := v_items + 1;
    -- mesmo critério do painel: publishOnlyAvailable desligado publica tudo
    if not v_paused then
      v_publishable := v_publishable + 1;
      if v_price > 0 then
        v_priced := v_priced + 1;
        v_price_sum := v_price_sum + v_price;
        v_revenue := v_revenue + (v_price * v_stock);
      end if;
    end if;
    if jsonb_array_length(v_problems) > 0 then
      v_issues := v_issues + 1;
    end if;
  end loop;

  if not v_dry then
    update public.sales_channels set
      status = 'syncing'::public.channel_status,
      last_sync_at = now(),
      published_at = now(),
      last_error = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'listings', v_publishable,
        'errors', v_issues,
        'queue', 1,
        'lastPublish', jsonb_build_object(
          'at', now(), 'items', v_items, 'published', v_publishable, 'issues', v_issues
        )
      )
    where id = v_channel.id;

    -- a fila de integração já existe: a Edge Function channel-publish
    -- consome e envia ao provedor com os segredos do ambiente
    insert into public.integration_outbox (
      service, operation, aggregate_type, aggregate_id, idempotency_key, payload, status
    ) values (
      'channels',
      'publish_catalog',
      'sales_channel',
      v_channel.id,
      'channels:publish:' || v_channel.id || ':' || to_char(now(), 'YYYYMMDDHH24'),
      jsonb_build_object(
        'channelId', v_channel.id,
        'format', v_channel.feed_format,
        'siteUrl', v_site,
        'items', v_publishable,
        'policy', v_policy
      ),
      'pending'::public.integration_status
    )
    on conflict (idempotency_key) do update set
      payload = excluded.payload,
      status = 'pending'::public.integration_status,
      attempts = 0,
      next_attempt_at = now(),
      last_error = null;
  end if;

  return jsonb_build_object(
    'channelId', v_channel.id,
    'channel', v_channel.name,
    'format', v_channel.feed_format,
    'mode', case when v_dry then 'simulado' else 'publicado' end,
    'items', v_items,
    'published', v_publishable,
    'issues', v_issues,
    'averagePrice', round(v_price_sum / nullif(v_priced, 0), 2),
    'revenue', round(v_revenue, 2),
    'policy', v_policy,
    'enqueued', (not v_dry) and v_publishable > 0
  );
end;
$$;

-- Resumo usado pelo painel (contadores por canal).
create or replace function public.channel_summary()
returns table (
  id text,
  name text,
  kind public.channel_kind,
  enabled boolean,
  status public.channel_status,
  environment text,
  config jsonb,
  metadata jsonb,
  feed_format text,
  listings integer,
  published integer,
  issues integer,
  last_error text,
  last_sync_at timestamptz,
  published_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.name, c.kind, c.enabled, c.status, c.environment, c.config,
         coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object(
           'listings', (select count(*)::integer from public.channel_listings l where l.channel_id = c.id),
           'published', (select count(*)::integer from public.channel_listings l
                          where l.channel_id = c.id and l.status = 'published'),
           'errors', (select count(*)::integer from public.channel_listings l
                       where l.channel_id = c.id and jsonb_array_length(l.problems) > 0)
         ) as metadata,
         c.feed_format,
         (select count(*)::integer from public.channel_listings l where l.channel_id = c.id) as listings,
         (select count(*)::integer from public.channel_listings l
           where l.channel_id = c.id and l.status = 'published') as published,
         (select count(*)::integer from public.channel_listings l
           where l.channel_id = c.id and jsonb_array_length(l.problems) > 0) as issues,
         c.last_error, c.last_sync_at, c.published_at
  from public.sales_channels c
  order by c.kind, c.name;
$$;

-- =====================================================================
-- Canais prontos (idênticos a admin/assets/channels.js: id, nome, tipo,
-- formato do feed e markup padrão que cobre a comissão de cada canal).
-- Nascem desabilitados: habilitar exige os identificadores públicos e os
-- segredos no ambiente — tests/channels.test.js confere este seed.
-- =====================================================================

insert into public.sales_channels (id, name, kind, enabled, status, environment, config, metadata, feed_format)
values
  ('google-merchant', 'Google Merchant Center', 'feed', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 0))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'xml'),
  ('meta-ads', 'Meta Ads', 'feed', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 0))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'csv'),
  ('ga4', 'Google Analytics 4', 'measurement', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 0))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'json'),
  ('mercadolivre', 'Mercado Livre', 'marketplace', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 16))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'json'),
  ('shopee', 'Shopee', 'marketplace', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 16))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'json'),
  ('amazon', 'Amazon', 'marketplace', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 18))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'tsv'),
  ('magalu', 'Magazine Luiza', 'marketplace', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 14))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'json'),
  ('americanas', 'Americanas Marketplace', 'marketplace', false, 'pending', 'A configurar',
   jsonb_build_object('policy', public.channel_policy(jsonb_build_object('markup', 19))),
   jsonb_build_object('listings', 0, 'errors', 0, 'queue', 0), 'json')
on conflict (id) do nothing;

-- =====================================================================
-- RLS e permissões
-- =====================================================================

alter table public.sales_channels enable row level security;
alter table public.channel_listings enable row level security;

create policy "team read channels"
  on public.sales_channels for select
  to authenticated
  using (public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[]));

create policy "team read listings"
  on public.channel_listings for select
  to authenticated
  using (public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[]));

grant select on public.sales_channels, public.channel_listings to authenticated;
grant execute on function
  public.save_sales_channel(jsonb),
  public.publish_catalog_to_channel(text, jsonb),
  public.channel_summary(),
  public.channel_catalog(text)
to authenticated;
revoke all on function
  public.save_sales_channel(jsonb),
  public.publish_catalog_to_channel(text, jsonb),
  public.channel_summary(),
  public.channel_catalog(text)
from public, anon;
