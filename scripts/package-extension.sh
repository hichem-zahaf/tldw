#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('${repo_dir}/manifest.json').version")"
output_dir="${repo_dir}/dist"
staging_dir="$(mktemp -d)"
archive="${output_dir}/tldw-chrome-v${version}.zip"

cleanup() {
  rm -rf "${staging_dir}"
}
trap cleanup EXIT

files=(
  manifest.json
  background.js
  summarizer.js
  summary-prompts.js
  summary-progress.js
  summary-queue.js
  content.js
  content.css
  popup.html
  popup.js
  popup.css
  options.html
  options.js
  options.css
)

mkdir -p "${staging_dir}/icons" "${output_dir}"

for file in "${files[@]}"; do
  cp "${repo_dir}/${file}" "${staging_dir}/${file}"
done
cp "${repo_dir}"/icons/icon{16,32,48,128}.png "${staging_dir}/icons/"

rm -f "${archive}"
(
  cd "${staging_dir}"
  zip -q -r "${archive}" .
)

echo "${archive}"
