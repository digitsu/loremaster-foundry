# PRD: Shared Content Library UI

**Status:** Draft
**Priority:** P1
**Author:** CLU
**Date:** 2026-02-08
**Module:** loremaster (Foundry VTT)

## Overview

Add UI support for the Shared Content Library feature in the Loremaster Foundry module. The backend (loremaster-proxy Elixir) already implements 11 WebSocket handlers, the SharedContentManager service, and all Ash resources (SharedContent, UserSharedAccess, SharedChunk, SharedEmbedding, GameSystem). This PRD covers the client-side UI to expose those capabilities to users and admins.

## Goals

1. Let users browse shared content available for their game system
2. Let users submit their own content for sharing
3. Let admins (operator account `burninator`) approve/reject/publish shared content
4. Let users activate shared content for use in their world (RAG context)
5. Show activation counts and tier limits in the login window
6. Display activated shared content as read-only tiles alongside user-uploaded content

## Non-Goals

- Backend changes (all handlers already exist)
- Shared content embedding/chunking pipeline changes
- Tier pricing or limit changes
- Changes to the RAG retrieval pipeline (already integrates shared content)

---

## Backend API Surface (Already Implemented)

All messages are sent via the existing Phoenix Channel (`world:WORLD_ID`).

### User Handlers

| Message | Purpose | Key Params |
|---------|---------|------------|
| `list-shared-content` | Browse available shared content for current game system | None (uses socket assigns) |
| `activate-shared-content` | Activate content for current world | `sharedContentId` |
| `deactivate-shared-content` | Deactivate content for current world | `sharedContentId` |
| `get-shared-tier-status` | Get tier limits and activation counts | None |
| `get-shared-content-detail` | Get detail for a specific item | `sharedContentId` |
| `submit-to-shared-library` | Submit own PDF/module for review | `contentType`, `contentId`, `publisher?`, `description?` |

### Admin Handlers (requires admin role)

| Message | Purpose | Key Params |
|---------|---------|------------|
| `admin-list-pending-shared` | List content awaiting approval | None |
| `admin-approve-shared` | Approve and publish content | `sharedContentId` |
| `admin-reject-shared` | Reject content (archives it) | `sharedContentId` |
| `admin-publish-pdf` | Directly publish a PDF (bypass queue) | `pdfId`, `worldId?`, `publisher?`, `description?` |
| `admin-remove-shared` | Remove/archive shared content | `sharedContentId` |

### Tier Limits

| Tier | Max Activations |
|------|-----------------|
| free | 0 |
| basic | 2 |
| pro | 5 |
| premium | unlimited |

### Key Response Shape: `list-shared-content`

```javascript
{
  content: [{
    id,                  // UUID
    system_id,           // e.g. "dnd5e"
    content_type,        // "pdf" | "module" | "ruleset"
    title,
    description,
    publisher,
    category,            // "core_rules" | "rules_supplement" | "adventure" | "adventure_supplement" | "reference"
    total_chunks,
    total_tokens,
    status,              // "pending" | "processing" | "published" | "archived"
    published_by,
    approved_by,
    published_at,
    inserted_at,
    activated,           // boolean — whether this user has activated it
    activated_world_ids  // which of user's worlds have it active
  }],
  tier: {
    current,             // number of current activations
    max                  // number or "unlimited"
  }
}
```

---

## User Stories

### US-1: Documents Tab — Separated Sections (User Files vs Shared Library)

**As a** user viewing the PDFs tab in Content Manager,
**I want** a clear visual separation between my uploaded files and the shared library content,
**So that** I can distinguish my own content from community/operator-published content.

#### Acceptance Criteria

1. The PDFs tab is split into two sections with section headers:
   - **"Your Documents"** — existing PDF list (unchanged behavior)
   - **"Shared Library"** — shared content activated for this world
2. The Shared Library section only appears when the user has at least one activated shared content item, or when in "browse" mode.
3. A **"Browse Shared Library"** button at the bottom of the PDFs tab opens a browse overlay/panel showing all available shared content for the current game system.
4. The browse panel shows content as **tiles** (card layout) grouped by category, with:
   - Title, publisher, category badge, content type icon (PDF/Module/Ruleset)
   - Description (truncated, expandable)
   - "Activate" / "Deactivate" toggle button
   - Activation status indicator
5. The browse panel header shows tier status: `"n / m shared resources activated"` (or `"n activated (unlimited)"` for premium).
6. Only content matching the current world's `game.system.id` is shown.
7. Empty state message when no shared content exists for the game system.

#### UI Layout Decision: Tiles (Card Grid)

