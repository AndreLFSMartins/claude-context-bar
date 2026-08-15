import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractUserPromptText } from './userPromptText';

describe('extractUserPromptText', () => {
    it('returns a plain string prompt', () => {
        assert.strictEqual(extractUserPromptText('faz o merge'), 'faz o merge');
    });

    it('reads the first text block of a structured message', () => {
        assert.strictEqual(
            extractUserPromptText([{ type: 'text', text: 'investiga o bug' }]),
            'investiga o bug'
        );
    });

    it('skips non-text blocks such as a pasted image', () => {
        assert.strictEqual(
            extractUserPromptText([
                { type: 'image', source: { type: 'base64', data: 'iVBOR' } },
                { type: 'text', text: 'veja a imagem' }
            ]),
            'veja a imagem'
        );
    });

    it('ignores slash-command invocations', () => {
        assert.strictEqual(
            extractUserPromptText('<command-message>resume-handoff</command-message>\n<command-name>/resume-handoff</command-name>'),
            ''
        );
        assert.strictEqual(extractUserPromptText('<local-command-stdout>ok</local-command-stdout>'), '');
    });

    it('ignores continuation caveats', () => {
        assert.strictEqual(extractUserPromptText('Caveat: The messages below were generated…'), '');
    });

    it('ignores the synthetic lines the runtime writes as the user', () => {
        // Both observed on real bridge sessions 2026-08-15 — recorded as user
        // messages, never typed by anyone.
        assert.strictEqual(extractUserPromptText('[Request interrupted by user]'), '');
        assert.strictEqual(extractUserPromptText('[Request interrupted by user for tool use]'), '');
        assert.strictEqual(
            extractUserPromptText('<task-notification>\n<task-id>aaaa092afe8a17deb</task-id>\n</task-notification>'),
            ''
        );
        assert.strictEqual(
            extractUserPromptText('<scheduled-task name="vault-maintenance">roda a manutenção</scheduled-task>'),
            ''
        );
    });

    it('ignores tool results, which are not something the user typed', () => {
        assert.strictEqual(
            extractUserPromptText([{ type: 'tool_result', content: 'exit 0' }]),
            ''
        );
    });

    it('strips injected system reminders around the real prompt', () => {
        assert.strictEqual(
            extractUserPromptText('<system-reminder>whisper</system-reminder>\nroda os testes'),
            'roda os testes'
        );
    });

    it('returns empty when the message is only a system reminder', () => {
        assert.strictEqual(extractUserPromptText('<system-reminder>whisper</system-reminder>'), '');
    });

    it('returns empty for absent or malformed content', () => {
        assert.strictEqual(extractUserPromptText(undefined), '');
        assert.strictEqual(extractUserPromptText(null), '');
        assert.strictEqual(extractUserPromptText([]), '');
        assert.strictEqual(extractUserPromptText(42), '');
    });
});
