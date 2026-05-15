# Admin Frontend Portal — Build Spec

> Target: Create a new admin frontend (`lit-admin/`) using the same Lit + Tailwind stack as `lit-ui/`, replacing the legacy React `educlaw-web/` admin panel.

---

## 1. Overview

The legacy admin lives inside `educlaw-web/src/pages/AdminPage.tsx` (2385 lines, React). It has 6 tabs: **Students**, **Cohorts**, **Subjects**, **Assignments**, **Live Sessions**, **AI Models**. The new admin should be a standalone Lit app in `lit-admin/` that copies the UI patterns from `lit-ui/`.

---

## 2. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Lit (Web Components) | Same as `lit-ui/` — shared patterns, no framework mixing |
| CSS | Tailwind v4 + `@mariozechner/mini-lit` | Same theme system as `lit-ui/` |
| Icons | `lucide` (same import pattern) | Already used in both projects |
| API Client | Copy pattern from `lit-ui/src/core/edu-api.ts` | `request<T>()`, `authHeader()`, `BASE = ""` |
| State | Lit `@state()` decorators | Simple, no React Query needed for admin CRUD |
| Build | Vite (copy `lit-ui/vite.config.ts`) | Proxy `/admin`, `/auth`, `/files`, `/cohorts`, `/me` to backend |
| Routing | No router — state-based like `App.tsx` in educlaw-web | Keep it simple |

---

## 3. Auth Flow

### Admin Login (same as lit-ui login page, but routes to admin)

1. **Staff login** — user enters username + password in `LoginPage` → calls `POST /auth/login`
2. If `auth.role === "admin"` or `"teacher"` → route to admin panel
3. **Bootstrap** — first-time setup using `POST /auth/token` with `{ secret: ADMIN_SECRET }`

### Token Storage

```
localStorage key: "educlaw_auth"
Stores: { token, student_id, display_name, role, cohort_id, subject_ids }
```

- Admin JWT sent as `Authorization: Bearer <token>` on all API calls
- On logout: clear localStorage, redirect to login

### Role Gating

Backend checks:
- `require_admin(claims)` — for create/update/delete operations
- `require_staff(claims)` — for read operations (admin OR teacher)

The JWT `claims.role` determines access level.

---

## 4. Vite Proxy Config

Copy `lit-ui/vite.config.ts` and ensure these paths are proxied to the backend:

```ts
proxy: {
  "/auth":     { target: backendTarget, changeOrigin: true },
  "/admin":    { target: backendTarget, changeOrigin: true },
  "/sessions": { target: backendTarget, changeOrigin: true, ws: true },
  "/files":    { target: backendTarget, changeOrigin: true },
  "/cohorts":  { target: backendTarget, changeOrigin: true },
  "/me":       { target: backendTarget, changeOrigin: true },
  "/health":   { target: backendTarget, changeOrigin: true },
  "/models":   { target: backendTarget, changeOrigin: true },
}
```

---

## 5. Complete API Reference

### 5.1 Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/auth/login` | `{ username, password }` | `LoginResponse` |
| POST | `/auth/token` | `{ secret }` | `{ token }` |

```ts
interface LoginResponse {
  token: string;
  student_id: string;
  display_name: string;
  role: string;
  cohort_id: string;
  subject_ids: string[];
}
```

### 5.2 Students

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/students` | — | `AdminStudent[]` |
| POST | `/admin/students` | `CreateStudentBody` | `{ id }` |
| PUT | `/admin/students/:id` | `UpdateStudentBody` | 204 |
| DELETE | `/admin/students/:id` | — | 204 |
| GET | `/admin/students/:id/token-balance` | — | `{ balance }` |
| POST | `/admin/students/:id/topup` | `{ amount }` | `{ new_balance }` |
| POST | `/admin/students/:id/deduct` | `{ amount }` | `{ new_balance }` |
| GET | `/admin/students/:id/token-deductions` | — | `TokenDeduction[]` |
| PUT | `/admin/students/:id/token-limit` | `{ token_limit, banner }` | 204 |
| DELETE | `/admin/students/:id/token-limit` | — | 204 |
| GET | `/admin/students/:id/models` | — | `{ models: string[] }` |
| PUT | `/admin/students/:id/models` | `{ models }` | 204 |
| GET | `/admin/students/:id/token-usage` | — | `StudentTokenUsage` |

```ts
interface AdminStudent {
  id: string;
  username: string;
  display_name: string;
  role: string;
  cohort_id: string;
  last_seen: string | null;
  has_active_session: boolean;
  token_limit: number | null;
  token_balance: number;
  token_blocked_at: string | null;
  token_block_banner: string | null;
}

