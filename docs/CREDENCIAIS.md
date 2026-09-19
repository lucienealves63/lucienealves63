# Credenciais — o que providenciar, onde obter e onde cadastrar

Última etapa antes de ligar o site e o painel ao ambiente real. Nada aqui é
código: são contas, chaves e identificadores que **só a titular das contas**
consegue gerar. Tudo o que está no código já funciona sem credencial (modo
demonstração, prévia de feed, CSV do Google Ads); com a credencial cadastrada,
a integração passa a valer de verdade.

> **Regra de ouro:** segredo nunca vai para o Git nem para o navegador. O único
> lugar deles é **Supabase → Project Settings → Edge Functions → Secrets** (e o
> Vault, para os agendamentos). No painel ficam só identificadores públicos
> (Merchant ID, Pixel ID, ID do cliente…), em **Canais & Marketing →
> Configurar**. O arquivo `.env.example` lista todas as variáveis com o nome
> exato.

## Como cadastrar

| Onde | O quê | Como |
| --- | --- | --- |
| `admin/assets/config.js` | `supabaseUrl` e `supabaseAnonKey`, `mode: "supabase"` | Editar o arquivo e publicar (a anon key pode ficar no cliente: o acesso é protegido por RLS). |
| Supabase Secrets | Todas as variáveis de `.env.example` com valor | Project Settings → Edge Functions → Secrets → *Add new* (ou `supabase secrets set NOME=valor`). Depois **republicar** as Edge Functions para lerem o valor novo. |
| Supabase Vault | `INTEGRATION_WORKER_SECRET` (cópia) | Database → Vault → *New secret* com o mesmo nome. É de lá que o `pg_cron` lê o cabeçalho `x-worker-secret`. |
| Painel → Canais & Marketing → Configurar | Campos públicos de cada canal | Preencher e salvar; habilitar o canal só depois do segredo cadastrado (o painel recusa habilitar sem os campos obrigatórios). |

Legenda de prioridade: **Agora** = necessário para ir ao ar · **Quando ativar**
= a funcionalidade existe, entra quando a empresa contratar/abrir a conta ·
**Futuro** = marketplaces (ainda sem conta de vendedor).

---

## 1. Base — Agora

| Variável / campo | O que é | Onde obter |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Endereço do projeto e chave pública | Supabase → Project Settings → API. Vão também em `admin/assets/config.js`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de servidor (Edge Functions) | Mesma tela (*service_role*). Já fica disponível para as funções; **nunca** no navegador. |
| `INTEGRATION_WORKER_SECRET` | Senha que autoriza o agendador a chamar as funções | Você mesma gera (ex.: `openssl rand -hex 32`). Cadastrar em Secrets **e** no Vault. |
| `PUBLIC_APP_ORIGIN`, `PUBLIC_SITE_URL` | Domínio público do site (CORS, links do feed, `event_source_url` da Meta) | O domínio final do GitHub Pages (ex.: `https://censura18.com.br`). |
| `GOOGLE_MERCHANT_FEED_TOKEN` | Senha da URL de coleta do feed | Você mesma gera (outro `openssl rand -hex 32`). Entra na URL cadastrada no Merchant Center. |
| Primeiro usuário `admin` | Login do painel | Supabase → Authentication → Users → criar; depois promover a `admin` pelo SQL Editor (`docs/DASHBOARD-OPERACOES.md`). |

## 2. Mídia e medição — Agora

### Google Merchant Center (feed de produtos)

| Variável / campo | Onde obter |
| --- | --- |
| `GOOGLE_MERCHANT_ID` · campo `merchant_id` | Número da conta, no canto superior direito do Merchant Center. |
| `GOOGLE_MERCHANT_SERVICE_ACCOUNT_JSON` | Google Cloud Console → IAM e administrador → Contas de serviço → criar conta → *Chaves* → nova chave **JSON** (colar o conteúdo inteiro). No mesmo projeto, ativar a **Content API for Shopping**. Depois, no Merchant Center → Configurações → *Pessoas e acesso*, adicionar o e-mail da conta de serviço como usuário **Administrador**. |
| Campos `country`, `language`, `currency`, `feed_label` | `BR`, `pt-BR`, `BRL`, `BR` (padrões já preenchidos). |
| URL do feed | Merchant Center → Produtos → Feeds → *Adicionar feed* → **Busca programada** com a URL `https://SEU-PROJETO.supabase.co/functions/v1/google-merchant-feed?token=GOOGLE_MERCHANT_FEED_TOKEN`. |

Também exige: site verificado e reivindicado no Merchant Center, páginas de
política (troca, entrega, contato) e os dados da empresa — o Google revisa antes
de aprovar o catálogo.

### Meta Ads (Pixel, Conversions API e catálogo)

