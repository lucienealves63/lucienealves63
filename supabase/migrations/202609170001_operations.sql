-- Censura 18 — núcleo de estoque e operação
-- Supabase/PostgreSQL. Execute primeiro em um projeto de homologação.

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create type public.app_role as enum ('admin', 'inventory', 'checker', 'shipping', 'viewer');
create type public.movement_kind as enum (
  'opening', 'import', 'receipt', 'sale', 'reservation', 'release',
  'transfer_in', 'transfer_out', 'adjustment', 'count'
);
create type public.import_status as enum ('processing', 'completed', 'completed_with_errors', 'failed', 'reverted');
create type public.order_stage as enum (
  'payment', 'fraud', 'picking', 'checking', 'ready', 'shipped',
  'delivered', 'cancelled'
);
create type public.payment_stage as enum ('pending', 'authorized', 'captured', 'denied', 'cancelled', 'refunded');
create type public.fraud_stage as enum ('pending', 'review', 'approved', 'denied', 'error');
create type public.integration_status as enum ('pending', 'processing', 'done', 'failed', 'dead_letter');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  alterdata_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.stores (code, name) values
  ('NI-CALCADAO', 'Nova Iguaçu — Calçadão'),
  ('NI-BECO', 'Nova Iguaçu — Beco do Ponto Frio'),
  ('NI-TOP', 'Nova Iguaçu — Top Shopping'),
  ('CAXIAS', 'Duque de Caxias — Centro'),
  ('NILOPOLIS', 'Nilópolis — Mirandela'),
  ('QUEIMADOS', 'Queimados — Centro')
