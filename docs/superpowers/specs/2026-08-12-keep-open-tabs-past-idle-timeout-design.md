# Keep genuinely open tabs visible past idleTimeout

**Date:** 2026-08-12
**Status:** superseded by the amendment at the end of this document — the Pass 2
mechanism described below was implemented, failed its manual gate three times, and was
reverted in favour of `idleTimeout: 0`. The Problem section still stands; the Design
section is kept as a record of what was tried and why it was abandoned.

## Problem

`idleTimeout` decides "active" purely from a `.jsonl` file's `mtime`, at the file-*listing*
step — `findActiveSessions` never even reads a file older than the cutoff. That was fine
before the open-tab-detection work landed (`2026-08-12-drop-closed-tab-ghosts-design.md`),
but now the extension has a way to know a tab is *genuinely still open*
(`vscode.window.tabGroups`) and still lets it vanish from the bar just because the user
hasn't sent a new message in a while. A tab you're still looking at disappearing reads as
broken, independent of whether its underlying file is "idle" by mtime.

## Goal

A tab confirmed open via `vscode.window.tabGroups` never disappears from the status bar
purely from elapsed time. Only `idleTimeout`-driven disappearance for tabs that are *not*
confirmed open is unaffected.

## Non-goals

- **Cross-window / `onlyCurrentWindow: false`.** Same restriction as the closed-tab fix —
  `tabGroups` only sees this window's tabs, so resurrection past `idleTimeout` only applies
  when `onlyCurrentWindow` is `true`.
- **A user-facing setting for the extra-scan bound.** The 20-file-per-project safety cap
  (see Design) is an implementation detail, not a behavior knob — no new
  `claudeContextBar.*` setting.
- **Unbounded history scans.** One project directory on this machine already holds 930
  `.jsonl` files; nothing here may read cost that scales with that number in the common
  case (no tab stuck idle).

## Design

### The insight: search is demand-driven, not size-driven

An initial version of this design considered flatly reading "the N most recent files per
project regardless of `idleTimeout`" — but N is either too small (misses a tab idle longer
than N other sessions' worth of activity) or too costly at scale (930-file project). The
fix: don't guess a file count — know exactly which open tabs need resolving, and stop
reading the moment they're found.

### `findActiveSessions` — two passes

