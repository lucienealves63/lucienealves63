# Dashboard de operações — Censura 18

## Estado da entrega

A primeira entrega é um **protótipo funcional em modo demonstração** no
endereço `admin/`. Ele permite validar o fluxo e a experiência antes de criar o
projeto Supabase e conectar dados reais.

No modo demonstração, os dados ficam no `localStorage` do navegador. Não devem
ser usados para operar vendas reais. A estrutura SQL, RLS e os conectores de
servidor estão em `supabase/` para a implantação do ambiente de homologação.

Quando `admin/assets/config.js` passa para `mode: "supabase"`, o painel bloqueia
a interface com login por e-mail/senha, consulta o perfil ativo, carrega estoque,
pedidos, recebimentos e integrações permitidas e aplica as funções `admin`,
`inventory`, `checker`, `shipping` e `viewer`. Importações, ajustes manuais,
conferência e avanço de pedidos usam RPCs auditadas. As políticas RLS e RPCs
continuam sendo a autorização definitiva no servidor; ocultar um botão no
navegador não é tratado como controle de segurança.

## Mapeamento da planilha Alterdata

O relatório enviado possui estas colunas:

| Coluna da planilha | Campo interno | Exibição no site |
| --- | --- | --- |
| `Cód Produto` | `code` / `sku` | Código / Referência |
| `Descrição` | `description` | Produto |
| `Comprador` | `brand` | **Marca** |
| `Coleção` | `collection` | Coleção |
| `Grupo` | `category` | **Categoria** |
| `VAREJO` | `price` | Preço de varejo |
| `Qtd Estoque` | `quantity` | Saldo físico |
| `Cor` | `color` | Cor |
| `Tamanho` | `size` | Tamanho |
| `E-Commerce` | `ecommerce` | Publicação no site |

O código é lido como texto (`raw: false` no SheetJS) para preservar zeros à
esquerda. Se o Excel entregar `Cód Produto` como número, o importador recompõe o
padrão Alterdata de 10 dígitos. Enquanto o Alterdata não fornecer uma coluna específica de
referência, `Cód Produto` também é usado como referência.

A planilha não contém uma coluna de loja. Por isso, a loja de destino é uma
escolha obrigatória no início de cada importação.

## Seleção antes da importação

Depois de ler a planilha, o operador pode:

1. Pesquisar e marcar uma ou mais **coleções** por checkbox; ou
2. Digitar código, referência ou descrição e marcar **referências** específicas.

Antes de confirmar, o dashboard mostra:

- Linhas e referências selecionadas;
- Quantidade de coleções;
- Total de unidades;
- Valor de varejo do saldo;
- Prévia das linhas e alertas de validação.

Em produção, a função SQL `import_inventory_rows` aplica tudo em uma transação,
registra diferenças de saldo e guarda o lote para auditoria.

## Modelo de estoque

- `products`: produto comercial, agrupado por marca + descrição + coleção +
  categoria;
- `product_variants`: SKU do Alterdata, referência, cor e tamanho;
- `inventory_balances`: saldo físico, reservado e disponível por loja;
- `inventory_movements`: razão imutável de entradas e saídas;
- `stock_imports`: lote da planilha, arquivo, usuário, seleção e erros.

O Alterdata será o estoque mestre. O dashboard não deve sobrescrever o ERP sem
um evento rastreável e uma confirmação da integração.

## Fluxo de pedidos

```text
pagamento → antifraude → separação → conferência → pronto → enviado → entregue
```

Um pedido só entra na separação após aprovação da política de pagamento e
antifraude. A conferência é por item e quantidade. A expedição registra
transportadora, etiqueta, rastreio, operador e horário.

O checkout também coleta, de forma opcional, `seller_code` (código do vendedor)
e `coupon_code` (cupom). No fluxo atual por WhatsApp, ambos seguem na mensagem e
o desconto é validado pela loja antes do pagamento — o navegador não inventa
nem aplica percentuais. O modelo de pedidos já possui esses campos e o
`discount_amount` calculado pelo backend para a futura integração de checkout.

## Integrações preparadas

### e.Rede

- OAuth 2.0 em sandbox e produção;
- Cache temporário do access token;
- Criação e consulta de transação;
- Bloqueio de cartão/CVV na outbox e nos logs;
- Credenciais exclusivamente em Supabase Secrets.