interface CreateStudentBody {
  username: string;
  password: string;
  display_name: string;
  role?: string;        // default "student"
  cohort_id?: string;   // default ""
}

interface UpdateStudentBody {
  display_name?: string;
  cohort_id?: string;
  new_password?: string;
}
```

### 5.3 Cohorts

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/cohorts` | — | `Cohort[]` |
| POST | `/admin/cohorts` | `{ slug, title }` | `{ id }` |
| PUT | `/admin/cohorts/:id` | `{ new_slug, title }` | `{ id }` |
| DELETE | `/admin/cohorts/:id` | — | 204 |

```ts
interface Cohort {
  id: string;          // slug, e.g. "primary-2b"
  title: string;       // e.g. "Primary 2B"
  created_at: string;
}
```

### 5.4 Subjects

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/subjects?cohort_id=` | — | `Subject[]` |
| POST | `/admin/subjects` | `{ cohort_id, slug, title }` | `{ id, slug }` |
| PUT | `/admin/subjects/:id` | `{ new_slug, title }` | `{ id, slug }` |
| DELETE | `/admin/subjects/:id` | — | 204 |

```ts
interface Subject {
  id: string;           // UUID
  cohort_id: string;
  slug: string;
  title: string;
  created_at: string;
}
```

### 5.5 Assignments

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/assignments?subject_id=` | — | `Assignment[]` |
| POST | `/admin/assignments` | `CreateAssignmentBody` | `{ id }` |

```ts
interface Assignment {
  id: string;
  subject_id: string;
  title: string;
  description: string;
  due_date: string | null;
  created_by: string;
  created_at: string;
}

interface CreateAssignmentBody {
  subject_id: string;
  title: string;
  description?: string;
  due_date?: string;
}
```

### 5.6 Sessions

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/sessions` | — | `AdminSession[]` |
| DELETE | `/admin/sessions/:id` | — | 204 |

```ts
interface AdminSession {
  id: string;
  student_id: string;
  state: string;
  idle_secs: number | null;
  started_at: string;
}
```

### 5.7 AI Models

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/admin/models` | — | `Model[]` |
| POST | `/admin/models` | `{ name, display_name, multiplier }` | `Model` |
| PUT | `/admin/models/:id` | `{ enabled: 0\|1 }` | 204 |
| PUT | `/admin/models/:name/multiplier` | `{ multiplier }` | 204 |
| PUT | `/admin/models/:id/specs` | `{ provider, think_mode, visual_support }` | 204 |
| PUT | `/admin/models/:id/thinking` | `{ thinking_params }` | 204 |
| DELETE | `/admin/models/:id` | — | 204 |
| GET | `/admin/provider-schema/:provider` | — | `ProviderSchema` |

```ts
interface Model {
  id: string;
  name: string;
  display_name: string;
  enabled: number;            // 1 = enabled
  multiplier: number;
  provider?: string | null;
  think_mode?: number | null; // 1 = thinking, 0 = non-thinking, null = unknown
  visual_support: number;     // 1 = vision
  thinking_params?: Record<string, unknown> | null;
  created_at: string;
}

interface ProviderSchema {
  provider: string;
  params: ConfigParamDef[];
}

interface ConfigParamDef {
  key: string;
  type: "select" | "integer";
  values?: string[];
  default?: unknown;
  min?: number;
  max?: number;
  description?: string;
}
```

---

## 6. Component Tree / App Layout

