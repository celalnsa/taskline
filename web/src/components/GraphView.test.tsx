import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { GraphView } from "./GraphView";

const queryMocks = vi.hoisted(() => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
  useAddDependency: vi.fn(),
  useDeleteDependency: vi.fn(),
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

type MockEdge = {
  id: string;
  type?: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
  style?: { stroke?: string };
  zIndex?: number;
  animated?: boolean;
};

vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ id, style }: { id: string; style?: { stroke?: string } }) => (
    <path data-testid={`base-edge-${id}`} data-stroke={style?.stroke} />
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ["M0 0L100 0", 50, 0],
  Handle: () => <span data-testid="handle" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  ReactFlow: ({
    nodes,
    edges,
    edgeTypes,
    nodeTypes,
    onConnect,
    onEdgeClick,
    onNodeClick,
    onNodeDoubleClick,
    onNodeContextMenu,
    onPaneClick,
  }: {
    nodes: Array<{
      id: string;
      type?: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }>;
    edges: MockEdge[];
    edgeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
    nodeTypes: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
    onConnect?: (connection: { source: string; target: string }) => void;
    onEdgeClick?: (
      event: React.MouseEvent<HTMLDivElement>,
      edge: MockEdge
    ) => void;
    onNodeClick?: (
      event: React.MouseEvent<HTMLDivElement>,
      node: { id: string; data: Record<string, unknown> }
    ) => void;
    onNodeDoubleClick?: (
      event: React.MouseEvent<HTMLDivElement>,
      node: { id: string; data: Record<string, unknown> }
    ) => void;
    onNodeContextMenu?: (
      event: React.MouseEvent<HTMLDivElement>,
      node: { id: string; data: Record<string, unknown> }
    ) => void;
    onPaneClick?: () => void;
  }) => (
    <div data-testid="react-flow">
      <button type="button" data-testid="pane" onClick={onPaneClick}>
        Pane
      </button>
      <button
        type="button"
        data-testid="connect-a-c"
        onClick={() => onConnect?.({ source: "a", target: "c" })}
      >
        Connect A to C
      </button>
      <div data-testid="edge-ids">{edges.map((edge) => edge.id).join(",")}</div>
      {edges.map((edge) => {
        const EdgeComponent = edgeTypes?.[edge.type ?? ""];
        return (
          <div
            key={edge.id}
            data-testid={`edge-${edge.id}`}
            data-stroke={edge.style?.stroke}
            data-selected={String(edge.data?.selected)}
            data-animated={String(edge.animated)}
            data-z-index={String(edge.zIndex ?? "")}
            onClick={(event) => onEdgeClick?.(event, edge)}
          >
            {EdgeComponent ? (
              <EdgeComponent
                id={edge.id}
                sourceX={0}
                sourceY={0}
                targetX={100}
                targetY={0}
                sourcePosition="right"
                targetPosition="left"
                markerEnd="arrowclosed"
                style={edge.style}
                data={edge.data}
              />
            ) : null}
          </div>
        );
      })}
      {nodes.map((node) => {
        const NodeComponent = nodeTypes[node.type ?? ""];
        return (
          <div
            key={node.id}
            data-testid={`node-${node.id}`}
            data-dimmed={String(node.data.dimmed)}
            data-selected={String(node.data.selected)}
            data-x={node.position.x}
            data-y={node.position.y}
            onClick={(event) => onNodeClick?.(event, node)}
            onDoubleClick={(event) => onNodeDoubleClick?.(event, node)}
            onContextMenu={(event) => onNodeContextMenu?.(event, node)}
          >
            {NodeComponent ? <NodeComponent data={node.data} /> : node.id}
          </div>
        );
      })}
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

function task(input: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    project_id: project.id,
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
    ...input,
  };
}

function renderGraph(tasks: Task[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const updateMutate = vi.fn();
  const addDependencyMutate = vi.fn();
  const deleteDependencyMutate = vi.fn();
  const deleteTaskMutate = vi.fn();

  queryMocks.useTasks.mockReturnValue({ data: tasks });
  queryMocks.useUpdateTask.mockReturnValue({ mutate: updateMutate });
  queryMocks.useAddDependency.mockReturnValue({ mutate: addDependencyMutate });
  queryMocks.useDeleteDependency.mockReturnValue({ mutate: deleteDependencyMutate });
  queryMocks.useDeleteTask.mockReturnValue({ mutate: deleteTaskMutate });

  render(
    <QueryClientProvider client={client}>
      <GraphView project={project} />
    </QueryClientProvider>
  );

  return { updateMutate, addDependencyMutate, deleteDependencyMutate, deleteTaskMutate };
}

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("hides done tasks and omits edges connected to hidden tasks", () => {
    renderGraph([
      task({ id: "a", title: "Done dependency", state: "done" }),
      task({ id: "b", title: "Active blocked", depends_on: ["a"] }),
      task({ id: "c", title: "Active child", depends_on: ["b"] }),
    ]);

    expect(screen.queryByTestId("node-a")).toBeNull();
    expect(screen.getByTestId("node-b")).toBeTruthy();
    expect(screen.getByTestId("node-c")).toBeTruthy();
    expect(screen.queryByTestId("edge-a->b")).toBeNull();
    expect(screen.getByTestId("edge-b->c")).toBeTruthy();
  });

  it("lays dependency chains out from left to right", () => {
    renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "B", depends_on: ["a"] }),
      task({ id: "c", title: "C", depends_on: ["b"] }),
    ]);

    const aX = Number(screen.getByTestId("node-a").dataset.x);
    const bX = Number(screen.getByTestId("node-b").dataset.x);
    const cX = Number(screen.getByTestId("node-c").dataset.x);

    expect(aX).toBeLessThan(bX);
    expect(bX).toBeLessThan(cX);
  });

  it("highlights the selected relationship chain on double-click and clears on pane click", async () => {
    vi.useFakeTimers();
    renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "B", depends_on: ["a"] }),
      task({ id: "c", title: "C", depends_on: ["b"] }),
      task({ id: "d", title: "Unrelated" }),
    ]);

    fireEvent.click(screen.getByTestId("node-b"));
    fireEvent.click(screen.getByTestId("node-b"));
    fireEvent.doubleClick(screen.getByTestId("node-b"));

    expect(screen.getByTestId("node-a").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.selected).toBe("true");
    expect(screen.getByTestId("node-c").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("true");
    expect(screen.getByTestId("edge-a->b").dataset.zIndex).toBe("20");
    expect(screen.getByTestId("edge-b->c").dataset.zIndex).toBe("20");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(screen.queryByRole("dialog", { name: /edit task b/i })).toBeNull();

    fireEvent.click(screen.getByTestId("pane"));

    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.selected).toBe("false");
  });

  it("opens the task editor on single-click without highlighting the chain", async () => {
    vi.useFakeTimers();
    renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "Editable task", depends_on: ["a"] }),
    ]);

    fireEvent.click(screen.getByTestId("node-a"));
    fireEvent.click(screen.getByTestId("node-a"));
    fireEvent.doubleClick(screen.getByTestId("node-a"));
    expect(screen.getByTestId("node-a").dataset.selected).toBe("true");

    fireEvent.click(screen.getByTestId("node-b"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(
      screen.getByRole("dialog", { name: /edit task editable task/i })
    ).toBeTruthy();
    expect(screen.getByTestId("node-a").dataset.selected).toBe("false");
    expect(screen.getByTestId("node-a").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.selected).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /close editor/i }));

    expect(screen.queryByRole("dialog", { name: /edit task editable task/i })).toBeNull();
  });

  it("selects dependency edges and deletes the selected relationship", async () => {
    const user = userEvent.setup();
    const { deleteDependencyMutate } = renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "B", depends_on: ["a"] }),
      task({ id: "c", title: "C", depends_on: ["b"] }),
      task({ id: "d", title: "Unrelated" }),
    ]);

    await user.click(screen.getByTestId("edge-b->c"));

    expect(screen.getByTestId("node-a").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-c").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("true");
    expect(screen.getByTestId("edge-b->c").dataset.selected).toBe("true");
    expect(screen.getByTestId("edge-b->c").dataset.stroke).toBe("#dc2626");
    expect(screen.getByTestId("edge-a->b").dataset.zIndex).toBe("20");
    expect(screen.getByTestId("edge-b->c").dataset.zIndex).toBe("30");
    expect(screen.getByRole("button", { name: /delete dependency b to c/i }).style.zIndex).toBe(
      "40"
    );

    await user.click(screen.getByRole("button", { name: /delete dependency b to c/i }));

    expect(deleteDependencyMutate).toHaveBeenCalledWith({
      taskId: "c",
      dependsOn: "b",
    });

    await user.click(screen.getByTestId("pane"));

    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("false");
    expect(
      screen.queryByRole("button", { name: /delete dependency b to c/i })
    ).toBeNull();
  });

  it("keeps the inline state selector from opening the task editor", async () => {
    const user = userEvent.setup();
    const { updateMutate } = renderGraph([
      task({ id: "b", title: "Editable task" }),
    ]);

    await user.selectOptions(within(screen.getByTestId("node-b")).getByRole("combobox"), "dev");

    expect(updateMutate).toHaveBeenCalledWith({
      id: "b",
      patch: { state: "dev" },
    });
    expect(screen.queryByRole("dialog", { name: /edit task editable task/i })).toBeNull();
  });

  it("deletes a graph task from the right-click menu after confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const { deleteTaskMutate } = renderGraph([
      task({ id: "b", title: "Deletable graph task" }),
    ]);

    fireEvent.contextMenu(screen.getByTestId("node-b"), { clientX: 60, clientY: 80 });
    await user.click(screen.getByRole("menuitem", { name: /^delete$/i }));

    expect(confirm).toHaveBeenCalledWith(
      'Delete task "Deletable graph task"? This cascades to dependencies and images.'
    );
    expect(deleteTaskMutate).toHaveBeenCalledWith("b", expect.any(Object));
    expect(screen.queryByRole("dialog", { name: /edit task deletable graph task/i })).toBeNull();
  });

  it("shows an error when graph task deletion fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { deleteTaskMutate } = renderGraph([
      task({ id: "b", title: "Fragile graph task" }),
    ]);

    fireEvent.contextMenu(screen.getByTestId("node-b"), { clientX: 60, clientY: 80 });
    await user.click(screen.getByRole("menuitem", { name: /^delete$/i }));

    const [, options] = deleteTaskMutate.mock.calls[0];
    act(() => {
      options.onError(new Error("delete failed"));
    });

    expect(screen.getByRole("alert").textContent).toBe("delete failed");
  });

  it("copies a graph task into a prefilled create editor from the right-click menu", async () => {
    const user = userEvent.setup();
    const { deleteTaskMutate } = renderGraph([
      task({
        id: "b",
        title: "Copyable graph task",
        description: "Copy graph basics",
        type: "docs",
        state: "review",
        priority: 9,
        labels: ["graph", "copy"],
        depends_on: ["a"],
      }),
    ]);

    fireEvent.contextMenu(screen.getByTestId("node-b"), { clientX: 60, clientY: 80 });
    await user.click(screen.getByRole("menuitem", { name: /^copy$/i }));

    const dialog = screen.getByRole("dialog", { name: /create task copyable graph task/i });
    expect(dialog).toBeTruthy();
    expect(screen.getByTestId("editor-mode").textContent).toBe("create");
    expect(within(dialog).getByText("Copy graph basics")).toBeTruthy();
    expect(within(dialog).getByText("docs")).toBeTruthy();
    expect(within(dialog).getByText("review")).toBeTruthy();
    expect(within(dialog).getByText("9")).toBeTruthy();
    expect(within(dialog).getByText("graph,copy")).toBeTruthy();
    expect(deleteTaskMutate).not.toHaveBeenCalled();
  });

  it("creates a dependency when connecting one task to another", async () => {
    const user = userEvent.setup();
    const { addDependencyMutate } = renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "c", title: "C" }),
    ]);

    await user.click(screen.getByTestId("connect-a-c"));

    expect(addDependencyMutate).toHaveBeenCalledWith({
      taskId: "c",
      dependsOn: "a",
    });
  });

  it("ignores duplicate dependency connections", async () => {
    const user = userEvent.setup();
    const { addDependencyMutate } = renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "c", title: "C", depends_on: ["a"] }),
    ]);

    await user.click(screen.getByTestId("connect-a-c"));

    expect(addDependencyMutate).not.toHaveBeenCalled();
  });
});
