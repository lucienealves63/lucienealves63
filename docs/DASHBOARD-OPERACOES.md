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

## Implantação de homologação

1. Criar projeto Supabase na região adequada;
2. Executar `supabase/migrations/202609170001_operations.sql`;
3. Criar o primeiro usuário e promovê-lo para `admin` pelo SQL Editor;
4. Cadastrar URL e anon key em `admin/assets/config.js`;
5. Cadastrar os segredos de `.env.example` via Supabase Secrets;
6. Publicar as Edge Functions;
7. Testar importação com cópia anonimizada da planilha;
8. Homologar Alterdata, Rede e ClearSale separadamente;
9. Só então habilitar dados e credenciais de produção.

## Segurança

- Nunca colocar `service_role`, client secrets, CVV ou número completo de cartão
  no frontend, Git ou planilha;
- RLS habilitado em todas as tabelas operacionais;
- Funções sensíveis validam função do usuário;
- Integrações usam outbox com idempotência e retentativa;
- Produção precisa de política de backup, retenção de logs e atendimento à
  LGPD antes do lançamento.
