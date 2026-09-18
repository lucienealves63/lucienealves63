-- Censura 18 — banner de categoria (opcional)
-- Executar após 202609170002_banners_paletas.sql.
--
-- Além do hero da home, o painel passa a poder criar uma arte para cada
-- categoria do catálogo. Ela é OPCIONAL: sem banner ativo para a
-- categoria, produtos.html e produto.html continuam exatamente como são
-- hoje (o contêiner nasce com hidden).
--
-- Regras:
--   * position aceita 'home-hero', 'category-hero' e 'promo-strip';
--   * 'category-hero' exige category (id do site ou nome do Alterdata);
--   * só um banner ativo por posição E categoria;
--   * a chave anônima continua vendo apenas banners ativos na janela de
--     datas (política "anon read live banner" da migration anterior).

-- =====================================================================
-- Estrutura
-- =====================================================================

alter table public.site_banners
  drop constraint if exists site_banners_position_check;

alter table public.site_banners
  add column if not exists category text
    check (category is null or char_length(category) <= 60);

alter table public.site_banners
  add constraint site_banners_position_check
  check (position in ('home-hero', 'category-hero', 'promo-strip'));

alter table public.site_banners
  add constraint site_banners_category_required
  check (position <> 'category-hero' or (category is not null and trim(category) <> ''));

-- Um único banner ativo por posição/categoria (categoria nula = home).
create unique index if not exists site_banners_one_active_per_slot
  on public.site_banners (position, coalesce(category, ''))
  where active = true;

create index if not exists site_banners_category_idx
  on public.site_banners (category)
  where position = 'category-hero';

-- =====================================================================
-- RPCs (recriadas com o campo categoria)
-- =====================================================================

create or replace function public.save_site_banner(p_payload jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_position text;
  v_category text;
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
  v_category := nullif(trim(coalesce(p_payload ->> 'category', '')), '');
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
  v_ends := nullif(trim(coalesce(p_payload ->> 'ends_at', '')), '')::timestamptz;
  v_want_active := coalesce((p_payload ->> 'active')::boolean, false);

  if v_position not in ('home-hero', 'category-hero', 'promo-strip') then
    raise exception 'Posição de banner inválida';
  end if;
  if v_position = 'category-hero' and v_category is null then
    raise exception 'Informe a categoria do banner (ou escolha outra posição)';
  end if;
  if v_position <> 'category-hero' then
    v_category := null;
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
      position, category, name, image_path, title_top, title_bottom, body_text,
      cta_label, cta_url, cta_secondary_label, cta_secondary_url,
      source, ai_prompt, active, priority, starts_at, ends_at, created_by
    ) values (
      v_position, v_category, v_name, v_image, v_title_top, v_title_bottom, v_body,
      v_cta_label, v_cta_url, v_cta2_label, v_cta2_url,
      v_source, v_prompt, false, v_priority, v_starts, v_ends, auth.uid()
    ) returning id into v_id;
  else
    update public.site_banners set
      position = v_position,
      category = v_category,
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

  return jsonb_build_object('id', v_id, 'active', v_want_active, 'position', v_position, 'category', v_category);
end;
$$;

-- Ativa um banner desativando os demais da mesma posição e categoria.
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
    where position = v_banner.position
      and coalesce(category, '') = coalesce(v_banner.category, '')
      and active = true
      and id <> p_id;
    update public.site_banners set active = true where id = p_id;
  else
    update public.site_banners set active = false where id = p_id;
  end if;

  return jsonb_build_object(
    'id', p_id, 'active', p_active,
    'position', v_banner.position, 'category', v_banner.category
  );
end;
$$;

-- Lista os banners de categoria no ar (usado pelo catálogo quando a RLS
-- já filtrou; mantém a resposta enxuta para a chave anônima).
create or replace function public.live_category_banners()
returns table (
  id uuid,
  category text,
  name text,
  image_path text,
  title_top text,
  title_bottom text,
  body_text text,
  cta_label text,
  cta_url text,
  cta_secondary_label text,
  cta_secondary_url text,
  priority integer,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select b.id, b.category, b.name, b.image_path, b.title_top, b.title_bottom,
         b.body_text, b.cta_label, b.cta_url, b.cta_secondary_label,
         b.cta_secondary_url, b.priority, b.starts_at, b.ends_at
  from public.site_banners b
  where b.position = 'category-hero'
    and b.active = true
    and (b.starts_at is null or b.starts_at <= now())
    and (b.ends_at is null or b.ends_at >= now())
  order by b.priority asc, b.created_at desc;
$$;

grant execute on function public.live_category_banners() to anon, authenticated;
