/**
 * Pure builder for the text shown on a status bar item.
 *
 * The project name alone cannot tell two tabs of the same project apart: the
 * disambiguating suffix ("DOAM-2") is positional, assigned by creation order
 * among the *currently active* sessions, so it slides onto a different session
 * as soon as an older one drops off the bar.
 *
 * The Claude Code tab titles itself with the user's latest prompt, truncated —
 * verified in VS Code's persisted editor layout, e.g.
 * `"providedId":"claudeVSCodePanel","title":"leia o /private/tmp/clau…"`. That
 * same text is in the session's `.jsonl` as `{"type":"last-prompt"}`, so the
 * item can carry the opening characters of the very string the tab is showing.
 *
 * Pure so the behaviour is testable without a VS Code host, following the same
 * pattern as `getContextLimitForModel` in contextLimit.ts.
 */

/**
 * @param lastPrompt    Latest user prompt from the session file, or '' when the
 *                      session records none (roughly one in eight).
 * @param fallbackName  Project name to use when there is no prompt to show.
 * @param length        Characters to keep. Zero or less turns the feature off.
 */
export function buildItemLabel(opts: {
    lastPrompt: string;
    fallbackName: string;
    length: number;
}): string {
    const { lastPrompt, fallbackName, length } = opts;

    if (length <= 0) {
        return fallbackName;
    }

    // A prompt can open with a heading, a blank line, or pasted indentation.
    // Collapsing first stops the visible characters from being spent on
    // whitespace and keeps the label on one line.
    const collapsed = (lastPrompt ?? '').replace(/\s+/g, ' ').trim();
    if (!collapsed) {
        return fallbackName;
    }

    // Array.from splits by code point: slicing a string directly would cut an
    // emoji in half and render a replacement glyph.
    const label = Array.from(collapsed).slice(0, length).join('').trimEnd();
    return label || fallbackName;
}