Captura, cancelamento, 3DS e tokenização precisam ser homologados com a conta
Rede da empresa antes da ativação produtiva.

### ClearSale

- Login com ApiKey, Client ID e Client Secret;
- Envio, consulta e atualização de pedido;
- Webhook autenticado por `clearsale-apikey`;
- Tradução inicial dos status de aprovação, análise e recusa.

O Device Fingerprint/Mapper será inserido no checkout quando o APP ID de
homologação for fornecido.

### Alterdata Moda / Muven

O adaptador possui endpoints parametrizados para catálogo, estoque e pedidos.
Os caminhos não são fixados no código porque dependem do produto, versão e
contrato habilitado pela Alterdata.

Solicitar à Alterdata:

- Manual da API/webservice da versão instalada;
- URL e base de homologação;
- Autenticação;
- Identificadores de empresas/lojas;
- Consulta incremental de catálogo e saldo;
- Reserva/baixa de estoque;
- Inclusão e atualização de pedidos;
- Política de retentativa e idempotência.

## Banners e paleta (site)

A página **Banners & Paleta** do dashboard controla a identidade da loja
sem deploy:

- **Banners da home** (`site_banners`): arte do hero com título, texto,
  dois CTAs e a **faixa de números de estatística** — até 4 pares
  número/legenda (`stats`, ex.: `{"value":"36","label":"anos de rua"}`),
  aplicados por posição em `#hero-stat-1..4-value/-label`. Campo em branco
  mantém o texto padrão da marca; número com mais de 12 e legenda com mais
  de 40 caracteres são recusados pelo painel e pela função. Cada banner tem
  origem (`upload`, `ai` ou `static`), agendamento (`starts_at`/`ends_at`)
  e prioridade. Só **um banner por posição** fica ativo; ao ativar, os
  demais da posição desativam.
- **Geração por IA** (função `gerar-banner`): o operador descreve o banner
  (prompt), escolhe estilo e proporção e a imagem é gerada no servidor e
  salva no bucket público `banners`. A chave da IA fica em Supabase Secrets;
  o navegador envia apenas o prompt e o JWT da sessão (papel `admin`).
- **Paleta** (`site_palettes`): 8 cores (primária, texto sobre a primária,
  seções escuras, texto nas escuras, fundo da página, texto principal,
  texto secundário e linhas/bordas) que o site aplica em tempo real nas
  variáveis CSS `--brand`, `--brand-contrast`, `--ink-inverse-bg`,
  `--ink-inverse-fg`, `--bg`, `--text`, `--text-muted` e `--line`.
  Ativar uma paleta desativa a anterior; “Restaurar P&B” reaplica o padrão
  preto/branco/cinza da marca.

Como o site consome: `assets/js/site-config.js` (carregado na `index.html`)
busca, com a chave anônima e RLS, **somente** o banner ativo dentro da
janela de datas e a paleta ativa — conteúdo inativo nunca sai do banco.
Em `mode: "static"` (padrão), ele lê do `localStorage` do próprio
navegador: no modo demonstração o `admin/` e a home vivem no mesmo
navegador, então o que o painel ativa aparece na home ao recarregar.
No modo demonstração a geração por IA é simulada (composição local com o
prompt) para o fluxo ser testável sem credenciais.

Implantação específica:

1. Executar a migration `202609170002_banners_paletas.sql`;
2. Cadastrar os segredos `BANNER_AI_PROVIDER`, `STABILITY_API_KEY`
   (ou `OPENAI_API_KEY` + `OPENAI_IMAGE_MODEL`) via Supabase Secrets;
3. Publicar a Edge Function `gerar-banner` (JWT verificado por padrão);
4. Em `assets/js/site-config.js`, preencher `supabaseUrl` e
   `supabaseAnonKey` e trocar `mode` para `"supabase"`.

## Implantação de homologação

1. Criar projeto Supabase na região adequada;
2. Executar `supabase/migrations/202609170001_operations.sql`;
3. Executar `supabase/migrations/202609170002_banners_paletas.sql`
   (banners e paleta), `supabase/migrations/202609180001_gift_cards.sql`
   (cartão presente: emitir, consultar e resgatar saldo por RPC),
   `supabase/migrations/202609180002_discount_coupons.sql` (cupons de
   desconto), `supabase/migrations/202609180003_category_banners.sql`
   (banner de categoria), `202609180004_analytics_audience.sql` (audiência
   do site), `202609180005_sales_channels.sql` (canais de venda, já com os
   8 canais no seed), `202609180006_growth_schedules.sql` (agendamentos),
   `202609190001_customers.sql` (cadastro de clientes com LGPD),
   `202609190002_checkout_pagamentos.sql` (pedidos do checkout e
   pagamentos) e `202609200001_hero_stats.sql` (faixa de números do
   hero);
