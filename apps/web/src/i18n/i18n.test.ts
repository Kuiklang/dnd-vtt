import { describe, expect, it } from "vitest";
import { en } from "./en";
import { th } from "./th";
import { translate } from "./index";

describe("i18n", () => {
  it("translates to Thai and falls back to English", () => {
    expect(translate("th", "nav.logout")).toBe("ออกจากระบบ");
    expect(translate("en", "nav.logout")).toBe("Log out");
  });
  it("Thai dictionary only uses known keys and covers every English key", () => {
    const enKeys = Object.keys(en).sort();
    expect(Object.keys(th).filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(th).sort()).toEqual(enKeys);
  });
  it("fills placeholders", () => {
    // No placeholder strings yet in the dictionary; the mechanism is still exercised.
    expect(translate("en", "common.save", { x: 1 })).toBe("Save");
  });
});
