# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Claude Context Bar (fork)** — a VS Code extension (`claude-context-bar-fork`, publisher `andremartins`) that shows real-time context-window usage for Claude Code sessions in the status bar.

Fork of [edenaion/claude-context-bar](https://github.com/edenaion/claude-context-bar). Fork-specific behavior:

- Shows only sessions whose cwd is inside the current window's workspace folders (`onlyCurrentWindow`, default `true`).
- Drops sessions whose Claude Code tab is no longer open, instead of waiting out `idleTimeout`.
- Labels each item with the session's own text (AI title / last prompt), not the project name.
- Hides scheduled/background runs (`showScheduledTasks`, default `false`).
- Configurable status bar item cap (`maxItems`, default `12`) instead of a silent hardcoded 5.
- Clicking an item reveals that session's tab.

## Remotes: everything goes to the fork

Issues, PRs, comments and releases go to `origin` = `AndreLFSMartins/claude-context-bar`. **Never** to `upstream` = `edenaion/claude-context-bar`, which is a third party's repo; nothing from this fork is offered back.

- `gh` resolves its default repo per clone. In a fork it often picks the upstream, so a bare `gh issue create` or `gh pr create` lands on edenaion. The default was set to the fork on 2026-10-04 (`gh repo set-default AndreLFSMartins/claude-context-bar`); check it with `gh repo set-default --view` before any `gh` write, and pass `--repo AndreLFSMartins/claude-context-bar` anyway.
- Issues were enabled on the fork on 2026-10-04 (`gh repo edit --enable-issues`). Before that they were disabled, GitHub's default for forks; the fix was never to file on upstream.
- `upstream` exists only to read its changes (`git fetch upstream`).

## Stack

- **Language:** TypeScript 5 (`strict: true`), target ES2020, `commonjs` modules
- **Runtime:** Node.js (VS Code extension host, engine `^1.74.0`)
- **Build:** `tsc` — `src/` → `out/`, entry point `out/extension.js`
- **Tests:** `node --test` (Node built-in test runner) over compiled `out/*.test.js`
- **Dependencies:** none at runtime besides the system `/usr/bin/sqlite3` binary (optional; without it the tab state is unknown); devDeps are `typescript`, `@types/node`, `@types/vscode`

## Commands

| Task | Command |
| --- | --- |
| Compile | `npm run compile` |
| Watch | `npm run watch` |
| Test (all) | `npm test` (compiles, then `node --test out/*.test.js`) |
| Test (one module) | `npm run compile && node --test out/tabLabel.test.js` |
| Test (one case) | `node --test --test-name-pattern "trailing ellipsis" out/openTabMatch.test.js` |
| Debug harness | `npm run compile && node out/debug.js` |
| Package `.vsix` | `npx @vscode/vsce package` |

`node --test` reads `out/`, never `src/` — compile first or you test the previous build.

**Caveats (verified 2026-09-18):**

- `npm run lint` is declared in `package.json` but **eslint is not installed** and there is no eslint config — the script fails. There is no working linter; rely on `tsc --strict` and review.
- `npm run package` / `npm run publish` call a bare `vsce`, which is not in `devDependencies`. Use `npx @vscode/vsce` instead.
- **This fork is not published anywhere, and the CI that would publish it does not work.** [.github/workflows/publish.yml](.github/workflows/publish.yml) fires on a `v*` tag and targets the VS Code Marketplace and Open VSX, but in this fork it has never run and its secrets are absent — `gh secret list` returns empty and `gh run list` returns none (verified 2026-09-18, with `ADMIN` permission, so the empty list is real and not a permissions artifact). Pushing a version tag starts a run that fails at the publish step. The tags present (`v1.4.0`…`v1.6.0`) were inherited from upstream and predate the fork's own versions.
- **Deploy = install the `.vsix` locally.** `npx @vscode/vsce package`, then `code --install-extension claude-context-bar-fork-<version>.vsix`, then reload the window. The extension is for André's machine only. Do not propose publishing without being asked; if it is ever wanted, `VSCE_PAT` and `OVSX_PAT` must be set first and the `andremartins` publisher must exist (unverified).

## Architecture

### Data source

There is no API. The extension reads Claude Code's own session files: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`, one JSONL line per event. Everything on the bar is derived from those files, the Claude Code extension's tab state, and `vscode.window.tabGroups`.

The tab state is the `Anthropic.claude-code` key of `ItemTable` in this window's `workspaceStorage/<hash>/state.vscdb` (the parent of `context.storageUri`). It is read with `/usr/bin/sqlite3 -readonly` (macOS only, 2 s timeout), and only its `panelTabSessions` array is used ([src/claudeTabState.ts](src/claudeTabState.ts)). It is private state of that extension: any failure yields `null` and the title heuristic takes over.

The JSONL fields consumed are **undocumented and reverse-engineered**: `entrypoint`, `cwd`, `{"type":"custom-title"}`, `{"type":"ai-title"}`, `{"type":"last-prompt"}`, `{"type":"bridge-session"}`, `message.usage.*`, `message.model`, `isMeta`. Parsing is per-line and tolerant — a line that fails to parse is skipped, never fatal. Before changing a reader, check a real `.jsonl` rather than the type definitions.

The same applies to [src/usage.ts](src/usage.ts), which reads the OAuth token from the Keychain and calls the undocumented `api.anthropic.com/api/oauth/usage`. It is opt-in (`showUsage`, default `false`) and degrades to `null` instead of throwing.

### The refresh pipeline

`refreshAllSessions()` in [src/extension.ts](src/extension.ts) runs on activation, on a timer (`refreshInterval`), on any `.jsonl` write (recursive `fs.watch`), on window focus, and on config change. It calls `findActiveSessions()`, which is the whole filtering chain:

1. **Directory scan** — skip `claude-plugins` / `claude-mem` dirs and `agent-*.jsonl` files.
2. **Workspace scope** — `belongsToWorkspace()` compares in *encoded* space ([src/sessionFilter.ts](src/sessionFilter.ts)); decoding a project dir is ambiguous, so it is never reversed for matching.
3. **Idle window** — keep only files whose mtime is inside `idleTimeout`.
4. **Per-file read** — `getLatestTokenCount()` scans backwards for the last `/clear`, then forwards from there, so a cleared session reports the post-clear state.
5. **Scheduled-task filter** — `isScheduledTask()` on the first message.
6. **Open-tab reconciliation** (only when `onlyCurrentWindow`) — a closed tab's file keeps a fresh mtime. When this window's Claude Code tab state is readable (`state.vscdb` beside `context.storageUri`, read only when its mtime changes, and watched as a refresh trigger), `keepOpenSessions()` drops every IDE session whose id is not in it ([src/claudeTabState.ts](src/claudeTabState.ts)) and the title heuristic does not run. Each open session is then read by id from any directory under `~/.claude/projects` ([src/openSessionFiles.ts](src/openSessionFiles.ts)), bypassing steps 2, 3 and 5, the `totalTokens > 0` filter, and the `wasCleared` and supersession drops of step 7; the scan skips IDE files, judged by the entrypoint in their first 64 KB. An open id with no file yet (a tab never used) still gets a bar item at 0% under its tab-state `title`, outside any project group; bar items are keyed by the full session id, so that item updates in place when the file appears. Otherwise (`null`, cause logged once), `filterToOpenTabs()` cross-checks against open tab titles ([src/openTabMatch.ts](src/openTabMatch.ts)). It judges IDE sessions only and gives a session one refresh of grace, carried across refreshes in the module-level `matchedOpenTabs`. It is a *text* heuristic, because session ids are private to the Claude Code extension; `detectionLooksReliable()` is the safety net that switches the whole step off rather than emptying the bar on a bad match.
7. **Grouping, supersession, numbering** — `groupAndNumberSessions()` ([src/sessionGroups.ts](src/sessionGroups.ts)). The group key is the project **path**, never the display name: two folders named `api` are two projects. Within a group, a session created after another's last update supersedes it; survivors get positional `-2` suffixes.
8. **Cap** — `maxItems`, logged to the console rather than dropped silently.

### Purity boundary

[src/extension.ts](src/extension.ts) (~1000 lines) is the only module that touches `vscode` and the filesystem. Every decision that can be a pure function already is one, with a colocated test and a header comment explaining the real-world behavior it encodes:

| Module | Decision |
| --- | --- |
| [contextLimit.ts](src/contextLimit.ts) | model ID → context window (defaults to 1M, 200K is the exception list) |
| [sessionFilter.ts](src/sessionFilter.ts) | path encoding, workspace scope, scheduled-task detection |
| [projectName.ts](src/projectName.ts) | real `cwd` → project name, encoded dir as fallback |
| [tabLabel.ts](src/tabLabel.ts) | custom title / AI title / prompt → item label |
| [claudeTabState.ts](src/claudeTabState.ts) | Claude Code tab state → open session ids; drops IDE sessions not in it |
| [openSessionFiles.ts](src/openSessionFiles.ts) | open session id → its `.jsonl` in any project dir (cached); the open sessions with no file yet; a file's entrypoint from its head |
| [openTabMatch.ts](src/openTabMatch.ts) | is this session's tab still open? matches the one title the tab shows (fallback when the tab state is unknown) |
| [sessionGroups.ts](src/sessionGroups.ts) | group by project path, supersession, `-2` numbering |
| [userPromptText.ts](src/userPromptText.ts) | recover the typed prompt from a message (bridged sessions) |
| [revealSession.ts](src/revealSession.ts) | what a click does, and its two guards |

**New logic goes in a new module with a test, not into `extension.ts`.**

[src/debug.ts](src/debug.ts) is a standalone diagnostic script, imported by nothing. It **duplicates** the detection logic on purpose, so it can be run outside the extension host. A change to detection does not automatically reach it.

### Private Claude Code API

Clicking an item runs `claude-vscode.primaryEditor.open`, a private command of the Claude Code extension. Two things are deliberate and documented in [src/revealSession.ts](src/revealSession.ts): the command's presence is re-checked on every click, and it is **not** `claude-vscode.editor.open` — that one writes `claudeCode.preferredLocation` to the user's global settings as a side effect. Do not "simplify" it back.

## Conventions

- 4-space indentation, double quotes in JSON config; TypeScript files follow the existing style in `src/`.
- Tests are colocated as `<module>.test.ts` and use `node:test` + `node:assert`.
- Each pure module opens with a block comment stating *why* the heuristic exists and what was verified to establish it, with dates. Keep that when editing.
- New user-facing settings go under `claudeContextBar.*` in `package.json` → `contributes.configuration`, with a `description` that states the default and any opt-in risk.
- Behavior changes get a `CHANGELOG.md` entry and a `package.json` version bump; the tag is what ships it.
- Specs and plans are GitHub issues on the fork, not files in the repo. See [Issue tracker](#issue-tracker).

## Agent skills

### Issue tracker

GitHub Issues on the fork `AndreLFSMartins/claude-context-bar`, via `gh` with an explicit `--repo`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
