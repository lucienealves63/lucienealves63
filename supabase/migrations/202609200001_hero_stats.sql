-- Censura 18 — números de estatística do hero 100% editáveis no painel
-- Executar após 202609170002_banners_paletas.sql.
--
-- O banner da home ganha uma lista de até 4 pares número/legenda, que o
-- site (assets/js/site-config.js) aplica por posição na faixa abaixo dos
-- botões do hero (index.html → #hero-stat-1..4-value/-label):
--
--   "stats": [ { "value": "36", "label": "anos de rua" }, ... ]
--
-- Item em branco é ignorado pelo site, que segue com o texto padrão da
-- marca — o painel não precisa reenviar a faixa em todo banner.

-- =====================================================================
-- Coluna nova
-- =====================================================================

alter table public.site_banners
  add column if not exists stats jsonb not null default '[]'::jsonb;

-- Mesmo formato do formulário: lista, no máximo 4 itens.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_banners_stats_shape'
  ) then
    alter table public.site_banners
      add constraint site_banners_stats_shape
      check (jsonb_typeof(stats) = 'array' and jsonb_array_length(stats) <= 4);
  end if;
end
$$;

-- =====================================================================
-- save_site_banner: passa a aceitar/validar a faixa de números
-- (mantém o restante do contrato do painel — papéis, datas e ativação)
-- =====================================================================

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
  v_stats jsonb;
  v_clean_stats jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_value text;
  v_item_label text;
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

  -- Números de estatística do hero: lista de objetos {value, label}.
  -- Itens totalmente vazios são descartados; os preenchidos são validados
  -- (tipos, limites de caracteres e até 4 posições).
  v_stats := coalesce(p_payload -> 'stats', '[]'::jsonb);
  if jsonb_typeof(v_stats) <> 'array' then
    raise exception 'A lista de números do hero precisa ser uma lista';
  end if;
  if jsonb_array_length(v_stats) > 4 then
    raise exception 'O hero aceita no máximo 4 números de estatística';
  end if;

  for v_item in select * from jsonb_array_elements(v_stats)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Cada número do hero precisa ser um par número/legenda';
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_item) as key
      where key not in ('value', 'label')
    ) then
      raise exception 'Campo não reconhecido nos números do hero';
    end if;

    v_item_value := trim(coalesce(v_item ->> 'value', ''));
    v_item_label := trim(coalesce(v_item ->> 'label', ''));
    if char_length(v_item_value) > 12 then
      raise exception 'O número do hero aceita no máximo 12 caracteres';
    end if;
    if char_length(v_item_label) > 40 then
      raise exception 'A legenda do número aceita no máximo 40 caracteres';
    end if;

    if v_item_value <> '' or v_item_label <> '' then
      v_clean_stats := v_clean_stats || jsonb_build_array(
        jsonb_build_object('value', v_item_value, 'label', v_item_label)
      );
    end if;
  end loop;

  if v_id is null then
    insert into public.site_banners (
      position, name, image_path, title_top, title_bottom, body_text,
      cta_label, cta_url, cta_secondary_label, cta_secondary_url,
      stats, source, ai_prompt, active, priority, starts_at, ends_at, created_by
    ) values (
      v_position, v_name, v_image, v_title_top, v_title_bottom, v_body,
      v_cta_label, v_cta_url, v_cta2_label, v_cta2_url,
      v_clean_stats, v_source, v_prompt, false, v_priority, v_starts, v_ends, auth.uid()
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
      stats = v_clean_stats,
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

  return jsonb_build_object('id', v_id, 'active', v_want_active, 'stats', jsonb_array_length(v_clean_stats));
end;
$$;
