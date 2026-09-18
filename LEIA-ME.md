# 🛒 Censura 18 — Loja Online

Site de e-commerce da **Censura 18** (marca de streetwear da Baixada
Fluminense, *since 1989*), construído em **HTML + CSS + JavaScript puro** —
sem frameworks, sem build, sem dependências.

Paleta: **preto · branco · cinza**.

---

## 📂 Estrutura

```
/
├── index.html            Home: hero, categorias, destaques, newsletter
├── produtos.html         Catálogo com filtros e ordenação
├── produto.html          Detalhe da peça (?id=... na URL)
├── conta.html            Minha conta: cadastro do cliente (com LGPD)
├── cartao-presente.html  Cartão presente: valores, nomes e WhatsApp
├── lojas.html            As 6 lojas físicas + WhatsApp de cada uma
├── sobre.html            História da marca e linha do tempo
├── contato.html          Formulário (abre WhatsApp) + FAQ
├── privacidade.html      Política de privacidade (LGPD)
├── 404.html              Página de erro
│
├── assets/
│   ├── css/style.css     Todo o visual (tokens, componentes, responsivo)
│   ├── js/data.js        ⭐ Produtos, lojas e textos — edite aqui
│   ├── js/app.js         Carrinho, filtros, PDP, WhatsApp
│   ├── js/ssl.js         HTTPS sempre (redirect + upgrade de links)
│   ├── js/lgpd.js        Banner de consentimento (LGPD)
│   ├── js/gift-card.js   Cartão presente (valores + mensagem)
│   ├── js/coupons.js     Cupons: validação, escopos e descrição
│   ├── js/frete.js       ⭐ Frete: Correios, Mercado Envios, Uber, 99 e retirada
│   ├── js/cliente.js     Cadastro do cliente: validação, LGPD e WhatsApp
│   └── img/
│       ├── produtos/     Fotos do catálogo
│       ├── logos/        ← solte as logos aqui
│       ├── hero.jpg
│       └── sobre.jpg
│
├── LEIA-ME.md            Este arquivo
│
├── admin/                Dashboard de operações (Banners & Paleta, Cupons)
│   └── ver docs/DASHBOARD-OPERACOES.md
├── docs/
│   ├── DASHBOARD-OPERACOES.md
│   └── FRETE-ENTREGAS.md Implantação das transportadoras e do frete
└── supabase/             Migrations, RPCs e Edge Functions
```

---

## 🚀 Como rodar

Basta abrir o `index.html` no navegador. Mas para evitar problemas com
`localStorage`, prefira um servidor local:

```bash
python3 -m http.server 8000
# depois abra  http://localhost:8000
```

### Publicar no GitHub Pages

O site é 100% estático, então o GitHub Pages serve ele sem nenhum build.

**Primeira vez (só uma vez mesmo):**

1. No repositório, vá em **Settings** → **Pages**
2. Em *Source*, escolha **Deploy from a branch**
3. Em *Branch*, escolha **`main`** e a pasta **`/ (root)`**
4. Clique em **Save**

Em 1 ou 2 minutos o site sai em:

**→ https://lucienealves63.github.io/lucienealves63/**

Depois disso, cada `git push` na `main` atualiza o site sozinho, em poucos
segundos.

> O arquivo `.nojekyll` na raiz diz ao GitHub para não processar o site pelo
> Jekyll. Ele publica os arquivos exatamente como estão — mais rápido e sem
> surpresa.

**Quer usar um domínio próprio** (tipo `censura18.com.br`)? Em
**Settings → Pages → Custom domain** é só digitar o domínio e criar um
registro `CNAME` no seu provedor de DNS apontando para
`lucienealves63.github.io`.

---

## 🖼️ Logos oficiais

As marcas fornecidas em PDF foram incorporadas ao site como PNGs de alta
resolução com fundo transparente:

