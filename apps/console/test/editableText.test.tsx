import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditableText } from "../src/components/common/EditableText";

describe("EditableText", () => {
  test("empty single-line placeholder reserves inline width and stays on one line", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditableText, {
        value: "",
        onChange: () => undefined,
        placeholder: "（本集标题）",
        ariaLabel: "标题",
      }),
    );

    expect(html).toContain("min-width:");
    expect(html).toContain("whitespace-nowrap");
  });

  test("multiline placeholder does not force single-line width reservation", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditableText, {
        value: "",
        onChange: () => undefined,
        placeholder: "（动作描述）",
        multiline: true,
        ariaLabel: "动作描述",
      }),
    );

    expect(html).not.toContain("min-width:");
    expect(html).not.toContain("whitespace-nowrap");
  });
});
