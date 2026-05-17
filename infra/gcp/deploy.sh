#!/usr/bin/env bash
#
# deploy.sh — one-shot deploy of the JITSW API to Cloud Run.
#
# Prereqs:
#   - `gcloud` installed and authenticated (`gcloud auth login` once)
#   - $GCP_PROJECT set, or pass --project
#   - Cloud SQL Postgres instance + DATABASE_URL secret already exist
#     (run `bootstrap.sh` once, then this script for subsequent deploys).
#
# Usage:
#   GCP_PROJECT=my-proj infra/gcp/deploy.sh
#   infra/gcp/deploy.sh --project my-proj --region us-central1
#
# This script is opinionated for simplicity. For more control, run Cloud Build
# (cloudbuild.yaml) or write your own Terraform.

set -euo pipefail

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-jitsw-api}"
IMAGE_REPO="${IMAGE_REPO:-jitsw}"
CLOUDSQL_CONNECTION_NAME="${CLOUDSQL_CONNECTION_NAME:-}"
DB_SECRET_NAME="${DB_SECRET_NAME:-jitsw-database-url}"
PROJECT="${GCP_PROJECT:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --cloudsql) CLOUDSQL_CONNECTION_NAME="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "GCP_PROJECT not set (or pass --project)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${IMAGE_REPO}/api:$(git rev-parse --short HEAD)"

echo "[deploy] building $IMAGE"
gcloud builds submit \
  --project "$PROJECT" \
  --tag "$IMAGE" \
  --file infra/gcp/Dockerfile.api \
  .

EXTRA=()
if [[ -n "$CLOUDSQL_CONNECTION_NAME" ]]; then
  EXTRA+=( "--add-cloudsql-instances=$CLOUDSQL_CONNECTION_NAME" )
  EXTRA+=( "--set-secrets=DATABASE_URL=${DB_SECRET_NAME}:latest" )
fi

echo "[deploy] deploying $SERVICE to $REGION"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --allow-unauthenticated \
  --port 8787 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 80 \
  --timeout 3600 \
  --set-env-vars=AUTH_MODE=firebase \
  "${EXTRA[@]}"

echo "[deploy] done"
gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format="value(status.url)"