The shared library browse panel uses a **tile/card grid layout** rather than a file tree because:
- Content is flat (no hierarchy) — there are no folders or nesting
- Cards better showcase title + description + publisher metadata
- Consistent with how Foundry displays compendium packs and module cards
- Easier to scan and compare items at a glance
- Categories are shown as badge filters, not tree branches

#### Implementation Notes

- Add `listSharedContent()` and `getSharedTierStatus()` wrapper methods to `socket-client.mjs`
- In `content-manager.mjs` `getData()`, add `sharedContent`, `sharedTier`, and `activatedSharedContent` data
- Load shared content data lazily when the PDFs tab is selected (or on first render if already on PDFs tab)
- In `content-manager.hbs`, add the "Shared Library" section after the existing `pdf-list` `<ul>`
- Add tile grid CSS: `.shared-library-grid` with `.shared-content-tile` cards

---

### US-2: Submit Content for Sharing

**As a** user with uploaded PDFs or imported modules,
**I want** to submit my content to the shared library for review,
**So that** other users can benefit from the same reference material.

#### Acceptance Criteria

1. Each PDF tile in "Your Documents" gains a **"Share"** action button (icon: `fa-share-alt`) next to the delete button.
2. Clicking "Share" opens a confirmation dialog with:
   - Content title (pre-filled from PDF display name)
   - Publisher field (text input, optional)
   - Description field (textarea, optional)
   - "Submit for Review" / "Cancel" buttons
3. On submit, sends `submit-to-shared-library` with `contentType: "pdf"`, `contentId`, `publisher`, `description`.
4. Success: shows notification "Submitted for review" and disables the share button with label "Pending Review".
5. If content already exists in the shared library: shows notification "Content already exists in the shared library".
6. Error handling with user-friendly messages.
7. Only PDFs with `processing_status: "completed"` show the share button.

#### Implementation Notes

- Add `submitToSharedLibrary(contentType, contentId, publisher, description)` wrapper to `socket-client.mjs`
- Add share button to PDF tile template in `content-manager.hbs`
- Add click handler in `activateListeners()` for `.share-pdf-btn`
- Use Foundry `Dialog.confirm()` or a custom dialog for the submission form

---

### US-3: Admin Controls Dialog

**As an** admin user (operator account `digitsu@gmail.com`),
**I want** a dedicated admin panel to manage shared content,
**So that** I can approve, reject, and directly publish content to the shared library.

#### Acceptance Criteria

1. An **"Admin"** button appears in the Content Manager header — visible only to admin users.
2. Admin detection: check if the authenticated user's email matches `ADMIN_EMAILS` (the backend enforces this; on the client, we check if admin handlers succeed or use a flag from auth status).
3. Clicking "Admin" opens an **Admin Shared Content Dialog** (`Application`) with two tabs:
   - **Pending Review** — items submitted by users awaiting approval
   - **Published** — all currently published shared content
4. **Pending Review tab:**
   - List of pending items with: title, submitter, category, content type, submission date
   - Action buttons per item: **"Approve"** (green) and **"Reject"** (red)
   - Approve sends `admin-approve-shared`, shows success notification
   - Reject sends `admin-reject-shared`, shows success notification
   - Item removed from list after action
5. **Published tab:**
   - List of published items with: title, publisher, category, type, publish date, activation count
   - **"Remove"** action button per item (sends `admin-remove-shared`)
   - **"Direct Publish"** button in header — opens dialog to select a PDF from user's uploaded PDFs and publish it directly (sends `admin-publish-pdf`)
6. Empty states for both tabs.

#### Implementation Notes

- New file: `scripts/shared-content-admin.mjs` — `SharedContentAdmin` extends `Application`
- New template: `templates/shared-content-admin.hbs`
- Add wrapper methods to `socket-client.mjs`: `adminListPendingShared()`, `adminApproveShared(id)`, `adminRejectShared(id)`, `adminPublishPdf(pdfId, opts)`, `adminRemoveShared(id)`
- Admin flag: Add `isAdmin` to `PatreonAuthManager` — derived from a new field in the `get-shared-tier-status` or `auth/status` response, or by attempting `admin-list-pending-shared` and caching success/failure
- Register admin button click in Content Manager's `activateListeners()`

---

### US-4: Shared Adventures on Active Adventure Tab

**As a** user who has activated a shared adventure,
**I want** to select it as my active adventure just like my own uploaded adventures,
**So that** the AI uses the shared adventure content for context.

#### Acceptance Criteria

1. The adventure selector dropdown on the Active Adventure tab includes a **"Shared Adventures"** `<optgroup>` section below the existing PDF and Module adventure groups.
2. Shared adventures are those activated shared content items where `category` is `"adventure"` or `"adventure_supplement"`.
3. Selecting a shared adventure sets it as the active adventure (the backend already handles shared content in RAG context).
4. The active adventure display shows a **"Shared"** badge when a shared adventure is active.
5. Shared adventures cannot be deleted or have GM Prep generated — those action buttons are hidden for shared adventures.

