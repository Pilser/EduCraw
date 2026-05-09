# Admin API - Subjects

## Endpoints

### GET /admin/subjects
List subjects (optionally filter by cohort).

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Query Parameters:**
- `cohort_id`: Filter by cohort (optional)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "cohort_id": "primary-2b",
    "slug": "math-101",
    "title": "Mathematics 101",
    "created_at": "timestamp"
  }
]
```

---

### POST /admin/subjects
Create a subject.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "cohort_id": "primary-2b",
  "slug": "math-101",
  "title": "Mathematics 101"
}
```

**Response (201):**
```json
{ "id": "uuid", "slug": "math-101" }
```

---

### PUT /admin/subjects/:id
Update a subject.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "new_slug": "math-102",
  "title": "Mathematics 102"
}
```

**Response (200):**
```json
{ "id": "uuid", "slug": "math-102" }
```

---

### DELETE /admin/subjects/:id
Delete a subject.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

## Frontend Usage

```typescript
// List subjects (all)
const subjects = await api.adminListSubjects(token);

// List subjects (filtered by cohort)
const subjects = await api.adminListSubjects(token, cohortId);

// Create subject
await api.adminCreateSubject(token, cohortId, "math-101", "Mathematics 101");

// Update subject
await api.adminUpdateSubject(token, subjectId, "math-102", "Mathematics 102");

// Delete subject
await api.adminDeleteSubject(token, subjectId);
```