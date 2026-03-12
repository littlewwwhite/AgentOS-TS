import { describe, expect, it } from "vitest";

import {
  type FragmentFileInput,
  getSandboxRunCode,
  writeSandboxFiles,
} from "../../web/lib/sandbox-files";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("writeSandboxFiles", () => {
  it("waits for every generated file write to finish before resolving", async () => {
    const firstWrite = createDeferred();
    const secondWrite = createDeferred();
    const writeCalls: Array<{ filePath: string; content: string }> = [];

    const filesApi = {
      write: (filePath: string, content: string) => {
        writeCalls.push({ filePath, content });
        return writeCalls.length === 1 ? firstWrite.promise : secondWrite.promise;
      },
    };

    let settled = false;
    const writePromise = writeSandboxFiles(filesApi, {
      file_path: "src/index.ts",
      code: [
        { file_path: "src/index.ts", file_content: "console.log('a')" },
        { file_path: "src/util.ts", file_content: "export const b = 1" },
      ],
    } satisfies FragmentFileInput).then(() => {
      settled = true;
    });

    await flushMicrotasks();

    expect(writeCalls).toEqual([
      { filePath: "src/index.ts", content: "console.log('a')" },
    ]);
    expect(settled).toBe(false);

    firstWrite.resolve();
    await flushMicrotasks();
    expect(writeCalls).toEqual([
      { filePath: "src/index.ts", content: "console.log('a')" },
      { filePath: "src/util.ts", content: "export const b = 1" },
    ]);
    expect(settled).toBe(false);

    secondWrite.resolve();
    await writePromise;

    expect(settled).toBe(true);
  });

  it("writes single-file fragments using the original file path and code", async () => {
    const writeCalls: Array<{ filePath: string; content: string }> = [];

    await writeSandboxFiles(
      {
        write: async (filePath: string, content: string) => {
          writeCalls.push({ filePath, content });
        },
      },
      {
        file_path: "app/main.py",
        code: "print('hello')",
      },
    );

    expect(writeCalls).toEqual([
      { filePath: "app/main.py", content: "print('hello')" },
    ]);
  });

  it("uses the fragment entry file when code-interpreter receives generated files", () => {
    expect(
      getSandboxRunCode({
        file_path: "src/main.py",
        code: [
          { file_path: "src/util.py", file_content: "def util():\n    return 1" },
          { file_path: "src/main.py", file_content: "print(util())" },
        ],
      }),
    ).toBe("print(util())");
  });
});
