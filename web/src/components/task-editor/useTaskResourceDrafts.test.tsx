import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskImage, TaskLink } from "../../lib/api";
import {
  useTaskResourceDrafts,
  type PendingImage,
  type PendingLink,
} from "./useTaskResourceDrafts";

const task: Task = {
  id: "task-created",
  project_id: "project-1",
  title: "Created task",
  description: "",
  type: "feature",
  state: "start",
  priority: 0,
  labels: [],
  depends_on: [],
  links: [],
  images: [],
  docs: [],
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useTaskResourceDrafts", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("replays staged images, links, and dependencies for a newly created task", async () => {
    const file = new File(["image"], "draft.png", { type: "image/png" });
    const pendingImage: PendingImage = {
      id: "draft-image",
      task_id: "",
      filename: "draft.png",
      mime_type: "image/png",
      size_bytes: 5,
      uploaded_at: 0,
      file,
      pending: true,
      preview_url: "blob:draft",
    };
    const pendingLink: PendingLink = {
      id: "draft-link",
      task_id: "",
      url: "https://example.com/spec",
      label: "Spec",
      created_at: 0,
      pending: true,
    };
    const uploaded: TaskImage = {
      id: "image-created",
      task_id: task.id,
      filename: "draft.png",
      mime_type: "image/png",
      size_bytes: 5,
      uploaded_at: 1780051741143,
    };
    const link: TaskLink = {
      id: "link-created",
      task_id: task.id,
      url: pendingLink.url,
      label: pendingLink.label,
      created_at: 1780051741144,
    };
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/v1/tasks/task-created/images") {
        expect((init?.body as FormData).get("file")).toBe(file);
        return Promise.resolve(
          new Response(JSON.stringify(uploaded), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/links") {
        expect(init?.body).toBe(JSON.stringify({ url: pendingLink.url, label: pendingLink.label }));
        return Promise.resolve(
          new Response(JSON.stringify(link), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (path === "/api/v1/tasks/task-created/deps") {
        expect(init?.body).toBe(JSON.stringify({ depends_on: "dep-1" }));
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: task.id, depends_on: "dep-1" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTaskResourceDrafts("project-1"), { wrapper });

    act(() => {
      result.current.setPendingImages([pendingImage]);
      result.current.setPendingLinks([pendingLink]);
      result.current.setPendingDependencyIds(["dep-1"]);
    });

    await act(async () => {
      await result.current.replayCreateResources(task);
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["/api/v1/tasks/task-created/images", "POST"],
      ["/api/v1/tasks/task-created/links", "POST"],
      ["/api/v1/tasks/task-created/deps", "POST"],
    ]);
    await waitFor(() => expect(result.current.pendingImages[0]?.pending).toBe(false));
    expect(result.current.pendingImages[0]).toMatchObject({
      id: uploaded.id,
      file,
      preview_url: pendingImage.preview_url,
    });
    expect(result.current.pendingLinks[0]).toMatchObject({
      id: link.id,
      pending: false,
      url: link.url,
    });
  });

  it("does not replay dependencies that already succeeded during a previous create attempt", async () => {
    let secondDependencyAttempts = 0;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/v1/tasks/task-created/deps") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          depends_on?: string;
        };
        if (body.depends_on === "dep-2") {
          secondDependencyAttempts += 1;
          if (secondDependencyAttempts === 1) {
            return Promise.resolve(
              new Response(JSON.stringify({ error: "dependency failed" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              })
            );
          }
        }
        return Promise.resolve(
          new Response(JSON.stringify({ task_id: task.id, depends_on: body.depends_on }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: `unexpected ${path}` }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTaskResourceDrafts("project-1"), { wrapper });

    act(() => {
      result.current.setPendingDependencyIds(["dep-1", "dep-2"]);
    });

    await expect(result.current.replayCreateResources(task)).rejects.toThrow("dependency failed");

    await act(async () => {
      await result.current.replayCreateResources(task);
    });

    const dependencyBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/v1/tasks/task-created/deps")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(dependencyBodies).toEqual([
      { depends_on: "dep-1" },
      { depends_on: "dep-2" },
      { depends_on: "dep-2" },
    ]);
  });
});
