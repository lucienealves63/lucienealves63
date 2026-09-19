#!/usr/bin/env bash
# =============================================================================
# Censura 18 — credenciais da base (bloco "Base — Agora" de docs/CREDENCIAIS.md)
#
# Faz o que dá para fazer sem acesso às contas: gera os dois segredos que
# você mesma produz (senha do agendador e token do feed), guarda tudo num
# .env.local FORA do Git, confere o que falta, imprime os comandos prontos do
# Supabase e liga o site/painel ao projeto (URL + anon key).
#
# O que só a titular das contas consegue (copiar do painel do Supabase, criar
# o primeiro usuário) continua manual — o passo a passo está em
# docs/CREDENCIAIS-BASE.md.
#
# Uso:
#   scripts/credenciais-base.sh gerar            # padrão: cria .env.local + segredos
#   scripts/credenciais-base.sh status           # o que está pronto e o que falta
#   scripts/credenciais-base.sh comandos         # comandos prontos para copiar
#   scripts/credenciais-base.sh aplicar-config   # URL + anon key no site e no painel
#   scripts/credenciais-base.sh reverter-config  # volta ao modo demonstração
#   scripts/credenciais-base.sh rotacionar       # troca os dois segredos
#
# Opções:
#   --arquivo CAMINHO   arquivo de ambiente (padrão: <raiz>/.env.local)
#   --raiz CAMINHO      raiz do repositório (padrão: pasta acima de scripts/)
#   --mostrar           imprime os segredos em texto claro
#   -h | --ajuda        esta ajuda
# =============================================================================
set -euo pipefail

RAIZ="${C18_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${C18_ENV_FILE:-}"
MOSTRAR=0
COMANDO=""

# Variáveis do bloco "Base — Agora" (docs/CREDENCIAIS.md, seção 1).
BASE_VARS=(
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  INTEGRATION_WORKER_SECRET
  PUBLIC_APP_ORIGIN
  PUBLIC_SITE_URL
  GOOGLE_MERCHANT_FEED_TOKEN
)
# Segredos que este script gera (32 bytes em hexadecimal = 64 caracteres).
GERADAS=(INTEGRATION_WORKER_SECRET GOOGLE_MERCHANT_FEED_TOKEN)

FUNCOES=(
  gerar-banner integration-worker clearsale-webhook cotar-frete
  google-merchant-feed marketing-events google-ads-conversions channel-publish
)

# ----------------------------------------------------------------- utilidades
titulo() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()     { printf '  \033[32m✓\033[0m %s\n' "$1"; }
falta()  { printf '  \033[33m○\033[0m %s\n' "$1"; }
erro()   { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }
aviso()  { printf '  \033[36m!\033[0m %s\n' "$1"; }