```
lit-admin/src/
├── main.ts                     # Entry point, same pattern as lit-ui
├── app.ts                      # Top-level view router (login vs admin)
├── app.css                     # Same imports as lit-ui/app.css
│
├── core/
│   ├── admin-api.ts            # All admin API calls (copy edu-api.ts pattern)
│   ├── admin-types.ts          # All TypeScript interfaces
│   └── session-manager.ts      # Copy from lit-ui (localStorage auth)
│
├── pages/
│   ├── admin-login-page.ts     # Login for staff (can reuse lit-ui's login-page)
│   └── admin-dashboard.ts      # Main admin dashboard with 6 tabs
│
├── dialogs/                     # Shared dialog components
│   └── ConfirmDialog.ts        # Reusable confirm dialog for deletes
│
└── tabs/                        # One component per admin tab
    ├── StudentsTab.ts           # Student list, create, edit, delete, token mgmt, model access
    ├── CohortsTab.ts            # Cohort CRUD
    ├── SubjectsTab.ts           # Subject CRUD with cohort filter
    ├── AssignmentsTab.ts        # Assignment list + create
    ├── SessionsTab.ts           # Active session monitor + terminate
    └── ModelsTab.ts             # AI model CRUD, specs, thinking config
```

### App.ts View Router (pseudocode)

```ts
@customElement("admin-app")
export class AdminApp extends LitElement {
  @state() view: "login" | "dashboard" = "login";
  @state() token = "";
  @state() role = "";
  @state() displayName = "";

  // On mount: check localStorage for stored auth
  // If stored and role is staff → go to dashboard
  // Else → login

  render() {
    if (this.view === "login") {
      return html`<admin-login-page
        .onLogin=${(auth: LoginResponse) => this.handleLogin(auth)}
      ></admin-login-page>`;
    }
    return html`<admin-dashboard
      .token=${this.token}
      .role=${this.role}
      .displayName=${this.displayName}
      .onLogout=${() => this.handleLogout()}
    ></admin-dashboard>`;
  }
}
```

---

## 7. Dashboard Layout (admin-dashboard.ts)

```
┌─────────────────────────────────────────────┐
│  EduCraw Admin          {role} | Sign Out   │
├─────────────────────────────────────────────┤
│  [Students] [Cohorts] [Subjects] [Assign]   │
│  [Live Sessions] [AI Models]                │
├─────────────────────────────────────────────┤
│                                             │
│         Active Tab Content                  │
│                                             │
└─────────────────────────────────────────────┘
```

Use a simple tab bar (buttons with active state) + conditional rendering. Same pattern as `lit-ui/src/dialogs/MenuDialog.ts` sidebar.

---

## 8. Each Tab — Feature Checklist

### 8.1 StudentsTab

- [ ] Table: Username, Display Name, Role, Cohort, Token Budget, Status, Actions
- [ ] Create student form (role dropdown: student/teacher/admin, cohort dropdown)
- [ ] Edit student (inline or expandable: display_name, cohort, new_password)
- [ ] Delete student (confirm dialog)
- [ ] Expand student row → token management panel:
  - [ ] Current balance display
  - [ ] Top-up form (amount input + submit)
  - [ ] Deduct form (amount input + submit)
  - [ ] Token deductions history table
- [ ] Expand student row → model access panel:
  - [ ] Checkbox list of all enabled models
  - [ ] Save restrictions button
- [ ] Token limit: set limit + banner text, clear block
- [ ] Status indicator: active session dot (green/gray)
- [ ] Role badges (admin=red, teacher=purple, student=amber)

### 8.2 CohortsTab

- [ ] Table: Slug, Title, Created, Actions
- [ ] Create form: slug input, title input
- [ ] Edit inline: slug, title
- [ ] Delete with confirmation

### 8.3 SubjectsTab

- [ ] Filter by cohort dropdown (fetches from `/admin/cohorts`)
- [ ] Table: Cohort, Slug, Title, Created, Actions
- [ ] Create form: cohort selector, slug input, title input
- [ ] Edit inline: slug, title
- [ ] Delete with confirmation
- [ ] Help text: "Place course materials in: /srv/educlaw/data/subjects/{cohort_id}/{slug}/"

### 8.4 AssignmentsTab

- [ ] Filter by subject dropdown (fetches subjects)
- [ ] Table: Title, Subject, Due Date, Created
- [ ] Create form: subject selector, title input, description textarea, due date picker
- [ ] View-only (no edit/delete in current backend)

### 8.5 SessionsTab

- [ ] Table: Student ID (truncated), State, Idle Time, Started At, Actions
- [ ] Terminate button with confirmation
- [ ] Auto-refresh or manual refresh button
- [ ] State badges: active=green, idle=yellow

### 8.6 ModelsTab

