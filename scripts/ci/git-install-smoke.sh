#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

repo_dir="$tmpdir/repo"
bin_dir="$tmpdir/bin"
data_dir="$tmpdir/data"

git clone "file://$ROOT" "$repo_dir" >/dev/null

rm -rf "$bin_dir" "$data_dir"
XDG_BIN_HOME="$bin_dir" \
XDG_DATA_HOME="$data_dir" \
uv tool install --force "git+file://$repo_dir#subdirectory=cli"
"$bin_dir/sonde" --version
