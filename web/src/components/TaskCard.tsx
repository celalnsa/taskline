import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../lib/api";
import { formatRelativeTime } from "../lib/time";

interface Props {
  task: Task;
  isBlocked: boolean;
  onClick: () => void;
  // When true, the card renders as a static clone for use inside
  // <DragOverlay/> — no useDraggable wiring, no transform, the
  // overlay handles positioning. The original card in the column
  // also accepts this flag indirectly via `isDragging`, where it
  // fades out so only the overlay clone is visible during drag.
  overlay?: boolean;
}

export function TaskCard({ task, isBlocked, onClick, overlay = false }: Props) {
  // Disable the draggable hook entirely on the overlay clone so the
  // DOM only has a single registered draggable per task id.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  });

  // The overlay positions itself via dnd-kit; we must NOT also apply
  // the transform here or the card would double-translate.
  const style: React.CSSProperties =
    !overlay && transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          zIndex: 50,
        }
      : {};

  const typeColor =
    task.type === "bug"
      ? "border-l-red-500"
      : "border-l-sky-500";

  // While the real card is being dragged, fade it almost-out so the
  // overlay clone is what the eye tracks. Without this, you'd see
  // both the source and the overlay at once.
  const dragVisualClass = overlay
    ? " shadow-2xl ring-1 ring-slate-300 cursor-grabbing"
    : isDragging
    ? " opacity-30"
    : isBlocked
    ? " opacity-70"
    : "";

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      className={
        "rounded-md border border-slate-200 bg-white p-3 shadow-sm border-l-4 " +
        typeColor +
        dragVisualClass
      }
    >
      <div
        className={
          "flex items-start gap-2" +
          (overlay ? "" : " cursor-grab active:cursor-grabbing")
        }
        {...(overlay ? {} : attributes)}
        {...(overlay ? {} : listeners)}
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
