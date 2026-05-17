output "service_url" {
  description = "Public URL of the Cloud Run API."
  value       = google_cloud_run_v2_service.api.uri
}

output "cloudsql_connection_name" {
  description = "Cloud SQL connection name for use in --add-cloudsql-instances."
  value       = google_sql_database_instance.pg.connection_name
}

output "image_repo_url" {
  description = "Artifact Registry repo URL for pushing images."
  value       = "${var.region}-docker.pkg.dev/${var.project}/${var.image_repo}"
}

output "secret_database_url" {
  description = "Name of the Secret Manager secret holding DATABASE_URL."
  value       = google_secret_manager_secret.database_url.secret_id
}
