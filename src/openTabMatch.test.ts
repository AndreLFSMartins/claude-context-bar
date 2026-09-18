import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasMatchingOpenTab, detectionLooksReliable, filterToOpenTabs } from './openTabMatch';

describe('hasMatchingOpenTab', () => {
    test('matches when the open tab title is the ellipsis-truncated prefix of the prompt', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { lastPrompt: 'o nome que está aparecendo como se fosse da sessão não é o que está na aba' },
                ['o nome que está aparecen…']
            ),
            true
        );
    });

    test('matches when the tab title equals the whole prompt, untruncated', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: 'ok' }, ['ok']),
            true
        );
    });

    test('does not match against an unrelated open tab title', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { lastPrompt: 'Qdo vejo isso aqui. Eu não consigo dizer qual das abas é.' },
                ['a versão nova está instalada no vscode ?']
            ),
            false
        );
    });

    test('an empty last prompt always matches — nothing to correlate yet, never claim closed', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: '' }, ['a versão nova está instalada no vscode ?']),
            true
        );
    });

    test('a whitespace-only last prompt also always matches', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: '  \n\t ' }, []),
            true
        );
    });

    test('no open tabs at all, non-empty prompt: no match', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: 'leia o arquivo' }, []),
            false
        );
    });

    test('matches whichever title in the list corresponds, when there are several open tabs', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: 'testado. pode fazer merge, push e deploy' }, [
                'a versão nova está instalada no vscode ?',
                'testado. pode fazer merge, pu…'
            ]),
            true
        );
    });

    test('collapses whitespace before comparing, same as the label itself', () => {
        assert.strictEqual(
            hasMatchingOpenTab({ lastPrompt: 'faz  o\n\n  merge' }, ['faz o merge']),
            true
        );
    });

    test('matches via the AI title once the tab has retitled itself with it', () => {
        // Real divergence observed 2026-08-14: the tab persisted as
        // "Investigar mudança de no…" (the ai-title, truncated) while the
        // session's last prompt was a completely different text. Matching on
        // the prompt alone would wrongly read this open tab as closed.
        assert.strictEqual(
            hasMatchingOpenTab(
                {
                    aiTitle: 'Investigar mudança de nome na context bar',
                    lastPrompt: 'o context bar tem o nome mudado pela última msg'
                },
                ['Investigar mudança de no…']
            ),
            true
        );
    });

    test('still matches via the prompt while the AI title has not been generated yet', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { aiTitle: '', lastPrompt: 'o context bar tem o nome mudado' },
                ['o context bar tem o nome…']
            ),
            true
        );
    });

    test('no match when neither the AI title nor the prompt corresponds to any open tab', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { aiTitle: 'Revisar amendment do ADR 004', lastPrompt: 'ok pode seguir' },
                ['uma aba de outra sessão']
            ),
            false
        );
    });

    test('an AI title with no recorded prompt is still correlatable evidence', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { aiTitle: 'Revisar amendment do ADR 004', lastPrompt: '' },
                ['uma aba de outra sessão']
            ),
            false
        );
    });
});

describe('detectionLooksReliable', () => {
    test('reliable when some session with a prompt matches an open tab, even if it is not the most recently updated one', () => {
        // Regression: closing the tab you were just using makes that
        // session the most recently updated one on disk, and it correctly
        // stops matching (its tab is gone). That must not read as "the
        // whole detection mechanism is broken" as long as some other,
        // still-open tab's session keeps matching correctly.
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'the tab that just closed' },
                    { lastPrompt: 'teste' }
                ],
                ['teste']
            ),
            true
        );
    });

    test('reliable when a session matches only through its AI title', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    {
                        aiTitle: 'Investigar mudança de nome na context bar',
                        lastPrompt: 'o context bar tem o nome mudado pela última msg'
                    }
                ],
                ['Investigar mudança de no…']
            ),
            true
        );
    });

    test('a session with only an AI title counts as correlatable — unreliable when it matches nothing', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { aiTitle: 'Revisar amendment do ADR 004', lastPrompt: '' }
                ],
                ['completely unrelated title']
            ),
            false
        );
    });

    test('unreliable when there are open tabs but no session with a prompt matches any of them', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'some message' }
                ],
                ['completely unrelated title']
            ),
            false
        );
    });

    test('unreliable when no tabs are detected as open at all — ambiguous between "really none open" and "detection broken", so don\'t risk hiding real sessions', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: 'some message' }
                ],
                []
            ),
            false
        );
    });

    test('reliable when no session has a recorded prompt yet — nothing at risk either way', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [
                    { lastPrompt: '' }
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

    test('matches a tab titled from the name set with /rename', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { customTitle: 'Seguros', aiTitle: 'Resume handoff', lastPrompt: 'continue' },
                ['Seguros']
            ),
            true
        );
    });

    test('a custom title alone is evidence the detection works', () => {
        assert.strictEqual(
            detectionLooksReliable(
                [{ customTitle: 'Seguros', lastPrompt: '' }],
                ['Seguros']
            ),
            true
        );
    });
});

