-- Censura 18 — estoque central "Ecommerce C18"
-- Executar após 202609210001_audiencia_banners_google_ads.sql.
--
-- O estoque central da operação é a loja virtual "Ecommerce C18". É dele
-- que saem o catálogo publicado nos canais (Google Merchant, Meta, Google
-- Ads e marketplaces) e é nele que os pedidos do site são lançados. As
-- seis lojas físicas continuam com o próprio saldo (importação da
-- Alterdata por loja) e aparecem lado a lado no painel de estoque.
--
--   stores.kind / stores.is_central  → marca a loja virtual como central
--   central_store_id()               → o id, para SQL, funções e painel
--   channel_catalog(url, store)      → estoque do feed = saldo do central
--                                      (store nulo volta a somar as lojas)
--   orders_default_store()           → pedido do site sem loja vai para o
--                                      Ecommerce C18

-- =====================================================================
-- Loja virtual = estoque central
-- =====================================================================

alter table public.stores
  add column if not exists kind text not null default 'physical'
    check (kind in ('physical', 'ecommerce')),
  add column if not exists is_central boolean not null default false;

comment on column public.stores.kind is
  'physical = loja de rua/shopping · ecommerce = loja virtual (estoque central).';
comment on column public.stores.is_central is
  'Estoque central (Ecommerce C18): alimenta site, feeds e marketplaces e recebe os pedidos do site.';

-- só um estoque central por vez
create unique index if not exists stores_single_central_idx
  on public.stores (is_central)
  where is_central;

update public.stores set is_central = false
where is_central and code <> 'ECOMMERCE-C18';

insert into public.stores (code, name, kind, is_central, active)
values ('ECOMMERCE-C18', 'Ecommerce C18', 'ecommerce', true, true)
on conflict (code) do update
  set name = excluded.name,
      kind = excluded.kind,
      is_central = true,
      active = true;

create or replace function public.central_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.stores
  where is_central and active
  order by created_at
  limit 1;
$$;

comment on function public.central_store_id() is
  'Loja do estoque central (Ecommerce C18). Nulo se nenhuma loja estiver marcada.';

-- =====================================================================
-- Pedidos do site nascem no estoque central
-- =====================================================================

create or replace function public.orders_default_store()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.store_id is null and coalesce(new.source, 'site') = 'site' then
    new.store_id := public.central_store_id();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_default_store on public.orders;
create trigger orders_default_store
  before insert on public.orders
  for each row execute function public.orders_default_store();

-- pedidos do site já criados sem loja passam para o central
update public.orders
set store_id = public.central_store_id()
where store_id is null and source = 'site' and public.central_store_id() is not null;

-- =====================================================================
-- Catálogo publicável: estoque do feed = saldo do Ecommerce C18
-- =====================================================================

/* A assinatura muda (ganha p_store_id), então a versão antiga sai antes —
   senão channel_catalog('url') ficaria ambígua entre as duas. Os itens
   continuam vindo de todas as lojas (o feed lista o catálogo inteiro); só
   o saldo publicado passa a ser o da loja informada. Com p_store_id nulo
   (nenhum central marcado) volta a somar todas as lojas, como antes. */
drop function if exists public.channel_catalog(text);

create or replace function public.channel_catalog(
  p_site_url text default 'https://censura18.com.br',
  p_store_id uuid default public.central_store_id()
)
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
      -- saldo publicável: só a loja central (ou todas, se nenhuma for informada)
      coalesce(sum(greatest(0, coalesce(v.on_hand, 0) - coalesce(v.reserved, 0)))
        filter (where p_store_id is null or v.store_id = p_store_id), 0)::integer as stock,
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

comment on function public.channel_catalog(text, uuid) is
  'Catálogo publicável nos canais; o estoque é o saldo disponível da loja informada (padrão: estoque central Ecommerce C18).';

-- =====================================================================
-- Permissões
-- =====================================================================

grant execute on function public.central_store_id() to anon, authenticated;
grant execute on function public.channel_catalog(text, uuid) to authenticated;
revoke all on function public.channel_catalog(text, uuid) from public, anon;

-- Conferência depois de rodar:
--   select code, name, kind, is_central from public.stores order by is_central desc, name;
--   select item_key, stock from public.channel_catalog() order by stock desc limit 10;
