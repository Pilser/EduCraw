# Current EduCraw Architecture: OverlayFS, Namespace & Merge

## Paths (Persistent vs Ephemeral)

```
Persistent (disk):
  /data/subjects/{cohort_id}/          ← Course materials (read-only)
  /data/students/{username}/           ← Student home (read-write)

Ephemeral (per session, cleaned after logout):
  /var/lib/educlaw/sessions/{session_id}/
    ├── work/                          ← OverlayFS scratch
    ├── merged/                        ← Unified view (agent sees this)
    └── config/                        ← Agent config home
```

## OverlayFS Mount (How Merge Works)

**Command:**
```bash
fuse-overlayfs -o lowerdir={subjects},upperdir={students},workdir={work} {merged}
```

**Stack:**
```
┌─ merged/ ────────────────────────────┐
│ What agent sees (unified filesystem) │
├───────────────────────────────────────┤
│ upper/ = /data/students/{username}/  │  ← Writes go here (persistent)
├───────────────────────────────────────┤
│ lower/ = /data/subjects/{cohort}/    │  ← Course materials (read-only)
└───────────────────────────────────────┘
```

**How Merge Works:**
- Agent sees `merged/` as one filesystem
- Read file from course? → `fuse-overlayfs` reads from lower (read-only)
- Write file? → Goes to upper (student home), persisted
- Same filename in both layers? → Upper shadows lower (write wins)

## Namespace (Isolation)

**Spawn Command:**
```bash
unshare --user --map-root-user --mount --pid --fork \
  goose acp \
  --env EDUCLAW_WORKSPACE=/merged/ \
  --env EDUCLAW_STUDENT_JSON='...'
```

**Isolations Active:**
- `--user --map-root-user`: uid 0 (root in container) → unprivileged on host
- `--mount`: New mount namespace (OverlayFS isolated to this process)
- `--pid`: New PID namespace (agent is PID 1, can't signal other students)

**Env Variables Passed:**
```
EDUCLAW_WORKSPACE=/merged/          ← Where agent works
CLAW_CONFIG_HOME=/config/           ← Agent config storage
EDUCLAW_STUDENT_JSON='{...}'        ← Student metadata
EDUCLAW_SESSION_ID={uuid}           ← Session identifier
```

## Subject Merge Details

**Current:**
- Student assigned to cohort (e.g., "primary-2b")
- Session's lower layer = `/data/subjects/primary-2b/`
- All subjects for that cohort are in subdirs: `subject_slug_1/`, `subject_slug_2/`, etc.
- Agent sees entire cohort structure (read-only)

**No per-subject isolation currently:**
- All cohort subjects visible in same OverlayFS lower layer
- Student can see all subjects for their cohort

## Data Persistence

| Data | Persisted? | Location |
|------|-----------|----------|
| Student files | ✅ YES | `/data/students/{username}/` |
| Subject materials | ✅ YES | `/data/subjects/{cohort_id}/` |
| Session dirs (work, merged) | ❌ NO | Deleted after logout |
| Agent state/config | ❌ NO | Lost on logout |

## DB Tables (Relevant)

```sql
students (id, username UNIQUE, cohort_id, ...)
sessions (id, student_id FK, namespace_pid, overlay_mount, ...)
subjects (id, cohort_id, slug, ...)
cohorts (id, title, ...)
```

Only one session per student can be active (implied by design, not enforced by DB).

## Flow: Create Session

1. **Fetch student** → get cohort_id
2. **Set lower** = `/data/subjects/{cohort_id}/`
3. **Set upper** = `/data/students/{username}/`
4. **Create ephemeral dirs**: work/, merged/, config/
5. **Mount OverlayFS**: lower + upper → merged/
6. **Spawn namespace**: unshare + goose acp in merged/
7. **Store session**: DB record with session_id + namespace_pid

## Flow: End Session

1. **SIGTERM** namespace_pid
2. **Unmount** OverlayFS (fusermount -u merged/)
3. **Delete** work/, merged/, config/
4. **Keep** upper/ (files persist)
5. **Mark session ended** in DB

---

Next login: upper/ is already populated → agent resumes with same files.