on conflict (code) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  store_id uuid references public.stores(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alterdata_id text,
  created_at timestamptz not null default now(),
  unique (name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alterdata_id text,
  created_at timestamptz not null default now(),
  unique (name)
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alterdata_id text,
  created_at timestamptz not null default now(),
  unique (name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  name text not null,
  brand_id uuid not null references public.brands(id),
  category_id uuid not null references public.categories(id),
  collection_id uuid references public.collections(id),
  retail_price numeric(14,2) not null default 0 check (retail_price >= 0),
  published boolean not null default false,
  source text not null default 'alterdata' check (source in ('alterdata', 'excel', 'manual')),
  alterdata_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  reference text not null,
  color text not null default 'ÚNICA',
  size text not null default 'ÚNICO',
  barcode text unique,
  alterdata_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_variants_product_idx on public.product_variants(product_id);
create index product_variants_reference_idx on public.product_variants(reference);
create index products_catalog_idx on public.products(brand_id, category_id, collection_id);

create table public.inventory_balances (
  store_id uuid not null references public.stores(id),
  variant_id uuid not null references public.product_variants(id),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  available integer generated always as (on_hand - reserved) stored,
  version bigint not null default 1,
  synced_from text not null default 'alterdata',
  synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (store_id, variant_id)
);

create index inventory_available_idx on public.inventory_balances(store_id, available);

create table public.stock_imports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  filename text not null,
  selection jsonb not null default '{}'::jsonb,
  status public.import_status not null default 'processing',
  total_rows integer not null default 0,
  created_rows integer not null default 0,
  updated_rows integer not null default 0,
  error_rows integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  variant_id uuid not null references public.product_variants(id),
  kind public.movement_kind not null,
  quantity_delta integer not null,
  balance_before integer not null,
  balance_after integer not null check (balance_after >= 0),
  reference_type text,
  reference_id text,
  import_id uuid references public.stock_imports(id),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index inventory_movements_variant_idx on public.inventory_movements(variant_id, created_at desc);
create index inventory_movements_store_idx on public.inventory_movements(store_id, created_at desc);
create index inventory_movements_import_idx on public.inventory_movements(import_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  external_id text,
  source text not null default 'site',
  store_id uuid references public.stores(id),
  seller_code text check (seller_code is null or char_length(seller_code) <= 24),
  coupon_code text check (coupon_code is null or char_length(coupon_code) <= 32),
  customer jsonb not null default '{}'::jsonb,
  billing_address jsonb,
  shipping_address jsonb,
  subtotal numeric(14,2) not null default 0,
  shipping_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  stage public.order_stage not null default 'payment',
  payment_status public.payment_stage not null default 'pending',
  fraud_status public.fraud_stage not null default 'pending',
  rede_tid text,
  rede_nsu text,
  clearsale_request_id text,
  clearsale_score numeric(10,4),
  alterdata_id text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_stage_idx on public.orders(stage, created_at desc);
create index orders_store_idx on public.orders(store_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid references public.product_variants(id),
  sku text not null,
  name text not null,
  color text,
  size text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  checked_quantity integer not null default 0 check (checked_quantity >= 0),
  divergence_reason text
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_stage public.order_stage,
  to_stage public.order_stage,
  event_type text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events(order_id, created_at desc);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  invoice_number text,
  supplier_name text not null,
  store_id uuid not null references public.stores(id),
  status text not null default 'pending' check (status in ('pending', 'checking', 'completed', 'cancelled')),
  expected_items integer not null default 0,
  checked_items integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  variant_id uuid references public.product_variants(id),
  sku text not null,
  expected_quantity integer not null default 0,
  received_quantity integer not null default 0,
  divergence_reason text,
  checked_by uuid references auth.users(id),
  checked_at timestamptz
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  carrier text,
  service text,
  tracking_code text,
  label_url text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'posted', 'in_transit', 'delivered', 'exception')),
  checked_by uuid references auth.users(id),
  checked_at timestamptz,
  shipped_by uuid references auth.users(id),
  shipped_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.integration_connections (
  id text primary key check (id in ('alterdata', 'rede', 'clearsale')),
  enabled boolean not null default false,
  environment text not null default 'sandbox',
  status text not null default 'pending',
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.integration_connections (id) values ('alterdata'), ('rede'), ('clearsale')
on conflict (id) do nothing;

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('alterdata', 'rede', 'clearsale')),
  operation text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  status public.integration_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  response jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index integration_outbox_queue_idx on public.integration_outbox(service, status, next_attempt_at);

-- Atualização padronizada de timestamps.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bump_version()
returns trigger language plpgsql as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger stores_set_updated_at before update on public.stores for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger variants_set_updated_at before update on public.product_variants for each row execute function public.set_updated_at();
create trigger balances_set_updated_at before update on public.inventory_balances for each row execute function public.set_updated_at();
create trigger balances_bump_version before update on public.inventory_balances for each row execute function public.bump_version();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger orders_bump_version before update on public.orders for each row execute function public.bump_version();
create trigger connections_set_updated_at before update on public.integration_connections for each row execute function public.set_updated_at();

-- Perfil automático. O primeiro administrador deve ser promovido manualmente
-- pelo SQL Editor; os demais começam como visualizadores.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.has_role(allowed public.app_role[])
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = any(allowed)
  );
$$;

-- Catálogo pronto para o dashboard.
create or replace view public.inventory_catalog_view
with (security_invoker = true)
as
select
  ib.store_id,
  s.code as store_code,
  s.name as store_name,
  pv.id as variant_id,
  pv.sku,
  pv.reference,
  pv.color,
  pv.size,
  p.id as product_id,
  p.name as product_name,
  b.name as brand,
  c.name as category,
  coalesce(col.name, 'SEM COLEÇÃO') as collection,
  p.retail_price,
  p.published,
  ib.on_hand,
  ib.reserved,
  ib.available,
  ib.synced_from,
  ib.synced_at,
  ib.updated_at
from public.inventory_balances ib
join public.stores s on s.id = ib.store_id
join public.product_variants pv on pv.id = ib.variant_id
join public.products p on p.id = pv.product_id
join public.brands b on b.id = p.brand_id
join public.categories c on c.id = p.category_id
left join public.collections col on col.id = p.collection_id;

-- Importação atômica. O navegador lê o XLSX e envia somente as linhas
-- escolhidas por coleção/referência. COMPRADOR e GRUPO já chegam mapeados
-- para brand e category.
create or replace function public.import_inventory_rows(
  p_store_id uuid,
  p_filename text,
  p_selection jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_import_id uuid;
  v_row jsonb;
  v_brand_id uuid;
  v_category_id uuid;
  v_collection_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_source_key text;
  v_before integer;
  v_after integer;
  v_balance_exists boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sku text;
  v_name text;
  v_brand text;
  v_category text;
  v_collection text;
begin
  if not public.has_role(array['admin', 'inventory']::public.app_role[]) then
    raise exception 'Sem permissão para importar estoque';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'A importação não possui linhas';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and active) then
    raise exception 'Loja inválida ou inativa';
  end if;

  insert into public.stock_imports (
    store_id, filename, selection, total_rows, created_by
  ) values (
    p_store_id, p_filename, coalesce(p_selection, '{}'::jsonb),
    jsonb_array_length(p_rows), auth.uid()
  ) returning id into v_import_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_sku := trim(coalesce(v_row ->> 'code', ''));
      v_name := trim(coalesce(v_row ->> 'description', ''));
      v_brand := trim(coalesce(v_row ->> 'brand', 'SEM MARCA'));
      v_category := trim(coalesce(v_row ->> 'category', 'SEM CATEGORIA'));
      v_collection := trim(coalesce(v_row ->> 'collection', 'SEM COLEÇÃO'));

      if v_sku = '' or v_name = '' then
        raise exception 'SKU ou descrição vazio';
      end if;
      if coalesce((v_row ->> 'quantity')::integer, 0) < 0 then
        raise exception 'Saldo negativo';
      end if;

      insert into public.brands (name) values (v_brand)
      on conflict (name) do update set name = excluded.name
      returning id into v_brand_id;

      insert into public.categories (name) values (v_category)
      on conflict (name) do update set name = excluded.name
      returning id into v_category_id;

      insert into public.collections (name) values (v_collection)
      on conflict (name) do update set name = excluded.name
      returning id into v_collection_id;

      v_source_key := encode(digest(lower(v_brand || '|' || v_name || '|' || v_collection || '|' || v_category), 'sha256'), 'hex');

      insert into public.products (
        source_key, name, brand_id, category_id, collection_id,
        retail_price, published, source
      ) values (
        v_source_key, v_name, v_brand_id, v_category_id, v_collection_id,
        greatest(coalesce((v_row ->> 'price')::numeric, 0), 0),
        coalesce((v_row ->> 'ecommerce')::boolean, false), 'excel'
      )
      on conflict (source_key) do update set
        name = excluded.name,
        brand_id = excluded.brand_id,
        category_id = excluded.category_id,
        collection_id = excluded.collection_id,
        retail_price = excluded.retail_price,
        published = excluded.published,
        source = 'excel'
      returning id into v_product_id;

      insert into public.product_variants (
        product_id, sku, reference, color, size
      ) values (
        v_product_id, v_sku, coalesce(nullif(trim(v_row ->> 'reference'), ''), v_sku),
        coalesce(nullif(trim(v_row ->> 'color'), ''), 'ÚNICA'),
        coalesce(nullif(trim(v_row ->> 'size'), ''), 'ÚNICO')
      )
      on conflict (sku) do update set
        product_id = excluded.product_id,
        reference = excluded.reference,
        color = excluded.color,
        size = excluded.size,
        active = true
      returning id into v_variant_id;

      select on_hand into v_before
      from public.inventory_balances
      where store_id = p_store_id and variant_id = v_variant_id
      for update;

      v_balance_exists := found;
      if not v_balance_exists then v_before := 0; end if;
      v_after := coalesce((v_row ->> 'quantity')::integer, 0);

      insert into public.inventory_balances (
        store_id, variant_id, on_hand, synced_from, synced_at
      ) values (
        p_store_id, v_variant_id, v_after, 'excel', now()
      )
      on conflict (store_id, variant_id) do update set
        on_hand = excluded.on_hand,
        synced_from = 'excel',
        synced_at = now();

      if v_balance_exists then v_updated := v_updated + 1;
      else v_created := v_created + 1;
      end if;

      if v_after <> v_before then
        insert into public.inventory_movements (
          store_id, variant_id, kind, quantity_delta, balance_before,
          balance_after, reference_type, reference_id, import_id,
          note, created_by
        ) values (
          p_store_id, v_variant_id, 'import', v_after - v_before, v_before,
          v_after, 'stock_import', v_import_id::text, v_import_id,
          p_filename, auth.uid()
        );
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'rowNumber', v_row ->> 'rowNumber',
        'code', v_row ->> 'code',
        'message', sqlerrm
      ));
    end;
  end loop;

  update public.stock_imports set
    status = case when jsonb_array_length(v_errors) = 0 then 'completed'::public.import_status else 'completed_with_errors'::public.import_status end,
    created_rows = v_created,
    updated_rows = v_updated,
    error_rows = jsonb_array_length(v_errors),
    errors = v_errors,
    completed_at = now()
  where id = v_import_id;

  return jsonb_build_object(
    'importId', v_import_id,
    'created', v_created,
    'updated', v_updated,
    'errors', v_errors
  );
