variable "project" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "GCP region (Cloud Run + Cloud SQL location)."
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
  default     = "jitsw-api"
}

variable "image" {
  description = "Container image. If empty, defaults to latest in Artifact Registry."
  type        = string
  default     = ""
}

variable "image_repo" {
  description = "Artifact Registry repo for the JITSW image."
  type        = string
  default     = "jitsw"
}

variable "sql_instance" {
  description = "Cloud SQL instance name."
  type        = string
  default     = "jitsw-pg"
}

variable "sql_tier" {
  description = "Cloud SQL machine tier. Bump for production."
  type        = string
  default     = "db-g1-small"
}

variable "deletion_protection" {
  description = "Protect Cloud SQL from accidental terraform destroy."
  type        = bool
  default     = true
}

variable "auth_mode" {
  description = "AUTH_MODE for the API (none, firebase, api-keys)."
  type        = string
  default     = "firebase"
}

variable "firebase_project_id" {
  description = "Firebase project id (only used when auth_mode = firebase)."
  type        = string
  default     = ""
}

variable "max_instances" {
  description = "Max Cloud Run instance count."
  type        = number
  default     = 10
}

variable "allow_unauthenticated" {
  description = "Allow public network access to the Cloud Run service (auth is enforced at the application level)."
  type        = bool
  default     = true
}
