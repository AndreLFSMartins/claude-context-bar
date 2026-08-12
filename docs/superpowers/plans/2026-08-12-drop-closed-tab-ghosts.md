# Drop Closed-Tab Ghosts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A status bar item whose Claude Code tab has already been closed disappears promptly, instead of lingering until `idleTimeout` (default 180s) expires and showing a stale message as if it were the current tab's name.

**Architecture:** A new pure module (`src/openTabMatch.ts`) decides, from plain data, whether a session's last prompt still corresponds to an open Claude Code tab title. `src/extension.ts` gets a thin, `vscode`-dependent wrapper that reads the real open tab titles and calls into that pure module from `findActiveSessions`, only when `onlyCurrentWindow` is `true`.

**Tech Stack:** TypeScript 5, `node --test`, VS Code `vscode.window.tabGroups` API (engine `^1.74.0`, well past when this API landed).

## Global Constraints

- No new runtime dependencies (spec: "no new npm packages").
- Filter applies only when `onlyCurrentWindow` is `true` — `vscode.window.tabGroups` only sees the current window's tabs (spec Non-goals).
- `viewType` check must be `.includes('claudeVSCodePanel')`, verified against the installed Claude Code extension's own bundle (spec Evidence) — do not use a different string.
- Never let this filter hide a session when detection itself looks unreliable — `detectionLooksReliable` must gate the filter (spec Design, "safety net").
- 4-space indentation, existing code style in `src/` (project CLAUDE.md).

---

### Task 1: Extract `collapsePrompt` as a shared helper

**Files:**
- Modify: `src/tabLabel.ts`
- Test: `src/tabLabel.test.ts` (no new tests — this is a pure extraction; the existing suite must still pass unchanged)

**Interfaces:**
- Produces: `export function collapsePrompt(text: string): string` — collapses runs of whitespace to a single space and trims. Used by `buildItemLabel` in this file, and by `hasMatchingOpenTab` in Task 2.

- [ ] **Step 1: Run the existing test suite to confirm the starting state is green**

Run: `npm test`
Expected: all `tabLabel.test.ts` cases PASS (this is a baseline check, not a new test).

- [ ] **Step 2: Extract the helper and use it in `buildItemLabel`**

In `src/tabLabel.ts`, add the export above the `buildItemLabel` function, and replace its inline collapse line with a call to it:

```ts
/**
 * Collapse whitespace to single spaces and trim, so a prompt that opens
 * with a heading, blank line, or pasted indentation reads as one line.
 * Shared with openTabMatch.ts, which needs the identical normalization to
 * compare a session's last prompt against an open tab's title.
 */
export function collapsePrompt(text: string): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}
```

Replace this line inside `buildItemLabel`:

```ts
    const collapsed = (lastPrompt ?? '').replace(/\s+/g, ' ').trim();
```

with:

```ts
    const collapsed = collapsePrompt(lastPrompt);
```

- [ ] **Step 3: Run the test suite again to confirm no regression**

Run: `npm test`
Expected: all `tabLabel.test.ts` cases still PASS, unchanged output.

- [ ] **Step 4: Commit**

```bash
git add src/tabLabel.ts
git commit -m "refactor: export collapsePrompt from tabLabel for reuse"
```

---

### Task 2: `hasMatchingOpenTab` — pure prefix-match against open tab titles

**Files:**
- Create: `src/openTabMatch.ts`
- Test: `src/openTabMatch.test.ts`

**Interfaces:**
- Consumes: `collapsePrompt(text: string): string` from `./tabLabel` (Task 1).
- Produces: `export function hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean`. Used by `src/extension.ts` in Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/openTabMatch.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasMatchingOpenTab } from './openTabMatch';

