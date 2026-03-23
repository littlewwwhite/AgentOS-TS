import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("openviking pipeline comparison html", () => {
  it("exists and contains the three comparison stages", () => {
    const filePath = path.resolve("docs/openviking-pipeline-comparison.html");
    const html = readFileSync(filePath, "utf8");

    expect(html).toContain("Before Retrofit");
    expect(html).toContain("Current State");
    expect(html).toContain("Systemic Shift");
    expect(html).toContain("Long-form Novel to Final Video");
    expect(html).toContain("Script Adaptation");
    expect(html).toContain("Art Direction");
    expect(html).toContain("Video Production");
    expect(html).toContain("Review and Iteration");
  });
});
