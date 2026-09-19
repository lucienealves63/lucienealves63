const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/* --------------------------------------------------------------------------
 * Credenciais da base (docs/CREDENCIAIS-BASE.md): os scripts que geram a senha
 * do agendador e o token do feed, o que aplicam URL + anon key no site/painel,
 * a auditoria que impede segredo de ir para o Git e a coerência entre
 * config.toml, Edge Functions, SQL de setup e documentação.
 * ------------------------------------------------------------------------ */

const RAIZ = path.join(__dirname, "..");
const SCRIPT = path.join(RAIZ, "scripts", "credenciais-base.sh");
const AUDITORIA = path.join(RAIZ, "scripts", "auditoria-segredos.sh");
const FUNCOES_DIR = path.join(RAIZ, "supabase", "functions");
const MIGRATIONS_DIR = path.join(RAIZ, "supabase", "migrations");
const SETUP_DIR = path.join(RAIZ, "supabase", "setup");

const FUNCOES = fs
  .readdirSync(FUNCOES_DIR)
  .filter((nome) => !nome.startsWith("_") && fs.statSync(path.join(FUNCOES_DIR, nome)).isDirectory())
  .sort();

const MIGRATIONS = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

const BASE_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTEGRATION_WORKER_SECRET",
  "PUBLIC_APP_ORIGIN",
  "PUBLIC_SITE_URL",
  "GOOGLE_MERCHANT_FEED_TOKEN",
];

const HEX64 = /^[0-9a-f]{64}$/;

function rodar(script, args) {
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function semCor(texto) {
  return texto.replace(/\x1b\[[0-9;]*m/g, "");
}

/* Um repositório de brinquedo, para os scripts poderem escrever à vontade. */
function cenario(t, { env = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c18-cred-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "admin", "assets"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "js"), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, ".env.example"), path.join(dir, ".env.example"));
  fs.copyFileSync(path.join(RAIZ, ".gitignore"), path.join(dir, ".gitignore"));
  fs.copyFileSync(path.join(RAIZ, "admin", "assets", "config.js"), path.join(dir, "admin", "assets", "config.js"));
  fs.copyFileSync(path.join(RAIZ, "assets", "js", "site-config.js"), path.join(dir, "assets", "js", "site-config.js"));
  const arquivo = path.join(dir, ".env.local");
  if (env) fs.writeFileSync(arquivo, env, { mode: 0o600 });
  return { dir, arquivo, args: ["--raiz", dir, "--arquivo", arquivo] };
}

function lerEnv(arquivo, nome) {
  const linha = fs.readFileSync(arquivo, "utf8").split("\n").find((l) => l.startsWith(`${nome}=`));
  return linha ? linha.slice(nome.length + 1) : "";
}

/* ------------------------------------------------------------ .gitignore */