end;
$$;

-- Cadastro e ajuste manual atômico. O saldo local é auditado e o evento entra
-- na outbox do Alterdata, que permanece sendo a fonte mestre.
create or replace function public.adjust_inventory_stock(
  p_store_id uuid,
  p_movement text,
  p_quantity integer,
  p_note text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_brand_id uuid;
  v_category_id uuid;
  v_collection_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_movement_id uuid;
  v_source_key text;
  v_sku text;
  v_name text;
  v_before integer := 0;
  v_reserved integer := 0;
  v_after integer;
  v_kind public.movement_kind;
begin
  if not public.has_role(array['admin', 'inventory']::public.app_role[]) then
    raise exception 'Sem permissão para ajustar estoque';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and active) then
    raise exception 'Loja inválida ou inativa';
  end if;
  if p_movement not in ('set', 'entry', 'exit', 'adjustment') then
    raise exception 'Tipo de movimento inválido';
  end if;
  if trim(coalesce(p_note, '')) = '' then raise exception 'Motivo obrigatório'; end if;

  v_sku := trim(coalesce(p_row ->> 'code', ''));
  v_name := trim(coalesce(p_row ->> 'description', ''));
  if v_sku = '' or v_name = '' then raise exception 'SKU e descrição são obrigatórios'; end if;

  insert into public.brands (name)
  values (coalesce(nullif(trim(p_row ->> 'brand'), ''), 'SEM MARCA'))
  on conflict (name) do update set name = excluded.name returning id into v_brand_id;

  insert into public.categories (name)
  values (coalesce(nullif(trim(p_row ->> 'category'), ''), 'SEM CATEGORIA'))
  on conflict (name) do update set name = excluded.name returning id into v_category_id;

  insert into public.collections (name)
  values (coalesce(nullif(trim(p_row ->> 'collection'), ''), 'SEM COLEÇÃO'))
  on conflict (name) do update set name = excluded.name returning id into v_collection_id;

  v_source_key := encode(digest(lower(
    coalesce(nullif(trim(p_row ->> 'brand'), ''), 'SEM MARCA') || '|' ||
    v_name || '|' ||
    coalesce(nullif(trim(p_row ->> 'collection'), ''), 'SEM COLEÇÃO') || '|' ||
    coalesce(nullif(trim(p_row ->> 'category'), ''), 'SEM CATEGORIA')
  ), 'sha256'), 'hex');

  insert into public.products (
    source_key, name, brand_id, category_id, collection_id, retail_price,
    published, source
  ) values (
    v_source_key, v_name, v_brand_id, v_category_id, v_collection_id,
    greatest(coalesce((p_row ->> 'price')::numeric, 0), 0),
    coalesce((p_row ->> 'ecommerce')::boolean, false), 'manual'
  )
  on conflict (source_key) do update set
    name = excluded.name,
    brand_id = excluded.brand_id,
    category_id = excluded.category_id,
    collection_id = excluded.collection_id,
    retail_price = excluded.retail_price
  returning id into v_product_id;

  insert into public.product_variants (product_id, sku, reference, color, size)
  values (
    v_product_id, v_sku, coalesce(nullif(trim(p_row ->> 'reference'), ''), v_sku),
    coalesce(nullif(trim(p_row ->> 'color'), ''), 'ÚNICA'),
    coalesce(nullif(trim(p_row ->> 'size'), ''), 'ÚNICO')
  )
  on conflict (sku) do update set
    product_id = excluded.product_id,
    reference = excluded.reference,
    color = excluded.color,
    size = excluded.size,
    active = true
  returning id into v_variant_id;

  select on_hand, reserved into v_before, v_reserved
  from public.inventory_balances
  where store_id = p_store_id and variant_id = v_variant_id
  for update;
  if not found then v_before := 0; v_reserved := 0; end if;

  v_after := case p_movement
    when 'set' then p_quantity
    when 'entry' then v_before + abs(p_quantity)
    when 'exit' then v_before - abs(p_quantity)
    else v_before + p_quantity
  end;
  if v_after < 0 then raise exception 'O movimento deixaria o saldo negativo'; end if;
  if v_after < v_reserved then raise exception 'O saldo não pode ficar abaixo da quantidade reservada (%)', v_reserved; end if;
  v_kind := case when p_movement = 'set' then 'count'::public.movement_kind else 'adjustment'::public.movement_kind end;

  insert into public.inventory_balances (store_id, variant_id, on_hand, reserved, synced_from, synced_at)
  values (p_store_id, v_variant_id, v_after, v_reserved, 'manual', now())
  on conflict (store_id, variant_id) do update set
    on_hand = excluded.on_hand,
    synced_from = 'manual',
    synced_at = now();

  insert into public.inventory_movements (
    store_id, variant_id, kind, quantity_delta, balance_before, balance_after,
    reference_type, reference_id, note, created_by
  ) values (
    p_store_id, v_variant_id, v_kind, v_after - v_before, v_before, v_after,
    'manual_adjustment', v_sku, p_note, auth.uid()
  ) returning id into v_movement_id;

  insert into public.integration_outbox (
    service, operation, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    'alterdata', 'inventory.update', 'inventory_movement', v_movement_id::text,
    'alterdata:inventory:' || v_movement_id::text,
    jsonb_build_object(
      'movementId', v_movement_id, 'storeId', p_store_id, 'variantId', v_variant_id,
      'sku', v_sku, 'quantity', v_after, 'note', p_note
    )
  );

  return jsonb_build_object(
    'movementId', v_movement_id, 'variantId', v_variant_id,
    'balanceBefore', v_before, 'balanceAfter', v_after
  );