| Variável / campo | Onde obter |
| --- | --- |
| `META_PIXEL_ID` · campo `pixel_id` | Gerenciador de Eventos → Fontes de dados → o Pixel (ID numérico). |
| `META_CAPI_ACCESS_TOKEN` | Gerenciador de Eventos → Pixel → Configurações → **API de Conversões** → *Gerar token de acesso*. |
| `META_CATALOG_ID` · campo `catalog_id` | Gerenciador de Comércio (Commerce Manager) → Catálogo → Configurações. Crie um catálogo de **Produtos** vazio; o painel envia os itens. |
| `META_AD_ACCOUNT_ID` · campo `ad_account_id` | Gerenciador de Anúncios → conta (`act_` + número). |
| `META_TEST_EVENT_CODE` · campo `test_event_code` | Gerenciador de Eventos → *Testar eventos* (só enquanto homologa; depois apagar). |
| Campo `verified_domain` | Configurações do Negócio → Segurança da marca → Domínios → verificar `censura18.com.br`. |

### Google Analytics 4 (Measurement Protocol)

| Variável / campo | Onde obter |
| --- | --- |
| `GA4_MEASUREMENT_ID` · campo `measurement_id` | Administrador → Fluxos de dados → fluxo da Web → **ID da métrica** (`G-…`). |
| `GA4_API_SECRET` | Mesma tela → *Segredos da API do Measurement Protocol* → **Criar**. |
| Campo `reporting_view` | ID numérico da propriedade (Administrador → Detalhes da propriedade). |

### Google Ads (vendas de volta ao anúncio)

Enquanto a API não estiver liberada, o painel gera o **CSV de conversões**
(botão *CSV para o Google Ads*) para subir em Objetivos → Conversões →
**Uploads**. Para automatizar:

| Variável / campo | Onde obter |
| --- | --- |
| Campo `customer_id` | Número da conta que anuncia (topo do Google Ads), **só dígitos**, sem hífens. |
| Campo `conversion_name` | Objetivos → Conversões → Resumo → *Nova ação de conversão* → **Importar** → *Outras fontes de dados ou CRMs* → *Acompanhar conversões de cliques*. Nome sugerido: **Compra no site** (é o que o painel usa por padrão). Opcional: outra ação "Pedido pelo WhatsApp" → campo `whatsapp_conversion_name`. |
| Campo `conversion_action_id` | ID numérico da ação criada acima. Depois que a API estiver conectada, o botão **Testar conexão** do canal lista as ações com os IDs. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Numa conta de **administrador (MCC)**: Ferramentas → *Central de API* → solicitar token. O token de teste só fala com contas de teste; o acesso básico precisa do formulário de aprovação do Google. |
| `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud Console → APIs e serviços → Credenciais → *ID do cliente OAuth* (com a **Google Ads API** ativada no projeto e a tela de consentimento configurada). |
| `GOOGLE_ADS_REFRESH_TOKEN` | Gerado uma vez com o consentimento da conta Google que acessa o Google Ads (escopo `https://www.googleapis.com/auth/adwords`). Guardar só no Secrets. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` · campo `login_customer_id` | ID do MCC, se o acesso for por conta de administrador. |
| `GOOGLE_ADS_API_VERSION` | Já vem preenchida; cada versão vive cerca de um ano. |

## 3. Operação — Quando ativar

| Integração | Variáveis | Onde obter |
| --- | --- | --- |
| **Alterdata** (estoque mestre) | `ALTERDATA_BASE_URL`, `ALTERDATA_AUTH_TYPE`, `ALTERDATA_TOKEN`, `ALTERDATA_*_PATH` | Com a Alterdata/consultor, conforme a versão contratada (Moda/Muven). Até lá, a importação é pela planilha e entra direto no estoque central **Ecommerce C18**. |
| **e.Rede** (cartão) | `REDE_ENV`, `REDE_CLIENT_ID`, `REDE_CLIENT_SECRET` | Portal da Rede (userede.com.br) → e.Rede → dados de integração: **PV** (client id) e **chave de integração** (secret). Começar em `sandbox`; `production` só depois da homologação. |
| **ClearSale** (antifraude) | `CLEARSALE_ENV`, `CLEARSALE_API_KEY`, `CLEARSALE_CLIENT_ID`, `CLEARSALE_CLIENT_SECRET`, `CLEARSALE_WEBHOOK_API_KEY` | Enviadas pela ClearSale no onboarding do plano contratado. A chave do webhook você mesma define e informa a eles (protege `clearsale-webhook`). |
| **Correios** (PAC/SEDEX com contrato) | `CORREIOS_API_BASE`, `CORREIOS_USUARIO`, `CORREIOS_SENHA`, `CORREIOS_CARTAO_POSTAGEM`, `CORREIOS_PRODUTO_*` | Contrato comercial → portal *Meu Correios* → gestão de acesso às APIs (usuário, código de acesso e cartão de postagem). Sem isso a loja cota pela tabela estimada. |
| **Uber Direct** (mesmo dia) | `UBER_DIRECT_CUSTOMER_ID`, `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET`, `UBER_DIRECT_PICKUP` | developer.uber.com → aplicativo Direct (depois do contrato comercial). O `PICKUP` é o endereço da loja que expede. |
| **99 Entregas** | `ENTREGAS99_QUOTE_URL`, `ENTREGAS99_TOKEN` | Contrato empresarial com a 99 (URL e token do adaptador). |
| **Mercado Envios** | `MERCADO_ENVIOS_TOKEN` | Exige conta de vendedor no Mercado Livre → fica para o bloco *Futuro*. |
| **Banners por IA** | `BANNER_AI_PROVIDER`, `STABILITY_API_KEY` ou `OPENAI_API_KEY` | platform.stability.ai → API Keys **ou** platform.openai.com → API keys (uma das duas basta). |