test(".gitignore protege o arquivo de ambiente e mantém o .env.example versionado", () => {
  const linhas = fs.readFileSync(path.join(RAIZ, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(linhas.includes(".env"), ".env precisa estar ignorado");
  assert.ok(linhas.includes(".env.local"), ".env.local precisa estar ignorado");
  assert.ok(linhas.includes("!.env.example"), "o modelo continua versionado por exceção explícita");
  assert.ok(linhas.includes("*.pem") && linhas.includes("*.key"), "chave privada em arquivo também é bloqueada");
  const ordem = [linhas.indexOf(".env.local"), linhas.indexOf("!.env.example")];
  assert.ok(ordem[0] < ordem[1], "a exceção do .env.example vem depois do bloqueio (senão não vale)");
});

test(".env.example traz as variáveis da base, sem nenhum segredo preenchido", () => {
  const texto = fs.readFileSync(path.join(RAIZ, ".env.example"), "utf8");
  for (const nome of BASE_VARS) {
    assert.match(texto, new RegExp(`^${nome}=`, "m"), `${nome} precisa aparecer no modelo`);
  }
  assert.match(texto, /docs\/CREDENCIAIS-BASE\.md/, "o modelo aponta o guia de execução");
  const comValor = texto
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .filter((l) => /(SECRET|TOKEN|PASSWORD|SENHA|SERVICE_ROLE)/.test(l))
    .filter((l) => l.split("=").slice(1).join("=").trim() !== "");
  assert.deepEqual(comValor, [], `o modelo não pode trazer segredo preenchido: ${comValor.join(", ")}`);
});

/* ------------------------------------------------------- gerar segredos */

test("gerar cria o .env.local (modo 600) com senha do agendador e token do feed", (t) => {
  const { args, arquivo } = cenario(t);
  const r = rodar(SCRIPT, ["gerar", ...args]);
  assert.equal(r.status, 0, semCor(r.out));
  const modo = fs.statSync(arquivo).mode & 0o777;
  assert.equal(modo, 0o600, "o arquivo de segredos só pode ser lido pelo dono");

  const worker = lerEnv(arquivo, "INTEGRATION_WORKER_SECRET");
  const feed = lerEnv(arquivo, "GOOGLE_MERCHANT_FEED_TOKEN");
  assert.match(worker, HEX64, "senha do agendador = openssl rand -hex 32 (64 hex)");
  assert.match(feed, HEX64, "token do feed = openssl rand -hex 32 (64 hex)");
  assert.notEqual(worker, feed, "os dois segredos precisam ser diferentes");

  /* o resto do modelo é copiado junto, para o preenchimento ser num lugar só */
  assert.match(fs.readFileSync(arquivo, "utf8"), /^SUPABASE_URL=/m);
  assert.match(fs.readFileSync(arquivo, "utf8"), /^GOOGLE_MERCHANT_ID=/m);
});

test("gerar é idempotente: não troca segredo existente nem o que você preencheu", (t) => {
  const { args, arquivo } = cenario(t);
  assert.equal(rodar(SCRIPT, ["gerar", ...args]).status, 0);
  const worker = lerEnv(arquivo, "INTEGRATION_WORKER_SECRET");
  const feed = lerEnv(arquivo, "GOOGLE_MERCHANT_FEED_TOKEN");

  fs.writeFileSync(
    arquivo,
    fs.readFileSync(arquivo, "utf8").replace(
      /^SUPABASE_URL=.*$/m,
      "SUPABASE_URL=https://meuprojeto.supabase.co",
    ),
  );

  const segunda = rodar(SCRIPT, ["gerar", ...args]);
  assert.equal(segunda.status, 0, semCor(segunda.out));
  assert.match(semCor(segunda.out), /mantido/, "avisa que o segredo foi mantido");
  assert.equal(lerEnv(arquivo, "INTEGRATION_WORKER_SECRET"), worker);
  assert.equal(lerEnv(arquivo, "GOOGLE_MERCHANT_FEED_TOKEN"), feed);
  assert.equal(lerEnv(arquivo, "SUPABASE_URL"), "https://meuprojeto.supabase.co");
  assert.equal(
    fs.readFileSync(arquivo, "utf8").split("\n").filter((l) => l.startsWith("SUPABASE_URL=")).length,
    1,
    "não pode duplicar a linha da variável",
  );
});

test("rotacionar troca os dois segredos e lembra os três lugares para atualizar", (t) => {
  const { args, arquivo } = cenario(t);
  rodar(SCRIPT, ["gerar", ...args]);
  const antes = {
    worker: lerEnv(arquivo, "INTEGRATION_WORKER_SECRET"),
    feed: lerEnv(arquivo, "GOOGLE_MERCHANT_FEED_TOKEN"),
  };
  const r = rodar(SCRIPT, ["rotacionar", ...args]);
  assert.equal(r.status, 0, semCor(r.out));
  const depois = {
    worker: lerEnv(arquivo, "INTEGRATION_WORKER_SECRET"),
    feed: lerEnv(arquivo, "GOOGLE_MERCHANT_FEED_TOKEN"),
  };
  assert.match(depois.worker, HEX64);
  assert.match(depois.feed, HEX64);
  assert.notEqual(antes.worker, depois.worker);
  assert.notEqual(antes.feed, depois.feed);
  const texto = semCor(r.out);
  assert.match(texto, /Secrets/, "lembra do Supabase Secrets");
  assert.match(texto, /Vault/, "lembra do Vault");
  assert.match(texto, /Merchant Center/, "lembra da URL do feed cadastrada no Google");
});

test("status separa o que está pronto do que falta na base", (t) => {
  const { args, arquivo } = cenario(t);
  rodar(SCRIPT, ["gerar", ...args]);
  fs.writeFileSync(
    arquivo,
    fs
      .readFileSync(arquivo, "utf8")
      .replace(/^SUPABASE_URL=.*$/m, "SUPABASE_URL=https://meuprojeto.supabase.co")
      .replace(/^SUPABASE_ANON_KEY=.*$/m, "SUPABASE_ANON_KEY=sb_publishable_abc123"),
  );
  const r = rodar(SCRIPT, ["status", ...args]);
  assert.equal(r.status, 0, semCor(r.out));
  const texto = semCor(r.out);
  assert.match(texto, /✓ SUPABASE_URL = https:…/, "URL preenchida aparece como pronta (mascarada)");
  assert.match(texto, /○ SUPABASE_SERVICE_ROLE_KEY/, "chave de servidor vazia continua pendente");
  assert.match(texto, /○ PUBLIC_SITE_URL/, "o domínio placeholder do modelo continua pendente");
  assert.match(texto, /4 de 7 variáveis da base preenchidas/, "URL, anon key e os dois segredos gerados");
  assert.match(texto, /02_primeiro_admin\.sql/, "lembra o SQL do primeiro admin");

  const claro = semCor(rodar(SCRIPT, ["status", ...args, "--mostrar"]).out);
  assert.match(claro, /SUPABASE_ANON_KEY = sb_publishable_abc123/, "--mostrar abre o valor");
  assert.doesNotMatch(texto, /sb_publishable_abc123/, "sem --mostrar o valor sai mascarado");
});

/* --------------------------------------------------------- aplicar-config */

const URL_OK = "https://meuprojeto.supabase.co";
const ANON_OK = "sb_publishable_abcdefghijklmnopqrstuvxz";

test("aplicar-config liga site e painel ao Supabase sem tocar nos comentários", (t) => {
  const { dir, args, arquivo } = cenario(t, {
    env: `SUPABASE_URL=${URL_OK}\nSUPABASE_ANON_KEY=${ANON_OK}\n`,
  });
  const r = rodar(SCRIPT, ["aplicar-config", ...args]);
  assert.equal(r.status, 0, semCor(r.out));

  const admin = fs.readFileSync(path.join(dir, "admin", "assets", "config.js"), "utf8");
  assert.match(admin, /mode: "supabase",/);
  assert.match(admin, new RegExp(`supabaseUrl: "${URL_OK.replace(/\./g, "\\.")}",`));
  assert.match(admin, new RegExp(`supabaseAnonKey: "${ANON_OK}",`));
  assert.match(admin, /lowStockThreshold: 3,/, "o resto do arquivo continua intacto");
  assert.match(admin, /Nunca coloque service_role/, "o comentário de aviso sobrevive");

  const site = fs.readFileSync(path.join(dir, "assets", "js", "site-config.js"), "utf8");
  assert.match(site, /^ {2}mode: "supabase",$/m, "só a linha de código muda de modo");
  assert.match(site, new RegExp(`supabaseAnonKey: "${ANON_OK}",`));
  assert.match(site, /mode: "static"   → lê do localStorage/, "o comentário do topo não vira código");
});

test("aplicar-config recusa chave de servidor no lugar da anon key", (t) => {
  const jwtService = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role","iss":"supabase"}')
    .toString("base64url")}.assinatura`;
  for (const chave of ["sb_secret_supersecreta1234567890", jwtService]) {
    const { dir, args, arquivo } = cenario(t, {
      env: `SUPABASE_URL=${URL_OK}\nSUPABASE_ANON_KEY=${chave}\n`,
    });
    const r = rodar(SCRIPT, ["aplicar-config", ...args]);
    assert.equal(r.status, 1, `precisa recusar ${chave.slice(0, 12)}…`);
    assert.match(semCor(r.out), /chave de SERVIDOR/);
    const admin = fs.readFileSync(path.join(dir, "admin", "assets", "config.js"), "utf8");
    assert.match(admin, /mode: "demo",/, "nada foi alterado");
    assert.match(admin, /supabaseAnonKey: "",/);
  }
});

test("aplicar-config exige https e URL preenchida", (t) => {
  for (const [env, espera] of [
    [`SUPABASE_URL=http://inseguro.supabase.co\nSUPABASE_ANON_KEY=${ANON_OK}\n`, /https:\/\//],
    ["SUPABASE_URL=\nSUPABASE_ANON_KEY=\n", /SUPABASE_URL não preenchida/],
    [`SUPABASE_URL=${URL_OK}\nSUPABASE_ANON_KEY=\n`, /SUPABASE_ANON_KEY não preenchida/],
    [`SUPABASE_URL=${URL_OK}\nSUPABASE_ANON_KEY=${ANON_OK} com espaço\n`, /caractere que não pode/],
  ]) {
    const { dir, args, arquivo } = cenario(t, { env });
    const r = rodar(SCRIPT, ["aplicar-config", ...args]);
    assert.equal(r.status, 1, `deve falhar com: ${env.split("\n")[0]}`);
    assert.match(semCor(r.out), espera);
    assert.match(fs.readFileSync(path.join(dir, "admin", "assets", "config.js"), "utf8"), /mode: "demo",/);
  }
});

