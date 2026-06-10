import { useDraggable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";
import { useRef } from "react";
import type { Task } from "../lib/api";
import { getTaskLabelTheme, taskLabelChipClass } from "../lib/labels";
import { formatRelativeTime } from "../lib/time";

interface Props {
  task: Task;
  isBlocked: boolean;
  onClick: () => void;
  onDelete?: () => void;
  // When true, the card renders as a static clone for use inside
  // <DragOverlay/> — no useDraggable wiring, no transform, the
  // overlay handles positioning. The original card in the column
  // also accepts this flag indirectly via `isDragging`, where it
  // fades out so only the overlay clone is visible during drag.
  overlay?: boolean;
}

export function TaskCard({ task, isBlocked, onClick, onDelete, overlay = false }: Props) {
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const skipNextDeleteClick = useRef(false);
  const labels = task.labels ?? [];
  const visibleLabels = labels.slice(0, 3);
  const hiddenLabelCount = Math.max(0, labels.length - visibleLabels.length);
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

  const interactiveClass = overlay
    ? ""
    : " cursor-pointer hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400";

  function openFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (overlay) return;
    if (event.button !== 0) {
      pointerStart.current = null;
      return;
    }
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) return;
    onClick();
  }

  function startPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    listeners?.onPointerDown?.(event);
  }

  function openFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!overlay && event.key === "Enter") {
      event.preventDefault();
      onClick();
      return;
    }
    listeners?.onKeyDown?.(event);
  }

  function deleteFromCard() {
    pointerStart.current = null;
    if (
      !globalThis.confirm(
        `Delete task "${task.title}"? This cascades to dependencies and images.`
      )
    ) {
      return;
    }
    onDelete?.();
  }

  function skipFollowUpClick() {
    skipNextDeleteClick.current = true;
    window.setTimeout(() => {
      skipNextDeleteClick.current = false;
    }, 0);
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      aria-label={overlay ? undefined : `Open task ${task.title}`}
      onPointerDown={overlay ? undefined : startPointerInteraction}
      onPointerUp={openFromPointer}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onKeyDown={openFromKeyboard}
      className={
        "relative group rounded-md border border-slate-200 bg-white p-3 shadow-sm border-l-4 transition " +
        typeColor +
        dragVisualClass +
        interactiveClass
      }
    >
      {!overlay && onDelete && (
        <button
          type="button"
          aria-label={`Delete task ${task.title}`}
          title="Delete task"
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white/90 text-slate-400 opacity-0 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-300 group-hover:opacity-100"
          onPointerDown={(event) => {
            event.stopPropagation();
            pointerStart.current = null;
          }}
          onPointerUp={(event) => {
            event.stopPropagation();
            if (event.button !== 0) return;
            deleteFromCard();
            skipFollowUpClick();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (skipNextDeleteClick.current) {
              skipNextDeleteClick.current = false;
              return;
            }
            deleteFromCard();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            deleteFromCard();
          }}
        >
          <Trash2 size={13} className="mx-auto" aria-hidden="true" />
        </button>
      )}
      <div className="flex items-start gap-2 pr-7">
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
          {labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {visibleLabels.map((label) => (
                <span
                  key={label}
                  data-label-theme={getTaskLabelTheme(label).name}
                  className={
                    "max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] leading-4 " +
                    taskLabelChipClass(label)
                  }
                  title={label}
                >
                  {label}
                </span>
              ))}
              {hiddenLabelCount > 0 && (
                <span
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] leading-4 text-slate-400"
                  title={`${hiddenLabelCount} more labels`}
                >
                  +{hiddenLabelCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end">
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
