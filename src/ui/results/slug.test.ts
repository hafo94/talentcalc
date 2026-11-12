import { describe, expect, it } from "vitest";
import { slug } from "./slug";

describe("slug", () => {
  it("makes test ids", () => {
    expect(slug("Seal of Command (proc)")).toBe("seal-of-command-proc");
    expect(slug("Shadow Word: Pain")).toBe("shadow-word-pain");
    expect(slug("Main-hand melee")).toBe("main-hand-melee");
  });
});
