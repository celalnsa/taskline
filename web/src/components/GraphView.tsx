import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  type Node,
  type Edge,
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
import { useTasks, useUpdateTask } from "../hooks/queries";

const STATE_COLORS: Record<TaskState, string> = {
  pending: "#e2e8f0",
  start: "#cbd5e1",
  spec: "#a5b4fc",
  dev: "#86efac",
  review: "#fdba74",
  done: "#9ca3af",
};

interface Props {
  project: Project;
}

export function GraphView({ project }: Props) {
  const tasksQ = useTasks(project.id);
  const updateTask = useUpdateTask(project.id);
  const tasks = tasksQ.data ?? [];

  // Layout: rough column-by-state, ordered top-to-bottom by priority.
  // Not a real DAG layout, but predictable and quick.
  const { nodes, edges } = useMemo(() => {
    const colSpacing = 240;
    const rowSpacing = 110;
    const cols = {} as Record<TaskState, Task[]>;
    for (const s of STATES) cols[s] = [];
    // Defensive: a task may carry a state the web doesn't know about
    // (e.g. server is one revision ahead of the bundled web). Skip
    // those rather than crashing on undefined.push.
    for (const t of tasks) {
      if (cols[t.state]) cols[t.state].push(t);
    }
    for (const s of STATES) {
      cols[s].sort((a, b) => b.priority - a.priority);
    }
    const nodes: Node[] = [];
    STATES.forEach((s, ci) => {
      cols[s].forEach((t, ri) => {
        nodes.push({
          id: t.id,
          type: "taskNode",
          position: { x: ci * colSpacing, y: ri * rowSpacing },
          data: {
            task: t,
            onAdvance: (next: TaskState) =>
              updateTask.mutate({ id: t.id, patch: { state: next } }),
          },
        });
      });
    });
    const edges: Edge[] = [];
    for (const t of tasks) {
      for (const dep of t.depends_on ?? []) {
        edges.push({
          id: `${dep}->${t.id}`,
          source: dep,
          target: t.id,
          animated: true,
          style: { stroke: "#475569" },
        });
      }
    }
    return { nodes, edges };
  }, [tasks, updateTask]);

  return (
    <div className="flex-1 h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ taskNode: TaskNode }}
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
  data: { task: Task; onAdvance: (next: TaskState) => void };
}) {
  const { task, onAdvance } = data;
  return (
    <div
      className="rounded-md shadow-sm border border-slate-300 bg-white px-3 py-2 w-[200px] text-xs"
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