4. Criar o primeiro usuário e promovê-lo para `admin` pelo SQL Editor;
5. Cadastrar URL e anon key em `admin/assets/config.js`;
6. Cadastrar os segredos de `.env.example` via Supabase Secrets
   (incluindo `BANNER_AI_PROVIDER` e a chave da IA escolhida);
7. Publicar as Edge Functions (`gerar-banner`, `integration-worker`,
   `clearsale-webhook`, `cotar-frete`, `google-merchant-feed`,
   `marketing-events` e `channel-publish`);
8. Conferir os agendamentos criados por `202609180006_growth_schedules.sql`
   (`select jobname, schedule from cron.job`): retenção da audiência todo dia
   1º, `marketing-events` com `{"flush":true}` a cada 15 minutos,
   `channel-publish` a cada 30 minutos e `integration-worker` a cada 5. Se
   `pg_cron`/`pg_net`/Vault não estiverem habilitados, a migration só emite um
   `NOTICE` — nesse caso dispare as funções por fora (POST com o cabeçalho
   `x-worker-secret`) com o mesmo corpo;
9. Guardar `INTEGRATION_WORKER_SECRET` também no **Vault** do Supabase (além
   de Supabase Secrets): é de lá que os agendamentos leem o cabeçalho no
   momento da execução, sem gravar segredo em `cron.job`;
10. Testar importação com cópia anonimizada da planilha;
11. Homologar Alterdata, Rede e ClearSale separadamente;
12. Cadastrar os canais em **Canais & Marketing** (identificadores públicos),
    conferir a prévia do feed e só então habilitar;
13. Cadastrar a URL `…/functions/v1/google-merchant-feed?token=…` como feed
    primário agendado no Merchant Center e enviar o catálogo para revisão;
14. Só então habilitar dados e credenciais de produção.

## Cartão presente

A página pública `cartao-presente.html` vende as faixas de R$ 50 a R$ 500
pelo WhatsApp da marca. No atendimento, a operação usa as RPCs da
migration `202609180001_gift_cards.sql`:

- `issue_gift_card(amount_cents, payload)` — emite o código
  `C18-XXXX-XXXX` (papéis `admin` e `inventory`);
- `check_gift_card(code)` — consulta saldo, status e validade sem resgatar
  (`admin`, `inventory`, `checker`, `shipping`);
- `redeem_gift_card(code, amount_cents?)` — resgata total ou parte do
  saldo e marca `redeemed` quando zera (`admin`, `inventory`, `checker`).

No site, o código entra no campo *Cartão presente* do carrinho e segue na
mensagem do pedido — o saldo nunca é validado no navegador, igual ao cupom.

## Cupons de desconto

O painel (`admin/` → Cupons) cria e gerencia cupons com escopo **loja
toda**, **referência**, **categoria** ou **coleção** — os conceitos da
planilha Alterdata — em percentual (1–90%) ou valor fixo (até R$ 5.000),
com janela de validade e ativar/desativar. A validação compartilhada está
em `assets/js/coupons.js` (usada pelo painel e pelo site).

Como o site consome: o carrinho (`assets/js/app.js`) descreve o desconto
quando o cliente digita um cupom conhecido. No modo demonstração, a lista
de cupons ativos vive em `c18:demo-coupons` no `localStorage` (mesmo
navegador do painel). Com o Supabase ligado, o site consulta **um código
por vez** pela RPC `check_discount_coupon` com a chave anônima — o
navegador nunca recebe a lista inteira. O valor final segue sendo
confirmado pela loja no fechamento do pedido.

No servidor, a migration `202609180002_discount_coupons.sql` cria a tabela
`discount_coupons` (RLS, escrita somente por RPC `security definer`) com:

- `save_discount_coupon(payload)` — cria/atualiza (papel admin);
- `set_discount_coupon_active(id, active)` — liga/desliga sem afetar os
  demais (papel admin);
