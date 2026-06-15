import { useEffect, useState } from "react";
import type { Project, Task } from "../lib/api";
import { TaskEditor } from "./TaskEditor";

export function CreateTaskButton({ project, allTasks }: { project: Project; allTasks: Task[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!open && cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--tl-primary)] px-3 py-0 text-sm text-[var(--tl-surface)] shadow-[var(--tl-shadow-paper)] transition hover:bg-[var(--tl-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)] max-sm:px-2 max-sm:text-xs"
        onClick={() => setOpen(true)}
      >
        + New
      </button>
      {open && (
        <TaskEditor
          project={project}
          allTasks={allTasks}
          mode="create"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
