#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${repo_root}"

pnpm install --frozen-lockfile
pnpm run build

global_root="$(npm root --global)"
npm_bin="$(npm prefix --global)/bin"
global_package="${global_root}/@deepseek-ai/dsh"
global_command="${npm_bin}/dsh"

if [[ -L "${global_package}" || -f "${global_package}" ]]; then
  rm -f "${global_package}"
elif [[ -d "${global_package}" ]]; then
  rm -rf "${global_package}"
fi
rm -f "${global_command}"

mkdir -p "$(dirname -- "${global_package}")" "${npm_bin}"
ln -s "${repo_root}/apps/cli" "${global_package}"
ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js "${global_command}"

export PATH="${npm_bin}:${PATH}"

printf 'Linked local dsh at %s\n' "$(command -v dsh)"
dsh --version
