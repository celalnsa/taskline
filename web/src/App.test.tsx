import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "./lib/api";
import App from "./App";

const mocks = vi.hoisted(() => ({
  projectKey: "taskline",
  setProjectKey: vi.fn(),
  useProjects: vi.fn(),
  useTasks: vi.fn(),
}));

vi.mock("nuqs", () => ({
  useQueryState: () => [mocks.projectKey, mocks.setProjectKey],
}));

vi.mock("./hooks/queries", () => ({
  useProjects: mocks.useProjects,
  useTasks: mocks.useTasks,
}));

vi.mock("./components/Sidebar", () => ({
  Sidebar: () => <aside aria-label="Projects">Projects</aside>,
}));

vi.mock("./components/KanbanBoard", () => ({
  KanbanBoard: () => <section aria-label="Kanban board">Kanban board</section>,
}));

vi.mock("./components/GraphView", () => ({
  GraphView: () => <section aria-label="Graph board">Graph board</section>,
}));

vi.mock("./components/TaskEditor", () => ({
  TaskEditor: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Create task">
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));

const project: Project = {
  id: "project-1",
  name: "taskline",
  description: "Agent board",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const otherProject: Project = {
  id: "project-2",
  name: "chanwire",
  description: "Channel board",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const task: Task = {
  id: "task-1",
  project_id: project.id,
  title: "Existing task",
  description: "",
  type: "feature",
  state: "start",
  priority: 1,
  labels: [],
  depends_on: [],
  links: [],
  images: [],
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

function renderApp() {
  mocks.useProjects.mockReturnValue({
    data: [project, otherProject],
    isSuccess: true,
  });
  mocks.useTasks.mockReturnValue({
    data: [task],
  });
  return render(<App />);
}

describe("App workspace layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectKey = "taskline";
  });

  afterEach(() => {
    cleanup();
  });

  it("places board controls in the project title bar", () => {
    renderApp();

    const heading = screen.getByRole("heading", { level: 2, name: "taskline" });
    const header = heading.closest("header");
    const kanbanButton = screen.getByRole("button", { name: "Kanban" });
    const graphButton = screen.getByRole("button", { name: "Graph" });
    const newTaskButton = screen.getByRole("button", { name: "+ New" });

    expect(heading).toBeTruthy();
    expect(header).toBeTruthy();
    if (!header) throw new Error("expected project header");
    expect(screen.getByText("Agent board")).toBeTruthy();
    expect(header.contains(kanbanButton)).toBe(true);
    expect(header.contains(graphButton)).toBe(true);
    expect(header.contains(newTaskButton)).toBe(true);
    expect(screen.getByRole("region", { name: "Kanban board" }).parentElement?.className).not.toContain(
      "pt-14"
    );
    expect(screen.queryByRole("button", { name: "Dependency graph" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ New task" })).toBeNull();
  });

  it("keeps task creation available from the graph view and Cmd+K", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Graph" }));

    expect(screen.getByRole("region", { name: "Graph board" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ New" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByRole("dialog", { name: "Create task" })).toBeTruthy();
  });

  it("resets workspace-local view and editor state when the project changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderApp();

    await user.click(screen.getByRole("button", { name: "Graph" }));
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByRole("region", { name: "Graph board" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Create task" })).toBeTruthy();

    mocks.projectKey = "chanwire";
    rerender(<App />);

    expect(screen.getByRole("heading", { level: 2, name: "chanwire" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Kanban board" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Graph board" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Create task" })).toBeNull();
  });
});
