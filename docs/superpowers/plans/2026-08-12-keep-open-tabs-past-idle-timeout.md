# Keep Open Tabs Past Idle Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code tab confirmed open via `vscode.window.tabGroups` never disappears from the status bar purely because `idleTimeout` elapsed — only demand-driven extra reads (bounded per project), never a full-history scan.

**Architecture:** `findActiveSessions` gains a second, conditional pass: after the normal within-`idleTimeout` scan, if any currently-open tab has no matching session yet, read that project's older files one at a time (newest-first) until every open tab is accounted for or a per-project cap is hit. A new pure primitive in `openTabMatch.ts`, `matchingOpenTabTitle`, backs both the existing ghost-drop filter (refactored to use it) and this new search.

**Tech Stack:** TypeScript 5, `node --test`.

## Global Constraints

- No new `claudeContextBar.*` setting (spec Non-goals) — the per-project extra-scan cap is an internal constant.
- Pass 2 must never run when `unmatchedTitles` is empty — zero extra file reads in the common case (spec Design).
- Pass 2 is bounded at 20 files per project (`MAX_EXTRA_SCAN_PER_PROJECT`) regardless of how large that project's history is (spec Risks; verified one local project has 930 `.jsonl` files).
- Only applies when `onlyCurrentWindow` is `true` and `detectionLooksReliable` returns `true` — same gate as the closed-tab-ghosts fix (spec Non-goals).
- 4-space indentation, existing code style in `src/` (project CLAUDE.md).

---

### Task 1: `matchingOpenTabTitle` — pure primitive, `hasMatchingOpenTab` refactored to use it

**Files:**
- Modify: `src/openTabMatch.ts`
- Test: `src/openTabMatch.test.ts`

**Interfaces:**
- Consumes: `collapsePrompt` from `./tabLabel` (already imported).
- Produces: `export function matchingOpenTabTitle(lastPrompt: string, openTabTitles: string[]): string | undefined`. Used by `src/extension.ts` in Task 3 (Pass 2 matching and removal from `unmatchedTitles`).
- `hasMatchingOpenTab`'s existing signature and exported behavior are unchanged — this is a refactor, not a behavior change, for every existing caller.

- [ ] **Step 1: Write the failing tests**

Add to `src/openTabMatch.test.ts`, after the closing `});` of the `hasMatchingOpenTab` describe block and before the `describe('detectionLooksReliable', ...)` block:

```ts
describe('matchingOpenTabTitle', () => {
    test('returns the title whose ellipsis-truncated prefix matches the prompt', () => {
        assert.strictEqual(
            matchingOpenTabTitle(
                'testado. pode fazer merge, push e deploy',
                ['a versão nova está instalada no vscode ?', 'testado. pode fazer merge, pu…']
            ),
            'testado. pode fazer merge, pu…'
        );
    });

    test('returns undefined when no title matches', () => {
        assert.strictEqual(
            matchingOpenTabTitle('leia o arquivo', ['título completamente diferente']),
            undefined
        );
    });

    test('returns undefined for an empty prompt, even with titles present — no vacuous pass here', () => {
        assert.strictEqual(
            matchingOpenTabTitle('', ['qualquer título']),
            undefined
        );
    });

    test('returns the second title when the prompt matches it and not the first', () => {
        assert.strictEqual(
            matchingOpenTabTitle('sim', ['não', 'sim']),
            'sim'
        );
    });
});
```

Add the import at the top of the test file:

```ts
import { hasMatchingOpenTab, detectionLooksReliable, matchingOpenTabTitle } from './openTabMatch';
```

