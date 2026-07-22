#!/usr/bin/env bash
# =============================================================================
# super-admin-bootstrap.sh — Manage the Titan Enterprise super admin account
#
# Commands:
#   status    Check whether a super admin has been bootstrapped
#   create    Create the first super admin  (POST — 409 if one already exists)
#   update    Update an existing super admin (PATCH)
#
# Flags:
#   --env <name>   Resolve BASE_URL and BOOTSTRAP_SECRET from a named environment
#                  defined in .env as BASE_URL_<NAME> / BOOTSTRAP_SECRET_<NAME>
#                  e.g. --env prod  reads BASE_URL_PROD and BOOTSTRAP_SECRET_PROD
#
# Configuration (resolved in order: env var → .env file → interactive prompt):
#   BASE_URL            App base URL              (default: http://localhost:3000)
#   BOOTSTRAP_SECRET    Value of ADMIN_BOOTSTRAP_SECRET on the server
#
#   create:   ADMIN_NAME  ADMIN_EMAIL  ADMIN_PASSWORD
#   update:   ADMIN_USER_ID  ADMIN_CURRENT_EMAIL  NEW_NAME  NEW_EMAIL  NEW_PASSWORD
# =============================================================================

set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}ℹ  ${RESET}$*"; }
success() { echo -e "${GREEN}✔  ${RESET}$*"; }
warn()    { echo -e "${YELLOW}⚠  ${RESET}$*"; }
error()   { echo -e "${RED}✖  ${RESET}$*" >&2; }
die()     { error "$*"; exit 1; }

# ─── Dependencies ─────────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || die "curl is required but not installed."
command -v jq   >/dev/null 2>&1 || die "jq is required but not installed."

# ─── .env loader ──────────────────────────────────────────────────────────────
# Reads BASE_URL, ADMIN_BOOTSTRAP_SECRET, and all BASE_URL_* / BOOTSTRAP_SECRET_*
# named-environment keys from a .env file if present.
# Env vars already set in the shell always take precedence.
load_dotenv() {
  [[ -f ".env" ]] || return 0
  local key val line
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Strip leading whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    # Skip blank lines and comments
    [[ -z "$line" || "$line" == \#* ]] && continue
    # Strip optional leading "export "
    line="${line#export }"
    # Split on the FIRST '=' only
    key="${line%%=*}"
    val="${line#*=}"
    # Strip surrounding single or double quotes from the value
    val="${val#[\"\']}"
    val="${val%[\"\']}"
    # Validate key is a legal identifier before using declare
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$key" in
      ADMIN_BOOTSTRAP_SECRET)
        [[ -z "${BOOTSTRAP_SECRET:-}" ]] && BOOTSTRAP_SECRET="$val" ;;
      BASE_URL)
        [[ -z "${BASE_URL:-}" ]] && BASE_URL="$val" ;;
      BASE_URL_*|BOOTSTRAP_SECRET_*)
        # Load named-env keys only when not already set in the shell.
        [[ -z "${!key:-}" ]] && declare -g "$key=$val" ;;
    esac
  done < ".env"
}

load_dotenv

# BASE_URL and ENDPOINT are finalised after --env flag parsing (see entry point).
# Declare them here so every function can reference them as globals.
BASE_URL="${BASE_URL:-}"
ENDPOINT=""

# ─── Named-environment resolver ───────────────────────────────────────────────
# Called when --env <name> is passed. Looks up BASE_URL_<NAME> and
# BOOTSTRAP_SECRET_<NAME> (case-insensitive name → uppercased key).
# Sets BASE_URL, BOOTSTRAP_SECRET, and ENDPOINT globals.
resolve_env() {
  local name="$1"
  # Uppercase the name for the variable lookup (e.g. "prod" → "PROD")
  local upper
  upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')

  local url_var="BASE_URL_${upper}"
  local secret_var="BOOTSTRAP_SECRET_${upper}"

  local resolved_url="${!url_var:-}"
  local resolved_secret="${!secret_var:-}"

  if [[ -z "$resolved_url" ]]; then
    error "No ${url_var} found in environment or .env."
    error "Add the following to your .env:"
    error "  ${url_var}=https://your-${name}-server.example.com"
    error "  ${secret_var}=your_${name}_bootstrap_secret   # optional if prompting is fine"
    exit 1
  fi

  BASE_URL="$resolved_url"
  # Only override BOOTSTRAP_SECRET if the named env has one; otherwise the user
  # will be prompted (or it can still be supplied as a plain BOOTSTRAP_SECRET env var).
  [[ -n "$resolved_secret" ]] && BOOTSTRAP_SECRET="$resolved_secret"
}

