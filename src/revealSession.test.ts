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
    test('uses primaryEditor.open, the variant with no global-settings side effect', () => {
        // claude-vscode.editor.open runs `if (viewColumn !== ViewColumn.Active)
        // setPreferredLocation("panel")` BEFORE revealing, and that writes
        // claudeCode.preferredLocation to the user's GLOBAL settings. We call the
        // command with only a session id, so viewColumn is undefined and the write
        // fires on every single click. primaryEditor.open reaches the same
        // createPanel with ViewColumn.Active and never touches settings.
        assert.strictEqual(CLAUDE_REVEAL_COMMAND, 'claude-vscode.primaryEditor.open');
    });

    test('names the IDE entrypoint value exactly', () => {
        assert.strictEqual(CLAUDE_IDE_ENTRYPOINT, 'claude-vscode');
    });
});