test("reverter-config volta ao modo demonstração sem apagar URL e chave", (t) => {
  const { dir, args, arquivo } = cenario(t, { env: `SUPABASE_URL=${URL_OK}\nSUPABASE_ANON_KEY=${ANON_OK}\n` });
  rodar(SCRIPT, ["aplicar-config", ...args]);
  const r = rodar(SCRIPT, ["reverter-config", ...args]);
  assert.equal(r.status, 0, semCor(r.out));
  const admin = fs.readFileSync(path.join(dir, "admin", "assets", "config.js"), "utf8");
  const site = fs.readFileSync(path.join(dir, "assets", "js", "site-config.js"), "utf8");
  assert.match(admin, /mode: "demo",/);
  assert.match(site, /^ {2}mode: "static",$/m);
  assert.match(admin, new RegExp(`supabaseUrl: "${URL_OK.replace(/\./g, "\\.")}"`), "URL continua gravada");
  assert.match(site, new RegExp(`supabaseAnonKey: "${ANON_OK}"`), "anon key continua gravada");
});

test("comandos imprime secrets, Vault, deploy das funções, URL do feed e o curl de teste", (t) => {
  const worker = "a".repeat(64);
  const feed = "b".repeat(64);
  const { args, arquivo } = cenario(t, {
    env: [
      `SUPABASE_URL=${URL_OK}`,
      `SUPABASE_ANON_KEY=${ANON_OK}`,
      "SUPABASE_SERVICE_ROLE_KEY=sb_secret_exemplo1234567890",
      `INTEGRATION_WORKER_SECRET=${worker}`,
      `GOOGLE_MERCHANT_FEED_TOKEN=${feed}`,
      "PUBLIC_APP_ORIGIN=https://lucienealves63.github.io/lucienealves63",
      "PUBLIC_SITE_URL=https://lucienealves63.github.io/lucienealves63",
    ].join("\n"),
  });
  const r = rodar(SCRIPT, ["comandos", ...args]);
  assert.equal(r.status, 0, semCor(r.out));
  const texto = semCor(r.out);

  assert.match(texto, /supabase secrets set/, "linha de segredos pronta");
  assert.match(texto, new RegExp(`INTEGRATION_WORKER_SECRET='${worker}'`));
  assert.match(texto, new RegExp(`GOOGLE_MERCHANT_FEED_TOKEN='${feed}'`));
  assert.match(texto, /PUBLIC_SITE_URL='https:\/\/lucienealves63\.github\.io\/lucienealves63'/);
  assert.match(texto, /reserved secret/, "avisa que URL/service_role já vêm injetados");
  assert.match(texto, /01_vault_worker_secret\.sql/, "aponta o SQL do Vault");

  for (const fn of FUNCOES) {
    assert.match(texto, new RegExp(`supabase functions deploy ${fn}`), `falta o deploy de ${fn}`);
  }
  assert.match(texto, new RegExp(`${URL_OK.replace(/\./g, "\\.")}/functions/v1/google-merchant-feed\\?token=${feed}`));
  assert.match(texto, new RegExp(`x-worker-secret: ${worker}`), "o curl de teste do agendador sai pronto");
  assert.match(texto, /02_primeiro_admin\.sql/, "lembra o SQL do primeiro usuário admin");
});