| Arquivo                       | Origem                  | Onde aparece                            |
| ----------------------------- | ----------------------- | --------------------------------------- |
| `logo_c18.png`                | `Logo separado.pdf`     | Cabeçalho, menu mobile e rodapé         |
| `logo-quadro.png`             | `logo c18 preta.pdf`    | Hero da home e favicon                  |

O rodapé e o hero aplicam `filter: invert(1)` para exibir as versões brancas
sobre fundos escuros. O fallback tipográfico permanece no HTML apenas para o
caso de falha no carregamento das imagens.

---

## ✏️ Como editar os produtos

Tudo está em **`assets/js/data.js`**. Exemplo:

```js
{
  id: "c18-tee-oversized",              // único, usado na URL do produto
  name: "Camiseta Oversized Censura 18",
  category: "camisetas",                // precisa existir em CATEGORIES
  price: 129.9,
  priceFrom: 159.9,                     // null se não tiver "de"
  badge: "Lançamento",                  // ou null
  image: "assets/img/produtos/camiseta-oversized.jpg",
  colors: [{ name: "Preto", hex: "#0b0b0b" }],
  sizes: ["P", "M", "G", "GG", "XG"],
  soldOut: ["XG"],                      // tamanhos esgotados
  description: "...",
  details: ["...", "..."],
  care: "..."
}
```

### Adicionar uma categoria nova

Inclua em `CATEGORIES` e use o mesmo `id` no produto:

```js
const CATEGORIES = [
  { id: "todos", label: "Tudo" },
  // ...
  { id: "saias", label: "Saias" },
];
```

---

## 🏪 Lojas físicas

Os **endereços e WhatsApp reais** das 6 unidades estão em `STORES`, dentro de
`assets/js/data.js`:

- Nova Iguaçu — Calçadão
- Nova Iguaçu — Beco do Ponto Frio
- Nova Iguaçu — Top Shopping
- Duque de Caxias — Centro
- Nilópolis — Mirandela
- Queimados — Centro

---

## 🛍️ Como funciona a compra

O fluxo é **carrinho no site → finalização no WhatsApp**, igual à marca já faz
hoje pelo Instagram:

1. Cliente escolhe tamanho, cor e quantidade
2. Carrinho fica salvo no `localStorage` (não se perde ao recarregar)
3. No checkout, pode informar o **código do vendedor**, um **cupom de
   desconto** e o código de um **cartão presente**
4. Escolhe a loja num `<select>`
5. O site monta uma mensagem completa e abre o WhatsApp daquela unidade

O cupom e o cartão presente informados não alteram o preço no navegador:
eles seguem identificados na mensagem para validação segura pela loja
antes do pagamento. No parcelamento, **até 6x sem juros com parcela
mínima de R$ 49,00** — o carrinho já mostra quantas parcelas cabem no
total dos itens.

### Cupons de desconto

Criados no painel (`admin/` → Cupons) com quatro escopos: **loja toda**,
**por referência**, **por categoria** ou **por coleção** (os conceitos da
planilha Alterdata), em percentual (1–90%) ou valor fixo (até R$ 5.000),
com janela de validade. No modo demonstração, o carrinho lê os cupons
ativos do `localStorage` (`c18:demo-coupons`) e descreve o desconto ao
cliente; com o Supabase ligado, a consulta é um código por vez pela RPC
`check_discount_coupon` — nunca uma listagem anônima. A lógica
compartilhada está em `assets/js/coupons.js` e as RPCs em
`supabase/migrations/202609180002_discount_coupons.sql`.

### Cartão presente

Vendido em 6 faixas (`R$ 50` a `R$ 500`, em `assets/js/gift-card.js`) pela
página `cartao-presente.html`, com nomes de quem presenteia e de quem
recebe na mensagem do WhatsApp. O código tem o formato `C18-XXXX-XXXX`:
no carrinho, ele entra no campo *Cartão presente* e a loja confere o saldo
no momento do pagamento. Com o Supabase ligado, a emissão, a consulta e o
resgate do saldo ficam nas RPCs de
`supabase/migrations/202609180001_gift_cards.sql`.

