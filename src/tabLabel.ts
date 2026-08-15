/**
 * Pure builder for the text shown on a status bar item.
 *
 * The project name alone cannot tell two tabs of the same project apart: the
 * disambiguating suffix ("DOAM-2") is positional, assigned by creation order
 * among the *currently active* sessions, so it slides onto a different session
 * as soon as an older one drops off the bar.
 *
 * The Claude Code tab titles itself with an AI-generated session title once
 * one exists (written to the session's `.jsonl` as `{"type":"ai-title"}`,
 * present since ~2026-08-09), and with the user's latest prompt before that —
 * both verified in VS Code's persisted editor layout, e.g.
 * `"providedId":"claudeVSCodePanel","title":"Investigar mudança de no…"`. The
 * same texts are in the `.jsonl` as `{"type":"ai-title"}` and
 * `{"type":"last-prompt"}`, so the item can carry the opening characters of
 * the very string the tab is showing, preferring the title exactly as the
 * tab does.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as `getContextLimitForModel` in contextLimit.ts.
 */

/**
 * @param aiTitle        AI-generated session title from the session file, or
 *                       ''/absent while none has been generated yet.
 * @param lastPrompt     Latest user prompt from the session file, or '' when the
 *                       session records none (roughly one in eight).
 * @param derivedPrompt  Latest prompt read from the messages themselves, for
 *                       sessions that emit neither line at all (bridged ones) —
 *                       see userPromptText.ts.
 * @param fallbackName   Project name to use when there is no title or prompt.
 * @param length         Characters to keep. Zero or less turns the feature off.
 */
/**
 * Collapse whitespace to single spaces and trim, so a prompt that opens
 * with a heading, blank line, or pasted indentation reads as one line.
 * Shared with openTabMatch.ts, which needs the identical normalization to
 * compare a session's last prompt against an open tab's title.
 */
export function collapsePrompt(text: string): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function buildItemLabel(opts: {
    aiTitle?: string;
    lastPrompt: string;
    derivedPrompt?: string;
    fallbackName: string;
    length: number;
}): string {
    const { aiTitle, lastPrompt, derivedPrompt, fallbackName, length } = opts;

    if (length <= 0) {
        return fallbackName;
    }

    // A prompt can open with a heading, a blank line, or pasted indentation.
    // Collapsing first stops the visible characters from being spent on
    // whitespace and keeps the label on one line.
    // The lines the tab itself titles from come first; the text recovered from
    // the messages is only for sessions that emit neither.
    const collapsed = collapsePrompt(aiTitle ?? '')
        || collapsePrompt(lastPrompt)
        || collapsePrompt(derivedPrompt ?? '');
    if (!collapsed) {
        return fallbackName;
    }

    // Array.from splits by code point: slicing a string directly would cut an
    // emoji in half and render a replacement glyph.
    const label = Array.from(collapsed).slice(0, length).join('').trimEnd();
    return label || fallbackName;
}
