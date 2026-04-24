import { describe, expect, test } from "bun:test";
import { getStatusBadgeSpec } from "../src/components/Navigator/StatusBadge";

describe("getStatusBadgeSpec", () => {
  test("maps newly introduced review and invalidation statuses", () => {
    expect(getStatusBadgeSpec("in_review")).toMatchObject({ label: "审核" });
    expect(getStatusBadgeSpec("approved")).toMatchObject({ label: "通过" });
    expect(getStatusBadgeSpec("locked")).toMatchObject({ label: "锁定" });
    expect(getStatusBadgeSpec("change_requested")).toMatchObject({ label: "返修" });
    expect(getStatusBadgeSpec("stale")).toMatchObject({ label: "失效" });
    expect(getStatusBadgeSpec("superseded")).toMatchObject({ label: "旧版" });
  });

  test("keeps existing status mappings stable", () => {
    expect(getStatusBadgeSpec("running")).toMatchObject({ label: "运行" });
    expect(getStatusBadgeSpec("validated")).toMatchObject({ label: "✓" });
    expect(getStatusBadgeSpec("not_started")).toMatchObject({ label: "—" });
  });
});
