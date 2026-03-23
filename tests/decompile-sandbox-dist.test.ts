import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require(path.resolve("scripts/sandbox-app-runtime/browser-api/node_modules/typescript"));
const scriptPath = path.resolve("scripts/decompile-sandbox-dist.cjs");
const decompiler = require(scriptPath);

describe("decompile-sandbox-dist", () => {
  it("exports module classification helpers", () => {
    expect(typeof decompiler.classifyModule).toBe("function");
    expect(typeof decompiler.groupInterestingModules).toBe("function");
    expect(typeof decompiler.collectTopLevelSegments).toBe("function");
  });

  it("collects interesting top-level statements outside bundle modules", () => {
    const sourceText = [
      "var vendor=g(()=>{return 1;});",
      "var sessionRoot=path.join(process.env.HOME, \"a0\", \"workspace\"), SessionManager=class{constructor(){this.sessionWorkspaces=new Map();} async getSessionWorkspace(){return sessionRoot;}};",
      "app.use(\"/api/skills\", skillsRouter);",
    ].join("\n");
    const sourceFile = ts.createSourceFile("virtual.js", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });

    const segments = decompiler.collectTopLevelSegments(sourceFile, sourceText, printer);

    expect(segments.map((segment: { originType: string }) => segment.originType)).toEqual([
      "top-level",
      "top-level",
    ]);
    expect(segments.map((segment: { symbol: string }) => segment.symbol)).toEqual([
      "sessionRoot-SessionManager",
      "app-use-api-skills",
    ]);
    expect(segments.map((segment: { bucket: string }) => segment.bucket)).toEqual([
      "session-workspace",
      "routes-skills",
    ]);
  });

  it("classifies workspace/session snippets into the session-workspace bucket", () => {
    const result = decompiler.classifyModule({
      symbol: "abc",
      rawPreview:
        "var abc=g(()=>{let root='/home/node/a0/workspace'; let sessionWorkspaces=new Map(); let cwd='/home/node/a0/workspace/123/workspace';});",
      printed: "",
      interesting: true,
    });

    expect(result).toBe("session-workspace");
  });

  it("classifies worker callback snippets into the agent-worker-bridge bucket", () => {
    const result = decompiler.classifyModule({
      symbol: "def",
      rawPreview:
        "var def=g(()=>{let url=`${je.get(\"AGENT_WORKER_BASE_URL\")}/api/agent/claude/messages`; let secret=je.get(\"AGENT_WORKER_SECRET\");});",
      printed: "",
      interesting: true,
    });

    expect(result).toBe("agent-worker-bridge");
  });

  it("classifies skills route snippets into the routes-skills bucket", () => {
    const result = decompiler.classifyModule({
      symbol: "ghi",
      rawPreview:
        "var ghi=g(()=>{app.use('/api/skills', Wa); app.use('/api/skills/files', Wb);});",
      printed: "",
      interesting: true,
    });

    expect(result).toBe("routes-skills");
  });

  it("groups only interesting modules into pseudo-src buckets", () => {
    const groups = decompiler.groupInterestingModules([
      {
        symbol: "mod1",
        rawPreview: "sessionWorkspaces cwd /home/node/a0/workspace outputs uploads",
        printed: "var mod1 = 1;",
        interesting: true,
      },
      {
        symbol: "mod2",
        rawPreview: "AGENT_WORKER_BASE_URL /api/agent/claude/messages",
        printed: "var mod2 = 2;",
        interesting: true,
      },
      {
        symbol: "mod3",
        rawPreview: "plain vendor helper",
        printed: "var mod3 = 3;",
        interesting: false,
      },
    ]);

    expect(groups["session-workspace"]?.map((mod: { symbol: string }) => mod.symbol)).toContain("mod1");
    expect(groups["agent-worker-bridge"]?.map((mod: { symbol: string }) => mod.symbol)).toContain("mod2");
    expect(Object.values(groups).flat().map((mod: { symbol: string }) => mod.symbol)).not.toContain("mod3");
  });
});
