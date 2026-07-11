import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "./api";
import { copyTaskIDToClipboard } from "./taskActions";

const task = { id: "c8bf09c8-adc7-4f7a-86df-3c2dd8476a1b" } as Task;

describe("copyTaskIDToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyTaskIDToClipboard(task);

    expect(writeText).toHaveBeenCalledWith(task.id);
  });

  it("falls back to a temporary textarea for non-secure HTTP contexts", async () => {
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    await copyTaskIDToClipboard(task);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector('textarea[data-taskline-clipboard="true"]')).toBeNull();
  });
});
