import * as vscode from "vscode";

export type ParsedAgdaSymbolKind = "module" | "data" | "record" | "postulate" | "definition";

export interface ParsedAgdaSymbol {
  name: string;
  kind: ParsedAgdaSymbolKind;
  line: number;
}

const RESERVED_HEAD_TOKENS = new Set([
  "open",
  "import",
  "private",
  "abstract",
  "mutual",
  "where",
  "with",
  "instance",
  "public",
  "primitive",
  "opaque",
  "unfolding",
  "rewrite",
  "quote",
  "quoteTerm",
  "unquote",
  "unquoteDecl",
  "unquoteDef",
  "using",
  "hiding",
  "renaming",
  "to",
  "let",
  "infix",
  "infixl",
  "infixr",
  "syntax",
  "constructor",
  "field",
  "pattern",
  "macro",
  "variable",
  "postulate",
  "module",
  "data",
  "record",
]);

function stripComments(lines: string[]): string[] {
  const output: string[] = [];
  let blockDepth = 0;

  for (const line of lines) {
    let i = 0;
    let clean = "";

    while (i < line.length) {
      const pair = line.slice(i, i + 2);

      if (blockDepth > 0) {
        if (pair === "{-") {
          blockDepth++;
          i += 2;
          continue;
        }
        if (pair === "-}") {
          blockDepth--;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (pair === "{-") {
        blockDepth++;
        i += 2;
        continue;
      }
      if (pair === "--") {
        break;
      }

      clean += line[i];
      i += 1;
    }

    output.push(clean);
  }

  return output;
}

function normalizeName(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith("(") && text.endsWith(")")) {
    const inner = text.slice(1, -1).trim();
    return inner || null;
  }
  const token = text.split(/\s+/)[0];
  return token || null;
}

function nameBefore(trimmed: string, marker: ":" | "="): string | null {
  const idx = trimmed.indexOf(marker);
  if (idx < 0) return null;
  return normalizeName(trimmed.slice(0, idx));
}

function isEligibleDefinitionName(name: string): boolean {
  return name.length > 0 && !RESERVED_HEAD_TOKENS.has(name);
}

function symbolKind(kind: ParsedAgdaSymbolKind): vscode.SymbolKind {
  switch (kind) {
    case "module":
      return vscode.SymbolKind.Module;
    case "data":
      return vscode.SymbolKind.Enum;
    case "record":
      return vscode.SymbolKind.Struct;
    case "postulate":
      return vscode.SymbolKind.Constant;
    case "definition":
      return vscode.SymbolKind.Function;
  }
}

function createRangeForLine(document: vscode.TextDocument, line: number): vscode.Range {
  const text = document.lineAt(line).text;
  return new vscode.Range(line, 0, line, text.length);
}

function createSelectionRange(
  document: vscode.TextDocument,
  symbol: ParsedAgdaSymbol,
): vscode.Range {
  const text = document.lineAt(symbol.line).text;
  const fallback = text.search(/\S/);
  const start = text.indexOf(symbol.name);
  const char = start >= 0 ? start : fallback >= 0 ? fallback : 0;
  return new vscode.Range(symbol.line, char, symbol.line, char + symbol.name.length);
}

function toDocumentSymbol(
  document: vscode.TextDocument,
  symbol: ParsedAgdaSymbol,
): vscode.DocumentSymbol {
  return new vscode.DocumentSymbol(
    symbol.name,
    "",
    symbolKind(symbol.kind),
    createRangeForLine(document, symbol.line),
    createSelectionRange(document, symbol),
  );
}

export function parseAgdaSymbols(text: string): ParsedAgdaSymbol[] {
  const lines = text.split(/\r?\n/);
  const cleanLines = stripComments(lines);
  const declarations: ParsedAgdaSymbol[] = [];
  const functionDecls = new Map<string, ParsedAgdaSymbol>();
  let blockSignatureIndent: number | null = null;
  let blockSignatureKind: ParsedAgdaSymbolKind | null = null;

  for (let line = 0; line < cleanLines.length; line++) {
    const cleanLine = cleanLines[line];
    const trimmed = cleanLine.trim();
    const indent = cleanLine.length - cleanLine.trimStart().length;

    if (!trimmed) continue;

    if (blockSignatureIndent !== null && indent <= blockSignatureIndent) {
      blockSignatureIndent = null;
      blockSignatureKind = null;
    }

    if (blockSignatureIndent !== null && blockSignatureKind !== null) {
      const postulateName = nameBefore(trimmed, ":");
      if (postulateName && isEligibleDefinitionName(postulateName)) {
        declarations.push({ name: postulateName, kind: blockSignatureKind, line });
      }
      continue;
    }

    const moduleMatch = trimmed.match(/^module\s+([^\s({:]+)/);
    if (moduleMatch) {
      declarations.push({ name: moduleMatch[1], kind: "module", line });
      continue;
    }

    const dataMatch = trimmed.match(/^(?:inductive\s+|coinductive\s+)?data\s+([^\s({:]+)/);
    if (dataMatch) {
      declarations.push({ name: dataMatch[1], kind: "data", line });
      continue;
    }
    const codataMatch = trimmed.match(/^codata\s+([^\s({:]+)/);
    if (codataMatch) {
      declarations.push({ name: codataMatch[1], kind: "data", line });
      continue;
    }

    const recordMatch = trimmed.match(/^record\s+([^\s({:]+)/);
    if (recordMatch) {
      declarations.push({ name: recordMatch[1], kind: "record", line });
      continue;
    }

    if (trimmed.startsWith("postulate")) {
      blockSignatureIndent = indent;
      blockSignatureKind = "postulate";
      const inlineName = nameBefore(trimmed.slice("postulate".length).trim(), ":");
      if (inlineName && isEligibleDefinitionName(inlineName)) {
        declarations.push({ name: inlineName, kind: "postulate", line });
      }
      continue;
    }

    if (trimmed.startsWith("primitive")) {
      blockSignatureIndent = indent;
      blockSignatureKind = "postulate";
      const inlineName = nameBefore(trimmed.slice("primitive".length).trim(), ":");
      if (inlineName && isEligibleDefinitionName(inlineName)) {
        declarations.push({ name: inlineName, kind: "postulate", line });
      }
      continue;
    }

    const signatureName = nameBefore(trimmed, ":");
    if (signatureName && isEligibleDefinitionName(signatureName)) {
      if (!functionDecls.has(signatureName)) {
        functionDecls.set(signatureName, { name: signatureName, kind: "definition", line });
      }
      continue;
    }

    const definitionName = nameBefore(trimmed, "=");
    if (definitionName && isEligibleDefinitionName(definitionName)) {
      functionDecls.set(definitionName, { name: definitionName, kind: "definition", line });
    }
  }

  const all = [...declarations, ...functionDecls.values()];
  all.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return all;
}

export class AgdaOutlineProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const parsed = parseAgdaSymbols(document.getText());
    const topLevelSymbols: vscode.DocumentSymbol[] = [];
    let currentModule: vscode.DocumentSymbol | null = null;
    for (const symbol of parsed) {
      if (symbol.kind === "module") {
        const moduleSymbol = toDocumentSymbol(document, symbol);
        topLevelSymbols.push(moduleSymbol);
        currentModule = moduleSymbol;
        continue;
      }

      const docSymbol = toDocumentSymbol(document, symbol);
      if (currentModule) {
        currentModule.children.push(docSymbol);
      } else {
        topLevelSymbols.push(docSymbol);
      }
    }
    return topLevelSymbols;
  }
}
