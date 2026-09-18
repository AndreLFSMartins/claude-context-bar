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

## Stack

- **Language:** TypeScript 5 (`strict: true`), target ES2020, `commonjs` modules
- **Runtime:** Node.js (VS Code extension host, engine `^1.74.0`)
- **Build:** `tsc` — `src/` → `out/`, entry point `out/extension.js`
- **Tests:** `node --test` (Node built-in test runner) over compiled `out/*.test.js`
- **Dependencies:** none at runtime; devDeps are `typescript`, `@types/node`, `@types/vscode`

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
- Publishing is done by CI, not by hand: a pushed `v*` tag triggers [.github/workflows/publish.yml](.github/workflows/publish.yml), which publishes to the VS Code Marketplace and to Open VSX.

## Architecture

### Data source

There is no API. The extension reads Claude Code's own session files: `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`, one JSONL line per event. Everything on the bar is derived from those files plus `vscode.window.tabGroups`.

The JSONL fields consumed are **undocumented and reverse-engineered**: `entrypoint`, `cwd`, `{"type":"custom-title"}`, `{"type":"ai-title"}`, `{"type":"last-prompt"}`, `{"type":"bridge-session"}`, `message.usage.*`, `message.model`, `isMeta`. Parsing is per-line and tolerant — a line that fails to parse is skipped, never fatal. Before changing a reader, check a real `.jsonl` rather than the type definitions.

The same applies to [src/usage.ts](src/usage.ts), which reads the OAuth token from the Keychain and calls the undocumented `api.anthropic.com/api/oauth/usage`. It is opt-in (`showUsage`, default `false`) and degrades to `null` instead of throwing.

### The refresh pipeline

`refreshAllSessions()` in [src/extension.ts](src/extension.ts) runs on activation, on a timer (`refreshInterval`), on any `.jsonl` write (recursive `fs.watch`), on window focus, and on config change. It calls `findActiveSessions()`, which is the whole filtering chain:

1. **Directory scan** — skip `claude-plugins` / `claude-mem` dirs and `agent-*.jsonl` files.
2. **Workspace scope** — `belongsToWorkspace()` compares in *encoded* space ([src/sessionFilter.ts](src/sessionFilter.ts)); decoding a project dir is ambiguous, so it is never reversed for matching.
3. **Idle window** — keep only files whose mtime is inside `idleTimeout`.
4. **Per-file read** — `getLatestTokenCount()` scans backwards for the last `/clear`, then forwards from there, so a cleared session reports the post-clear state.
5. **Scheduled-task filter** — `isScheduledTask()` on the first message.
6. **Open-tab reconciliation** — a closed tab's file keeps a fresh mtime, so `hasMatchingOpenTab()` cross-checks against open tab titles ([src/openTabMatch.ts](src/openTabMatch.ts)). It is a *text* heuristic, because session ids are private to the Claude Code extension; `detectionLooksReliable()` is the safety net that switches the whole step off rather than emptying the bar on a bad match.
7. **Supersession** — within a project, a session created after another's last update supersedes it.
8. **Numbering and cap** — positional `-2` suffixes, then `maxItems`, logged to the console rather than dropped silently.

### Purity boundary

[src/extension.ts](src/extension.ts) (~1000 lines) is the only module that touches `vscode` and the filesystem. Every decision that can be a pure function already is one, with a colocated test and a header comment explaining the real-world behavior it encodes:

| Module | Decision |
| --- | --- |
| [contextLimit.ts](src/contextLimit.ts) | model ID → context window (defaults to 1M, 200K is the exception list) |
| [sessionFilter.ts](src/sessionFilter.ts) | path encoding, workspace scope, scheduled-task detection |
| [projectName.ts](src/projectName.ts) | real `cwd` → project name, encoded dir as fallback |
| [tabLabel.ts](src/tabLabel.ts) | custom title / AI title / prompt → item label |
| [openTabMatch.ts](src/openTabMatch.ts) | is this session's tab still open? matches the one title the tab shows |
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
- Specs and plans live in `docs/superpowers/{specs,plans}/` as `YYYY-MM-DD-<slug>.md`, each with a generated `-design.html` / `.html` companion.
