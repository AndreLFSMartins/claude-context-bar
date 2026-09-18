import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildItemLabel } from './tabLabel';

describe('buildItemLabel', () => {
    test('uses the opening characters of the last prompt, matching the tab title', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'Qdo vejo isso aqui', fallbackName: 'DOAM', length: 6 }),
            'Qdo ve'
        );
    });

    test('collapses newlines and runs of spaces so the label stays one line', () => {
        // A pasted prompt can start with a heading and a blank line; without
        // collapsing, the first 6 chars could be whitespace and read as empty.
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'faz  o\n\n  merge', fallbackName: 'DOAM', length: 8 }),
            'faz o me'
        );
    });

    test('trims leading whitespace before counting characters', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: '   deploy agora', fallbackName: 'DOAM', length: 6 }),
            'deploy'
        );
    });

    test('returns the whole prompt when it is shorter than the limit', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'ok', fallbackName: 'DOAM', length: 6 }),
            'ok'
        );
    });

    test('drops a trailing space left by the cut', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'faz o merge', fallbackName: 'DOAM', length: 6 }),
            'faz o'
        );
    });

    test('counts characters, not UTF-16 units, so an emoji is never split', () => {
        // 'ação 🎯 x'.slice(0, 6) would cut the emoji in half and render a
        // replacement glyph. Array.from keeps code points whole.
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'ação 🎯 x', fallbackName: 'DOAM', length: 6 }),
            'ação 🎯'
        );
    });

    test('falls back to the project name when the session has no last prompt', () => {
        // Roughly one session in eight carries no last-prompt line.
        assert.strictEqual(
            buildItemLabel({ lastPrompt: '', fallbackName: 'DOAM-2', length: 6 }),
            'DOAM-2'
        );
    });

    test('falls back when the prompt is only whitespace', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: '  \n\t ', fallbackName: 'DOAM', length: 6 }),
            'DOAM'
        );
    });

    test('length 0 turns the feature off and restores the project name', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'Qdo vejo isso aqui', fallbackName: 'DOAM', length: 0 }),
            'DOAM'
        );
    });

    test('a negative length is treated as off rather than throwing', () => {
        assert.strictEqual(
            buildItemLabel({ lastPrompt: 'Qdo vejo isso aqui', fallbackName: 'DOAM', length: -3 }),
            'DOAM'
        );
    });
});

describe('buildItemLabel with an AI-generated session title', () => {
    test('prefers the AI title over the last prompt — the tab shows the title once it exists', () => {
        // Real divergence observed 2026-08-14: the tab was titled
        // "Investigar mudança de no…" (the ai-title) while the bar showed the
        // opening of the latest prompt.
        assert.strictEqual(
            buildItemLabel({
                aiTitle: 'Investigar mudança de nome na context bar',
                lastPrompt: 'o context bar tem o nome mudado pela última msg',
                fallbackName: 'CCB',
                length: 10
            }),
            'Investigar'
        );
    });

    test('falls back to the last prompt while the session has no AI title yet', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: '', lastPrompt: 'faz o merge', fallbackName: 'CCB', length: 6 }),
            'faz o'
        );
    });

    test('a whitespace-only AI title is treated as absent', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: '  \n ', lastPrompt: 'faz o merge', fallbackName: 'CCB', length: 6 }),
            'faz o'
        );
    });

    test('uses the AI title even when no prompt was recorded', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: 'Título', lastPrompt: '', fallbackName: 'CCB', length: 6 }),
            'Título'
        );
    });

    test('length 0 still turns the feature off, AI title included', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: 'Investigar mudança', lastPrompt: 'oi', fallbackName: 'CCB', length: 0 }),
            'CCB'
        );
    });

    test('falls back to the project name when both title and prompt are empty', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: '', lastPrompt: '', fallbackName: 'CCB-2', length: 6 }),
            'CCB-2'
        );
    });
});

describe('buildItemLabel for sessions that record no title or prompt line', () => {
    test('uses the prompt read from the messages themselves', () => {
        // Bridge sessions (Claude Code opened through the claude.ai bridge)
        // write user/assistant messages but never a `last-prompt` or
        // `ai-title` line, so without this they showed the project name.
        assert.strictEqual(
            buildItemLabel({
                aiTitle: '',
                lastPrompt: '',
                derivedPrompt: 'roda a manutenção',
                fallbackName: 'ormah',
                length: 6
            }),
            'roda a'
        );
    });

    test('the recorded title still wins over the derived prompt', () => {
        assert.strictEqual(
            buildItemLabel({
                aiTitle: 'Título real',
                lastPrompt: '',
                derivedPrompt: 'mensagem antiga',
                fallbackName: 'ormah',
                length: 6
            }),
            'Título'
        );
    });

    test('the recorded prompt still wins over the derived one', () => {
        assert.strictEqual(
            buildItemLabel({
                lastPrompt: 'faz o merge',
                derivedPrompt: 'mensagem antiga',
                fallbackName: 'ormah',
                length: 6
            }),
            'faz o'
        );
    });

    test('falls back to the project name when the derived prompt is empty too', () => {
        assert.strictEqual(
            buildItemLabel({ aiTitle: '', lastPrompt: '', derivedPrompt: '  ', fallbackName: 'ormah', length: 6 }),
            'ormah'
        );
    });

    test('prefers the name set with /rename over the AI title', () => {
        assert.strictEqual(
            buildItemLabel({
                customTitle: 'Seguros',
                aiTitle: 'Resume handoff',
                lastPrompt: 'continue',
                fallbackName: 'AndreMartins',
                length: 12
            }),
            'Seguros'
        );
    });

    test('ignores a blank custom title and falls through to the AI title', () => {
        assert.strictEqual(
            buildItemLabel({
                customTitle: '  ',
                aiTitle: 'Resume handoff',
                lastPrompt: 'continue',
                fallbackName: 'AndreMartins',
                length: 6
            }),
            'Resume'
        );
    });
});