describe('hasMatchingOpenTab matches the one title the tab is showing', () => {
    // These two are the cases the first custom-title tests could not tell
    // apart: both passed whether the three recorded texts were ORed together
    // or read in the tab's own order. Each one fails if the single-candidate
    // chain in hasMatchingOpenTab is widened back into a union.

    test('a closed renamed session does not survive on another tab titled from its leftover prompt', () => {
        // The tab titled "Seguros" is gone. The only open tab happens to be
        // titled "continue", which is still this session's recorded
        // lastPrompt. Reading that as "the tab is open" is exactly the ghost
        // the closed-tab filter exists to remove.
        assert.strictEqual(
            hasMatchingOpenTab(
                { customTitle: 'Seguros', aiTitle: 'Resume handoff', lastPrompt: 'continue' },
                ['continue']
            ),
            false
        );
    });

    test('a closed renamed session does not survive on its leftover AI title either', () => {
        assert.strictEqual(
            hasMatchingOpenTab(
                { customTitle: 'Seguros', aiTitle: 'Resume handoff', lastPrompt: 'continue' },
                ['Resume handoff']
            ),
            false
        );
    });

    test('a short custom title does not match a longer, untruncated tab title', () => {
        // Reproduced against the real modules before the fix: a closed
        // session named "Auth" was kept alive by an unrelated open tab
        // titled "Authentication", because the match accepted a title that
        // merely started with the recorded text.
        assert.strictEqual(
            hasMatchingOpenTab(
                { customTitle: 'Auth', aiTitle: 'Design login', lastPrompt: 'build it' },
                ['Authentication']
            ),
            false
        );
    });

    test('and that closed session is no longer kept when another session is genuinely open', () => {
        const closed = { customTitle: 'Auth', aiTitle: 'Design login', lastPrompt: 'build it' };
        const open = { aiTitle: 'Authentication', lastPrompt: 'test refresh' };
        const tabs = ['Authentication'];

        assert.strictEqual(detectionLooksReliable([closed, open], tabs), true);
        assert.strictEqual(hasMatchingOpenTab(open, tabs), true);
        assert.strictEqual(hasMatchingOpenTab(closed, tabs), false);
    });

    test('an ellipsis-truncated tab title still matches the custom title it was cut from', () => {
        // The single-candidate chain must not break truncation: the tab shows
        // the custom title, cut with VS Code's own trailing ellipsis.
        assert.strictEqual(
            hasMatchingOpenTab(
                { customTitle: 'Revisar o contrato de seguros do cliente', lastPrompt: 'ok' },
                ['Revisar o contrato de se…']
            ),
            true
        );
    });
});

