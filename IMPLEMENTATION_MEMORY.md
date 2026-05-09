# Implementation Memory: Provider/Model Switching & Model Table Enhancement

## Task Overview
Implement proper provider/model switching in EduCraw and enhance model table with new fields.

## Key Requirements
1. Fix provider switching - currently only switches model, not provider
2. Add fields to model table:
   - provider (string)
   - think_mode (nullable bool/string)
   - visual_support (bool)
3. Wire new fields to frontend admin page
4. Add update button for model specs

## Current Issues
- Model selection logs "model switched via ACP" but doesn't actually set provider
- Database model table doesn't store provider name
- model_poller.rs only sends SetSessionModelRequest without provider switching

## Investigation Progress

### Files to Check
- [x] Database schema for models table
- [x] educlaw-server/src/acp_bridge/model_poller.rs (model switching logic)
- [x] Frontend admin page for models
- [x] Model struct definitions
- [x] API endpoints for model management

### Key Findings

#### Database Schema (schema.rs)
- Current fields: id, name, display_name, enabled, multiplier, created_at
- MISSING: provider, think_mode, visual_support

#### Model Struct (db/models.rs)
- Current fields match DB schema
- Need to add: provider, think_mode, visual_support

#### Model Poller (acp_bridge/model_poller.rs)
- Line 111-116: Only sends SetSessionModelRequest
- Does NOT switch provider first
- Need to add provider switching logic before model switch

#### Admin Page (educlaw-web/src/pages/AdminPage.tsx)
- ModelsTab starts at line 605
- Has create, toggle enable/disable, set multiplier, delete functions
- MISSING: update function for new fields, UI for provider/think_mode/visual_support

#### Admin API Endpoints (api/admin.rs)
- POST /admin/models: creates model (CreateModelBody struct line 714)
- PUT /admin/models/:id: updates enabled status (UpdateModelBody struct line 752)
- DELETE /admin/models/:id: deletes model
- MISSING: endpoint for updating model specs (provider, think_mode, visual_support)

#### ACP Protocol Available
- SetSessionConfigOptionRequest - for setting provider/model separately
- ConfigId::new("provider") - for provider switching
- ConfigId::new("model") - for model switching
- ListProvidersRequest - to get provider+model mapping

## Implementation Plan

### Phase 1: Database & Backend Schema Update
1. Add migration to add new columns to models table:
   - provider TEXT
   - think_mode INTEGER (nullable, 1=thinking, 0=non-thinking, NULL=unknown)
   - visual_support INTEGER (0=no, 1=yes)

2. Update Model struct in db/models.rs:
   - Add new fields with proper types
   - Update all SQL queries to include new fields

3. Update API endpoints in api/admin.rs:
   - Modify CreateModelBody to include new fields
   - Create UpdateModelSpecsBody for updating existing models
   - Add new endpoint PUT /admin/models/:id/specs

### Phase 2: Provider Switching Logic
1. Update model_poller.rs:
   - Look up model's provider from database
   - Send SetSessionConfigOptionRequest to switch provider first
   - Then send SetSessionModelRequest to switch model

### Phase 3: Frontend Updates
1. Update AdminPage.tsx ModelsTab:
   - Add provider, think_mode, visual_support to create form
   - Add update button/form for editing existing models
   - Display new fields in table
   - Add API calls for update endpoint

2. Update api client to include new fields

### Files to Modify
1. educlaw-server/src/db/schema.rs (migration) ✓ DONE
2. educlaw-server/src/db/models.rs (struct + queries) ✓ DONE
3. educlaw-server/src/api/admin.rs (endpoints) ✓ DONE
4. educlaw-server/src/acp_bridge/model_poller.rs (provider switching) ✓ DONE
5. educlaw-web/src/api/types.ts (type definitions) ✓ DONE
6. educlaw-web/src/api/client.ts (API client) ✓ DONE
7. educlaw-web/src/pages/AdminPage.tsx (UI) ✓ DONE
8. educlaw-web/src/components/ChatPanel.tsx (student model selector) ⏸️ NEEDS MODEL DATA

## User Concern - Model Listing Flow ✓ VERIFIED

### Flow Analysis Complete

**1. Admin Creates Model:**
- Frontend: POST /admin/models with {name, display_name, multiplier}
- Backend: admin.rs:create_model() → db_models::insert_model()
- Database: New row in `models` table with enabled=1 by default

**2. Admin Views All Models:**
- Frontend: GET /admin/models
- Backend: admin.rs:list_models() → db_models::list_models()
- SQL: `SELECT * FROM models ORDER BY display_name`
- Returns: ALL models (enabled + disabled) ✓

**3. Student Model Assignment:**
- Frontend: Admin assigns models to student via PUT /admin/students/:id/models
- Backend: Uses db_models::models_for_student()
- Logic:
  - If student has specific assignments in `student_models` table → return those
  - If NO assignments → return ALL ENABLED models via list_enabled()
  - SQL for enabled: `SELECT * FROM models WHERE enabled = 1`
