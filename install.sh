#!/usr/bin/env bash
# Deploy Boat installer. Ubuntu 22.04/24.04 or Debian 12. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/osbulbul/deploy-boat/main/install.sh | sudo bash
set -euo pipefail

REPO="${DEPLOYBOAT_REPO:-https://github.com/osbulbul/deploy-boat.git}"
DIR=/opt/deployboat
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
say() { printf '\n\033[1;34m→ %s\033[0m\n' "$1"; }

[ "$(id -u)" = 0 ] || { echo "Please run as root (sudo)."; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "Only Ubuntu and Debian are supported."; exit 1;; esac

say "Installing basics"
apt-get update -qq >/dev/null
apt-get install -y -qq curl git openssh-client ca-certificates ufw fail2ban unattended-upgrades >/dev/null 2>&1

say "Securing the server"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null 2>&1
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1

if ! swapon --show | grep -q .; then
  say "Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Installing Docker"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
mkdir -p /etc/docker
[ -f /etc/docker/daemon.json ] || echo '{"log-driver":"local","log-opts":{"max-size":"10m"}}' > /etc/docker/daemon.json
systemctl restart docker

say "Installing Node.js 24"
if ! node -v 2>/dev/null | grep -q '^v2[4-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
fi

say "Installing Railpack (auto-detects how to build apps)"
command -v railpack >/dev/null || curl -fsSL https://railpack.com/install.sh | bash >/dev/null 2>&1

say "Starting BuildKit and Caddy"
docker network inspect deployboat >/dev/null 2>&1 || docker network create deployboat >/dev/null
# Let Caddy (inside Docker) reach Deploy Boat on the host. Not open to the internet.
ufw allow from 172.16.0.0/12 to any port 3000 proto tcp >/dev/null
docker inspect buildkit >/dev/null 2>&1 || docker run -d --name buildkit --privileged --restart unless-stopped moby/buildkit >/dev/null 2>&1
mkdir -p /var/lib/deployboat/caddy
[ -f /var/lib/deployboat/caddy/config.json ] || echo '{}' > /var/lib/deployboat/caddy/config.json
# Always (re)create Caddy so it has the latest settings. Routes live in config.json.
docker rm -f caddy >/dev/null 2>&1 || true
docker run -d --name caddy --restart unless-stopped \
  --network deployboat --add-host host.docker.internal:host-gateway \
  -p 80:80 -p 443:443 -p 443:443/udp \
  -v /var/lib/deployboat/caddy:/data \
  caddy:2 caddy run --config /data/config.json >/dev/null 2>&1

say "Installing Deploy Boat"
[ -d "$DIR" ] && git -C "$DIR" pull -q || git clone -q "$REPO" "$DIR"
(cd "$DIR/server" && npm install --omit=dev --silent)

IP="$(curl -fsSL https://api.ipify.org)"
cat > /etc/systemd/system/deployboat.service <<UNIT
[Unit]
Description=Deploy Boat
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=$DIR/server
ExecStart=$(command -v node) index.ts
Environment=PUBLIC_IP=$IP
Environment=BUILDKIT_HOST=docker-container://buildkit
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable deployboat >/dev/null 2>&1
systemctl restart deployboat
sleep 2

TOKEN="$(cat /var/lib/deployboat/token)"
printf '\n\033[1;32m✓ Deploy Boat is ready!\033[0m\n\n'
echo "  Dashboard: https://deployboat.$IP.nip.io"
echo ""
echo "  On your computer, run:"
echo "    npx deployboat login https://deployboat.$IP.nip.io $TOKEN"
echo "    npx deployboat deploy"
echo ""
