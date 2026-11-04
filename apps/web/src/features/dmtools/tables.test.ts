import { describe, expect, it } from "vitest";
import { formatEntries, parseEntries } from "./TablesPanel";

describe("random table text", () => {
  it("parses ranges and single numbers, and reports unreadable lines", () => {
    const { entries, bad } = parseEntries("1-2 Clear skies\n3: Rain\n4–6) Storm\n\nnonsense\n7 . Hail");
    expect(entries).toEqual([
      { min: 1, max: 2, text: "Clear skies" },
      { min: 3, max: 3, text: "Rain" },
      { min: 4, max: 6, text: "Storm" },
      { min: 7, max: 7, text: "Hail" },
    ]);
    expect(bad).toEqual([5]);
    expect(parseEntries(formatEntries(entries)).entries).toEqual(entries);
  });
});
