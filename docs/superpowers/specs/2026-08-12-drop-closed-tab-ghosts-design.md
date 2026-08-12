# Drop status bar items for tabs that are already closed

**Date:** 2026-08-12
**Status:** approved

## Problem

A status bar item is only tied to a `.jsonl` session file, not to a real, currently-open
Claude Code tab. `findActiveSessions` treats any file modified within `idleTimeout`
(default 180s) as "active," with no check that its tab still exists.

When a tab is closed (or replaced by a new chat), its file keeps a recent `mtime` and the
item lingers for up to 3 minutes. Since [fd0d331](../../..) started labeling items with the
session's last prompt instead of the project name, that lingering item now shows a real,
recognizable piece of text — one of the user's own past messages — making it look like the
current tab's name when it belongs to a tab that's already gone. Verified in this
workspace: a closed tab's session file (`35f9dcdc…jsonl`, mtime 4 min old) was still inside
the 180s window, while the VS Code editor state (`state.vscdb`,
`memento/workbench.parts.editor`) showed only one `claudeVSCodePanel` tab open, titled from
a different, newer session (`4d71f31b…jsonl`).

The previous spec ([2026-08-09](2026-08-09-reveal-session-on-click-design.md)) explicitly
accepted this as a risk when it was just a stale click target. It stops being acceptable
now that the stale item's *label* reads as a real message.

## Goal

A session whose Claude Code tab has been closed drops out of the status bar promptly,
instead of waiting out `idleTimeout`.

## Non-goals

- **Sessions from other windows / CLI / SDK / Desktop.** `vscode.window.tabGroups` only
  sees tabs in the current window, so this only applies when `onlyCurrentWindow` is `true`
  (the default). When it's `false`, behavior is unchanged — matches the existing scoping
  semantics of that setting.
- **Replacing `idleTimeout`.** It stays as the fallback for everything this new check can't
  observe (other windows, and the "detection looks broken" escape hatch below).
- **A perfect open/closed signal.** There is no public API exposing session IDs for open
  Claude Code panels (`sessionPanels` is a private field of the extension). Matching is by
  tab title text, which is a best-effort heuristic, not an identity.

## Evidence

Read `extension.js` inside the installed Claude Code extension
(`anthropic.claude-code-2.1.228-darwin-arm64`):

```js
Pt.window.tabGroups.onDidChangeTabs((d) => {
  if (d.closed.some((f) =>
    !(f.input instanceof Pt.TabInputWebview && f.input.viewType.includes("claudeVSCodePanel"))
  )) ...
})
...
Pt.window.tabGroups.all.find((c) =>
  c.tabs.every((l) =>
    l.input instanceof Pt.TabInputWebview ? l.input.viewType.includes("claudeVSCodePanel") : false
  )
)
```

This is Claude Code detecting its own panels — confirms the exact `viewType` check to use.
Panel titles come from a `rename_tab` message driven by the last prompt (also read from the
bundle), and were confirmed in `state.vscdb` to match the `.jsonl`'s `last-prompt` entry,
truncated with a trailing `…`.

## Design

### `src/openTabMatch.ts` — new pure module

Follows the `tabLabel.ts` / `contextLimit.ts` pattern: no `vscode` import, testable under
`node --test`.

```ts
export function hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean

export function detectionLooksReliable(
    sessions: { lastPrompt: string; lastUpdated: Date }[],
    openTabTitles: string[]
): boolean
```

`hasMatchingOpenTab`: collapses `lastPrompt` the same way `buildItemLabel` does (whitespace
collapsed, trimmed — that helper moves to a shared `collapsePrompt` export in `tabLabel.ts`
so both modules use one implementation). Empty prompt → `true` (nothing to correlate yet,
never treat a fresh tab as closed). Otherwise, strips a trailing `…` off each open tab
title and checks a prefix match in either direction (title is a truncation of the prompt,
or — rare, short prompt — the whole prompt fit untruncated).

`detectionLooksReliable`: a safety net. The freshest session by `lastUpdated` is almost
certainly the tab the user is looking at right now — if it *also* doesn't match any open
tab, the `viewType` check itself is probably broken (Claude Code renamed it in a future
release), not reality. In that case the caller skips the new filter entirely for this
refresh and falls back to plain `idleTimeout`, rather than risking hiding every session
with a recorded prompt. Empty session list → `true` (nothing to protect against).

### `src/extension.ts`

- `getOpenClaudeTabTitles(): string[]` — reads `vscode.window.tabGroups.all`, keeps tabs
  where `tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('claudeVSCodePanel')`,
  returns their `tab.label`.
- In `findActiveSessions`, right after the `sessions` array is built and only when
  `onlyCurrentWindow` is `true`: compute `openTabTitles` once, and if
  `detectionLooksReliable(sessions, openTabTitles)`, drop any session where
  `!hasMatchingOpenTab(session.lastPrompt, openTabTitles)` before the project-grouping /
  supersession pass.

## Testing

`src/openTabMatch.test.ts`:

| Case | Expected |
|---|---|
| Tab title is the ellipsis-truncated prefix of `lastPrompt` | `true` |
| Tab title equals `lastPrompt` untruncated (short prompt, no `…`) | `true` |
| Tab title matches a different, unrelated prompt | `false` (unless another title in the list matches) |
| `lastPrompt` empty | `true` (can't correlate — don't claim closed) |
| `openTabTitles` empty, `lastPrompt` non-empty | `false` |
| `detectionLooksReliable`: freshest session matches an open title | `true` |
| `detectionLooksReliable`: freshest session's prompt matches nothing open | `false` |
| `detectionLooksReliable`: freshest session has empty `lastPrompt` | `true` (nothing to check yet, don't distrust) |
| `detectionLooksReliable`: empty session list | `true` |

**Manual gate (required, per the debugging skill — this class of bug only shows up live):**
in the Extension Development Host, open two Claude Code tabs for the same project, send a
message in each, close one, and confirm its status bar item disappears well inside
`idleTimeout` rather than lingering ~3 minutes.

## Risks

- Prefix-match is a heuristic, not an identity: two tabs whose prompts share a long common
  prefix could cross-match. Only used for inclusion (never for choosing which item shows
  which label), so a false match just means the filter under-corrects for one case, not
  that an item shows wrong content it wasn't already going to show.
- If Claude Code changes `viewType` in a future release, `detectionLooksReliable` should
  catch it (the freshest session stops matching) and the feature quietly no-ops back to
  `idleTimeout`-only. Not proven under a real future version — accepted, since the
  fallback direction is safe (worst case: today's existing behavior, not a new one).
