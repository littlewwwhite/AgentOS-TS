import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("markdown viking contract design html", () => {
  it("contains the layered architecture and migration plan", () => {
    const filePath = path.resolve("docs/markdown-viking-contract-design.html");
    const html = readFileSync(filePath, "utf8");

    expect(html).toContain("Markdown Source -> Artifact Envelope -> Compiled Manifest");
    expect(html).toContain("Source Layer");
    expect(html).toContain("Knowledge Layer");
    expect(html).toContain("Execution Layer");
    expect(html).toContain("What to Remove");
    expect(html).toContain("What to Keep");
    expect(html).toContain("Phase 1");
    expect(html).toContain("Phase 4");
  });
});