# ─── Global response state ────────────────────────────────────────────────────
# Populated by do_request — avoids subshell pipes and delimiter ambiguity.
HTTP_CODE=""
BODY=""

# ─── HTTP helper ──────────────────────────────────────────────────────────────
# Writes the response body to a temp file (-o) and captures only the 3-digit
# HTTP status code from stdout (-w "%{http_code}"), so there is zero chance
# of the body content being confused with the status code.
do_request() {
  local method="$1"
  local payload="${2:-}"

  local tmp_body
  tmp_body=$(mktemp) || die "Could not create a temporary file."
  # Clean up the temp file on any exit path from this function.
  # shellcheck disable=SC2064
  trap "rm -f '$tmp_body'" RETURN

  local curl_args=(
    -s
    -o "$tmp_body"        # response body → file (never mixed with status code)
    -w "%{http_code}"     # only the 3-digit code goes to stdout
    --connect-timeout 10
    --max-time 30
    -X "$method"
    -H "Content-Type: application/json"
    -H "x-bootstrap-secret: ${BOOTSTRAP_SECRET}"
  )
  [[ -n "$payload" ]] && curl_args+=( -d "$payload" )
  curl_args+=( "$ENDPOINT" )

  local curl_exit=0
  HTTP_CODE=$(curl "${curl_args[@]}") || curl_exit=$?
  BODY=$(cat "$tmp_body")

  if [[ $curl_exit -ne 0 ]]; then
    case $curl_exit in
      6)  die "DNS resolution failed. Check BASE_URL: ${BASE_URL}" ;;
      7)  die "Connection refused. Is the server running at ${BASE_URL}?" ;;
      28) die "Request timed out (30 s). Server may be unreachable." ;;
      35|51|53|54|58|59|60|64|66|77|83|90|91)
          die "TLS/SSL error (curl exit ${curl_exit}). Check your certificate." ;;
      *)  die "curl failed with exit code ${curl_exit}." ;;
    esac
  fi

  # Guard against an empty or non-numeric HTTP code (e.g. proxy swallowed the response).
  if [[ -z "$HTTP_CODE" || ! "$HTTP_CODE" =~ ^[0-9]{3}$ ]]; then
    die "Received an invalid HTTP response (code='${HTTP_CODE}'). Body: ${BODY:-<empty>}"
  fi
}

# Extract .error from a JSON body; fall back to the raw body if it isn't JSON.
body_error() {
  echo "$BODY" | jq -re '.error' 2>/dev/null || echo "$BODY"
}

# ─── Input helpers ────────────────────────────────────────────────────────────
prompt_secret() {
  if [[ -z "${BOOTSTRAP_SECRET:-}" ]]; then
    echo -ne "${BOLD}Bootstrap secret (ADMIN_BOOTSTRAP_SECRET):${RESET} " >&2
    read -rs BOOTSTRAP_SECRET
    echo >&2
  fi
  [[ -n "${BOOTSTRAP_SECRET:-}" ]] || die "Bootstrap secret cannot be empty."
}

# prompt_field LABEL VARNAME [required=true] [secret=false]
#
# Reads user input into the caller-scoped variable VARNAME.
# Silently skips if the variable is already non-empty (env var already set).
# Uses bash dynamic scoping: 'read -r VARNAME' finds and updates the 'local'
# variable of the same name that the calling command declared before calling us.
prompt_field() {
  local label="$1"
  local varname="$2"
  local required="${3:-true}"
  local secret="${4:-false}"

  # Already supplied — nothing to prompt.
  [[ -n "${!varname:-}" ]] && return 0

  echo -ne "${BOLD}${label}:${RESET} " >&2
  if [[ "$secret" == "true" ]]; then
    read -rs "$varname"; echo >&2
  else
    read -r "$varname"
  fi

  if [[ "$required" == "true" && -z "${!varname:-}" ]]; then
    die "${label} is required and cannot be blank."
  fi
}

