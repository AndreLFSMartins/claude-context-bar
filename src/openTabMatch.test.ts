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
