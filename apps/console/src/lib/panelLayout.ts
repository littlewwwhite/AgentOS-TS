import type { ViewKind } from "../types";

export interface PanelWidthBounds {
  min: number;
  max: number;
  default: number;
}

export type ChatPanelMode = "default" | "storyboard";

export const NAVIGATOR_PANEL: PanelWidthBounds = {
  min: 220,
  max: 420,
  default: 260,
};

export const CHAT_PANEL_DEFAULT: PanelWidthBounds = {
  min: 340,
  max: 720,
  default: 560,
};

export const CHAT_PANEL_STORYBOARD: PanelWidthBounds = {
  min: 280,
  max: 520,
  default: 320,
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function clampPanelWidth(
  width: number,
  bounds: PanelWidthBounds,
): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

export function readPanelWidthValue(
  rawValue: unknown,
  bounds: PanelWidthBounds,
): number {
  const parsed = finiteNumber(rawValue);
  if (parsed === null) return bounds.default;
  return clampPanelWidth(parsed, bounds);
}

export function chatPanelModeForView(view: ViewKind | null | undefined): ChatPanelMode {
  return view === "storyboard" || view === "video-grid" ? "storyboard" : "default";
}

export function isChatAutoHiddenView(view: ViewKind | null | undefined): boolean {
  return view === "storyboard" || view === "video-grid";
}

export function shouldRenderChatPane({
  view,
  isRestored,
}: {
  view: ViewKind | null | undefined;
  isRestored: boolean;
}): boolean {
  return !isChatAutoHiddenView(view) || isRestored;
}

export function chatPanelBoundsForMode(mode: ChatPanelMode): PanelWidthBounds {
  return mode === "storyboard" ? CHAT_PANEL_STORYBOARD : CHAT_PANEL_DEFAULT;
}

export function minContentWidthForView(view: ViewKind | null | undefined): number {
  return view === "storyboard" || view === "video-grid" ? 600 : 420;
}

export function fitPanelWidths({
  viewportWidth,
  navigatorWidth,
  chatWidth,
  view,
}: {
  viewportWidth: number;
  navigatorWidth: number;
  chatWidth: number;
  view: ViewKind | null | undefined;
}): { navigatorWidth: number; chatWidth: number } {
  const nextNavigatorWidth = clampPanelWidth(navigatorWidth, NAVIGATOR_PANEL);
  const chatBounds = chatPanelBoundsForMode(chatPanelModeForView(view));
  const nextChatWidth = clampPanelWidth(chatWidth, chatBounds);
  const maxPanelsWidth = Math.max(
    NAVIGATOR_PANEL.min + chatBounds.min,
    viewportWidth - minContentWidthForView(view),
  );

  let fittedNavigatorWidth = nextNavigatorWidth;
  let fittedChatWidth = nextChatWidth;
  let overflow = fittedNavigatorWidth + fittedChatWidth - maxPanelsWidth;

  if (overflow <= 0) {
    return {
      navigatorWidth: fittedNavigatorWidth,
      chatWidth: fittedChatWidth,
    };
  }

  const chatSlack = fittedChatWidth - chatBounds.min;
  const chatReduction = Math.min(chatSlack, overflow);
  fittedChatWidth -= chatReduction;
  overflow -= chatReduction;

  if (overflow > 0) {
    const navigatorSlack = fittedNavigatorWidth - NAVIGATOR_PANEL.min;
    const navigatorReduction = Math.min(navigatorSlack, overflow);
    fittedNavigatorWidth -= navigatorReduction;
  }

  return {
    navigatorWidth: fittedNavigatorWidth,
    chatWidth: fittedChatWidth,
  };
}