# Mirrors the Zod min(8) rule from the server so we fail fast locally.
validate_password() {
  local pw="$1"
  local label="${2:-Password}"
  [[ ${#pw} -ge 8 ]] || die "${label} must be at least 8 characters (got ${#pw})."
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_status() {
  info "Checking bootstrap status → ${ENDPOINT}"
  prompt_secret

  do_request GET

  case "$HTTP_CODE" in
    200)
      local bootstrapped count
      # -e makes jq exit non-zero on null/missing key, catching non-JSON 200 bodies.
      bootstrapped=$(echo "$BODY" | jq -re '.bootstrapped' 2>/dev/null) \
        || die "Unexpected 200 body (not the expected JSON). Got: ${BODY}"
      count=$(echo "$BODY" | jq -r '.superAdminCount')
      if [[ "$bootstrapped" == "true" ]]; then
        success "Bootstrapped — ${count} super admin account(s) found."
      else
        warn "No super admin exists yet."
        info  "Run:  ./scripts/super-admin-bootstrap.sh create"
      fi
      ;;
    404) die "HTTP 404 — invalid bootstrap secret or wrong BASE_URL (${BASE_URL})." ;;
    *)   die "Unexpected HTTP ${HTTP_CODE}: $(body_error)" ;;
  esac
}

cmd_create() {
  info "Creating first super admin …"
  prompt_secret

  # Declared as locals so these never leak to the global scope.
  local ADMIN_NAME="${ADMIN_NAME:-}"
  local ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  local ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

  prompt_field "Full name"              ADMIN_NAME
  prompt_field "Email"                  ADMIN_EMAIL
  prompt_field "Password (min 8 chars)" ADMIN_PASSWORD false true

  # Validate locally before the round-trip.
  validate_password "$ADMIN_PASSWORD"

  # jq --arg safely escapes any special characters in the values.
  local payload
  payload=$(jq -n \
    --arg name     "$ADMIN_NAME" \
    --arg email    "$ADMIN_EMAIL" \
    --arg password "$ADMIN_PASSWORD" \
    '{name: $name, email: $email, password: $password}')

  do_request POST "$payload"

  case "$HTTP_CODE" in
    200)
      local mode uid
      mode=$(echo "$BODY" | jq -r '.mode')
      uid=$(echo  "$BODY" | jq -r '.userId')
      success "Super admin created!"
      info    "  Mode    : ${mode}"
      info    "  User ID : ${uid}"
      info    "  Email   : ${ADMIN_EMAIL}"
      ;;
    400) die "Validation error: $(body_error)" ;;
    404) die "HTTP 404 — invalid bootstrap secret or wrong BASE_URL (${BASE_URL})." ;;
    409)
      warn "A super admin already exists — cannot POST a second one."
      info "To update the existing admin run:  ./scripts/super-admin-bootstrap.sh update"
      ;;
    500) die "Server error: $(body_error)" ;;
    *)   die "Unexpected HTTP ${HTTP_CODE}: $(body_error)" ;;
  esac
}

