# Admin API - Models

## Endpoints

### GET /admin/models
List all models.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "name": "claude-sonnet-4-5-20250929",
    "display_name": "Claude Sonnet 4.5",
    "enabled": 1,
    "multiplier": 1.0,
    "provider": "anthropic",
    "think_mode": 1,
    "visual_support": 1,
    "created_at": "timestamp"
  }
]
```

---

### POST /admin/models
Create a model.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "name": "claude-opus-4-6",
  "display_name": "Claude Opus 4.6",
  "multiplier": 2.0
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "name": "claude-opus-4-6",
  "display_name": "Claude Opus 4.6",
  "multiplier": 2.0,
  "enabled": 1
}
```

---

### PUT /admin/models/:id
Enable/disable a model.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{ "enabled": true }
```

**Response:** 204 No Content

---

### PUT /admin/models/:id/specs
Update model specifications.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "provider": "anthropic",
  "think_mode": 1,
  "visual_support": 1
}
```

**Response:** 204 No Content

---

### DELETE /admin/models/:id
Delete a model.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

### PUT /admin/models/:name/multiplier
Set model's token deduction multiplier.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{ "multiplier": 1.5 }
```

**Response (200):**
```json
{ "name": "string", "multiplier": 1.5 }
```

---

### GET /models
List enabled models (public endpoint for frontend model picker).

**Response (200):**
```json
[
  {
    "id": "uuid",
    "name": "string",
    "display_name": "string",
    "multiplier": 1.0,
    "enabled": 1
  }
]
```

---

## Frontend Usage

```typescript
// List models
const models = await api.adminListModels(token);

// Create model
await api.adminCreateModel(token, "model-name", "Display Name", 1.0);

// Enable/disable model
await api.adminSetModelEnabled(token, modelId, true);

// Update model specs
await api.adminUpdateModelSpecs(token, modelId, "anthropic", 1, 1);

// Delete model
await api.adminDeleteModel(token, modelId);

// Set multiplier
await api.adminSetModelMultiplier(token, "model-name", 1.5);
```