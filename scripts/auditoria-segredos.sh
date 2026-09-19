#!/usr/bin/env bash
# =============================================================================
# Censura 18 — auditoria de segredos
#
# Varre os arquivos que iriam para o Git atrás de credencial real: chave de
# servidor (service_role / sb_secret_), os segredos guardados no .env.local e
# qualquer .env esquecido no histórico. Roda em segundos; use antes de todo
# commit e depois de cadastrar credencial nova.
#
# Uso:
#   scripts/auditoria-segredos.sh [--raiz CAMINHO] [--arquivo CAMINHO] [-q]
#
# Saída: uma linha por verificação. Sai com código 1 se achar vazamento.
# =============================================================================
set -uo pipefail

RAIZ="${C18_RAIZ:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${C18_ENV_FILE:-}"
QUIETO=0
ACHADOS=0
FALHAS=0

while (( $# )); do
  case "$1" in
    --raiz) RAIZ="${2:?}"; shift ;;
    --arquivo) ENV_FILE="${2:?}"; shift ;;
    -q|--quiet|--silencioso) QUIETO=1 ;;
    -h|--ajuda|--help)
      awk 'NR > 2 && /^# =+$/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) printf 'opção desconhecida: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
[[ -n "$ENV_FILE" ]] || ENV_FILE="${RAIZ}/.env.local"

