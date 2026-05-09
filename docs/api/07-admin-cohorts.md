# Admin API - Cohorts

## Endpoints

### GET /admin/cohorts
List all cohorts.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
[
  {
    "id": "primary-2b",
    "title": "Primary 2B",
    "created_at": "timestamp"
  }
]
```

---

### POST /admin/cohorts
Create a cohort.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "slug": "primary-2b",
  "title": "Primary 2B"
}
```

**Response (201):**
```json
{ "id": "primary-2b" }
```

---

### PUT /admin/cohorts/:id
Update cohort (slug and/or title).

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "new_slug": "year-5a",
  "title": "Year 5A"
}
```

**Response (200):**
```json
{ "id": "year-5a" }
```

---

### DELETE /admin/cohorts/:id
Delete a cohort.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

## Frontend Usage

```typescript
// List cohorts
const cohorts = await api.adminListCohorts(token);

// Create cohort
await api.adminCreateCohort(token, "primary-2b", "Primary 2B");

// Update cohort
await api.adminUpdateCohort(token, cohortId, "new-slug", "New Title");

// Delete cohort
await api.adminDeleteCohort(token, cohortId);
```