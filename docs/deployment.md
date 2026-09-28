# Deploying to a DigitalOcean droplet

The whole system runs on one droplet with docker compose. Caddy obtains HTTPS certificates
automatically.

## 1. Create the droplet

| Setting | Recommendation |
|---|---|
| Image | Ubuntu 24.04 LTS x64 |
| Size | **Basic, 2 vCPU / 4 GB** (about $24/mo) recommended. 2 GB works for running the stack, but builds rely on the swap file that `provision.sh` adds |
| Auth | SSH key |
| Extras | Enable monitoring; optionally add a Cloud Firewall allowing 22, 80, 443 (TCP + UDP 443) |

## 2. Point a hostname at it

HTTPS needs a hostname:

- **Your own domain:** create an `A` record (for example `demo.example.com`) pointing at the
  droplet's IPv4 address.
- **No domain:** use `sslip.io`, which resolves `<ip-with-dashes>.sslip.io` to that IP. For
  example, `203-0-113-10.sslip.io` works with no DNS setup at all.

## 3. Provision

```bash
ssh root@<droplet-ip>
git clone <your-repo-url> /opt/mlops-demo
bash /opt/mlops-demo/deploy/droplet/provision.sh
```

`provision.sh` does the following:

- Installs Docker Engine and the compose plugin.
- Adds 4 GB of swap.
- Sets up the firewall to allow SSH, 80 and 443 only.
- Turns on unattended security upgrades.
- Creates `/opt/mlops-demo/.env` with generated passwords and secrets.

It's safe to re-run.

## 4. Configure

Edit `/opt/mlops-demo/.env`:

```bash
SITE_ADDRESS=demo.example.com          # no scheme -> automatic HTTPS
PUBLIC_HOST=demo.example.com
PUBLIC_ORIGIN=https://demo.example.com
COOKIE_SECURE=true
```

Your operator password is the generated `ADMIN_PASSWORD` in the same file.

## 5. Deploy

```bash
bash /opt/mlops-demo/deploy/droplet/deploy.sh
```

This pulls the latest code, builds the images, starts the stack and waits until the gateway
answers. The first build takes several minutes, mostly for PyTorch and the Next.js build.
Then:

- `https://demo.example.com/`: dashboard (public)
- `https://demo.example.com/login`: operator sign-in
- `https://demo.example.com/mlflow/`: MLflow UI (after sign-in)

## Operations

| Task | Command (from `/opt/mlops-demo`) |
|---|---|
| Update to latest `main` | `bash deploy/droplet/deploy.sh` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail=100 model` (or `gateway`, `mlflow`, …) |
| Restart one service | `docker compose restart model` |
| Back up databases + artifacts | `bash deploy/droplet/backup.sh /var/backups/mlops-demo` |
| Stop everything | `docker compose down` (volumes, and therefore data, are kept) |

To schedule nightly backups, add this line with `crontab -e`:

```
0 3 * * * bash /opt/mlops-demo/deploy/droplet/backup.sh /var/backups/mlops-demo >> /var/log/mlops-backup.log 2>&1
```

Then copy `/var/backups/mlops-demo` off the droplet, for example to DigitalOcean Spaces.

### Restore

```bash
docker compose exec -T postgres pg_restore -U mlops -d mlflow --clean < backups/mlflow-<stamp>.dump
docker compose run --rm --no-deps -T --entrypoint tar mlflow -C /mlartifacts -xzf - < backups/mlartifacts-<stamp>.tar.gz
docker compose restart mlflow
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Browser shows a certificate error | DNS must resolve to the droplet *before* the first start; `docker compose logs gateway` shows the ACME errors |
| Login succeeds, but controls still say "Sign in" | With HTTPS, `COOKIE_SECURE=true`. On plain HTTP it must be `false`, or the browser drops the cookie |
| MLflow shows `Invalid Host header` / blocked requests | `PUBLIC_HOST` / `PUBLIC_ORIGIN` must match the address in the browser |
| Build killed / exit 137 | Out of memory. Check `swapon --show`, or resize the droplet |
| Dashboard shows "Model service unreachable" | `docker compose logs model`; the model waits for postgres and mlflow to report healthy |

## Security notes

- Only the gateway publishes ports. Postgres, MLflow and the Python services sit on the
  internal compose network.
- Docker publishes ports by writing iptables rules that bypass `ufw`, so only publish ports
  on the gateway. A DigitalOcean Cloud Firewall sits in front of the droplet and isn't
  affected by this.
- Rotate `JWT_SECRET` to sign out every session. Rotate `ADMIN_PASSWORD` by editing `.env`
  and running `docker compose up -d auth`.
