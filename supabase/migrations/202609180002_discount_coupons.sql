-- Censura 18 — cupons de desconto
-- Executar após 202609170001_operations.sql.
--
-- O painel (admin/ → Cupons) cria cupons com escopo loja toda,
-- referência, categoria ou coleção — os mesmos conceitos da planilha
-- Alterdata. O site (assets/js/app.js + assets/js/coupons.js) consulta um
-- código específico pela RPC check_discount_coupon (chave anônima) só
-- para descrever o desconto ao cliente; o valor final é sempre confirmado
-- pela loja no fechamento do pedido, como no fluxo do cupom de hoje.

-- =====================================================================
-- Tabela
-- =====================================================================

create type public.coupon_kind as enum ('percent', 'amount');
create type public.coupon_scope as enum ('all', 'reference', 'category', 'collection');

create table public.discount_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9._/-]{3,32}$'),
  kind public.coupon_kind not null default 'percent',
  value numeric(10,2) not null,
  scope public.coupon_scope not null default 'all',
  target text check (target is null or char_length(target) <= 60),
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_coupons_value_sane check (
    (kind = 'percent' and value >= 1 and value <= 90)
    or (kind = 'amount' and value >= 0.01 and value <= 5000)
  ),
  constraint discount_coupons_target_required check (
    scope = 'all' or (target is not null and trim(target) <> '')
  ),
  constraint discount_coupons_window_sane check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create index discount_coupons_active_idx on public.discount_coupons (active);

create trigger discount_coupons_set_updated_at
  before update on public.discount_coupons
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS — a equipe lê; toda escrita passa pelas RPCs (security definer),
-- igual a banners e paletas. A chave anônima não lista cupons: ela só
-- consulta um código por vez via check_discount_coupon.
-- =====================================================================

alter table public.discount_coupons enable row level security;

create policy "team read discount coupons"
  on public.discount_coupons for select
  to authenticated
  using (
    public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[])
  );

-- =====================================================================
-- RPCs
-- =====================================================================

-- Salva ou atualiza um cupom (id vazio cria). Vários cupons podem ficar
-- ativos ao mesmo tempo — ativar um não desativa os demais.
create or replace function public.save_discount_coupon(p_payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_kind text;
  v_value numeric;
  v_scope text;
  v_target text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_want_active boolean;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar cupons';
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '');
  if v_id is not null and v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Id de cupom inválido';
  end if;
  v_id := v_id::uuid;
  v_code := upper(trim(coalesce(p_payload ->> 'code', '')));
  v_kind := coalesce(nullif(trim(coalesce(p_payload ->> 'kind', '')), ''), 'percent');
  v_value := nullif(trim(coalesce(p_payload ->> 'value', '')), '')::numeric;
  v_scope := coalesce(nullif(trim(coalesce(p_payload ->> 'scope', '')), ''), 'all');
  v_target := nullif(trim(coalesce(p_payload ->> 'target', '')), '');
  v_starts := nullif(trim(coalesce(p_payload ->> 'starts_at', '')), '')::timestamptz;
  v_ends := nullif(trim(coalesce(p_payload ->> 'ends_at', '')), '')::timestamptz;
  v_want_active := coalesce((p_payload ->> 'active')::boolean, false);

  if v_code !~ '^[A-Z0-9._/-]{3,32}$' then
    raise exception 'Código de cupom inválido (3 a 32 caracteres: letras, números, ponto, hífen, barra, underline)';
  end if;
  if v_kind not in ('percent', 'amount') then
    raise exception 'Tipo de desconto inválido';
  end if;
  if v_value is null or v_value <= 0 then
    raise exception 'Informe um valor de desconto válido';
  end if;
  if v_kind = 'percent' and (v_value < 1 or v_value > 90) then
    raise exception 'O percentual deve ficar entre 1 e 90';
  end if;
  if v_kind = 'amount' and (v_value < 0.01 or v_value > 5000) then
    raise exception 'O valor fixo deve ficar entre R$ 0,01 e R$ 5.000';
  end if;
  if v_scope not in ('all', 'reference', 'category', 'collection') then
    raise exception 'Escopo de cupom inválido';
  end if;
  if v_scope <> 'all' and (v_target is null or v_target = '') then
    raise exception 'Informe o alvo do desconto (referência, categoria ou coleção)';
  end if;
  if v_scope = 'all' then
    v_target := null;
  end if;
  if v_starts is not null and v_ends is not null and v_ends <= v_starts then
    raise exception 'A data de expiração precisa ser depois da data inicial';
  end if;

  if v_id is null then
    if exists (select 1 from public.discount_coupons where code = v_code) then
      raise exception 'Já existe um cupom com este código';
    end if;
    insert into public.discount_coupons (
      code, kind, value, scope, target, active, starts_at, ends_at, created_by
    ) values (
      v_code, v_kind, v_value, v_scope, v_target, false, v_starts, v_ends, auth.uid()
    ) returning id into v_id;
  else
    if exists (select 1 from public.discount_coupons where code = v_code and id <> v_id) then
      raise exception 'Já existe um cupom com este código';
    end if;
    update public.discount_coupons set
      code = v_code,
      kind = v_kind,
      value = v_value,
      scope = v_scope,
      target = v_target,
      starts_at = v_starts,
      ends_at = v_ends
    where id = v_id;
    if not found then
      raise exception 'Cupom não encontrado';
    end if;
  end if;

  if v_want_active then
    perform public.set_discount_coupon_active(v_id, true);
  end if;

  return jsonb_build_object('id', v_id, 'code', v_code, 'active', v_want_active);
end;
$$;

-- Ativa ou desativa um cupom sem tocar nos demais.
create or replace function public.set_discount_coupon_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar cupons';
  end if;

  update public.discount_coupons set active = p_active
  where id = p_id;

  if not found then
    raise exception 'Cupom não encontrado';
  end if;

  return jsonb_build_object('id', p_id, 'active', p_active);
end;
$$;

create or replace function public.delete_discount_coupon(p_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar cupons';
  end if;

  delete from public.discount_coupons where id = p_id;

  if not found then
    raise exception 'Cupom não encontrado';
  end if;

  return jsonb_build_object('id', p_id, 'deleted', true);
end;
$$;

-- Consulta pública usada pelo carrinho do site: devolve apenas os dados
-- de apresentação de um cupom ativo e dentro da janela de datas. Não
-- existe listagem anônima — só código por código, digitado pelo cliente.
create or replace function public.check_discount_coupon(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_coupon public.discount_coupons%rowtype;
begin
  select * into v_coupon
  from public.discount_coupons
  where code = upper(trim(coalesce(p_code, '')));

  if not found or not v_coupon.active then
    return jsonb_build_object('found', false);
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return jsonb_build_object('found', false);
  end if;
  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'code', v_coupon.code,
    'kind', v_coupon.kind,
    'value', v_coupon.value,
    'scope', v_coupon.scope,
    'target', v_coupon.target
  );
end;
$$;

-- =====================================================================
-- Permissões
-- =====================================================================

grant select on public.discount_coupons to authenticated;
grant execute on function
  public.save_discount_coupon(jsonb),
  public.set_discount_coupon_active(uuid, boolean),
  public.delete_discount_coupon(uuid),
  public.check_discount_coupon(text)
to authenticated;
grant execute on function public.check_discount_coupon(text) to anon;
revoke all on function
  public.save_discount_coupon(jsonb),
  public.set_discount_coupon_active(uuid, boolean),
  public.delete_discount_coupon(uuid)
from public, anon;
