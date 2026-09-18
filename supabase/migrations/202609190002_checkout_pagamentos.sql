-- Censura 18 — checkout online: pedidos criados pelo site
-- Execute depois de 202609190001_customers.sql.
--
-- O cliente logado fecha o pedido em checkout.html: a RPC criar_meu_pedido
-- grava o pedido em public.orders (já consumido pelo painel de operações),
-- vincula ao cadastro (customer_id) e devolve o número. O pagamento:
--
--   · Pix        → payment_status 'pending'; o cliente paga com o copia-
--                  e-cola gerado no navegador (chave da loja em data.js) e
--                  a equipe confirma no painel (payment → captured).
--   · Cartão     → payment_status 'pending'; a loja envia o link seguro
--                  da e.Rede (3-D Secure) pelo WhatsApp. Nenhum dado de
--                  cartão passa pelo site (PCI). Quando o tokenizador
--                  estiver plugado, a transação entra pela fila
--                  integration_outbox (rede/transaction.create) — já
--                  suportada pelo integration-worker.
--
-- RLS: o cliente só vê os PRÓPRIOS pedidos; a equipe vê tudo. Inserção
-- exclusivamente pela RPC (security definer), nunca por INSERT direto.

alter table public.orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('pix', 'cartao', 'loja')),
  add column if not exists shipping_service text;

create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);

-- ------------------------------------------------------------- RLS
alter table public.orders enable row level security;

drop policy if exists "cliente le os proprios pedidos" on public.orders;
create policy "cliente le os proprios pedidos"
  on public.orders for select to authenticated
  using (
    customer_id = auth.uid()
    or public.has_role(array['admin','inventory','checker','shipping','viewer']::public.app_role[])
  );

drop policy if exists "cliente le itens do proprio pedido" on public.order_items;
create policy "cliente le itens do proprio pedido"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.customer_id = auth.uid() or public.has_role(
        array['admin','inventory','checker','shipping','viewer']::public.app_role[]))
    )
  );

