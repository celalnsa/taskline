import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskState,
} from "../lib/api";
import { useAddDependency, useTasks, useUpdateTask } from "../hooks/queries";

const STATE_COLORS: Record<TaskState, string> = {
  pending: "#e2e8f0",
  start: "#cbd5e1",
  spec: "#a5b4fc",
  dev: "#86efac",
  test: "#facc15",
  review: "#fdba74",
  done: "#9ca3af",
};

interface Props {
  project: Project;
}

type TaskNodeData = {
  task: Task;
  onAdvance: (next: TaskState) => void;
  selected: boolean;
  dimmed: boolean;
};

type TaskGraphNode = Node<TaskNodeData, "taskNode">;

const STATE_ORDER = new Map<TaskState, number>(
  STATES.map((state, index) => [state, index])
);

export function GraphView({ project }: Props) {
  const tasksQ = useTasks(project.id);
  const updateTask = useUpdateTask(project.id);
  const addDependency = useAddDependency(project.id);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const targetTask = tasks.find((task) => task.id === connection.target);
      if (targetTask?.depends_on?.includes(connection.source)) return;
      addDependency.mutate({
        taskId: connection.target,
        dependsOn: connection.source,
      });
    },
    [addDependency, tasks]
  );

  const { nodes, edges } = useMemo(() => {
    const colSpacing = 260;
    const rowSpacing = 110;
    const visibleTasks = tasks.filter((task) => task.state !== "done");
    const visibleIds = new Set(visibleTasks.map((task) => task.id));
    const depths = computeDependencyDepths(visibleTasks);
    const relatedIds = selectedTaskId
      ? collectRelatedTaskIds(selectedTaskId, visibleTasks)
      : new Set<string>();
    const rowsByDepth = new Map<number, Task[]>();

    for (const task of visibleTasks) {
      const depth = depths.get(task.id) ?? 0;
      const row = rowsByDepth.get(depth) ?? [];
      row.push(task);
      rowsByDepth.set(depth, row);
    }

    const nodes: TaskGraphNode[] = [];
    Array.from(rowsByDepth.keys())
      .sort((a, b) => a - b)
      .forEach((depth) => {
        const row = rowsByDepth.get(depth) ?? [];
        row.sort(compareGraphTasks);
        row.forEach((t, ri) => {
          const selected = selectedTaskId === t.id;
          const dimmed = !!selectedTaskId && !relatedIds.has(t.id);
          nodes.push({
            id: t.id,
            type: "taskNode",
            position: { x: depth * colSpacing, y: ri * rowSpacing },
            data: {
              task: t,
              onAdvance: (next: TaskState) =>
                updateTask.mutate({ id: t.id, patch: { state: next } }),
              selected,
              dimmed,
            },
          });
        });
      });

    const edges: Edge[] = [];
    for (const t of visibleTasks) {
      for (const dep of t.depends_on ?? []) {
        if (!visibleIds.has(dep)) continue;
        const edgeRelated =
          !selectedTaskId || (relatedIds.has(dep) && relatedIds.has(t.id));
        edges.push({
          id: `${dep}->${t.id}`,
          source: dep,
          target: t.id,
          type: "smoothstep",
          animated: edgeRelated && !!selectedTaskId,
          style: {
            stroke: edgeRelated ? "#0f172a" : "#cbd5e1",
            opacity: edgeRelated ? 1 : 0.25,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeRelated ? "#0f172a" : "#cbd5e1",
          },
        });
      }
    }
    return { nodes, edges };
  }, [selectedTaskId, tasks, updateTask]);

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ taskNode: TaskNode }}
        onConnect={onConnect}
        onNodeClick={(_, node) => setSelectedTaskId(node.id)}
        onPaneClick={() => setSelectedTaskId(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function TaskNode({
  data,
}: {
  data: TaskNodeData;
}) {
  const { task, onAdvance, selected, dimmed } = data;
  return (
    <div
      className={`rounded-md shadow-sm border border-slate-300 bg-white px-3 py-2 w-[200px] text-xs transition ${
        selected ? "ring-2 ring-sky-400 shadow-md" : ""
      } ${dimmed ? "opacity-30" : "opacity-100"}`}
      style={{ borderTopColor: STATE_COLORS[task.state], borderTopWidth: 4 }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase text-slate-500">{task.type}</span>
        <span className="text-[10px] tabular-nums text-slate-400">p={task.priority}</span>
      </div>
      <p className="font-medium leading-snug">{task.title}</p>
      <select
        className="mt-2 w-full text-[10px] border rounded px-1 py-0.5"
        value={task.state}
        onChange={(e) => {
          const next = e.target.value as TaskState;
          if (next !== task.state) {
            onAdvance(next);
          }
        }}
      >
        {Object.entries(STATE_LABELS).map(([s, label]) => (
          <option key={s} value={s}>
            {label}
          </option>
        ))}
      </select>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function compareGraphTasks(a: Task, b: Task): number {
  return (
    (STATE_ORDER.get(a.state) ?? 0) - (STATE_ORDER.get(b.state) ?? 0) ||
    b.priority - a.priority ||
    a.created_at - b.created_at ||
    a.title.localeCompare(b.title)
  );
}

function computeDependencyDepths(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (taskID: string): number => {
    if (memo.has(taskID)) return memo.get(taskID)!;
    const task = byId.get(taskID);
    if (!task || visiting.has(taskID)) return 0;
    visiting.add(taskID);
    const visibleDeps = (task.depends_on ?? []).filter((dep) => byId.has(dep));
    const depth =
      visibleDeps.length === 0
        ? 0
        : Math.max(...visibleDeps.map((dep) => depthOf(dep) + 1));
    visiting.delete(taskID);
    memo.set(taskID, depth);
    return depth;
  };

  for (const task of tasks) depthOf(task.id);
  return memo;
}

function collectRelatedTaskIds(selectedTaskId: string, tasks: Task[]): Set<string> {
  const byId = new Set(tasks.map((task) => task.id));
  if (!byId.has(selectedTaskId)) return new Set();

  const depsByTask = new Map<string, string[]>();
  const childrenByTask = new Map<string, string[]>();
  for (const task of tasks) {
    const deps = (task.depends_on ?? []).filter((dep) => byId.has(dep));
    depsByTask.set(task.id, deps);
    for (const dep of deps) {
      const children = childrenByTask.get(dep) ?? [];
      children.push(task.id);
      childrenByTask.set(dep, children);
    }
  }

  const related = new Set<string>([selectedTaskId]);
  const visitAncestors = (taskID: string) => {
    for (const dep of depsByTask.get(taskID) ?? []) {
      if (related.has(dep)) continue;
      related.add(dep);
      visitAncestors(dep);
    }
  };
  const visitDescendants = (taskID: string) => {
    for (const child of childrenByTask.get(taskID) ?? []) {
      if (related.has(child)) continue;
      related.add(child);
      visitDescendants(child);
    }
  };

  visitAncestors(selectedTaskId);
  visitDescendants(selectedTaskId);
  return related;
}
