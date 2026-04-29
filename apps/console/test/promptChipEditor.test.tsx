import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptRefText } from "../src/components/Viewer/views/PromptChipEditor";

describe("PromptRefText", () => {
  test("renders prompt refs with light saturated highlights by asset kind", () => {
    const html = renderToStaticMarkup(
      React.createElement(PromptRefText, {
        text: "@act_001 在 @loc_001 手持 @prp_001。",
        dict: {
          act_001: "Rosalind",
          loc_001: "Laundry Room",
          prp_001: "Spiked Whip",
        },
      }),
    );

    expect(html).toContain("Rosalind");
    expect(html).toContain("bg-[#e7ff5f]");
    expect(html).toContain("border-[#b7d900]");
    expect(html).toContain("Laundry Room");
    expect(html).toContain("bg-[#8ff7ff]");
    expect(html).toContain("border-[#39cfe0]");
    expect(html).toContain("Spiked Whip");
    expect(html).toContain("bg-[#ffd1f0]");
    expect(html).toContain("border-[#f58acb]");
  });
});
