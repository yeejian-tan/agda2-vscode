/**
 * Unit tests for HighlightingManager.provideHover.
 *
 * The hover provider surfaces type information from the `note` field that Agda
 * attaches to each highlighting token.  It returns a fenced `agda` code block
 * so VS Code renders it with syntax highlighting.
 *
 * Inspired by vscode-haskell's hover middleware which surfaces HLS type
 * signatures; here we use the equivalent data embedded in Agda's highlighting
 * payload without an extra round-trip to Agda.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Position, Range, MarkdownString } from "vscode";
import { HighlightingManager } from "../src/core/highlighting.js";
import type { HighlightingPayload } from "../src/agda/responses.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock TextDocument for ASCII-only text.
 * Code-point offsets == UTF-16 offsets for ASCII, which keeps the helper simple.
 */
function mockDocument(uri: string, text: string) {
  const lines = text.split("\n");

  function offsetAt(pos: Position): number {
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    return offset + Math.min(pos.character, (lines[pos.line] ?? "").length);
  }

  function positionAt(offset: number): Position {
    let line = 0;
    let col = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === "\n") {
        line++;
        col = 0;
      } else {
        col++;
      }
    }
    return new Position(line, col);
  }

  return {
    uri: { toString: () => uri, fsPath: uri },
    getText(range?: Range) {
      if (!range) return text;
      return text.slice(offsetAt(range.start), offsetAt(range.end));
    },
    offsetAt,
    positionAt,
    lineAt(line: number) {
      return { text: lines[line] ?? "" };
    },
  } as any;
}

function mockEditor(uri: string, text: string) {
  return {
    document: mockDocument(uri, text),
    setDecorations: () => {},
  } as any;
}

/**
 * Build a HighlightingPayload with a single entry covering the 1-based
 * code-point range [from, to).
 */
function singleEntry(from: number, to: number, atoms: string[], note: string): HighlightingPayload {
  return {
    remove: false,
    payload: [
      {
        range: [from, to] as [number, number],
        atoms,
        tokenBased: "TokenBased",
        note,
        definitionSite: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HighlightingManager.provideHover", () => {
  let manager: HighlightingManager;

  beforeEach(() => {
    manager = new HighlightingManager();
  });

  it("returns undefined when no highlighting data has been applied for the document", () => {
    const doc = mockDocument("file:///a.agda", "foo");
    expect(manager.provideHover(doc, new Position(0, 0))).toBeUndefined();
  });

  it("returns undefined when the cursor is outside all highlighted ranges", () => {
    // "foo bar" — apply highlighting to "foo" (Agda 1-based offsets [1, 4))
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    manager.applyHighlighting(editor, singleEntry(1, 4, ["function"], "foo : Set"));

    // Position (0, 3) is the space after "foo" — outside the half-open range [0,0)–(0,3)
    expect(manager.provideHover(editor.document, new Position(0, 3))).toBeUndefined();
  });

  it("returns undefined when the matching entry has an empty note", () => {
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    manager.applyHighlighting(editor, singleEntry(1, 4, ["keyword"], ""));

    expect(manager.provideHover(editor.document, new Position(0, 1))).toBeUndefined();
  });

  it("returns a Hover with an agda-fenced code block when the entry has a note", () => {
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    manager.applyHighlighting(editor, singleEntry(1, 4, ["function"], "foo : Set -> Set"));

    const hover = manager.provideHover(editor.document, new Position(0, 1));
    expect(hover).toBeDefined();
    const content = hover!.contents[0] as MarkdownString;
    expect(content).toBeInstanceOf(MarkdownString);
    expect(content.value).toBe("```agda\nfoo : Set -> Set\n```");
  });

  it("hover range matches the highlighted token range", () => {
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    // Agda [1, 4) → vscode Range(0,0, 0,3) for ASCII text
    manager.applyHighlighting(editor, singleEntry(1, 4, ["function"], "foo : Set"));

    const hover = manager.provideHover(editor.document, new Position(0, 0));
    expect(hover!.range).toEqual(new Range(0, 0, 0, 3));
  });

  it("returns hover for any position inside the token range", () => {
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    manager.applyHighlighting(editor, singleEntry(1, 4, ["function"], "foo : Set"));

    // All positions inside "foo" (columns 0, 1, 2) should return a hover
    expect(manager.provideHover(editor.document, new Position(0, 0))).toBeDefined();
    expect(manager.provideHover(editor.document, new Position(0, 1))).toBeDefined();
    expect(manager.provideHover(editor.document, new Position(0, 2))).toBeDefined();
    // Column 3 (the space) is outside the half-open range
    expect(manager.provideHover(editor.document, new Position(0, 3))).toBeUndefined();
  });

  it("skips entries with empty notes and returns the first entry that has one", () => {
    const uri = "file:///a.agda";
    const text = "foo bar";
    const editor = mockEditor(uri, text);
    manager.applyHighlighting(editor, {
      remove: false,
      payload: [
        // keyword entry covers "foo" but has no note
        {
          range: [1, 4] as [number, number],
          atoms: ["keyword"],
          tokenBased: "TokenBased",
          note: "",
          definitionSite: null,
        },
        // function entry also covers "foo" and has a note
        {
          range: [1, 4] as [number, number],
          atoms: ["function"],
          tokenBased: "TokenBased",
          note: "foo : A -> B",
          definitionSite: null,
        },
      ],
    });

    const hover = manager.provideHover(editor.document, new Position(0, 0));
    expect(hover).toBeDefined();
    expect((hover!.contents[0] as MarkdownString).value).toContain("foo : A -> B");
  });

  it("handles unicode type signatures in notes", () => {
    const uri = "file:///a.agda";
    const text = "id x = x";
    const editor = mockEditor(uri, text);
    // "id" is at Agda offsets [1, 3)
    manager.applyHighlighting(editor, singleEntry(1, 3, ["function"], "id : {A : Set} -> A -> A"));

    const hover = manager.provideHover(editor.document, new Position(0, 0));
    expect(hover).toBeDefined();
    expect((hover!.contents[0] as MarkdownString).value).toContain("id : {A : Set} -> A -> A");
  });
});
