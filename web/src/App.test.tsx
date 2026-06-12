import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "./lib/api";
import App from "./App";

const mocks = vi.hoisted(() => ({
  projectKey: "taskline" as string | null,
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
  TaskEditor: ({
    task,
    onClose,
  }: {
    task?: Task | null;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={task ? "Edit task" : "Create task"}>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));

vi.mock("./components/TaskSearchDialog", () => ({
  TaskSearchDialog: ({
    onClose,
    onSelect,
  }: {
    onClose: () => void;
    onSelect: (task: Task) => void;
  }) => (
    <div role="dialog" aria-label="Search tasks">
      <button type="button" onClick={() => onSelect(task)}>
        Select existing task
      </button>
      <button type="button" onClick={onClose}>
        Close search
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

  it("toggles the project sidebar from the project title bar", async () => {
    const user = userEvent.setup();
    renderApp();

    const heading = screen.getByRole("heading", { level: 2, name: "taskline" });
    const header = heading.closest("header");
    const collapseButton = screen.getByRole("button", { name: "Collapse sidebar" });

    expect(header).toBeTruthy();
    if (!header) throw new Error("expected project header");
    expect(header.contains(collapseButton)).toBe(true);
    expect(collapseButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("complementary", { name: "Projects" })).toBeTruthy();

    await user.click(collapseButton);

    const expandButton = screen.getByRole("button", { name: "Expand sidebar" });
    expect(screen.queryByRole("complementary", { name: "Projects" })).toBeNull();
    expect(header.contains(expandButton)).toBe(true);
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(expandButton);

    expect(screen.getByRole("complementary", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
  });

  it("keeps the sidebar available on the welcome screen after collapsing it", async () => {
    const user = userEvent.setup();
    const { rerender } = renderApp();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    mocks.projectKey = null;
    rerender(<App />);

    expect(screen.getByRole("complementary", { name: "Projects" })).toBeTruthy();
    expect(screen.getByText(/Pick a project from the sidebar/i)).toBeTruthy();
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

  it("opens task search from the title bar and Cmd+P", async () => {
    const user = userEvent.setup();
    renderApp();

    const heading = screen.getByRole("heading", { level: 2, name: "taskline" });
    const header = heading.closest("header");
    const searchButton = screen.getByRole("button", { name: "Search tasks" });

    expect(header).toBeTruthy();
    if (!header) throw new Error("expected project header");
    expect(header.contains(searchButton)).toBe(true);

    await user.click(searchButton);
    expect(screen.getByRole("dialog", { name: "Search tasks" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByRole("dialog", { name: "Search tasks" })).toBeNull();

    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(screen.getByRole("dialog", { name: "Search tasks" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Select existing task" }));
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
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
