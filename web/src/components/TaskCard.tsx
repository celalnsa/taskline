import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../lib/api";
import { formatRelativeTime } from "../lib/time";

interface Props {
  task: Task;
  isBlocked: boolean;
  onClick: () => void;
}

export function TaskCard({ task, isBlocked, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : {};

  const typeColor =
    task.type === "bug"
      ? "border-l-red-500"
      : "border-l-sky-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "rounded-md border border-slate-200 bg-white p-3 shadow-sm border-l-4 " +
        typeColor +
        (isDragging ? " opacity-60" : "") +
        (isBlocked ? " opacity-70" : "")
      }
    >
      <div
        className="flex items-start gap-2 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {task.type}
            </span>
            <span className="text-[10px] tabular-nums text-slate-400">
              p={task.priority}
            </span>
            {isBlocked && (
              <span
                className="text-[10px] px-1 rounded bg-amber-100 text-amber-800"
                title="Blocked: depends on other tasks not yet done"
              >
                blocked
              </span>
            )}
            {task.depends_on && task.depends_on.length > 0 && (
              <span className="text-[10px] text-slate-400">
                deps: {task.depends_on.length}
              </span>
            )}
            {task.links && task.links.length > 0 && (
              <span className="text-[10px] text-slate-400" title="attached links">
                🔗 {task.links.length}
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-snug">{task.title}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={onClick}
          className="text-[10px] text-slate-500 hover:text-slate-900 underline"
        >
          edit
        </button>
        <span
          className="text-[10px] tabular-nums text-slate-400"
          title={new Date(task.updated_at).toLocaleString()}
        >
          {formatRelativeTime(task.updated_at)}
        </span>
      </div>
    </div>
  );
}