- [ ] Table: Display Name, Model ID, Provider, Capabilities (Think/Vision icons), Multiplier, Status, Created, Actions
- [ ] Create form: name, display_name, token_multiplier, provider dropdown, think_mode dropdown, visual_support checkbox
- [ ] Enable/disable toggle button
- [ ] Edit multiplier inline
- [ ] Edit specs: provider, think_mode, visual_support
- [ ] Thinking config editor (dynamic form from `/admin/provider-schema/:provider`)
  - [ ] Fetch schema for selected provider
  - [ ] Render selects for "select" types, number inputs for "integer" types
  - [ ] Toggle raw JSON mode for advanced users
- [ ] Delete model with confirmation
- [ ] Capability badges: Brain icon for thinking, Eye icon for vision

---

## 9. UI Patterns to Copy from lit-ui/

| Pattern | Source File | What to Copy |
|---------|------------|--------------|
| API client | `core/edu-api.ts` | `request<T>()`, `authHeader()`, error handling |
| Types | `core/edu-types.ts` | Interface style, naming conventions |
| Auth persistence | `core/session-manager.ts` | localStorage save/load/clear |
| Menu dialog with tabs | `dialogs/MenuDialog.ts` | Sidebar + content area layout |
| AccountTab | `dialogs/AccountTab.ts` | Form patterns, loading/error/success states |
| Button component | `@mariozechner/mini-lit/dist/Button.js` | Already available |
| Input component | `@mariozechner/mini-lit/dist/Input.js` | Already available |
| Theme toggle | `@mariozechner/mini-lit/dist/ThemeToggle.js` | Already available |
| CSS theme | `app.css` | Import pattern, CSS variables |

---

## 10. Component Patterns

### Form Pattern (from AccountTab.ts)

```ts
@state() private loading = false;
@state() private error = "";
@state() private success = "";

private async saveData() {
  this.loading = true;
  this.error = "";
  try {
    await adminApi.doSomething(this.token, data);
    this.success = "Done";
  } catch (err) {
    this.error = err.message;
  } finally {
    this.loading = false;
  }
}
```

### Table Pattern

```html
<div class="overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="border-b border-border">
      <tr class="text-left text-muted-foreground">
        <th class="py-2 px-3 font-medium">Column</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => html`
        <tr class="border-b border-border hover:bg-muted/50">
          <td class="py-2 px-3">${item.field}</td>
        </tr>
      `)}
    </tbody>
  </table>
</div>
```

### Confirm Dialog Pattern

```ts
private confirmDelete(id: string) {
  if (!confirm("Are you sure?")) return;
  this.doDelete(id);
}
```

---

## 11. Key Differences from lit-ui Student App

| Aspect | lit-ui (Student) | lit-admin (New) |
|--------|-----------------|-----------------|
| Login role check | Routes student to chat | Routes staff to dashboard |
| Main view | WebSocket chat | CRUD tables + forms |
| State complexity | Streaming, session replay | Form states, lists, validation |
| Data loading | On mount, auto | Manual fetch + refresh buttons |
| Navigation | MenuDialog with tabs | Top tab bar |

---

## 12. Build & Run

```bash
cd lit-admin
bun install
bun run dev       # Vite dev server at localhost:5175 (or next available port)
bun run build     # Production build to dist/
```

The Vite dev server proxies `/admin/*`, `/auth/*`, etc. to the backend (default `http://127.0.0.1:8000`, configurable via `VITE_DEV_PROXY_TARGET` env var).

---

## 13. Implementation Order

1. **Scaffold**: `lit-admin/` with package.json, vite.config.ts, tsconfig.json, index.html, app.css
2. **Core**: `admin-api.ts`, `admin-types.ts`, copy `session-manager.ts`
3. **App shell**: `main.ts`, `app.ts` (login vs dashboard router)
4. **Login page**: `admin-login-page.ts` (reuse `lit-ui` login with staff routing)
5. **Dashboard**: `admin-dashboard.ts` with tab bar
6. **Tab 1 — Students**: Full CRUD + token management + model access
7. **Tab 2 — Cohorts**: Simple CRUD
8. **Tab 3 — Subjects**: CRUD with cohort filter
9. **Tab 4 — Assignments**: List + create
10. **Tab 5 — Sessions**: Monitor + terminate
11. **Tab 6 — AI Models**: Full CRUD + specs + thinking config
