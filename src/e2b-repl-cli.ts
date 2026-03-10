export interface E2BReplCliArgs {
  connectSandboxId: string | null;
  localWorkspaceOverride: string | null;
  restoreWorkspaceOnStart: boolean;
}

export interface RestoreWorkspaceDecision {
  connectSandboxId: string | null;
  restoreWorkspaceOnStart: boolean;
  localWorkspaceExists: boolean;
}

export function parseE2BReplCliArgs(args: string[]): E2BReplCliArgs {
  let connectSandboxId: string | null = null;
  let localWorkspaceOverride: string | null = null;
  let restoreWorkspaceOnStart = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sandbox" && args[i + 1]) {
      connectSandboxId = args[++i];
      continue;
    }

    if (args[i] === "--workspace" && args[i + 1]) {
      localWorkspaceOverride = args[++i];
      continue;
    }

    if (args[i] === "--restore-workspace") {
      restoreWorkspaceOnStart = true;
    }
  }

  return {
    connectSandboxId,
    localWorkspaceOverride,
    restoreWorkspaceOnStart,
  };
}

export function shouldRestoreWorkspaceOnStart(
  input: RestoreWorkspaceDecision,
): boolean {
  return (
    input.restoreWorkspaceOnStart &&
    input.connectSandboxId === null &&
    input.localWorkspaceExists
  );
}
