# Patreon Login UI Plan

Created: 2026-01-17
Status: Planning

## Overview

Add a user-friendly Patreon OAuth login flow to the Foundry module for hosted mode users. Currently, the module throws `PATREON_AUTH_REQUIRED` but doesn't provide a way for users to authenticate.

## Goals

- [ ] Users can sign in with Patreon from within Foundry
- [ ] Session tokens persist across browser sessions
- [ ] Users see their login status (name, tier, quota)
- [ ] Users can sign out and re-authenticate
- [ ] Clear error messages when auth fails

## Current State

**Existing infrastructure in `config.mjs`:**
- `isHostedMode()` - checks if hosted mode selected
- `getSessionToken()` / `setSessionToken()` / `clearSessionToken()`
- `getPatreonUser()` / `setPatreonUser()` / `clearPatreonUser()`
- Settings: `sessionToken` (hidden), `patreonUser` (hidden)

**Current flow (broken):**
1. Module starts → `initializeLoremaster()`
2. `socketClient.authenticate()` called
3. No session token → throws `PATREON_AUTH_REQUIRED`
4. Error caught → notification shown → module fails to start

**Proxy OAuth endpoints:**
- `GET /auth/patreon` - Initiates OAuth flow
- `GET /auth/patreon/callback` - Handles OAuth callback, returns session token via postMessage
- `GET /auth/status` - Check current session status
- `POST /auth/logout` - Invalidate session

## Tasks

### Phase 1: Create Patreon Auth Module

**File: `scripts/patreon-auth.mjs`**

- [ ] P1: Create `PatreonAuthManager` class
  - Constructor takes proxy URL
  - `startOAuthFlow()` - Opens popup to `/auth/patreon`
  - `handleOAuthCallback(data)` - Processes postMessage result
  - `checkAuthStatus()` - Calls `/auth/status` endpoint
  - `logout()` - Calls `/auth/logout` and clears local tokens
  - `isAuthenticated()` - Quick check for valid session
  - `getUserInfo()` - Returns cached Patreon user data

- [ ] P1: Add postMessage listener for OAuth callback
  - Listen for `loremaster_oauth_callback` message type
  - Validate origin (must be proxy URL)
  - Extract session token and user info
  - Store in Foundry settings
  - Emit event for UI to update

### Phase 2: Create Login UI Component

**File: `scripts/patreon-login-ui.mjs`**

- [ ] P1: Create `PatreonLoginUI` class (extends Application)
  - Shows different states: logged-out, logging-in, logged-in, error
  - Logged-out: "Sign in with Patreon" button
  - Logging-in: Spinner + "Waiting for authorization..."
  - Logged-in: User name, tier badge, quota bar, "Sign out" button
  - Error: Error message + "Try again" button

- [ ] P2: Add status header bar component
  - Small bar showing connection status in Foundry UI
  - Green: Connected (shows tier)
  - Yellow: Connecting...
  - Red: Not authenticated (click to login)

### Phase 3: Integrate with Module Initialization

**File: `scripts/loremaster.mjs`**

- [ ] P1: Handle `PATREON_AUTH_REQUIRED` error gracefully
  - Catch the specific error
  - Show PatreonLoginUI instead of failing
  - After successful auth, retry initialization

- [ ] P1: Add pre-flight auth check on module ready
  - If hosted mode + no session token → show login UI immediately
  - If hosted mode + has session token → validate with `/auth/status`
  - If token expired → clear and show login UI

- [ ] P2: Add auto-reconnect after successful login
  - Listen for auth success event
  - Re-run `initializeLoremaster()` automatically

### Phase 4: Settings Integration

**File: `scripts/config.mjs`**

- [ ] P2: Add custom settings UI for hosted mode
  - Hide API key / license key fields in hosted mode
  - Show Patreon login button instead
  - Show current auth status

- [ ] P3: Add "Account" button to scene controls
  - Opens PatreonLoginUI dialog
  - Shows quota usage, tier info
  - Allows sign out

## Technical Decisions

### OAuth Flow
- Use popup window (not redirect) to keep Foundry running
- Popup opens to `{proxyUrl}/auth/patreon`
- Callback page sends token via `window.opener.postMessage()`
- If popup blocked, fall back to new tab with manual token copy

### Token Storage
- Session token stored in Foundry world settings (persists per world)
- Token is NOT encrypted client-side (Foundry settings are per-user)
- Token has 24-hour expiry (server-side)
- Auto-refresh handled by proxy on API calls

### Security Considerations
- Validate postMessage origin matches proxy URL
- Clear tokens on logout
- Don't log tokens to console
- Handle token expiry gracefully

## UI Mockups

### Login Dialog (Logged Out)
```
┌─────────────────────────────────────┐
│  🔐 Loremaster - Sign In            │
├─────────────────────────────────────┤
│                                     │
│  Connect your Patreon account to    │
│  use the hosted Loremaster service. │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🅿️ Sign in with Patreon    │    │
│  └─────────────────────────────┘    │
│                                     │
│  Don't have a subscription?         │
│  → Subscribe on Patreon             │
│                                     │
└─────────────────────────────────────┘
```

### Login Dialog (Logged In)
```
┌─────────────────────────────────────┐
│  ✅ Loremaster - Connected          │
├─────────────────────────────────────┤
│                                     │
│  Signed in as: DJ Chan              │
│  Tier: ⭐ Premium                    │
│                                     │
│  Monthly Usage                      │
│  ████████░░░░░░░░░░░░ 2.1M / 5M     │
│  (42% used)                         │
│                                     │
│  ┌──────────┐  ┌──────────────┐     │
│  │ Sign Out │  │    Close     │     │
│  └──────────┘  └──────────────┘     │
│                                     │
└─────────────────────────────────────┘
```

## Open Questions

1. Should we support multiple Foundry worlds with one Patreon account?
   - Currently: token stored per-world
   - Alternative: Store in client settings (shared across worlds)

2. What happens if user is mid-session and token expires?
   - Option A: Show re-auth dialog, pause operations
   - Option B: Auto-refresh in background (requires refresh token)

3. Should we show login prompt on every page load or just once?
   - Recommendation: Once per session, with status indicator

## Dependencies

- Proxy must be accessible at configured URL
- Patreon OAuth app must be configured on proxy
- Foundry must allow popups (or handle blocked popup gracefully)

## Testing Plan

1. Fresh install → shows login prompt
2. Login flow → popup opens, auth completes, token saved
3. Reload Foundry → auto-connects with saved token
4. Expired token → shows re-auth prompt
5. Sign out → clears token, shows login prompt
6. Popup blocked → shows fallback instructions
7. Network error → shows retry option

## Notes

- The proxy callback already stores token in browser localStorage as backup
- Consider reading from localStorage if Foundry settings are empty
- The postMessage includes full user info (id, name, email, tier, status)