- `delete_discount_coupon(id)` — exclusão (papel admin);
- `check_discount_coupon(code)` — consulta pública de um código ativo e
  dentro da janela de datas (anon + authenticated).

## Audiência do site

A página **Audiência** do dashboard responde três perguntas: quais páginas
vendem, onde o visitante clica e de onde ele vem. Os números são medidos pelo
próprio site (`assets/js/analytics.js`) — sem Google Tag Manager, sem pixel de
terceiro no modo demonstração.

| Painel | O que mostra |
| --- | --- |
| Métricas do período | sessões, páginas vistas, visitantes, conversões, páginas por sessão, tempo médio, saídas sem interagir, rolagem média — cada uma com o comparativo do período anterior |
| Evolução diária | barras de sessões + linha de páginas vistas (SVG, sem biblioteca) |
| Páginas mais visitadas | barra proporcional, sessões, participação e conversões por página |
| Região de calor | faixas da página (cabeçalho, hero, filtros, grade, rodapé) pintadas por intensidade, grade 12 × 18 de cliques e pontos quentes (elemento clicado) |
| Origem do tráfego | direto, orgânico, social, e-mail, parceiros, pago e campanha UTM (inclusive `gclid`/`fbclid`/`ttclid`), mais sites de referência |
| Jornada | funil visitou → viu produto → adicionou → finalizou → WhatsApp |
| Dispositivos e cidades | participação por tipo de aparelho e cidade informada pelo navegador |
| Rolagem | média e marcos de 25/50/75/100% por página |

Permissões: leitura para `admin` e `viewer` (`requirePermission("audience")`
no painel e `has_role` na RPC).

RPCs da migration `202609180004_analytics_audience.sql`:

- `track_site_events(p_events jsonb)` — escrita anônima **validada**: lote de
  até 40 eventos, tipos e canais em enum, comprimentos limitados, UTM e região
  só com chaves conhecidas, data nunca futura e teto de 120 eventos por sessão
  por minuto. Evento inválido é descartado em silêncio (o visitante não recebe
  erro de rastreamento);
- `audience_report(p_from, p_to, p_path, p_cols, p_rows)` — devolve exatamente
  o formato que `aggregate()` produz no navegador, então o painel tem um único
  código de desenho nos dois modos; inclui `previous` (período imediatamente
  anterior) para o comparativo dos cartões;
- `audience_report_window(...)` — a janela de agregação usada duas vezes
  (período atual e anterior);
- `purge_analytics_events(p_before)` — retenção LGPD (padrão 13 meses, papel
  `admin`).

Privacidade: nenhum IP, `user-agent`, e-mail ou telefone é gravado; o visitante
é um id de sessão aleatório que expira após 30 minutos de inatividade. A
medição só começa depois do aceite no aviso de privacidade
(`assets/js/lgpd.js`) e para por completo com "Só o essencial". A RLS não
libera leitura de `analytics_events` para a chave anônima — só `admin` e
`viewer` autenticados leem, e o agregado sai pela RPC.

No modo demonstração o painel soma os eventos medidos naquele navegador à base
de exemplo (sintética, determinística por *seed*, nunca gravada) e avisa isso
na tela; o botão *Base de exemplo* desliga a simulação para ver só o tráfego
verdadeiro.

## Canais de venda e marketing

A página **Canais & Marketing** agrupa mídia (Google Merchant Center, Meta
Ads), medição (GA4) e os marketplaces mais usados no varejo de moda brasileiro
(Mercado Livre, Shopee, Amazon, Magazine Luiza, Americanas).

Fluxo de publicação:

1. o painel monta a **prévia** do feed com `admin/assets/channels.js`
   (colunas exatas do canal, pendências por item, preço do site × preço do
   canal) e permite o download (XML no Google, TSV na Amazon, CSV nos demais);
2. *Publicar* chama `publish_catalog_to_channel(channel, options)`, que
   recalcula preço e estoque **no banco**, grava `channel_listings` e enfileira
   um job em `integration_outbox` (`service = 'channels'`);
3. a Edge Function `channel-publish` consome a fila e chama a API do provedor
   com os segredos do ambiente, atualizando `external_id`, status e
   `metadata.lastPush` (retentativa com backoff exponencial e `dead_letter`
   após 8 tentativas, igual ao `integration-worker`);
4. `marketing-events` encaminha as conversões do site para a Meta Conversions
   API e o GA4 Measurement Protocol, com `event_id` igual ao do Pixel do
   navegador para a Meta deduplicar.

