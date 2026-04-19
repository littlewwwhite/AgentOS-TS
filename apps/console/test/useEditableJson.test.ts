import { describe, expect, test } from "bun:test";
import { setAtPath } from "../src/hooks/useEditableJson";

describe("setAtPath", () => {
  test("sets a top-level key", () => {
    const obj = { title: "old", count: 1 };
    const result = setAtPath(obj, "title", "new");
    expect(result).toEqual({ title: "new", count: 1 });
    expect(obj.title).toBe("old"); // original unchanged
  });

  test("sets a nested key", () => {
    const obj = { meta: { author: "A", year: 2024 } };
    const result = setAtPath(obj, "meta.author", "B");
    expect(result).toEqual({ meta: { author: "B", year: 2024 } });
    expect((obj.meta as { author: string }).author).toBe("A");
  });

  test("sets value inside an array by numeric index", () => {
    const obj = { episodes: [{ title: "ep1" }, { title: "ep2" }] };
    const result = setAtPath(obj, "episodes.0.title", "EP-ONE");
    expect((result as typeof obj).episodes[0].title).toBe("EP-ONE");
    expect((result as typeof obj).episodes[1].title).toBe("ep2");
    expect(obj.episodes[0].title).toBe("ep1"); // original unchanged
  });

  test("structural sharing: only changed nodes are cloned", () => {
    const ep1 = { title: "ep1" };
    const ep2 = { title: "ep2" };
    const obj = { episodes: [ep1, ep2] };
    const result = setAtPath(obj, "episodes.0.title", "updated");
    const r = result as typeof obj;
    // ep2 reference should be the same (not cloned)
    expect(r.episodes[1]).toBe(ep2);
    // ep1 should be a new object
    expect(r.episodes[0]).not.toBe(ep1);
  });

  test("returns original when path does not exist (non-existent key)", () => {
    const obj = { a: { b: 1 } };
    // "a.c.d" — a.c is undefined
    const result = setAtPath(obj, "a.c.d" as string, 99);
    expect(result).toBe(obj); // same reference = unchanged
  });

  test("returns original when numeric index used on non-array", () => {
    const obj = { name: "x" };
    const result = setAtPath(obj, "name.0", "y");
    expect(result).toBe(obj);
  });

  test("sets deeply nested array value", () => {
    const obj = {
      episodes: [
        { scenes: [{ shots: [{ prompt: "old" }] }] },
      ],
    };
    const result = setAtPath(obj, "episodes.0.scenes.0.shots.0.prompt", "new");
    type Obj = typeof obj;
    expect((result as Obj).episodes[0].scenes[0].shots[0].prompt).toBe("new");
  });
});
