#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_URL="https://packagefeedproxy.microsoft.io/pypi/simple/"
readonly DEFAULT_PACKAGE="tensorboard-data-server==0.7.2"
readonly CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/uv"
readonly CONFIG_PATH="$CONFIG_DIR/uv.toml"
readonly STATE_PATH="$CONFIG_DIR/.microsoft-python-proxy-backup"

command_name="install"
proxy_url="$DEFAULT_URL"
validation_package="$DEFAULT_PACKAGE"
yes=false
config_temp=""
work_dir=""

cleanup() {
  if [[ -n "$config_temp" && -e "$config_temp" ]]; then
    rm -f -- "$config_temp"
  fi
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

usage() {
  cat <<'EOF'
Usage: setup-microsoft-python-proxy.sh [command] [options]

Configure uv to use Microsoft's corporate Python proxy as its sole global index.

Commands:
  install              Install the global uv configuration (default)
  check                Verify configuration and perform a dry-run package install
  remove               Restore the prior configuration or remove the managed file
  help                 Show this help

Options:
  --url URL             Proxy simple-index URL
  --package SPEC        Validation package (default: tensorboard-data-server==0.7.2)
  --yes                 Allow noninteractive replacement or removal
  -h, --help            Show this help

The script never configures credentials, disables Defender, or adds fallback indexes.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

managed_config() {
  cat <<EOF
# Managed by setup-microsoft-python-proxy.sh.
# Microsoft corporate PyPI proxy. It retrieves and caches public PyPI packages.
# Keep this as the sole index to avoid dependency-confusion across repositories.
[[index]]
name = "microsoft"
url = "$proxy_url"
default = true
# End setup-microsoft-python-proxy.sh managed configuration.
EOF
}

verified_unmarked_config() {
  cat <<EOF
# Microsoft corporate PyPI proxy. It retrieves and caches public PyPI packages.
# Keep this as the sole index to avoid dependency-confusion across repositories.
[[index]]
name = "microsoft"
url = "$proxy_url"
default = true
EOF
}

config_equals() {
  [[ -f "$CONFIG_PATH" ]] || return 1
  local expected="$1" actual
  actual="$(cat -- "$CONFIG_PATH")"
  [[ "$actual" == "$expected" ]]
}

is_managed_config() {
  config_equals "$(managed_config)"
}

is_expected_config() {
  is_managed_config || config_equals "$(verified_unmarked_config)"
}

validate_url() {
  [[ "$proxy_url" == https://* ]] || fail "Proxy URL must use HTTPS."
  local authority="${proxy_url#https://}"
  authority="${authority%%/*}"
  [[ -n "$authority" ]] || fail "Proxy URL has no host."
  [[ "$authority" != *"@"* ]] || fail "Credentials must not be embedded in the proxy URL."
  [[ "$authority" != *":"* ]] || fail "Proxy URL ports are not supported by artifact-host validation."
  [[ "$proxy_url" == */ ]] || proxy_url="$proxy_url/"
}

require_uv() {
  command -v uv >/dev/null 2>&1 || fail "uv is required. Install uv, then run this command again."
}

confirm_or_require_yes() {
  local action="$1"
  if [[ "$yes" == true ]]; then
    return 0
  fi
  if [[ -t 0 ]]; then
    local reply
    printf '%s [y/N] ' "$action"
    IFS= read -r reply || true
    [[ "$reply" == "y" || "$reply" == "Y" || "$reply" == "yes" || "$reply" == "YES" ]] || fail "Cancelled."
    return 0
  fi
  fail "$action Re-run with --yes in noninteractive mode."
}

new_backup_path() {
  local timestamp candidate
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  candidate="$CONFIG_PATH.backup.$timestamp"
  if [[ -e "$candidate" ]]; then
    candidate="$candidate.$$"
  fi
  printf '%s\n' "$candidate"
}

write_atomic_config() {
  config_temp="$(mktemp "$CONFIG_DIR/.uv.toml.tmp.XXXXXX")"
  chmod 600 "$config_temp"
  managed_config > "$config_temp"
  mv -f -- "$config_temp" "$CONFIG_PATH"
  config_temp=""
  chmod 600 "$CONFIG_PATH"
}

write_state() {
  local backup_path="$1" state_temp
  state_temp="$(mktemp "$CONFIG_DIR/.microsoft-python-proxy-backup.tmp.XXXXXX")"
  chmod 600 "$state_temp"
  printf '%s\n' "$backup_path" > "$state_temp"
  mv -f -- "$state_temp" "$STATE_PATH"
  chmod 600 "$STATE_PATH"
}

read_valid_backup() {
  [[ -f "$STATE_PATH" ]] || return 1
  local backup_path extra=""
  IFS= read -r backup_path < "$STATE_PATH" || return 1
  IFS= read -r extra < <(sed -n '2p' "$STATE_PATH") || true
  [[ -z "$extra" ]] || return 1
  [[ "$backup_path" == "$CONFIG_PATH.backup."* ]] || return 1
  [[ -f "$backup_path" ]] || return 1
  printf '%s\n' "$backup_path"
}

install_config() {
  require_uv
  mkdir -p -- "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR" 2>/dev/null || true

  if is_expected_config; then
    chmod 600 "$CONFIG_PATH"
    note "Already configured: $CONFIG_PATH"
    return 0
  fi

  local backup_path=""
  if [[ -e "$CONFIG_PATH" ]]; then
    [[ -f "$CONFIG_PATH" ]] || fail "Configuration path exists but is not a regular file: $CONFIG_PATH"
    confirm_or_require_yes "Replace the existing uv configuration at $CONFIG_PATH?"
    backup_path="$(new_backup_path)"
    cp -p -- "$CONFIG_PATH" "$backup_path"
    chmod 600 "$backup_path"
    write_state "$backup_path"
    note "Backed up existing configuration: $backup_path"
  else
    rm -f -- "$STATE_PATH"
  fi

  write_atomic_config
  note "Configured uv global index: $CONFIG_PATH"
  note "Index: $proxy_url"
}

detect_python() {
  local detected=""
  detected="$(uv python find 2>/dev/null || true)"
  if [[ -n "$detected" && -x "$detected" ]]; then
    printf '%s\n' "$detected"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  if command -v python >/dev/null 2>&1; then
    command -v python
    return 0
  fi
  return 1
}

package_name_from_spec() {
  printf '%s\n' "$validation_package" | sed -E 's/[<>=!~;[:space:]].*$//; s/\[.*$//'
}

proxy_host() {
  local host="${proxy_url#https://}"
  host="${host%%/*}"
  printf '%s\n' "$host"
}

check_package_page() {
  if ! command -v curl >/dev/null 2>&1; then
    note "curl: not available; skipped package-page artifact-host check"
    return 0
  fi

  local package_name page_url page_file status host configured_host bad_host=false
  package_name="$(package_name_from_spec)"
  [[ -n "$package_name" ]] || fail "Cannot derive a package name from: $validation_package"
  page_url="${proxy_url%/}/$package_name/"
  page_file="$work_dir/package-page.html"
  status="$(curl --silent --show-error --location --output "$page_file" --write-out '%{http_code}' "$page_url" || true)"
  if [[ "$status" != "200" ]]; then
    note "Package page: HTTP $status from $page_url"
    note "A proxy root-listing 401 can coexist with a package-page 200; this package page did not return 200."
    return 1
  fi

  configured_host="$(proxy_host)"
  note "Package page: HTTP 200"
  local hosts_file="$work_dir/artifact-hosts.txt"
  grep -Eo 'https?://[^"'"'"'<>[:space:]]+' "$page_file" \
    | sed -E 's#^https?://([^/]+)/?.*$#\1#' \
    | sort -u > "$hosts_file" || true

  if [[ ! -s "$hosts_file" ]]; then
    note "Artifact hosts: none discovered in the package page"
    return 1
  fi

  note "Artifact hosts:"
  while IFS= read -r host; do
    printf '  %s\n' "$host"
    if [[ "$host" != "$configured_host" && "$host" != *.pkgs.visualstudio.com ]]; then
      bad_host=true
    fi
  done < "$hosts_file"

  if [[ "$bad_host" == true ]]; then
    fail "The package page referenced a host outside the Microsoft proxy and *.pkgs.visualstudio.com."
  fi
  note "Artifact hosts are Microsoft-hosted."
}

check_config() {
  require_uv
  note "uv version: $(uv --version)"
  note "uv config: $CONFIG_PATH"
  if ! is_expected_config; then
    fail "The global uv configuration does not exactly match the expected single-index configuration."
  fi
  note "Configuration content: verified"

  local python_path output_file
  python_path="$(detect_python)" || fail "No Python interpreter was detected by uv or on PATH."
  note "Python: $python_path"
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/microsoft-python-proxy-check.XXXXXX")"
  output_file="$work_dir/uv-output.txt"

  note "Dry-run package: $validation_package"
  if ! (cd "$work_dir" && uv pip install --dry-run --target "$work_dir/target" --python "$python_path" --verbose "$validation_package") > "$output_file" 2>&1; then
    cat -- "$output_file" >&2
    fail "uv dry-run failed. Review proxy availability, package access, TLS, and environment overrides."
  fi

  if ! grep -Fqi -- "$proxy_url" "$output_file" && ! grep -Fqi -- "$(proxy_host)" "$output_file"; then
    cat -- "$output_file" >&2
    fail "uv output did not reference the configured Microsoft proxy."
  fi
  if grep -Eqi '(^|[^[:alnum:].])(pypi\.org|files\.pythonhosted\.org)([^[:alnum:].]|$)' "$output_file"; then
    cat -- "$output_file" >&2
    fail "uv output referenced a forbidden public PyPI host. Check project, CLI, and environment overrides."
  fi
  note "uv dry-run: Microsoft proxy referenced; no public PyPI hosts referenced"
  check_package_page
  note "Check passed."
}

remove_config() {
  local prior_backup=""
  if prior_backup="$(read_valid_backup)"; then
    if [[ -e "$CONFIG_PATH" ]] && ! is_managed_config; then
      confirm_or_require_yes "Replace the unrecognized current uv configuration and restore its recorded predecessor?"
      local edited_backup
      edited_backup="$(new_backup_path)"
      cp -p -- "$CONFIG_PATH" "$edited_backup"
      chmod 600 "$edited_backup"
      note "Backed up user-edited configuration: $edited_backup"
    fi
    mkdir -p -- "$CONFIG_DIR"
    config_temp="$(mktemp "$CONFIG_DIR/.uv.toml.tmp.XXXXXX")"
    cp -p -- "$prior_backup" "$config_temp"
    chmod 600 "$config_temp"
    mv -f -- "$config_temp" "$CONFIG_PATH"
    config_temp=""
    rm -f -- "$STATE_PATH"
    note "Restored prior configuration: $CONFIG_PATH"
    note "Preserved backup: $prior_backup"
    return 0
  fi

  if [[ ! -e "$CONFIG_PATH" ]]; then
    note "No uv configuration to remove: $CONFIG_PATH"
    return 0
  fi
  [[ -f "$CONFIG_PATH" ]] || fail "Configuration path exists but is not a regular file: $CONFIG_PATH"

  if is_managed_config; then
    rm -f -- "$CONFIG_PATH"
    rm -f -- "$STATE_PATH"
    note "Removed managed configuration: $CONFIG_PATH"
    return 0
  fi

  confirm_or_require_yes "Remove the unrecognized uv configuration at $CONFIG_PATH after backing it up?"
  local edited_backup
  edited_backup="$(new_backup_path)"
  cp -p -- "$CONFIG_PATH" "$edited_backup"
  chmod 600 "$edited_backup"
  rm -f -- "$CONFIG_PATH"
  rm -f -- "$STATE_PATH"
  note "Backed up unrecognized configuration: $edited_backup"
  note "Removed configuration: $CONFIG_PATH"
}

parse_args() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      install|check|remove|help)
        command_name="$1"
        shift
        ;;
      -h|--help)
        command_name="help"
        shift
        ;;
      --*) ;;
      *) fail "Unknown command: $1" ;;
    esac
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url)
        [[ $# -ge 2 ]] || fail "--url requires a value."
        proxy_url="$2"
        shift 2
        ;;
      --package)
        [[ $# -ge 2 ]] || fail "--package requires a value."
        validation_package="$2"
        shift 2
        ;;
      --yes)
        yes=true
        shift
        ;;
      -h|--help)
        command_name="help"
        shift
        ;;
      *) fail "Unknown option: $1" ;;
    esac
  done
}

parse_args "$@"
validate_url
case "$command_name" in
  install) install_config ;;
  check) check_config ;;
  remove) remove_config ;;
  help) usage ;;
esac
