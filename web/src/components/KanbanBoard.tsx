import { useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskState,
} from "../lib/api";
import { useTasks, useUpdateTask } from "../hooks/queries";
import { TaskCard } from "./TaskCard";
import { TaskEditor } from "./TaskEditor";
import { CreateTaskButton } from "./CreateTaskButton";

interface Props {
  project: Project;
}

export function KanbanBoard({ project }: Props) {
  const tasksQ = useTasks(project.id);
  const updateTask = useUpdateTask(project.id);
  const [editing, setEditing] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    // 4px movement before a drag begins so click-to-edit isn't hijacked.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const tasks = tasksQ.data ?? [];

  // doneIds drives the "blocked" badge — every dep must be in done state.
  const doneIds = useMemo(
    () => new Set(tasks.filter((t) => t.state === "done").map((t) => t.id)),
    [tasks]
  );
  const isBlocked = (t: Task) =>
    !!t.depends_on?.length && t.depends_on.some((d) => !doneIds.has(d));

  const grouped = useMemo(() => {
    const out = Object.fromEntries(STATES.map((s) => [s, [] as Task[]])) as Record<
      TaskState,
      Task[]
    >;
    for (const t of tasks) {
      // Tolerate states the web doesn't know about (server one rev ahead).
      if (out[t.state]) out[t.state].push(t);
    }
    for (const k of STATES) {
      out[k].sort((a, b) => b.priority - a.priority || a.created_at - b.created_at);
    }
    return out;
  }, [tasks]);

  function onDragEnd(ev: DragEndEvent) {
    const taskId = String(ev.active.id);
    const target = ev.over?.id as TaskState | undefined;
    if (!target) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.state === target) return;
    updateTask.mutate(
      { id: taskId, patch: { state: target } },
      {
        onError: (err) => {
          setError((err as Error).message);
          setTimeout(() => setError(null), 5000);
        },
      }
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h2 className="text-lg font-bold">{project.name}</h2>
          {project.description && (
            <p className="text-xs text-slate-500">{project.description}</p>
          )}
        </div>
        <CreateTaskButton project={project} />
      </header>
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full w-fit min-w-full gap-3 p-4">
            {STATES.map((s) => (
              <Column key={s} state={s}>
                {grouped[s].map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    isBlocked={isBlocked(t)}
                    onClick={() => setEditing(t)}
                  />
                ))}
              </Column>
            ))}
          </div>
        </div>
      </DndContext>
      {editing && (
        <TaskEditor
          project={project}
          task={editing}
          allTasks={tasks}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Column({ state, children }: { state: TaskState; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  return (
    <div
      ref={setNodeRef}
      className={
        "flex-1 min-w-48 max-w-72 rounded-lg bg-slate-100 p-3 flex flex-col gap-2 transition " +
        (isOver ? "ring-2 ring-emerald-400" : "")
      }
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          {STATE_LABELS[state]}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">{children}</div>
    </div>
  );
}
