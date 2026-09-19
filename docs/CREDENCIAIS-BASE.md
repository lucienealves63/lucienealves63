# Credenciais da base — passo a passo (bloco "Base — Agora")

Guia de execução da **seção 1** de [`docs/CREDENCIAIS.md`](CREDENCIAIS.md): as
seis coisas que precisam existir antes de o site e o painel falarem com o
ambiente real.

| # | Item | Onde nasce | Onde entra |
| --- | --- | --- | --- |
| 1 | `SUPABASE_URL` | Supabase → Project Settings → API | `.env.local`, `admin/assets/config.js`, `assets/js/site-config.js`, Supabase Secrets |
| 2 | `SUPABASE_ANON_KEY` | mesma tela (chave **publicável**) | `.env.local`, `config.js`, `site-config.js` |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | mesma tela (chave **secreta**) | `.env.local` e **só** Supabase Secrets |
| 4 | `INTEGRATION_WORKER_SECRET` (senha do agendador) | gerada por você | Supabase Secrets **e** Vault |
| 5 | `PUBLIC_APP_ORIGIN` / `PUBLIC_SITE_URL` (domínio público) | GitHub Pages ou domínio próprio | `.env.local` + Supabase Secrets |
| 6 | `GOOGLE_MERCHANT_FEED_TOKEN` (token do feed) | gerada por você | Supabase Secrets + URL cadastrada no Merchant Center |
| 7 | Primeiro usuário `admin` | Supabase → Authentication | `public.profiles` (SQL de `supabase/setup/`) |

> **Regra de ouro:** segredo nunca vai para o Git nem para o navegador. O único
> lugar deles é o Supabase (Secrets e Vault) e o seu `.env.local` — arquivo
> local, ignorado pelo Git. URL e anon key **são públicas** (o acesso é
> protegido por RLS) e podem ser commitadas.

Tempo estimado: **40 a 60 minutos**, quase todo no painel do Supabase.

---

## O que este repositório já faz por você

| Ferramenta | Para quê |
| --- | --- |
| `scripts/credenciais-base.sh gerar` | cria o `.env.local` (cópia de `.env.example`, modo 600) e gera a senha do agendador e o token do feed (`openssl rand -hex 32`) |
| `scripts/credenciais-base.sh status` | mostra o que está preenchido e o que falta, item por item |
| `scripts/credenciais-base.sh comandos` | imprime prontos: `supabase secrets set …`, `supabase functions deploy …`, URL do feed e o `curl` de teste |
| `scripts/credenciais-base.sh aplicar-config` | grava URL + anon key em `admin/assets/config.js` e `assets/js/site-config.js` e liga o modo `"supabase"` (recusa chave de servidor) |
| `scripts/credenciais-base.sh rotacionar` | troca os dois segredos gerados |
| `scripts/auditoria-segredos.sh` | varre os arquivos que iriam para o Git atrás de `sb_secret_`, JWT de `service_role`, chave privada e qualquer segredo do `.env.local` |
| `supabase/setup/00_pre_requisitos.sql` | habilita `pg_cron`/`pg_net`/Vault e define `app.settings.supabase_url` **antes** das migrations |
| `supabase/setup/01_vault_worker_secret.sql` | grava `INTEGRATION_WORKER_SECRET` no Vault (é de lá que o `pg_cron` lê) |
| `supabase/setup/02_primeiro_admin.sql` | promove o primeiro usuário ao papel `admin` |
| `supabase/setup/03_checagem_base.sql` | conferência final: extensões, agendamentos, Vault, admins, canais, estoque central |