Política por canal (`sales_channels.config.policy`):

| Campo | Efeito |
| --- | --- |
| `markup` | percentual aplicado sobre o preço de varejo |
| `rounding` | `psychological` (preço termina em `,90`), `cent` ou `none` |
| `stockBuffer` | unidades reservadas por segurança (0 publica o saldo inteiro) |
| `maxPublished` | teto de unidades anunciadas por item |
| `minPrice` | piso de preço do canal |
| `publishOnlyAvailable` | desligado, publica também item sem saldo |

O painel calcula o markup que empata com a comissão de cada canal
(`suggestedMarkup`: 14% de comissão → 16,3% de markup) e mostra o resultado
antes de gravar. As mesmas regras existem nos três lugares, com teste que
compara: `admin/assets/channels.js` (prévia), `supabase/functions/_shared/feeds.ts`
(publicação) e as funções SQL `channel_policy`, `channel_price`,
`channel_stock`, `channel_listing_status` e `channel_listing_problems`.

RPCs da migration `202609180005_sales_channels.sql` (todas papel `admin`):

- `save_sales_channel(p_payload)` — grava identificadores públicos e política;
  recusar habilitar sem os campos obrigatórios do canal
  (`channel_required_fields`);
- `publish_catalog_to_channel(p_channel_id, p_options)` — publica (ou simula
  com `dry_run`) e devolve itens, publicáveis, pendências, preço médio e valor
  publicável;
- `channel_catalog(p_site_url)` — o catálogo agrupado por referência (saldo
  disponível somado entre lojas), que também alimenta o feed quando o canal
  ainda não foi publicado;
- `channel_summary()` — contadores por canal para o cartão do painel.

Edge Functions:

- `google-merchant-feed` — `GET …?token=…[&format=xml|csv]` é a URL de coleta
  primária do Merchant Center; `POST` (sessão admin) faz o push imediato pela
  Content API v2.1. Sem credencial configurada, valida o feed e devolve o
  resumo sem enviar nada;
- `marketing-events` — `{test:true, channel}` (botão de teste do painel),
  `{flush:true}` (agendador) ou `{events:[…]}` (servidor a servidor);
- `channel-publish` — fila de publicação, sem corpo ou `{channel, dryRun}`.

Segredos por canal estão listados em `.env.example` e aparecem no modal de
configuração de cada canal (o painel mostra **quais** segredos existem, nunca
o valor).

## Banner de categoria (site)

A migration `202609180003_category_banners.sql` acrescenta a posição
`category-hero` e a coluna `site_banners.category`:

- `save_site_banner(p_payload)` aceita `category` e exige a categoria quando a
  posição é `category-hero`;
- `set_site_banner_active(id, active)` desativa os demais banners **da mesma
  posição e categoria** (índice único parcial garante um ativo por slot);
- `live_category_banners()` lista as artes no ar (posição `category-hero`,
  ativas e dentro da janela de datas) para `anon` e `authenticated`;
- a política "anon read live banner" continua valendo: a chave anônima só vê
  banner ativo no período.

No site, `produtos.html` mostra a arte quando o visitante filtra a categoria e
`produto.html` quando o produto pertence a ela. É opcional: sem banner ativo, o
contêiner nasce com `hidden` e o layout não muda. No modo demonstração as artes
ficam em `c18:demo-category-banners` (uma por categoria).

## Segurança

- Nunca colocar `service_role`, client secrets, CVV ou número completo de cartão
  no frontend, Git ou planilha;
- RLS habilitado em todas as tabelas operacionais;
- Funções sensíveis validam função do usuário;
- Integrações usam outbox com idempotência e retentativa;
- Segredos de canal (token da CAPI, JSON da conta de serviço Google, chaves de
  marketplace) existem somente em Supabase Secrets: o painel grava
  identificadores públicos e a Edge Function assina as chamadas;
- A URL do feed do Google Merchant é protegida por token
  (`GOOGLE_MERCHANT_FEED_TOKEN`) e devolve apenas itens publicáveis;
- Escrita de audiência é validada e limitada por sessão; leitura só agregada e
  só para `admin`/`viewer`;
- Produção precisa de política de backup, retenção de logs e atendimento à
  LGPD antes do lançamento (retenção de `analytics_events`: 13 meses,
  `purge_analytics_events`).
