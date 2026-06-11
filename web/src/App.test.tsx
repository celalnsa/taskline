import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "./lib/api";
import App from "./App";

const mocks = vi.hoisted(() => ({
  setProjectKey: vi.fn(),
  useProjects: vi.fn(),
  useTasks: vi.fn(),
}));

vi.mock("nuqs", () => ({
  useQueryState: () => ["taskline", mocks.setProjectKey],
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
    data: [project],
    isSuccess: true,
  });
  mocks.useTasks.mockReturnValue({
    data: [task],
  });
  render(<App />);
}

describe("App workspace layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("places the project title above the board and shows the compact board toolbar", () => {
    renderApp();

    expect(screen.getByRole("heading", { level: 2, name: "taskline" })).toBeTruthy();
    expect(screen.getByText("Agent board")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kanban" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Graph" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ New" })).toBeTruthy();
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
});