passou() { (( QUIETO )) || printf '  \033[32m✓\033[0m %s\n' "$1"; }
achou()  { ACHADOS=$((ACHADOS + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
info()   { (( QUIETO )) || printf '  \033[36m!\033[0m %s\n' "$1"; }

cd "$RAIZ" || { printf 'raiz inválida: %s\n' "$RAIZ" >&2; exit 2; }

# Lista de arquivos que iriam para o Git (fora dele, varre tudo menos .git/.env*)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t ARQUIVOS < <(git ls-files)
  ORIGEM="versionados"
else
  mapfile -t ARQUIVOS < <(find . -type f \
    -not -path './.git/*' -not -name '.env' -not -name '.env.local' -not -name '.env.*.local' \
    | sed 's|^\./||' | sort)
  ORIGEM="do diretório (sem Git)"
fi

printf '\n\033[1mAuditoria de segredos — %d arquivos %s\033[0m\n' "${#ARQUIVOS[@]}" "$ORIGEM"

# ---------------------------------------------------------------- 1. .gitignore
printf '\nProteção do arquivo de ambiente\n'
if [[ -f .gitignore ]] && grep -qx '\.env' .gitignore && grep -qx '\.env\.local' .gitignore; then
  passou ".gitignore bloqueia .env e .env.local"
else
  achou ".gitignore não bloqueia .env/.env.local — um arquivo real entraria no Git"
fi
if [[ -f .gitignore ]] && grep -q '^!\.env\.example$' .gitignore; then
  passou ".env.example continua versionado (exceção declarada)"
else
  info ".env.example não está na exceção do .gitignore — confira se ele continua entrando nos commits"
fi

# ------------------------------------------------- 2. arquivos de ambiente no Git
printf '\nArquivos de ambiente\n'
rastreados="$(printf '%s\n' "${ARQUIVOS[@]}" | grep -E '^\.env(\.local|\.([a-z]+)\.local)?$' || true)"
if [[ -n "$rastreados" ]]; then
  achou "arquivo de ambiente versionado: $(printf '%s' "$rastreados" | tr '\n' ' ')"
else
  passou "nenhum .env real entre os arquivos versionados"
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  historico="$(git log --all --oneline -- .env .env.local 2>/dev/null || true)"
  if [[ -n "$historico" ]]; then
    achou ".env/.env.local já entrou no histórico: $(printf '%s' "$historico" | head -n1)"
    info "remova do histórico (git filter-repo) e ROTACIONE todas as chaves"
  else
    passou "histórico sem .env/.env.local"
  fi
fi
if [[ -f "$ENV_FILE" ]]; then
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [[ "$perms" == "600" || "$perms" == "400" ]]; then
    passou "$(basename "$ENV_FILE") só leitura do dono (modo $perms)"
  else
    info "$(basename "$ENV_FILE") está no modo $perms — rode: chmod 600 '$ENV_FILE'"
  fi
fi

# ------------------------------------------- 3. credencial de servidor no Git
printf '\nChave de servidor (service_role / sb_secret_ / chave privada)\n'
# Documentação e testes citam o formato de propósito; o que importa é o valor
# real — e esse é pego pelo cruzamento com o .env.local (seção 4).
mapfile -t VARREDURA < <(printf '%s\n' "${ARQUIVOS[@]}" \
  | grep -Ev '^(docs/|tests/|LEIA-ME\.md|README\.md|\.env\.example$)' \
  | grep -Ev '\.md$' || true)

secret_hits=""
if (( ${#VARREDURA[@]} )); then
  secret_hits="$(printf '%s\n' "${VARREDURA[@]}" | tr '\n' '\0' \
    | xargs -0 grep -nE 'sb_secret_[A-Za-z0-9_-]{20,}' 2>/dev/null || true)"
fi
if [[ -n "$secret_hits" ]]; then
  achou "chave sb_secret_ em arquivo que vai para o Git:"
  printf '%s\n' "$secret_hits" | head -n 5 | sed 's/^/      /'
else
  passou "nenhuma chave sb_secret_ fora de documentação e testes"
fi

base64url_decode() {
  local data="${1//_//}"
  data="${data//-/+}"
  local resto=$(( ${#data} % 4 )) i
  if (( resto )); then for ((i = resto; i < 4; i++)); do data+="="; done; fi
  printf '%s' "$data" | base64 -d 2>/dev/null || true
}

# JWT com papel service_role (a anon key é pública por desenho; o papel decide)
jwt_total=0
jwt_ruim=""
for arquivo in "${ARQUIVOS[@]}"; do
  [[ -f "$arquivo" ]] || continue
  while read -r token; do
    [[ -z "$token" ]] && continue
    jwt_total=$((jwt_total + 1))
    payload="$(base64url_decode "$(printf '%s' "$token" | cut -d. -f2)")"
    if [[ "$payload" == *service_role* ]]; then
      jwt_ruim+="${arquivo}: ${token:0:24}…"$'\n'
    fi
  done < <(grep -oE 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}' "$arquivo" 2>/dev/null || true)
done
if [[ -n "$jwt_ruim" ]]; then
  achou "JWT de service_role versionado:"
  printf '%s' "$jwt_ruim" | head -n 5 | sed 's/^/      /'
else
  passou "nenhum JWT de service_role entre os $jwt_total token(s) encontrados"
fi

# Chave privada de verdade: marcador PEM seguido de material em base64
# (código que apenas manipula o marcador, como marketing.ts, não é vazamento)
pem=""
if (( ${#ARQUIVOS[@]} )); then
  for arquivo in "${ARQUIVOS[@]}"; do
    [[ -f "$arquivo" ]] || continue
    # awk portável (mawk não tem {n,}): limpa a linha e mede o que sobra
    if awk '
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/ { janela = 2 }
      janela > 0 {
        linha = $0
        gsub(/[^A-Za-z0-9+\/=]/, "", linha)
        if (length(linha) >= 64) { achou = 1; exit }
        janela--
      }
      END { exit achou ? 0 : 1 }
    ' "$arquivo" 2>/dev/null; then
      pem+="${arquivo} "$'\n'
    fi
  done
fi
if [[ -n "$pem" ]]; then
  achou "chave privada (PEM) versionada: $(printf '%s' "$pem" | tr '\n' ' ')"
else
  passou "nenhuma chave privada (PEM) entre os arquivos"
fi

# ------------------------------------- 4. segredos do .env.local em arquivos do Git
printf '\nSegredos do arquivo local\n'
if [[ ! -f "$ENV_FILE" ]]; then
  info "$(basename "$ENV_FILE") não existe — nada para cruzar (rode scripts/credenciais-base.sh gerar)"
else
  cruzados=0
  vazou=0
  while IFS= read -r linha; do
    nome="${linha%%=*}"
    valor="${linha#*=}"
    [[ -z "$valor" ]] && continue
    # só nomes de segredo; a anon key é pública por desenho (vai no config.js)
    case "$nome" in
      *SECRET*|*TOKEN*|*PASSWORD*|*SENHA*|SUPABASE_SERVICE_ROLE_KEY) ;;
      *) continue ;;
    esac
    (( ${#valor} < 16 )) && continue
    cruzados=$((cruzados + 1))
    onde="$(printf '%s\n' "${ARQUIVOS[@]}" | tr '\n' '\0' | xargs -0 grep -lF -- "$valor" 2>/dev/null || true)"
    if [[ -n "$onde" ]]; then
      achou "${nome} aparece em: $(printf '%s' "$onde" | tr '\n' ' ')"
      vazou=$((vazou + 1))
    fi
  done < <(grep -E '^[A-Z0-9_]+=' "$ENV_FILE" || true)
  if (( cruzados == 0 )); then
    info "nenhum segredo preenchido no $(basename "$ENV_FILE") para cruzar"
  elif (( vazou == 0 )); then
    passou "$cruzados segredos do $(basename "$ENV_FILE") não aparecem em arquivo versionado"
  fi
fi

# ------------------------------------------------------- 5. arquivos do navegador
printf '\nArquivos que o navegador baixa\n'
publicos=(admin/assets/config.js assets/js/site-config.js)
limpos=1
for arquivo in "${publicos[@]}"; do
  [[ -f "$arquivo" ]] || continue
  valor="$(sed -n 's/^[[:space:]]*supabaseAnonKey:[[:space:]]*"\([^"]*\)".*/\1/p' "$arquivo" | head -n1)"
  payload=""
  if [[ "$valor" == eyJ* ]]; then
    payload="$(base64url_decode "$(printf '%s' "$valor" | cut -d. -f2)")"
  fi
  if [[ "$valor" == sb_secret_* || "$payload" == *service_role* ]]; then
    achou "${arquivo} guarda uma chave de servidor na supabaseAnonKey"
    limpos=0
  fi
done
(( limpos )) && passou "config.js e site-config.js só carregam URL e chave pública"

# ------------------------------------------------------------------- resultado
printf '\n'
if (( ACHADOS )); then
  printf '\033[31m%d vazamento(s) encontrado(s).\033[0m Tire o valor do arquivo, rotacione a\n' "$ACHADOS"
  printf 'credencial e rode de novo. Segredo mora em Supabase → Secrets/Vault.\n'
  exit 1
fi
printf '\033[32mNenhum vazamento encontrado.\033[0m Segredos continuam fora do Git.\n'
exit 0