/* ---------------------------------------------------------------- auditoria */

test("auditoria-segredos passa num repositório limpo", (t) => {
  const { args, arquivo } = cenario(t);
  rodar(SCRIPT, ["gerar", ...args]);
  const r = rodar(AUDITORIA, args);
  assert.equal(r.status, 0, semCor(r.out));
  const texto = semCor(r.out);
  assert.match(texto, /Nenhum vazamento encontrado/);
  assert.match(texto, /segredos do \.env\.local não aparecem em arquivo versionado/);
});

test("auditoria-segredos acha chave de servidor, JWT de service_role e segredo do .env.local", (t) => {
  const worker = "c".repeat(64);
  const { dir, args, arquivo } = cenario(t, {
    env: `SUPABASE_URL=${URL_OK}\nINTEGRATION_WORKER_SECRET=${worker}\n`,
  });
  const jwtService = [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from('{"role":"service_role"}').toString("base64url"),
    "assinaturafalsa1234567890",
  ].join(".");
  fs.writeFileSync(path.join(dir, "assets", "js", "vazou.js"), `const segredo = "${worker}";\n`);
  fs.writeFileSync(path.join(dir, "assets", "js", "chave.js"), 'const k = "sb_secret_abcdefghijklmnop1234";\n');
  fs.writeFileSync(path.join(dir, "assets", "js", "jwt.js"), `const j = "${jwtService}";\n`);
  fs.writeFileSync(
    path.join(dir, "chave-conta-servico.json"),
    '{"private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCx\\n-----END PRIVATE KEY-----\\n"}\n',
  );
  fs.writeFileSync(
    path.join(dir, "admin", "assets", "config.js"),
    fs
      .readFileSync(path.join(dir, "admin", "assets", "config.js"), "utf8")
      .replace('supabaseAnonKey: "",', 'supabaseAnonKey: "sb_secret_dentro-do-painel",'),
  );

  const r = rodar(AUDITORIA, args);
  assert.equal(r.status, 1, "precisa falhar quando há vazamento");
  const texto = semCor(r.out);
  assert.match(texto, /vazou\.js/, "aponta o arquivo com a senha do agendador");
  assert.match(texto, /INTEGRATION_WORKER_SECRET aparece em/);
  assert.match(texto, /chave sb_secret_ em arquivo que vai para o Git/);
  assert.match(texto, /JWT de service_role versionado/);
  assert.match(texto, /config\.js guarda uma chave de servidor na supabaseAnonKey/);
  assert.match(texto, /chave privada \(PEM\) versionada: chave-conta-servico\.json/);
  assert.match(texto, /5 vazamento\(s\) encontrado\(s\)/);
});

