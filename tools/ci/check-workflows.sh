#!/usr/bin/env bash
set -euo pipefail
bash -n tools/musescore-web/build.sh
directory=.cache/actionlint
archive="$directory/actionlint.tar.gz"
mkdir -p "$directory"
if [ ! -f "$archive" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz -o "$archive"
fi
# Official v1.7.7 release checksums, verified when introducing this workflow.
printf '023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757  %s\n' "$archive" | sha256sum --check --strict
tar -xzf "$archive" -C "$directory" actionlint
"$directory/actionlint" -color
