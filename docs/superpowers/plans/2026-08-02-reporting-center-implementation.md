# Reporting Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Export Center modal with a three-column Reports & Export workspace, unifying reporting month state and modularizing report rendering.

**Architecture:** Adapter-first. `src/reporting/` orchestrates existing `src/reports/` logic. `ReportRegistry` handles section composition. `ReportController` manages state.

**Tech Stack:** React, Electron IPC, existing HTML renderer, Mahindra CI design tokens.

## Global Constraints

- Version: 2.2.7
- No duplicated business logic, calculations, or month utilities.
- No regression in production workbooks (hash-verified).
- Existing HTML renderer is the sole source for preview, PDF, and HTML.
- Mahindra CI design tokens only.
- Keyboard shortcuts: Ctrl+P (Generate), Ctrl+E (Export), Ctrl+F (Search).

---

### Task 1: Reporting Month Context & Utilities

**Files:**
- Modify: `src/ReportContext.tsx`
- Modify: `src/utils/monthUtils.ts`

**Interfaces:**
- Consumes: `src/utils/monthUtils.ts`
- Produces: `ReportingMonthContext` (shared state for Dashboard, Historical, Rack, Reports).

- [ ] **Step 1: Extract ReportingMonthContext**
- [ ] **Step 2: Update Dashboard/Historical/Rack to consume context**
- [ ] **Step 3: Commit**

### Task 2: Reporting Architecture Scaffolding

**Files:**
- Create: `src/reporting/ReportTypes.ts`
- Create: `src/reporting/ReportRegistry.ts`
- Create: `src/reporting/ReportController.ts`

**Interfaces:**
- Consumes: `src/reports/reportTypes.ts`
- Produces: `ReportRegistry` (section registration), `ReportController` (preview/gen state).

- [ ] **Step 1: Define ReportSection and ReportRequest types**
- [ ] **Step 2: Implement ReportRegistry with default section composition**
- [ ] **Step 3: Implement ReportController state management**
- [ ] **Step 4: Commit**

### Task 3: Reports & Export Workspace UI

**Files:**
- Create: `src/components/ReportsExportWorkspace.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ReportController`, `ReportingMonthContext`
- Produces: `ReportsExportWorkspace` component.

- [ ] **Step 1: Implement three-column layout (Builder, Preview, Output)**
- [ ] **Step 2: Implement Builder (Type, Period, Sections, Drag-and-Drop)**
- [ ] **Step 3: Implement Preview (Sandboxed iframe, Toolbar)**
- [ ] **Step 4: Implement Output (Formats, Options, Generate button)**
- [ ] **Step 5: Integrate into App.tsx navigation**
- [ ] **Step 6: Commit**

### Task 4: Preview & Export Integration

**Files:**
- Modify: `src/reporting/PreviewProvider.ts`
- Modify: `src/reporting/ExportProvider.ts`

**Interfaces:**
- Consumes: `src/reports/pdf/reportHtml.ts`
- Produces: `PreviewProvider` (lazy HTML), `ExportProvider` (PDF/Excel/HTML).

- [ ] **Step 1: Implement PreviewProvider using existing HTML renderer**
- [ ] **Step 2: Implement ExportProvider using existing IPC bridges**
- [ ] **Step 3: Commit**

### Task 5: Report History & Persistence

**Files:**
- Create: `src/reporting/ReportHistory.ts`

**Interfaces:**
- Consumes: `window.desktop.Export`
- Produces: `ReportHistory` (metadata, artifact path).

- [ ] **Step 1: Implement history persistence (localStorage + Electron bridge)**
- [ ] **Step 2: Implement Recent Reports list UI**
- [ ] **Step 3: Commit**

### Task 6: Quality Gates & Certification

**Files:**
- Modify: `RELEASE_NOTES_V2.2.7.md`
- Modify: `RELEASE_MANIFEST_V2.2.7.md`

**Interfaces:**
- Consumes: All previous tasks.

- [ ] **Step 1: Run lint, typecheck, build**
- [ ] **Step 2: Run test:all-report, test:packaged-report**
- [ ] **Step 3: Verify workbook integrity (hash check)**
- [ ] **Step 4: Update release documentation**
- [ ] **Step 5: Commit**