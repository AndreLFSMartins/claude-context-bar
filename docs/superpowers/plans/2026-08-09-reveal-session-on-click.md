# Click to Open Claude Code Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a status bar item reveals that session's Claude Code tab in the current window, and the manual hide feature is removed.

**Architecture:** A new pure module decides what a click should do (`reveal` or `notice`) from the session's `entrypoint` and whether the Claude extension's private command exists. `extension.ts` captures `entrypoint` and the full session UUID while parsing the `.jsonl`, registers `claudeContextBar.revealSession`, and drops everything belonging to `claudeContextBar.hideSession`.

**Tech Stack:** TypeScript, VS Code extension API, `node:test` (no test framework dependency).

**Spec:** `docs/superpowers/specs/2026-08-09-reveal-session-on-click-design.md`

## Global Constraints

- Branch: `feat/reveal-session-on-click`. Do not commit to `main`.
- Test command is `npm test` — it runs `tsc -p ./` then `node --test out/*.test.js`. There is no watch/partial runner; every verification step runs the whole thing.
- Test files live beside their source as `src/<name>.test.ts` and import with a relative path and no extension (`from './revealSession'`), matching `sessionFilter.test.ts`.
- New pure modules must not `import * as vscode` — that is what keeps them runnable under plain node.
- The private command id is `claude-vscode.editor.open`. Never call it without first checking it exists.
- The IDE entrypoint value is the exact string `claude-vscode`.
- Comments and identifiers in English, matching the existing files.

---

### Task 1: Pure click-decision module

**Files:**
- Create: `src/revealSession.ts`
- Test: `src/revealSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const CLAUDE_IDE_ENTRYPOINT = 'claude-vscode'`
  - `export const CLAUDE_REVEAL_COMMAND = 'claude-vscode.editor.open'`
  - `export type ClickAction = { kind: 'reveal'; sessionId: string } | { kind: 'notice'; message: string }`
  - `export function resolveClickAction(session: { sessionId: string; entrypoint: string }, claudeCommandAvailable: boolean): ClickAction`

- [ ] **Step 1: Write the failing test**

Create `src/revealSession.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveClickAction, CLAUDE_IDE_ENTRYPOINT, CLAUDE_REVEAL_COMMAND } from './revealSession';

describe('resolveClickAction', () => {
    test('reveals the tab for an IDE session when the Claude command exists', () => {
        const action = resolveClickAction(
            { sessionId: '35f9dcdc-084f-4846-9b21-198e1711a3d7', entrypoint: CLAUDE_IDE_ENTRYPOINT },
            true
        );
        assert.deepStrictEqual(action, {
            kind: 'reveal',
            sessionId: '35f9dcdc-084f-4846-9b21-198e1711a3d7'
        });
    });

    test('refuses a terminal session: there is no tab to reveal', () => {
        // Calling the command with an id the Claude extension does not know
        // creates a brand new tab, so origins other than the IDE never reach it.
        const action = resolveClickAction({ sessionId: 'abc', entrypoint: 'cli' }, true);
        assert.strictEqual(action.kind, 'notice');
        assert.match((action as { message: string }).message, /cli/);
    });

    test('refuses an SDK session', () => {
        const action = resolveClickAction({ sessionId: 'abc', entrypoint: 'sdk-cli' }, true);
        assert.strictEqual(action.kind, 'notice');
    });

    test('refuses a Claude Desktop session', () => {
        const action = resolveClickAction({ sessionId: 'abc', entrypoint: 'claude-desktop' }, true);
        assert.strictEqual(action.kind, 'notice');
    });

    test('refuses a session with no recorded entrypoint, failing closed', () => {
        // Older session files carry no entrypoint. Unknown origin must never
        // reach the command, or a click spawns a surprise tab.
        const action = resolveClickAction({ sessionId: 'abc', entrypoint: '' }, true);
        assert.strictEqual(action.kind, 'notice');
        assert.match((action as { message: string }).message, /unknown/);
    });

    test('reports the missing extension when the Claude command is absent', () => {
        const action = resolveClickAction(
            { sessionId: 'abc', entrypoint: CLAUDE_IDE_ENTRYPOINT },
            false
        );
        assert.strictEqual(action.kind, 'notice');
        assert.match((action as { message: string }).message, /Claude Code extension/);
    });

    test('reports the origin, not the extension, when both checks fail', () => {
        const action = resolveClickAction({ sessionId: 'abc', entrypoint: 'cli' }, false);
        assert.strictEqual(action.kind, 'notice');
        assert.match((action as { message: string }).message, /cli/);
    });
});

describe('exported constants', () => {
    test('names the private Claude Code command exactly', () => {
        assert.strictEqual(CLAUDE_REVEAL_COMMAND, 'claude-vscode.editor.open');
    });

    test('names the IDE entrypoint value exactly', () => {
        assert.strictEqual(CLAUDE_IDE_ENTRYPOINT, 'claude-vscode');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL at compile time — `tsc` errors with `Cannot find module './revealSession'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/revealSession.ts`:

```ts
/**
 * Pure decision for what clicking a status bar item should do.
 *
 * The Claude Code extension keys its open webview panels by session id and
 * exposes `claude-vscode.editor.open`, which reveals the panel for an id it
 * knows. That command is private, undocumented API, and when it does NOT
 * recognise the id it creates a brand new tab instead of revealing one. Both
 * facts are why the decision lives here, behind two guards, rather than being
 * a bare `executeCommand` at the click site.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as `getContextLimitForModel` in contextLimit.ts.
 */