### Cadastro de clientes

Na página `conta.html` o cliente cria conta com **nome, e-mail, WhatsApp,
senha e endereço** — com consentimento LGPD registrado (data e hora). Com
o Supabase ligado, a conta usa Supabase Auth e o perfil fica em
`public.customers` com RLS (cada cliente vê só os próprios dados; a
equipe consulta pela aba **Clientes** do painel). Sem Supabase, a conta
de demonstração fica só no navegador. Quem tem conta tem o **CEP do
frete preenchido automaticamente** e o pedido chega no WhatsApp já
identificado. A migração é `supabase/migrations/202609190001_customers.sql`.

### Frete e entregas

O cliente digita o **CEP no carrinho** (ou na página do produto) e escolhe
entre **Correios PAC/SEDEX, Mercado Envios, Uber Direct e 99 Entregas**
(mesmo dia para Rio e Baixada) ou **retirar na loja** — frete grátis no
PAC acima de R$ 299. Sem credenciais, o cálculo usa a tabela padrão de
estimativa (`assets/js/frete.js`); com o Supabase ligado, a Edge Function
`cotar-frete` consulta as APIs reais das transportadoras quando os
segredos de cada uma estão configurados. O passo a passo de implantação
está em `docs/FRETE-ENTREGAS.md`.

### Privacidade (LGPD) e HTTPS

O site não usa cookies de rastreamento e não envia dados a terceiros:
carrinho e preferências ficam no `localStorage` do próprio navegador. O
banner de `assets/js/lgpd.js` registra a escolha do visitante — com
**"Só o essencial"**, o site para de gravar cupom, código de vendedor e
cartão presente e apaga o que já estava salvo. A política completa está
em `privacidade.html`, e o formulário de contato só envia com
consentimento explícito. Por segurança, `assets/js/ssl.js` (no `<head>`
de todas as páginas) redireciona `http://` → `https://` — útil até o
"Enforce HTTPS" ser ligado num domínio próprio.

Exemplo de mensagem gerada:

```
Olá! Vim pelo site e quero fechar um pedido 🖤
*Loja:* Censura 18 — Nilópolis (Mirandela)

*Itens:*
1. 2x Camiseta Oversized Censura 18 — tam. M, cor Preto — R$ 259,80

*Total dos itens:* R$ 259,80

*Código do vendedor:* 042
*Cupom informado:* PRIMEIRAC18 (validar desconto)
*Observação:* total sujeito à validação do cupom pela loja.

Podem confirmar disponibilidade em estoque, desconto e frete?

CEP para entrega: ______
```

Se quiser um checkout com pagamento integrado depois, o ponto de troca é a
função `buildWhatsMessage()` em `app.js`.

---

## 🖼️ Fotos

Cada peça tem uma foto principal (`image`). Quatro delas também têm uma foto
de detalhe, usada na galeria da página do produto e no efeito de *hover* do
card:

```js
image:  "assets/img/produtos/camiseta-oversized.jpg",
images: [
  "assets/img/produtos/camiseta-oversized.jpg",
  "assets/img/produtos/camiseta-oversized-2.jpg",
],
```

Quando existe mais de uma foto, a tira de miniaturas aparece sozinha na
página do produto. Com uma só, ela nem é renderizada.

Para trocar por fotos reais: coloque o arquivo em `assets/img/produtos/`
com o mesmo nome, ou aponte os campos para os novos arquivos.

---

## 🎨 Paleta e identidade

Todas as cores estão em variáveis CSS no topo de `assets/css/style.css`:

```css
--black: #000000;
--gray-900: #111111;
--gray-700: #2b2b2b;
--gray-500: #6d6d6d;
--gray-300: #c2c2c2;
--gray-100: #f1f1f1;
--white: #ffffff;
```