#### Implementation Notes

- In `_loadAdventureData()`, also fetch activated shared content and filter for adventure categories
- Add `sharedAdventures` to `getData()` return value
- In the template's adventure selector, add a third `<optgroup label="Shared Adventures">` after PDF and Module groups
- When a shared adventure is selected, call `setActiveAdventure("shared", sharedContentId)`
- The backend `setActiveAdventure` handler may need a minor update to accept `"shared"` type — **verify this** before implementation

---

### US-5: Login Window — Shared Content Counter

**As a** logged-in user,
**I want** to see how many shared content items I have activated out of my tier limit,
**So that** I know my current usage and whether I can activate more.

#### Acceptance Criteria

1. A new **"Shared Resources"** row appears in the login window's logged-in section, positioned after the RAG status indicator and before the quota section.
2. Displays: `"Shared Resources: n / m activated"` (or `"n activated (unlimited)"` for premium tier).
3. Includes a **"Manage"** link/button that opens the Content Manager to the PDFs tab.
4. Visual indicator:
   - Green when `n < m` (can activate more)
   - Yellow when `n == m` (at limit)
   - Grey when `m == 0` (free tier, no access)
5. For free tier: shows `"Shared Resources: Upgrade to access"` with link to Patreon.
6. Data fetched via `get-shared-tier-status` during the existing `_fetchQuota()` call (piggyback on auth status check).

#### Implementation Notes

- Add `getSharedTierStatus()` wrapper to `socket-client.mjs`
- In `patreon-login-ui.mjs` `_fetchQuota()`, also call `getSharedTierStatus()` and store result
- Add `sharedTier` to `getData()` return
- Add section to `patreon-login.hbs` after RAG status block
- Add Handlebars helper `sharedTierLevel` (returns "available", "at-limit", "none")
- Add click handler for "Manage" link to open Content Manager

---

### US-6: Read-Only Shared Content Tiles on PDFs Tab

**As a** user who has activated shared content,
**I want** to see the activated shared content displayed as tiles on the PDFs tab,
**So that** I can see what shared resources are available in my world at a glance.

#### Acceptance Criteria

1. Activated shared content appears in the **"Shared Library"** section of the PDFs tab (see US-1).
2. Each activated shared content tile has the same visual structure as a normal PDF tile:
   - Icon (uses `fa-cloud` or `fa-book-open` instead of `fa-file-pdf` to distinguish)
   - Title, category badge, publisher name
   - Content type indicator (PDF/Module/Ruleset)
   - Status shows "Shared" badge in a distinct color (e.g., blue/purple)
3. Shared content tiles have **no action controls**:
   - No delete button
   - No GM Prep generation button
   - No share button
4. Shared content tiles have a **"Deactivate"** button (icon: `fa-times-circle`) to remove from the world.
5. Clicking the tile does nothing (no expand/edit behavior).
6. Visual distinction: shared tiles have a subtle border or background tint (e.g., light blue) to differentiate from user-uploaded content.

#### Implementation Notes

- In `content-manager.hbs`, add a `{{#each activatedSharedContent}}` block in the Shared Library section
- Use a `.shared-content-tile` CSS class with distinct styling
- Template structure mirrors `.pdf-item` but omits `.pdf-actions` (delete, GM prep) and replaces with deactivate button
- Add deactivate click handler in `activateListeners()`
- On deactivate success, remove tile and refresh the list

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `scripts/shared-content-admin.mjs` | Admin dialog Application for managing shared content |
| `templates/shared-content-admin.hbs` | Admin dialog Handlebars template |

### Modified Files

| File | Changes |
|------|---------|
| `scripts/socket-client.mjs` | Add 11 wrapper methods for shared content WebSocket messages |
| `scripts/content-manager.mjs` | Add shared content data loading, browse panel, tile rendering, event handlers |
| `templates/content-manager.hbs` | Add Shared Library section, browse panel, share buttons, admin button, shared adventure optgroup |
| `scripts/patreon-login-ui.mjs` | Add shared tier status fetching and data passing |
| `templates/patreon-login.hbs` | Add Shared Resources counter row |
| `scripts/loremaster.mjs` | Register new Handlebars helpers, import admin dialog |
| `styles/loremaster.css` | Add styles for shared content tiles, browse panel, admin dialog |
| `scripts/config.mjs` | Add admin email constant (or derive from backend) |

### Socket Client Methods to Add