**Pass 1 (unchanged).** For each project directory, list `.jsonl` files with
`mtime > cutoffTime` (today's `idleTimeout` cutoff), read them, build `SessionInfo[]` as
today. Every tab still being actively used lands here — this is the common case, and nothing
about its cost changes.

**Between passes.** Only when `onlyCurrentWindow` is `true`:

1. `openTabTitles = getOpenClaudeTabTitles()` (unchanged, from the closed-tab fix).
2. `reliable = detectionLooksReliable(sessions, openTabTitles)` (unchanged).
3. If `reliable`: find `unmatchedTitles` — open tab titles that don't correspond to *any*
   Pass 1 session. An empty list here (the overwhelmingly common case) means Pass 2 never
   runs at all.

**Pass 2 (new, conditional).** Only runs when `unmatchedTitles` is non-empty. For each
project directory, in `mtime`-descending order, read `.jsonl` files *older* than
`cutoffTime` one at a time — stopping as soon as `unmatchedTitles` is empty, or after 20
files for that project (`MAX_EXTRA_SCAN_PER_PROJECT`), whichever comes first. A file whose
`lastPrompt` matches one of `unmatchedTitles` becomes a session, unconditionally kept
(matching is why it was found), and its title is removed from `unmatchedTitles`.

### `src/openTabMatch.ts` — new pure primitive

```ts
export function matchingOpenTabTitle(lastPrompt: string, openTabTitles: string[]): string | undefined
```

Same prefix-match rule as `hasMatchingOpenTab`, but returns *which* title matched (or
`undefined`) instead of a boolean, and has **no vacuous pass for an empty prompt** — Pass 2
is specifically hunting for a positive, named correlation to a specific open tab; an old
session with no recorded prompt proves nothing and must not resurrect just because nothing
can be checked. `hasMatchingOpenTab` is refactored to call this (empty-prompt vacuous-pass
kept there, since that behavior is still correct for Pass 1's ghost-drop use).

### Final assembly

```
liveSessions = reliable
    ? pass1Sessions.filter(s => hasMatchingOpenTab(s.lastPrompt, openTabTitles))
    : pass1Sessions;   // unreliable: today's plain idleTimeout behavior, unchanged
liveSessions = [...liveSessions, ...pass2Sessions];   // pre-vetted by construction
```

`pass2Sessions` need no re-filtering: each one only exists because it already matched a
specific unmatched title.

## Testing

`src/openTabMatch.test.ts`, new cases for `matchingOpenTabTitle`:

| Case | Expected |
|---|---|
| Prompt's ellipsis-truncated prefix matches a title in the list | returns that title |
| No title matches | `undefined` |
| Empty prompt, non-empty title list | `undefined` (no vacuous pass here) |
| Two titles, prompt matches the second one | returns the second title, not the first |

`hasMatchingOpenTab`'s existing 8 cases must still pass unchanged after the refactor
(regression check that factoring out `matchingOpenTabTitle` didn't change its behavior).

**Manual gate (required):** in the Extension Development Host, temporarily set
`claudeContextBar.idleTimeout` to something small (e.g. `10`) in workspace settings, open a
tab, send a message, then leave it untouched past 10s. Confirm the item stays visible
(Pass 2 resurrecting it). Then close the tab and confirm it still disappears promptly
(regression check against the closed-tab fix). Restore `idleTimeout` afterward.

## Risks

- Pass 2 only runs when there's at least one unmatched open tab — zero extra file reads in
  the common case. Worst case (title never matches, e.g. a truncation-format change)
  reads up to 20 extra files per project per refresh cycle, not the full history.
- A tab idle long enough that more than 20 *other* sessions in the same project were
  touched afterward still falls back to disappearing at `idleTimeout` — same accepted
  trade-off as the flat-cap design this replaced, just at a higher and demand-scoped bound.
- Still bound by `onlyCurrentWindow: true` and `detectionLooksReliable` — unreliable
  detection skips both passes' special handling and falls back to plain `idleTimeout`.

## Amendment: Pass 2 reverted; `idleTimeout: 0` replaces it

Pass 2 was implemented and failed its manual gate three times, each failure landing in a
different place. Under the systematic-debugging rule that 3+ failed fixes indicate a wrong
architecture rather than three unlucky bugs, it was reverted.

**Root cause of the repeated failures: the matching key is not unique.** Sessions are
correlated to tabs by *title text*, and a tab's title is derived from the session's last
prompt. Verified on disk in the project used for the gate: six sessions, with `"teste"`
appearing as the last prompt of two different session files and `"oi"` of two others. A
non-unique key cannot reliably answer "which session is this tab?", and each fix — a
`detectionLooksReliable` rewrite, a supersession gate, then a bounded older-file scan —
moved the failure somewhere else rather than removing it.

The true identity does exist: the webview's serialized state carries
`{"sessionID":"<uuid>"}`. It is **not reachable at runtime** — `vscode.window.tabGroups`
exposes only `viewType` and `label` on `TabInputWebview`, and the Claude Code extension's
`sessionPanels` map (keyed by session id) is a private field. Verified by reading both the
API surface and the extension bundle. So title text is the only runtime signal available,
and no amount of extra machinery makes a non-unique key unique.

**What replaces it.** `claudeContextBar.idleTimeout: 0` — an already-supported value
meaning "never hide by time" — makes `cutoffTime` zero, so *every* session file in the
project enters the normal Pass 1 scan and the already-verified open-tab filter is the only
thing deciding what shows. That achieves this spec's Goal with no new mechanism:

- Tab open → its session is read (no cutoff to fall out of) → matches → shown.
- Tab closed → dropped by the closed-tab filter, exactly as before.

Two pieces of the Pass 2 work were kept because they are correct independent of it:

- `matchingOpenTabTitle` (`openTabMatch.ts`), now backing `hasMatchingOpenTab`.
- The `openTabsVerified` gate on the supersession heuristic. Supersession infers
  "abandoned" from creation-time ordering alone, which is wrong for several genuinely open
  tabs of one project — an older tab merely gone quiet is indistinguishable from an
  abandoned one by that rule. When open tabs are positively verified, that guess must not
  override the verified result. Confirmed live: without this, only the focused tab
  survived.

**Cost of `idleTimeout: 0`.** Every session file in the workspace's project directory is
parsed on each refresh instead of only recently-modified ones. Acceptable for normal
projects; one directory on this machine holds 930 `.jsonl` files, so if that workspace is
opened directly, an mtime-keyed parse cache is the follow-up — deliberately not built yet,
since no measurement shows it is needed.
