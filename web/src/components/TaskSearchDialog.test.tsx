import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { TaskSearchDialog } from "./TaskSearchDialog";

const queryMocks = vi.hoisted(() => ({
  useTaskSearch: vi.fn(),
}));

vi.mock("../hooks/queries", () => ({
  useTaskSearch: queryMocks.useTaskSearch,
}));

const project: Project = {
  id: "project-1",
  name: "taskline",
  description: "",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const task: Task = {
  id: "fc7a0732-0000-4000-8000-000000000000",
  project_id: project.id,
  title: "Agent capability evaluation harness",
  description: "Tools, sandbox, and hooks coverage",
  type: "feature",
  state: "start",
  priority: 100,
  labels: ["evaluation"],
  depends_on: [],
  links: [],
  images: [],
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

describe("TaskSearchDialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders search results and selects a task", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    queryMocks.useTaskSearch.mockReturnValue({
      data: [task],
      isFetching: false,
      isError: false,
      error: null,
    });

    render(
      <TaskSearchDialog
        project={project}
        onClose={vi.fn()}
        onSelect={onSelect}
      />
    );

    await user.type(screen.getByRole("searchbox", { name: "Search tasks" }), "agent");
    expect(queryMocks.useTaskSearch).toHaveBeenLastCalledWith(project.id, "agent");

    await user.click(
      screen.getByRole("button", { name: /Agent capability evaluation harness/i })
    );

    expect(onSelect).toHaveBeenCalledWith(task);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    queryMocks.useTaskSearch.mockReturnValue({
      data: [],
      isFetching: false,
      isError: false,
      error: null,
    });

    render(
      <TaskSearchDialog
        project={project}
        onClose={onClose}
        onSelect={vi.fn()}
      />
    );

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
