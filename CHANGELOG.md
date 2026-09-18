# Changelog

All notable changes to the Claude Context Bar extension will be documented in this file.

## [1.8.3] - 2026-09-18

### Fixed
- **A renamed session now shows the name you gave it.** `/rename` writes
  `{"type":"custom-title"}` to the session's `.jsonl`, and the Claude Code tab retitles itself from
  it — verified in the Claude Code extension bundle 2.1.276: the webview renames the tab to the
  session's `summary`, which resolves as
  `customTitle || aiTitle || lastPrompt || summaryHint || firstPrompt`. The extension read only the
  last three, so a renamed session's item carried a stale AI title or prompt while its tab showed
  the new name. `buildItemLabel` and `hasMatchingOpenTab` now read `custom-title` first, in the
  tab's own order. Only the in-transcript line is read, not the
  `<sessionId>/custom-title.json` sidecar Claude Code falls back to (2 of 187 sessions on the
  development machine).

### Documentation
- The 1.7.0 entry described the click as delegating to `claude-vscode.editor.open`. It has
  delegated to `claude-vscode.primaryEditor.open` since 1.7.1, precisely because the other command
  writes `claudeCode.preferredLocation` into the user's global settings as a side effect. The entry
  now says so, so the side effect is not reintroduced by a reader following the CHANGELOG.

## [1.8.2] - 2026-08-15

### Fixed
- **Status bar items no longer read as an acronym of the path.** A session in
  `~/Documents/GitHub/Tools/ormah` showed up as `GHTO`: the project name was built by joining the
  last three segments of the *encoded* directory name (`GitHub-Tools-ormah`), which `compactMode`
  then acronymed. The encoding replaces every separator with a dash, so it cannot say which dashes
  are separators and which belong to the folder name — but every session line records the real
  `cwd`, so the project is now named after that folder (`ormah`), with the old decoding kept as the
  fallback. The tooltip's path comes from the same `cwd` and is likewise exact for folders whose
  name contains a dash.
- **Bridged sessions get a real label instead of the project name.** Sessions opened through the
  claude.ai bridge (`{"type":"bridge-session"}`) write ordinary messages but never emit the
  `{"type":"last-prompt"}` or `{"type":"ai-title"}` lines the item labels itself with, so they fell
  all the way back to the project name. The latest prompt is now recovered from the messages
  themselves when neither line exists, ignoring what the user did not type: slash commands,
  skill/hook injections (`isMeta`), subagent messages (`isSidechain`), interruption markers, task
  notifications, and system reminders. Sessions that do emit those lines are unaffected, and the
  recovered text is deliberately not used for closed-tab matching, which still relies only on the
  texts the tab actually titles itself with.

## [1.8.1] - 2026-08-14

### Fixed
- **Status bar items follow the tab's AI-generated session title.** Claude Code (since ~2026-08-09)
  retitles its tab with an AI-generated session title, written to the session `.jsonl` as
  `{"type":"ai-title"}` — verified in VS Code's persisted editor layout
  (`"providedId":"claudeVSCodePanel","title":"Investigar mudança de no…"`). The item label and the
  closed-tab ghost filter both assumed the tab title was always the latest prompt, so the bar
  diverged from the tab once the title was generated, and an ai-titled session could be wrongly
  filtered out as a closed tab. The label now prefers the AI title (falling back to the prompt,
  then the project name), and tab matching accepts either text.

## [Fork] - 2026-08-09

