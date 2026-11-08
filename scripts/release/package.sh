#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <version> <api-image-digest> <web-image-digest>" >&2
  exit 2
fi

version="$1"
api_digest="$2"
web_digest="$3"
root="$(git rev-parse --show-toplevel)"
out_dir="${RELEASE_OUTPUT_DIR:-$root/dist/release}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

for value in "$version" "$api_digest" "$web_digest"; do
  [[ "$value" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "Invalid release metadata" >&2; exit 2; }
done
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-\.][a-zA-Z0-9.-]+)?$ ]] || {
  echo 'Release version must look like v1.2.3' >&2
  exit 2
}
[[ -d "$root/installer" ]] || { echo "installer/ is required" >&2; exit 1; }
[[ "$api_digest" =~ ^sha256:[0-9a-f]{64}$ && "$web_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Image digests must be sha256 digests" >&2
  exit 2
}

mkdir -p "$out_dir"
bundle="$stage/dkp-guild-site-$version"
mkdir -p "$bundle"
cp "$root/installer/dkp" "$root/installer/compose.yml" "$root/installer/Caddyfile" "$root/installer/README.md" "$bundle/"
chmod 755 "$bundle/dkp"
owner="${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER is required}"
owner="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')"
[[ "$owner" =~ ^[a-z0-9-]+$ ]] || { echo 'Invalid owner' >&2; exit 2; }
cat > "$bundle/release-manifest.json" <<EOF
{"version":"$version","repository":"${GITHUB_REPOSITORY:?}","images":{"api":"ghcr.io/$owner/dkp-guild-api@$api_digest","web":"ghcr.io/$owner/dkp-guild-web@$web_digest"},"platforms":["linux/amd64","linux/arm64"]}
EOF
(cd "$bundle" && sha256sum dkp Caddyfile compose.yml README.md release-manifest.json > SHA256SUMS)

archive="$out_dir/dkp-guild-site-$version.tar.gz"
tar -czf "$archive" -C "$stage" "dkp-guild-site-$version"
(cd "$out_dir" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
