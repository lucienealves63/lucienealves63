# 💳 Checkout e pagamentos — como funciona e como ativar

O checkout online (`checkout.html`) fecha o pedido no site e entrega à loja
no painel de operações, com **Pix na hora** ou **cartão em até 6x sem juros**.

## 🔄 O fluxo

```
carrinho (CEP + frete escolhido)
        ↓
checkout.html — revisa itens, entrega, dados do cadastro
        ↓
escolhe:  Pix  ·  Cartão (link seguro)
        ↓
RPC criar_meu_pedido → public.orders + order_items + order_events
        ↓
PAINEL (Pedidos): pagamento 'pending' → equipe confirma → picking → …
        ↓
cliente acompanha em conta.html → Meus pedidos
```

- Só compra online quem tem **conta** (cadastro com LGPD) — a RPC usa o
  cadastro do banco para nome/telefone/endereço e recusa quem não aceitou
  a política de privacidade.
- O **servidor recalcula o subtotal** item a item: o preço enviado pelo
  navegador é conferido (`orders.total` é autoritativo).
- Cupom e código do vendedor do carrinho viajam com o pedido
  (`coupon_code` / `seller_code`) para a loja validar na conferência.

## 💜 Pix (funciona hoje, sem contrato nenhum)

O código **copia e cola** é gerado no próprio navegador no padrão EMV do
Banco Central (BR Code estático com valor e txid do pedido), usando a
chave configurada em `assets/js/data.js`:

```js
const PAGAMENTO = {
  pixChave: "00.000.000/0001-00",  /* ⚠️ troque pela chave Pix real da loja */
  pixNome:  "Censura 18 Comercio de Roupas",
  pixCidade: "Nova Iguacu",
};
```

**Passo único de ativação:** trocar `pixChave` pela chave real (CNPJ,
e-mail, telefone ou aleatória). O cliente copia o código, paga no app do
banco e manda o comprovante pelo WhatsApp; a equipe confirma o pagamento
no painel (etapa *Pagamento* → pagamento `captured`) e o pedido segue para
separação.

> Quer conciliação automática? É possível plugar um PSP com API de Pix
> (ex.: Mercado Pago, PagSeguro, Pagar.me): criar a cobrança no servidor
> e atualizar `payment_status` pelo webhook. A estrutura de pedidos e a
> fila (`integration_outbox`) já suportam — é adicionar um adaptador em
> `supabase/functions/_shared/` no padrão do `rede.ts`.

## 💳 Cartão (e.Rede) — link seguro agora, transparente depois

**Nenhum dado de cartão é digitado no site.** É a decisão de segurança do
projeto (PCI): cobrar cartão exige tokenização/3-D Secure do emissor,
que depende do contrato da loja com a e.Rede.

Enquanto isso:

1. Cliente escolhe *Cartão* no checkout → pedido entra `pending`.
2. A loja envia pelo WhatsApp um **link de pagamento seguro** da e.Rede
   (Gerencie da Rede ou link de venda) já com 3-D Secure.
3. Pagamento aprovado → equipe marca `captured` no painel (ou, quando
   integrado, a própria transação atualiza o pedido).

Quando a loja quiser o **checkout transparente** (cliente digita o cartão
sem sair do site):

```bash
supabase secrets set REDE_CLIENT_ID=... REDE_CLIENT_SECRET=...
supabase secrets set REDE_ENV=sandbox     # trocar para production no fim da homologação
```

O caminho técnico já está pronto no repositório:

- `_shared/rede.ts` — OAuth + criar/consultar transação (sandbox e produção),
  com guarda anti-PCI (a fila **rejeita** payload com número de cartão/CVV);
- `integration_outbox` + `integration-worker` — fila idempotente com
  retentativa para `rede/transaction.create|get`;
- `orders.rede_tid / rede_nsu` + etapas `payment_status` no banco;
- no site, bastará um formulário tokenizado (e.Rede JS/Bin ou 3DS) que
  envie **só o token** para uma Edge Function, que enfileira a transação.

## ✅ Testes

```bash
node --test tests/*.test.js
```

Os testes de `tests/pedido.test.js` cobrem resumo/validação do pedido, o
CRC16 do Pix (vetor oficial CCITT-FALSE), a estrutura TLV do BR Code e as
mensagens de WhatsApp.
