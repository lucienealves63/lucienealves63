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

- **Banners da home** (`site_banners`): arte do hero com título, texto e
  dois CTAs. Cada banner tem origem (`upload`, `ai` ou `static`),
  agendamento (`starts_at`/`ends_at`) e prioridade. Só **um banner por
  posição** fica ativo; ao ativar, os demais da posição desativam.
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
   (cartão presente: emitir, consultar e resgatar saldo por RPC) e
   `supabase/migrations/202609180002_discount_coupons.sql` (cupons de
   desconto);
4. Criar o primeiro usuário e promovê-lo para `admin` pelo SQL Editor;
5. Cadastrar URL e anon key em `admin/assets/config.js`;
6. Cadastrar os segredos de `.env.example` via Supabase Secrets
   (incluindo `BANNER_AI_PROVIDER` e a chave da IA escolhida);
7. Publicar as Edge Functions (incluindo `gerar-banner`);
8. Testar importação com cópia anonimizada da planilha;
9. Homologar Alterdata, Rede e ClearSale separadamente;
10. Só então habilitar dados e credenciais de produção.

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

## Segurança

- Nunca colocar `service_role`, client secrets, CVV ou número completo de cartão
  no frontend, Git ou planilha;
- RLS habilitado em todas as tabelas operacionais;
- Funções sensíveis validam função do usuário;
- Integrações usam outbox com idempotência e retentativa;
- Produção precisa de política de backup, retenção de logs e atendimento à
  LGPD antes do lançamento.
