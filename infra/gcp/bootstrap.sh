#!/usr/bin/env bash
#
# bootstrap.sh — one-time GCP project setup for JITSW.
#
# Provisions:
#   - Enables required APIs
#   - Artifact Registry repo for container images
#   - Cloud SQL Postgres instance (db-g1-small for dev; resize later)
#   - jitsw user + database in Cloud SQL
#   - DATABASE_URL stored in Secret Manager
#
# Idempotent: re-running is safe.
#
# Usage:
#   GCP_PROJECT=my-proj infra/gcp/bootstrap.sh
#   # then run infra/gcp/deploy.sh to ship the API

set -euo pipefail

PROJECT="${GCP_PROJECT:?GCP_PROJECT not set}"
REGION="${REGION:-us-central1}"
SQL_INSTANCE="${SQL_INSTANCE:-jitsw-pg}"
SQL_TIER="${SQL_TIER:-db-g1-small}"
SQL_VERSION="${SQL_VERSION:-POSTGRES_16}"
SQL_USER="${SQL_USER:-jitsw}"
SQL_DB="${SQL_DB:-jitsw}"
IMAGE_REPO="${IMAGE_REPO:-jitsw}"
DB_SECRET_NAME="${DB_SECRET_NAME:-jitsw-database-url}"

gcloud config set project "$PROJECT" >/dev/null

echo "[bootstrap] enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  identitytoolkit.googleapis.com

echo "[bootstrap] ensuring Artifact Registry repo '$IMAGE_REPO'"
if ! gcloud artifacts repositories describe "$IMAGE_REPO" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$IMAGE_REPO" \
    --repository-format=docker \
    --location="$REGION"
fi

echo "[bootstrap] ensuring Cloud SQL instance '$SQL_INSTANCE'"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version="$SQL_VERSION" \
    --tier="$SQL_TIER" \
    --region="$REGION" \
    --root-password="$(openssl rand -base64 32)"
fi

CONN_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
echo "[bootstrap] Cloud SQL connection name: $CONN_NAME"

DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=')"

if ! gcloud sql users describe "$SQL_USER" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
  echo "[bootstrap] creating SQL user '$SQL_USER'"
  gcloud sql users create "$SQL_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
else
  echo "[bootstrap] rotating SQL user '$SQL_USER' password"
  gcloud sql users set-password "$SQL_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
fi

if ! gcloud sql databases describe "$SQL_DB" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql databases create "$SQL_DB" --instance="$SQL_INSTANCE"
fi

# DATABASE_URL via Cloud SQL Auth Proxy socket (the format Cloud Run expects).
DATABASE_URL="postgres://${SQL_USER}:${DB_PASSWORD}@/${SQL_DB}?host=/cloudsql/${CONN_NAME}"

echo "[bootstrap] writing DATABASE_URL to Secret Manager ($DB_SECRET_NAME)"
if ! gcloud secrets describe "$DB_SECRET_NAME" >/dev/null 2>&1; then
  gcloud secrets create "$DB_SECRET_NAME" --replication-policy=automatic
fi
printf '%s' "$DATABASE_URL" | gcloud secrets versions add "$DB_SECRET_NAME" --data-file=-

# Cloud Run runtime service account needs accessor on the secret.
SA="$(gcloud iam service-accounts list --filter='email:*-compute@developer.gserviceaccount.com' --format='value(email)' | head -1)"
if [[ -n "$SA" ]]; then
  gcloud secrets add-iam-policy-binding "$DB_SECRET_NAME" \
    --member="serviceAccount:${SA}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
fi

cat <<EOF

[bootstrap] done.

Next:
  CLOUDSQL_CONNECTION_NAME=$CONN_NAME \\
  GCP_PROJECT=$PROJECT \\
  infra/gcp/deploy.sh

Service will read DATABASE_URL from Secret Manager (\"$DB_SECRET_NAME\").

EOF