cmd_update() {
  info "Updating super admin …"
  prompt_secret

  # All locals — nothing leaks to global scope.
  local ADMIN_USER_ID="${ADMIN_USER_ID:-}"
  local ADMIN_CURRENT_EMAIL="${ADMIN_CURRENT_EMAIL:-}"
  local NEW_NAME="${NEW_NAME:-}"
  local NEW_EMAIL="${NEW_EMAIL:-}"
  local NEW_PASSWORD="${NEW_PASSWORD:-}"

  # ── Targeting ────────────────────────────────────────────────────────────
  # The server resolves ambiguity in this priority order:
  #   1. userId  →  2. currentEmail  →  3. auto-select (only if exactly 1 super admin)
  # We surface this clearly rather than silently sending an under-specified request.
  if [[ -z "$ADMIN_USER_ID" && -z "$ADMIN_CURRENT_EMAIL" ]]; then
    warn "Neither ADMIN_USER_ID nor ADMIN_CURRENT_EMAIL is set."
    warn "If exactly one super admin exists the server will target it automatically."
    echo -ne "${BOLD}Current email to target (Enter to auto-select):${RESET} " >&2
    read -r ADMIN_CURRENT_EMAIL
    # A blank value is intentional — the server handles the unambiguous single-admin case.
  fi

  # ── Update fields ─────────────────────────────────────────────────────────
  if [[ -z "$NEW_NAME" && -z "$NEW_EMAIL" && -z "$NEW_PASSWORD" ]]; then
    info "Enter the values you want to change (press Enter to skip a field):"
    prompt_field "New name     (Enter to skip)"            NEW_NAME     false false
    prompt_field "New email    (Enter to skip)"            NEW_EMAIL    false false
    prompt_field "New password (Enter to skip, min 8 if set)" NEW_PASSWORD false true
  fi

  if [[ -z "$NEW_NAME" && -z "$NEW_EMAIL" && -z "$NEW_PASSWORD" ]]; then
    die "Nothing to update. Provide at least one of NEW_NAME, NEW_EMAIL, or NEW_PASSWORD."
  fi

  [[ -n "$NEW_PASSWORD" ]] && validate_password "$NEW_PASSWORD" "New password"

  # ── Build JSON payload with only non-empty fields ─────────────────────────
  # jq -n --argjson base <json> --arg v <string> ensures correct JSON even
  # when values contain quotes, backslashes, or other special characters.
  local payload='{}'
  [[ -n "$ADMIN_USER_ID"       ]] && \
    payload=$(jq -n --argjson base "$payload" --arg v "$ADMIN_USER_ID"       '$base + {userId:       $v}')
  [[ -n "$ADMIN_CURRENT_EMAIL" ]] && \
    payload=$(jq -n --argjson base "$payload" --arg v "$ADMIN_CURRENT_EMAIL" '$base + {currentEmail: $v}')
  [[ -n "$NEW_NAME"            ]] && \
    payload=$(jq -n --argjson base "$payload" --arg v "$NEW_NAME"            '$base + {name:         $v}')
  [[ -n "$NEW_EMAIL"           ]] && \
    payload=$(jq -n --argjson base "$payload" --arg v "$NEW_EMAIL"           '$base + {email:        $v}')
  [[ -n "$NEW_PASSWORD"        ]] && \
    payload=$(jq -n --argjson base "$payload" --arg v "$NEW_PASSWORD"        '$base + {password:     $v}')

  do_request PATCH "$payload"

  case "$HTTP_CODE" in
    200)
      local uid
      uid=$(echo "$BODY" | jq -r '.userId')
      success "Super admin updated!"
      info    "  User ID : ${uid}"
      ;;
    # 404 on PATCH can mean either wrong secret OR "no super admin exists yet".
    # body_error() returns the server's .error message which distinguishes the two.
    404) die "$(body_error)" ;;
    400) die "Validation / ambiguity error: $(body_error)" ;;
    500) die "Server error: $(body_error)" ;;
    *)   die "Unexpected HTTP ${HTTP_CODE}: $(body_error)" ;;
  esac
}

