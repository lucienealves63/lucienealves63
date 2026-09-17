-- Censura 18 — banners da loja e paleta dinâmica
-- Executar após 202609170001_operations.sql.
--
-- O site (assets/js/site-config.js) lê, com a chave anônima:
--   * o banner ativo da posição home-hero dentro da janela de datas;
--   * a paleta ativa (8 cores) para ajustar as variáveis CSS da loja.
-- Toda escrita passa por RPCs abaixo (papel admin) — não há policy de
-- insert/update/delete direta para a equipe.

-- =====================================================================
-- Tabelas
-- =====================================================================

create table public.site_banners (
  id uuid primary key default gen_random_uuid(),
  position text not null default 'home-hero'
    check (position in ('home-hero', 'promo-strip')),
  name text not null default '' check (char_length(name) <= 120),
  image_path text not null check (char_length(image_path) <= 1024),
  title_top text check (title_top is null or char_length(title_top) <= 80),
  title_bottom text check (title_bottom is null or char_length(title_bottom) <= 80),
  body_text text check (body_text is null or char_length(body_text) <= 600),
  cta_label text check (cta_label is null or char_length(cta_label) <= 60),
  cta_url text check (cta_url is null or char_length(cta_url) <= 400),
  cta_secondary_label text check (cta_secondary_label is null or char_length(cta_secondary_label) <= 60),
  cta_secondary_url text check (cta_secondary_url is null or char_length(cta_secondary_url) <= 400),
  source text not null default 'upload' check (source in ('upload', 'ai', 'static')),
  ai_prompt text check (ai_prompt is null or char_length(ai_prompt) <= 1000),
  active boolean not null default false,
  priority integer not null default 100,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index site_banners_visible_idx
  on public.site_banners (position, priority)
  where active = true;

create table public.site_palettes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  colors jsonb not null,
  active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_palettes_complete check (
    jsonb_typeof(colors) = 'object'
    and colors ?& array[
      'primary', 'primaryContrast', 'darkBg', 'darkText',
      'pageBg', 'text', 'muted', 'line'
    ]::text[]
  )
);

create trigger site_banners_set_updated_at
  before update on public.site_banners
  for each row execute function public.set_updated_at();

create trigger site_palettes_set_updated_at
  before update on public.site_palettes
  for each row execute function public.set_updated_at();

-- Validação de cor no formato #RGB / #RRGGBB / #RRGGBBAA.
create or replace function public.is_hex_color(value text)
returns boolean
language sql immutable
as $$
  select value ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
$$;

-- =====================================================================
-- RPCs (somente admin; segurança definer — o navegador nunca escreve
-- direto nas tabelas)
-- =====================================================================