-- ------------------------------------------------- criar pedido do site
create or replace function public.criar_meu_pedido(p_pedido jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_numero text;
  v_order public.orders%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_frete numeric(14,2) := 0;
  v_total numeric(14,2);
  v_metodo text;
  v_customer public.customers%rowtype;
  v_contador integer := 0;
begin
  if uid is null then
    raise exception 'Entre na sua conta para finalizar a compra';
  end if;

  v_metodo := lower(coalesce(p_pedido ->> 'metodo', ''));
  if v_metodo not in ('pix', 'cartao') then
    raise exception 'Escolha Pix ou cartão';
  end if;

  select * into v_customer from public.customers where id = uid;
  if not found or not coalesce(v_customer.aceitou_lgpd, false) then
    raise exception 'Complete seu cadastro na página Minha conta antes de comprar';
  end if;

  v_items := p_pedido -> 'items';
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if jsonb_array_length(v_items) > 30 then
    raise exception 'Carrinho muito grande — finalize em dois pedidos';
  end if;

  -- subtotal conferido item a item (o servidor não confia no preço enviado)
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_contador := v_contador + 1;
    if coalesce(v_item ->> 'id', '') = '' or coalesce(v_item ->> 'name', '') = '' then
      raise exception 'Item % inválido', v_contador;
    end if;
    if coalesce((v_item ->> 'qty')::int, 0) not between 1 and 20 then
      raise exception 'Quantidade inválida no item %', v_contador;
    end if;
    if coalesce((v_item ->> 'price')::numeric, -1) < 0 then
      raise exception 'Preço inválido no item %', v_contador;
    end if;
    v_subtotal := v_subtotal + (v_item ->> 'qty')::int * (v_item ->> 'price')::numeric;
  end loop;
  v_subtotal := round(v_subtotal, 2);

  if abs(v_subtotal - coalesce((p_pedido ->> 'subtotal')::numeric, -1)) > 0.01 then
    raise exception 'Valor do carrinho mudou — revise os itens e reenvie';
  end if;

  if coalesce((p_pedido -> 'frete' ->> 'gratis')::boolean, false) then
    v_frete := 0;
  else
    v_frete := round(coalesce((p_pedido -> 'frete' ->> 'preco')::numeric, 0), 2);
    if v_frete < 0 then v_frete := 0; end if;
  end if;
  v_total := round(v_subtotal + v_frete, 2);

  v_numero := 'C18-' || to_char(now(), 'YYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  insert into public.orders (
    number, source, store_id, customer_id,
    customer, shipping_address,
    subtotal, shipping_amount, discount_amount, total,
    stage, payment_status, fraud_status,
    payment_method, shipping_service,
    seller_code, coupon_code
  ) values (
    v_numero,
    'site',
    nullif(p_pedido ->> 'store_id', '')::uuid,
    uid,
    jsonb_build_object(
      'name', v_customer.nome,
      'email', coalesce(auth.email(), ''),
      'phone', v_customer.telefone
    ),
    case
      when nullif(p_pedido -> 'frete' ->> 'id', '') = 'retirada-loja' then null
      else jsonb_build_object(
        'postal_code', v_customer.cep, 'street', v_customer.rua,
        'number', v_customer.numero, 'complement', v_customer.complemento,
        'district', v_customer.bairro, 'city', v_customer.cidade,
        'state', v_customer.uf
      )
    end,
    v_subtotal, v_frete, 0, v_total,
    'payment', 'pending', 'pending',
    v_metodo,
    nullif(p_pedido -> 'frete' ->> 'transportadora', '') ||
      coalesce(' — ' || nullif(p_pedido -> 'frete' ->> 'servico', ''), ''),
    left(coalesce(p_pedido ->> 'seller_code', ''), 24),
    left(coalesce(p_pedido ->> 'coupon_code', ''), 32)
  ) returning * into v_order;

  insert into public.order_items (order_id, sku, name, color, size, quantity, unit_price)
  select
    v_order.id,
    left(coalesce(item ->> 'id', 'SEM-SKU'), 40),
    left(coalesce(item ->> 'name', 'Item'), 80),
    left(coalesce(item ->> 'color', 'ÚNICA'), 24),
    left(coalesce(item ->> 'size', 'ÚNICO'), 12),
    (item ->> 'qty')::int,
    round((item ->> 'price')::numeric, 2)
  from jsonb_array_elements(v_items) as item;

  insert into public.order_events (order_id, from_stage, to_stage, event_type, note)
  values (
    v_order.id, null, 'payment', 'order.created',
    'Pedido criado no site (' || case when v_metodo = 'pix'
      then 'Pix — aguardando confirmação do comprovante'
      else 'Cartão — link seguro enviado pela loja' end || ')'
  );

  return jsonb_build_object(
    'numero', v_order.number,
    'total', v_order.total,
    'subtotal', v_order.subtotal,
    'frete', v_order.shipping_amount,
    'metodo', v_metodo,
    'stage', v_order.stage,
    'payment_status', v_order.payment_status
  );
end;
$$;

revoke all on function public.criar_meu_pedido(jsonb) from public, anon;
grant execute on function public.criar_meu_pedido(jsonb) to authenticated;

-- ------------------------------------------------------- meus pedidos
create or replace function public.meus_pedidos()
returns table (
  numero text,
  criado_em timestamptz,
  total numeric(14,2),
  metodo text,
  pagamento public.payment_stage,
  etapa public.order_stage,
  itens jsonb
)
language sql
security definer set search_path = public
stable
as $$
  select o.number, o.created_at, o.total, o.payment_method,
         o.payment_status, o.stage,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'name', i.name, 'qty', i.quantity,
             'unit_price', i.unit_price) order by i.name)
           from public.order_items i where i.order_id = o.id
         ), '[]'::jsonb)
  from public.orders o
  where o.customer_id = auth.uid()
  order by o.created_at desc
  limit 50;
$$;

revoke all on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;
