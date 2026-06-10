import { describe, expect, it } from "vitest";
import { COMMON_TASK_LABELS, getTaskLabelTheme } from "./labels";

describe("task label themes", () => {
  it("defines common GitHub-style label presets", () => {
    expect(COMMON_TASK_LABELS).toContain("bug");
    expect(COMMON_TASK_LABELS).toContain("documentation");
    expect(COMMON_TASK_LABELS).toContain("help wanted");
  });

  it("maps common labels to stable named themes", () => {
    expect(getTaskLabelTheme("bug").name).toBe("red");
    expect(getTaskLabelTheme("BUG").name).toBe("red");
    expect(getTaskLabelTheme("documentation").name).toBe("violet");
    expect(getTaskLabelTheme("review").name).toBe("amber");
  });

  it("maps arbitrary labels deterministically into the palette", () => {
    const first = getTaskLabelTheme("customer-success");
    const second = getTaskLabelTheme("customer-success");

    expect(first).toEqual(second);
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.chipClass).toContain("border-");
  });
});