Fonte: **Jost** em títulos, navegação e textos, pelo Google Fonts. A família
geométrica foi escolhida por seguir a construção visual dos materiais oficiais
(próxima da tradição da Futura). Nos PDFs, as letras das marcas estão
convertidas em curvas; por isso, a fonte original não está incorporada nem pode
ser extraída diretamente dos arquivos.

---

## ✅ O que já está pronto

- [x] Header fixo com busca expansível e badge do carrinho
- [x] Menu mobile deslizante
- [x] Hero com gradiente e números da marca
- [x] Categorias em destaque
- [x] Catálogo com filtro por categoria e 4 tipos de ordenação
- [x] Página de produto com galeria, cores, tamanhos esgotados e acordeões
- [x] Produtos relacionados
- [x] Carrinho lateral com adicionar/remover/alterar quantidade
- [x] Finalização por WhatsApp com mensagem formatada
- [x] Página das 6 lojas com botão de rota no Google Maps
- [x] Página "a marca" com linha do tempo
- [x] Página de contato com formulário e FAQ
- [x] Newsletter e rodapé completo
- [x] Botão flutuante de WhatsApp e voltar ao topo
- [x] Página 404 personalizada
- [x] Galeria com miniaturas nas peças com mais de uma foto
- [x] Foto de detalhe no hover do card
- [x] Guia de medidas em tabela (sem `alert()`)
- [x] Busca com título de "resultados para …"
- [x] Dados estruturados JSON-LD (marca + produto) para SEO
- [x] 100% responsivo (mobile, tablet, desktop) — site e painel
- [x] Acessibilidade: skip-link, foco visível, `aria-label`,
      `aria-expanded` nos acordeões e `prefers-reduced-motion`
- [x] Banners da home gerenciados no painel (upload, geração por IA por
      prompt, agendamento e ativar/desativar) — `admin/` → Banners & Paleta
- [x] Paleta de cores do site ajustável pelo painel (8 cores aplicadas em
      tempo real via CSS variables, com restauração do padrão P&B)
- [x] Cartão presente (R$ 50–500) com página própria e campo no carrinho —
      código `C18-XXXX-XXXX` validado pela loja no pagamento
- [x] Cupons de desconto gerenciados no painel: loja toda, referência,
      categoria ou coleção, percentual ou valor fixo
- [x] Parcelamento em até 6x sem juros com parcela mínima de R$ 49,00
- [x] LGPD: banner de consentimento, política de privacidade
      (`privacidade.html`) e consentimento explícito no formulário de contato
- [x] HTTPS sempre: redirecionamento `http://` → `https://` e upgrade
      automático de links inseguros em todas as páginas
- [x] Suíte de testes com o Node puro: `node --test tests/`

## 🔜 Próximos passos sugeridos

- [x] Incorporar as logos oficiais e alinhar a tipografia aos PDFs de marca
- [ ] Substituir as fotos de exemplo pelas fotos reais do catálogo
- [ ] Criar o projeto Supabase, rodar as migrations de `supabase/` e
      ligar o painel (incluindo banners/paleta e geração por IA) ao ambiente
      real — passo a passo em `docs/DASHBOARD-OPERACOES.md`
- [ ] Revisar textos e preços com a equipe da Censura 18
- [ ] Configurar o domínio próprio no GitHub Pages (e ligar "Enforce HTTPS")
- [ ] Integrar um gateway de pagamento, se fizer sentido

## ✅ Testes

A suíte roda com o Node puro, sem dependências:

```bash
node --test                 # 28 testes (descobre tudo em tests/)
# ou, por arquivo:
node --test tests/gift-card.test.js tests/coupons.test.js \
           tests/checkout.test.js tests/site-config.test.js \
           tests/importer.test.js
```

Os testes cobrem o contrato do checkout (vendedor, cupom, cartão
presente e parcelamento), os cupons por escopo, a página de cartão
presente, o `site-config` nos modos static/demo e o importador da
planilha Alterdata.
