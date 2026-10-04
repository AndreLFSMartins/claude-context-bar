import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseOpenSessions, keepOpenSessions } from './claudeTabState';
import { CLAUDE_IDE_ENTRYPOINT } from './revealSession';

// Shape copied from a real `Anthropic.claude-code` value (Claude Code 2.1.289,
// read with sqlite3 -readonly on 2026-10-04).
function value(panelTabSessions: unknown): string {
    return JSON.stringify({
        lastActivationSessionId: '0184b9ed-e9f2-45b4-933b-139d4747df32',
        panelTabSessions,
        pythonEnvNoneToActivate: true,
        lastProviderVerdictThirdParty: false
    });
}

describe('parseOpenSessions', () => {
    test('returns each panelTabSessions entry with its id and title', () => {
        const parsed = parseOpenSessions(value([
            { sessionId: 'aaa', title: 'First', fullEditor: false },
            { sessionId: 'bbb', title: 'Second', fullEditor: false },
            { sessionId: 'ccc', title: 'Third', fullEditor: true }
        ]));
        assert.deepStrictEqual(parsed, [
            { sessionId: 'aaa', title: 'First' },
            { sessionId: 'bbb', title: 'Second' },
            { sessionId: 'ccc', title: 'Third' }
        ]);
    });

    test('keeps one entry when the same sessionId appears twice', () => {
        const parsed = parseOpenSessions(value([
            { sessionId: 'aaa', title: 'First' },
            { sessionId: 'aaa', title: 'Again' }
        ]));
        assert.deepStrictEqual(parsed, [{ sessionId: 'aaa', title: 'First' }]);
    });

    test('keeps an entry without fullEditor (older entries lack it)', () => {
        const parsed = parseOpenSessions(value([{ sessionId: 'aaa', title: 'Old' }]));
        assert.deepStrictEqual(parsed, [{ sessionId: 'aaa', title: 'Old' }]);
    });

    test('returns [] for panelTabSessions: [] (all tabs closed is a real answer)', () => {
        assert.deepStrictEqual(parseOpenSessions(value([])), []);
    });

    test('returns null for undefined (key missing)', () => {
        assert.strictEqual(parseOpenSessions(undefined), null);
    });

    test('returns null for invalid JSON', () => {
        assert.strictEqual(parseOpenSessions('{"panelTabSessions": ['), null);
    });

    test('returns null for an object with panelSessionIds but no panelTabSessions', () => {
        assert.strictEqual(parseOpenSessions(JSON.stringify({ panelSessionIds: ['aaa'] })), null);
    });

    test('skips an entry without a string sessionId and keeps the others', () => {
        const parsed = parseOpenSessions(value([
            { title: 'No id' },
            { sessionId: 42, title: 'Numeric id' },
            null,
            { sessionId: 'bbb', title: 'Kept' }
        ]));
        assert.deepStrictEqual(parsed, [{ sessionId: 'bbb', title: 'Kept' }]);
    });

    test('turns a missing title into ""', () => {
        assert.deepStrictEqual(parseOpenSessions(value([{ sessionId: 'aaa' }])), [{ sessionId: 'aaa', title: '' }]);
    });

    test('returns null when the JSON is not an object', () => {
        assert.strictEqual(parseOpenSessions('null'), null);
        assert.strictEqual(parseOpenSessions('[]'), null);
    });
});

describe('keepOpenSessions', () => {
    const ide = (id: string) => ({ fullSessionId: id, entrypoint: CLAUDE_IDE_ENTRYPOINT });

    test('keeps an IDE session whose id is open', () => {
        const kept = keepOpenSessions([ide('aaa')], [{ sessionId: 'aaa', title: 'Same' }]);
        assert.deepStrictEqual(kept, [ide('aaa')]);
    });

    test('drops an IDE session whose tab is closed, even with an open tab of the same title', () => {
        // Two tabs titled "Same", one closed: only its id is gone from the set.
        const kept = keepOpenSessions(
            [ide('aaa'), ide('bbb')],
            [{ sessionId: 'aaa', title: 'Same' }]
        );
        assert.deepStrictEqual(kept, [ide('aaa')]);
    });

    test('drops every IDE session when no tab is open', () => {
        assert.deepStrictEqual(keepOpenSessions([ide('aaa')], []), []);
    });

    test('leaves non-IDE sessions alone: they have no tab state', () => {
        const cli = { fullSessionId: 'ccc', entrypoint: 'cli' };
        const unknown = { fullSessionId: 'ddd', entrypoint: '' };
        assert.deepStrictEqual(keepOpenSessions([cli, unknown], []), [cli, unknown]);
    });
});
