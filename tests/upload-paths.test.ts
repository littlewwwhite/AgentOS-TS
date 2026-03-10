import { describe, expect, it } from "vitest";

import { getDefaultUploadRemotePath } from "../src/upload-paths.js";

describe("getDefaultUploadRemotePath", () => {
  it("uploads directories into workspace/data", () => {
    expect(getDefaultUploadRemotePath("/tmp/local-data", true)).toBe("/home/user/app/workspace/data");
  });

  it("uploads single files into workspace/data/<basename>", () => {
    expect(getDefaultUploadRemotePath("/tmp/c7.txt", false)).toBe("/home/user/app/workspace/data/c7.txt");
  });
});
