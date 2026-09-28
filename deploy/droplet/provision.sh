#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 DigitalOcean droplet. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/droplet/provision.sh | bash -s -- <git-repo-url>
#   # or, after copying the repo over:  sudo bash deploy/droplet/provision.sh <git-repo-url>
#
# What it does (idempotent -- safe to re-run):
#   1. installs Docker Engine + the compose plugin from Docker's apt repository
#   2. adds a swap file (building PyTorch/Next.js images needs more than 2 GB RAM)
#   3. enables the firewall: SSH, HTTP, HTTPS (TCP + UDP for HTTP/3) only
#   4. turns on unattended security upgrades
#   5. clones the repository to /opt/mlops-demo and creates .env from the template
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="${APP_DIR:-/opt/mlops-demo}"
SWAP_SIZE="${SWAP_SIZE:-4G}"

if [[ $EUID -ne 0 ]]; then
    echo "Run as root (sudo)." >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Installing base packages"
apt-get update -q
apt-get install -yq ca-certificates curl git ufw unattended-upgrades openssl

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Configuring swap (${SWAP_SIZE})"
if ! swapon --show | grep -q /swapfile; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -w vm.swappiness=10
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "==> Configuring firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Enabling unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

if [[ -n "$REPO_URL" ]]; then
    echo "==> Fetching application into ${APP_DIR}"
    if [[ -d "$APP_DIR/.git" ]]; then
        git -C "$APP_DIR" pull --ff-only
    else
        git clone "$REPO_URL" "$APP_DIR"
    fi
fi

if [[ -d "$APP_DIR" && ! -f "$APP_DIR/.env" ]]; then
    echo "==> Creating ${APP_DIR}/.env with generated secrets"
    secret() { openssl rand -base64 36 | tr -d '/+=' | cut -c1-40; }
    sed -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(secret)|" \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=$(secret)|" \
        -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret)|" \
        "$APP_DIR/.env.example" > "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
fi

cat <<EOF

Provisioning complete.

Next steps:
  1. Edit ${APP_DIR}/.env -- set SITE_ADDRESS / PUBLIC_HOST / PUBLIC_ORIGIN to your
     domain and COOKIE_SECURE=true (see the comments in the file).
     The generated operator password is the ADMIN_PASSWORD line in that file.
  2. Deploy:  bash ${APP_DIR}/deploy/droplet/deploy.sh
EOF
