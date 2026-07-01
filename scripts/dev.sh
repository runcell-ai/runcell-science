#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_WEB_PORT="27183"
DEFAULT_SERVER_PORT="27184"
DEFAULT_API_PROXY_TARGET="http://127.0.0.1:${DEFAULT_SERVER_PORT}"
RUN_INSTALL="auto"
RUN_MIGRATE="1"

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh [options]

Start the Open Science local development stack.

Options:
  --install        Always run yarn install before starting
  --no-install     Skip dependency installation and native rebuild
  --skip-migrate   Skip the pre-start SQLite migration check
  -h, --help       Show this help message
EOF
}

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      RUN_INSTALL="always"
      ;;
    --no-install)
      RUN_INSTALL="never"
      ;;
    --skip-migrate)
      RUN_MIGRATE="0"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
  shift
done

command -v node >/dev/null 2>&1 || die "Node.js is required. Install Node 20.19+ or 22.12+."

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22 ? 0 : 1)' >/dev/null 2>&1; then
  die "Node $(node -p 'process.versions.node') is too old. This project requires Node 20.19+ or 22.12+."
fi

YARN_RELEASE="$ROOT_DIR/.yarn/releases/yarn-4.5.1.cjs"
[[ -f "$YARN_RELEASE" ]] || die "Missing bundled Yarn at $YARN_RELEASE."
YARN=(node "$YARN_RELEASE")

env_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

replace_env_value_if_default() {
  local file="$1"
  local key="$2"
  local old_value="$3"
  local new_value="$4"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if ! grep -Fxq "${key}=${old_value}" "$file"; then
    return 0
  fi

  local tmp_file="${file}.tmp.$$"
  awk -v key="$key" -v old_value="$old_value" -v new_value="$new_value" '
    $0 == key "=" old_value {
      print key "=" new_value
      next
    }
    { print }
  ' "$file" > "$tmp_file"
  mv "$tmp_file" "$file"
  info "Updated ${key} in ${file#$ROOT_DIR/} from ${old_value} to ${new_value}"
}

create_default_env() {
  if [[ -f "$ROOT_DIR/.env" || -f "$ROOT_DIR/apps/server/.env" ]]; then
    info "Using existing server environment file"
    return
  fi

  info "Creating .env with local development defaults"
  {
    printf 'SERVER_HOST=127.0.0.1\n'
    printf 'SERVER_PORT=%s\n' "$DEFAULT_SERVER_PORT"
    printf 'SQLITE_PATH=apps/server/data/open-science.sqlite\n'
    printf 'LOG_DIR=logs/server\n'
    printf 'MIGRATION_DIR=apps/server/src/db/migrations\n'
    printf 'LOG_LEVEL=info\n'
    printf '\n'
    printf 'AGENT_DEFAULT_CWD=%s\n' "$(env_quote "$ROOT_DIR")"
    printf 'AGENT_DEFAULT_RUNTIME_MODE=full_access\n'
    printf '\n'
    printf 'CODEX_BINARY_PATH=codex\n'
    printf 'CODEX_HOME=\n'
    printf 'CODEX_DEFAULT_MODEL=\n'
    printf 'CODEX_APPROVAL_POLICY=never\n'
    printf 'CODEX_SANDBOX=danger-full-access\n'
    printf '\n'
    printf 'CLAUDE_CODE_BINARY_PATH=claude\n'
    printf 'CLAUDE_CONFIG_DIR=\n'
    printf 'CLAUDE_DEFAULT_MODEL=\n'
    printf 'CLAUDE_PERMISSION_MODE=bypassPermissions\n'
    printf 'CLAUDE_ALLOW_DANGEROUSLY_SKIP_PERMISSIONS=true\n'
  } > "$ROOT_DIR/.env"
}

create_default_web_env() {
  if [[ -f "$ROOT_DIR/apps/web/.env" || -f "$ROOT_DIR/apps/web/.env.local" ]]; then
    info "Using existing web environment file"
    return
  fi

  info "Creating apps/web/.env.local with local UI defaults"
  {
    printf 'VITE_DEV_SERVER_PORT=%s\n' "$DEFAULT_WEB_PORT"
    printf 'VITE_API_PROXY_TARGET=%s\n' "$DEFAULT_API_PROXY_TARGET"
    printf 'VITE_AGENT_DEFAULT_CWD=%s\n' "$(env_quote "$ROOT_DIR")"
  } > "$ROOT_DIR/apps/web/.env.local"
}

