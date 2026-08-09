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
