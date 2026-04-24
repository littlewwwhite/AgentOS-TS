import { describe, expect, test } from "bun:test";
import {
  nextSlashCommandIndex,
  normalizeSlashCommands,
  visibleSlashCommands,
} from "../src/lib/slashCommands";

describe("slash command helpers", () => {
  test("normalizes SDK command names into slash-prefixed commands", () => {
    expect(normalizeSlashCommands(["help", "/status", "help"])).toEqual(["/help", "/status"]);
  });

  test("filters commands unavailable in this console environment", () => {
    expect(normalizeSlashCommands(["/help", "/rewind", "rewind", "/wangwen"])).toEqual(["/help"]);
  });

  test("shows fallback Claude Code commands while the SDK session is not initialized", () => {
    expect(visibleSlashCommands("/", undefined)).toContain("/video-gen");
  });

  test("filters commands by typed prefix", () => {
    expect(visibleSlashCommands("/sk", ["/skills", "/status"])).toEqual(["/skills"]);
  });

  test("hides command picker after a command token is completed", () => {
    expect(visibleSlashCommands("/video-gen ", ["/video-gen"])).toEqual([]);
  });

  test("wraps keyboard selection through visible command options", () => {
    expect(nextSlashCommandIndex(0, 3, "down")).toBe(1);
    expect(nextSlashCommandIndex(2, 3, "down")).toBe(0);
    expect(nextSlashCommandIndex(0, 3, "up")).toBe(2);
    expect(nextSlashCommandIndex(0, 0, "down")).toBe(0);
  });
});