(This replaces the existing `import { hasMatchingOpenTab, detectionLooksReliable } from './openTabMatch';` line.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: FAIL — `matchingOpenTabTitle is not a function` (or a TS compile error naming the missing export).

- [ ] **Step 3: Implement `matchingOpenTabTitle` and refactor `hasMatchingOpenTab`**

In `src/openTabMatch.ts`, replace the existing `hasMatchingOpenTab` function body with:

```ts
/**
 * Which open tab title, if any, corresponds to this prompt — or undefined.
 *
 * Unlike hasMatchingOpenTab, an empty prompt never matches here: this is the
 * primitive Pass 2 in extension.ts uses to hunt for a *specific*, named open
 * tab among a project's older sessions, and an old session with no recorded
 * prompt proves nothing about which (if any) open tab it corresponds to.
 */
export function matchingOpenTabTitle(lastPrompt: string, openTabTitles: string[]): string | undefined {
    const collapsed = collapsePrompt(lastPrompt);
    if (!collapsed) {
        return undefined;
    }

    return openTabTitles.find((title) => {
        const stripped = title.replace(/…\s*$/, '').trimEnd();
        if (!stripped) {
            return false;
        }
        return collapsed.startsWith(stripped) || stripped.startsWith(collapsed);
    });
}

export function hasMatchingOpenTab(lastPrompt: string, openTabTitles: string[]): boolean {
    // No prompt recorded yet (a session can be up to one message old before
    // its first last-prompt line lands) — nothing to correlate, so this can
    // never be evidence the tab is closed. matchingOpenTabTitle intentionally
    // has no such pass (see its own doc comment), so it's handled here.
    if (!collapsePrompt(lastPrompt)) {
        return true;
    }
    return matchingOpenTabTitle(lastPrompt, openTabTitles) !== undefined;
}
```

This replaces the entire previous body of `hasMatchingOpenTab` (the one with the inline `.some(...)` loop) — the doc comment above the function (the long one describing why matching is by title text) stays as-is, only the function body and the addition above it change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsc && node --test out/openTabMatch.test.js`
Expected: all cases pass — the original 8 `hasMatchingOpenTab` cases (regression check that the refactor didn't change behavior), the 4 new `matchingOpenTabTitle` cases, and the 5 existing `detectionLooksReliable` cases (17 total in this file).

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all suites pass (98 total: 85 from before + this file growing from 13 to 17 cases... verify the exact number from output rather than assuming).

```bash
git add src/openTabMatch.ts src/openTabMatch.test.ts
git commit -m "refactor: extract matchingOpenTabTitle, back hasMatchingOpenTab with it"
```

---

### Task 2: Extract `buildSessionInfo` — no behavior change

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Produces: `async function buildSessionInfo(file: {name: string; path: string; mtime: Date}, projectDir: string, contextLimit: number, modelContextLimits: Record<string, number>, showScheduledTasks: boolean): Promise<SessionInfo | null>`. Used by both passes in `findActiveSessions` (Task 3).
- Consumes: `getLatestTokenCount`, `isScheduledTask`, `decodeProjectPath`, `getContextLimitForModel` — all already imported/defined in this file.

This task is a pure refactor (extract a function, no logic change) — no test file changes; verified by full-suite green plus a manual read-through diff check in Step 3.

- [ ] **Step 1: Add the helper function**

In `src/extension.ts`, add this function immediately above `async function findActiveSessions()`:

```ts
/**
 * Build a SessionInfo from one .jsonl file, or null if it isn't a real,
 * displayable session (no usage yet, or a scheduled/background task). Shared
 * by findActiveSessions' two passes — the normal within-idleTimeout scan and
 * the Pass 2 search for a specific still-open, since-gone-idle tab.
 */
async function buildSessionInfo(
    file: { name: string; path: string; mtime: Date },
    projectDir: string,
    contextLimit: number,
    modelContextLimits: Record<string, number>,
    showScheduledTasks: boolean
): Promise<SessionInfo | null> {
    const usage = await getLatestTokenCount(file.path);

    if (usage.totalTokens === 0) {
        return null;
    }
    // Scheduled/background runs are sessions but not tabs; they otherwise
    // compete with real tabs for status bar slots.
    if (!showScheduledTasks && isScheduledTask(usage.firstMessage)) {
        return null;
    }

    const { name, fullPath } = decodeProjectPath(projectDir);
    // Extract short session ID from filename (display only — the Claude Code
    // command needs the full id, kept separately)
    const fullSessionId = file.name.replace('.jsonl', '');
    const sessionId = fullSessionId.substring(0, 8);
    // Auto-detect context limit based on model
    const sessionContextLimit = getContextLimitForModel(usage.model, contextLimit, modelContextLimits);

    return {
        projectName: name,
        projectPath: fullPath,
        sessionId,
        fullSessionId,
        entrypoint: usage.entrypoint,
        lastPrompt: usage.lastPrompt,
        sessionFile: file.path,
        inputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        totalTokens: usage.totalTokens,
        percentage: Math.round((usage.totalTokens / sessionContextLimit) * 100),
        lastUpdated: file.mtime,
        model: usage.model,
        contextLimit: sessionContextLimit,
        firstMessage: usage.firstMessage,
        sessionCreated: usage.sessionCreated,
        wasCleared: usage.wasCleared
    };
}
```

- [ ] **Step 2: Replace the inline session-building loop with a call to the helper**

Find this block inside `findActiveSessions` (the `for (const file of files)` loop):

```ts
            // Get token count from EACH active session file (1 per Claude Code tab)
            for (const file of files) {
                const usage = await getLatestTokenCount(file.path);

                if (usage.totalTokens > 0) {
                    // Scheduled/background runs are sessions but not tabs; they
                    // otherwise compete with real tabs for status bar slots.
                    if (!showScheduledTasks && isScheduledTask(usage.firstMessage)) continue;

                    const { name, fullPath } = decodeProjectPath(projectDir);
                    // Extract short session ID from filename (display only — the
                    // Claude Code command needs the full id, kept separately)
                    const fullSessionId = file.name.replace('.jsonl', '');
                    const sessionId = fullSessionId.substring(0, 8);
                    // Auto-detect context limit based on model
                    const sessionContextLimit = getContextLimitForModel(usage.model, contextLimit, modelContextLimits);
                    sessions.push({
                        projectName: name,
                        projectPath: fullPath,
                        sessionId,
                        fullSessionId,
                        entrypoint: usage.entrypoint,
                        lastPrompt: usage.lastPrompt,
                        sessionFile: file.path,
                        inputTokens: usage.inputTokens,
                        cacheReadTokens: usage.cacheReadTokens,
                        cacheCreationTokens: usage.cacheCreationTokens,
                        totalTokens: usage.totalTokens,
                        percentage: Math.round((usage.totalTokens / sessionContextLimit) * 100),
                        lastUpdated: file.mtime,
                        model: usage.model,
                        contextLimit: sessionContextLimit,
                        firstMessage: usage.firstMessage,
                        sessionCreated: usage.sessionCreated,
                        wasCleared: usage.wasCleared
                    });
                }
            }
```

Replace it with:

```ts
            // Get token count from EACH active session file (1 per Claude Code tab)
            for (const file of files) {
                const session = await buildSessionInfo(file, projectDir, contextLimit, modelContextLimits, showScheduledTasks);
                if (session) {
                    sessions.push(session);
                }
            }
```

- [ ] **Step 3: Diff-check and compile**

Run: `npx tsc`
Expected: no errors. Re-read the new `buildSessionInfo` against the block you just deleted side by side — every field must be present with the same source expression (this step exists because a silent field drop here would only surface as a subtly wrong tooltip or percentage later, not a compile error).

- [ ] **Step 4: Run the full suite and commit**

Run: `npm test`
Expected: same pass count as the end of Task 1 (this task adds no tests — it's a behavior-preserving refactor).

```bash
git add src/extension.ts
git commit -m "refactor: extract buildSessionInfo from findActiveSessions"
```

---

### Task 3: Pass 2 — resurrect sessions for still-open, gone-idle tabs

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `buildSessionInfo` (Task 2), `matchingOpenTabTitle` (Task 1), `hasMatchingOpenTab`, `detectionLooksReliable`, `getOpenClaudeTabTitles` (all already present).
- Produces: no new exports — `findActiveSessions`'s returned `SessionInfo[]` now includes Pass 2 results. Covered by the manual gate (Step 4); no dedicated unit test (this function reads the filesystem and is not currently under test, per the same reasoning as the 2026-08-09 spec).

- [ ] **Step 1: Add the `matchingOpenTabTitle` import and the scan cap constant**

In `src/extension.ts`, update the existing import line:

```ts
import { hasMatchingOpenTab, detectionLooksReliable } from './openTabMatch';
```

to:

```ts
import { hasMatchingOpenTab, detectionLooksReliable, matchingOpenTabTitle } from './openTabMatch';
```

Add this constant near the other module-level constants (next to `STATUS_BAR_PRIORITY_BASE`):

```ts
// Pass 2 of findActiveSessions only runs when a genuinely open tab has gone
// idle past idleTimeout — this bounds how many of that project's older files
// it will read hunting for a match, so a project with a huge history (one on
// this machine has 930 .jsonl files) never turns into a full-history scan.
const MAX_EXTRA_SCAN_PER_PROJECT = 20;
```

- [ ] **Step 2: Track each project's beyond-idle files during Pass 1**

Find this block (the file-listing line inside the project loop):

```ts
            // Find JSONL files modified within cutoff time
            const files = fs.readdirSync(projectPath)
                .filter(f => f.endsWith('.jsonl'))
                // Skip agent files (claude-mem background processes)
                .filter(f => !f.startsWith('agent-'))
                .map(f => ({
                    name: f,
                    path: path.join(projectPath, f),
                    mtime: fs.statSync(path.join(projectPath, f)).mtime
                }))
                .filter(f => f.mtime.getTime() > cutoffTime)
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (files.length === 0) continue;

            // Get token count from EACH active session file (1 per Claude Code tab)
            for (const file of files) {
                const session = await buildSessionInfo(file, projectDir, contextLimit, modelContextLimits, showScheduledTasks);
                if (session) {
                    sessions.push(session);
                }
            }
```

Replace it with:

```ts
            // List every session file for this project once, newest first —
            // Pass 2 (below) needs the ones older than cutoffTime too, so it
            // isn't a second directory read.
            const allFiles = fs.readdirSync(projectPath)
                .filter(f => f.endsWith('.jsonl'))
                // Skip agent files (claude-mem background processes)
                .filter(f => !f.startsWith('agent-'))
                .map(f => ({
                    name: f,
                    path: path.join(projectPath, f),
                    mtime: fs.statSync(path.join(projectPath, f)).mtime
                }))
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            const files = allFiles.filter(f => f.mtime.getTime() > cutoffTime);
            const beyondIdleFiles = allFiles.filter(f => f.mtime.getTime() <= cutoffTime);

            if (files.length === 0 && beyondIdleFiles.length === 0) continue;

            // Get token count from EACH active session file (1 per Claude Code tab)
            for (const file of files) {
                const session = await buildSessionInfo(file, projectDir, contextLimit, modelContextLimits, showScheduledTasks);
                if (session) {
                    sessions.push(session);
                }
            }

            projectBeyondIdleFiles.push({ projectDir, beyondIdleFiles });
```

Add the `projectBeyondIdleFiles` declaration right before the `try {` block that opens the project-scanning loop (find `try {\n        const projectDirs = fs.readdirSync(claudeDir);` and insert above the `try`):

```ts
    const projectBeyondIdleFiles: { projectDir: string; beyondIdleFiles: { name: string; path: string; mtime: Date }[] }[] = [];

    try {
```

- [ ] **Step 3: Add Pass 2 between the project loop and the grouping step**

Find this block (the existing Pass 1 filter, right after the `catch` that closes the project-scanning `try`):

```ts
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
```

Replace it with:

```ts
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

            // Pass 2: the inverse problem. A tab can still be genuinely open
            // but idle long enough that its file fell out of the cutoffTime
            // window in Pass 1 — it never got a chance to be read at all. Find
            // any open tab title with no matching session yet, and hunt for it
            // in each project's older files, newest-first, stopping the moment
            // every title is accounted for (or the per-project cap is hit).
            let unmatchedTitles = openTabTitles.filter(
                (title) => !sessions.some((s) => matchingOpenTabTitle(s.lastPrompt, [title]) !== undefined)
            );

            for (const { projectDir, beyondIdleFiles } of projectBeyondIdleFiles) {
                if (unmatchedTitles.length === 0) {
                    break;
                }
                let scanned = 0;
                for (const file of beyondIdleFiles) {
                    if (unmatchedTitles.length === 0 || scanned >= MAX_EXTRA_SCAN_PER_PROJECT) {
                        break;
                    }
                    scanned++;
                    const session = await buildSessionInfo(file, projectDir, contextLimit, modelContextLimits, showScheduledTasks);
                    if (!session) {
                        continue;
                    }
                    const matched = matchingOpenTabTitle(session.lastPrompt, unmatchedTitles);
                    if (matched !== undefined) {
                        liveSessions.push(session);
                        unmatchedTitles = unmatchedTitles.filter((title) => title !== matched);
                    }
                }
            }
        }
    }
```

- [ ] **Step 4: Compile, run the full suite, and commit**

Run: `npx tsc && npm test`
Expected: compiles clean; same pass count as Task 2 (no new automated tests — this task's correctness is the manual gate below).

```bash
git add src/extension.ts
git commit -m "feat: resurrect sessions for tabs that are open but gone idle"
```

- [ ] **Step 5: Manual gate (required)**

In the Extension Development Host:

1. Open workspace settings for the dev-host window and temporarily set `claudeContextBar.idleTimeout` to `10`.
2. Open a Claude Code tab, send one message, note the status bar item appears.
3. Leave that tab untouched (don't send another message) for at least 15 seconds.
4. Confirm the item is **still visible** — Pass 2 should have resurrected it once its file aged past the 10s cutoff.
5. Close that tab.
6. Confirm the item disappears within one refresh cycle — regression check against the closed-tab-ghosts fix, which must still work correctly now that Pass 2 exists.
7. Restore `claudeContextBar.idleTimeout` to its previous value (or remove the workspace-settings override).

Record the result (pass/fail, what was observed) before treating this task as done.

---

## Self-Review Notes

- **Spec coverage:** Problem/Goal → Task 3 (Pass 2 resurrection). "Search is demand-driven, not size-driven" → Task 3 Step 3 (`unmatchedTitles`-gated loop, breaks the moment it's empty). `matchingOpenTabTitle` primitive + `hasMatchingOpenTab` refactor → Task 1. `MAX_EXTRA_SCAN_PER_PROJECT` cap → Task 3 Step 1 and enforced in Step 3's inner loop. Non-goals (no new setting, `onlyCurrentWindow` gate, `detectionLooksReliable` gate) → Task 3 Step 3 keeps Pass 2 nested inside the existing `if (onlyCurrentWindow)` / `if (detectionLooksReliable(...))` guards, and the cap stays a `const`, not a config read. Manual gate → Task 3 Step 5.
- **Placeholder scan:** none found — every step has complete code.
- **Type consistency:** `buildSessionInfo`'s parameter list and return type (`Promise<SessionInfo | null>`) match at both call sites (Task 2 Step 2's Pass 1 loop, Task 3 Step 3's Pass 2 loop). `matchingOpenTabTitle(lastPrompt: string, openTabTitles: string[]): string | undefined` is used identically in its own tests (Task 1) and at both call sites in Task 3 (the `unmatchedTitles` filter and the Pass 2 inner loop).
