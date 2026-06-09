import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { CreateTaskButton } from "./CreateTaskButton";

const project: Project = {
  id: "project-1",
  name: "taskline",
  description: "",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const dependency: Task = {
  id: "task-2",
  project_id: project.id,
  title: "Existing dependency",
  description: "",
  type: "feature",
  state: "start",
  priority: 1,
  depends_on: [],
  links: [],
  images: [],
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

function renderCreateButton() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <CreateTaskButton project={project} allTasks={[dependency]} />
    </QueryClientProvider>
  );
}

describe("CreateTaskButton", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the shared task editor layout to create a pending task", async () => {
    const user = userEvent.setup();
    const created: Task = {
      ...dependency,
      id: "task-3",
      title: "Created through shared editor",
      description: "Created description",
      type: "bug",
      state: "pending",
      priority: 3,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCreateButton();

    await user.click(screen.getByRole("button", { name: /new task/i }));

    expect(screen.getByRole("heading", { name: /new task in taskline/i })).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByText("Images")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.getByText("Links")).toBeTruthy();
    expect(screen.getByText("Depends")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();

    await user.type(screen.getByLabelText("Title"), created.title);
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), created.description);
    await user.selectOptions(screen.getByLabelText("Type"), "bug");
    await user.selectOptions(screen.getByLabelText("State"), "pending");
    await user.clear(screen.getByLabelText("Priority"));
    await user.type(screen.getByLabelText("Priority"), "3");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/projects/project-1/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: created.title,
          description: created.description,
          type: "bug",
          priority: 3,
          auto_start: false,
        }),
      })
    );
  });

  it("retries a failed create-state update without creating a duplicate task", async () => {
    const user = userEvent.setup();
    const created: Task = {
      ...dependency,
      id: "task-3",
      title: "Created once",
      description: "Needs dev state",
      type: "feature",
      state: "start",
      priority: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "state update failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...created, state: "dev" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    renderCreateButton();

    await user.click(screen.getByRole("button", { name: /new task/i }));
    await user.type(screen.getByLabelText("Title"), created.title);
    await user.type(screen.getByLabelText("Description"), created.description);
    await user.selectOptions(screen.getByLabelText("State"), "dev");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("state update failed")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === "POST"))
      .toHaveLength(1);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/tasks/task-3");
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ state: "dev" }),
      })
    );
  });
});
