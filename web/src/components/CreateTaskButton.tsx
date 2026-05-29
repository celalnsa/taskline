import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, TaskType } from "../lib/api";
import { useCreateTask } from "../hooks/queries";

export function CreateTaskButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>("feature");
  const [priority, setPriority] = useState(0);
  const [autoStart, setAutoStart] = useState(true);
  const create = useCreateTask(project.id);

  const submit = useCallback(() => {
    if (!title.trim() || create.isPending) return;
    create.mutate(
      { title, description, type, priority, auto_start: autoStart },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setPriority(0);
          setAutoStart(true);
          setOpen(false);
        },
      }
    );
  }, [autoStart, create, description, priority, title, type]);
  const submitRef = useRef(submit);

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!open && cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (cmd && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-700"
        onClick={() => setOpen(true)}
      >
        + New task
      </button>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/30 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl w-[420px] max-h-[90vh] flex flex-col">
            <button
              type="button"
              aria-label="Close"
              className="absolute top-2 right-2 z-10 text-slate-400 hover:text-slate-700 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <form
              className="p-6 space-y-3 overflow-y-auto"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <h3 className="font-bold pr-8">New task in {project.name}</h3>
              <input
                className="w-full text-sm border rounded px-2 py-1.5"
                placeholder="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className="w-full text-sm border rounded px-2 py-1.5 resize-y min-h-[6rem]"
                rows={3}
                placeholder="description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 text-sm border rounded px-2 py-1.5"
                  value={type}
                  onChange={(e) => setType(e.target.value as TaskType)}
                >
                  <option value="feature">feature</option>
                  <option value="bug">bug</option>
                </select>
                <input
                  type="number"
                  className="w-24 text-sm border rounded px-2 py-1.5"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                  placeholder="priority"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
                <span>
                  Auto-start <span className="text-slate-400">(uncheck to park as pending)</span>
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded border"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {create.isPending ? "Creating…" : "Create"}
                </button>
              </div>
              {create.error && (
                <p className="text-xs text-red-600">{(create.error as Error).message}</p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