```javascript
// User methods
async listSharedContent()
async activateSharedContent(sharedContentId)
async deactivateSharedContent(sharedContentId)
async getSharedTierStatus()
async getSharedContentDetail(sharedContentId)
async submitToSharedLibrary(contentType, contentId, publisher, description)

// Admin methods
async adminListPendingShared()
async adminApproveShared(sharedContentId)
async adminRejectShared(sharedContentId)
async adminPublishPdf(pdfId, options)
async adminRemoveShared(sharedContentId)
```

---

## Implementation Order

1. **US-1** (Documents tab separation) + **US-6** (Read-only tiles) — These are tightly coupled; implement together.
2. **US-5** (Login window counter) — Small, independent change.
3. **US-2** (Submit for sharing) — Adds share button to existing tiles.
4. **US-4** (Shared adventures) — Extends existing adventure tab.
5. **US-3** (Admin controls) — New dialog, can be done in parallel with US-2/US-4.

Socket client wrappers (all 11 methods) should be implemented first as a prerequisite.

---

## Open Questions

1. **Admin detection**: Should we add an `is_admin` field to the auth status response, or detect admin by attempting an admin call and caching the result? _Recommendation: Add `is_admin` to the auth status response on the backend for cleanliness._
2. **Active adventure for shared content**: Does the backend `set-active-adventure` handler already support `adventure_type: "shared"`? If not, a minor backend update is needed.
3. **Browse panel UX**: Should the browse panel be a modal overlay within the Content Manager, or a slide-out panel? _Recommendation: Modal overlay, consistent with other Foundry dialogs._
4. **Shared content refresh**: Should shared content lists auto-refresh on `shared-content-activated` / `shared-content-deactivated` push events? _Recommendation: Yes, listen for push events and re-render._

---

## Wireframes (Text)

### PDFs Tab — After Implementation

```
┌─────────────────────────────────────────────┐
│ Loremaster - Content Manager           [x]  │
├─────────────────────────────────────────────┤
│ [PDFs] [Upload] [Adventure] [Cast] [...]    │
├─────────────────────────────────────────────┤
│                                             │
│ ── Your Documents ──────────────────────    │
│ ┌─────────────────────────────────────────┐ │
│ │ 📄 Core Rulebook        pdf:1    [🗑][↗]│ │
│ │    core_rules · 12.4 MB · completed     │ │
│ ├─────────────────────────────────────────┤ │
│ │ 📄 Lost Mines of Ph...  pdf:2    [🗑][↗]│ │
│ │    adventure · 8.1 MB · completed       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ── Shared Library (2/5 activated) ────────  │
│ ┌─────────────────────────────────────────┐ │
│ │ ☁️ Monster Manual        Shared   [✕]   │ │
│ │    core_rules · WotC · PDF              │ │
│ ├─────────────────────────────────────────┤ │
│ │ ☁️ Curse of Strahd       Shared   [✕]   │ │
│ │    adventure · WotC · PDF               │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│         [ Browse Shared Library ]           │
│                                             │
└─────────────────────────────────────────────┘
```

### Login Window — After Implementation

```
┌───────────────────────────────────┐
│ Loremaster Account           [x]  │
├───────────────────────────────────┤
│ ✅ Connected                      │
│                                   │
│ 👤 JerryChan                      │
│ 📧 jerry@example.com              │
│                                   │
│ Tier: ⭐ Pro      [↻]            │
│ RAG: ✅ Available                 │
│ Shared: 2/5 activated [Manage]   │
│                                   │
│ Monthly Usage                     │
│ ████████░░░░░░░░ 1.2M / 2M      │
│ Resets: Mar 1, 2026    [↻]      │
│                                   │
│           [ Logout ]              │
└───────────────────────────────────┘
```

### Browse Shared Library (Modal Overlay)

```
┌─────────────────────────────────────────────┐
│ Shared Library — D&D 5e          2/5   [x]  │
├─────────────────────────────────────────────┤
│ Filter: [All ▼]  [core_rules] [adventure]   │
├─────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐          │
│ │ 📄 Monster   │  │ 📄 Curse of  │          │
│ │    Manual    │  │    Strahd    │          │
│ │ WotC         │  │ WotC         │          │
│ │ core_rules   │  │ adventure    │          │
│ │ ✅ Activated  │  │ ✅ Activated  │          │
│ │ [Deactivate] │  │ [Deactivate] │          │
│ └──────────────┘  └──────────────┘          │
│ ┌──────────────┐  ┌──────────────┐          │
│ │ 📄 Xanathar's│  │ 📄 Tomb of   │          │
│ │    Guide     │  │  Annihilat.  │          │
│ │ WotC         │  │ WotC         │          │
│ │ rules_suppl. │  │ adventure    │          │
│ │ [ Activate ] │  │ [ Activate ] │          │
│ └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────┘
```
