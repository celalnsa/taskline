import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  Position,
  ReactFlow,
  getSmoothStepPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskState,
} from "../lib/api";
import {
  useAddDependency,
  useDeleteDependency,
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "../hooks/queries";
import { createTaskCopyDraft } from "../lib/taskActions";
import { TaskContextMenu } from "./TaskContextMenu";
import { TaskEditor } from "./TaskEditor";

const ACTIVE_EDGE_COLOR = "#0f172a";
const DIMMED_EDGE_COLOR = "#cbd5e1";
const SELECTED_EDGE_COLOR = "#dc2626";
const NODE_SINGLE_CLICK_OPEN_DELAY_MS = 250;

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
type TaskEdgeData = {
  selected: boolean;
  sourceTitle: string;
  targetTitle: string;
  onDelete: () => void;
};
type TaskGraphEdge = Edge<TaskEdgeData, "deletableEdge">;
type TaskMenuState = {
  task: Task;
  x: number;
  y: number;
};

const STATE_ORDER = new Map<TaskState, number>(
  STATES.map((state, index) => [state, index])
);

export function GraphView({ project }: Props) {
  const tasksQ = useTasks(project.id);
  const updateTask = useUpdateTask(project.id);
  const addDependency = useAddDependency(project.id);
  const deleteDependency = useDeleteDependency(project.id);
  const deleteTask = useDeleteTask(project.id);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [copyDraft, setCopyDraft] = useState<Task | null>(null);
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingTaskOpenTimer = useRef<number | null>(null);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);

  const clearPendingTaskOpen = useCallback(() => {
    if (pendingTaskOpenTimer.current === null) return;
    window.clearTimeout(pendingTaskOpenTimer.current);
    pendingTaskOpenTimer.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearPendingTaskOpen();
    };
  }, [clearPendingTaskOpen]);

  const scheduleTaskOpen = useCallback(
    (task: Task) => {
      clearPendingTaskOpen();
      pendingTaskOpenTimer.current = window.setTimeout(() => {
        setEditing(task);
        pendingTaskOpenTimer.current = null;
      }, NODE_SINGLE_CLICK_OPEN_DELAY_MS);
    },
    [clearPendingTaskOpen]
  );

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

  const showMutationError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : "Task update failed");
    setTimeout(() => setError(null), 5000);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const colSpacing = 260;
    const rowSpacing = 110;
    const visibleTasks = tasks.filter((task) => task.state !== "done");
    const visibleTasksById = new Map(visibleTasks.map((task) => [task.id, task]));
    const visibleIds = new Set(visibleTasksById.keys());
    const depths = computeDependencyDepths(visibleTasks);
    const relatedIds = selectedTaskId
      ? collectRelatedTaskIds(selectedTaskId, visibleTasks)
      : selectedEdgeId
        ? collectRelatedEdgeTaskIds(selectedEdgeId, visibleTasks)
        : new Set<string>();
    const hasSelection = !!selectedTaskId || !!selectedEdgeId;
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
          const dimmed = hasSelection && !relatedIds.has(t.id);
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

    const edges: TaskGraphEdge[] = [];
    for (const t of visibleTasks) {
      for (const dep of t.depends_on ?? []) {
        if (!visibleIds.has(dep)) continue;
        const sourceTask = visibleTasksById.get(dep);
        const edgeId = `${dep}->${t.id}`;
        const edgeSelected = selectedEdgeId === edgeId;
        const edgeRelated =
          !hasSelection || (relatedIds.has(dep) && relatedIds.has(t.id));
        const stroke = edgeSelected
          ? SELECTED_EDGE_COLOR
          : edgeRelated
            ? ACTIVE_EDGE_COLOR
            : DIMMED_EDGE_COLOR;
        edges.push({
          id: edgeId,
          source: dep,
          target: t.id,
          type: "deletableEdge",
          animated: edgeRelated && hasSelection,
          data: {
            selected: edgeSelected,
            sourceTitle: sourceTask?.title ?? dep,
            targetTitle: t.title,
            onDelete: () => {
              deleteDependency.mutate({ taskId: t.id, dependsOn: dep });
              setSelectedEdgeId(null);
            },
          },
          style: {
            stroke,
            opacity: edgeRelated ? 1 : 0.25,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
          },
        });
      }
    }
    return { nodes, edges };
  }, [deleteDependency, selectedEdgeId, selectedTaskId, tasks, updateTask]);

  return (
    <div className="relative flex-1 h-full">
      {error && (
        <div
          role="alert"
          className="absolute left-4 right-4 top-4 z-20 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm"
        >
          {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={{ deletableEdge: DeletableEdge }}
        nodeTypes={{ taskNode: TaskNode }}
        onConnect={onConnect}
        onEdgeClick={(event, edge) => {
          event.stopPropagation();
          clearPendingTaskOpen();
          setSelectedTaskId(null);
          setSelectedEdgeId(edge.id);
        }}
        onNodeClick={(_, node) => {
          setTaskMenu(null);
          setSelectedTaskId(null);
          setSelectedEdgeId(null);
          scheduleTaskOpen(node.data.task);
        }}
        onNodeDoubleClick={(event, node) => {
          event.stopPropagation();
          clearPendingTaskOpen();
          setSelectedTaskId(node.id);
          setSelectedEdgeId(null);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          event.stopPropagation();
          clearPendingTaskOpen();
          setSelectedTaskId(null);
          setSelectedEdgeId(null);
          setTaskMenu({ task: node.data.task, x: event.clientX, y: event.clientY });
        }}
        onPaneClick={() => {
          clearPendingTaskOpen();
          setTaskMenu(null);
          setSelectedTaskId(null);
          setSelectedEdgeId(null);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
      {editing && (
        <TaskEditor
          project={project}
          task={editing}
          allTasks={tasks}
          onClose={() => setEditing(null)}
        />
      )}
      {copyDraft && (
        <TaskEditor
          project={project}
          task={copyDraft}
          allTasks={tasks}
          mode="create"
          onClose={() => setCopyDraft(null)}
        />
      )}
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          position={{ x: taskMenu.x, y: taskMenu.y }}
          onClose={() => setTaskMenu(null)}
          onCopy={(task) => setCopyDraft(createTaskCopyDraft(task))}
          onDelete={(task) => {
            deleteTask.mutate(task.id, { onError: showMutationError });
            setSelectedTaskId(null);
            setSelectedEdgeId(null);
          }}
        />
      )}
    </div>
  );
}

function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<TaskGraphEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const {
    selected = false,
    sourceTitle = "",
    targetTitle = "",
    onDelete,
  } = data ?? {};

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label={`Delete dependency ${sourceTitle} to ${targetTitle}`}
            title="Delete dependency"
            className="nodrag nopan absolute flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50"
            style={{
              pointerEvents: "all",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 18}px)`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onDelete?.();
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
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
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
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

function collectRelatedEdgeTaskIds(selectedEdgeId: string, tasks: Task[]): Set<string> {
  const [sourceId, targetId] = selectedEdgeId.split("->");
  if (!sourceId || !targetId) return new Set();
  const related = collectRelatedTaskIds(sourceId, tasks);
  for (const id of collectRelatedTaskIds(targetId, tasks)) {
    related.add(id);
  }
  return related;
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
