# Admin API - Students

## Endpoints

### GET /admin/students
List all students with active-session flag.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
[
  {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "role": "student | teacher | admin",
    "cohort_id": "string",
    "last_seen": "timestamp | null",
    "has_active_session": true,
    "token_limit": "number | null",
    "token_balance": 1000,
    "token_blocked_at": "timestamp | null",
    "token_block_banner": "string | null"
  }
]
```

---

### POST /admin/students
Create a student account.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "username": "string",
  "password": "string",
  "display_name": "string",
  "role": "student | teacher | admin",
  "cohort_id": "string"
}
```

**Response (201):**
```json
{ "id": "uuid" }
```

---

### PUT /admin/students/:id
Update student details.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "display_name": "string",
  "cohort_id": "string",
  "new_password": "string"
}
```

**Response:** 204 No Content

---

### DELETE /admin/students/:id
Delete a student.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

### PUT /admin/students/:id/token-limit
Set token limit for a student.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{
  "limit": 10000,
  "banner": "Custom message"
}
```

**Response:** 204 No Content

---

### DELETE /admin/students/:id/token-limit
Clear token block (unblock student).

**Headers:** `Authorization: Bearer <token>` (admin only)

**Response:** 204 No Content

---

### GET /admin/students/:id/token-usage
Get student's total token usage and limit info.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
{
  "student_id": "uuid",
  "total_tokens_used": 5000,
  "token_limit": 10000,
  "token_blocked_at": "timestamp | null",
  "token_block_banner": "string | null"
}
```

---

### GET /admin/students/:id/token-balance
Get student's current token balance.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
{
  "student_id": "uuid",
  "token_balance": 5000,
  "token_limit": 10000
}
```

---

### POST /admin/students/:id/topup
Add tokens to student's balance.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{ "amount": 1000 }
```

**Response (200):**
```json
{
  "student_id": "uuid",
  "tokens_added": 1000,
  "new_balance": 6000
}
```

---

### POST /admin/students/:id/deduct
Remove tokens from student's balance.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{ "amount": 500 }
```

**Response (200):**
```json
{
  "student_id": "uuid",
  "tokens_deducted": 500,
  "new_balance": 4500
}
```

---

### GET /admin/students/:id/token-deductions
Get token deduction history.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
{
  "student_id": "uuid",
  "deductions": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "model_name": "string",
      "multiplier": 1.0,
      "tokens_used": 100,
      "tokens_deducted": 100,
      "balance_before": 1000,
      "balance_after": 900,
      "recorded_at": "timestamp"
    }
  ],
  "count": 1
}
```

---

### GET /admin/students/:id/models
Get models assigned to a student.

**Headers:** `Authorization: Bearer <token>` (teacher/admin only)

**Response (200):**
```json
{ "models": ["model1", "model2"] }
```

---

### PUT /admin/students/:id/models
Set models for a student.

**Headers:** `Authorization: Bearer <token>` (admin only)

**Request:**
```json
{ "models": ["model1", "model2"] }
```

**Response:** 204 No Content

---

## Frontend Usage

```typescript
// List students
const students = await api.adminListStudents(token);

// Create student
await api.adminCreateStudent(token, {
  username: "string",
  password: "string",
  display_name: "string",
  role: "student",
  cohort_id: "string"
});

// Update student
await api.adminUpdateStudent(token, studentId, {
  display_name: "string",
  cohort_id: "string",
  new_password: "string"
});

// Delete student
await api.adminDeleteStudent(token, studentId);

// Token limit
await api.adminSetTokenLimit(token, studentId, 10000, "Custom message");
await api.adminClearTokenBlock(token, studentId);

// Token usage
const usage = await api.adminGetStudentTokenUsage(token, studentId);

// Token balance
const balance = await api.adminGetTokenBalance(token, studentId);

// Topup/Deduct
await api.adminTopupTokens(token, studentId, 1000);
await api.adminDeductTokens(token, studentId, 500);

// Token deductions
const deductions = await api.adminGetTokenDeductions(token, studentId);

// Student models
const models = await api.adminGetStudentModels(token, studentId);
await api.adminSetStudentModels(token, studentId, ["model1", "model2"]);
```