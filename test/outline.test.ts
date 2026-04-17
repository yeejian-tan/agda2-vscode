import { describe, it, expect } from "vitest";
import { AgdaOutlineProvider, parseAgdaSymbols } from "../src/editor/outline.js";

describe("parseAgdaSymbols", () => {
  it("parses module, data/record, signatures and definitions", () => {
    const text = `
module Demo where

data Nat : Set where
record Pair (A B : Set) : Set where

id : Nat -> Nat
id x = x

_+_ : Nat -> Nat -> Nat
_+_ x y = x
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({
      name: s.name,
      kind: s.kind,
    }));

    expect(symbols).toEqual([
      { name: "Demo", kind: "module" },
      { name: "Nat", kind: "data" },
      { name: "Pair", kind: "record" },
      { name: "id", kind: "definition" },
      { name: "_+_", kind: "definition" },
    ]);
  });

  it("parses postulate blocks and ignores comments", () => {
    const text = `
module M where

{- data Hidden : Set where -}
postulate
  A : Set
  -- f : A
  f : A

g : A
g = f
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({
      name: s.name,
      kind: s.kind,
    }));

    expect(symbols).toEqual([
      { name: "M", kind: "module" },
      { name: "A", kind: "postulate" },
      { name: "f", kind: "postulate" },
      { name: "g", kind: "definition" },
    ]);
  });

  it("keeps latest line for repeated definitions", () => {
    const text = `
module Repeat where

f : Set
f = Set
f = Set
`.trim();

    const symbols = parseAgdaSymbols(text);
    const f = symbols.find((s) => s.name === "f");

    // In the trimmed test string, the last `f = Set` line is at index 4 (0-based).
    expect(f?.line).toBe(4);
  });

  it("groups declarations under the nearest module", () => {
    const text = `
module A where
a : Set

module B where
b : Set
`.trim();

    const lines = text.split("\n");
    const provider = new AgdaOutlineProvider();
    const symbols = provider.provideDocumentSymbols({
      getText: () => text,
      lineAt: (line: number) => ({ text: lines[line] }),
    } as any);

    expect(symbols?.map((s: any) => s.name)).toEqual(["A", "B"]);
    expect(symbols?.[0].children.map((s: any) => s.name)).toEqual(["a"]);
    expect(symbols?.[1].children.map((s: any) => s.name)).toEqual(["b"]);
  });

  // ---------------------------------------------------------------------------
  // Constructor and field parsing
  // ---------------------------------------------------------------------------

  it("parses data type constructors with kind 'constructor'", () => {
    const text = `
data Bool : Set where
  false : Bool
  true  : Bool
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({ name: s.name, kind: s.kind }));

    expect(symbols).toEqual([
      { name: "Bool", kind: "data" },
      { name: "false", kind: "constructor" },
      { name: "true", kind: "constructor" },
    ]);
  });

  it("parses record constructor keyword and field block", () => {
    const text = `
record Pair (A B : Set) : Set where
  constructor _,_
  field
    fst : A
    snd : B
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({ name: s.name, kind: s.kind }));

    expect(symbols).toEqual([
      { name: "Pair", kind: "record" },
      { name: "_,_", kind: "constructor" },
      { name: "fst", kind: "field" },
      { name: "snd", kind: "field" },
    ]);
  });

  it("parses inline field declaration (field name : type on one line)", () => {
    const text = `
record Box (A : Set) : Set where
  field contents : A
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({ name: s.name, kind: s.kind }));

    expect(symbols).toEqual([
      { name: "Box", kind: "record" },
      { name: "contents", kind: "field" },
    ]);
  });

  it("does not treat items after a data block as constructors", () => {
    const text = `
data Nat : Set where
  zero : Nat
  suc  : Nat
plus : Nat
plus x = x
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({ name: s.name, kind: s.kind }));

    expect(symbols).toEqual([
      { name: "Nat", kind: "data" },
      { name: "zero", kind: "constructor" },
      { name: "suc", kind: "constructor" },
      { name: "plus", kind: "definition" },
    ]);
  });

  it("handles multiple data types back-to-back: constructors stay with correct parent", () => {
    const text = `
data A : Set where
  a : A

data B : Set where
  b : B
`.trim();

    const symbols = parseAgdaSymbols(text).map((s) => ({ name: s.name, kind: s.kind }));

    expect(symbols).toEqual([
      { name: "A", kind: "data" },
      { name: "a", kind: "constructor" },
      { name: "B", kind: "data" },
      { name: "b", kind: "constructor" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AgdaOutlineProvider — nesting
// ---------------------------------------------------------------------------

describe("AgdaOutlineProvider nesting", () => {
  function makeProvider(text: string) {
    const lines = text.split("\n");
    const provider = new AgdaOutlineProvider();
    return provider.provideDocumentSymbols({
      getText: () => text,
      lineAt: (line: number) => ({ text: lines[line] }),
    } as any);
  }

  it("nests data constructors under their data type", () => {
    const text = `
data Bool : Set where
  false : Bool
  true  : Bool
`.trim();

    const symbols = makeProvider(text);
    expect(symbols?.map((s: any) => s.name)).toEqual(["Bool"]);
    expect(symbols?.[0].children.map((s: any) => s.name)).toEqual(["false", "true"]);
  });

  it("nests record constructor and fields under their record", () => {
    const text = `
record Pair (A B : Set) : Set where
  constructor _,_
  field
    fst : A
    snd : B
`.trim();

    const symbols = makeProvider(text);
    expect(symbols?.map((s: any) => s.name)).toEqual(["Pair"]);
    expect(symbols?.[0].children.map((s: any) => s.name)).toEqual(["_,_", "fst", "snd"]);
  });

  it("nests data/record members in a module, definitions stay as siblings", () => {
    const text = `
module M where
  data Nat : Set where
    zero : Nat
    suc  : Nat
  record Pair : Set where
    constructor mkPair
    field
      fst : Nat
  f : Nat
  f = zero
`.trim();

    const symbols = makeProvider(text);
    expect(symbols?.map((s: any) => s.name)).toEqual(["M"]);

    const children = symbols?.[0].children.map((s: any) => s.name);
    expect(children).toEqual(["Nat", "Pair", "f"]);

    const nat = symbols?.[0].children.find((s: any) => s.name === "Nat");
    expect(nat?.children.map((s: any) => s.name)).toEqual(["zero", "suc"]);

    const pair = symbols?.[0].children.find((s: any) => s.name === "Pair");
    expect(pair?.children.map((s: any) => s.name)).toEqual(["mkPair", "fst"]);
  });

  it("definition after a data type is a sibling, not a child", () => {
    const text = `
data Nat : Set where
  zero : Nat
f : Nat
f = zero
`.trim();

    const symbols = makeProvider(text);
    expect(symbols?.map((s: any) => s.name)).toEqual(["Nat", "f"]);
    expect(symbols?.[0].children.map((s: any) => s.name)).toEqual(["zero"]);
    expect(symbols?.[1].children).toEqual([]);
  });

  it("multiple top-level data types each own their constructors", () => {
    const text = `
data A : Set where
  a : A

data B : Set where
  b : B
`.trim();

    const symbols = makeProvider(text);
    expect(symbols?.map((s: any) => s.name)).toEqual(["A", "B"]);
    expect(symbols?.[0].children.map((s: any) => s.name)).toEqual(["a"]);
    expect(symbols?.[1].children.map((s: any) => s.name)).toEqual(["b"]);
  });
});
