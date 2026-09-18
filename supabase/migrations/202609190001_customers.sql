-- Censura 18 — cadastro de clientes (contas da loja)
-- Execute depois de 202609180002_discount_coupons.sql.
--
-- O cliente cria a conta na página conta.html (e-mail + senha) via Supabase
-- Auth. Os dados pessoais ficam em public.customers, com RLS: cada cliente
-- vê e edita APENAS o próprio cadastro. A equipe da loja (public.profiles,
-- has_role) pode consultar para separar e expedir pedidos — nunca anônimos.
--
-- LGPD (Lei 13.709/2018): o cadastro só existe com consentimento explícito
-- (aceitou_lgpd), gravado com data/hora. A exclusão pela Lei é feita com
-- anonimização (rpc anonimizar_meu_cadastro) para preservar o histórico
-- fiscal dos pedidos sem manter dados pessoais.

-- --------------------------------------------------------------- tabela
create table public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  telefone text not null default '',
  cep text not null default '',
  rua text not null default '',
  numero text not null default '',
  complemento text not null default '',
  bairro text not null default '',
  cidade text not null default '',
  uf text not null default '',
  aceitou_lgpd boolean not null default false,
  aceitou_lgpd_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index customers_nome_idx on public.customers (lower(nome));
create index customers_telefone_idx on public.customers (telefone);

-- ------------------------------------------------------- trigger signup
-- Cria a linha do cliente quando alguém cria conta pela loja
-- (signUp com raw_user_meta_data { nome, telefone, tipo: 'cliente' }).
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.customers (id, nome, telefone, aceitou_lgpd, aceitou_lgpd_em)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', ''),
    coalesce(new.raw_user_meta_data ->> 'telefone', ''),
    coalesce((new.raw_user_meta_data ->> 'aceitou_lgpd')::boolean, false),
    case when coalesce((new.raw_user_meta_data ->> 'aceitou_lgpd')::boolean, false)
      then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_customer();

-- ------------------------------------------------------- metadados auto
create or replace function public.customers_touch()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.atualizado_em := now();
  if new.aceitou_lgpd and new.aceitou_lgpd_em is null then
    new.aceitou_lgpd_em := now();
  end if;
  if not new.aceitou_lgpd then
    new.aceitou_lgpd_em := null;
  end if;
  return new;
end;
$$;

create trigger customers_touch_trigger
  before update on public.customers
  for each row execute function public.customers_touch();

-- ------------------------------------------------------------------ RLS
alter table public.customers enable row level security;

create policy "cliente le o proprio cadastro"
  on public.customers for select to authenticated
  using (id = auth.uid() or public.has_role(array['admin','checker','shipping','viewer']::public.app_role[]));

create policy "cliente atualiza o proprio cadastro"
  on public.customers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "cliente insere o proprio cadastro"
  on public.customers for insert to authenticated
  with check (id = auth.uid());

-- Sem política de delete: a exclusão LGPD é a anonimização abaixo.

-- ------------------------------------------------------------------ RPC
-- Cliente salva o próprio cadastro (valida consentimento LGPD).
create or replace function public.salvar_meu_cadastro(p_dados jsonb)
returns public.customers
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  registro public.customers;
begin
  if uid is null then
    raise exception 'Entre na sua conta para salvar o cadastro';
  end if;

  insert into public.customers (id) values (uid)
  on conflict (id) do nothing;

  update public.customers set
    nome       := left(coalesce(p_dados ->> 'nome', ''), 80),
    telefone   := left(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), 11),
    cep        := left(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), 8),
    rua        := left(coalesce(p_dados ->> 'rua', ''), 120),
    numero     := left(coalesce(p_dados ->> 'numero', ''), 12),
    complemento := left(coalesce(p_dados ->> 'complemento', ''), 80),
    bairro     := left(coalesce(p_dados ->> 'bairro', ''), 80),
    cidade     := left(coalesce(p_dados ->> 'cidade', ''), 80),
    uf         := left(upper(coalesce(p_dados ->> 'uf', '')), 2),
    aceitou_lgpd := coalesce((p_dados ->> 'aceitou_lgpd')::boolean, false)
  where id = uid
  returning * into registro;

  return registro;
end;
$$;

revoke all on function public.salvar_meu_cadastro(jsonb) from public, anon;
grant execute on function public.salvar_meu_cadastro(jsonb) to authenticated;

-- LGPD: apaga os dados pessoais mantendo o id (histórico de pedidos fica
-- sem identificação). O cliente pede isso pela própria conta.
create or replace function public.anonimizar_meu_cadastro()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Entre na sua conta';
  end if;
  update public.customers set
    nome := '', telefone := '', cep := '', rua := '', numero := '',
    complemento := '', bairro := '', cidade := '', uf := '',
    aceitou_lgpd := false
  where id = uid;
end;
$$;

revoke all on function public.anonimizar_meu_cadastro() from public, anon;
grant execute on function public.anonimizar_meu_cadastro() to authenticated;

-- Equipe busca clientes para separação/expedição (vê só o necessário).
create or replace function public.buscar_clientes(p_termo text)
returns table (
  id uuid,
  nome text,
  email text,
  telefone text,
  cep text,
  cidade text,
  uf text,
  criado_em timestamptz
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  termo text := coalesce(nullif(trim(p_termo), ''), '');
  digitos text := regexp_replace(termo, '\D', '', 'g');
begin
  if not public.has_role(array['admin','inventory','checker','shipping','viewer']::public.app_role[]) then
    raise exception 'Somente a equipe da loja pode consultar clientes';
  end if;

  return query
  select c.id,
         c.nome,
         coalesce(u.email, '') as email,
         c.telefone,
         c.cep,
         c.cidade,
         c.uf,
         c.criado_em
  from public.customers c
  left join auth.users u on u.id = c.id
  where c.aceitou_lgpd  -- conta de cliente de verdade, não perfil de equipe
    and (
      termo = ''
      or c.nome ilike '%' || termo || '%'
      or u.email ilike '%' || termo || '%'
      or (digitos <> '' and c.telefone like '%' || digitos || '%')
      or (digitos = '' and false)
    )
  order by c.criado_em desc
  limit 50;
end;
$$;

revoke all on function public.buscar_clientes(text) from public, anon;
grant execute on function public.buscar_clientes(text) to authenticated;
