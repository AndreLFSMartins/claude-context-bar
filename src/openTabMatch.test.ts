import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hasMatchingOpenTab, detectionLooksReliable } from './openTabMatch';

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
});
