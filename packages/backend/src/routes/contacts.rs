use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/contacts",     get(list).post(create))
        .route("/contacts/:id", put(update).delete(remove))
}

// ── Shared response shape ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ContactRow {
    pub id:            Uuid,
    pub wallet_pubkey: String,
    pub name:          String,
    pub email:         Option<String>,
    pub description:   Option<String>,
    pub notes:         Option<String>,
}

// ── GET /contacts ─────────────────────────────────────────────────────────────

pub async fn list(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
) -> Result<Json<Vec<ContactRow>>, (StatusCode, String)> {
    let rows = sqlx::query_as!(
        ContactRow,
        "SELECT id, wallet_pubkey, name, email, description, notes
         FROM contacts
         WHERE owner_pubkey = $1
         ORDER BY name ASC",
        wallet,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(rows))
}

// ── POST /contacts ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateContact {
    pub wallet_pubkey: String,
    pub name:          String,
    pub email:         Option<String>,
    pub description:   Option<String>,
    pub notes:         Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Json(body): Json<CreateContact>,
) -> Result<Json<ContactRow>, (StatusCode, String)> {
    let row = sqlx::query_as!(
        ContactRow,
        "INSERT INTO contacts (owner_pubkey, wallet_pubkey, name, email, description, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (owner_pubkey, wallet_pubkey)
         DO UPDATE SET
             name        = EXCLUDED.name,
             email       = EXCLUDED.email,
             description = EXCLUDED.description,
             notes       = EXCLUDED.notes,
             updated_at  = now()
         RETURNING id, wallet_pubkey, name, email, description, notes",
        wallet,
        body.wallet_pubkey,
        body.name,
        body.email,
        body.description,
        body.notes,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(row))
}

// ── PUT /contacts/:id ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct UpdateContact {
    pub name:        Option<String>,
    pub email:       Option<String>,
    pub description: Option<String>,
    pub notes:       Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateContact>,
) -> Result<Json<ContactRow>, (StatusCode, String)> {
    let row = sqlx::query_as!(
        ContactRow,
        "UPDATE contacts
         SET name        = COALESCE($1, name),
             email       = COALESCE($2, email),
             description = COALESCE($3, description),
             notes       = COALESCE($4, notes),
             updated_at  = now()
         WHERE id = $5
           AND owner_pubkey = $6
         RETURNING id, wallet_pubkey, name, email, description, notes",
        body.name,
        body.email,
        body.description,
        body.notes,
        id,
        wallet,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Contact not found".to_string()))?;

    Ok(Json(row))
}

// ── DELETE /contacts/:id ──────────────────────────────────────────────────────

pub async fn remove(
    State(state): State<AppState>,
    AuthUser(wallet): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let result = sqlx::query!(
        "DELETE FROM contacts WHERE id = $1 AND owner_pubkey = $2",
        id,
        wallet,
    )
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Contact not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}
