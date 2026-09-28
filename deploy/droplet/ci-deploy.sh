#!/usr/bin/env bash
# Deploy entry point for GitHub Actions.
#
# Installed on the droplet as /usr/local/bin/mlops-ci-deploy and bound to the CI's SSH key
# as a *forced command* in /root/.ssh/authorized_keys:
#
#   restrict,command="/usr/local/bin/mlops-ci-deploy" ssh-ed25519 AAAA... github-actions-deploy
#
# Whatever the client asks to run arrives here as $SSH_ORIGINAL_COMMAND. The only accepted
# input is a full commit SHA that is already on origin/main. The key therefore cannot open
# a shell, forward ports, or deploy anything that has not been merged to main.
#
# It lives outside the repo so a `git pull` can never change the script that is running it.
# After editing this file, reinstall it (see docs/deployment.md, "Automatic deploys").
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mlops-demo}"
sha="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "mlops-ci-deploy: expected a 40-character commit SHA, got '${sha:0:60}'" >&2
    exit 2
fi

# One deploy at a time (CI runs are also serialised, but manual deploys share this lock).
exec 9>/var/lock/mlops-deploy.lock
if ! flock -w 900 9; then
    echo "mlops-ci-deploy: another deploy is still running after 15 minutes" >&2
    exit 1
fi

cd "$APP_DIR"
git fetch --quiet origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "mlops-ci-deploy: $sha is not on origin/main; refusing to deploy" >&2
    exit 2
fi

# Fast-forward to the tested commit. If a newer commit is already checked out (a later run
# got here first), this is a no-op: deploys never move backwards.
git checkout --quiet main
git merge --quiet --ff-only "$sha"
echo "mlops-ci-deploy: deploying $(git log --oneline -1)"

SKIP_PULL=1 exec bash deploy/droplet/deploy.sh
