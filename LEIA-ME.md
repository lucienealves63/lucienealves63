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
├── lojas.html            As 6 lojas físicas + WhatsApp de cada uma
├── sobre.html            História da marca e linha do tempo
├── contato.html          Formulário (abre WhatsApp) + FAQ
├── 404.html              Página de erro
│
├── assets/
│   ├── css/style.css     Todo o visual (tokens, componentes, responsivo)
│   ├── js/data.js        ⭐ Produtos, lojas e textos — edite aqui
│   ├── js/app.js         Carrinho, filtros, PDP, WhatsApp
│   └── img/
│       ├── produtos/     Fotos do catálogo
│       ├── logos/        ← solte as logos aqui
│       ├── hero.jpg
│       └── sobre.jpg
│
└── LEIA-ME.md            Este arquivo
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

1. `git push` nesta branch
2. Em **Settings → Pages**, escolha a branch e a pasta `/ (root)`
3. O site sai em `https://lucienealves63.github.io/lucienealves63/`

---

## 🖼️ Sobre as suas logos

Os arquivos que você enviou ainda não chegaram ao repositório, então o site
está preparado para recebê-los **sem precisar mexer em código**. Basta copiar
para `assets/img/logos/` com estes nomes:

| Arquivo esperado              | Onde aparece                             |
| ----------------------------- | ---------------------------------------- |
| `logo_c18.png`                | Cabeçalho, menu mobile e rodapé          |
| `logo-quadro.png`             | Hero da home (versão grande, invertida)  |
| `Novo-Logo-C18-preto-2.png`   | Reserva — use trocando o `src` no HTML   |

**Enquanto o arquivo não existe**, o site mostra automaticamente um wordmark
tipográfico `CENSURA 18` no lugar. Assim que você soltar o PNG na pasta, ele
passa a ser usado — sem editar nada.

Se preferir usar nomes diferentes, troque o `src` das tags
`<img ... class="brand__img">` nos arquivos HTML.

> Dica: as logos do cabeçalho e do rodapé ficam melhores em PNG com fundo
> transparente. A do rodapé e do hero recebem `filter: invert(1)` — se a sua
> logo já for branca, remova essa classe (`brand__img--footer`,
> `brand__img--hero`).

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
3. Na hora de finalizar, ele escolhe a loja num `<select>`
4. O site monta uma mensagem completa e abre o WhatsApp daquela unidade

Exemplo de mensagem gerada:

```
Olá! Vim pelo site e quero fechar um pedido 🖤
*Loja:* Censura 18 — Nilópolis (Mirandela)

*Itens:*
1. 2x Camiseta Oversized Censura 18 — tam. M, cor Preto — R$ 259,80

*Total dos itens:* R$ 259,80

Podem confirmar disponibilidade em estoque e o frete?

CEP para entrega: ______
```

Se quiser um checkout com pagamento integrado depois, o ponto de troca é a
função `buildWhatsMessage()` em `app.js`.

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

Fontes: **Anton** (títulos) e **Inter** (texto), ambas pelo Google Fonts.

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
- [x] 100% responsivo (mobile, tablet, desktop)
- [x] Acessibilidade: skip-link, foco visível, `aria-label`, `prefers-reduced-motion`

## 🔜 Próximos passos sugeridos

- [ ] Adicionar as logos oficiais em `assets/img/logos/`
- [ ] Substituir as fotos de exemplo pelas fotos reais do catálogo
- [ ] Configurar o domínio próprio no GitHub Pages
- [ ] Integrar um gateway de pagamento, se fizer sentido