# Imprime o cabeçalho do arquivo (do 3º caractere de linha até o fechamento).
ajuda() { awk 'NR > 2 && /^# =+$/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"; }

aleatorio_hex() {
  # 32 bytes → 64 caracteres hexadecimais (mesma receita do docs/CREDENCIAIS.md)
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

mascara() {
  local valor="$1"
  if [[ -z "$valor" ]]; then printf '(vazio)'; return; fi
  if (( ${#valor} <= 12 )); then printf '%s… (%d caracteres)' "${valor:0:2}" "${#valor}"; return; fi
  printf '%s…%s (%d caracteres)' "${valor:0:6}" "${valor: -4}" "${#valor}"
}

base64url_decode() {
  local data="${1//_//}"
  data="${data//-/+}"
  local resto=$(( ${#data} % 4 )) i
  if (( resto )); then for ((i = resto; i < 4; i++)); do data+="="; done; fi
  printf '%s' "$data" | base64 -d 2>/dev/null || true
}

ler_var() {  # ler_var NOME → valor (tudo depois do primeiro "=")
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

gravar_var() {  # gravar_var NOME VALOR
  local nome="$1" valor="$2"
  if grep -q "^${nome}=" "$ENV_FILE"; then
    awk -v n="$nome" -v v="$valor" 'index($0, n "=") == 1 { print n "=" v; next } { print }' \
      "$ENV_FILE" > "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$nome" "$valor" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

parece_chave_secreta() {  # service_role / sb_secret_ nunca vão para o navegador
  local valor="$1" payload
  [[ -z "$valor" ]] && return 1
  case "$valor" in
    sb_secret_*) return 0 ;;
    eyJ*)
      payload="$(base64url_decode "$(printf '%s' "$valor" | cut -d. -f2)")"
      [[ "$payload" == *service_role* ]] && return 0
      ;;
  esac
  return 1
}

chave_publica_valida() {
  local valor="$1"
  [[ "$valor" == sb_publishable_* ]] && return 0
  [[ "$valor" == eyJ* ]] && return 0
  return 1
}

# ------------------------------------------------------------ criar .env.local
garantir_arquivo() {
  if [[ -f "$ENV_FILE" ]]; then return 0; fi
  if [[ ! -f "${RAIZ}/.env.example" ]]; then
    erro ".env.example não encontrado em ${RAIZ} — confira --raiz."
    exit 1
  fi
  {
    printf '# .env.local — credenciais reais da Censura 18 (NÃO versionar).\n'
    printf '# Criado por scripts/credenciais-base.sh em %s.\n' "$(date '+%d/%m/%Y %H:%M')"
    printf '# Regra de ouro: segredo só entra aqui e no Supabase (Secrets/Vault).\n'
    printf '# Passo a passo: docs/CREDENCIAIS-BASE.md\n\n'
    cat "${RAIZ}/.env.example"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "criado ${ENV_FILE} (cópia de .env.example, ignorado pelo Git)"
}

gerar_segredos() {
  local forcar="${1:-0}" nome atual novo
  garantir_arquivo
  for nome in "${GERADAS[@]}"; do
    atual="$(ler_var "$nome")"
    if [[ -n "$atual" && "$forcar" != "1" ]]; then
      ok "${nome} já existe — mantido (use 'rotacionar' para trocar)"
      continue
    fi
    novo="$(aleatorio_hex)"
    gravar_var "$nome" "$novo"
    if (( forcar )); then ok "${nome} trocado: $(mascara "$novo")"; else ok "${nome} gerado: $(mascara "$novo")"; fi
  done
}

# ---------------------------------------------------------------------- status
status() {
  titulo "Credenciais da base — ${ENV_FILE}"
  if [[ ! -f "$ENV_FILE" ]]; then
    aviso "arquivo ainda não existe: rode 'scripts/credenciais-base.sh gerar'"
  fi
  local nome valor prontos=0
  for nome in "${BASE_VARS[@]}"; do
    valor="$(ler_var "$nome")"
    case "$valor" in
      ""|*SEU-PROJETO*|*seudominio*) falta "${nome} — falta preencher" ;;
      *)
        if (( MOSTRAR )); then ok "${nome} = ${valor}"; else ok "${nome} = $(mascara "$valor")"; fi
        prontos=$((prontos + 1))
        ;;
    esac
  done

  titulo "Site e painel (arquivos públicos)"
  local config_admin="${RAIZ}/admin/assets/config.js"
  local config_site="${RAIZ}/assets/js/site-config.js"
  local modo_admin modo_site
  if [[ ! -f "$config_admin" || ! -f "$config_site" ]]; then
    aviso "config.js/site-config.js não encontrados em ${RAIZ} — confira --raiz"
  else
    modo_admin="$(sed -n 's/.*mode: "\([a-z]*\)".*/\1/p' "$config_admin" | head -n1)"
    modo_site="$(sed -n 's/.*mode: "\([a-z]*\)".*/\1/p' "$config_site" | head -n1)"
    if [[ "$modo_admin" == "supabase" ]]; then ok "admin/assets/config.js → mode \"supabase\""
    else falta "admin/assets/config.js → mode \"${modo_admin}\" (demonstração)"; fi
    if [[ "$modo_site" == "supabase" ]]; then ok "assets/js/site-config.js → mode \"supabase\""
    else falta "assets/js/site-config.js → mode \"${modo_site}\" (demonstração)"; fi
    if grep -q 'supabaseUrl: ""' "$config_admin"; then
      falta "URL/anon key em config.js — use 'aplicar-config' depois de preencher o .env.local"
    else
      ok "URL/anon key preenchidos em config.js"
    fi
  fi

  titulo "Banco e primeiro administrador"
  falta "Migrations rodadas (13 arquivos de supabase/migrations/, na ordem)"
  falta "Segredo do agendador no Vault — supabase/setup/01_vault_worker_secret.sql"
  falta "Primeiro usuário admin — supabase/setup/02_primeiro_admin.sql"
  falta "Conferência final — supabase/setup/03_checagem_base.sql"

  titulo "Resumo"
  printf '  %d de %d variáveis da base preenchidas.\n' "$prontos" "${#BASE_VARS[@]}"
  printf '  Auditoria de vazamento: scripts/auditoria-segredos.sh\n'
  printf '  Comandos prontos:       scripts/credenciais-base.sh comandos\n'
}

# -------------------------------------------------------------------- comandos
comandos() {
  local url anon service worker feed origin site
  url="$(ler_var SUPABASE_URL)"; anon="$(ler_var SUPABASE_ANON_KEY)"
  service="$(ler_var SUPABASE_SERVICE_ROLE_KEY)"; worker="$(ler_var INTEGRATION_WORKER_SECRET)"
  feed="$(ler_var GOOGLE_MERCHANT_FEED_TOKEN)"; origin="$(ler_var PUBLIC_APP_ORIGIN)"
  site="$(ler_var PUBLIC_SITE_URL)"

  titulo "1) Supabase Secrets (Project Settings → Edge Functions → Secrets)"
  echo "# Com o CLI vinculado ao projeto (supabase link --project-ref SEU-REF):"
  local pares=()
  [[ -n "$url" && "$url" != *SEU-PROJETO* ]] && pares+=("SUPABASE_URL='${url}'")
  [[ -n "$service" ]] && pares+=("SUPABASE_SERVICE_ROLE_KEY='${service}'")
  [[ -n "$worker" ]] && pares+=("INTEGRATION_WORKER_SECRET='${worker}'")
  [[ -n "$feed" ]] && pares+=("GOOGLE_MERCHANT_FEED_TOKEN='${feed}'")
  [[ -n "$origin" && "$origin" != *seudominio* ]] && pares+=("PUBLIC_APP_ORIGIN='${origin}'")
  [[ -n "$site" && "$site" != *seudominio* ]] && pares+=("PUBLIC_SITE_URL='${site}'")
  if (( ${#pares[@]} )); then
    printf 'supabase secrets set \\\n'
    local i
    for i in "${!pares[@]}"; do
      if (( i == ${#pares[@]} - 1 )); then printf '  %s\n' "${pares[$i]}"
      else printf '  %s \\\n' "${pares[$i]}"; fi
    done
  else
    echo "# (nada preenchido ainda no .env.local — rode antes: scripts/credenciais-base.sh gerar)"
  fi
  aviso "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem como segredos reservados do"
  aviso "projeto: se o painel recusar ('reserved secret'), confira o valor em Settings → API."

  titulo "2) Vault (é de lá que o pg_cron lê o cabeçalho x-worker-secret)"
  echo "# Abra supabase/setup/01_vault_worker_secret.sql no SQL Editor, cole o valor:"
  echo "#   INTEGRATION_WORKER_SECRET = ${worker:-<gerar primeiro>}"

  titulo "3) Publicar as Edge Functions"
  echo "# verify_jwt = false já está em supabase/config.toml: cada função se autentica"
  echo "# sozinha (sessão admin, x-worker-secret ou token do feed) — obrigatório com as"
  echo "# chaves novas do Supabase (sb_publishable_/sb_secret_)."
  local f
  for f in "${FUNCOES[@]}"; do printf 'supabase functions deploy %s\n' "$f"; done

  titulo "4) Primeiro usuário admin"
  echo "# Authentication → Users → Add user (marque 'Auto Confirm User') e depois rode"
  echo "# supabase/setup/02_primeiro_admin.sql trocando o e-mail."

  titulo "5) URL do feed no Google Merchant Center"
  if [[ -n "$url" && "$url" != *SEU-PROJETO* && -n "$feed" ]]; then
    printf '%s/functions/v1/google-merchant-feed?token=%s\n' "${url%/}" "$feed"
  else
    echo "# preencha SUPABASE_URL e gere o token (scripts/credenciais-base.sh gerar)"
  fi

  titulo "6) Conferir"
  echo "scripts/credenciais-base.sh status"
  echo "scripts/auditoria-segredos.sh"
  echo "# no SQL Editor: supabase/setup/03_checagem_base.sql"
  if [[ -n "$url" && "$url" != *SEU-PROJETO* ]]; then
    titulo "Teste rápido do agendador (deve responder 200 com a fila vazia)"
    printf 'curl -sS -X POST "%s/functions/v1/integration-worker" \\\n  -H "x-worker-secret: %s"\n' "${url%/}" "${worker:-<gerar primeiro>}"
  fi
}

# --------------------------------------------------------------- aplicar-config
# As linhas de atribuição terminam em vírgula; os comentários do topo dos dois
# arquivos também citam mode:/supabaseUrl:, então o padrão é ancorado no fim da
# linha para tocar só no que é código.
escrever_config() {  # escrever_config ARQUIVO VARIAVELGLOBAL MODO URL ANONKEY
  local arquivo="$1" global="$2" modo="$3" url="$4" anon="$5"
  if [[ ! -f "$arquivo" ]]; then erro "arquivo não encontrado: $arquivo"; exit 1; fi
  local tmp="${arquivo}.tmp"
  awk -v url="$url" -v anon="$anon" -v modo="$modo" '
    BEGIN { gsub(/&/, "\\\\&", url); gsub(/&/, "\\\\&", anon) }
    /^[[:space:]]*supabaseUrl:[[:space:]]*"[^"]*",?[[:space:]]*$/ {
      sub(/"[^"]*"/, "\"" url "\""); print; next
    }
    /^[[:space:]]*supabaseAnonKey:[[:space:]]*"[^"]*",?[[:space:]]*$/ {
      sub(/"[^"]*"/, "\"" anon "\""); print; next
    }
    /^[[:space:]]*mode:[[:space:]]*"[^"]*",?[[:space:]]*$/ && !feito {
      sub(/"[^"]*"/, "\"" modo "\""); feito = 1; print; next
    }
    { print }
  ' "$arquivo" > "$tmp"
  mv "$tmp" "$arquivo"
  ok "${arquivo#"${RAIZ}/"} → ${global} com URL + anon key e mode \"${modo}\""
}

mudar_modo() {  # mudar_modo ARQUIVO MODO — só a linha de código do mode
  local arquivo="$1" modo="$2" tmp
  [[ -f "$arquivo" ]] || { erro "arquivo não encontrado: $arquivo"; exit 1; }
  tmp="${arquivo}.tmp"
  awk -v modo="$modo" '
    /^[[:space:]]*mode:[[:space:]]*"[^"]*",?[[:space:]]*$/ && !feito {
      sub(/"[^"]*"/, "\"" modo "\""); feito = 1; print; next
    }
    { print }
  ' "$arquivo" > "$tmp"
  mv "$tmp" "$arquivo"
}

valor_para_arquivo() {  # recusa o que quebraria a string no arquivo JS
  local nome="$1" valor="$2"
  if [[ "$valor" == *[\"\'\&\\\$\`]* || "$valor" == *[[:space:]]* ]]; then
    erro "${nome} tem caractere que não pode entrar num arquivo JS (aspas, &, \\ ou espaço)."
    exit 1
  fi
}

aplicar_config() {
  local url anon
  url="$(ler_var SUPABASE_URL)"; anon="$(ler_var SUPABASE_ANON_KEY)"
  if [[ -z "$url" || "$url" == *SEU-PROJETO* ]]; then
    erro "SUPABASE_URL não preenchida em ${ENV_FILE} (Project Settings → API → Project URL)."
    exit 1
  fi
  if [[ "$url" != https://* ]]; then
    erro "SUPABASE_URL precisa começar com https:// (recebido: ${url})"
    exit 1
  fi
  if [[ -z "$anon" ]]; then
    erro "SUPABASE_ANON_KEY não preenchida em ${ENV_FILE}."
    exit 1
  fi
  if parece_chave_secreta "$anon"; then
    erro "isso é uma chave de SERVIDOR (service_role/sb_secret_). No site e no painel"
    erro "vai apenas a chave pública (anon/sb_publishable_). Nada foi alterado."
    exit 1
  fi
  if ! chave_publica_valida "$anon"; then
    aviso "a anon key não parece uma chave do Supabase (eyJ… ou sb_publishable_…);"
    aviso "gravando mesmo assim — confira em Project Settings → API Keys."
  fi
  valor_para_arquivo SUPABASE_URL "$url"
  valor_para_arquivo SUPABASE_ANON_KEY "$anon"
  escrever_config "${RAIZ}/admin/assets/config.js" "window.C18_CONFIG" "supabase" "$url" "$anon"
  escrever_config "${RAIZ}/assets/js/site-config.js" "window.C18_SITE" "supabase" "$url" "$anon"
  aviso "commit liberado: URL e anon key são públicas (o acesso é protegido por RLS)."
  aviso "a service_role fica SÓ no Supabase Secrets — nunca nesses arquivos."
}

reverter_config() {
  mudar_modo "${RAIZ}/admin/assets/config.js" "demo"
  ok "admin/assets/config.js → mode \"demo\""
  mudar_modo "${RAIZ}/assets/js/site-config.js" "static"
  ok "assets/js/site-config.js → mode \"static\""
  aviso "URL e anon key foram mantidas nos arquivos; só o modo voltou a demonstração."
}

# ---------------------------------------------------------------------- cli
while (( $# )); do
  case "$1" in
    gerar|status|comandos|aplicar-config|reverter-config|rotacionar) COMANDO="$1" ;;
    --arquivo) ENV_FILE="${2:?--arquivo exige um caminho}"; shift ;;
    --raiz)    RAIZ="${2:?--raiz exige um caminho}"; shift ;;
    --mostrar) MOSTRAR=1 ;;
    -h|--ajuda|--help) ajuda; exit 0 ;;
    *) erro "opção desconhecida: $1"; ajuda; exit 2 ;;
  esac
  shift
done
COMANDO="${COMANDO:-gerar}"
[[ -n "$ENV_FILE" ]] || ENV_FILE="${RAIZ}/.env.local"

case "$COMANDO" in
  gerar)
    garantir_arquivo
    gerar_segredos 0
    aviso "próximo passo: preencher SUPABASE_URL, SUPABASE_ANON_KEY e"
    aviso "SUPABASE_SERVICE_ROLE_KEY (Project Settings → API Keys) e rodar 'status'."
    if (( MOSTRAR )); then
      titulo "Segredos gerados (texto claro)"
      for nome in "${GERADAS[@]}"; do printf '  %s=%s\n' "$nome" "$(ler_var "$nome")"; done
    else
      aviso "para ver os valores: scripts/credenciais-base.sh status --mostrar"
    fi
    ;;
  status)          status ;;
  comandos)        comandos ;;
  aplicar-config)  aplicar_config ;;
  reverter-config) reverter_config ;;
  rotacionar)
    gerar_segredos 1
    aviso "agora atualize os três lugares: Supabase Secrets, Vault"
    aviso "(supabase/setup/01_vault_worker_secret.sql) e a URL do feed no Merchant Center."
    aviso "republique as Edge Functions para lerem o segredo novo."
    ;;
esac