describe('hasMatchingOpenTab', () => {
    test('matches when the open tab title is the ellipsis-truncated prefix of the prompt', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                'o nome que está aparecendo como se fosse da sessão não é o que está na aba',
                ['o nome que está aparecen…']
            ),
            true
        );
    });

    test('matches when the tab title equals the whole prompt, untruncated', () => {
        assert.strictEqual(
            hasMatchingOpenTab('ok', ['ok']),
            true
        );
    });

    test('does not match against an unrelated open tab title', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                'Qdo vejo isso aqui. Eu não consigo dizer qual das abas é.',
                ['a versão nova está instalada no vscode ?']
            ),
            false
        );
    });

    test('an empty last prompt always matches — nothing to correlate yet, never claim closed', () => {
        assert.strictEqual(
            hasMatchingOpenTab('', ['a versão nova está instalada no vscode ?']),
            true
        );
    });

    test('a whitespace-only last prompt also always matches', () => {
        assert.strictEqual(
            hasMatchingOpenTab('  \n\t ', []),
            true
        );
    });

    test('no open tabs at all, non-empty prompt: no match', () => {
        assert.strictEqual(
            hasMatchingOpenTab('leia o arquivo', []),
            false
        );
    });

    test('matches whichever title in the list corresponds, when there are several open tabs', () => {
        assert.strictEqual(
            hasMatchingOpenTab('testado. pode fazer merge, push e deploy', [
                'a versão nova está instalada no vscode ?',
                'testado. pode fazer merge, pu…'
            ]),
            true
        );
    });

    test('collapses whitespace before comparing, same as the label itself', () => {
        assert.strictEqual(
            hasMatchingOpenTab('faz  o\n\n  merge', ['faz o merge']),
            true
        );
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: FAIL — `Cannot find module './openTabMatch'` (module doesn't exist yet). If `tsc` itself fails because `src/openTabMatch.ts` is missing, that confirms the same thing; proceed to Step 3.

- [ ] **Step 3: Write the implementation**

Create `src/openTabMatch.ts`:

```ts
/**
 * Decide whether a session's last prompt still corresponds to a Claude Code
 * tab that is actually open, rather than one that has since been closed.
 *
 * findActiveSessions() treats any .jsonl file modified within idleTimeout as
 * "active." A closed tab's file keeps a recent mtime and lingers there for up
 * to idleTimeout — and since the status bar item now labels itself with the
 * session's last prompt (tabLabel.ts) instead of the project name, a lingering
 * item shows what looks like a real, current message that in fact belongs to
 * a tab that no longer exists.
 *
 * vscode.window.tabGroups exposes open tab titles but not session ids — the
 * Claude Code extension's private `sessionPanels` map (keyed by session id) is
 * not public API. So matching is by title text: Claude Code truncates its tab
 * title from the same last-prompt text this reads from the .jsonl, with a
 * trailing "…" when it doesn't fit. This is a best-effort heuristic, not an
 * identity check — see detectionLooksReliable() for the safety net that
 * bounds how much a wrong guess here can hide.
 *
 * Pure so the behaviour is testable without a VS Code host, following the
 * same pattern as tabLabel.ts and sessionFilter.ts.
 */

import { collapsePrompt } from './tabLabel';

/**
 * @param lastPrompt      The session's last prompt, as read from its .jsonl.
 * @param openTabTitles   Titles of the Claude Code tabs currently open in
 *                        this window (vscode.window.tabGroups, filtered to
 *                        the claudeVSCodePanel view type).
 */
export function hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean {
    const collapsed = collapsePrompt(lastPrompt);

    // No prompt recorded yet (a session can be up to one message old before
    // its first last-prompt line lands) — nothing to correlate, so this can
    // never be evidence the tab is closed.
    if (!collapsed) {
        return true;
    }

    return openTabTitles.some((title) => {
        // Strip a trailing ellipsis left by VS Code's own truncation before
        // comparing — the raw title is a truncation of the prompt, or, for a
        // short prompt, the whole prompt untruncated.
        const stripped = title.replace(/…\s*$/, '').trimEnd();
        if (!stripped) {
            return false;
        }
        return collapsed.startsWith(stripped) || stripped.startsWith(collapsed);
    });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: all 8 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/openTabMatch.ts src/openTabMatch.test.ts
git commit -m "feat: add hasMatchingOpenTab for correlating sessions to open tabs"
```

---

### Task 3: `detectionLooksReliable` — safety net against a broken viewType check

**Files:**
- Modify: `src/openTabMatch.ts`
- Test: `src/openTabMatch.test.ts`

**Interfaces:**
- Consumes: `hasMatchingOpenTab` (Task 2, same file).
- Produces: `export function detectionLooksReliable(sessions: { lastPrompt: string; lastUpdated: Date }[], openTabTitles: string[]): boolean`. Used by `src/extension.ts` in Task 4 to decide whether to apply the filter at all this refresh.

- [ ] **Step 1: Write the failing tests**

Append to `src/openTabMatch.test.ts`:

```ts
import { detectionLooksReliable } from './openTabMatch';

describe('detectionLooksReliable', () => {
    test('reliable when the freshest session matches an open tab title', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'old message', lastUpdated: new Date('2026-08-12T11:00:00') },
                    { lastPrompt: 'newest message', lastUpdated: new Date('2026-08-12T11:18:00') }
                ],
                ['newest messag…']
            ),
            true
        );
    });

    test('unreliable when the freshest session matches nothing open — the viewType check is probably broken', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'newest message', lastUpdated: new Date('2026-08-12T11:18:00') }
                ],
                ['completely unrelated title']
            ),
            false
        );
    });

    test('reliable when the freshest session has no recorded prompt yet — nothing to check', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: '', lastUpdated: new Date('2026-08-12T11:18:00') }
                ],
                ['unrelated title']
            ),
            true
        );
    });

    test('reliable with an empty session list — nothing to protect against', () => {
        assert.strictEqual(
            detectionLooksReliable([], []),
            true
        );
    });

    test('picks the freshest by lastUpdated regardless of array order', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'newest message', lastUpdated: new Date('2026-08-12T11:18:00') },
                    { lastPrompt: 'old message', lastUpdated: new Date('2026-08-12T11:00:00') }
                ],
                ['newest messag…']
            ),
            true
        );
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: FAIL — `detectionLooksReliable is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/openTabMatch.ts`:

```ts
/**
 * Is the open-tab title list trustworthy enough to filter sessions with?
 *
 * The freshest session by lastUpdated is almost certainly the tab the user is
 * looking at right now. If even that one doesn't match anything in
 * openTabTitles, the viewType check in getOpenClaudeTabTitles() (extension.ts)
 * is more likely broken — e.g. a future Claude Code release renamed its panel
 * view type — than reality actually having zero open tabs while a session was
 * just updated. Callers should skip the filter entirely when this returns
 * false, falling back to plain idleTimeout, so a detection failure degrades to
 * today's existing behaviour rather than hiding every active session.
 */
export function detectionLooksReliable(
    sessions: { lastPrompt: string; lastUpdated: Date }[],
    openTabTitles: string[]
): boolean {
    if (sessions.length === 0) {
        return true;
    }

    const freshest = sessions.reduce((a, b) => (a.lastUpdated > b.lastUpdated ? a : b));
    return hasMatchingOpenTab(freshest.lastPrompt, openTabTitles);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: all 13 cases (8 from Task 2 + 5 new) PASS.

- [ ] **Step 5: Commit**

```bash
git add src/openTabMatch.ts src/openTabMatch.test.ts
git commit -m "feat: add detectionLooksReliable safety net"
```

---

### Task 4: Wire open-tab detection into `findActiveSessions`

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `hasMatchingOpenTab`, `detectionLooksReliable` from `./openTabMatch` (Tasks 2–3).
- Produces: filters `SessionInfo[]` inside `findActiveSessions` before the project-grouping pass. No new exports — this task has no unit test of its own (it's a thin `vscode`-dependent wrapper); it is covered by the manual gate in Step 3.

- [ ] **Step 1: Add the import and the tab-title reader**

In `src/extension.ts`, add to the top-of-file imports (near the existing `import { buildItemLabel } from './tabLabel';` — search for it first to match the exact existing import style):

```ts
import { hasMatchingOpenTab, detectionLooksReliable } from './openTabMatch';
```

Add this function near `findActiveSessions` (immediately above it):

```ts
/**
 * Titles of the Claude Code tabs currently open in this window. Empty when
 * none are open, or when reading tabGroups throws for any reason (an
 * unexpected VS Code API failure should never crash a refresh cycle).
 */
function getOpenClaudeTabTitles(): string[] {
    try {
        const titles: string[] = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputWebview &&
                    tab.input.viewType.includes('claudeVSCodePanel')) {
                    titles.push(tab.label);
                }
            }
        }
        return titles;
    } catch (e) {
        console.error('Claude Context Bar: failed to read open tabs:', e);
        return [];
    }
}
```

- [ ] **Step 2: Apply the filter in `findActiveSessions`**

Find this block (right after the `try { ... } catch (e) { console.error('Error scanning Claude projects:', e); }` that populates `sessions`, and before `// Group sessions by base project name`):

```ts
    } catch (e) {
        console.error('Error scanning Claude projects:', e);
    }

    // Group sessions by base project name
```

Insert the new filter between the `catch` block and the grouping comment:

```ts
    } catch (e) {
        console.error('Error scanning Claude projects:', e);
    }

    // A session file can stay within idleTimeout after its actual Claude Code
    // tab has been closed. onlyCurrentWindow means every real tab for these
    // sessions must be in *this* window's tabGroups, so cross-check against
    // what's genuinely open and drop the rest — instead of waiting out
    // idleTimeout while showing a stale prompt as if it were the current tab.
    let liveSessions = sessions;
    if (onlyCurrentWindow) {
        const openTabTitles = getOpenClaudeTabTitles();
        if (detectionLooksReliable(sessions, openTabTitles)) {
            liveSessions = sessions.filter((s) => hasMatchingOpenTab(s.lastPrompt, openTabTitles));
        }
    }

    // Group sessions by base project name
```

Then update the grouping loop to read from `liveSessions` instead of `sessions`. Find:

```ts
    const projectGroups = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
```

Replace with:

```ts
    const projectGroups = new Map<string, SessionInfo[]>();
    for (const session of liveSessions) {
```

- [ ] **Step 3: Compile and run the full test suite**

Run: `npm test`
Expected: all existing suites (`tabLabel.test.ts`, `sessionFilter.test.ts`, `contextLimit.test.ts`, `openTabMatch.test.ts`, etc.) PASS. `extension.ts` has no dedicated test file (per the 2026-08-09 spec, it isn't currently under test), so this step is a compile-and-no-regression check, not new coverage.

- [ ] **Step 4: Manual gate (required)**

In the Extension Development Host (`F5` from this project, or `code --extensionDevelopmentPath=.`):

1. Open two Claude Code tabs for the same project; send a distinct message in each.
2. Confirm both appear as separate status bar items, each labeled with its own message.
3. Close one of the two tabs.
4. Confirm that tab's status bar item disappears within one refresh cycle (`refreshInterval` setting, default a few seconds) — not after the ~180s `idleTimeout`.
5. Confirm the remaining tab's item is unaffected.

Record the result (pass/fail, and what was observed) before moving on — this is the only verification this task gets for the live VS Code integration.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "fix: drop status bar items for sessions whose tab already closed"
```

---

## Self-Review Notes

- **Spec coverage:** Problem/Goal → Task 4 (filter applied in findActiveSessions). Non-goals (onlyCurrentWindow gate, idleTimeout untouched, heuristic not identity) → Task 4 Step 2 (`if (onlyCurrentWindow)`), and openTabMatch.ts never touches idleTimeout at all. Evidence's exact `viewType` check → Task 4 Step 1. `collapsePrompt` sharing → Task 1. `detectionLooksReliable` safety net → Task 3. Manual gate → Task 4 Step 4.
- **Placeholder scan:** none found — every step has complete code.
- **Type consistency:** `hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean` and `detectionLooksReliable(sessions: {lastPrompt: string; lastUpdated: Date}[], openTabTitles: string[]): boolean` are used identically in their own tests (Tasks 2–3) and at the call site (Task 4 Step 2) — `sessions` there is `SessionInfo[]`, which is a structural match (has `lastPrompt: string` and `lastUpdated: Date`).