describe('filterToOpenTabs keeps a live session whose tab label lags behind', () => {
    // The defect both peers reported: the .jsonl gains a custom-title or a
    // first ai-title, the webview has not retitled its tab yet, and the write
    // that created the desync is itself what triggers the refresh. A second,
    // settled session makes detectionLooksReliable() true, so the filter runs
    // and the still-open session is dropped.
    const ide = { entrypoint: 'claude-vscode' };
    const settled = { ...ide, customTitle: 'Stable', lastPrompt: 'hello' };
    const key = (s: { lastPrompt: string }) => s.lastPrompt;

    test('a session just renamed with /rename survives the refresh that recorded it', () => {
        const renamed = { ...ide, customTitle: 'Renamed', aiTitle: '', lastPrompt: 'continue' };
        const tabs = ['Stable', 'continue'];  // its tab still shows the prompt

        const { kept } = filterToOpenTabs([settled, renamed], tabs, key, new Set(['continue']));

        assert.deepEqual(kept, [settled, renamed]);
    });

    test('a session that just gained its first AI title survives too', () => {
        const titled = { ...ide, aiTitle: 'New AI title', lastPrompt: 'Original prompt' };
        const tabs = ['Stable', 'Original prompt'];

        const { kept } = filterToOpenTabs([settled, titled], tabs, key, new Set(['Original prompt']));

        assert.deepEqual(kept, [settled, titled]);
    });

    test('but a session that never matched is still dropped — this is the ghost filter', () => {
        const ghost = { ...ide, aiTitle: 'Closed session', lastPrompt: 'gone' };
        const tabs = ['Stable'];

        const { kept } = filterToOpenTabs([settled, ghost], tabs, key, new Set());

        assert.deepEqual(kept, [settled]);
    });

    test('the grace lasts exactly one refresh: a second miss in a row drops it', () => {
        const renamed = { ...ide, customTitle: 'Renamed', lastPrompt: 'continue' };
        const tabs = ['Stable', 'continue'];

        const first = filterToOpenTabs([settled, renamed], tabs, key, new Set(['continue']));
        const second = filterToOpenTabs([settled, renamed], tabs, key, first.matchedNow);

        assert.deepEqual(first.kept, [settled, renamed]);
        assert.deepEqual(second.kept, [settled]);
    });

    test('a match after a miss restores the grace for the next refresh', () => {
        const renamed = { ...ide, customTitle: 'Renamed', lastPrompt: 'continue' };

        const lagging = filterToOpenTabs([settled, renamed], ['Stable', 'continue'], key, new Set(['continue']));
        const caughtUp = filterToOpenTabs([settled, renamed], ['Stable', 'Renamed'], key, lagging.matchedNow);

        assert.deepEqual(caughtUp.kept, [settled, renamed]);
        assert.ok(caughtUp.matchedNow.has('continue'));
    });

    test('unreliable detection carries the previous matches forward instead of clearing them', () => {
        const renamed = { ...ide, customTitle: 'Renamed', lastPrompt: 'continue' };

        const blind = filterToOpenTabs([settled, renamed], [], key, new Set(['continue']));

        assert.deepEqual(blind.kept, [settled, renamed]);
        assert.ok(blind.matchedNow.has('continue'));
    });
});

describe('filterToOpenTabs judges only sessions that have an editor tab', () => {
    // A terminal, SDK or Desktop session has no Claude Code tab in tabGroups,
    // so a tab-existence test can only ever fail for it. Of 363 session files
    // written in the week to 2026-09-18, 147 had a non-IDE entrypoint.
    const openIde = { entrypoint: 'claude-vscode', customTitle: 'Stable', lastPrompt: 'hello' };
    const key = (s: { lastPrompt: string }) => s.lastPrompt;

    for (const entrypoint of ['cli', 'sdk-cli', 'claude-desktop', '']) {
        test(`a ${entrypoint || 'origin-less'} session survives once detection turns reliable`, () => {
            const terminal = { entrypoint, lastPrompt: 'Run terminal tests' };

            const { kept } = filterToOpenTabs([terminal, openIde], ['Stable'], key, new Set());

            assert.deepEqual(kept, [terminal, openIde]);
        });
    }

    test('a non-IDE session never enters the matched set, so it never spends grace', () => {
        const terminal = { entrypoint: 'cli', lastPrompt: 'Run terminal tests' };

        const { matchedNow } = filterToOpenTabs([terminal, openIde], ['Stable'], key, new Set());

        assert.deepEqual([...matchedNow], ['hello']);
    });

    test('an IDE session whose tab is closed is still dropped beside a surviving CLI one', () => {
        const terminal = { entrypoint: 'cli', lastPrompt: 'Run terminal tests' };
        const closedIde = { entrypoint: 'claude-vscode', lastPrompt: 'gone' };

        const { kept } = filterToOpenTabs([terminal, closedIde, openIde], ['Stable'], key, new Set());

        assert.deepEqual(kept, [terminal, openIde]);
    });

    test('with no IDE session at all the filter stays off and nothing is evicted', () => {
        const terminal = { entrypoint: 'cli', lastPrompt: 'Run terminal tests' };

        const { kept } = filterToOpenTabs([terminal], [], key, new Set());

        assert.deepEqual(kept, [terminal]);
    });
});
