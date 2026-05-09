# Files API

## Endpoints

### GET /files/subject/:subject_id/tree
List subject materials tree (read-only course materials).

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
[
  {
    "name": "string",
    "path": "string",
    "kind": "file" | "dir",
    "size": "number (files only)",
    "children": ["array of FileNode"]
  }
]
```

---

### GET /files/subject/:subject_id/read?path=...
Read a subject file.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `path`: Relative path to file

**Response:** Binary file content

**Content-Type:** Based on file extension (text/*, application/json, image/*, etc.)

---

### GET /files/student/:session_id/tree
List student workspace tree (their persistent files).

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
[
  {
    "name": "string",
    "path": "string",
    "kind": "file" | "dir",
    "size": "number (files only)",
    "children": ["array of FileNode"]
  }
]
```

---

### GET /files/student/:session_id/read?path=...
Read a student file.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `path`: Relative path to file

**Response:** Binary file content

---

### PUT /files/student/:session_id/write?path=...
Write/create a student file.

**Headers:** 
- `Authorization: Bearer <token>`
- `Content-Type: text/plain | application/octet-stream`

**Query Parameters:**
- `path`: Relative path to file

**Body:** File content (string or binary)

**Response:** 204 No Content

---

### DELETE /files/student/:session_id/delete?path=...
Delete a student file or directory.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `path`: Relative path to file/directory

**Response:** 204 No Content

---

## Access Control

- **Subject routes:** Student's cohort must include the subject_id (from JWT subject_ids) OR caller is a teacher/admin
- **Student routes:** session_id in path must match JWT's session_id claim OR caller is a teacher/admin

---

## Frontend Usage

```typescript
// List subject files
const files = await api.listSubjectFiles(subjectId, token);
// files: FileNode[]

// Read subject file (returns Blob)
const blob = await api.readSubjectFile(subjectId, filePath, token);

// List student files
const files = await api.listStudentFiles(sessionId, token);
// files: FileNode[]

// Read student file (returns Blob)
const blob = await api.readStudentFile(sessionId, filePath, token);

// Upload student file
await api.uploadStudentFile(sessionId, filePath, content, token);
```

## FileNode Type

```typescript
interface FileNode {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
  children?: FileNode[];
}
```