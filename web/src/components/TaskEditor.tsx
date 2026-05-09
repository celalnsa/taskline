import { useEffect, useState } from "react";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskState,
  type TaskType,
} from "../lib/api";
import {
  useAddDependency,
  useDeleteTask,
  useUpdateTask,
} from "../hooks/queries";

interface Props {
  project: Project;
  task: Task;
  allTasks: Task[];
  onClose: () => void;
}

export function TaskEditor({ project, task, allTasks, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [type, setType] = useState<TaskType>(task.type);
  const [state, setState] = useState<TaskState>(task.state);
  const [priority, setPriority] = useState(task.priority);
  const [depTarget, setDepTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const update = useUpdateTask(project.id);
  const del = useDeleteTask(project.id);
  const addDep = useAddDependency(project.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Filter dep candidates: any other task in the same project that this
  // task isn't already blocked on.
  const depCandidates = allTasks.filter(
    (t) => t.id !== task.id && !task.depends_on?.includes(t.id)
  );

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
      <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] flex flex-col">
        <button
          type="button"
          aria-label="Close"
          className="absolute top-2 right-2 z-10 text-slate-400 hover:text-slate-700 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100"
          onClick={onClose}
        >
          ×
        </button>
        <div className="p-6 space-y-3 overflow-y-auto">
        <div className="flex items-start justify-between pr-8">
          <h3 className="font-bold text-base">Edit task</h3>
          <code className="text-[10px] text-slate-400">{task.id.slice(0, 8)}</code>
        </div>
        <input
          className="w-full text-sm border rounded px-2 py-1.5 font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="w-full text-sm border rounded px-2 py-1.5 resize-y min-h-[6rem]"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs space-y-1">
            <span className="text-slate-500">Type</span>
            <select
              className="w-full border rounded px-2 py-1"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
            >
              <option value="feature">feature</option>
              <option value="bug">bug</option>
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="text-slate-500">State</span>
            <select
              className="w-full border rounded px-2 py-1"
              value={state}
              onChange={(e) => {
                setState(e.target.value as TaskState);
                setError(null);
              }}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="text-slate-500">Priority</span>
            <input
              type="number"
              className="w-full border rounded px-2 py-1 tabular-nums"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            />
          </label>
        </div>

        <DepSection task={task} allTasks={allTasks} />

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-end gap-2">
            <select
              className="flex-1 text-xs border rounded px-2 py-1"
              value={depTarget}
              onChange={(e) => setDepTarget(e.target.value)}
            >
              <option value="">add dependency…</option>
              {depCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.state})
                </option>
              ))}
            </select>
            <button
              className="text-xs px-3 py-1 rounded bg-slate-700 text-white disabled:opacity-50"
              disabled={!depTarget || addDep.isPending}
              onClick={async () => {
                try {
                  await addDep.mutateAsync({ taskId: task.id, dependsOn: depTarget });
                  setDepTarget("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Block on
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-between pt-3 border-t">
          <button
            className="text-sm px-3 py-1.5 rounded text-red-600 hover:bg-red-50"
            onClick={async () => {
              if (!confirm(`Delete task "${task.title}"? This cascades to dependencies and images.`)) return;
              try {
                await del.mutateAsync(task.id);
                onClose();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded border"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({
                    id: task.id,
                    patch: { title, description, type, state, priority },
                  });
                  onClose();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function DepSection({ task, allTasks }: { task: Task; allTasks: Task[] }) {
  if (!task.depends_on?.length) return null;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  return (
    <div className="border-t pt-3 space-y-1">
      <p className="text-xs font-medium text-slate-500">Blocks until done:</p>
      <ul className="space-y-1">
        {task.depends_on.map((id) => {
          const dep = byId.get(id);
          return (
            <li key={id} className="text-xs flex items-center gap-2">
              <code className="text-slate-400">{id.slice(0, 8)}</code>
              {dep ? (
                <>
                  <span className="font-medium">{dep.title}</span>
                  <span
                    className={
                      "px-1 rounded text-[10px] " +
                      (dep.state === "done"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800")
                    }
                  >
                    {dep.state}
                  </span>
                </>
              ) : (
                <span className="text-slate-400 italic">(deleted)</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
