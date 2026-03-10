import { describe, expect, it } from "vitest";
import {
  parseE2BReplCliArgs,
  shouldRestoreWorkspaceOnStart,
} from "../src/e2b-repl-cli.js";

describe("parseE2BReplCliArgs", () => {
  it("disables workspace restore by default", () => {
    expect(parseE2BReplCliArgs([])).toEqual({
      connectSandboxId: null,
      localWorkspaceOverride: null,
      restoreWorkspaceOnStart: false,
    });
  });

  it("parses reconnect and workspace override without enabling restore", () => {
    expect(
      parseE2BReplCliArgs([
        "--sandbox",
        "sbx-123",
        "--workspace",
        "./tmp/workspace",
      ]),
    ).toEqual({
      connectSandboxId: "sbx-123",
      localWorkspaceOverride: "./tmp/workspace",
      restoreWorkspaceOnStart: false,
    });
  });

  it("enables workspace restore only with the explicit flag", () => {
    expect(
      parseE2BReplCliArgs([
        "--restore-workspace",
        "--workspace",
        "./tmp/workspace",
      ]),
    ).toEqual({
      connectSandboxId: null,
      localWorkspaceOverride: "./tmp/workspace",
      restoreWorkspaceOnStart: true,
    });
  });
});

describe("shouldRestoreWorkspaceOnStart", () => {
  it("requires explicit opt-in and an existing local workspace", () => {
    expect(
      shouldRestoreWorkspaceOnStart({
        connectSandboxId: null,
        restoreWorkspaceOnStart: false,
        localWorkspaceExists: true,
      }),
    ).toBe(false);

    expect(
      shouldRestoreWorkspaceOnStart({
        connectSandboxId: null,
        restoreWorkspaceOnStart: true,
        localWorkspaceExists: false,
      }),
    ).toBe(false);
  });

  it("never restores when reconnecting to an existing sandbox", () => {
    expect(
      shouldRestoreWorkspaceOnStart({
        connectSandboxId: "sbx-123",
        restoreWorkspaceOnStart: true,
        localWorkspaceExists: true,
      }),
    ).toBe(false);
  });

  it("restores only for a fresh sandbox with explicit opt-in", () => {
    expect(
      shouldRestoreWorkspaceOnStart({
        connectSandboxId: null,
        restoreWorkspaceOnStart: true,
        localWorkspaceExists: true,
      }),
    ).toBe(true);
  });
});
