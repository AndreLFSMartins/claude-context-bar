import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasMatchingOpenTab, detectionLooksReliable } from './openTabMatch';

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
