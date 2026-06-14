import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function task(input: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const { id, title, ...rest } = input;
  return {
    ...sourceTask,
    id,
    title,
    description: "",
    type: "feature",
    state: "start",
    priority: 0,
    created_at: 1780051741142,
    updated_at: 1780051741142,
    labels: [],
    depends_on: [],
    links: [],
    images: [],
    ...rest,
  };
}

function renderBoard(tasks: Task[] = [sourceTask]) {
  const updateMutate = vi.fn();
  const deleteMutate = vi.fn();
  queryMocks.useTasks.mockReturnValue({ data: tasks });
  queryMocks.useUpdateTask.mockReturnValue({ mutate: updateMutate });
  queryMocks.useDeleteTask.mockReturnValue({ mutate: deleteMutate });

  render(<KanbanBoard project={project} />);

  return { updateMutate, deleteMutate };
}

function taskTitlesInColumn(state: string) {
  return within(screen.getByTestId(`column-${state}`))
    .getAllByRole("button", { name: /^Open task / })
    .map((card) => card.getAttribute("aria-label")?.replace(/^Open task /, ""));
}

describe("KanbanBoard context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows task counts in column headers and exposes sort choices", async () => {
    const user = userEvent.setup();
    renderBoard([
      task({ id: "start-1", title: "Start one", state: "start" }),
      task({ id: "start-2", title: "Start two", state: "start" }),
      task({ id: "done-1", title: "Done one", state: "done" }),
    ]);

    expect(screen.getByRole("heading", { name: "Pending (0)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Start (2)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Done (1)" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /sort start tasks/i }));

    const menu = screen.getByRole("menu", { name: /sort start tasks/i });
    expect(
      within(menu).getByRole("menuitemradio", { name: /next execution order/i })
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitemradio", { name: /priority high to low/i })
    ).toBeTruthy();
    expect(
      within(menu).getByRole("menuitemradio", { name: /created oldest first/i })
    ).toBeTruthy();
  });

  it("sorts columns by next execution order by default", () => {
    renderBoard([
      task({ id: "blocked", title: "Blocked high", priority: 100, depends_on: ["missing"] }),
      task({ id: "ready-low", title: "Ready low", priority: 1, created_at: 100 }),
      task({ id: "ready-high", title: "Ready high", priority: 3, created_at: 300 }),
      task({ id: "done-dep", title: "Completed dependency", state: "done" }),
    ]);

    expect(taskTitlesInColumn("start")).toEqual(["Ready high", "Ready low", "Blocked high"]);
  });

  it("changes the clicked column sort mode", async () => {
    const user = userEvent.setup();
    renderBoard([
      task({ id: "new-high", title: "Newest high", priority: 9, created_at: 300 }),
      task({ id: "old-low", title: "Oldest low", priority: 1, created_at: 100 }),
      task({ id: "middle", title: "Middle", priority: 5, created_at: 200 }),
    ]);

    await user.click(screen.getByRole("button", { name: /sort start tasks/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /created oldest first/i }));

    expect(taskTitlesInColumn("start")).toEqual(["Oldest low", "Middle", "Newest high"]);

    await user.click(screen.getByRole("button", { name: /sort start tasks/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /priority high to low/i }));

    expect(taskTitlesInColumn("start")).toEqual(["Newest high", "Middle", "Oldest low"]);
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

  it("pans the board horizontally when dragging empty kanban space", () => {
    renderBoard();
    const scrollRegion = screen.getByTestId("kanban-scroll-region");

    scrollRegion.scrollLeft = 100;
    fireEvent.pointerDown(scrollRegion, {
      button: 0,
      clientX: 240,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(scrollRegion, {
      clientX: 160,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(scrollRegion, {
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(scrollRegion.scrollLeft).toBe(180);
  });

  it("does not pan the board from task cards", () => {
    renderBoard();
    const scrollRegion = screen.getByTestId("kanban-scroll-region");
    const card = screen.getByRole("button", { name: /open task copy source task/i });

    scrollRegion.scrollLeft = 100;
    fireEvent.pointerDown(card, {
      button: 0,
      clientX: 240,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(scrollRegion, {
      clientX: 160,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(scrollRegion, {
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(scrollRegion.scrollLeft).toBe(100);
  });

  it("does not pan the board for touch pointers", () => {
    renderBoard();
    const scrollRegion = screen.getByTestId("kanban-scroll-region");

    scrollRegion.scrollLeft = 100;
    fireEvent.pointerDown(scrollRegion, {
      button: 0,
      clientX: 240,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerMove(scrollRegion, {
      clientX: 160,
      pointerId: 1,
      pointerType: "touch",
    });
    fireEvent.pointerUp(scrollRegion, {
      pointerId: 1,
      pointerType: "touch",
    });

    expect(scrollRegion.scrollLeft).toBe(100);
  });

  it("does not pan the board from the horizontal scrollbar gutter", () => {
    renderBoard();
    const scrollRegion = screen.getByTestId("kanban-scroll-region");

    Object.defineProperties(scrollRegion, {
      offsetHeight: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 184 },
      offsetWidth: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 400 },
    });
    scrollRegion.getBoundingClientRect = vi.fn(
      () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 400,
          bottom: 200,
          width: 400,
          height: 200,
          toJSON: () => ({}),
        }) as DOMRect
    );

    scrollRegion.scrollLeft = 100;
    fireEvent.pointerDown(scrollRegion, {
      button: 0,
      clientX: 240,
      clientY: 196,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(scrollRegion, {
      clientX: 160,
      clientY: 196,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(scrollRegion, {
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(scrollRegion.scrollLeft).toBe(100);
  });
});
