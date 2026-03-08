import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

function spawnSandbox(): ChildProcess {
  return spawn("bun", ["src/sandbox.ts", "workspace/test-sandbox", "--skills", "skills"], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
  });
}

function readLine(proc: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        proc.stdout!.off("data", onData);
        resolve(buf.slice(0, idx));
      }
    };
    proc.stdout!.on("data", onData);

    const timer = setTimeout(() => {
      proc.stdout!.off("data", onData);
      reject(new Error(`Timeout waiting for line, received so far: ${buf}`));
    }, 15_000);

    proc.on("exit", () => {
      clearTimeout(timer);
      proc.stdout!.off("data", onData);
      if (buf.includes("\n")) {
        resolve(buf.slice(0, buf.indexOf("\n")));
      } else {
        reject(new Error(`Process exited before line, buffer: ${buf}`));
      }
    });
  });
}

function send(proc: ChildProcess, obj: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify(obj) + "\n");
}

describe("sandbox integration", () => {
  let proc: ChildProcess | null = null;

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
      proc = null;
    }
  });

  it("emits ready event on startup", async () => {
    proc = spawnSandbox();
    const line = await readLine(proc);
    const event = JSON.parse(line);
    expect(event.type).toBe("ready");
    expect(Array.isArray(event.skills)).toBe(true);
  }, 20_000);

  it("responds to list_skills command", async () => {
    proc = spawnSandbox();
    // Wait for ready
    await readLine(proc);
    // Send list_skills
    send(proc, { cmd: "list_skills" });
    const line = await readLine(proc);
    const event = JSON.parse(line);
    expect(event.type).toBe("skills");
    expect(typeof event.skills).toBe("object");
  }, 20_000);

  it("responds to status command with idle state", async () => {
    proc = spawnSandbox();
    await readLine(proc);
    send(proc, { cmd: "status" });
    const line = await readLine(proc);
    const event = JSON.parse(line);
    expect(event.type).toBe("status");
    expect(event.state).toBe("idle");
  }, 20_000);

  it("exits cleanly when stdin closes", async () => {
    proc = spawnSandbox();
    await readLine(proc);
    proc.stdin!.end();
    const [code] = await once(proc, "exit");
    // Process should exit without crashing (code 0 or null from signal)
    expect(code === 0 || code === null).toBe(true);
  }, 20_000);
});
