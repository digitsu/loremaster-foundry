# Rules Discrepancy Detection and GM Ruling System

## Specification Document

**Version:** 1.0
**Date:** December 2024
**Status:** Ready for Testing

---

## Table of Contents

1. [Overview](#overview)
2. [Feature Requirements](#feature-requirements)
3. [Database Changes](#database-changes)
4. [PDF Category Enhancement](#pdf-category-enhancement)
5. [GM Presence Detection](#gm-presence-detection)
6. [Discrepancy Detection System](#discrepancy-detection-system)
7. [House Rules Storage](#house-rules-storage)
8. [House Rules Journal](#house-rules-journal)
9. [WebSocket API](#websocket-api)
10. [Testing Checklist](#testing-checklist)

---

## Overview

This feature enables Loremaster to detect discrepancies between PDF-uploaded rules (e.g., Core Rulebook) and Foundry VTT's game system implementation, then consult the GM for a ruling. Rulings can be stored as session-only or persistent house rules.

### Key Behaviors

| Scenario | Behavior |
|----------|----------|
| GM Present | Stop and ask GM for ruling before proceeding |
| Solo Game (GM is only player) | Treat as GM present - ask for ruling |
| No GM Present | Follow Foundry system rules, add note about discrepancy |

---

## Feature Requirements

### Functional Requirements

- [x] Detect discrepancies between PDF rules and Foundry system during gameplay
- [x] Ask GM how to proceed when discrepancy detected
- [x] Allow GM to choose session-only or persistent ruling
- [x] Store persistent rulings in editable document (Journal)
- [x] Follow Foundry system strictly when no GM present
- [x] Support solo games (player as GM)
- [x] Expand PDF categories to 5 types with priority

### Non-Functional Requirements

- [x] House rules included in Claude context automatically
- [x] Session rulings expire after 24 hours
- [x] Persistent rulings survive server restarts
- [x] Journal syncs bidirectionally with database

---

## Database Changes

### New Table: `house_rules`

**Location:** `server/src/storage/conversation-store.js`

```sql
CREATE TABLE IF NOT EXISTS house_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_id TEXT NOT NULL,
  rule_context TEXT NOT NULL,
  foundry_interpretation TEXT,
  pdf_interpretation TEXT,
  gm_ruling TEXT NOT NULL,
  ruling_type TEXT NOT NULL DEFAULT 'session',
  source_pdf_id INTEGER,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  FOREIGN KEY (source_pdf_id) REFERENCES pdf_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_house_rules_world ON house_rules(world_id);
CREATE INDEX IF NOT EXISTS idx_house_rules_type ON house_rules(ruling_type);
```

### Modified Table: `pdf_documents`

**New Column:** `priority INTEGER DEFAULT 50`

**Migration:** Handled automatically in `runMigrations()` for existing databases.

### Testing Database Changes

- [ ] Fresh install creates `house_rules` table
- [ ] Fresh install creates `pdf_documents` with `priority` column
- [ ] Existing database gets `priority` column via migration
- [ ] Indexes created correctly

---

## PDF Category Enhancement

### New Categories

| Category | Value | Priority | Description |
|----------|-------|----------|-------------|
| Core Rules | `core_rules` | 100 | Primary rulebook, highest authority |
| Rules Supplement | `rules_supplement` | 80 | Official supplements and expansions |
| Adventure Module | `adventure` | 50 | Adventure-specific rules |
| Adventure Supplement | `adventure_supplement` | 40 | Adventure extras |
| Reference | `reference` | 30 | General reference material |

### Files Modified

| File | Changes |
|------|---------|
| `server/src/services/pdf-processor.js` | Added `PDF_CATEGORIES` constant, `getCategoryPriority()` function |
| `server/src/storage/pdf-registry.js` | Updated `createPDF()` to set priority, ordered queries by priority |
| `server/src/websocket/socket-handler.js` | Updated category validation to accept 5 categories |
| `scripts/content-manager.mjs` | Updated categories array, fixed `categoryLabel` helper for snake_case |
| `lang/en.json` | Added `CoreRules`, `RulesSupplement`, `AdventureSupplement` labels |

### Testing PDF Categories

- [ ] Content Manager shows 5 category options in dropdown
- [ ] Uploading PDF with each category works correctly
- [ ] Priority value stored in database matches category
- [ ] PDFs sorted by priority (highest first) in context
- [ ] Category labels display correctly in PDF list
- [ ] Legacy categories (`adventure`, `supplement`, `reference`) still work

---

## GM Presence Detection

### Client-Side (Foundry)

**File:** `scripts/player-context.mjs`

| Method | Returns | Description |
|--------|---------|-------------|
| `isGMPresent()` | `boolean` | True if any GM is active |
| `isSoloGame()` | `boolean` | True if only one user active and they're GM |
| `getGameMode()` | `string` | `'solo'`, `'gm_present'`, or `'no_gm'` |
| `getGMPresenceContext()` | `object` | Full context with counts |

### Server-Side

**File:** `server/src/websocket/socket-handler.js`

| Method | Returns | Description |
|--------|---------|-------------|
| `hasActiveGM(worldId)` | `boolean` | True if at least one GM connected |
| `getActiveGMCount(worldId)` | `number` | Count of active GM connections |

### Connection Tracking

- GM status tracked on authentication (`handleAuth`)
- GM connections stored in `gmConnections` Map (worldId → Set of connectionIds)
- Connections cleaned up on disconnect

### Testing GM Presence

- [ ] `isGMPresent()` returns true when GM logged in
- [ ] `isGMPresent()` returns false when only players logged in
- [ ] `isSoloGame()` returns true when single GM user
- [ ] `isSoloGame()` returns false with multiple users
- [ ] `getGameMode()` returns correct mode for each scenario
- [ ] Server tracks GM connections on auth
- [ ] Server removes GM connections on disconnect
- [ ] `hasActiveGM()` returns correct value after GM connects/disconnects

---

## Discrepancy Detection System

### System Prompt

**File:** `server/src/prompts/multiplayer-system.js`

**Function:** `getDiscrepancyDetectionPrompt(gmPresent, isSolo, houseRulesText)`

### Prompt Behavior

#### When GM Present (or Solo)

Claude will:
1. Stop and display formatted discrepancy notice
2. Show PDF interpretation vs Foundry implementation
3. Present options A (PDF) and B (Foundry)
4. Wait for GM ruling
5. Ask if ruling should be session or persistent

**Format:**
```
**[RULES DISCREPANCY DETECTED]**

**Situation:** [What triggered this]
**PDF Rules say:** [Quote the PDF]
**Foundry System implements:** [Description]
**Impact:** [What difference this makes]

**Question for GM:** Which interpretation should I use?
- **Option A:** Follow PDF rules (may require manual adjustments)
- **Option B:** Follow Foundry system implementation
```

#### When No GM Present

Claude will:
1. Follow Foundry system implementation
2. Add note: `[Rules note: A discrepancy exists... Following Foundry system rules since no GM is present.]`
3. Not ask for ruling decisions
4. Not modify game state against Foundry automation

### House Rules in Context

Existing house rules are included in the prompt with format:
```
### Established House Rules
**Rule Context:** [description]
- PDF says: [interpretation]
- Foundry implements: [interpretation]
- **GM Ruling:** [decision]
- Type: Persistent House Rule / Session Only
```

### Testing Discrepancy Detection

- [ ] Prompt includes document priority hierarchy
- [ ] GM present mode asks for ruling (check Claude response format)
- [ ] No GM mode follows Foundry with note
- [ ] Solo mode treated as GM present
- [ ] Existing house rules included in prompt
- [ ] House rules text formatted correctly

---

## House Rules Storage

### Store Class

**File:** `server/src/storage/house-rules-store.js`

**Class:** `HouseRulesStore`

### Methods

| Method | Description |
|--------|-------------|
| `createRuling(worldId, options)` | Create new ruling |
| `getRuling(rulingId)` | Get single ruling by ID |
| `getRulingsForWorld(worldId, persistentOnly)` | Get all rulings for world |
| `getRulingsForContext(worldId, maxTokens)` | Get rulings within token budget |
| `updateRuling(rulingId, updates)` | Update existing ruling |
| `deleteRuling(rulingId)` | Delete a ruling |
| `expireSessionRulings(worldId)` | Expire all session rulings |
| `cleanupExpiredRulings(daysOld)` | Delete old expired rulings |
| `exportAsMarkdown(worldId, persistentOnly)` | Export for Journal |
| `importFromMarkdown(worldId, markdown, ...)` | Import from Journal |
| `getStats(worldId)` | Get ruling statistics |

### Ruling Types

| Type | Expiration | Use Case |
|------|------------|----------|
| `session` | 24 hours | One-time ruling for current session |
| `persistent` | Never | Permanent house rule |

### Testing House Rules Storage

- [ ] Create session ruling - verify expires_at set
- [ ] Create persistent ruling - verify expires_at is null
- [ ] Get rulings excludes expired session rulings
- [ ] Get rulings with `persistentOnly=true` excludes session rulings
- [ ] Token budget respected in `getRulingsForContext`
- [ ] Persistent rules always included even over budget
- [ ] Update ruling works correctly
- [ ] Changing to persistent clears expires_at
- [ ] Delete ruling works correctly
- [ ] Export generates valid markdown
- [ ] Import parses markdown and creates rulings
- [ ] Stats return correct counts

---

## House Rules Journal

### Journal Manager

**File:** `scripts/house-rules-journal.mjs`

**Class:** `HouseRulesJournal`

### Features

- Creates/retrieves "Loremaster House Rules" journal
- Syncs content from server on open
- Saves edits back to server automatically
- Markdown ↔ HTML conversion for Foundry journal format

### Scene Control Button

**Location:** Notes control group (gavel icon)

| Property | Value |
|----------|-------|
| name | `loremaster-house-rules` |
| icon | `fa-solid fa-gavel` |
| order | 7 |
| title | `LOREMASTER.HouseRules.Title` |

### Testing House Rules Journal

- [ ] Gavel button appears in Notes controls (GM only)
- [ ] Clicking button opens/creates journal
- [ ] Journal syncs content from server
- [ ] Journal displays house rules in formatted HTML
- [ ] Editing journal saves back to server
- [ ] Markdown to HTML conversion works (headers, bold, italic, hr)
- [ ] HTML to Markdown conversion works
- [ ] Journal flag `isHouseRulesJournal` set correctly

---

## WebSocket API

### New Message Types

| Type | Direction | Auth | Description |
|------|-----------|------|-------------|
| `submit-ruling` | Client→Server | GM | Submit new ruling |
| `list-rulings` | Client→Server | Any | Get all rulings |
| `update-ruling` | Client→Server | GM | Update existing ruling |
| `delete-ruling` | Client→Server | GM | Delete ruling |
| `get-house-rules-document` | Client→Server | Any | Get markdown document |
| `update-house-rules-document` | Client→Server | GM | Save markdown document |
| `get-house-rules-stats` | Client→Server | Any | Get statistics |

### Client Methods

**File:** `scripts/socket-client.mjs`

| Method | Description |
|--------|-------------|
| `submitRuling(ruling)` | Submit new ruling |
| `listRulings(persistentOnly)` | List all rulings |
| `updateRuling(rulingId, updates)` | Update ruling |
| `deleteRuling(rulingId)` | Delete ruling |
| `getHouseRulesDocument()` | Get markdown |
| `updateHouseRulesDocument(markdown)` | Save markdown |
| `getHouseRulesStats()` | Get stats |

### Request/Response Formats

#### submit-ruling
```javascript
// Request
{
  ruleContext: "Combat surprise round",
  foundryInterpretation: "System grants +2 bonus",
  pdfInterpretation: "Core rules say +1 bonus",
  gmRuling: "Use PDF rules: +1 bonus",
  rulingType: "persistent",
  sourcePdfId: 5  // optional
}

// Response
{
  success: true,
  ruling: { id: 1, worldId: "...", ... }
}
```

#### list-rulings
```javascript
// Request
{ persistentOnly: false }

// Response
{ rulings: [...] }
```

### Testing WebSocket API

- [ ] `submit-ruling` creates ruling in database
- [ ] `submit-ruling` requires GM permission
- [ ] `list-rulings` returns correct rulings
- [ ] `list-rulings` with `persistentOnly` filters correctly
- [ ] `update-ruling` updates database
- [ ] `update-ruling` requires GM permission
- [ ] `update-ruling` verifies world ownership
- [ ] `delete-ruling` removes from database
- [ ] `delete-ruling` requires GM permission
- [ ] `delete-ruling` verifies world ownership
- [ ] `get-house-rules-document` returns markdown
- [ ] `update-house-rules-document` imports rules
- [ ] `get-house-rules-stats` returns correct counts

---

## Testing Checklist

### Pre-Test Setup

- [ ] Server running with latest code
- [ ] Foundry VTT v13 running
- [ ] Test world created
- [ ] API key configured
- [ ] At least one PDF uploaded as "Core Rules" category

### Integration Tests

#### Scenario 1: GM Present - Discrepancy Handling
1. [ ] Log in as GM
2. [ ] Upload a Core Rules PDF with rules content
3. [ ] Send a message that might trigger a rules check
4. [ ] Verify Claude detects discrepancy (if any exists)
5. [ ] Verify discrepancy format matches spec
6. [ ] Submit ruling as "persistent"
7. [ ] Open House Rules journal, verify ruling appears
8. [ ] Send another message - verify ruling is applied

#### Scenario 2: No GM - Fallback Behavior
1. [ ] Log in as player (non-GM)
2. [ ] Send message that might trigger rules check
3. [ ] Verify Claude follows Foundry rules with note
4. [ ] Verify no ruling prompt shown

#### Scenario 3: Solo Game
1. [ ] Log in as GM (only user)
2. [ ] Verify `getGameMode()` returns "solo"
3. [ ] Send message triggering rules check
4. [ ] Verify treated as GM present (ruling prompt shown)

#### Scenario 4: Session vs Persistent Rulings
1. [ ] Create session ruling
2. [ ] Verify it appears in rulings list
3. [ ] Restart server
4. [ ] Verify session ruling expired (or still valid if < 24 hours)
5. [ ] Create persistent ruling
6. [ ] Restart server
7. [ ] Verify persistent ruling still exists

#### Scenario 5: House Rules Journal Editing
1. [ ] Open House Rules journal
2. [ ] Edit a ruling in the journal
3. [ ] Close and reopen
4. [ ] Verify changes persisted
5. [ ] Check database reflects changes

#### Scenario 6: PDF Category Priority
1. [ ] Upload PDFs with different categories
2. [ ] Verify "Core Rules" PDF listed first in context
3. [ ] Verify priority order: Core > Rules Supplement > Adventure > Adventure Supplement > Reference

### Regression Tests

- [ ] Existing conversations still work
- [ ] Existing PDFs still work (legacy categories)
- [ ] Private GM chat still works
- [ ] Canon system still works
- [ ] Veto system still works
- [ ] Content Manager opens and displays PDFs
- [ ] Conversation Manager opens and works

---

## Localization Keys

### New Keys Added

**File:** `lang/en.json`

```
LOREMASTER.ContentManager.Category.CoreRules
LOREMASTER.ContentManager.Category.RulesSupplement
LOREMASTER.ContentManager.Category.AdventureSupplement

LOREMASTER.HouseRules.Title
LOREMASTER.HouseRules.JournalName
LOREMASTER.HouseRules.Empty
LOREMASTER.HouseRules.EmptyHint
LOREMASTER.HouseRules.SessionOnly
LOREMASTER.HouseRules.Persistent
LOREMASTER.HouseRules.RuleContext
LOREMASTER.HouseRules.PDFInterpretation
LOREMASTER.HouseRules.FoundryInterpretation
LOREMASTER.HouseRules.GMRuling
LOREMASTER.HouseRules.CreatedBy
LOREMASTER.HouseRules.CreatedAt
LOREMASTER.HouseRules.DiscrepancyDetected
LOREMASTER.HouseRules.ChooseInterpretation
LOREMASTER.HouseRules.OptionA
LOREMASTER.HouseRules.OptionB
LOREMASTER.HouseRules.RulingTypeQuestion
LOREMASTER.HouseRules.SubmitSuccess
LOREMASTER.HouseRules.SubmitError
LOREMASTER.HouseRules.DeleteSuccess
LOREMASTER.HouseRules.DeleteError
LOREMASTER.HouseRules.UpdateSuccess
LOREMASTER.HouseRules.UpdateError
LOREMASTER.HouseRules.SyncSuccess
LOREMASTER.HouseRules.SyncError
LOREMASTER.HouseRules.NoGMNote
```

---

## Files Changed Summary

### New Files
- `server/src/storage/house-rules-store.js`
- `scripts/house-rules-journal.mjs`
- `docs/RULES_DISCREPANCY_SPEC.md` (this document)

### Modified Files
- `server/src/storage/conversation-store.js` - Schema + migration
- `server/src/storage/pdf-registry.js` - Priority handling
- `server/src/services/pdf-processor.js` - Category constants
- `server/src/websocket/socket-handler.js` - Handlers + GM tracking
- `server/src/prompts/multiplayer-system.js` - Discrepancy prompt
- `scripts/loremaster.mjs` - House rules journal init + button
- `scripts/player-context.mjs` - GM presence detection
- `scripts/socket-client.mjs` - House rules methods
- `scripts/content-manager.mjs` - 5 categories
- `lang/en.json` - Localization strings

---

## Known Limitations

1. **Discrepancy Detection is AI-Dependent**: Claude must recognize when PDF rules differ from system behavior. This requires clear PDF content and appropriate game context.

2. **Journal Import is Additive**: Importing markdown creates new rules rather than updating existing ones. For sophisticated editing, use direct WebSocket API.

3. **Session Ruling Expiration**: Session rulings expire 24 hours after creation, not after session end (no reliable session end detection).

4. **No Conflict Resolution**: If multiple GMs make conflicting rulings, the most recent wins.

---

## Future Enhancements

- Proactive rules audit feature (premium)
- Conflict detection for house rules
- House rules versioning/history
- Export house rules to shareable format
- Import house rules from other campaigns
