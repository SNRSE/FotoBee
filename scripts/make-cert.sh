#!/usr/bin/env bash
#
# FotoBee – create a self-signed development certificate for HTTPS.
#
# The camera only works in a secure context, so a tablet on the same Wi-Fi can
# only open the booth over HTTPS. This script writes
#
#   certs/dev-key.pem   private key
#   certs/dev-cert.pem  certificate (valid 825 days, SAN: localhost, 127.0.0.1,
#                       the host name and every LAN IPv4 address found)
#
# Usage:  bash scripts/make-cert.sh [--force] [--out DIR] [--days N]
#         npm run cert
#
# Existing certificates are kept unless --force is given.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/certs"
DAYS=825
FORCE=0

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --force|-f) FORCE=1 ;;
    --out|-o) [ $# -ge 2 ] || { echo "$1 needs a value" >&2; usage >&2; exit 2; }; OUT_DIR="$2"; shift ;;
    --days|-d) [ $# -ge 2 ] || { echo "$1 needs a value" >&2; usage >&2; exit 2; }
              case "$2" in ''|*[!0-9]*) echo "--days expects a number of days, got '$2'" >&2; exit 2 ;; esac
              DAYS="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

KEY="$OUT_DIR/dev-key.pem"
CERT="$OUT_DIR/dev-cert.pem"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found. Install it (e.g. apt install openssl / brew install openssl) and try again." >&2
  exit 1
fi

# Relative paths in the start hint, when the certificates live inside the project.
display_path() {
  case "$1" in
    "$ROOT"/*) printf '%s' "${1#"$ROOT"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

print_start_hint() {
  local key cert
  key="$(display_path "$KEY")"
  cert="$(display_path "$CERT")"
  cat <<EOF

Start the booth with HTTPS:

  SSL_KEY=$key SSL_CERT=$cert npm start

  (PowerShell:  \$env:SSL_KEY="$key"; \$env:SSL_CERT="$cert"; npm start)

Then open https://<this computer's IP>:3000 on the tablet and accept the
certificate warning once ("Advanced" -> "Proceed"). The server prints the
LAN URLs when it starts.
EOF
}

if [ "$FORCE" -eq 0 ]; then
  if [ -f "$KEY" ] && [ -f "$CERT" ]; then
    echo "Certificate already exists: $(display_path "$CERT") (use --force to regenerate)"
    print_start_hint
    exit 0
  fi
  if [ -f "$KEY" ] || [ -f "$CERT" ]; then
    echo "Only one of $(display_path "$KEY") / $(display_path "$CERT") exists. Run again with --force to recreate both." >&2
    exit 1
  fi
fi

# --- Collect subject alternative names -------------------------------------
lan_ips() {
  if command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n'
  elif command -v ip >/dev/null 2>&1; then
    ip -4 addr 2>/dev/null | awk '/inet /{split($2, a, "/"); print a[1]}'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '/inet /{print $2}' | sed 's/^addr://'
  fi
}

SAN="DNS:localhost,IP:127.0.0.1"
HOSTNAME_SHORT="$(hostname 2>/dev/null | cut -d. -f1 || true)"
if [ -n "$HOSTNAME_SHORT" ] && [ "$HOSTNAME_SHORT" != "localhost" ]; then
  SAN="$SAN,DNS:$HOSTNAME_SHORT,DNS:$HOSTNAME_SHORT.local"
fi
while read -r ip; do
  case "$ip" in
    ''|127.*|*:*) continue ;;                       # empty, loopback, IPv6
    *) case ",$SAN," in *",IP:$ip,"*) ;; *) SAN="$SAN,IP:$ip" ;; esac ;;
  esac
done < <(lan_ips || true)

# --- Generate ----------------------------------------------------------------
mkdir -p "$OUT_DIR"
CONF="$(mktemp "${TMPDIR:-/tmp}/fotobee-cert.XXXXXX")"
trap 'rm -f "$CONF" "$KEY.tmp" "$CERT.tmp"' EXIT

# A config file works with every OpenSSL/LibreSSL version (unlike -addext).
cat > "$CONF" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[dn]
CN = FotoBee dev
O = FotoBee

[v3_req]
subjectAltName = $SAN
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

echo "Creating a self-signed certificate ($DAYS days) for: $SAN"
if ! openssl_output=$(openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days "$DAYS" \
  -keyout "$KEY.tmp" -out "$CERT.tmp" -config "$CONF" 2>&1); then
  printf '%s\n' "$openssl_output" >&2
  echo "openssl failed – no certificate was written." >&2
  rm -f "$KEY.tmp" "$CERT.tmp"
  exit 1
fi
chmod 600 "$KEY.tmp"
mv "$KEY.tmp" "$KEY"
mv "$CERT.tmp" "$CERT"

echo "Written: $(display_path "$KEY")"
echo "         $(display_path "$CERT")"
echo "Fingerprint: $(openssl x509 -noout -fingerprint -sha256 -in "$CERT" | cut -d= -f2-)"
print_start_hint
