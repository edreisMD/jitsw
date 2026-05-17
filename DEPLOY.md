# Deploying JITSW

JITSW is designed to be deployable by anyone. This guide covers the production-shaped path on Google Cloud, plus options for self-hosting Matrix.

```
                                  ┌────────────────────────────┐
              Firebase Hosting    │  Cloud Run                 │
phone/web ──> jitsw-app PWA  ────▶│  jitsw-api                 │
                                  │  (auth, packets, SSE, MCP) │
                                  └──┬───────────────┬─────────┘
                                     │               │
                            Cloud SQL│               │
                           Postgres ◀┘               └▶ Matrix homeserver
                                                        (self-hosted: GKE / VM,
                                                         or external)
                                                                │
                                                                ▼
                                                          OpenClaw + GBrain
```

Three deployment shapes:

| Shape | When | Time |
|---|---|---|
| **Local only** | dev | 2 min |
| **Cloud Run + Cloud SQL + Firebase Hosting** | small/medium prod | 30 min |
| **+ self-hosted Matrix homeserver** | full enterprise self-host | 1 hour |

---

## 0. Prerequisites

Install on your laptop:

```bash
# macOS
brew install --cask google-cloud-sdk
brew install firebase-cli
brew install terraform           # optional, for the Terraform path
```

```bash
# Linux
curl https://sdk.cloud.google.com | bash
curl -sL https://firebase.tools | bash
# terraform: see https://developer.hashicorp.com/terraform/install
```

Authenticate once:

```bash
gcloud auth login
gcloud auth application-default login
firebase login
```

Pick or create a GCP project. JITSW assumes one project for the API + database; Firebase Hosting can be the same project.

```bash
export GCP_PROJECT=my-jitsw-project
gcloud config set project $GCP_PROJECT
```

---

## 1. Local-only (zero cloud)

```bash
cd jitsw-app
npm install
docker compose up -d postgres
cp .env.example .env
npm run db:migrate --workspace apps/api
npm run dev
```

`http://localhost:5173` is the PWA, `http://localhost:8787` is the API. `AUTH_MODE=none` skips auth — fine for laptop dev, dangerous anywhere else.

---

## 2. Cloud Run + Cloud SQL + Firebase Hosting

This is the recommended hosted shape for an open-source service. It scales to thousands of users on free-tier-ish GCP pricing.

### 2a. Provision infra

Two options — pick one.

#### Option A: Terraform (recommended for production)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project, firebase_project_id

terraform init
terraform apply
```

When complete, Terraform prints:

```
service_url             = "https://jitsw-api-xxxxx-uc.a.run.app"
cloudsql_connection_name = "my-jitsw-project:us-central1:jitsw-pg"
image_repo_url           = "us-central1-docker.pkg.dev/my-jitsw-project/jitsw"
secret_database_url      = "jitsw-database-url"
```

#### Option B: Shell scripts

```bash
GCP_PROJECT=$GCP_PROJECT infra/gcp/bootstrap.sh
# Creates: APIs, Artifact Registry, Cloud SQL + db + user, Secret Manager
```

### 2b. First deploy

Build and ship the API image:

```bash
GCP_PROJECT=$GCP_PROJECT \
CLOUDSQL_CONNECTION_NAME=$(terraform -chdir=infra/terraform output -raw cloudsql_connection_name) \
infra/gcp/deploy.sh
```

This:
1. Builds the multi-stage `infra/gcp/Dockerfile.api` via Cloud Build.
2. Tags it `${region}-docker.pkg.dev/${project}/jitsw/api:<short-sha>`.
3. Deploys to Cloud Run with the right Cloud SQL connector + Secret Manager binding.

Run migrations against the new Cloud SQL instance (one-time):

```bash
gcloud run jobs deploy jitsw-migrate \
  --image=us-central1-docker.pkg.dev/$GCP_PROJECT/jitsw/api:latest \
  --region=us-central1 \
  --add-cloudsql-instances=$CLOUDSQL_CONNECTION_NAME \
  --set-secrets=DATABASE_URL=jitsw-database-url:latest \
  --command=node \
  --args=apps/api/dist/store/migrate.js

gcloud run jobs execute jitsw-migrate --region=us-central1 --wait
```

After this, `cloudbuild.yaml` runs migrations automatically on every subsequent deploy.

### 2c. Firebase Auth setup

1. Open https://console.firebase.google.com — link an existing GCP project, or create a new one and reuse `$GCP_PROJECT`.
2. Authentication → Sign-in method → enable **Google**. Set your support email.
3. (Optional) Restrict allowed email domains: set `AUTH_ALLOWED_DOMAINS` env var on the Cloud Run service.
4. Project settings → grab the web app config (`apiKey`, `authDomain`, etc.) for the PWA. Add to `apps/web/.env` as `VITE_FIREBASE_*` (PWA-side Firebase init — not yet implemented; see roadmap in README).

### 2d. Deploy the PWA to Firebase Hosting

```bash
cd apps/web
cp .firebaserc.example .firebaserc
# edit .firebaserc: replace "your-firebase-project-id"