/** `entrypoint` value written by Claude Code sessions running as a VS Code tab. */
export const CLAUDE_IDE_ENTRYPOINT = 'claude-vscode';

/** Private command of the Claude Code extension that reveals a session's panel. */
export const CLAUDE_REVEAL_COMMAND = 'claude-vscode.editor.open';

export type ClickAction =
    | { kind: 'reveal'; sessionId: string }
    | { kind: 'notice'; message: string };

/**
 * @param session                 Full (untruncated) session id plus the origin
 *                                recorded in the session's `.jsonl`.
 * @param claudeCommandAvailable  Whether CLAUDE_REVEAL_COMMAND is registered.
 *
 * Origin is checked first: when both guards fail, the origin is the more
 * specific explanation. An empty entrypoint fails closed — older session files
 * do not record one, and guessing would risk opening an unwanted tab.
 */
export function resolveClickAction(
    session: { sessionId: string; entrypoint: string },
    claudeCommandAvailable: boolean
): ClickAction {
    if (session.entrypoint !== CLAUDE_IDE_ENTRYPOINT) {
        const origin = session.entrypoint || 'unknown';
        return {
            kind: 'notice',
            message: `This session has no Claude Code tab in this window to open (origin: ${origin}).`
        };
    }

    if (!claudeCommandAvailable) {
        return {
            kind: 'notice',
            message: 'The Claude Code extension for VS Code was not found, so its tab cannot be opened.'
        };
    }

    return { kind: 'reveal', sessionId: session.sessionId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 9 new tests pass alongside the existing `contextLimit`, `sessionFilter`, and `usage` suites.

- [ ] **Step 5: Commit**

```bash
git add src/revealSession.ts src/revealSession.test.ts
git commit -m "feat: add pure click-action resolver for status bar items"
```

---

### Task 2: Wire the click to the Claude Code tab and remove hiding

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `resolveClickAction`, `CLAUDE_REVEAL_COMMAND` from Task 1.
- Produces: command `claudeContextBar.revealSession`, invoked with `(fullSessionId: string, entrypoint: string)`. `SessionInfo` gains `fullSessionId: string` and `entrypoint: string`; `TokenUsage` gains `entrypoint: string`.

**Why `fullSessionId`:** `SessionInfo.sessionId` is truncated to 8 characters for the tooltip (`file.name.replace('.jsonl', '').substring(0, 8)`). The command needs the full UUID, so the untruncated stem is carried separately and the truncated one is left alone.

- [ ] **Step 1: Import the new module**

In `src/extension.ts`, after the `sessionFilter` import (line 8):

```ts
import { encodeProjectPath, belongsToWorkspace, isScheduledTask } from './sessionFilter';
import { resolveClickAction, CLAUDE_REVEAL_COMMAND } from './revealSession';
```

- [ ] **Step 2: Add the new fields to both interfaces**

In `interface SessionInfo` (line 10), after `sessionId`:

```ts
    sessionId: string;
    fullSessionId: string;
    entrypoint: string;
```

In `interface TokenUsage` (line 196), after `wasCleared`:

```ts
    wasCleared: boolean;  // True if session ended with /clear command
    entrypoint: string;   // 'claude-vscode' | 'cli' | 'sdk-cli' | 'claude-desktop' | ''
}
```

- [ ] **Step 3: Delete the hidden-sessions state**

Remove these two lines (34-35) entirely:

```ts
// Track manually hidden sessions: sessionFile -> timestamp when hidden
const hiddenSessions: Map<string, number> = new Map();
```

- [ ] **Step 4: Replace the hide command with the reveal command**

Replace the whole block at lines 51-57:

```ts
    // Register command to hide a session (triggered by clicking status bar item)
    const hideCommand = vscode.commands.registerCommand('claudeContextBar.hideSession', (sessionFile: string) => {
        hiddenSessions.set(sessionFile, Date.now());
        // Immediately refresh to hide the item
        refreshAllSessions();
    });
    context.subscriptions.push(hideCommand);
```

with:

```ts
    // Clicking a status bar item opens that session's Claude Code tab in this window.
    // The command it delegates to is private API of the Claude Code extension, so its
    // presence is checked every time and a missing command degrades to a message.
    const revealCommand = vscode.commands.registerCommand(
        'claudeContextBar.revealSession',
        async (fullSessionId: string, entrypoint: string) => {
            const available = (await vscode.commands.getCommands(true)).includes(CLAUDE_REVEAL_COMMAND);
            const action = resolveClickAction({ sessionId: fullSessionId, entrypoint }, available);

            if (action.kind === 'reveal') {
                await vscode.commands.executeCommand(CLAUDE_REVEAL_COMMAND, action.sessionId);
            } else {
                vscode.window.showInformationMessage(action.message);
            }
        }
    );
    context.subscriptions.push(revealCommand);
```

- [ ] **Step 5: Capture `entrypoint` while parsing the session file**

In `getLatestTokenCount`, add the accumulator next to the others (line 370):

```ts
            let model = '';
            let entrypoint = '';
```

Inside the forward pass, right after the `entry.timestamp` block (line 383), add:

```ts
                    // Session origin. Present on nearly every user/assistant/attachment
                    // line, so the pass that starts after the last /clear still sees it.
                    if (!entrypoint && typeof entry.entrypoint === 'string') {
                        entrypoint = entry.entrypoint;
                    }
```

- [ ] **Step 6: Return `entrypoint` from all three exit points**

The success `resolve` (line 417) gains one field:

```ts
                sessionCreated,
                wasCleared,
                entrypoint
            });
```

Both failure `resolve` calls — the empty-file guard (line 323) and the `catch` (line 429) — gain `entrypoint: ''`:

```ts
                resolve({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, model: '', firstMessage: '', sessionCreated: null, wasCleared: false, entrypoint: '' });
```

- [ ] **Step 7: Populate the new fields when building each session**

In `findActiveSessions`, at the `sessionId` extraction (line 499-500):

```ts
                    // Extract short session ID from filename (display only — the
                    // Claude Code command needs the full id, kept separately)
                    const fullSessionId = file.name.replace('.jsonl', '');
                    const sessionId = fullSessionId.substring(0, 8);
```

and in the `sessions.push({ … })` object, after `sessionId`:

```ts
                        sessionId,
                        fullSessionId,
                        entrypoint: usage.entrypoint,
```

- [ ] **Step 8: Delete the hidden-session filter**

Replace lines 605-618:

```ts
    // Filter out manually hidden sessions, but auto-unhide if there's new activity
    const visibleSessions = finalSessions.filter(session => {
        const hiddenAt = hiddenSessions.get(session.sessionFile);
        if (hiddenAt) {
            // Check if session was modified after it was hidden
            if (session.lastUpdated.getTime() > hiddenAt) {
                // New activity! Remove from hidden list
                hiddenSessions.delete(session.sessionFile);
                return true; // Show it
            }
            return false; // Still hidden
        }
        return true; // Not hidden
    });
```

with nothing, then repoint the three remaining `visibleSessions` references (lines 624, 626, 629, 631) at `finalSessions`:

```ts
    const maxItems = config.get<number>('maxItems', 12);
    if (maxItems > 0 && finalSessions.length > maxItems) {
        console.warn(
            `Claude Context Bar: showing ${maxItems} of ${finalSessions.length} active sessions ` +
            `(raise claudeContextBar.maxItems to see the rest)`
        );
        return finalSessions.slice(0, maxItems);
    }
    return finalSessions;
```

- [ ] **Step 9: Update the tooltip footer and the item command**

In the tooltip `MarkdownString` (line 758), replace the last line:

```ts
            `*Click to hide*`
```

with:

```ts
            `*Click to open this tab*`
```

Then replace the command block at lines 761-766:

```ts
        // Click to hide this session
        entry.item.command = {
            command: 'claudeContextBar.hideSession',
            title: 'Hide Session',
            arguments: [session.sessionFile]
        };
```

with:

```ts
        // Click to open this session's Claude Code tab
        entry.item.command = {
            command: 'claudeContextBar.revealSession',
            title: 'Open Claude Code Tab',
            arguments: [session.fullSessionId, session.entrypoint]
        };
```

- [ ] **Step 10: Verify the build and the suite**

Run: `npm test`
Expected: PASS, with no TypeScript errors. A `Cannot find name 'hiddenSessions'` or `'visibleSessions'` error means a reference from Step 3 or Step 8 was missed.

- [ ] **Step 11: Verify no trace of the removed feature remains**

Run: `grep -rn "hiddenSessions\|hideSession\|visibleSessions" src/`
Expected: no output at all.

- [ ] **Step 12: Commit**

```bash
git add src/extension.ts
git commit -m "feat: click a status bar item to open its Claude Code tab

Replaces click-to-hide. The click delegates to the Claude Code extension's
private claude-vscode.editor.open command, guarded by the session's entrypoint
and by the command actually being registered. Automatic idle hiding via
idleTimeout is unchanged; only the manual hide is gone."
```

---

### Task 3: Documentation and the manual verification gate

**Files:**
- Modify: `package.json:~/claudeContextBar.idleTimeout description`
- Modify: `README.md:40`, `README.md:72`
- Modify: `CHANGELOG.md:11` (the `[Fork] - 2026-08-09` section)

**Interfaces:**
- Consumes: the behaviour shipped by Task 2.
- Produces: no code.

- [ ] **Step 1: Drop the stale click hint from the setting description**

In `package.json`, the `claudeContextBar.idleTimeout` description currently reads:

```json
"description": "Seconds of inactivity before hiding a session (default: 180 / 3 minutes). Set 0 to never hide idle sessions. Click to manually hide."
```

Change it to:

```json
"description": "Seconds of inactivity before hiding a session (default: 180 / 3 minutes). Set 0 to never hide idle sessions."
```

- [ ] **Step 2: Update the README feature line**

`README.md` line 40 currently reads:

```markdown
👆 **Click to Hide** — Click any context bar item to temporarily hide it; reappears on new activity
```

Replace it with:

```markdown
👆 **Click to Open the Tab** — Click any context bar item to jump to that session's Claude Code tab in the current window. Sessions started outside a VS Code tab (terminal, Claude Desktop) have no tab to open and say so instead.
```

- [ ] **Step 3: Update the README settings table row**

`README.md` line 72 currently reads:

```markdown
| `claudeContextBar.idleTimeout` | `180` | Seconds of inactivity before hiding a session (3 minutes). Set `0` to never hide idle sessions |
```

Replace it with:

```markdown
| `claudeContextBar.idleTimeout` | `180` | Seconds of inactivity before a session drops off the bar (3 minutes). Set `0` to keep idle sessions forever |
```

- [ ] **Step 4: Add the CHANGELOG entry**

In `CHANGELOG.md`, inside the `## [Fork] - 2026-08-09` section, add a `### Changed` block immediately before the existing `### Added` heading (line 11):

```markdown
### Changed
- **Clicking a status bar item now opens that session's Claude Code tab** instead of hiding the
  item. It delegates to the Claude Code extension's private `claude-vscode.editor.open` command,
  which reveals the webview panel matching the session id. Two guards keep it safe: the session's
  `entrypoint` must be `claude-vscode` (terminal, SDK, and Claude Desktop sessions have no tab, and
  calling the command with an id the extension does not know would create an unwanted tab), and the
  command must actually be registered. Either guard failing shows a message and opens nothing.
  Cross-window jumps are out of scope: VS Code exposes no API to focus another window.
- Manual click-to-hide is removed, along with its auto-unhide-on-new-activity behaviour. Automatic
  hiding of idle sessions via `idleTimeout` is unchanged.
```

- [ ] **Step 5: Verify nothing still advertises click-to-hide**

Run: `grep -rn "Click to hide\|Click to Hide\|click to manually hide" README.md package.json src/ --ignore-case`
Expected: no output.

- [ ] **Step 6: Run the full suite one more time**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "docs: describe click-to-open-tab and drop click-to-hide"
```

- [ ] **Step 8: Manual verification gate (cannot be automated)**

Reading the Claude extension's bundle proves the command's shape, not its runtime behaviour. Press `F5` in this repo to launch the Extension Development Host, then confirm all three:

1. Click an item for a session started as a Claude Code **tab in that window** → the tab is revealed and focused.
2. Click an item for a session started in a **terminal** (`entrypoint: cli`) → an information message appears naming the origin, and **no new tab opens**.
3. Hover any item → the tooltip footer reads *Click to open this tab*.

Record the outcome of each of the three in the final report. If step 1 fails, the private command changed shape — do not paper over it; report it.
