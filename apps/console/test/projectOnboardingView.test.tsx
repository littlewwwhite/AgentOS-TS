import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectOnboardingView } from "../src/components/Viewer/views/ProjectOnboardingView";

describe("ProjectOnboardingView", () => {
  test("renders new-project entry, upload guidance, and e2e steps", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectOnboardingView, {
        onCreate: () => undefined,
        isSubmitting: false,
      }),
    );

    expect(html).toContain("新建项目");
    expect(html).toContain("上传源文档");
    expect(html).toContain("一步一步开始");
  });
});
