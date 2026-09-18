# 🚚 Frete e Entregas — implantação das transportadoras

Guia de implantação do cálculo de frete da Censura 18 com **Correios,
Mercado Envios, Uber Direct e 99 Entregas**, além da **retirada na loja**.

A arquitetura tem duas camadas que se completam:

| Camada | Onde | O que faz |
|---|---|---|
| **Motor de estimativa** | `assets/js/frete.js` (navegador) | Cota na hora pela TABELA_PADRAO (zona de CEP + peso). Funciona **sem nenhuma credencial** — o site nunca deixa de responder. |
| **Cotação ao vivo** | `supabase/functions/cotar-frete` (Edge Function) | Consulta as APIs reais das transportadoras **quando os segredos estão configurados** e devolve `source: "api"`. Se uma API falhar, a estimativa entra no lugar. |

O site chama a função quando `window.C18_SITE.mode === "supabase"`.
Em modo estático (demo), só a tabela padrão é usada.

---

## 📦 Como o cliente vê

1. **Página do produto** → acordeão *Entrega e trocas* → “Simule o frete”:
   digita o CEP e vê as 4 melhores opções (consulta rápida, sem seleção).
2. **Carrinho** → campo *Frete e entrega*: digita o CEP, clica **Calcular**
   e escolhe a opção (radio cards com preço e prazo).
3. O **total com frete** aparece no resumo (e no parcelamento, com a
   parcela mínima respeitada).
4. Ao **finalizar no WhatsApp**, a mensagem já vai com a opção escolhida,
   valor do frete, total e o CEP — a loja só confirma.

### Regras já embutidas

- **Frete grátis (PAC)** em compras acima de **R$ 299** (o mesmo da loja),
  em todo o Brasil.
- **Uber Direct e 99 Entregas** só aparecem para CEPs do Rio de Janeiro
  (capital, Baixada e Niterói/São Gonçalo) — entrega no **mesmo dia**.
- Limite de peso por transportadora: 30 kg Correios, 25 kg Mercado Envios,
  20 kg Uber/99. Quem passa do limite não aparece na lista.
- **Retirar na loja** sempre disponível, grátis.

---

## 🚀 Passo 1 — publicar a Edge Function

```bash
supabase functions deploy cotar-frete
```

Sem nenhum segredo a função já responde com a tabela padrão
(iguais à estimativa do navegador). Teste:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/functions/v1/cotar-frete" \
  -H "Authorization: Bearer ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cep":"26275280","items":[{"qty":2}],"subtotal":259.80}'
```

---

## 🏤 Passo 2 — Correios (PAC e SEDEX)

**Contrato:** cadastre a loja no portal
[Meus Correios / Correios Frota](https://www.correios.com.br/) e solicite o
**contrato de encomendas (SIGEP Web)** — ele gera o *cartão de postagem* e
as credenciais de API. A loja consegue tarifa com desconto e número de
contrato (serviços `04669` PAC e `04162` SEDEX em vez de `04510`/`04014`).

**Segredos** (`supabase secrets set …`):

```bash
supabase secrets set CORREIOS_USUARIO=...        # login do contrato (Meus Correios)
supabase secrets set CORREIOS_SENHA=...          # senha do contrato
supabase secrets set CORREIOS_CARTAO_POSTAGEM=...# nº do cartão de postagem
# opcional — serviços do contrato:
supabase secrets set CORREIOS_PRODUTO_PAC=04669
supabase secrets set CORREIOS_PRODUTO_SEDEX=04162
```

> Comece apontando ao ambiente de **homologação**:
> `supabase secrets set CORREIOS_API_BASE=https://apihom.correios.com.br`
> Quando o contrato for liberado em produção, troque para
> `https://api.correios.com.br` (ou remova a variável).

A função autentica no endpoint `/token/v1/autentica/cartaopostagem`
(token JWT, renovado automaticamente), consulta `/preco/v1/nacional` e
`/prazo/v1/nacional` e substitui as estimativas de PAC/SEDEX por valores
reais (`source: "api"`).

---

## 🛒 Passo 3 — Mercado Envios (Mercado Livre)

O Mercado Envios não tem API pública de cotação sem vendedor. Para
integrar de verdade a loja precisa de uma **conta de vendedor no Mercado
Livre** com o frete gerenciado pelo Mercado Envios.