## 4. Marketplaces — Futuro (ainda sem conta de vendedor)

A integração está pronta no código (`channel-publish`, feeds, política de
preço/estoque). Quando abrirem as contas, cada canal precisa de:

| Canal | Segredos (Supabase) | Campos públicos (painel) | Onde obter |
| --- | --- | --- | --- |
| **Mercado Livre** | `MERCADOLIVRE_CLIENT_ID`, `MERCADOLIVRE_CLIENT_SECRET`, `MERCADOLIVRE_REFRESH_TOKEN` | `seller_id`, `site_id` (`MLB`), `shipping_mode` | developers.mercadolivre.com.br → *Criar aplicação* (App ID e Secret Key); autorizar a conta vendedora (OAuth) para gerar o refresh token; o seller id aparece na conta. |
| **Shopee** | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_SHOP_ID` (+ `SHOPEE_BASE_URL`) | `shop_id`, `partner_id`, `main_category_id` | open.shopee.com → app da Open Platform (Partner ID/Key); autorizar a loja para obter o Shop ID. Homologar no sandbox antes. |
| **Amazon** | `AMAZON_SP_API_REFRESH_TOKEN`, `AMAZON_SP_API_CLIENT_ID`, `AMAZON_SP_API_CLIENT_SECRET`, `AMAZON_SP_API_AWS_ACCESS_KEY`, `AMAZON_SP_API_AWS_SECRET_KEY`, `AMAZON_MARKETPLACE_ID`, `AMAZON_SP_API_SELLER_ID` | `seller_id`, `marketplace_id`, `sku_prefix` | Seller Central → Apps e serviços → *Desenvolver apps* (credenciais LWA) + usuário IAM na AWS; marketplace do Brasil = `A2Q3Y263D00KWC`. |
| **Magazine Luiza** | `MAGALU_API_TOKEN`, `MAGALU_API_BASE_URL` | `seller_id`, `category_tree` | Portal do parceiro Magalu → integração via API (token e URL de homologação/produção). |
| **Americanas** | `AMERICANAS_CLIENT_ID`, `AMERICANAS_CLIENT_SECRET`, `AMERICANAS_API_KEY` (+ `AMERICANAS_API_BASE_URL`) | `seller_id`, `category_id` | Portal do seller Americanas Marketplace → credenciais de API (client credentials e chave do seller). |

Nessa hora também entra a **importação dos pedidos** dos marketplaces para a
fila de separação do painel (os clientes de API já têm `getOrders`/
`searchOrders`; falta só ligar à tabela `orders`).

---

## Checklist para marcar

- [ ] Supabase: URL + anon key em `config.js`; `INTEGRATION_WORKER_SECRET` em Secrets **e** Vault
- [ ] Migrations rodadas até `202609210002` e Edge Functions publicadas
- [ ] Google Merchant: Merchant ID, conta de serviço JSON (com acesso na conta), token do feed, URL do feed cadastrada
- [ ] Meta: Pixel ID, token da Conversions API, ID do catálogo, conta de anúncios, domínio verificado
- [ ] GA4: ID da métrica e API secret
- [ ] Google Ads: ação de conversão "Compra no site" criada e ID do cliente no painel (CSV já funciona); developer token, OAuth e refresh token quando a API for liberada
- [ ] Alterdata, Rede, ClearSale, Correios, IA de banners — conforme cada contrato for assinado
- [ ] Marketplaces — quando houver conta de vendedor

Ao terminar cada linha: cadastrar o segredo, republicar a função correspondente,
preencher os campos públicos no painel, usar **Testar evento / Testar conexão /
Publicar catálogo (simulação)** e só então **habilitar** o canal.
