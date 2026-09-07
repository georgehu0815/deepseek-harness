#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly DEFAULT_URL="https://packagefeedproxy.microsoft.io/npm/"
readonly DEFAULT_PACKAGE="lodash@4.18.1"

command_name="install"
proxy_url="$DEFAULT_URL"
validation_package="$DEFAULT_PACKAGE"
manager="all"
yes=false
config_path="${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}"
state_dir="${XDG_CONFIG_HOME:-$HOME/.config}/npm"
state_path="$state_dir/.microsoft-node-proxy-backup"
config_temp=""
state_temp=""
work_dir=""

cleanup() {
  if [[ -n "$config_temp" && ( -e "$config_temp" || -L "$config_temp" ) ]]; then
    rm -f -- "$config_temp"
  fi
  if [[ -n "$state_temp" && ( -e "$state_temp" || -L "$state_temp" ) ]]; then
    rm -f -- "$state_temp"
  fi
  if [[ -n "$work_dir" && -d "$work_dir" && ! -L "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

usage() {
  cat <<'EOF'
Usage: setup-microsoft-node-proxy.sh [command] [options]

Configure npm and pnpm to use Microsoft's corporate Node package proxy.
Node.js libraries are distributed as npm packages. npm and pnpm both read one
user npmrc, so this script manages that shared file without installing tools.

Commands:
  install              Install the user npm configuration (default)
  check                Verify configuration and package resolution
  remove               Restore the prior configuration or remove the managed file
  help                 Show this help

Options:
  --url URL             Approved HTTPS npm registry URL
  --package SPEC        Validation package (default: lodash@4.18.1)
  --manager VALUE       npm, pnpm, or all (default: all)
  --yes                 Allow noninteractive replacement or removal
  -h, --help            Show this help

The script configures one registry only. It never adds credentials, public
fallbacks, scoped fallbacks, or a Defender bypass.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

path_exists() {
  [[ -e "$1" || -L "$1" ]]
}

is_regular_file() {
  [[ -f "$1" && ! -L "$1" ]]
}

managed_config() {
  cat <<EOF
# Managed by setup-microsoft-node-proxy.sh.
# Microsoft corporate npm proxy. Keep this as the sole registry.
registry=$proxy_url
# End setup-microsoft-node-proxy.sh managed configuration.
EOF
}

unmarked_config() {
  printf 'registry=%s\n' "$proxy_url"
}

config_equals() {
  is_regular_file "$config_path" || return 1
  local expected="$1" actual
  actual="$(cat -- "$config_path")"
  [[ "$actual" == "$expected" ]]
}

is_managed_config() {
  config_equals "$(managed_config)"
}

is_expected_config() {
  is_managed_config || config_equals "$(unmarked_config)"
}

validate_absolute_paths() {
  [[ "$config_path" == /* ]] || fail "NPM_CONFIG_USERCONFIG must be an absolute path."
  [[ "$state_dir" == /* ]] || fail "XDG_CONFIG_HOME must resolve to an absolute path."
}

validate_url() {
  [[ "$proxy_url" == https://* ]] || fail "Proxy URL must use HTTPS."
  [[ "$proxy_url" != *$'\n'* && "$proxy_url" != *$'\r'* && "$proxy_url" != *$'\t'* && "$proxy_url" != *' '* ]] \
    || fail "Proxy URL must not contain whitespace."
  [[ "$proxy_url" != *'?'* && "$proxy_url" != *'#'* ]] \
    || fail "Proxy URL must not contain a query string or fragment."

  local remainder authority
  remainder="${proxy_url#https://}"
  authority="${remainder%%/*}"
  [[ -n "$authority" ]] || fail "Proxy URL has no host."
  [[ "$authority" != *'@'* ]] || fail "Credentials must not be embedded in the proxy URL."
  [[ "$authority" != ':'* && "$authority" != *':' ]] || fail "Proxy URL has an invalid host."

  while [[ "$proxy_url" == */ ]]; do
    proxy_url="${proxy_url%/}"
  done
  proxy_url="$proxy_url/"
}

configured_host() {
  local value="${proxy_url#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s\n' "$value"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

validate_tools() {
  case "$manager" in
    npm)
      require_command node "Node.js is required for --manager npm."
      require_command npm "npm is required for --manager npm."
      ;;
    pnpm)
      require_command pnpm "pnpm is required for --manager pnpm."
      ;;
    all)
      require_command node "Node.js is required for --manager all."
      require_command npm "npm is required for --manager all."
      if ! command -v pnpm >/dev/null 2>&1; then
        note "pnpm: not installed; validation will skip pnpm"
      fi
      ;;
  esac
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
    [[ "$reply" == "y" || "$reply" == "Y" || "$reply" == "yes" || "$reply" == "YES" ]] \
      || fail "Cancelled."
    return 0
  fi
  fail "$action Re-run with --yes in noninteractive mode."
}

ensure_directories() {
  local config_dir
  config_dir="$(dirname -- "$config_path")"
  if path_exists "$config_dir"; then
    [[ -d "$config_dir" && ! -L "$config_dir" ]] \
      || fail "Configuration parent is not a regular directory: $config_dir"
  else
    mkdir -p -- "$config_dir"
    chmod 700 "$config_dir"
  fi

  if path_exists "$state_dir"; then
    [[ -d "$state_dir" && ! -L "$state_dir" ]] \
      || fail "State path is not a regular directory: $state_dir"
  else
    mkdir -p -- "$state_dir"
    chmod 700 "$state_dir"
  fi
}

new_backup_path() {
  local timestamp candidate
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  candidate="$config_path.backup.$timestamp"
  if path_exists "$candidate"; then
    candidate="$candidate.$$"
  fi
  printf '%s\n' "$candidate"
}

create_backup() {
  local source_path="$1" backup_path
  is_regular_file "$source_path" || fail "Cannot back up a non-regular configuration path."
  backup_path="$(new_backup_path)"
  cp -p -- "$source_path" "$backup_path"
  chmod 600 "$backup_path"
  printf '%s\n' "$backup_path"
}

write_atomic_config() {
  local config_dir
  config_dir="$(dirname -- "$config_path")"
  config_temp="$(mktemp "$config_dir/.npmrc.microsoft-node-proxy.tmp.XXXXXX")"
  chmod 600 "$config_temp"
  managed_config > "$config_temp"
  mv -f -- "$config_temp" "$config_path"
  config_temp=""
  chmod 600 "$config_path"
}

write_state() {
  local backup_path="$1"
  if path_exists "$state_path" && ! is_regular_file "$state_path"; then
    fail "State path exists but is not a regular file: $state_path"
  fi
  state_temp="$(mktemp "$state_dir/.microsoft-node-proxy-backup.tmp.XXXXXX")"
  chmod 600 "$state_temp"
  printf '%s\n' "$backup_path" > "$state_temp"
  mv -f -- "$state_temp" "$state_path"
  state_temp=""
  chmod 600 "$state_path"
}

clear_state() {
  if ! path_exists "$state_path"; then
    return 0
  fi
  is_regular_file "$state_path" || fail "State path exists but is not a regular file: $state_path"
  rm -f -- "$state_path"
}

read_valid_backup() {
  is_regular_file "$state_path" || return 1
  local backup_path="" extra=""
  IFS= read -r backup_path < "$state_path" || return 1
  IFS= read -r extra < <(sed -n '2p' "$state_path") || true
  [[ -z "$extra" ]] || return 1
  [[ "$backup_path" == "$config_path.backup."* ]] || return 1
  local backup_suffix="${backup_path#"$config_path.backup."}"
  [[ -n "$backup_suffix" && "$backup_suffix" != */* ]] || return 1
  is_regular_file "$backup_path" || return 1
  printf '%s\n' "$backup_path"
}

install_config() {
  validate_tools
  ensure_directories

  if path_exists "$config_path" && ! is_regular_file "$config_path"; then
    fail "Configuration path exists but is not a regular file: $config_path"
  fi

  if is_expected_config; then
    chmod 600 "$config_path"
    note "Already configured: $config_path"
    return 0
  fi

  local backup_path=""
  if path_exists "$config_path"; then
    confirm_or_require_yes "Replace the existing user npm configuration at $config_path?"
    backup_path="$(create_backup "$config_path")"
    write_state "$backup_path"
    note "Backed up existing configuration: $backup_path"
  else
    clear_state
  fi

  write_atomic_config
  note "Configured shared npm and pnpm user file: $config_path"
  note "Registry host: $(configured_host)"
}

extract_https_url() {
  local source_file="$1" result_file="$2"
  grep -Eo 'https://[^[:space:]"'"'"'<>]+' "$source_file" > "$result_file" || true
  [[ -s "$result_file" ]] || return 1
  sed -n '1p' "$result_file"
}

host_from_url() {
  local url="$1" remainder authority host
  [[ "$url" == https://* ]] || return 1
  remainder="${url#https://}"
  authority="${remainder%%/*}"
  [[ -n "$authority" && "$authority" != *'@'* ]] || return 1
  host="${authority%%:*}"
  [[ -n "$host" ]] || return 1
  printf '%s\n' "$host"
}

host_is_approved() {
  local host="$1" expected
  expected="$(configured_host)"
  [[ "$host" == "$expected" || "$host" == *.pkgs.visualstudio.com ]]
}

validate_captured_urls() {
  local source_file="$1" label="$2" urls_file url host found=false
  urls_file="$work_dir/urls.$$.txt"
  grep -Eo 'https?://[^[:space:]"'"'"'<>]+' "$source_file" > "$urls_file" || true
  while IFS= read -r url; do
    found=true
    if [[ "$url" != https://* ]]; then
      fail "$label referenced a non-HTTPS URL."
    fi
    if ! host="$(host_from_url "$url")"; then
      fail "$label contained an invalid or credential-bearing URL."
    fi
    if [[ "$host" == "registry.npmjs.org" ]]; then
      fail "$label referenced the forbidden public npm registry."
    fi
    host_is_approved "$host" || fail "$label referenced an unapproved host: $host"
  done < "$urls_file"
  rm -f -- "$urls_file"
  [[ "$found" == true ]] || return 0
}

run_metadata_check() {
  local tool="$1" stdout_file stderr_file urls_file tarball_url host
  stdout_file="$work_dir/$tool-view.out"
  stderr_file="$work_dir/$tool-view.err"
  urls_file="$work_dir/$tool-view.urls"

  if ! (cd "$work_dir" && "$tool" view "$validation_package" dist.tarball) \
    > "$stdout_file" 2> "$stderr_file"; then
    fail "$tool view failed. Check proxy availability, package access, TLS, and overrides."
  fi
  tarball_url="$(extract_https_url "$stdout_file" "$urls_file")" \
    || fail "$tool view did not return an HTTPS tarball URL."
  host="$(host_from_url "$tarball_url")" \
    || fail "$tool view returned an invalid or credential-bearing tarball URL."
  if [[ "$host" == "registry.npmjs.org" ]]; then
    fail "$tool resolved the tarball from the forbidden public npm registry."
  fi
  host_is_approved "$host" || fail "$tool resolved the tarball from an unapproved host: $host"
  validate_captured_urls "$stdout_file" "$tool view output"
  validate_captured_urls "$stderr_file" "$tool view diagnostics"
  note "$tool view: approved Microsoft artifact host ($host)"
}

run_npm_dry_run() {
  local stdout_file="$work_dir/npm-install.out" stderr_file="$work_dir/npm-install.err"
  if ! (cd "$work_dir" && npm install --dry-run --ignore-scripts --no-save --package-lock=false "$validation_package") \
    > "$stdout_file" 2> "$stderr_file"; then
    fail "npm install dry-run failed. Check proxy availability, package access, TLS, and overrides."
  fi
  validate_captured_urls "$stdout_file" "npm install dry-run output"
  validate_captured_urls "$stderr_file" "npm install dry-run diagnostics"
  note "npm install dry-run: passed"
}

check_config() {
  validate_tools
  note "Configuration path: $config_path"
  if path_exists "$config_path" && ! is_regular_file "$config_path"; then
    fail "Configuration path exists but is not a regular file: $config_path"
  fi
  is_expected_config \
    || fail "The user npm configuration does not exactly match the expected single-registry configuration."
  note "Configuration content: verified without displaying it"

  if command -v node >/dev/null 2>&1; then
    note "Node.js version: $(node --version)"
  fi
  if [[ "$manager" == "npm" || "$manager" == "all" ]]; then
    note "npm version: $(npm --version)"
  fi
  if [[ "$manager" == "pnpm" || ( "$manager" == "all" && $(command -v pnpm >/dev/null 2>&1; printf '%s' "$?") == 0 ) ]]; then
    note "pnpm version: $(pnpm --version)"
  elif [[ "$manager" == "all" ]]; then
    note "pnpm: not installed; skipped"
  fi

  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/microsoft-node-proxy-check.XXXXXX")"
  chmod 700 "$work_dir"
  note "Validation package: $validation_package"

  if [[ "$manager" == "npm" || "$manager" == "all" ]]; then
    run_metadata_check npm
    run_npm_dry_run
  fi
  if [[ "$manager" == "pnpm" ]]; then
    run_metadata_check pnpm
  elif [[ "$manager" == "all" ]] && command -v pnpm >/dev/null 2>&1; then
    run_metadata_check pnpm
  fi
  note "Check passed."
}

restore_backup() {
  local backup_path="$1" config_dir
  config_dir="$(dirname -- "$config_path")"
  config_temp="$(mktemp "$config_dir/.npmrc.microsoft-node-proxy.tmp.XXXXXX")"
  cp -p -- "$backup_path" "$config_temp"
  chmod 600 "$config_temp"
  mv -f -- "$config_temp" "$config_path"
  config_temp=""
}

remove_config() {
  ensure_directories
  if path_exists "$config_path" && ! is_regular_file "$config_path"; then
    fail "Configuration path exists but is not a regular file: $config_path"
  fi
  if path_exists "$state_path" && ! is_regular_file "$state_path"; then
    fail "State path exists but is not a regular file: $state_path"
  fi

  local prior_backup=""
  if prior_backup="$(read_valid_backup)"; then
    if path_exists "$config_path" && ! is_managed_config; then
      confirm_or_require_yes "Replace the unrecognized current npm configuration and restore its recorded predecessor?"
      local edited_backup
      edited_backup="$(create_backup "$config_path")"
      note "Backed up user-edited configuration: $edited_backup"
    fi
    restore_backup "$prior_backup"
    clear_state
    note "Restored prior configuration: $config_path"
    note "Preserved backup: $prior_backup"
    return 0
  fi

  if ! path_exists "$config_path"; then
    note "No user npm configuration to remove: $config_path"
    return 0
  fi

  if is_managed_config; then
    rm -f -- "$config_path"
    clear_state
    note "Removed managed configuration: $config_path"
    return 0
  fi

  confirm_or_require_yes "Remove the unrecognized npm configuration at $config_path after backing it up?"
  local edited_backup
  edited_backup="$(create_backup "$config_path")"
  rm -f -- "$config_path"
  clear_state
  note "Backed up unrecognized configuration: $edited_backup"
  note "Removed configuration: $config_path"
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
      --manager)
        [[ $# -ge 2 ]] || fail "--manager requires npm, pnpm, or all."
        manager="$2"
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

  case "$manager" in
    npm|pnpm|all) ;;
    *) fail "--manager must be npm, pnpm, or all." ;;
  esac
  [[ -n "$validation_package" ]] || fail "--package must not be empty."
}

parse_args "$@"
validate_absolute_paths
validate_url
case "$command_name" in
  install) install_config ;;
  check) check_config ;;
  remove) remove_config ;;
  help) usage ;;
esac
