import { describe, it, expect } from "vitest";
import { parseAgdaSymbols } from "../src/editor/outline.js";

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

    expect(f?.line).toBe(4);
  });
});