- Returns: Only model NAMES (strings), not full Model objects ✓

**4. Session Model Usage:**
- When student creates session → uses models_for_student() to get allowed list
- When student switches model → model_poller validates against models_for_student()
- ACP bridge returns model names to frontend

### Conclusion: Flow is CORRECT ✓
- Admin-created models ARE stored in models table
- Admin-created models ARE included in list_models() for admin panel
- Admin-created models ARE included in list_enabled() for student assignment
- When enabled=1, they become available to all students (unless specific assignment)

No backend changes needed for model listing. Can proceed with frontend.

## Implementation Summary

### ✅ COMPLETED

#### Backend (Server)
1. **Database Schema** - Added 3 new columns to `models` table:
   - `provider` (TEXT, nullable) - e.g. "xai", "deepseek", "openai"
   - `think_mode` (INTEGER, nullable) - 1=thinking, 0=non-thinking, NULL=unknown
   - `visual_support` (INTEGER, default 0) - 1=supports vision, 0=text-only

2. **Model Struct** - Updated with new fields and proper serialization

3. **Database Functions** - Added `update_model_specs()` to update provider/capabilities

4. **API Endpoint** - Added `PUT /admin/models/:id/specs` for updating model specs

5. **Provider Switching** - model_poller.rs now:
   - Looks up model's provider from database
   - Sends SetSessionConfigOptionRequest to switch provider FIRST
   - Then sends SetSessionModelRequest to switch model
   - Logs provider switching success/failure

#### Frontend (Web)
1. **Type Definitions** - Updated Model interface with new fields

2. **API Client** - Added `adminUpdateModelSpecs()` function

3. **Admin Panel ModelsTab**:
   - **Create form** - Added fields for provider, think_mode, visual_support
   - **Table display** - Shows icons (Brain for thinking, Eye for vision) in:
     - Display name column (inline icons)
     - New "Capabilities" column (badge pills)
   - **Provider column** - Shows provider ID or "—"
   - **Update button** - "Specs" button opens inline editor
   - **Inline editor** - Expandable row with form to update all specs
   - **Theme compliance** - Uses wp-* color variables throughout

4. **Icons Used**:
   - `Brain` (from lucide-react) - Thinking models (wp-info color)
   - `Eye` (from lucide-react) - Vision support (wp-accent color)
   - `Edit2` - Update specs button
   - `Check` - Save button

### ✅ Student Chat Panel Icons - COMPLETED

**Changes made:**
1. ✓ Added `full_models_for_student()` function in db/models.rs to return full Model objects
2. ✓ Updated `GET /sessions/:id/models` endpoint to use `full_models_for_student()`
3. ✓ Updated SessionModels type to `models: Model[]` instead of `string[]`
4. ✓ Updated ChatPanel props to accept `availableModels?: Model[]`
5. ✓ Updated ChatPanel dropdown to:
   - Show `m.display_name` instead of model name
   - Show Brain icon for thinking models (think_mode === 1)
   - Show Eye icon for vision-capable models (visual_support === 1)
   - Icons appear next to the model selector
6. ✓ Updated SessionPage to handle Model[] instead of string[]
7. ✓ Imported Brain and Eye icons from lucide-react
8. ✓ Used warm parchment theme colors (wp-info for Brain, wp-accent for Eye)

**Result:** Students now see capability icons next to their model selector in chat!

## Testing Checklist

- [ ] Run server - migrations apply automatically
- [ ] Admin panel - Create new model with provider/capabilities
- [ ] Admin panel - Update existing model specs  
- [ ] Admin panel - Icons display correctly (Brain for thinking, Eye for vision)
- [ ] Admin panel - Theme colors match (no blue/purple, only wp-*)
- [ ] **Student chat - Icons show next to model selector**
- [ ] **Student chat - Display names shown instead of model IDs**
- [ ] Student session - Switch to model with different provider
- [ ] Check logs - Provider switching happens before model switching
- [ ] Student session - Model switch works across providers

## Icons Used (React Icons from lucide-react)

✅ **Brain** - Indicates thinking/reasoning models
- Color: `text-wp-info` (warm blue-grey from parchment theme)
- Used in: Admin table, Student chat selector
- Models with `think_mode === 1`

✅ **Eye** - Indicates vision-capable models  
- Color: `text-wp-accent` (warm orange from parchment theme)
- Used in: Admin table, Student chat selector
- Models with `visual_support === 1`

✅ **Edit2** - Update button for model specs
- Used in: Admin table actions column

✅ **Check** - Save button
- Used in: Inline spec editor, confirmation actions

❌ **NO EMOJIS USED** - All icons are from lucide-react library!