-- Salva ou atualiza um banner. O payload segue o formato enviado pelo
-- painel (id vazio cria). Ativar é feito em duas etapas atômicas:
-- desativa os demais da mesma posição e ativa este.
create or replace function public.save_site_banner(p_payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_position text;
  v_image text;
  v_name text;
  v_source text;
  v_title_top text;
  v_title_bottom text;
  v_body text;
  v_cta_label text;
  v_cta_url text;
  v_cta2_label text;
  v_cta2_url text;
  v_prompt text;
  v_priority integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_want_active boolean;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar banners';
  end if;

  v_id := nullif(trim(coalesce(p_payload ->> 'id', '')), '');
  if v_id is not null and v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Id de banner inválido';
  end if;
  v_id := v_id::uuid;
  v_position := coalesce(nullif(trim(p_payload ->> 'position'), ''), 'home-hero');
  v_image := trim(coalesce(p_payload ->> 'image_path', ''));
  v_name := trim(coalesce(p_payload ->> 'name', ''));
  v_source := coalesce(nullif(trim(p_payload ->> 'source'), ''), 'upload');
  v_title_top := nullif(trim(coalesce(p_payload ->> 'title_top', '')), '');
  v_title_bottom := nullif(trim(coalesce(p_payload ->> 'title_bottom', '')), '');
  v_body := nullif(trim(coalesce(p_payload ->> 'body_text', '')), '');
  v_cta_label := nullif(trim(coalesce(p_payload ->> 'cta_label', '')), '');
  v_cta_url := nullif(trim(coalesce(p_payload ->> 'cta_url', '')), '');
  v_cta2_label := nullif(trim(coalesce(p_payload ->> 'cta_secondary_label', '')), '');
  v_cta2_url := nullif(trim(coalesce(p_payload ->> 'cta_secondary_url', '')), '');
  v_prompt := nullif(trim(coalesce(p_payload ->> 'ai_prompt', '')), '');
  v_priority := coalesce((p_payload ->> 'priority')::integer, 100);
  v_starts := nullif(trim(coalesce(p_payload ->> 'starts_at', '')), '')::timestamptz;
  v_ends := nullif(trim(coalesce(p_payload ->> 'ends_at', '')), '');
  v_want_active := coalesce((p_payload ->> 'active')::boolean, false);

  if v_position not in ('home-hero', 'promo-strip') then
    raise exception 'Posição de banner inválida';
  end if;
  if v_source not in ('upload', 'ai', 'static') then
    raise exception 'Origem de banner inválida';
  end if;
  if v_image = '' then
    raise exception 'A imagem do banner é obrigatória';
  end if;
  if v_name = '' then
    v_name := 'Banner ' || to_char(now(), 'DD/MM HH24:MI');
  end if;
  if v_ends is not null and v_starts is not null and v_ends <= v_starts then
    raise exception 'A data final precisa ser depois da inicial';
  end if;

  if v_id is null then
    insert into public.site_banners (
      position, name, image_path, title_top, title_bottom, body_text,
      cta_label, cta_url, cta_secondary_label, cta_secondary_url,
      source, ai_prompt, active, priority, starts_at, ends_at, created_by
    ) values (
      v_position, v_name, v_image, v_title_top, v_title_bottom, v_body,
      v_cta_label, v_cta_url, v_cta2_label, v_cta2_url,
      v_source, v_prompt, false, v_priority, v_starts, v_ends, auth.uid()
    ) returning id into v_id;
  else
    update public.site_banners set
      position = v_position,
      name = v_name,
      image_path = v_image,
      title_top = v_title_top,
      title_bottom = v_title_bottom,
      body_text = v_body,
      cta_label = v_cta_label,
      cta_url = v_cta_url,
      cta_secondary_label = v_cta2_label,
      cta_secondary_url = v_cta2_url,
      source = v_source,
      ai_prompt = v_prompt,
      priority = v_priority,
      starts_at = v_starts,
      ends_at = v_ends
    where id = v_id;
    if not found then
      raise exception 'Banner não encontrado';
    end if;
  end if;

  if v_want_active then
    perform public.set_site_banner_active(v_id, true);
  end if;

  return jsonb_build_object('id', v_id, 'active', v_want_active);
end;
$$;

-- Ativa um banner desativando os demais da mesma posição.
create or replace function public.set_site_banner_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_banner public.site_banners%rowtype;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar banners';
  end if;

  select * into v_banner from public.site_banners where id = p_id for update;
  if not found then
    raise exception 'Banner não encontrado';
  end if;

  if p_active then
    update public.site_banners
    set active = false
    where position = v_banner.position and active = true and id <> p_id;
    update public.site_banners set active = true where id = p_id;
  else
    update public.site_banners set active = false where id = p_id;
  end if;

  return jsonb_build_object('id', p_id, 'active', p_active, 'position', v_banner.position);
end;
$$;

create or replace function public.delete_site_banner(p_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_banner public.site_banners%rowtype;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar banners';
  end if;

  select * into v_banner from public.site_banners where id = p_id for update;
  if not found then
    raise exception 'Banner não encontrado';
  end if;

  delete from public.site_banners where id = p_id;

  return jsonb_build_object('id', p_id, 'deleted', true);
end;
$$;

-- Cria (e opcionalmente ativa) uma paleta. Ativar desativa a paleta que
-- estava no ar — o site sempre tem no máximo uma paleta ativa.
create or replace function public.save_site_palette(
  p_name text,
  p_colors jsonb,
  p_activate boolean default true
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_pair record;
  v_value text;
  v_clean jsonb := '{}'::jsonb;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar a paleta do site';
  end if;

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'O nome da paleta é obrigatório';
  end if;
  if jsonb_typeof(p_colors) <> 'object' then
    raise exception 'A paleta precisa ser um objeto de cores';
  end if;

  for v_pair in select * from jsonb_each(p_colors)
  loop
    if v_pair.key not in (
      'primary', 'primaryContrast', 'darkBg', 'darkText',
      'pageBg', 'text', 'muted', 'line'
    ) then
      raise exception 'Campo de cor não reconhecido: %', v_pair.key;
    end if;
    v_value := v_pair.value #>> '{}';
    if not public.is_hex_color(v_value) then
      raise exception 'Cor inválida em % (use o formato #RRGGBB)', v_pair.key;
    end if;
    v_clean := v_clean || jsonb_build_object(v_pair.key, v_value);
  end loop;

  if not (v_clean ?& array[
    'primary', 'primaryContrast', 'darkBg', 'darkText',
    'pageBg', 'text', 'muted', 'line'
  ]::text[]) then
    raise exception 'A paleta precisa das 8 cores do formulário';
  end if;

  insert into public.site_palettes (name, colors, active, created_by)
  values (trim(p_name), v_clean, p_activate, auth.uid())
  returning id into v_id;

  if p_activate then
    update public.site_palettes
    set active = false
    where active = true and id <> v_id;
  end if;

  return jsonb_build_object('id', v_id, 'active', p_activate);
end;
$$;

create or replace function public.set_site_palette_active(p_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_palette public.site_palettes%rowtype;
begin
  if not public.has_role(array['admin']::public.app_role[]) then
    raise exception 'Sem permissão para gerenciar a paleta do site';
  end if;

  select * into v_palette from public.site_palettes where id = p_id for update;
  if not found then
    raise exception 'Paleta não encontrada';
  end if;

  update public.site_palettes set active = false where active = true;
  update public.site_palettes set active = true where id = p_id;

  return jsonb_build_object('id', p_id, 'active', true);
end;
$$;

-- =====================================================================
-- RLS e permissões
-- =====================================================================

alter table public.site_banners enable row level security;
alter table public.site_palettes enable row level security;

-- Loja (chave anônima): somente o banner ativo dentro da janela de datas.
create policy "anon read live banner"
  on public.site_banners for select
  to anon, authenticated
  using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- Equipe autenticada: vê todos os banners (inclusive inativos/agendados).
create policy "team read all banners"
  on public.site_banners for select
  to authenticated
  using (
    public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[])
  );

-- Loja: somente a paleta ativa.
create policy "anon read active palette"
  on public.site_palettes for select
  to anon, authenticated
  using (active = true);

-- Equipe autenticada: vê todas as paletas.
create policy "team read all palettes"
  on public.site_palettes for select
  to authenticated
  using (
    public.has_role(array['admin', 'inventory', 'checker', 'shipping', 'viewer']::public.app_role[])
  );

grant select on public.site_banners, public.site_palettes to anon, authenticated;
grant execute on function
  public.save_site_banner(jsonb),
  public.set_site_banner_active(uuid, boolean),
  public.delete_site_banner(uuid),
  public.save_site_palette(text, jsonb, boolean),
  public.set_site_palette_active(uuid)
to authenticated;
revoke all on function
  public.save_site_banner(jsonb),
  public.set_site_banner_active(uuid, boolean),
  public.delete_site_banner(uuid),
  public.save_site_palette(text, jsonb, boolean),
  public.set_site_palette_active(uuid)
from public, anon;

-- =====================================================================
-- Storage: bucket público para as artes dos banners.
-- Upload direto do navegador (sessão autenticada, papel admin); a Edge
-- Function gerar-banner usa a service_role para salvar as imagens da IA.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('banners', 'banners', true)
on conflict (id) do nothing;

create policy "banners public read"
  on storage.objects for select
  using (bucket_id = 'banners');

create policy "banners admin upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'banners'
    and public.has_role(array['admin']::public.app_role[])
  );

create policy "banners admin update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'banners'
    and public.has_role(array['admin']::public.app_role[])
  );

create policy "banners admin delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'banners'
    and public.has_role(array['admin']::public.app_role[])
  );