Forked from [edenaion/claude-context-bar](https://github.com/edenaion/claude-context-bar) at 1.6.0.
Published under a different extension identity (`andremartins.claude-context-bar-fork`) so the
VS Code marketplace auto-update cannot overwrite these changes.

### Changed
- **Clicking a status bar item now opens that session's Claude Code tab** instead of hiding the
  item. It delegates to the Claude Code extension's private
  `claude-vscode.primaryEditor.open` command, which reveals the webview panel matching the session
  id. It is deliberately *not* `claude-vscode.editor.open`: that one writes
  `claudeCode.preferredLocation` into the user's global settings as a side effect. Two guards keep
  it safe: the session's
  `entrypoint` must be `claude-vscode` (terminal, SDK, and Claude Desktop sessions have no tab, and
  calling the command with an id the extension does not know would create an unwanted tab), and the
  command must actually be registered. Either guard failing shows a message and opens nothing.
  Cross-window jumps are out of scope: VS Code exposes no API to focus another window.
- Manual click-to-hide is removed, along with its auto-unhide-on-new-activity behaviour. Automatic
  hiding of idle sessions via `idleTimeout` is unchanged.

- **Status bar items are named after the Claude Code tab, not the project.** Each item now shows the
  first `tabNameLength` characters (default 6) of the tab's own name. The Claude Code tab titles
  itself with your latest prompt — verified in VS Code's persisted editor layout
  (`"providedId":"claudeVSCodePanel","title":"leia o /private/tmp/clau…"`) — and the same text is in
  the session file as `{"type":"last-prompt"}`. The project name could never tell two tabs of one
  project apart: its `-2` suffix is positional, assigned by creation order among the *active*
  sessions, so it slides onto a different session as soon as an older one drops off the bar. Colors
  and emoji stay tied to the project, and sessions recording no prompt fall back to the project
  name. Set `tabNameLength` to `0` for the old behaviour.

### Known limitation
- **Right after a window reload, clicking an item for a tab you have not visited yet opens a
  duplicate tab instead of revealing the existing one.** VS Code restores webview panels lazily, and
  the Claude Code extension's `deserializeWebviewPanel` restores a panel without its session id, so
  the session is absent from its internal map until that tab first becomes visible. The reveal
  command is fail-open: an unknown id creates a new panel, which then renders the same conversation.
  Visiting the tab once repairs the mapping permanently. Nothing on this side can distinguish
  "restored but not yet loaded" from "closed, so opening is correct" — the fix belongs upstream.

### Added
- `onlyCurrentWindow` (default `true`) — show only sessions whose working directory sits inside
  this window's workspace folders. Comparison happens in Claude's encoded path space, requiring an
  exact match or a following dash so a sibling directory cannot match by string prefix. A window
  with no folder open still shows everything.
- `showScheduledTasks` (default `false`) — hide sessions whose first message is a
  `<scheduled-task>` block. They are real sessions but not tabs, and each one took a status bar slot.
- `maxItems` (default `12`, `0` for unlimited) — replaces the hardcoded 5-item cap. When the cap
  does truncate, it logs a warning to the extension host output instead of dropping sessions
  silently. The old behaviour could hide a tab sitting at 80% context with no trace.
- `src/sessionFilter.ts` with 16 unit tests, following the pure-function pattern of `contextLimit.ts`.

## [1.6.0] - 2026-07-24

### Added
- **Subscription usage monitor** (opt-in, off by default) — shows your Claude `/usage` Session (5-hour) limit as a separate status bar item (e.g. `✴️ 7%`) to the right of the context items.
  - Usage percentage has its own warning/danger colors, independent of the context colors, via `usageWarningThreshold` (default 50) and `usageDangerThreshold` (default 75).
  - Hover tooltip shows all subscription limits — Session (5h), Weekly (all models), and any scoped weekly limits (e.g. Weekly Fable) — with reset times.
  - Data comes from the authenticated `GET /api/oauth/usage` endpoint, using the OAuth token from the OS credential store (macOS Keychain or `~/.claude/.credentials.json`), exactly as Claude Code does. The token is only used as a request header and is never logged.
  - Refreshes on its own cadence (`usageRefreshInterval`, default 60s), keeps the last known value on transient failures.
  - Enable with the `showUsage` setting (default off). Automatically hides when not signed in with a subscription (e.g. API-key auth).
  - Note: `/api/oauth/usage` is an undocumented endpoint reverse-engineered from Claude Code; treat this feature as a temporary bonus that may stop working at any time. The parser is defensive (two schema paths, tolerant field reading) and degrades to hiding the item rather than erroring.
- Unit tests for the usage response parser (`parseUsage`), covering the canonical `limits` array and the flat-meter fallback.

## [1.5.1] - 2026-07-22

### Changed
☼ `idleTimeout` no longer capped at 600 seconds: any value up to 9999999 is accepted, and `0` disables the timeout entirely so idle sessions never hide (#7)

### Added
☼ Sessions rescan when the VS Code window regains focus, so a resumed session's bar returns as soon as it has fresh activity instead of waiting for the next poll (#6)

## [1.5.0] - 2026-07-06

### Changed
☼ **Context limit auto-detection rewritten** to default to 1M and list the 200K exceptions, instead of the old `sonnet` + `1m` heuristic that missed nearly every model.

  ☼ **1M by default**: every current Claude model (Opus 4.6+, Sonnet 4.6+, Sonnet 5, Fable 5, and anything newer) resolves to 1,000,000 tokens. New models are detected automatically with no extension update.
  
  ☼ **200K exceptions**: Haiku (all versions) and legacy generations (Claude 3.x, Sonnet 4.5 and earlier, Opus 4.5 and earlier) resolve to 200,000.
  
  ☼ **Fallback**: unknown or non-Claude Model IDs use the `contextLimit` setting (default 200,000).
  
☼ Extracted the resolution into a pure `getContextLimitForModel` function.

### Added
☼ `claudeContextBar.modelContextLimits` setting: per-model overrides (object, default `{}`). Exact Model ID match, highest priority. No model is force-capped.

☼ Unit test suite (25 tests) run with Node's built-in test runner (`npm test`, no extra dependencies).

## [1.4.1] - 2025-12-29

### Fixed
- Added compact mode documentation to README

## [1.4.0] - 2025-12-29

### Added
- **Compact Mode**: Shorten project names to save status bar space
  - Multi-word names become acronyms (my-cool-project → MCP)
  - Single words become abbreviated (typescript → Tscript)
  - Names 5 characters or less stay unchanged
  - Session numbers preserved (MCP-2, MCP-3)
- **Custom Short Names**: Define your own abbreviations via `shortNames` setting
- **Instant Settings Refresh**: All settings now apply immediately without waiting for next refresh cycle

## [1.3.0] - 2025-12-24

### Added
- **Click to Hide**: Click any status bar item to temporarily hide it
  - Hidden sessions automatically reappear when there's new activity
  - Great for dismissing stale sessions you're not actively using
- **Configurable Idle Timeout**: New `idleTimeout` setting (default: 180 seconds / 3 minutes)
  - Sessions inactive longer than this are automatically hidden
  - Reduced from previous hardcoded 5 minutes
  - Range: 10-600 seconds

### Fixed
- **Project Name Display**: Fixed deeply nested paths showing full folder chain
  - Now correctly shows last 3 path segments (e.g., "claude-context-bar" instead of "Tools-extensions-vscode-claude-context-bar")

## [1.2.2] - 2025-12-23

### Fixed
- Documentation updates

## [1.2.1] - 2025-12-23

### Fixed
- **Project Name Display**: Fixed issue where parent folder (e.g., "dev") was incorrectly included in project names
  - Now correctly shows "my-project" instead of "dev-my-project"
- **Tooltip Cleanup**: Removed confusing "New Input" row (always showed ~8 tokens)

## [1.2.0] - 2025-12-22

### Added
- **Smart Session Detection**: Automatically detects and hides "ghost" sessions
  - Sessions are hidden immediately when superseded by a newer session
  - Properly handles `/clear` command scenarios
  - No more lingering status bar items from closed tabs
- **First Message in Tooltip**: Shows the first message of each session to help identify which Claude Code tab it corresponds to

### Fixed
- Ghost sessions no longer appear after running `/clear` and continuing work
- Improved session lifecycle tracking using creation timestamps

## [1.1.3] - 2025-12-22

### Added
- **Fuzzy Emoji Matching**: Icons automatically match project type based on name keywords
  - Music projects (🎵), games (🎮), web (🌐), mobile (📱), AI (🤖), and more
- `showEmoji` setting to toggle emoji display on/off (default: on)

## [1.1.2] - 2025-12-22

### Added
- Now available on [Open VSX Registry](https://open-vsx.org/extension/ezoosk/claude-context-bar) for Antigravity, VSCodium, and other VS Code forks
- Automated dual-publishing to both VS Code Marketplace and Open VSX

## [1.1.0] - 2025-12-22

### Added
- **Auto Color Mode**: Pastel color palette assigns different colors to each project automatically
- **Base Color Selection**: When auto-color is off, choose a base color with subtle variations per project
- **Auto Context Limit Detection**: Automatically detects model (Sonnet 4.5 1M vs others) and adjusts context limit
- Model name now displayed in tooltip

### Changed
- Color palette changed to softer pastel colors for better readability

## [1.0.0] - 2025-12-22

### Added
- Real-time context window usage monitoring for Claude Code sessions
- Status bar indicators for each active Claude Code tab
- Color-coded warnings: yellow at 50%, red at 75%
- Detailed tooltip with token breakdown (cache read, cache creation, new input)
- Configurable context limit, thresholds, and refresh interval
- Auto-refresh on file changes and periodic polling
- Automatic cleanup of stale sessions (5-minute timeout)
- Excludes Claude Memory background processes from display
