# Authentication API

## Endpoints

### POST /auth/login
Student login with username and password.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response (200):**
```json
{
  "token": "jwt_token",
  "student_id": "uuid",
  "display_name": "string",
  "role": "student | teacher | admin",
  "cohort_id": "string",
  "subject_ids": ["string"]
}
```

**Errors:**
- 401: Invalid credentials

---

### POST /auth/token
Dev/admin bootstrap token (guarded by ADMIN_SECRET env var).

**Request:**
```json
{
  "secret": "string"
}
```

**Response (200):**
```json
{
  "token": "jwt_token"
}
```

**Errors:**
- 401: Invalid secret

---

## Frontend Usage

```typescript
// Login
const response = await api.login(username, password);
// response: { token, student_id, display_name, role, cohort_id, subject_ids }

// Bootstrap token
const response = await api.bootstrapToken(secret);
// response: { token }
```