test("auditoria-segredos reclama quando o .gitignore deixa de proteger o .env", (t) => {
  const { dir, args, arquivo } = cenario(t);
  rodar(SCRIPT, ["gerar", ...args]);
  fs.writeFileSync(path.join(dir, ".gitignore"), "# sem proteção nenhuma\n.DS_Store\n");
  const r = rodar(AUDITORIA, args);
  assert.equal(r.status, 1);
  assert.match(semCor(r.out), /\.gitignore não bloqueia \.env\/\.env\.local/);
});

test("auditoria-segredos do repositório real não acha nada", () => {
  const r = rodar(AUDITORIA, ["--raiz", RAIZ]);
  assert.equal(r.status, 0, semCor(r.out));
  assert.match(semCor(r.out), /Nenhum vazamento encontrado/);
});

/* ------------------------------------------------------- Edge Functions */

test("config.toml desliga verify_jwt para toda função publicada", () => {
  const toml = fs.readFileSync(path.join(RAIZ, "supabase", "config.toml"), "utf8");
  for (const fn of FUNCOES) {
    const bloco = new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`);
    assert.match(toml, bloco, `${fn} precisa de verify_jwt = false`);
  }
  const blocos = (toml.match(/^\[functions\./gm) || []).length;
  assert.equal(blocos, FUNCOES.length, "sem função esquecida nem bloco sobrando");
  assert.match(
    toml,
    /sb_publishable_|verify_jwt/i,
    "o arquivo explica por que a verificação de JWT fica desligada",
  );
});

test("cada Edge Function se autentica sozinha (a porta do JWT fica aberta)", () => {
  const PUBLICAS = ["cotar-frete"]; // cotação de frete do checkout: pública por desenho
  for (const fn of FUNCOES) {
    const codigo = fs.readFileSync(path.join(FUNCOES_DIR, fn, "index.ts"), "utf8");
    if (PUBLICAS.includes(fn)) {
      assert.doesNotMatch(
        codigo,
        /SUPABASE_SERVICE_ROLE_KEY|integration_outbox/,
        `${fn} é pública: não pode mexer em dado interno`,
      );
      continue;
    }
    const guardas = [
      "requireAdmin",           // sessão do painel com papel admin
      "workerSecretMatches",    // x-worker-secret (agendador)
      "x-worker-secret",        // idem, conferido direto no cabeçalho
      "feedTokenMatches",       // ?token= (coleta do Google)
      "clearsale-apikey",       // webhook da ClearSale
    ];
    const usa = guardas.filter((g) => codigo.includes(g));
    assert.ok(usa.length > 0, `${fn} precisa ter guarda própria (achou: ${usa.join(", ") || "nenhuma"})`);
  }
});

test("requireAdmin confere o JWT da sessão, não o objeto Request", () => {
  const auth = fs.readFileSync(path.join(FUNCOES_DIR, "_shared", "auth.ts"), "utf8");
  assert.match(auth, /export function bearerToken/, "extrai o Bearer do cabeçalho");
  assert.match(auth, /client\.auth\.getUser\(token\)/, "manda o token para o getUser");
  assert.doesNotMatch(auth, /getUser\(request\)/, "getUser(request) sempre devolve 401");
  assert.match(auth, /data\?\.user/, "o retorno do getUser é { data: { user }, error }");

  for (const fn of FUNCOES) {
    const codigo = fs.readFileSync(path.join(FUNCOES_DIR, fn, "index.ts"), "utf8");
    assert.doesNotMatch(codigo, /getUser\(request\)/, `${fn} não pode passar o Request ao getUser`);
  }
});

/* ------------------------------------------------------------- SQL setup */

test("setup SQL cobre pré-requisitos, Vault, primeiro admin e conferência", () => {
  const arquivos = fs.readdirSync(SETUP_DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(arquivos, [
    "00_pre_requisitos.sql",
    "01_vault_worker_secret.sql",
    "02_primeiro_admin.sql",
    "03_checagem_base.sql",
  ]);
  for (const f of arquivos) {
    const sql = fs.readFileSync(path.join(SETUP_DIR, f), "utf8");
    const aberturas = (sql.match(/\$\$/g) || []).length;
    assert.equal(aberturas % 2, 0, `${f}: blocos $$ desbalanceados`);
    assert.doesNotMatch(sql, /\t/, `${f}: o repositório usa espaços`);
  }
});

test("o segredo do Vault tem o mesmo nome que as migrations e o worker leem", () => {
  const vault = fs.readFileSync(path.join(SETUP_DIR, "01_vault_worker_secret.sql"), "utf8");
  const schedules = fs.readFileSync(path.join(MIGRATIONS_DIR, "202609180006_growth_schedules.sql"), "utf8");
  const worker = fs.readFileSync(path.join(FUNCOES_DIR, "integration-worker", "index.ts"), "utf8");
  const auth = fs.readFileSync(path.join(FUNCOES_DIR, "_shared", "auth.ts"), "utf8");

  assert.match(vault, /vault\.create_secret\(/);
  assert.match(vault, /vault\.update_secret\(/, "rotação atualiza em vez de duplicar");
  assert.match(vault, /'INTEGRATION_WORKER_SECRET'/);
  assert.match(vault, /char_length\(v_secret\) < 32/, "recusa segredo curto");
  assert.match(schedules, /where name = 'INTEGRATION_WORKER_SECRET'/, "é desse nome que o pg_cron lê");
  assert.match(worker, /requiredEnv\("INTEGRATION_WORKER_SECRET"\)/);
  assert.match(auth, /INTEGRATION_WORKER_SECRET/);
});

test("00_pre_requisitos habilita o que as migrations de agendamento exigem", () => {
  const sql = fs.readFileSync(path.join(SETUP_DIR, "00_pre_requisitos.sql"), "utf8");
  for (const ext of ["pg_cron", "pg_net", "supabase_vault"]) {
    assert.match(sql, new RegExp(`create extension if not exists ${ext}`), ext);
  }
  assert.match(sql, /app\.settings\.supabase_url/, "define a URL que as migrations leem");
  assert.match(sql, /alter database %I set app\.settings\.supabase_url/);
  assert.match(sql, /SEU-PROJETO/, "recusa rodar com o placeholder no lugar da URL");

  const schedules = fs.readFileSync(path.join(MIGRATIONS_DIR, "202609180006_growth_schedules.sql"), "utf8");
  assert.match(schedules, /current_setting\('app\.settings\.supabase_url', true\)/);
  for (const ext of ["pg_cron", "pg_net"]) {
    assert.match(schedules, new RegExp(`extname = '${ext}'`));
  }
});

test("02_primeiro_admin promove em public.profiles e não deixa o projeto sem admin", () => {
  const sql = fs.readFileSync(path.join(SETUP_DIR, "02_primeiro_admin.sql"), "utf8");
  assert.match(sql, /insert into public\.profiles/);
  assert.match(sql, /on conflict \(id\) do update/, "rodar duas vezes não duplica perfil");
  assert.match(sql, /set role = 'admin'/);
  assert.match(sql, /from auth\.users/, "procura o usuário criado no Auth");
  assert.match(sql, /raise exception 'Usuário % não encontrado/, "avisa se o usuário ainda não existe");
  assert.match(sql, /role = 'admin' and active/, "checa que sobrou ao menos um admin ativo");
  assert.doesNotMatch(sql, /public\.profiles\.full_name/, "no ON CONFLICT a linha antiga é 'profiles'");

  const nucleo = fs.readFileSync(path.join(MIGRATIONS_DIR, "202609170001_operations.sql"), "utf8");
  assert.match(nucleo, /create type public\.app_role as enum \('admin'/, "o papel admin existe no enum");
  assert.match(nucleo, /on_auth_user_created/, "todo usuário nasce com perfil (viewer)");
});

test("03_checagem_base confere extensões, agendamentos, Vault, admin, canais e estoque", () => {
  const sql = fs.readFileSync(path.join(SETUP_DIR, "03_checagem_base.sql"), "utf8");
  assert.match(sql, /pg_extension/, "extensões");
  assert.match(sql, /app\.settings\.supabase_url/, "URL do projeto");
  assert.match(sql, /cron\.job/, "agendamentos");
  assert.match(sql, /vault\.decrypted_secrets/, "segredo do agendador");
  assert.match(sql, /public\.profiles/, "administradores");
  assert.match(sql, /public\.sales_channels/, "canais semeados");
  assert.match(sql, /public\.stores/, "loja do estoque central");
  assert.doesNotMatch(sql, /^\s*(insert|update|delete|drop|alter)\s/im, "a conferência não pode alterar nada");

  /* os nomes dos agendamentos citados são os que as migrations criam */
  const jobs = ["c18-analytics-purge", "c18-marketing-events-flush", "c18-channel-publish", "c18-integration-worker", "c18-google-ads-conversions"];
  const migrations = MIGRATIONS.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")).join("\n");
  for (const job of jobs) {
    assert.match(sql, new RegExp(job), `${job} citado na conferência`);
    assert.match(migrations, new RegExp(`'${job}'`), `${job} criado por alguma migration`);
  }
});

/* ------------------------------------------------------------- documentação */

test("o guia da base acompanha o repositório: migrations, funções e segredos", () => {
  const doc = fs.readFileSync(path.join(RAIZ, "docs", "CREDENCIAIS-BASE.md"), "utf8");

  for (const m of MIGRATIONS) {
    assert.match(doc, new RegExp(m.replace(/\./g, "\\.")), `o guia precisa citar ${m}`);
  }
  const ordem = MIGRATIONS.map((m) => doc.indexOf(m));
  assert.deepEqual(
    ordem,
    [...ordem].sort((a, b) => a - b),
    "as migrations aparecem no guia na ordem de execução",
  );
  for (const fn of FUNCOES) {
    assert.match(doc, new RegExp(`supabase functions deploy ${fn}`), `deploy de ${fn} no guia`);
  }
  for (const nome of BASE_VARS) {
    assert.match(doc, new RegExp(nome), `${nome} no guia`);
  }
  for (const arquivo of ["00_pre_requisitos.sql", "01_vault_worker_secret.sql", "02_primeiro_admin.sql", "03_checagem_base.sql"]) {
    assert.match(doc, new RegExp(arquivo.replace(/\./g, "\\.")), `${arquivo} no guia`);
  }
  for (const comando of ["gerar", "status", "comandos", "aplicar-config", "reverter-config", "rotacionar"]) {
    assert.match(doc, new RegExp(`credenciais-base\\.sh ${comando}`), `comando '${comando}' documentado`);
  }
  assert.match(doc, /auditoria-segredos\.sh/);
  assert.match(doc, /verify_jwt = false/, "explica o verify_jwt desligado");
  assert.match(doc, /sb_publishable_|sb_secret_/, "fala das chaves novas do Supabase");
  assert.match(doc, /South America \(São Paulo\)/, "indica a região do projeto");
});

test("CREDENCIAIS.md e LEIA-ME.md apontam para o guia de execução", () => {
  const credenciais = fs.readFileSync(path.join(RAIZ, "docs", "CREDENCIAIS.md"), "utf8");
  const leiaMe = fs.readFileSync(path.join(RAIZ, "LEIA-ME.md"), "utf8");
  assert.match(credenciais, /CREDENCIAIS-BASE\.md/, "a seção Base liga o passo a passo");
  assert.match(credenciais, /scripts\/credenciais-base\.sh/);
  assert.match(leiaMe, /CREDENCIAIS-BASE\.md/, "o LEIA-ME lista o guia novo");
  assert.match(leiaMe, /scripts\//, "o LEIA-ME mostra a pasta de scripts");
  assert.match(leiaMe, /supabase\/setup/, "o LEIA-ME mostra o SQL de setup");
});