Nada disso exige dependência: `bash`, `git`, `openssl` (já vem no Linux/macOS)
e, opcional, o [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
para publicar as Edge Functions.

---

## Passo 1 — Criar o projeto Supabase

1. <https://supabase.com> → **Start your project** → entre com a conta GitHub
   da titular (`lucienealves63`).
2. **New project**:
   - *Name*: `censura18-operacoes` (o mesmo `project_id` de `supabase/config.toml`);
   - *Database Password*: **gerar uma forte e guardar** — ela só serve para
     conexões diretas (psql/CLI), nunca entra no site;
   - *Region*: **South America (São Paulo)** — menos latência para a loja, o
     painel e os clientes da Baixada;
   - *Plan*: Free para homologar; o projeto gratuito é **pausado após 7 dias
     sem atividade** (basta restaurar) — em produção, use o plano Pro.
3. Aguarde ~2 minutos e anote a **referência do projeto** (o `abcdefghijk` de
   `https://abcdefghijk.supabase.co`): ela aparece em Project Settings →
   General e é usada pelo CLI (`supabase link --project-ref …`).
4. Guarde a senha do banco no seu arquivo local (não vai para o Git):

   ```bash
   scripts/credenciais-base.sh gerar   # cria o .env.local já no modo 600
   ```

   Abra o `.env.local` num editor e preencha a linha `SUPABASE_DB_PASSWORD=`.
   Nenhuma função usa essa senha — ela serve só para você conectar pelo psql ou
   pelo CLI.

## Passo 2 — As três chaves do Supabase

**Project Settings → API Keys.** Desde 2025 o Supabase entrega dois formatos;
use o que o seu projeto mostrar:

| Formato | Nome na tela | Entra em |
| --- | --- | --- |
| Novo (projetos criados a partir de nov/2025) | `sb_publishable_…` (**Publishable**) | `SUPABASE_ANON_KEY` |
| Novo | `sb_secret_…` (**Secret**) | `SUPABASE_SERVICE_ROLE_KEY` |
| Legado (JWT, aba *Legacy*) | `anon` `public` | `SUPABASE_ANON_KEY` |
| Legado (JWT, aba *Legacy*) | `service_role` | `SUPABASE_SERVICE_ROLE_KEY` |

Os nomes das variáveis no código continuam os mesmos — o `supabase-js` aceita
os dois formatos. **Projetos novos só têm as chaves `sb_…`**; as legadas serão
removidas pelo Supabase no fim de 2026.

Copie as três para o `.env.local` (o script nunca envia nada para lugar
nenhum):

```bash
# edite .env.local num editor de texto e preencha:
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

> ⚠️ **A chave secreta (`sb_secret_` / `service_role`) ignora o RLS**: com ela
> na mão, qualquer pessoa lê e escreve tudo (pedidos, clientes, estoque). Ela
> mora **somente** em Supabase → Secrets e no seu `.env.local`. O GitHub tem
> *secret scanning* para chaves do Supabase: se uma entrar num commit público,
> o Supabase é avisado e **revoga** a chave — o site cai na hora.

## Passo 3 — Senha do agendador e token do feed

Esses dois valores **você mesma gera** (não vêm de conta nenhuma):

```bash
scripts/credenciais-base.sh gerar
scripts/credenciais-base.sh status --mostrar
```

O script grava no `.env.local`:

- `INTEGRATION_WORKER_SECRET` — autoriza o agendador (`pg_cron` → `pg_net`) a
  chamar `integration-worker`, `marketing-events`, `channel-publish` e
  `google-ads-conversions` com o cabeçalho `x-worker-secret`;
- `GOOGLE_MERCHANT_FEED_TOKEN` — protege a URL que o Google Merchant Center
  busca (`?token=…`).

Equivalente manual, se preferir: `openssl rand -hex 32` (64 caracteres) para
cada um — **dois valores diferentes**.

**Rotação** (suspeita de vazamento, funcionário saiu, rotina semestral):

```bash
scripts/credenciais-base.sh rotacionar
```

e atualize os três lugares: Supabase Secrets, Vault
(`supabase/setup/01_vault_worker_secret.sql`) e a URL do feed no Merchant
Center. Depois republique as funções.

## Passo 4 — Domínio público

Duas variáveis, **o mesmo endereço** (sem barra no fim):

| Variável | Para quê |
| --- | --- |
| `PUBLIC_APP_ORIGIN` | CORS das Edge Functions (`_shared/cors.ts`). Vazia, o CORS fica `*` — aceita qualquer origem. |
| `PUBLIC_SITE_URL` | Links dos produtos no feed do Google, `event_source_url` da Meta e URLs do catálogo. Vazia, as funções caem em `https://censura18.com.br`. |

Enquanto o domínio próprio não está contratado, use o endereço real do GitHub
Pages:

```bash
PUBLIC_APP_ORIGIN=https://lucienealves63.github.io/lucienealves63
PUBLIC_SITE_URL=https://lucienealves63.github.io/lucienealves63
```

Quando o `censura18.com.br` existir (**Settings → Pages → Custom domain** +
`CNAME` no DNS apontando para `lucienealves63.github.io` + **Enforce HTTPS**):

1. troque as duas variáveis no `.env.local` e no Supabase Secrets;
2. republique as Edge Functions (o CORS é lido no boot);
3. **recadastre a URL do feed** no Merchant Center (o domínio dos links mudou);
4. verifique o domínio novo em Meta → Segurança da marca e no Search Console;
5. rode `node --test tests/*.test.js` — os testes não dependem do domínio, mas
   é a confirmação barata de que nada quebrou.

> Deixar `PUBLIC_SITE_URL` vazia não derruba nada, mas o Google recebe links
> apontando para um domínio que ainda não é o seu — e reprova o catálogo na
> revisão. Preencha antes de cadastrar o feed.

## Passo 5 — Banco: extensões, URL e migrations

Ordem importa: os agendamentos só são criados se `pg_cron`, `pg_net`, o Vault e
a URL do projeto já existirem quando a migration roda.

1. **SQL Editor → New query** → cole `supabase/setup/00_pre_requisitos.sql`,
   troque a URL do projeto na linha marcada e execute. Espere os `NOTICE` de
   `pg_cron`, `pg_net` e Vault.
   > Se o SQL Editor recusar uma extensão, habilite em **Database → Extensions**
   > e rode o arquivo de novo.
2. **Abra uma nova query** (a configuração `app.settings.supabase_url` só vale
   para conexões novas) e rode as 13 migrations **na ordem do nome do arquivo**:

   ```
   supabase/migrations/202609170001_operations.sql
   supabase/migrations/202609170002_banners_paletas.sql
   supabase/migrations/202609180001_gift_cards.sql
   supabase/migrations/202609180002_discount_coupons.sql
   supabase/migrations/202609180003_category_banners.sql
   supabase/migrations/202609180004_analytics_audience.sql
   supabase/migrations/202609180005_sales_channels.sql
   supabase/migrations/202609180006_growth_schedules.sql
   supabase/migrations/202609190001_customers.sql
   supabase/migrations/202609190002_checkout_pagamentos.sql
   supabase/migrations/202609200001_hero_stats.sql
   supabase/migrations/202609210001_audiencia_banners_google_ads.sql
   supabase/migrations/202609210002_estoque_central_ecommerce.sql
   ```

   Com o CLI fica mais curto (e guarda o histórico no projeto):

   ```bash
   supabase link --project-ref SEU-REF
   supabase db push
   ```

3. Se aparecer `NOTICE: pg_cron não está habilitado…` ou `pg_net, Vault ou
   app.settings.supabase_url indisponíveis`, volte ao item 1, resolva e rode
   **de novo** as duas migrations de agendamento
   (`202609180006_growth_schedules.sql` e
   `202609210001_audiencia_banners_google_ads.sql`): `cron.schedule` substitui
   o agendamento de mesmo nome, então repetir é seguro.

## Passo 6 — Segredos no Supabase (Secrets **e** Vault)

```bash
scripts/credenciais-base.sh comandos     # imprime a linha pronta para colar
```

O bloco 1 sai assim (com os seus valores reais):

```bash
supabase secrets set \
  SUPABASE_URL='https://SEU-PROJETO.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='sb_secret_...' \
  INTEGRATION_WORKER_SECRET='64-caracteres-hex' \
  GOOGLE_MERCHANT_FEED_TOKEN='outros-64-hex' \
  PUBLIC_APP_ORIGIN='https://lucienealves63.github.io/lucienealves63' \
  PUBLIC_SITE_URL='https://lucienealves63.github.io/lucienealves63'
```

Sem CLI: **Project Settings → Edge Functions → Secrets → Add new secret**, um
por um, com os mesmos nomes de `.env.example`.

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são
> **segredos reservados**: o Supabase já injeta os três em toda Edge Function.
> Se o painel/CLI recusar alterá-los ("reserved secret"), está certo — confira
> apenas se o valor bate com Project Settings → API Keys.

Depois, o **Vault** (cópia da senha do agendador, porque é de lá que o
`pg_cron` lê no momento da execução, sem gravar segredo em `cron.job`):

1. abra `supabase/setup/01_vault_worker_secret.sql` no SQL Editor;
2. cole o valor de `INTEGRATION_WORKER_SECRET` na linha marcada;
3. execute — o bloco final confirma o tamanho (64) e lista os agendamentos.

**Toda vez que um segredo muda, republique a função** (passo 7): o valor é lido
no boot.

## Passo 7 — Publicar as Edge Functions

```bash
supabase functions deploy gerar-banner
supabase functions deploy integration-worker
supabase functions deploy clearsale-webhook
supabase functions deploy cotar-frete
supabase functions deploy google-merchant-feed
supabase functions deploy marketing-events
supabase functions deploy google-ads-conversions
supabase functions deploy channel-publish
```

`supabase/config.toml` já traz **`verify_jwt = false` para todas**. Não é
descuido:

- o verificador de JWT do Supabase só entende JWT assinado com o segredo
  legado — as chaves novas (`sb_publishable_`/`sb_secret_`) **não são JWT** e
  morrem em `401 Invalid JWT` antes de chegar ao código;
- a coleta do Google Merchant Center não manda cabeçalho `Authorization`
  nenhum, só o `?token=`;
- cada função se autentica sozinha: sessão do painel com papel `admin`
  (`requireAdmin`), `x-worker-secret` (agendador), `?token=` (feed) ou
  `clearsale-apikey` (webhook). Sem o segredo certo, a resposta é 401/403 do
  próprio código.

Se uma função for publicada por fora do repositório (sem ler o `config.toml`),
use a bandeira equivalente: `supabase functions deploy NOME --no-verify-jwt`.

## Passo 8 — Primeiro usuário `admin`

1. **Authentication → Providers → Email**: deixe *Enable Email provider*
   ligado. Para não depender de caixa de e-mail nesta etapa, marque **Auto
   Confirm User** ao criar o usuário.
2. **Authentication → URL Configuration**: *Site URL* = domínio público do
   passo 4; em *Redirect URLs* adicione o mesmo endereço e
   `https://lucienealves63.github.io/lucienealves63/**`. É o que faz o "esqueci
   minha senha" voltar para o lugar certo.
3. **Authentication → Users → Add user** → e-mail da titular + senha forte
   (guarde-a no seu gerenciador; ela **não** vai para o `.env.local`).
4. No SQL Editor, rode `supabase/setup/02_primeiro_admin.sql` depois de trocar
   o e-mail na linha marcada. O bloco promove o perfil a `admin` e reclama se o
   usuário não existir ou se o projeto ficar sem nenhum admin ativo.
5. Os demais papéis (`inventory`, `checker`, `shipping`, `viewer`) vêm no fim
   do mesmo arquivo: cada pessoa da equipe entra como `viewer` e é promovida
   quando precisar.

## Passo 9 — Ligar o site e o painel

```bash
scripts/credenciais-base.sh aplicar-config
```

O script grava URL + anon key e troca o modo nos dois arquivos:

- `admin/assets/config.js` → `mode: "supabase"` (o painel passa a exigir login
  e a ler/escrever no banco, com os papéis `admin`/`inventory`/…);
- `assets/js/site-config.js` → `mode: "supabase"` (a home e o catálogo passam a
  buscar banners, paleta e números do hero no banco).

Ele **recusa** gravar uma chave de servidor nesses arquivos (se você colar
`sb_secret_…` ou um JWT de `service_role` no lugar da anon key, nada é
alterado). Para voltar ao modo demonstração:

```bash
scripts/credenciais-base.sh reverter-config
```

Depois disso, `git add admin/assets/config.js assets/js/site-config.js && git
commit` está liberado — são valores públicos. Antes de qualquer push, rode:

```bash
scripts/auditoria-segredos.sh
node --test tests/*.test.js
```

## Passo 10 — Conferir se ficou de pé

1. **SQL Editor**: `supabase/setup/03_checagem_base.sql`. Esperado:
   3 extensões · URL do projeto sem "SEU-PROJETO" · **5 agendamentos**
   (`c18-analytics-purge`, `c18-marketing-events-flush`, `c18-channel-publish`,
   `c18-integration-worker`, `c18-google-ads-conversions`) ·
   `INTEGRATION_WORKER_SECRET` com 64 caracteres no Vault · 1 admin ativo ·
   9 canais semeados · `ECOMMERCE-C18` como loja do estoque central.
2. **Terminal**:

   ```bash
   scripts/credenciais-base.sh status
   scripts/auditoria-segredos.sh

   # feed do Google (esperado: XML 200 e o cabeçalho X-C18-Items)
   curl -sS -D - -o /dev/null "$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2)/functions/v1/google-merchant-feed?token=$(grep '^GOOGLE_MERCHANT_FEED_TOKEN=' .env.local | cut -d= -f2)"

   # token errado deve responder 401
   curl -sS -o /dev/null -w '%{http_code}\n' "…/functions/v1/google-merchant-feed?token=errado"

   # agendador (esperado: 200 com a fila vazia)
   curl -sS -X POST "…/functions/v1/integration-worker" -H "x-worker-secret: $(grep '^INTEGRATION_WORKER_SECRET=' .env.local | cut -d= -f2)"
   ```

3. **Navegador**: abra `https://lucienealves63.github.io/lucienealves63/admin/`,
   entre com o usuário do passo 8 e confira se Audiência, Canais & Marketing e
   Banners & Paleta carregam dados do banco. Botões *Testar conexão* e
   *Publicar catálogo (simulação)* devem responder — se vier "Sessão inválida",
   veja a tabela abaixo.

---

## Quando algo não responde

| Sintoma | Causa provável | Correção |
| --- | --- | --- |
| `401 {"msg":"Invalid JWT"}` em qualquer função | função publicada com `verify_jwt` ligado (chaves novas não são JWT) | `supabase functions deploy NOME` a partir do repositório (o `config.toml` já desliga) |
| `401 Token de feed inválido` | `GOOGLE_MERCHANT_FEED_TOKEN` ausente ou função não republicada depois do segredo | cadastre o segredo e republique `google-merchant-feed` |
| Painel: "Sessão inválida ou expirada" | usuário sem login, `mode: "demo"` no `config.js`, ou sessão expirada | `aplicar-config`, entre de novo no `/admin` |
| Painel: "Papel sem permissão para operar canais" | perfil ainda `viewer` | rode `supabase/setup/02_primeiro_admin.sql` |
| `cron.job` vazio | `00_pre_requisitos.sql` rodou **depois** das migrations | habilite as extensões, defina a URL e rode de novo as duas migrations de agendamento |
| Agendamento roda e dá erro de conexão | segredo ausente no **Vault** (o `pg_cron` lê de lá, não dos Secrets) | `supabase/setup/01_vault_worker_secret.sql` |
| CLI: "reserved secret" ao definir `SUPABASE_URL`/`SERVICE_ROLE_KEY` | esses três já vêm injetados pelo Supabase | pule; confira o valor em Settings → API Keys |
| CORS bloqueia o painel no navegador | `PUBLIC_APP_ORIGIN` diferente do endereço aberto | iguale ao domínio público e republique as funções |
| `git status` mostra `.env.local` | `.gitignore` modificado | restaure a seção de segredos do `.gitignore` e rode a auditoria |

## Manutenção

- **Antes de cada push**: `scripts/auditoria-segredos.sh` (sai com código 1 se
  achar segredo).
- **Nunca** cole chave no chat, no print, no commit ou no código do site.
- **Rotacione** a senha do agendador e o token do feed a cada 6 meses, ou
  imediatamente se alguém de fora teve acesso ao computador/conta.
- **Trocou a chave secreta?** Revogue a antiga no painel (aba *Secret keys* →
  *Revoke*) só depois de republicar as funções com a nova.
- **Menor privilégio**: ninguém da equipe precisa de `admin` para conferir
  pedidos — use `checker`, `shipping`, `inventory`, `viewer`.
- Se um segredo chegar ao histórico do Git: remova com
  [`git filter-repo`](https://github.com/newren/git-filter-repo), rotacione o
  valor e rode a auditoria de novo.

## Checklist do bloco

- [ ] Projeto Supabase criado (região São Paulo) e senha do banco guardada
- [ ] `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`
- [ ] `scripts/credenciais-base.sh gerar` rodado (senha do agendador + token do feed)
- [ ] `supabase/setup/00_pre_requisitos.sql` executado **antes** das migrations
- [ ] 13 migrations executadas na ordem (`supabase db push` ou SQL Editor)
- [ ] Segredos no Supabase Secrets + `INTEGRATION_WORKER_SECRET` no Vault
- [ ] 8 Edge Functions publicadas (`verify_jwt = false` pelo `config.toml`)
- [ ] Primeiro usuário criado no Auth e promovido a `admin`
- [ ] `aplicar-config` rodado: `config.js` e `site-config.js` em modo `supabase`
- [ ] `supabase/setup/03_checagem_base.sql`: 5 agendamentos, Vault, admin, canais
- [ ] `curl` do feed responde 200 e o do agendador responde 200
- [ ] `/admin` abre, entra e mostra dados reais
- [ ] `scripts/auditoria-segredos.sh` e `node --test tests/*.test.js` limpos

Terminou? Siga para as outras seções de
[`docs/CREDENCIAIS.md`](CREDENCIAIS.md) — mídia e medição (Merchant Center,
Meta, GA4, Google Ads) e, quando os contratos saírem, operação e marketplaces.
