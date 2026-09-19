-- Censura 18 — estoque central "Ecommerce C18"
-- Executar após 202609210001_audiencia_banners_google_ads.sql.
--
-- A operação trabalha com ESTOQUE ÚNICO (202609170001: stores.fulfills_stock,
-- stock_store_id(), set_stock_store()). A loja que concentra o saldo é a loja
-- virtual "Ecommerce C18": é dela que saem o site, o catálogo publicado nos
-- canais (Google Merchant, Meta, Google Ads e marketplaces) e a baixa de cada
-- venda. As seis lojas físicas não têm saldo próprio — funcionam como pontos
-- de retirada, e o pedido continua guardando a loja de retirada escolhida.
--
--   stores.kind                    → physical | ecommerce
--   ECOMMERCE-C18 (fulfills_stock) → passa a ser a loja do estoque
--   saldo já lançado em outra loja → transferido para o Ecommerce C18
--   channel_catalog(url, store)    → estoque do feed = saldo da loja de
--                                    estoque (store nulo soma as lojas)
--
-- Para trocar a loja do estoque depois: select public.set_stock_store('CODIGO');

-- =====================================================================
-- Loja virtual
-- =====================================================================

alter table public.stores
  add column if not exists kind text not null default 'physical'
    check (kind in ('physical', 'ecommerce'));

comment on column public.stores.kind is
  'physical = loja de rua/shopping (ponto de retirada) · ecommerce = loja virtual (estoque central).';

insert into public.stores (code, name, kind, active)
values ('ECOMMERCE-C18', 'Ecommerce C18', 'ecommerce', true)
on conflict (code) do update
  set name = excluded.name,
      kind = excluded.kind,
      active = true;

-- =====================================================================
-- Ecommerce C18 vira a loja do estoque (fulfills_stock)
-- =====================================================================

/* Mesma ordem de set_stock_store(): primeiro tira a marca da loja anterior,
   depois marca a nova — o índice stores_one_stock_location só admite uma.
   O saldo que já estivesse na loja anterior é transferido, com o movimento
   registrado nas duas pontas (transfer_out / transfer_in). */
do $$
declare
  v_new uuid;
  v_old uuid;
  r record;
begin
  select id into v_new from public.stores where code = 'ECOMMERCE-C18';

  select id into v_old
  from public.stores
  where fulfills_stock and id <> v_new
  order by created_at
  limit 1;

  if v_old is not null then
    for r in
      select variant_id, on_hand, reserved, synced_from
      from public.inventory_balances
      where store_id = v_old
    loop
      insert into public.inventory_movements
        (store_id, variant_id, kind, quantity_delta, balance_before, balance_after,
         reference_type, reference_id, note)
      values
        (v_old, r.variant_id, 'transfer_out', -r.on_hand, r.on_hand, 0,
         'migration', '202609210002', 'Estoque central passa para o Ecommerce C18');

      insert into public.inventory_balances
        (store_id, variant_id, on_hand, reserved, synced_from, synced_at, updated_at)
      values
        (v_new, r.variant_id, r.on_hand, r.reserved, r.synced_from, now(), now())
      on conflict (store_id, variant_id) do update
        set on_hand = public.inventory_balances.on_hand + excluded.on_hand,
            reserved = public.inventory_balances.reserved + excluded.reserved,
            version = public.inventory_balances.version + 1,
            updated_at = now();

      insert into public.inventory_movements
        (store_id, variant_id, kind, quantity_delta, balance_before, balance_after,
         reference_type, reference_id, note)
      select v_new, r.variant_id, 'transfer_in', r.on_hand, b.on_hand - r.on_hand, b.on_hand,
             'migration', '202609210002', 'Estoque central passa para o Ecommerce C18'
      from public.inventory_balances b
      where b.store_id = v_new and b.variant_id = r.variant_id;
    end loop;

    delete from public.inventory_balances where store_id = v_old;
  end if;

  update public.stores set fulfills_stock = false where fulfills_stock and id <> v_new;
  update public.stores set fulfills_stock = true where id = v_new;
end;
$$;

-- =====================================================================
-- Catálogo publicável: estoque do feed = saldo da loja de estoque
-- =====================================================================

/* A assinatura muda (ganha p_store_id), então a versão antiga sai antes —
   senão channel_catalog('url') ficaria ambígua entre as duas. Os itens
   continuam vindo de todas as lojas (o feed lista o catálogo inteiro); o
   saldo publicado é o da loja informada — por padrão, a loja do estoque
   (Ecommerce C18). Com p_store_id nulo soma todas as lojas, como antes. */
drop function if exists public.channel_catalog(text);

create or replace function public.channel_catalog(
  p_site_url text default 'https://censura18.com.br',
  p_store_id uuid default public.stock_store_id()
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
      -- saldo publicável: só a loja de estoque (ou todas, se nenhuma for informada)
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
  'Catálogo publicável nos canais; o estoque é o saldo disponível da loja informada (padrão: loja do estoque, Ecommerce C18).';

-- =====================================================================
-- Permissões
-- =====================================================================

grant execute on function public.channel_catalog(text, uuid) to authenticated;
revoke all on function public.channel_catalog(text, uuid) from public, anon;

-- Conferência depois de rodar:
--   select code, name, kind, fulfills_stock from public.stores order by fulfills_stock desc, name;
--   select item_key, stock from public.channel_catalog() order by stock desc limit 10;
