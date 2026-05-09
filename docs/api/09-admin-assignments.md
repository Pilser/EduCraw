# Admin API - Assignments

## Endpoints

### GET /admin/assignments
List assignments (optionally filter by subject).

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Query Parameters:**
- `subject_id`: Filter by subject (optional)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "subject_id": "uuid",
    "title": "Assignment 1",
    "description": "Complete the worksheet",
    "due_date": "2024-12-31",
    "created_by": "uuid",
    "created_at": "timestamp"
  }
]
```

---

### POST /admin/assignments
Create an assignment.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Request:**
```json
{
  "subject_id": "uuid",
  "title": "Assignment 1",
  "description": "Complete the worksheet",
  "due_date": "2024-12-31"
}
```

**Response (201):**
```json
{ "id": "uuid" }
```

---

## Frontend Usage

```typescript
// List assignments (all)
const assignments = await api.adminListAssignments(token);

// List assignments (filtered by subject)
const assignments = await api.adminListAssignments(token, subjectId);

// Create assignment
await api.adminCreateAssignment(token, {
  subject_id: subjectId,
  title: "Assignment 1",
  description: "Complete the worksheet",
  due_date: "2024-12-31"
});
```