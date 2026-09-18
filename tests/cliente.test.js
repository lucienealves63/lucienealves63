const test = require("node:test");
const assert = require("node:assert/strict");
const Cliente = require("../assets/js/cliente.js");

/* ------------------------------------------------------- normalização */
test("normaliza nome, e-mail e telefone", () => {
  assert.equal(Cliente.normalizeNome("  Maria   Silva "), "Maria Silva");
  assert.equal(Cliente.normalizeEmail("  MARIA@Email.COM "), "maria@email.com");
  assert.equal(Cliente.normalizeTelefone("(21) 98765-4321"), "21987654321");
  assert.equal(Cliente.formatTelefone("21987654321"), "(21) 98765-4321");
  assert.equal(Cliente.formatTelefone("2143219876"), "(21) 4321-9876");
  assert.equal(Cliente.formatTelefone("21"), "21");
  assert.equal(Cliente.formatCep("26275280"), "26275-280");
  assert.equal(Cliente.normalizeUf(" rj "), "RJ");
  assert.equal(Cliente.normalizeTexto("  rua   das  letras  ", 120), "rua das letras");
});

/* --------------------------------------------------------- validação */
test("telefone precisa de DDD e 10 ou 11 dígitos", () => {
  assert.equal(Cliente.isTelefoneValida("21987654321"), true);
  assert.equal(Cliente.isTelefoneValida("2143219876"), true);
  assert.equal(Cliente.isTelefoneValida("2198765432"), false); /* 10 dígitos incompletos */
  assert.equal(Cliente.isTelefoneValida("987654321"), false); /* sem DDD */
  assert.equal(Cliente.isTelefoneValida("2112345678"), false); /* fixo começando em 1 */
  assert.equal(Cliente.isTelefoneValida("21900000000"), true); /* móvel 9… ok */
  assert.equal(Cliente.isTelefoneValida(""), false);
});

test("e-mail e senha", () => {
  assert.equal(Cliente.isEmailValida("maria@email.com"), true);
  assert.equal(Cliente.isEmailValida("maria@email"), false);
  assert.equal(Cliente.isEmailValida("maria email.com"), false);
  assert.equal(Cliente.isSenhaValida("12345678"), true);
  assert.equal(Cliente.isSenhaValida("1234567"), false);
});

/* --------------------------------------------------- cadastro completo */
test("validarCadastro: ok com dados completos e consentimento", () => {
  const r = Cliente.validarCadastro({
    nome: "Maria Silva",
    email: "maria@email.com",
    telefone: "(21) 98765-4321",
    senha: "senha segura",
    cep: "26275-280",
    uf: "rj",
    consentimento: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.dados.telefone, "21987654321");
  assert.equal(r.dados.cep, "26275280");
  assert.equal(r.dados.uf, "RJ");
});

test("validarCadastro: aponta cada erro do formulário", () => {
  const r = Cliente.validarCadastro({
    nome: "Maria",
    email: "x",
    telefone: "123",
    senha: "123",
    cep: "123",
    consentimento: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.erros.nome, /sobrenome/);
  assert.match(r.erros.email, /E-mail/);
  assert.match(r.erros.telefone, /DDD/);
  assert.match(r.erros.senha, /8 caracteres/);
  assert.match(r.erros.cep, /CEP/);
  assert.match(r.erros.consentimento, /consentimento/);
});

test("endereço opcional: CEP e UF opcionais, mas certos", () => {
  const vazio = Cliente.validarEndereco({});
  assert.equal(vazio.ok, true);
  assert.equal(Cliente.validarEndereco({ cep: "26275-280", uf: "RJ" }).ok, true);
  const errado = Cliente.validarEndereco({ cep: "26275-28", uf: "RJJ" });
  assert.equal(errado.ok, false);
  assert.ok(errado.erros.cep);
  assert.ok(errado.erros.uf);
});

/* -------------------------------------------------------- WhatsApp */
test("linhas do WhatsApp identificam o cliente e o endereço", () => {
  const linhas = Cliente.linhasWhatsApp({
    nome: "Maria Silva",
    telefone: "21987654321",
    rua: "Rua da Matriz",
    numero: "100",
    complemento: "sala 2",
    cidade: "Nova Iguaçu",
    uf: "RJ",
    cep: "26275280",
  });
  assert.deepEqual(linhas, [
    "*Cliente cadastrado:* Maria Silva",
    "*WhatsApp:* (21) 98765-4321",
    "*Endereço:* Rua da Matriz, 100, sala 2 — Nova Iguaçu/RJ",
    "*CEP:* 26275-280",
  ]);

  assert.deepEqual(Cliente.linhasWhatsApp(null), []);
  assert.deepEqual(Cliente.linhasWhatsApp({ nome: "" }), []);
});

/* --------------------------------------------- perfil na sessão (LGPD) */
test("cache do perfil respeita a escolha 'Só o essencial' da LGPD", () => {
  const memoria = new Map();
  const fakeStorage = {
    getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
    setItem: (k, v) => memoria.set(k, String(v)),
    removeItem: (k) => memoria.delete(k),
  };
  const sandbox = {
    localStorage: fakeStorage,
    C18LGPD: { canPersistPreferences: () => false },
  };
  const salvar = Function(
    "sandbox",
    "with (sandbox) { return arguments; }"
  );
  void salvar;

  /* executa o módulo num escopo com window simulado */
  const codigo = require("fs").readFileSync("assets/js/cliente.js", "utf8");
  const janela = { localStorage: fakeStorage, C18LGPD: { canPersistPreferences: () => false } };
  new Function("window", "globalThis", codigo)(janela, janela);
  const C = janela.C18Cliente;

  C.definirAtual({ nome: "Maria Silva", telefone: "21987654321", cep: "26275280" });
  assert.equal(memoria.has("c18:cliente-atual"), false); /* LGPD essencial não grava */
  assert.equal(C.currente().nome, "Maria Silva"); /* mas fica em memória */

  const janela2 = { localStorage: fakeStorage, C18LGPD: { canPersistPreferences: () => true } };
  new Function("window", "globalThis", codigo)(janela2, janela2);
  const C2 = janela2.C18Cliente;
  C2.definirAtual({ nome: "João Souza", cep: "20000000" });
  assert.equal(memoria.has("c18:cliente-atual"), true);
  assert.equal(JSON.parse(memoria.get("c18:cliente-atual")).nome, "João Souza");

  C2.sair();
  assert.equal(memoria.has("c18:cliente-atual"), false);
  assert.equal(C2.currente(), null);
});
