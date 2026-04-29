import { describe, expect, test } from "bun:test";
import {
  CHAT_PANEL_DEFAULT,
  CHAT_PANEL_STORYBOARD,
  NAVIGATOR_PANEL,
  chatPanelModeForView,
  clampPanelWidth,
  fitPanelWidths,
  readPanelWidthValue,
} from "../src/lib/panelLayout";

describe("panel layout helpers", () => {
  test("clamps resized panel widths to configured bounds", () => {
    expect(clampPanelWidth(120, NAVIGATOR_PANEL)).toBe(NAVIGATOR_PANEL.min);
    expect(clampPanelWidth(999, NAVIGATOR_PANEL)).toBe(NAVIGATOR_PANEL.max);
    expect(clampPanelWidth(300, NAVIGATOR_PANEL)).toBe(300);
  });

  test("falls back to defaults for missing or invalid stored widths", () => {
    expect(readPanelWidthValue(null, CHAT_PANEL_DEFAULT)).toBe(CHAT_PANEL_DEFAULT.default);
    expect(readPanelWidthValue("not-a-number", CHAT_PANEL_DEFAULT)).toBe(CHAT_PANEL_DEFAULT.default);
    expect(readPanelWidthValue("900", CHAT_PANEL_DEFAULT)).toBe(CHAT_PANEL_DEFAULT.max);
  });

  test("uses a compact chat preset for storyboard-heavy editing", () => {
    expect(chatPanelModeForView("storyboard")).toBe("storyboard");
    expect(chatPanelModeForView("video-grid")).toBe("storyboard");
    expect(CHAT_PANEL_STORYBOARD.default).toBeLessThan(CHAT_PANEL_DEFAULT.default);
    expect(chatPanelModeForView("script")).toBe("default");
  });

  test("shrinks side panels before sacrificing the main content area", () => {
    const fitted = fitPanelWidths({
      viewportWidth: 980,
      navigatorWidth: 360,
      chatWidth: 560,
      view: "storyboard",
    });

    expect(fitted.navigatorWidth).toBeLessThanOrEqual(360);
    expect(fitted.chatWidth).toBeLessThanOrEqual(560);
    expect(fitted.navigatorWidth + fitted.chatWidth).toBeLessThanOrEqual(980 - 480);
    expect(fitted.chatWidth).toBeGreaterThanOrEqual(CHAT_PANEL_STORYBOARD.min);
  });
});
