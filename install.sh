#!/usr/bin/env bash
# Deploy Boat installer (and updater). Ubuntu 22.04 / 24.04 or Debian 12. Run as root:
#   curl -fsSL deployboat.github.io/install.sh | sudo bash
#
# With your own domain (apps at <name>.example.com, dashboard at deployboat.example.com):
#   curl -fsSL deployboat.github.io/install.sh | sudo bash -s -- --domain example.com
# You can also add or change the domain later, in the dashboard under Settings.
#
# Which version:
#   (nothing)            the latest release (recommended)
#   --version v0.5.0     that exact release. Also how you go back to an older one.
#   --edge               the newest code on main, not released yet. For testing.
#                        Remembered: later updates stay on edge until you pick a version.
#
# Safe to run again: it skips what's already there and updates the rest.
# Everything the commands print goes to the log file; the screen shows one line per step.
set -euo pipefail

REPO="${DEPLOYBOAT_REPO:-https://github.com/deployboat/deployboat.git}"
DIR=/opt/deployboat
DATA=/var/lib/deployboat
LOG=/var/log/deployboat-install.log
UNIT_FILE=/etc/systemd/system/deployboat.service
CHANNEL_FILE=$DATA/channel   # contains "edge" if this server follows main

# --domain example.com (or DOMAIN=example.com). Optional.
DOMAIN="${DOMAIN:-}"
WANT=""   # "", "edge", or a version like v0.5.0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 || shift ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --version) WANT="${2:-}"; shift 2 || shift ;;
    --version=*) WANT="${1#*=}"; shift ;;
    --edge) WANT=edge; shift ;;
    *) shift ;;
  esac
done
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -e 's#^https\?://##' -e 's#^\*\.##' -e 's#[/:].*$##' -e 's#\.$##')"
# Updating without --domain keeps the domain from the last install.
if [ -z "$DOMAIN" ] && [ -f "$UNIT_FILE" ]; then
  DOMAIN="$(sed -n 's/^Environment=BASE_DOMAIN=//p' "$UNIT_FILE")"
fi
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1

# --- looks -------------------------------------------------------------------------

if [ -t 1 ]; then
  B=$'\033[1m' DIM=$'\033[2m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' BL=$'\033[34m' X=$'\033[0m'
else
  B="" DIM="" G="" Y="" R="" BL="" X=""   # no colors when not in a terminal (e.g. "Update now")
fi

TOTAL=9
STEP=0

