import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUpdateTask } from "./queries";
import * as api from "../lib/api";
import type { Task } from "../lib/api";

vi.mock("../lib/api", () => ({
  updateTask: vi.fn(),
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    project_id: "project-1",
    title: "Original",
    description: "",
    type: "feature",
    state: "start",
    priority: 0,
    labels: [],
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("task mutations", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("resolves task updates without waiting for full list invalidation", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const original = task();
    const updated = task({ title: "Updated", updated_at: 2 });
    client.setQueryData(["tasks", "project-1"], [original]);
    vi.spyOn(client, "invalidateQueries").mockReturnValue(new Promise(() => {}) as never);
    vi.mocked(api.updateTask).mockResolvedValue(updated);

    const { result } = renderHook(() => useUpdateTask("project-1"), {
      wrapper: wrapperFor(client),
    });

    let mutation: Promise<Task> | null = null;
    act(() => {
      mutation = result.current.mutateAsync({ id: original.id, patch: { title: "Updated" } });
    });
    const outcome = await Promise.race([
      mutation!.then(() => "resolved"),
      delay(25).then(() => "timeout"),
    ]);

    expect(outcome).toBe("resolved");
    expect(client.getQueryData(["tasks", "project-1"])).toEqual([updated]);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["tasks", "project-1"] });
  });
});
