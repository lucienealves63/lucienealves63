/* ==========================================================================
   CENSURA 18 — dados da loja
   --------------------------------------------------------------------------
   Este arquivo é o "painel de controle" do site. Tudo que muda com
   frequência (produtos, preços, lojas) fica aqui, em um só lugar.

   COMO TROCAR UM PRODUTO:
   1. Copie a imagem para  assets/img/produtos/
   2. Aponte o campo  image  para o nome do arquivo
   3. Ajuste nome, preço, tamanhos e descrição

   CAMPO OPCIONAL:
   images: ["foto1.jpg", "foto2.jpg"]  →  galeria com várias fotos na
   página do produto. Se não existir, usa só o campo  image  e a tira de
   miniaturas nem aparece.
   ========================================================================== */

/* --- Lojas físicas (endereços e WhatsApp reais da marca) ---------------- */
const STORES = [
  {
    id: "nova-iguacu-calcadao",
    city: "Nova Iguaçu",
    district: "Calçadão",
    address: "Av. Governador Amaral Peixoto, 444",
    whatsapp: "5521967239363",
    phone: "(21) 2667-5105",
  },
  {
    id: "nova-iguacu-beco",
    city: "Nova Iguaçu",
    district: "Beco do Ponto Frio",
    address: "Travessa Rosinda Martins, 56/7",
    whatsapp: "5521967531831",
    phone: "(21) 2667-3344",
  },
  {
    id: "nova-iguacu-topshopping",
    city: "Nova Iguaçu",
    district: "Top Shopping",
    address: "Av. Governador Roberto Silveira, 470",
    whatsapp: "5521967121302",
    phone: "(21) 3851-1890",
  },
  {
    id: "duque-de-caxias",
    city: "Duque de Caxias",
    district: "Centro",
    address: "Rua Manoel Correia, 34 — Loja C",
    whatsapp: "5521967542286",
    phone: "(21) 2671-1565",
  },
  {
    id: "nilopolis",
    city: "Nilópolis",
    district: "Mirandela",
    address: "Av. Mirandela, 490 — Loja A",
    whatsapp: "5521967118648",
    phone: "(21) 2791-4839",
  },
  {
    id: "queimados",
    city: "Queimados",
    district: "Centro",
    address: "Rua Eloi Teixeira, 165",
    whatsapp: "5521999128849",
    phone: "(21) 2665-5975",
  },
];

/* --- Categorias usadas nos filtros -------------------------------------- */
const CATEGORIES = [
  { id: "todos", label: "Tudo" },
  { id: "camisetas", label: "Camisetas" },
  { id: "moletons", label: "Moletons" },
  { id: "bermudas", label: "Bermudas" },
  { id: "calcas", label: "Calças" },
  { id: "jaquetas", label: "Jaquetas" },
  { id: "acessorios", label: "Acessórios" },
  { id: "feminino", label: "Feminino" },
];