line() { printf '%s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$*"; }

fail() {
  printf '\n  %s✗ %s%s\n\n' "$R$B" "$*" "$X"
  exit 1
}

# Run one step: a title on screen, all output into the log, a spinner while it works.
step() {
  local title="$1"; shift
  STEP=$((STEP + 1))
  local label
  label=$(printf '%s[%d/%d]%s %s' "$DIM" "$STEP" "$TOTAL" "$X" "$title")
  printf '\n=== %s ===\n' "$title" >>"$LOG"
  local start=$SECONDS

  ( "$@" ) </dev/null >>"$LOG" 2>&1 &
  local pid=$!
  if [ -t 1 ]; then
    # Plain ASCII spinner: works even when the server's locale isn't UTF-8.
    local frames='|/-\\' i=0
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r  %s %s ' "${BL}${frames:i++%4:1}${X}" "$label"
      sleep 0.15
    done
  else
    printf '  … %s\n' "$label"
  fi

  if wait "$pid"; then
    printf '\r  %s✓%s %s %s(%ss)%s\033[K\n' "$G" "$X" "$label" "$DIM" "$((SECONDS - start))" "$X"
  else
    printf '\r  %s✗%s %s\033[K\n\n' "$R" "$X" "$label"
    line "  ${B}Something went wrong while: ${title}${X}"
    line "  Last lines of the log:"
    line ""
    tail -n 15 "$LOG" | sed 's/^/    /'
    line ""
    line "  Full log: ${B}${LOG}${X}"
    line "  It's safe to run the installer again. If it keeps failing, open an issue:"
    line "  https://github.com/deployboat/deployboat/issues"
    line ""
    exit 1
  fi
}

# --- the steps ----------------------------------------------------------------------

install_basics() {
  apt-get update -qq
  apt-get install -y -qq curl git openssh-client ca-certificates ufw fail2ban unattended-upgrades
}

secure_server() {
  ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp
  ufw --force enable
  systemctl enable --now fail2ban
  dpkg-reconfigure -f noninteractive unattended-upgrades
  if ! swapon --show | grep -q .; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

install_docker() {
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
  mkdir -p /etc/docker
  [ -f /etc/docker/daemon.json ] || echo '{"log-driver":"local","log-opts":{"max-size":"10m"}}' > /etc/docker/daemon.json
  systemctl enable docker
  systemctl restart docker
}

install_node() {
  if ! node -v 2>/dev/null | grep -q '^v2[4-9]'; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
    apt-get install -y -qq nodejs
  fi
  node -v
}

install_railpack() {
  command -v railpack >/dev/null || curl -fsSL https://railpack.com/install.sh | bash
  railpack --version || true
}

start_services() {
  docker network inspect deployboat >/dev/null 2>&1 || docker network create deployboat
  # Only Caddy's network may reach Deploy Boat on port 3000. Not apps, not the internet.
  local subnet
  subnet="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' deployboat)"
  ufw allow from "$subnet" to any port 3000 proto tcp
  ufw delete allow from 172.16.0.0/12 to any port 3000 proto tcp || true   # older, wider rule

  docker inspect buildkit >/dev/null 2>&1 || docker run -d --name buildkit --privileged --restart unless-stopped moby/buildkit

  mkdir -p "$DATA/caddy"
  chmod 700 "$DATA"   # app secrets live here: root only
  [ -f "$DATA/caddy/config.json" ] || echo '{}' > "$DATA/caddy/config.json"
  # Always recreate Caddy so it has the latest settings. Its routes live in config.json.
  docker rm -f caddy >/dev/null 2>&1 || true
  docker run -d --name caddy --restart unless-stopped \
    --network deployboat --add-host host.docker.internal:host-gateway \
    -p 80:80 -p 443:443 -p 443:443/udp \
    -v "$DATA/caddy:/data" \
    caddy:2 caddy run --config /data/config.json
}

# The newest release tag, like v0.5.0. Empty if there are no releases yet.
latest_release() {
  git ls-remote --tags --refs --sort=-v:refname "$REPO" 'v*' | head -1 | sed 's#.*refs/tags/##'
}

# The version this server runs: its release tag, or the commit for edge.
current_version() {
  git -C "$DIR" describe --tags --exact-match 2>/dev/null || git -C "$DIR" log -1 --format='%h (main)'
}

get_code() {
  # Which code: --edge, --version, what this server followed before, or the latest release.
  if [ -z "$WANT" ] && [ "$(cat "$CHANNEL_FILE" 2>/dev/null)" = edge ]; then WANT=edge; fi
  if [ "$WANT" = edge ]; then
    REF=main
  elif [ -n "$WANT" ]; then
    REF="v${WANT#v}"   # accept 0.5.0 or v0.5.0
    [ -n "$(git ls-remote --tags "$REPO" "refs/tags/$REF")" ] || { echo "There's no version $REF."; return 1; }
  else
    REF="$(latest_release)"
    [ -n "$REF" ] || REF=main   # no releases yet
  fi
  echo "Getting $REF"

  [ -d "$DIR/.git" ] || git clone -q "$REPO" "$DIR"
  git -C "$DIR" remote set-url origin "$REPO"   # follow the repo if it moved (e.g. to the deployboat org)
  git -C "$DIR" fetch -q --tags --force origin main
  # The server copy is never edited by hand, so --force is safe.
  if [ "$REF" = main ]; then
    git -C "$DIR" checkout -q --force -B main origin/main
  else
    git -C "$DIR" checkout -q --force "refs/tags/$REF"
  fi

  # Remember edge, so the next plain update (or "Update now") stays on it.
  mkdir -p "$DATA"
  if [ "$WANT" = edge ]; then echo edge > "$CHANNEL_FILE"; else rm -f "$CHANNEL_FILE"; fi

  (cd "$DIR/server" && npm install --omit=dev --no-audit --no-fund)
  echo "Version: $(current_version)"
}

start_deployboat() {
  cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=Deploy Boat
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=$DIR/server
ExecStart=$(command -v node) index.ts
Environment=PUBLIC_IP=$IP
Environment=BASE_DOMAIN=$DOMAIN
Environment=BUILDKIT_HOST=docker-container://buildkit
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable deployboat
  systemctl restart deployboat
  # Wait until it answers (up to 30 seconds).
  for _ in $(seq 30); do
    curl -fs -o /dev/null http://127.0.0.1:3000/ && return 0
    sleep 1
  done
  systemctl status deployboat --no-pager || true
  journalctl -u deployboat -n 30 --no-pager || true
  return 1
}

# Does *.DOMAIN point here? Ask public DNS (1.1.1.1) with a random name, the way a new app's address would.
# Not a hard stop: the free nip.io addresses work meanwhile, and the dashboard re-checks.
DOMAIN_OK=true
check_domain() {
  local probe="check-$RANDOM$RANDOM.$DOMAIN" got=""
  if command -v dig >/dev/null; then
    got="$(dig +short +time=4 +tries=2 A "$probe" @1.1.1.1 2>/dev/null | grep -E '^[0-9.]+$' | sort -u | tr '\n' ' ' || true)"
  else
    got="$(getent ahostsv4 "$probe" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
  fi
  got="${got% }"
  [ "$got" = "$IP" ] && { line "  Domain      ${B}*.${DOMAIN}${X} ${G}points here ✓${X}"; return; }
  DOMAIN_OK=false
  line ""
  if [ -z "$got" ]; then warn "${B}*.${DOMAIN}${X} doesn't point anywhere yet."
  else warn "${B}*.${DOMAIN}${X} points to ${got}, not to this server (${IP})."
  fi
  line "    Where you bought the domain, open its DNS settings and add:"
  line ""
  line "      Type ${B}A${X}    Name ${B}*${X}    Value ${B}${IP}${X}"
  line ""
  line "    ${DIM}If ${DOMAIN} is a subdomain (like apps.example.com), the name is *.apps instead.${X}"
  line "    ${DIM}On Cloudflare, set it to \"DNS only\" (grey cloud). Remove any AAAA (IPv6) record for it.${X}"
  line "    ${DIM}Installing anyway. Until DNS is right, use the free address below.${X}"
}

# --- before we start -----------------------------------------------------------------

line ""
line "  ${B}⛵ Deploy Boat${X}"
line "  ${DIM}Self-hosted app hosting. It just works.${X}"
line ""

[ "$(id -u)" = 0 ] || fail "Please run as root: add sudo before bash."
[ -f /etc/os-release ] || fail "Can't tell which Linux this is. Deploy Boat needs Ubuntu or Debian."
. /etc/os-release
case "$ID" in
  ubuntu|debian) ;;
  *) fail "This is ${PRETTY_NAME:-$ID}. Deploy Boat needs Ubuntu 22.04 / 24.04 or Debian 12." ;;
