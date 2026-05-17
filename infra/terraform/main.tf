# JITSW GCP infrastructure.
#
# Provisions:
#   - Artifact Registry repo
#   - Cloud SQL Postgres + db + user
#   - Secret Manager secret holding DATABASE_URL
#   - Cloud Run service for the API
#   - IAM bindings so Cloud Run can read the secret and connect Cloud SQL
#
# This module deliberately does NOT manage:
#   - Firebase project (use the Firebase console once; it's a manual step)
#   - DNS / custom domains (operator-specific)
#   - Matrix homeserver (separate module, see infra/terraform/matrix/)
#
# Usage:
#   cd infra/terraform
#   cp terraform.tfvars.example terraform.tfvars
#   terraform init
#   terraform apply

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

# ---- APIs ------------------------------------------------------------------

locals {
  services = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ])
}

resource "google_project_service" "this" {
  for_each = local.services
  service  = each.key

  disable_on_destroy = false
}

# ---- Artifact Registry -----------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.image_repo
  format        = "DOCKER"
  description   = "JITSW container images"
  depends_on    = [google_project_service.this]
}

# ---- Cloud SQL -------------------------------------------------------------

resource "google_sql_database_instance" "pg" {
  name                = var.sql_instance
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.sql_tier
    availability_type = "ZONAL"

    backup_configuration {
      enabled    = true
      start_time = "03:00"
    }

    ip_configuration {
      ipv4_enabled = true
      # For tighter security in production, set to false and use private IP
      # through a Serverless VPC Access connector.
    }
  }

  depends_on = [google_project_service.this]
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "jitsw" {
  name     = "jitsw"
  instance = google_sql_database_instance.pg.name
  password = random_password.db.result
}

resource "google_sql_database" "jitsw" {
  name     = "jitsw"
  instance = google_sql_database_instance.pg.name
}

# ---- Secret Manager --------------------------------------------------------

resource "google_secret_manager_secret" "database_url" {
  secret_id = "jitsw-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.this]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://${google_sql_user.jitsw.name}:${random_password.db.result}@/${google_sql_database.jitsw.name}?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"
}

# ---- Cloud Run -------------------------------------------------------------

data "google_project" "this" {}

locals {
  default_compute_sa = "${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}

resource "google_secret_manager_secret_iam_member" "run_can_read" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.default_compute_sa}"
}

resource "google_cloud_run_v2_service" "api" {
  name     = var.service_name
  location = var.region

  template {
    containers {
      image = var.image == "" ? "${var.region}-docker.pkg.dev/${var.project}/${var.image_repo}/api:latest" : var.image

      ports {
        container_port = 8787
      }

      resources {
        limits = {
          memory = "512Mi"
          cpu    = "1"
        }
      }

      env {
        name  = "AUTH_MODE"
        value = var.auth_mode
      }

      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.firebase_project_id
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.pg.connection_name]
      }
    }

    scaling {
      max_instance_count = var.max_instances
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_secret_manager_secret_iam_member.run_can_read,
    google_artifact_registry_repository.images,
  ]
}

# Allow public access (we rely on application-level auth).
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