npm run build
firebase deploy --only hosting
```

Firebase Hosting prints the URL (e.g. `https://my-project.web.app`). The `firebase.json` rewrites `/api/**` to the Cloud Run API, so the PWA can call `/api/packets` and Firebase routes it. Single-origin, no CORS.

### 2e. Wire CI/CD

The repo ships a `cloudbuild.yaml`. Connect it to your GitHub repo:

```bash
gcloud builds triggers create github \
  --name=jitsw-api \
  --repo-name=jitsw \
  --repo-owner=<your-github-user> \
  --branch-pattern=^main$ \
  --build-config=infra/gcp/cloudbuild.yaml \
  --substitutions=_CLOUDSQL=$CLOUDSQL_CONNECTION_NAME
```

Every push to `main` now builds + migrates + deploys.

PWA deploys via the GitHub Action in `.github/workflows/ci.yml` once you add the `FIREBASE_SERVICE_ACCOUNT` secret. (PR welcome.)

---

## 3. Matrix homeserver

JITSW works without Matrix — the HTTP `/packets` path is sufficient for any agent that uses `@jitsw/sdk` or the MCP server. Matrix is for when you want:

- A self-hosted communication substrate companies can own.
- Federation between organizations.
- OpenClaw's native Matrix channel as the inbound path.

### Option 1: External hosted Matrix

Set `MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`, `MATRIX_USER_ID` on the Cloud Run service. Done. Works with any homeserver — matrix.org, Element Matrix Services, etc.

### Option 2: Run Synapse on a Compute Engine VM

Cheapest self-host. Single VM with persistent disk, Synapse + Postgres in docker-compose.

```bash
gcloud compute instances create jitsw-matrix \
  --machine-type=e2-medium \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=50GB \
  --tags=http-server,https-server

# SSH in
gcloud compute ssh jitsw-matrix
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
# Clone the JITSW repo on the VM, then:
cd jitsw-app/matrix-local
./scripts/bootstrap.sh
```

Put Caddy or Cloud Load Balancer in front to terminate TLS.

### Option 3: Run on GKE Autopilot with Cloud SQL backend

For multi-tenant scale. Synapse supports Postgres as its main store — point it at the same Cloud SQL instance (different database) or a separate instance. The Synapse Helm chart is the easiest path. Out of scope for this doc; see https://github.com/element-hq/synapse-helm.

### Option 4: Use Tuwunel (Apache-2.0 alternative)

Synapse is AGPL-3.0 since 1.99. If you want an Apache-2.0-clean stack end to end, run [Tuwunel](https://github.com/matrix-construct/tuwunel) instead — a Rust homeserver listed in Matrix's official directory of stable servers. Same deployment shape as Synapse but Apache-2.0.

---

## 4. Hooking up OpenClaw + GBrain

Once JITSW is live, point an OpenClaw instance at it:

1. On the OpenClaw machine, install GBrain as a bundle plugin and JITSW as a skill:

   ```bash
   openclaw plugins install <path-to-gbrain-repo>
   ln -s <jitsw-repo>/infra/openclaw/jitsw-ui ~/.openclaw/skills/jitsw-ui
   ```

2. Configure OpenClaw's matrix channel to point at your Matrix homeserver (see `infra/openclaw/matrix-channel.json5` for the shape).

3. Add a per-room `systemPrompt` + `skills: ["jitsw-ui"]` to the JITSW room so OpenClaw emits A2UI there.

4. Set `MATRIX_*` env vars on the Cloud Run service so the JITSW API bridges that room into packets.

5. Set `GBRAIN_HTTP_URL` + `GBRAIN_BEARER_TOKEN` so JITSW writes decisions back into GBrain.

The full hands-on script for a local rehearsal is `scripts/wire-openclaw.sh`. Production wiring follows the same shape with hosted endpoints.

---

## 5. Cost expectations

Rough monthly cost for a hobby deployment serving ~1000 events/day:

| Service | Tier | Cost |
|---|---|---|
| Cloud Run | always-free 2M req/mo + ~$0.05/M req over | ~$0 |
| Cloud SQL | db-g1-small | ~$25 |
| Cloud Build | first 120 build-min/day free | ~$0 |
| Secret Manager | 10K accesses free | ~$0 |
| Firebase Hosting | 10 GB transfer free | ~$0 |
| Artifact Registry | first 0.5 GB free | ~$0 |
| **Total** | | **~$25/mo** |

Production with HA: bump Cloud SQL to a regional `db-custom-2-4096` (~$200/mo). Matrix homeserver on GKE adds ~$70/mo for a 2-node Autopilot cluster.

---

## 6. What's still manual

These are tracked in the README roadmap:

- PWA-side Firebase Auth wiring (today the API enforces auth; the PWA's "Spin up a GBrain agent" button is still a placeholder).
- FCM web push (today SSE only).
- Matrix transport in the browser (today the PWA always goes through the API).
- Device pairing UX for multi-device.

Contributions welcome on any of these — see `CONTRIBUTING.md`.
