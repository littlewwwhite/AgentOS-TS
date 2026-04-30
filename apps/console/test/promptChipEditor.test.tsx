import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { PromptRefText, replacePromptRef } from "../src/components/Viewer/views/PromptChipEditor";

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

  test("renders a same-kind asset dropdown for the selected prompt ref", () => {
    const html = renderToStaticMarkup(
      React.createElement(PromptRefText, {
        text: "@act_001 在 @loc_001。",
        dict: {
          act_001: "Rosalind",
          act_002: "Cyrus",
          loc_001: "Laundry Room",
        },
        catalog: {
          actor: [
            { id: "act_001", name: "Rosalind" },
            { id: "act_002", name: "Cyrus" },
          ],
          location: [{ id: "loc_001", name: "Laundry Room" }],
          prop: [],
        },
        selectedRefKey: "0:@act_001",
        onSelectRef: () => undefined,
        onReplaceRef: () => undefined,
      }),
    );

    expect(html).toContain("role=\"menu\"");
    expect(html).toContain("替换为 Cyrus");
    expect(html).toContain("Cyrus");
    expect(html).not.toContain("替换为 Laundry Room");
  });

  test("opens the asset dropdown only for the clicked occurrence", () => {
    const html = renderToStaticMarkup(
      React.createElement(PromptRefText, {
        text: "@act_001 走近 @act_001。",
        dict: {
          act_001: "Rosalind",
          act_002: "Cyrus",
        },
        catalog: {
          actor: [
            { id: "act_001", name: "Rosalind" },
            { id: "act_002", name: "Cyrus" },
          ],
          location: [],
          prop: [],
        },
        selectedRefKey: "12:@act_001",
        onSelectRef: () => undefined,
        onReplaceRef: () => undefined,
      }),
    );

    expect(html.match(/role="menu"/g)?.length).toBe(1);
  });

  test("replaces the selected occurrence instead of the first matching ref", () => {
    const next = replacePromptRef(
      "@act_001 走近 @act_001。",
      { raw: "@act_001", id: "act_001", index: 12, occurrenceKey: "12:@act_001" },
      "act_002",
    );

    expect(next).toBe("@act_001 走近 @act_002。");
  });

  test("clears the open dropdown from outside clicks and escape", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/PromptChipEditor.tsx"),
      "utf-8",
    );

    expect(source).toContain("document.addEventListener(\"pointerdown\"");
    expect(source).toContain("data-prompt-ref-interactive");
    expect(source).toContain("event.key === \"Escape\"");
    expect(source).toContain("onClearSelectedRef?.()");
  });
});
