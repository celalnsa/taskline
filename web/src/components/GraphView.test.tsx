import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../lib/api";
import { GraphView } from "./GraphView";

const queryMocks = vi.hoisted(() => ({
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
  useAddDependency: vi.fn(),
}));

vi.mock("../hooks/queries", () => queryMocks);

vi.mock("./TaskEditor", () => ({
  TaskEditor: ({ task, onClose }: { task: Task; onClose: () => void }) => (
    <div role="dialog" aria-label={`Edit task ${task.title}`}>
      <p>{task.title}</p>
      <button type="button" onClick={onClose}>
        Close editor
      </button>
    </div>
  ),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => <span data-testid="handle" />,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Left: "left", Right: "right" },
  ReactFlow: ({
    nodes,
    edges,
    nodeTypes,
    onConnect,
    onNodeClick,
    onPaneClick,
  }: {
    nodes: Array<{
      id: string;
      type?: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }>;
    edges: Array<{ id: string; style?: { stroke?: string }; animated?: boolean }>;
    nodeTypes: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>;
    onConnect?: (connection: { source: string; target: string }) => void;
    onNodeClick?: (
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
      {edges.map((edge) => (
        <div
          key={edge.id}
          data-testid={`edge-${edge.id}`}
          data-stroke={edge.style?.stroke}
          data-animated={String(edge.animated)}
        />
      ))}
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

  queryMocks.useTasks.mockReturnValue({ data: tasks });
  queryMocks.useUpdateTask.mockReturnValue({ mutate: updateMutate });
  queryMocks.useAddDependency.mockReturnValue({ mutate: addDependencyMutate });

  render(
    <QueryClientProvider client={client}>
      <GraphView project={project} />
    </QueryClientProvider>
  );

  return { updateMutate, addDependencyMutate };
}

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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

  it("highlights the selected relationship chain and clears on pane click", async () => {
    const user = userEvent.setup();
    renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "B", depends_on: ["a"] }),
      task({ id: "c", title: "C", depends_on: ["b"] }),
      task({ id: "d", title: "Unrelated" }),
    ]);

    await user.click(screen.getByTestId("node-b"));

    expect(screen.getByTestId("node-a").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.selected).toBe("true");
    expect(screen.getByTestId("node-c").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("true");

    await user.click(screen.getByTestId("pane"));

    expect(screen.getByTestId("node-d").dataset.dimmed).toBe("false");
    expect(screen.getByTestId("node-b").dataset.selected).toBe("false");
  });

  it("opens the task editor when clicking a graph task node", async () => {
    const user = userEvent.setup();
    renderGraph([
      task({ id: "a", title: "A" }),
      task({ id: "b", title: "Editable task", depends_on: ["a"] }),
    ]);

    await user.click(screen.getByTestId("node-b"));

    expect(
      screen.getByRole("dialog", { name: /edit task editable task/i })
    ).toBeTruthy();
    expect(screen.getByTestId("node-b").dataset.selected).toBe("true");

    await user.click(screen.getByRole("button", { name: /close editor/i }));

    expect(screen.queryByRole("dialog", { name: /edit task editable task/i })).toBeNull();
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