1. Crie uma aplicação em
   [developers.mercadolibre.com](https://developers.mercadolibre.com/)
   e gere um token de acesso da conta da loja.
2. Configure o CEP de origem das remessas:

```bash
supabase secrets set MERCADO_ENVIOS_TOKEN=ML_TOKEN_DA_CONTA
supabase secrets set ORIGEM_CEP=26275280   # CEP da loja (coleta)
```

O adaptador consulta o simulador de frete do ML
(`/sites/MLB/shipping_options`) e devolve os serviços disponíveis
(name, custo, ETA) como opção `mercado-envios` (`source: "api"`).

> Se a conta da loja não estiver habilitada no Mercado Envios, o adaptador
> falha silenciosamente e a estimativa da tabela é mantida.

---

## 🚗 Passo 4 — Uber Direct (entrega no mesmo dia)

O **Uber Direct** (ex-Postmates) é a plataforma de entregas locais da Uber.
A contratação é feita pelo
[developer.uber.com](https://developer.uber.com/) — solicite acesso ao
produto *Direct*, crie uma *organization* e um *customer id*.

```bash
supabase secrets set UBER_DIRECT_CUSTOMER_ID=...
supabase secrets set UBER_DIRECT_CLIENT_ID=...
supabase secrets set UBER_DIRECT_CLIENT_SECRET=...
# endereço de coleta (JSON) — usa a loja matriz:
supabase secrets set 'UBER_DIRECT_PICKUP={"street_address":["Rua da Matriz, 100"],"city":"Nova Iguaçu","state":"RJ","zip_code":"26275280","country":"BR"}'
```

Fluxo: OAuth `client_credentials` (escopo `direct.delivery`) →
`POST /v1/customers/{id}/delivery_quotes` → preço (`fee`, em centavos) e
ETA (`duration`, em minutos). Só é chamado para CEPs locais
(capital/Baixada/Niterói-São Gonçalo); fora disso a opção nem aparece.

> A cotação real do Uber usa endereço completo. Com só o CEP a função
> retorna a estimativa; quando o pedido avançar para o checkout completo,
> envie o endereço do cliente no payload para cotar de verdade.

---

## 🛵 Passo 5 — 99 Entregas

A 99 atende empresas pelo **99Empresas / 99Pop API de parceiros**. O
acesso à API é concedido pelo gerente comercial da 99 (não há portal
público de developer como o Uber). Quando o contrato existir, aponte o
adaptador para o endpoint de cotação do parceiro:

```bash
supabase secrets set ENTREGAS99_QUOTE_URL=https://api-parceiro.99/.../quotes
supabase secrets set ENTREGAS99_TOKEN=...
```

Contrato esperado (ajustável no `_shared/carriers.ts`):

```json
POST { cepOrigem, cepDestino, pesoKg }
→ { "options": [{ "preco": 24.9, "prazoTexto": "2 a 5 horas — hoje", "dias": 0 }] }
```

Só é chamado para CEPs locais, igual ao Uber.

---

## 🔧 Ajustes finos

- **Valores da tabela padrão** (e prazos): `TABELA_PADRAO` em
  `assets/js/frete.js` — e o espelho em `supabase/functions/_shared/carriers.ts`
  (mantenha os dois iguais).
- **Limite do frete grátis**: `window.C18_FRETE = { freteGratisAPartir: 350 }`
  antes do `app.js`, ou `FRETE_GRATIS_PADRAO` nos dois motores.
- **Ligar/desligar transportadora** pela página (sem deploy):
  ```html
  <script>window.C18_FRETE = { carriers: { "uber-direct": { enabled: false } } };</script>
  ```
- **Sobretaxa por serviço** (ex.: embrulho para presente no SEDEX):
  `{ "correios-sedex": { adicional: 5 } }`.
- **Peso por produto**: cadastre `weightKg` no produto (`data.js` ou
  importação); sem isso, cada peça conta **0,3 kg**.
- **Zonas de CEP**: `zonaDoCep()` em ambos os motores — as faixas são
  estimativas operacionais e podem ser refinadas por bairro/município.

## ✅ Testes

```bash
node --test tests/*.test.js
```

Cobrem CEP, zonas, peso, frete grátis, limites por transportadora,
configuração por página, ordenação, mensagem de WhatsApp e o fallback
da cotação ao vivo.