# ─── Usage ────────────────────────────────────────────────────────────────────
usage() {
  echo -e "
${BOLD}super-admin-bootstrap.sh${RESET} — Titan Enterprise super admin bootstrapper

${BOLD}USAGE${RESET}
  # Git Bash / Linux / macOS
  ./scripts/super-admin-bootstrap.sh [--env <name>] <command>

  # PowerShell
  .\\scripts\\super-admin-bootstrap.ps1 [--env <name>] <command>

  # CMD
  scripts\\super-admin-bootstrap.cmd [--env <name>] <command>

${BOLD}COMMANDS${RESET}
  status    Check if a super admin is bootstrapped
  create    Create the first super admin  (POST)
  update    Update an existing super admin (PATCH)

${BOLD}FLAGS${RESET}
  --env <name>    Activate a named environment defined in .env
                  Reads BASE_URL_<NAME> and BOOTSTRAP_SECRET_<NAME>
                  e.g. --env prod  uses BASE_URL_PROD + BOOTSTRAP_SECRET_PROD
                       --env staging uses BASE_URL_STAGING + BOOTSTRAP_SECRET_STAGING
                  Without --env the script falls back to BASE_URL / localhost:3000

${BOLD}CONFIGURATION${RESET}
  Resolved in this order: environment variable → .env file → interactive prompt.

  # Generic (used when no --env is given)
  BASE_URL              Server base URL          (default: http://localhost:3000)
  BOOTSTRAP_SECRET      Value of ADMIN_BOOTSTRAP_SECRET on the server

  # Named environments — add these to your .env file:
  BASE_URL_LOCAL=http://localhost:3000
  BOOTSTRAP_SECRET_LOCAL=your_local_secret

  BASE_URL_STAGING=https://staging.titan.example.com
  BOOTSTRAP_SECRET_STAGING=your_staging_secret

  BASE_URL_PROD=https://titan.example.com
  BOOTSTRAP_SECRET_PROD=your_prod_secret

  # For 'create':
  ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD

  # For 'update' (all optional — prompted if not provided):
  ADMIN_USER_ID, ADMIN_CURRENT_EMAIL
  NEW_NAME, NEW_EMAIL, NEW_PASSWORD

${BOLD}EXAMPLES${RESET}
  # Check status on each environment (Git Bash / Linux)
  ./scripts/super-admin-bootstrap.sh --env local   status
  ./scripts/super-admin-bootstrap.sh --env staging status
  ./scripts/super-admin-bootstrap.sh --env prod    status

  # Interactive create on staging (PowerShell)
  .\\scripts\\super-admin-bootstrap.ps1 --env staging create

  # Interactive create on staging (CMD)
  scripts\\super-admin-bootstrap.cmd --env staging create

  # Fully non-interactive create on prod (Git Bash / CI)
  ADMIN_NAME='Abdul Hassan' \\
  ADMIN_EMAIL=abdul@example.com \\
  ADMIN_PASSWORD=StrongPass123 \\
  ./scripts/super-admin-bootstrap.sh --env prod create

  # Update password on staging (Git Bash / Linux)
  NEW_PASSWORD=NewSecurePass456 ./scripts/super-admin-bootstrap.sh --env staging update

  # PowerShell env vars
  \$env:NEW_PASSWORD='NewSecurePass456'; .\\scripts\\super-admin-bootstrap.ps1 --env staging update

  # CMD env vars
  set NEW_PASSWORD=NewSecurePass456 && scripts\\super-admin-bootstrap.cmd --env staging update

  # Flag can also come after the command
  ./scripts/super-admin-bootstrap.sh status --env prod
"
}

# ─── Entry point ──────────────────────────────────────────────────────────────
# Parse --env / -e before the command so the flag can appear in either position:
#   ./scripts/super-admin-bootstrap.sh --env prod status
#   ./scripts/super-admin-bootstrap.sh status --env prod   ← also works
ENV_NAME=""
COMMAND=""
REMAINING_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      [[ -n "${2:-}" ]] || die "--env requires a name argument (e.g. --env prod)"
      ENV_NAME="$2"; shift 2 ;;
    -h|--help|help)
      COMMAND="help"; shift ;;
    -*)
      die "Unknown flag: '$1'. Did you mean --env?" ;;
    *)
      REMAINING_ARGS+=("$1"); shift ;;
  esac
done

COMMAND="${REMAINING_ARGS[0]:-${COMMAND:-}}"

# Resolve the named environment (sets BASE_URL and optionally BOOTSTRAP_SECRET).
if [[ -n "$ENV_NAME" ]]; then
  resolve_env "$ENV_NAME"
fi

# Finalise BASE_URL and ENDPOINT now that --env (if any) has been applied.
BASE_URL="${BASE_URL:-http://localhost:3000}"
ENDPOINT="${BASE_URL}/api/internal/bootstrap-admin"

# Show which environment is active so there is never any ambiguity.
ENV_LABEL="${ENV_NAME:-local (default)}"
info "Target: ${BOLD}${ENV_LABEL}${RESET}  →  ${ENDPOINT}"

case "$COMMAND" in
  status)      cmd_status ;;
  create)      cmd_create ;;
  update)      cmd_update ;;
  help|"")     usage ;;
  *)  error "Unknown command: '${COMMAND}'"; usage; exit 1 ;;
esac