end;
$$;

-- Conferência item a item. A função exige que o pedido esteja na etapa correta
-- e grava a quantidade conferida sem liberar escrita direta na tabela.
create or replace function public.check_order_item(p_item_id uuid, p_checked boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_item public.order_items%rowtype;
  v_stage public.order_stage;
begin
  if not public.has_role(array['admin', 'checker']::public.app_role[]) then
    raise exception 'Sem permissão para conferir pedido';
  end if;
  select * into v_item from public.order_items where id = p_item_id for update;
  if not found then raise exception 'Item não encontrado'; end if;
  select stage into v_stage from public.orders where id = v_item.order_id for update;
  if v_stage <> 'checking' then raise exception 'Pedido não está em conferência'; end if;

  update public.order_items
  set checked_quantity = case when p_checked then quantity else 0 end,
      divergence_reason = case when p_checked then null else divergence_reason end
  where id = p_item_id;

  return jsonb_build_object(
    'itemId', p_item_id,
    'checkedQuantity', case when p_checked then v_item.quantity else 0 end
  );
end;
$$;

-- Avanço controlado do pedido. Cada ação valida papel, etapa atual e pré-condições.
create or replace function public.update_order_operation(
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_next public.order_stage;
  v_event text;
  v_outbox_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;

  if p_action in ('approve-fraud', 'deny') then
    if not public.has_role(array['admin']::public.app_role[]) then raise exception 'Sem permissão para decidir antifraude'; end if;
    if v_order.stage <> 'fraud' then raise exception 'Pedido não está em análise antifraude'; end if;
    if p_action = 'approve-fraud' then
      v_next := case when v_order.payment_status = 'captured' then 'picking'::public.order_stage else 'payment'::public.order_stage end;
      update public.orders set fraud_status = 'approved', stage = v_next where id = p_order_id;
      v_event := case when v_next = 'picking'
        then 'Antifraude aprovado por administrador; pedido liberado'
        else 'Antifraude aprovado por administrador; aguardando captura do pagamento'
      end;
    else
      update public.orders set fraud_status = 'denied', stage = 'cancelled' where id = p_order_id;
      v_next := 'cancelled'; v_event := 'Pedido recusado por decisão antifraude';
    end if;
  elsif p_action = 'start-check' then
    if not public.has_role(array['admin', 'inventory']::public.app_role[]) then raise exception 'Sem permissão para concluir separação'; end if;
    if v_order.stage <> 'picking' then raise exception 'Pedido não está em separação'; end if;
    update public.orders set stage = 'checking' where id = p_order_id;
    v_next := 'checking'; v_event := 'Separação concluída; pedido enviado à conferência';
  elsif p_action = 'finish-check' then
    if not public.has_role(array['admin', 'checker']::public.app_role[]) then raise exception 'Sem permissão para finalizar conferência'; end if;
    if v_order.stage <> 'checking' then raise exception 'Pedido não está em conferência'; end if;
    if not exists (select 1 from public.order_items where order_id = p_order_id) then
      raise exception 'Pedido sem itens para conferência';
    end if;
    if exists (select 1 from public.order_items where order_id = p_order_id and checked_quantity <> quantity) then
      raise exception 'Todos os itens precisam ser conferidos';
    end if;
    update public.orders set stage = 'ready' where id = p_order_id;
    v_next := 'ready'; v_event := 'Conferência concluída sem divergência';
  elsif p_action = 'ship' then
    if not public.has_role(array['admin', 'shipping']::public.app_role[]) then raise exception 'Sem permissão para expedir pedido'; end if;
    if v_order.stage <> 'ready' then raise exception 'Pedido não está pronto para envio'; end if;
    if trim(coalesce(p_payload ->> 'carrier', '')) = '' then raise exception 'Transportadora obrigatória'; end if;
    insert into public.shipments (
      order_id, carrier, tracking_code, status, shipped_by, shipped_at
    ) values (
      p_order_id, trim(p_payload ->> 'carrier'), nullif(trim(p_payload ->> 'tracking'), ''),
      'posted', auth.uid(), now()
    )
    on conflict (order_id) do update set
      carrier = excluded.carrier,
      tracking_code = excluded.tracking_code,
      status = 'posted',
      shipped_by = auth.uid(),
      shipped_at = now();
    update public.orders set stage = 'shipped' where id = p_order_id;
    v_next := 'shipped'; v_event := 'Pedido expedido';
  elsif p_action = 'deliver' then
    if not public.has_role(array['admin', 'shipping']::public.app_role[]) then raise exception 'Sem permissão para confirmar entrega'; end if;
    if v_order.stage <> 'shipped' then raise exception 'Pedido ainda não foi expedido'; end if;
    update public.shipments set status = 'delivered', delivered_at = now() where order_id = p_order_id;
    update public.orders set stage = 'delivered' where id = p_order_id;
    v_next := 'delivered'; v_event := 'Entrega confirmada';
  else
    raise exception 'Ação de pedido inválida';
  end if;

  insert into public.order_events (
    order_id, from_stage, to_stage, event_type, note, metadata, created_by
  ) values (
    p_order_id, v_order.stage, v_next, 'operation.' || p_action, v_event,
    coalesce(p_payload, '{}'::jsonb), auth.uid()
  );

  if p_action in ('start-check', 'finish-check', 'ship', 'deliver') then
    insert into public.integration_outbox (
      service, operation, aggregate_type, aggregate_id, idempotency_key, payload
    ) values (
      'alterdata', 'order.push', 'order', p_order_id::text,
      'alterdata:order:' || p_order_id::text || ':' || v_next::text,
      jsonb_build_object(
        'orderId', p_order_id, 'number', v_order.number, 'stage', v_next,
        'sellerCode', v_order.seller_code, 'couponCode', v_order.coupon_code,
        'discountAmount', v_order.discount_amount,
        'carrier', p_payload ->> 'carrier', 'tracking', p_payload ->> 'tracking'
      )
    )
    on conflict (idempotency_key) do nothing
    returning id into v_outbox_id;
  end if;

  return jsonb_build_object('orderId', p_order_id, 'stage', v_next, 'outboxId', v_outbox_id);
end;
$$;

-- Reversão segura: só é permitida quando nenhum saldo do lote recebeu uma
-- movimentação posterior. Assim não se apaga venda, reserva ou contagem feita
-- depois da importação.
create or replace function public.revert_stock_import(p_import_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_import public.stock_imports%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_count integer := 0;
begin
  if not public.has_role(array['admin', 'inventory']::public.app_role[]) then
    raise exception 'Sem permissão para reverter importação';
  end if;

  select * into v_import from public.stock_imports where id = p_import_id for update;
  if not found then raise exception 'Importação não encontrada'; end if;
  if v_import.status = 'reverted' then raise exception 'Importação já revertida'; end if;

  if exists (
    select 1
    from public.inventory_movements source
    join public.inventory_balances balance
      on balance.store_id = source.store_id and balance.variant_id = source.variant_id
    where source.import_id = p_import_id
      and (
        balance.on_hand <> source.balance_after
        or exists (
          select 1 from public.inventory_movements later
          where later.store_id = source.store_id
            and later.variant_id = source.variant_id
            and later.created_at > source.created_at
        )
      )
  ) then
    raise exception 'Lote possui itens com movimentação posterior e não pode ser revertido automaticamente';
  end if;

  for v_movement in
    select * from public.inventory_movements where import_id = p_import_id order by created_at desc
  loop
    update public.inventory_balances
    set on_hand = v_movement.balance_before,
        synced_from = 'import_revert',
        synced_at = now()
    where store_id = v_movement.store_id and variant_id = v_movement.variant_id;

    insert into public.inventory_movements (
      store_id, variant_id, kind, quantity_delta, balance_before,
      balance_after, reference_type, reference_id, note, created_by
    ) values (
      v_movement.store_id, v_movement.variant_id, 'adjustment',
      v_movement.balance_before - v_movement.balance_after,
      v_movement.balance_after, v_movement.balance_before,
      'stock_import_revert', p_import_id::text,
      coalesce(p_note, 'Reversão do lote ' || p_import_id::text), auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  update public.stock_imports
  set status = 'reverted', reverted_at = now()
  where id = p_import_id;

  return jsonb_build_object('importId', p_import_id, 'revertedMovements', v_count);
end;
$$;

-- RLS: leitura para equipe autenticada; escrita sensível apenas por RPCs ou
-- funções de backend com service_role.
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_imports enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.shipments enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_outbox enable row level security;

create policy "authenticated read stores" on public.stores for select to authenticated using (true);
create policy "authenticated read brands" on public.brands for select to authenticated using (true);
create policy "authenticated read categories" on public.categories for select to authenticated using (true);
create policy "authenticated read collections" on public.collections for select to authenticated using (true);
create policy "authenticated read products" on public.products for select to authenticated using (true);
create policy "authenticated read variants" on public.product_variants for select to authenticated using (true);
create policy "authenticated read balances" on public.inventory_balances for select to authenticated using (true);
create policy "team read imports" on public.stock_imports for select to authenticated using (public.has_role(array['admin','inventory','viewer']::public.app_role[]));
create policy "team read movements" on public.inventory_movements for select to authenticated using (public.has_role(array['admin','inventory','viewer']::public.app_role[]));
create policy "team read orders" on public.orders for select to authenticated using (public.has_role(array['admin','inventory','checker','shipping','viewer']::public.app_role[]));
create policy "team read order items" on public.order_items for select to authenticated using (public.has_role(array['admin','inventory','checker','shipping','viewer']::public.app_role[]));
create policy "team read order events" on public.order_events for select to authenticated using (public.has_role(array['admin','inventory','checker','shipping','viewer']::public.app_role[]));
create policy "team read receipts" on public.receipts for select to authenticated using (public.has_role(array['admin','inventory','checker','viewer']::public.app_role[]));
create policy "team read receipt items" on public.receipt_items for select to authenticated using (public.has_role(array['admin','inventory','checker','viewer']::public.app_role[]));
create policy "team read shipments" on public.shipments for select to authenticated using (public.has_role(array['admin','checker','shipping','viewer']::public.app_role[]));
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.has_role(array['admin']::public.app_role[]));
create policy "admins update profiles" on public.profiles for update to authenticated using (public.has_role(array['admin']::public.app_role[])) with check (public.has_role(array['admin']::public.app_role[]));
create policy "admins read integrations" on public.integration_connections for select to authenticated using (public.has_role(array['admin']::public.app_role[]));
create policy "admins read integration queue" on public.integration_outbox for select to authenticated using (public.has_role(array['admin']::public.app_role[]));

grant usage on schema public to authenticated;
grant select on table
  public.stores, public.profiles, public.brands, public.categories,
  public.collections, public.products, public.product_variants,
  public.inventory_balances, public.stock_imports, public.inventory_movements,
  public.orders, public.order_items, public.order_events, public.receipts,
  public.receipt_items, public.shipments, public.integration_connections,
  public.integration_outbox
to authenticated;
grant update on public.profiles to authenticated;
grant select on public.inventory_catalog_view to authenticated;
grant execute on function public.import_inventory_rows(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.adjust_inventory_stock(uuid, text, integer, text, jsonb) to authenticated;
grant execute on function public.check_order_item(uuid, boolean) to authenticated;
grant execute on function public.update_order_operation(uuid, text, jsonb) to authenticated;
grant execute on function public.revert_stock_import(uuid, text) to authenticated;
revoke all on function public.import_inventory_rows(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.adjust_inventory_stock(uuid, text, integer, text, jsonb) from public, anon;
revoke all on function public.check_order_item(uuid, boolean) from public, anon;
revoke all on function public.update_order_operation(uuid, text, jsonb) from public, anon;
revoke all on function public.revert_stock_import(uuid, text) from public, anon;
