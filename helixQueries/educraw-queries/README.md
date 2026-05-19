# EduCraw HelixDB Query Templates

Dynamic JSON query templates for `POST /v1/query`. Each file is a complete request body — load it, inject real parameter values, and send.

## Usage

```
1. Load JSON file
2. Replace top-level "parameters" values with real data
3. POST to /v1/query with request_type "read" or "write"
```

The `{"Param": "name"}` references inside the AST are fixed — only the `parameters` object values change at runtime.

## Query Count

| Module | Read | Write | Total |
|--------|------|-------|-------|
| models | 6 | 7 | 13 |
| sessions | 3 | 6 | 9 |
| students | 4 | 11 | 15 |
| cohorts | 2 | 4 | 6 |
| subjects | 3 | 3 | 6 |
| token_usage | 2 | 2 | 4 |
| token_codes | 3 | 3 | 6 |
| api (consolidated) | 4 | 3 | 7 |
| **Total** | **27** | **39** | **67** |

## Directory Layout

```
read/   — read-only queries (request_type: "read")
write/  — mutation queries (request_type: "write")
api/    — consolidated multi-query endpoints (see QUERY_ANALYSIS.md)
```
