import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { KanbanBoard } from "./KanbanBoard";

const queryMocks = vi.hoisted(() => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
  useDeleteTask: vi.fn(),
}));

vi.mock("../hooks/queries", () => queryMocks);

vi.mock("./CreateTaskButton", () => ({
  CreateTaskButton: () => <button type="button">+ New task</button>,
}));

vi.mock("./TaskEditor", () => ({
  TaskEditor: ({
    task,
    mode = "edit",
    onClose,
  }: {
    task?: Task;
    mode?: "create" | "edit";
    onClose: () => void;
  }) => (
    <div
      role="dialog"
      aria-label={`${mode === "create" ? "Create task" : "Edit task"} ${task?.title ?? ""}`}
    >
      <p data-testid="editor-mode">{mode}</p>
      <p>{task?.title}</p>
      <p>{task?.description}</p>
      <p>{task?.type}</p>
      <p>{task?.state}</p>
      <p>{task?.priority}</p>
      <p>{task?.labels?.join(",")}</p>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));

const project: Project = {
  id: "project-1",
  name: "taskline",
  description: "",
  created_at: 1780051741142,
  updated_at: 1780051741142,
};

const sourceTask: Task = {
  id: "task-1",
  project_id: project.id,
  title: "Copy source task",
  description: "Carry these basics",
  type: "bug",
  state: "dev",
  priority: 7,
  created_at: 1780051741142,
  updated_at: 1780051741142,
  labels: ["provider", "review"],
  depends_on: ["dep-1"],
  links: [],
  images: [],
};

function renderBoard(tasks: Task[] = [sourceTask]) {
  const updateMutate = vi.fn();
  const deleteMutate = vi.fn();
  queryMocks.useTasks.mockReturnValue({ data: tasks });
  queryMocks.useUpdateTask.mockReturnValue({ mutate: updateMutate });
  queryMocks.useDeleteTask.mockReturnValue({ mutate: deleteMutate });

  render(<KanbanBoard project={project} />);

  return { updateMutate, deleteMutate };
}

describe("KanbanBoard context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("deletes a task from the right-click menu after confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const { deleteMutate } = renderBoard();

    fireEvent.contextMenu(screen.getByText("Copy source task"), {
      clientX: 32,
      clientY: 48,
    });
    await user.click(screen.getByRole("menuitem", { name: /^delete$/i }));

    expect(confirm).toHaveBeenCalledWith(
      'Delete task "Copy source task"? This cascades to dependencies and images.'
    );
    expect(deleteMutate).toHaveBeenCalledWith("task-1", expect.any(Object));
  });

  it("opens a create editor prefilled with copied basic task information", async () => {
    const user = userEvent.setup();
    const { deleteMutate } = renderBoard();

    fireEvent.contextMenu(screen.getByText("Copy source task"), {
      clientX: 32,
      clientY: 48,
    });
    await user.click(screen.getByRole("menuitem", { name: /^copy$/i }));

    expect(screen.getByRole("dialog", { name: /create task copy source task/i })).toBeTruthy();
    expect(screen.getByTestId("editor-mode").textContent).toBe("create");
    expect(screen.getByText("Carry these basics")).toBeTruthy();
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("provider,review")).toBeTruthy();
    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