refresh_old_default_ports() {
  replace_env_value_if_default "$ROOT_DIR/.env" "SERVER_PORT" "4000" "$DEFAULT_SERVER_PORT"
  replace_env_value_if_default "$ROOT_DIR/apps/server/.env" "SERVER_PORT" "4000" "$DEFAULT_SERVER_PORT"
  replace_env_value_if_default "$ROOT_DIR/apps/web/.env" "VITE_DEV_SERVER_PORT" "5173" "$DEFAULT_WEB_PORT"
  replace_env_value_if_default "$ROOT_DIR/apps/web/.env.local" "VITE_DEV_SERVER_PORT" "5173" "$DEFAULT_WEB_PORT"
  replace_env_value_if_default "$ROOT_DIR/apps/web/.env" "VITE_API_PROXY_TARGET" "http://127.0.0.1:4000" "$DEFAULT_API_PROXY_TARGET"
  replace_env_value_if_default "$ROOT_DIR/apps/web/.env.local" "VITE_API_PROXY_TARGET" "http://127.0.0.1:4000" "$DEFAULT_API_PROXY_TARGET"
}

has_binary() {
  local binary="$1"
  if [[ "$binary" == */* ]]; then
    [[ -x "$binary" ]]
  else
    command -v "$binary" >/dev/null 2>&1
  fi
}

check_agent_binaries() {
  local codex_binary="${CODEX_BINARY_PATH:-codex}"
  local claude_binary="${CLAUDE_CODE_BINARY_PATH:-claude}"

  if ! has_binary "$codex_binary"; then
    warn "Codex CLI was not found at '$codex_binary'. Codex sessions will fail until it is installed and logged in."
  fi

  if ! has_binary "$claude_binary"; then
    warn "Claude Code CLI was not found at '$claude_binary'. Claude sessions will fail until it is installed and logged in."
  fi
}

install_dependencies() {
  case "$RUN_INSTALL" in
    always)
      info "Installing dependencies"
      "${YARN[@]}" install
      ;;
    never)
      info "Skipping dependency installation"
      ;;
    auto)
      if [[ ! -d "$ROOT_DIR/node_modules" || ! -f "$ROOT_DIR/.yarn/install-state.gz" ]]; then
        info "Installing dependencies"
        "${YARN[@]}" install
      else
        info "Dependencies already installed"
      fi
      ;;
  esac
}

check_better_sqlite3() {
  local check_log="$ROOT_DIR/logs/dev/better-sqlite3-check.log"
  node -e 'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.close()' >/dev/null 2> "$check_log"
}

ensure_native_dependencies() {
  local check_log="$ROOT_DIR/logs/dev/better-sqlite3-check.log"

  if check_better_sqlite3; then
    info "Native dependencies match Node $(node -p 'process.version')"
    return
  fi

  warn "better-sqlite3 cannot be loaded by Node $(node -p 'process.version') ABI $(node -p 'process.versions.modules'); this usually means node_modules was built with another Node version."

  if [[ "$RUN_INSTALL" == "never" ]]; then
    sed -n '1,12p' "$check_log" >&2 || true
    die "Native dependencies need install/rebuild. Run './scripts/dev.sh' or './scripts/dev.sh --install' without --no-install."
  fi

  info "Rebuilding better-sqlite3 for the current Node runtime"
  rm -rf "$ROOT_DIR/node_modules/better-sqlite3/build"
  "${YARN[@]}" rebuild better-sqlite3

  if ! check_better_sqlite3; then
    sed -n '1,20p' "$check_log" >&2 || true
    die "Failed to load better-sqlite3 after rebuild."
  fi
}

mkdir -p "$ROOT_DIR/logs/dev" "$ROOT_DIR/logs/server" "$ROOT_DIR/apps/server/data"
create_default_env
create_default_web_env
refresh_old_default_ports
check_agent_binaries
install_dependencies
ensure_native_dependencies

if [[ "$RUN_MIGRATE" == "1" ]]; then
  info "Running SQLite migrations"
  "${YARN[@]}" db:migrate
else
  info "Skipping SQLite migrations"
fi

info "Starting development services"
printf 'Web:           http://127.0.0.1:%s\n' "$DEFAULT_WEB_PORT"
printf 'Server health: http://127.0.0.1:%s/healthz\n' "$DEFAULT_SERVER_PORT"
printf 'Logs:          logs/dev/web.log and logs/dev/server.log\n'
printf 'Stop:          Ctrl-C\n\n'

exec "${YARN[@]}" dev
