import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { buildAgentHooks } from "../src/lib/agentHooks";
import {
  buildAgentSystemPrompt,
  buildSdkQueryOptions,
  sdkResumeId,
} from "../src/orchestrator";

const ORCHESTRATOR_PATH = join(import.meta.dir, "../src/orchestrator.ts");
const HOOK_FIX = "/tmp/console-agent-sdk-hooks";

describe("orchestrator SDK mode", () => {
  test("builds an AgentOS runtime contract for SDK project sessions", () => {
    const prompt = buildAgentSystemPrompt("c1");

    expect(prompt).toContain("AgentOS Console runtime");
    expect(prompt).toContain("Active project: c1");
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("pipeline-state.json");
    expect(prompt).toContain("SCRIPT -> VISUAL -> STORYBOARD -> VIDEO -> EDITING -> MUSIC -> SUBTITLE");
    expect(prompt).toContain("Do not claim you have no access to the local pipeline");
    expect(prompt).toContain("Before answering progress or next-step questions, you must call Read on pipeline-state.json");
    expect(prompt).toContain("Never ask the user to paste pipeline-state.json");
    expect(prompt).toContain("If pipeline-state.json exists, do not report every stage as pending confirmation");
    expect(prompt).toContain("Default to continuing from current_stage and next_action");
    expect(prompt).toContain("Do not end operational replies by asking whether to continue when next_action is known");
    expect(prompt).toContain("For status-only questions, report the concise next action instead of asking a confirmation question");
    expect(prompt).toContain("Never invent external CG/Maya/Deadline");
    expect(prompt).not.toContain("Messages API adapter");
  });

  test("does not keep a direct Messages API fallback in the orchestrator", () => {
    const source = readFileSync(ORCHESTRATOR_PATH, "utf-8");

    expect(source).not.toContain("createAnthropicMessagesSession");
    expect(source).not.toContain("shouldUseMessagesApiSession");
    expect(source).not.toContain("/v1/messages");
    expect(source).toContain("return createSession(project, resumeId)");
  });

  test("uses an isolated SDK tool surface while still loading project skills", () => {
    const options = buildSdkQueryOptions("c1", "/tmp/c1");

    expect(options.tools).toEqual(["Bash", "Read", "Edit", "Write", "Glob", "Grep"]);
    expect(options.allowedTools).toEqual(options.tools);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.plugins).toEqual([]);
    expect(options.settingSources).toEqual(["project"]);
  });

  test("adds a UserPromptSubmit hook that injects server-verified project state", async () => {
    rmSync(HOOK_FIX, { recursive: true, force: true });
    mkdirSync(HOOK_FIX, { recursive: true });
    writeFileSync(
      join(HOOK_FIX, "pipeline-state.json"),
      JSON.stringify({ current_stage: "VIDEO", next_action: "retry VIDEO" }),
    );

    const hooks = buildAgentHooks(HOOK_FIX);
    const callback = hooks?.UserPromptSubmit?.[0]?.hooks[0];
    expect(callback).toBeDefined();

    const output = await callback!(
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "s1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: HOOK_FIX,
        prompt: "查询现在的进度",
      },
      undefined,
      { signal: new AbortController().signal },
    );

    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput?.additionalContext).toContain("[Server-Verified Project Snapshot]");
    expect(output.hookSpecificOutput?.additionalContext).toContain("\"current_stage\": \"VIDEO\"");
    expect(output.hookSpecificOutput?.additionalContext).toContain("\"next_action\": \"retry VIDEO\"");
  });

  test("denies generated Write/Edit targets outside the project artifact layout", async () => {
    const hooks = buildAgentHooks(HOOK_FIX);
    const callback = hooks?.PreToolUse?.[0]?.hooks[0];
    expect(callback).toBeDefined();

    const denied = await callback!(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: HOOK_FIX,
        tool_name: "Write",
        tool_input: { file_path: "actors/actors.json" },
        tool_use_id: "tool1",
      },
      "tool1",
      { signal: new AbortController().signal },
    );
    expect(denied.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
    expect(denied.hookSpecificOutput?.permissionDecision).toBe("deny");

    const allowed = await callback!(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: HOOK_FIX,
        tool_name: "Write",
        tool_input: { file_path: "output/actors/actors.json" },
        tool_use_id: "tool2",
      },
      "tool2",
      { signal: new AbortController().signal },
    );
    expect(allowed.hookSpecificOutput?.permissionDecision).toBe("allow");
  });

  test("audits files created by Bash after tool use", async () => {
    rmSync(HOOK_FIX, { recursive: true, force: true });
    mkdirSync(HOOK_FIX, { recursive: true });
    writeFileSync(
      join(HOOK_FIX, "pipeline-state.json"),
      JSON.stringify({
        current_stage: "VIDEO",
        next_action: "generate VIDEO",
        last_error: null,
        stages: { VIDEO: { status: "running", artifacts: [] } },
        episodes: {},
      }),
    );

    const hooks = buildAgentHooks(HOOK_FIX);
    const pre = hooks?.PreToolUse?.[0]?.hooks[0];
    const post = hooks?.PostToolUse?.[0]?.hooks[0];
    expect(pre).toBeDefined();
    expect(post).toBeDefined();

    await pre!(
      {
        hook_event_name: "PreToolUse",
        session_id: "s1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: HOOK_FIX,
        tool_name: "Bash",
        tool_input: { command: "mkdir actors && touch actors/actors.json" },
        tool_use_id: "tool3",
      },
      "tool3",
      { signal: new AbortController().signal },
    );

    mkdirSync(join(HOOK_FIX, "actors"), { recursive: true });
    writeFileSync(join(HOOK_FIX, "actors", "actors.json"), "{}");

    const output = await post!(
      {
        hook_event_name: "PostToolUse",
        session_id: "s1",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: HOOK_FIX,
        tool_name: "Bash",
        tool_input: { command: "mkdir actors && touch actors/actors.json" },
        tool_response: {},
        tool_use_id: "tool3",
      },
      "tool3",
      { signal: new AbortController().signal },
    );

    expect(output.hookSpecificOutput?.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput?.additionalContext).toContain("Path contract violation after Bash");
  });

  test("does not pass legacy direct-message session ids into SDK resume", () => {
    expect(sdkResumeId("messages_818a92f5-f234-46ab-8f6b-e54f5867c590")).toBeUndefined();
    expect(sdkResumeId("55c6cdbd-0e33-4cf1-815c-3b3644cbcfdf")).toBe("55c6cdbd-0e33-4cf1-815c-3b3644cbcfdf");
    expect(buildSdkQueryOptions("c1", "/tmp/c1", "messages_old")).not.toHaveProperty("resume");
  });
});
