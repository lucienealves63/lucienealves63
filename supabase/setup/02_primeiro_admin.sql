-- =============================================================================
-- Censura 18 — primeiro usuário admin
--
-- O painel (admin/) só deixa operar quem tem papel 'admin' em public.profiles
-- (202609170001_operations.sql). O trigger on_auth_user_created cria o perfil de
-- todo usuário novo como 'viewer'; o primeiro administrador é promovido aqui.
--
-- Antes de rodar:
--   1. Authentication → Users → Add user (e-mail da titular + senha; marque
--      "Auto Confirm User" para não depender do e-mail de confirmação);
--   2. troque o e-mail abaixo.
-- =============================================================================

do $$
declare
  v_email text := 'admin@censura18.com.br';   -- ← TROQUE pelo e-mail criado no Auth
  v_user uuid;
  v_nome text;
begin
  if position('@' in v_email) = 0 then
    raise exception 'Informe um e-mail válido no arquivo (variável v_email).';
  end if;

  select id, coalesce(raw_user_meta_data ->> 'full_name', split_part(v_email, '@', 1))
    into v_user, v_nome
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user is null then
    raise exception 'Usuário % não encontrado em auth.users. Crie em Authentication → Users → Add user e rode de novo.', v_email;
  end if;

  insert into public.profiles (id, full_name, role, active)
  values (v_user, v_nome, 'admin', true)
  on conflict (id) do update
    set role = 'admin', active = true, full_name = coalesce(profiles.full_name, excluded.full_name);

  raise notice 'Usuário % (%) promovido a admin.', v_email, v_user;
end $$;

/* ------------------------------------------------------------- conferência */
select u.email, p.full_name, p.role, p.active, p.created_at
from public.profiles p
join auth.users u on u.id = p.id
order by p.role, u.email;

-- Regra de ouro: nunca deixe o projeto sem pelo menos um admin ativo.
do $$
declare
  v_admins integer;
begin
  select count(*) into v_admins from public.profiles where role = 'admin' and active;
  if v_admins = 0 then
    raise exception 'Nenhum admin ativo: o painel ficaria travado. Rode o bloco acima com o e-mail certo.';
  end if;
  raise notice '% administrador(es) ativo(s).', v_admins;
end $$;

/* -------------------------------------------------------------------------
   Demais pessoas da equipe (opcional, quando o time crescer):
     update public.profiles set role = 'inventory' where id = '<uuid>';  -- estoque
     update public.profiles set role = 'checker'   where id = '<uuid>';  -- conferência
     update public.profiles set role = 'shipping'  where id = '<uuid>';  -- expedição
     update public.profiles set role = 'viewer'    where id = '<uuid>';  -- só leitura
     update public.profiles set active = false     where id = '<uuid>';  -- desligar
   Papéis e o que cada um pode fazer: docs/DASHBOARD-OPERACOES.md.
   ------------------------------------------------------------------------- */