/* --- Catálogo ----------------------------------------------------------- */
const PRODUCTS = [
  {
    id: "c18-tee-oversized",
    name: "Camiseta Oversized Censura 18",
    category: "camisetas",
    price: 129.9,
    priceFrom: 159.9,
    badge: "Lançamento",
    image: "assets/img/produtos/camiseta-oversized.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Branco", hex: "#f5f5f5" },
      { name: "Cinza Mescla", hex: "#a3a3a3" },
    ],
    sizes: ["P", "M", "G", "GG", "XG"],
    soldOut: ["XG"],
    description:
      "A camiseta que abriu a temporada. Modelagem oversized, caimento solto e algodão penteado 100% que aguenta o verão da Baixada sem perder a forma.",
    details: [
      "100% algodão penteado, 210 g/m²",
      "Modelagem oversized — cai uma numeração acima",
      "Gola reforçada com ribana 2x2",
      "Estampa serigráfica de alta definição",
    ],
    care: "Lavar a 30°C, não usar alvejante, secar à sombra.",
  },
  {
    id: "c18-hoodie-classic",
    name: "Moletom Hoodie Classic",
    category: "moletons",
    price: 259.9,
    priceFrom: null,
    badge: "Mais vendido",
    image: "assets/img/produtos/moletom-hoodie.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Cinza Chumbo", hex: "#5a5a5a" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: [],
    description:
      "O clássico do guarda-roupa de rua. Felpa macia por dentro, capuz duplo com cordão chato e bolso canguru. Feito para durar anos, não estações.",
    details: [
      "Felpa 320 g/m², 80% algodão e 20% poliéster",
      "Capuz duplo com cordão tubular",
      "Punhos e barra em ribana elástica",
      "Etiqueta interna em cetim",
    ],
    care: "Lavar no ciclo delicado, não secar em tambor.",
  },
  {
    id: "c18-regata-1989",
    name: "Regata Beach 1989",
    category: "camisetas",
    price: 99.9,
    priceFrom: 119.9,
    badge: "Promo",
    image: "assets/img/produtos/regata-beach.jpg",
    colors: [
      { name: "Branco", hex: "#f5f5f5" },
      { name: "Preto", hex: "#0b0b0b" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: ["P"],
    description:
      "UV, mar e calçadão. Regata leve com laterais amplas, feita para o calor de 40° que só a Baixada conhece.",
    details: [
      "Malha 100% algodão, 165 g/m²",
      "Cavas amplas para ventilação",
      "Modelagem reta, barra com costura dupla",
    ],
    care: "Lavar a 30°C com cores semelhantes.",
  },
  {
    id: "c18-bermuda-cargo",
    name: "Bermuda Cargo Utility",
    category: "bermudas",
    price: 179.9,
    priceFrom: null,
    badge: null,
    image: "assets/img/produtos/bermuda-cargo.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Cinza", hex: "#8a8a8a" },
    ],
    sizes: ["36", "38", "40", "42", "44"],
    soldOut: ["44"],
    description:
      "Bolsos laterais de verdade, cordão na cintura e comprimento na medida: acima do joelho, do jeito que o streetwear pede.",
    details: [
      "Sarja 100% algodão, 240 g/m²",
      "Quatro bolsos funcionais",
      "Cós elástico com cordão regulável",
      "Zíper em metal com acabamento fosco",
    ],
    care: "Lavar a 30°C, passar em temperatura média.",
  },
  {
    id: "c18-jaqueta-cortavento",
    name: "Jaqueta Corta-Vento Shell",
    category: "jaquetas",
    price: 329.9,
    priceFrom: 399.9,
    badge: "Últimas peças",
    image: "assets/img/produtos/jaqueta-cortavento.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Cinza Prata", hex: "#c7c7c7" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: ["P", "GG"],
    description:
      "Tecido técnico com repelência à água, capuz embutido e punhos elásticos. Enfrenta o vento da serra e a chuva de verão na mesma semana.",
    details: [
      "Poliéster ripstop com acabamento DWR",
      "Capuz embutido na gola",
      "Zíper frontal impermeável",
      "Embalável no próprio bolso",
    ],
    care: "Não usar amaciante, secar à sombra.",
  },
  {
    id: "c18-bone-estruturado",
    name: "Boné Estruturado C18",
    category: "acessorios",
    price: 119.9,
    priceFrom: null,
    badge: null,
    image: "assets/img/produtos/bone-estruturado.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Cinza", hex: "#8a8a8a" },
      { name: "Branco", hex: "#f2f2f2" },
    ],
    sizes: ["Único"],
    soldOut: [],
    description:
      "Aba curva, seis painéis e regulagem metálica. O acessório que fecha qualquer look sem precisar gritar.",
    details: [
      "Twill 100% algodão",
      "Seis painéis com costura reforçada",
      "Fecho metálico regulável",
      "Logo bordado em alto-relevo",
    ],
    care: "Limpeza local com pano úmido.",
  },
  {
    id: "c18-cropped-ribana",
    name: "Cropped Ribana Feminino",
    category: "feminino",
    price: 109.9,
    priceFrom: 129.9,
    badge: "Novo",
    image: "assets/img/produtos/cropped-ribana.jpg",
    colors: [
      { name: "Branco", hex: "#f5f5f5" },
      { name: "Cinza Mescla", hex: "#a3a3a3" },
      { name: "Preto", hex: "#0b0b0b" },
    ],
    sizes: ["PP", "P", "M", "G"],
    soldOut: ["PP"],
    description:
      "Ribana canelada que abraça a silhueta sem apertar. Comprimento cropped na medida certa para usar com cintura alta.",
    details: [
      "Ribana 96% algodão e 4% elastano",
      "Modelagem justa ao corpo",
      "Decote redondo com acabamento duplo",
    ],
    care: "Lavar a 30°C, não secar em tambor.",
  },
  {
    id: "c18-tee-longline",
    name: "Camiseta Long Line Side Slit",
    category: "camisetas",
    price: 149.9,
    priceFrom: null,
    badge: null,
    image: "assets/img/produtos/camiseta-longline.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Off White", hex: "#e8e6e1" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: [],
    description:
      "Barra alongada com fendas laterais. A silhueta alongada que domina as ruas desde que o streetwear aprendeu a brincar com proporção.",
    details: [
      "100% algodão, 200 g/m²",
      "Comprimento long line com fenda lateral",
      "Manga curta com caimento amplo",
    ],
    care: "Lavar a 30°C com cores semelhantes.",
  },
  {
    id: "c18-jogger-fleece",
    name: "Calça Jogger Fleece",
    category: "calcas",
    price: 229.9,
    priceFrom: 269.9,
    badge: "Promo",
    image: "assets/img/produtos/jogger-fleece.jpg",
    colors: [
      { name: "Cinza Chumbo", hex: "#5a5a5a" },
      { name: "Preto", hex: "#0b0b0b" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: ["GG"],
    description:
      "O meio-termo perfeito entre o agasalho de casa e a calça de rua. Felpa macia, elástico no tornozelo e dois bolsos laterais.",
    details: [
      "Felpa 300 g/m², 80% algodão",
      "Punho elástico no tornozelo",
      "Cós com cordão e elástico interno",
      "Dois bolsos laterais e um traseiro",
    ],
    care: "Lavar no ciclo delicado, não usar alvejante.",
  },
  {
    id: "c18-meias-kit",
    name: "Kit 3 Meias Cano Médio",
    category: "acessorios",
    price: 79.9,
    priceFrom: null,
    badge: null,
    image: "assets/img/produtos/meias-kit.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Branco", hex: "#f5f5f5" },
      { name: "Cinza", hex: "#a3a3a3" },
    ],
    sizes: ["36/39", "40/43"],
    soldOut: [],
    description:
      " Três pares no tom certo: preto, branco e cinza. Cano médio com reforço no calcanhar e na ponta.",
    details: [
      "Algodão 78%, poliamida 20%, elastano 2%",
      "Reforço em calcanhar e ponta",
      "Cano médio, elástico sem marcar",
      "Embalagem com 3 pares",
    ],
    care: "Lavar a 40°C, não passar.",
  },
  {
    id: "c18-camisa-oversized",
    name: "Camisa Oversized Poplin",
    category: "camisetas",
    price: 199.9,
    priceFrom: null,
    badge: null,
    image: "assets/img/produtos/camisa-oversized.jpg",
    colors: [
      { name: "Branco", hex: "#f5f5f5" },
      { name: "Cinza", hex: "#b5b5b5" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: ["P"],
    description:
      "Poplin leve com modelagem ampla e carcela escondida. Veste aberto sobre a regata ou fechada — o streetwear não tem regra.",
    details: [
      "Poplin 100% algodão, 130 g/m²",
      "Modelagem oversized com ombro caído",
      "Carcela com botões em resina fosca",
    ],
    care: "Lavar a 30°C, passar em temperatura média.",
  },
  {
    id: "c18-shorts-beach",
    name: "Shorts Beachwear Elastic",
    category: "bermudas",
    price: 149.9,
    priceFrom: 179.9,
    badge: "Verão",
    image: "assets/img/produtos/shorts-beach.jpg",
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Cinza Mescla", hex: "#a3a3a3" },
    ],
    sizes: ["P", "M", "G", "GG"],
    soldOut: [],
    description:
      "Feito para sair da água direto para o calçadão. Tecido de secagem rápida, cós elástico e comprimento acima do joelho.",
    details: [
      "Poliéster de secagem rápida",
      "Cós elástico com cordão",
      "Bolso traseiro com zíper",
      "Forro em tela",
    ],
    care: "Enxaguar em água doce após o uso no mar.",
  },
];

/* --- Destaques do carrossel / vitrine da home --------------------------- */
const FEATURED_IDS = [
  "c18-tee-oversized",
  "c18-hoodie-classic",
  "c18-jaqueta-cortavento",
  "c18-bermuda-cargo",
  "c18-cropped-ribana",
  "c18-bone-estruturado",
  "c18-jogger-fleece",
  "c18-tee-longline",
];

/* --- Textos da marca (usados em várias páginas) ------------------------- */
const BRAND = {
  name: "Censura 18",
  since: "Since 1989",
  headline: "Há 36 anos sendo referência no streetwear",
  instagram: "https://www.instagram.com/censura18/",
  facebook: "https://www.facebook.com/censura18/",
  threads: "https://www.threads.com/@censura18",
  email: "marketing@c18.com.br",
  whatsapp: "5521998653133",
};
