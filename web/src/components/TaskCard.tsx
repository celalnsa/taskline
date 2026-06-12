import { useDraggable } from "@dnd-kit/core";
import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { Task } from "../lib/api";
import { getTaskLabelTheme, taskLabelChipClass } from "../lib/labels";
import { formatRelativeTime } from "../lib/time";

const MAX_VISIBLE_CARD_CHIPS = 4;

interface Props {
  task: Task;
  isBlocked: boolean;
  onClick: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  // When true, the card renders as a static clone for use inside
  // <DragOverlay/> — no useDraggable wiring, no transform, the
  // overlay handles positioning. The original card in the column
  // also accepts this flag indirectly via `isDragging`, where it
  // fades out so only the overlay clone is visible during drag.
  overlay?: boolean;
}

export function TaskCard({ task, isBlocked, onClick, onContextMenu, overlay = false }: Props) {
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const labels = task.labels ?? [];
  const dependencyCount = task.depends_on?.length ?? 0;
  const metadataChipCount = 1 + (dependencyCount > 0 ? 1 : 0);
  const visibleLabelCount = Math.max(0, MAX_VISIBLE_CARD_CHIPS - metadataChipCount);
  const visibleLabels = labels.slice(0, visibleLabelCount);
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
      : task.type === "docs"
        ? "border-l-violet-500"
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

  const labelChipClass =
    "max-w-full shrink-0 truncate whitespace-nowrap rounded border px-1 py-0.5 text-[10px] leading-3";

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

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      data-task-card={overlay ? undefined : "true"}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      aria-label={overlay ? undefined : `Open task ${task.title}`}
      onPointerDown={overlay ? undefined : startPointerInteraction}
      onPointerUp={openFromPointer}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onKeyDown={openFromKeyboard}
      onContextMenu={
        overlay
          ? undefined
          : (event) => {
              pointerStart.current = null;
              event.preventDefault();
              event.stopPropagation();
              onContextMenu?.(event);
            }
      }
      className={
        "relative group rounded-md border border-slate-200 bg-white p-2.5 shadow-sm border-l-4 transition " +
        typeColor +
        dragVisualClass +
        interactiveClass
      }
    >
      <div className="min-w-0 pr-6">
        <div>
          <p className="line-clamp-2 min-w-0 text-[13px] font-medium leading-snug text-slate-900">
            {task.title}
          </p>
        </div>
        <div className="mt-1.5 flex max-h-[42px] min-w-0 flex-wrap items-start gap-1 overflow-hidden">
          <span
            className={`${labelChipClass} border-sky-200 bg-sky-50 text-sky-700`}
            title={`Priority ${task.priority}`}
          >
            p {task.priority}
          </span>
          {dependencyCount > 0 && (
            <span
              className={`${labelChipClass} ${
                isBlocked
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
              title={
                isBlocked ? "Blocked: depends on other tasks not yet done" : "Dependencies are done"
              }
            >
              deps {dependencyCount}
            </span>
          )}
          {visibleLabels.map((label) => (
            <span
              key={label}
              data-label-theme={getTaskLabelTheme(label).name}
              className={`${labelChipClass} ${taskLabelChipClass(label)}`}
              title={label}
            >
              {label}
            </span>
          ))}
          {hiddenLabelCount > 0 && (
            <span
              className={`${labelChipClass} border-slate-200 bg-white text-slate-400`}
              title={`${hiddenLabelCount} more labels`}
            >
              +{hiddenLabelCount}
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end">
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
