-- Censura 18 — cartão presente
-- Executar após 202609170001_operations.sql.
--
-- O site (assets/js/gift-card.js + campo do carrinho em assets/js/app.js)
-- envia o código C18-XXXX-XXXX na mensagem do WhatsApp. O saldo nunca é
-- validado no navegador: a operação consulta e resgata com as RPCs abaixo,
-- sempre antes do pagamento — mesma filosofia do cupom de desconto.

-- =====================================================================
-- Tabela
-- =====================================================================

create type public.gift_card_status as enum ('issued', 'redeemed', 'cancelled');

create table public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^C18-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 100000),
  balance_cents integer not null check (balance_cents >= 0),
  status public.gift_card_status not null default 'issued',
  recipient_name text check (recipient_name is null or char_length(recipient_name) <= 60),
  sender_name text check (sender_name is null or char_length(sender_name) <= 60),
  customer_phone text check (customer_phone is null or char_length(customer_phone) <= 20),
  note text check (note is null or char_length(note) <= 300),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 months',
  redeemed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gift_cards_balance_sane check (balance_cents <= amount_cents)
);

create index gift_cards_status_idx on public.gift_cards (status);

create trigger gift_cards_set_updated_at
  before update on public.gift_cards
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS — a equipe lê; toda escrita passa pelas RPCs (security definer),
-- igual a banners e paletas. A chave anônima não vê cartão nenhum.
-- =====================================================================

alter table public.gift_cards enable row level security;

create policy "team read gift cards"
  on public.gift_cards for select
  to authenticated
  using (
    public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[])
  );

-- =====================================================================
-- RPCs
-- =====================================================================

-- Emitir um cartão presente. O código nasce de bytes aleatórios no
-- formato C18-XXXX-XXXX e a coluna unique garante a retries em colisão.
create or replace function public.issue_gift_card(
  p_amount_cents integer,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_amount integer;
  v_recipient text;
  v_sender text;
  v_phone text;
  v_note text;
  v_code text;
  v_id uuid;
  v_attempts integer := 0;
begin
  if not public.has_role(array['admin', 'inventory']::public.app_role[]) then
    raise exception 'Sem permissão para emitir cartão presente';
  end if;

  v_amount := p_amount_cents;
  if v_amount is null or v_amount <= 0 or v_amount > 100000 or v_amount % 100 <> 0 then
    raise exception 'Valor do cartão presente inválido (usar centavos, múltiplo de R$ 1)';
  end if;

  v_recipient := nullif(trim(coalesce(p_payload ->> 'recipient_name', '')), '');
  v_sender := nullif(trim(coalesce(p_payload ->> 'sender_name', '')), '');
  v_phone := nullif(trim(coalesce(p_payload ->> 'customer_phone', '')), '');
  v_note := nullif(trim(coalesce(p_payload ->> 'note', '')), '');

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 5 then
      raise exception 'Não foi possível gerar um código único';
    end if;

    v_code := 'C18-'
      || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 4))
      || '-'
      || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 4));

    begin
      insert into public.gift_cards (
        code, amount_cents, balance_cents,
        recipient_name, sender_name, customer_phone, note, created_by
      ) values (
        v_code, v_amount, v_amount,
        v_recipient, v_sender, v_phone, v_note, auth.uid()
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      /* colisão de código: improvável — tenta outro */
    end;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code, 'balance_cents', v_amount);
end;
$$;

-- Consultar saldo sem resgatar (usado no atendimento do WhatsApp).
create or replace function public.check_gift_card(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
begin
  if not public.has_role(array['admin', 'inventory', 'checker', 'shipping']::public.app_role[]) then
    raise exception 'Sem permissão para consultar cartão presente';
  end if;

  select * into v_card
  from public.gift_cards
  where code = upper(trim(coalesce(p_code, '')));

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'code', v_card.code,
    'amount_cents', v_card.amount_cents,
    'balance_cents', v_card.balance_cents,
    'status', v_card.status,
    'expires_at', v_card.expires_at
  );
end;
$$;

-- Resgatar total ou parte do saldo. Sem valor informado, usa todo o
-- saldo restante; cartão que zera muda de status para 'redeemed'.
create or replace function public.redeem_gift_card(
  p_code text,
  p_amount_cents integer default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_card public.gift_cards%rowtype;
  v_amount integer;
begin
  if not public.has_role(array['admin', 'inventory', 'checker']::public.app_role[]) then
    raise exception 'Sem permissão para resgatar cartão presente';
  end if;

  select * into v_card
  from public.gift_cards
  where code = upper(trim(coalesce(p_code, '')));

  if not found then
    raise exception 'Cartão presente não encontrado';
  end if;
  if v_card.status = 'cancelled' then
    raise exception 'Cartão presente cancelado';
  end if;
  if v_card.status = 'redeemed' or v_card.balance_cents = 0 then
    raise exception 'Cartão presente já resgatado';
  end if;
  if now() > v_card.expires_at then
    raise exception 'Cartão presente expirado em %', to_char(v_card.expires_at, 'DD/MM/YYYY');
  end if;

  v_amount := coalesce(p_amount_cents, v_card.balance_cents);
  if v_amount <= 0 or v_amount > v_card.balance_cents then
    raise exception 'Valor a resgatar maior que o saldo disponível';
  end if;

  update public.gift_cards set
    balance_cents = balance_cents - v_amount,
    status = case when balance_cents - v_amount = 0 then 'redeemed' else status end,
    redeemed_at = case when balance_cents - v_amount = 0 then now() else redeemed_at end
  where id = v_card.id
  returning * into v_card;

  return jsonb_build_object(
    'code', v_card.code,
    'applied_cents', v_amount,
    'balance_cents', v_card.balance_cents,
    'status', v_card.status
  );
end;
$$;

-- =====================================================================
-- Permissões
-- =====================================================================

grant select on public.gift_cards to authenticated;
grant execute on function
  public.issue_gift_card(integer, jsonb),
  public.check_gift_card(text),
  public.redeem_gift_card(text, integer)
to authenticated;
revoke all on function
  public.issue_gift_card(integer, jsonb),
  public.check_gift_card(text),
  public.redeem_gift_card(text, integer)
from public, anon;