esac
case "$(uname -m)" in
  x86_64|aarch64) ;;
  *) fail "This processor ($(uname -m)) isn't supported. Deploy Boat needs x86_64 or ARM64." ;;
esac

: >"$LOG"; chmod 600 "$LOG"
UPDATING=false; [ -d "$DIR/.git" ] && UPDATING=true

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[ "$DISK_GB" -ge 5 ] || fail "Only ${DISK_GB} GB of free disk space. Deploy Boat needs at least 5 GB."

curl -fsS -o /dev/null --max-time 10 https://github.com || fail "This server can't reach the internet (github.com). Check its network and try again."

# Ports 80 and 443 must be free for Caddy (unless it's ours, from an earlier install).
if ! $UPDATING && command -v ss >/dev/null; then
  BUSY=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
  [ -z "$BUSY" ] || fail "Ports 80/443 are already used by another program (maybe nginx or Apache). Stop it first, then run this again."
fi

# A wrong --version: say so now, not after installing everything. (Needs git; on a brand-new
# server git comes later, and the "Downloading Deploy Boat" step checks it instead.)
if [ -n "$WANT" ] && [ "$WANT" != edge ] && command -v git >/dev/null; then
  [ -n "$(git ls-remote --tags "$REPO" "refs/tags/v${WANT#v}")" ] \
    || fail "There's no version v${WANT#v}. See the releases: https://github.com/deployboat/deployboat/releases"
fi

IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
[ -n "$IP" ] || fail "Couldn't find this server's public IP address."

if [ -n "$DOMAIN" ]; then
  echo "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$' \
    || fail "\"$DOMAIN\" doesn't look like a domain. Example: --domain example.com"
  case "$DOMAIN" in *.nip.io) fail "Use a domain you own. Without --domain you get free nip.io addresses anyway." ;; esac
fi

line "  ${PRETTY_NAME} · $(uname -m) · ${MEM_MB} MB memory · ${DISK_GB} GB free · ${IP}"
if $UPDATING; then line "  ${BL}Updating your existing install.${X} Apps and data are not touched."; fi
[ -z "$DOMAIN" ] || check_domain
[ "$MEM_MB" -ge 900 ] || warn "Less than 1 GB of memory. It works, but builds can be slow."
line ""

# --- go --------------------------------------------------------------------------------

step "Installing basic tools"                        install_basics
step "Securing the server (firewall, fail2ban, updates)" secure_server
step "Installing Docker"                             install_docker
step "Installing Node.js 24"                         install_node
step "Installing Railpack (detects how to build apps)" install_railpack
step "Starting the web server and builder"          start_services
step "Downloading Deploy Boat"                       get_code
step "Starting Deploy Boat"                          start_deployboat
STEP=$((STEP + 1)); printf '  %s✓%s %s[%d/%d]%s Done\n' "$G" "$X" "$DIM" "$STEP" "$TOTAL" "$X"

# --- what now ------------------------------------------------------------------------

NIP_URL="https://deployboat.$IP.nip.io"
URL="$NIP_URL"
if [ -n "$DOMAIN" ] && $DOMAIN_OK; then URL="https://deployboat.$DOMAIN"; fi
TOKEN="$(cat "$DATA/token")"
VERSION="$(current_version)"

line ""
if $UPDATING; then
  line "  ${G}${B}✓ Deploy Boat is updated${X} ${DIM}(version ${VERSION})${X}"
  line ""
  line "  Dashboard   ${B}${URL}${X}"
  [ "$URL" = "$NIP_URL" ] || line "  ${DIM}Backup      ${NIP_URL}${X}"
  line ""
  exit 0
fi

line "  ${G}${B}✓ Deploy Boat is ready${X}"
line ""
line "  ${B}1. Open your dashboard${X}"
line "     ${URL}"
line "     ${DIM}The first visit can take a few seconds while HTTPS is set up.${X}"
if [ "$URL" != "$NIP_URL" ]; then line "     ${DIM}Backup address, always works: ${NIP_URL}${X}"
elif [ -n "$DOMAIN" ]; then line "     ${DIM}Once DNS is right: https://deployboat.${DOMAIN} (Server Doctor tells you).${X}"
fi
line ""
line "  ${B}2. Log in with this token${X}"
line "     ${TOKEN}"
line "     ${DIM}Keep it secret. You can see it again with: sudo cat ${DATA}/token${X}"
line ""
line "  ${B}3. Publish your first app${X}"
line "     In the dashboard, click ${B}New app${X}: from your computer, your AI agent, or Git."
line ""
line "  ${DIM}Already done for you: firewall (only 22, 80, 443 open), brute-force protection,${X}"
line "  ${DIM}automatic security updates, swap, HTTPS. Server Doctor keeps an eye on the rest.${X}"
line "  ${DIM}Install log: ${LOG}${X}"
line ""
