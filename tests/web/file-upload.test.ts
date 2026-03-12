import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPLOAD_ROOT,
  getUploadTargetDirectory,
  uploadFiles,
} from "../../web/lib/file-upload";

describe("file-upload helpers", () => {
  it("derives the upload target directory from the selected file path", () => {
    expect(
      getUploadTargetDirectory("/home/user/app/workspace/notes/outline.md"),
    ).toBe("/home/user/app/workspace/notes");

    expect(getUploadTargetDirectory(null)).toBe(DEFAULT_UPLOAD_ROOT);
  });

  it("posts JSON uploads to the inferred upload endpoint", async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      contentType: string | null;
      body: unknown;
    }> = [];

    const uploadedPaths = await uploadFiles({
      serverBaseUrl: "http://localhost:3001",
      projectId: "project-alpha",
      authToken: "signed-token",
      selectedPath: "/home/user/app/workspace/notes/outline.md",
      files: [
        new File(["hello"], "scene-1.md", { type: "text/markdown" }),
        new File(["png"], "frame.png", { type: "image/png" }),
      ],
      fetchImpl: async (input, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as { path: string } : null;
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
          contentType: new Headers(init?.headers).get("content-type"),
          body,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            path: body?.path,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:3001/api/projects/project-alpha/files/upload",
        authorization: "Bearer signed-token",
        contentType: "application/json",
        body: {
          path: "/home/user/app/workspace/notes/scene-1.md",
          content: "hello",
        },
      },
      {
        url: "http://localhost:3001/api/projects/project-alpha/files/upload",
        authorization: "Bearer signed-token",
        contentType: "application/json",
        body: {
          path: "/home/user/app/workspace/notes/frame.png",
          contentBase64: "cG5n",
        },
      },
    ]);
    expect(uploadedPaths).toEqual([
      "/home/user/app/workspace/notes/scene-1.md",
      "/home/user/app/workspace/notes/frame.png",
    ]);
  });

  it("falls back to inferred file paths when the server omits them", async () => {
    const uploadedPaths = await uploadFiles({
      serverBaseUrl: "http://localhost:3001",
      projectId: "project-alpha",
      authToken: null,
      selectedPath: null,
      files: [new File(["hello"], "scene-1.md", { type: "text/markdown" })],
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(uploadedPaths).toEqual([
      "/home/user/app/workspace/scene-1.md",
    ]);
  });
});
