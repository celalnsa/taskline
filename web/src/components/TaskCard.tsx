import { useDraggable } from "@dnd-kit/core";
import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Bot } from "lucide-react";
import type { Task } from "../lib/api";
import { getTaskLabelTheme, taskLabelChipClass } from "../lib/labels";
import { formatElapsedTime, formatRelativeTime } from "../lib/time";

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
  const claimOwner = task.owner?.trim();
  const claimVerb = task.state === "done" ? "worked" : "working";
  const claimElapsed = task.claimed_at
    ? task.state === "done"
      ? formatElapsedTime(task.claimed_at, task.updated_at)
      : formatElapsedTime(task.claimed_at)
    : "";
  const claimTitle = claimOwner
    ? buildClaimTitle(task, claimOwner, claimVerb, claimElapsed)
    : undefined;
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
    ? " shadow-[var(--tl-shadow-card-hover)] ring-1 ring-[var(--tl-outline-strong)] cursor-grabbing"
    : isDragging
    ? " opacity-30"
    : isBlocked
    ? " opacity-70"
    : "";

  const interactiveClass = overlay
    ? ""
    : " cursor-pointer hover:border-[var(--tl-outline-strong)] hover:shadow-[var(--tl-shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]";

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
      data-visual-style="wabi-sabi"
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
        "relative group rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] p-2.5 shadow-[var(--tl-shadow-card)] border-l-4 transition " +
        typeColor +
        dragVisualClass +
        interactiveClass
      }
    >
      <div className="min-w-0">
        <div>
          <p className="line-clamp-2 min-w-0 text-[13px] font-medium leading-snug text-[var(--tl-ink)]">
            {task.title}
          </p>
        </div>
        <div className="mt-1.5 flex max-h-[42px] min-w-0 flex-wrap items-start gap-1 overflow-hidden">
          <span
            className={`${labelChipClass} border-[var(--tl-water)]/35 bg-[var(--tl-water-soft)] text-[var(--tl-water)]`}
            title={`Priority ${task.priority}`}
          >
            p {task.priority}
          </span>
          {dependencyCount > 0 && (
            <span
              className={`${labelChipClass} ${
                isBlocked
                  ? "border-[var(--tl-ochre)]/35 bg-[var(--tl-ochre-soft)] text-[var(--tl-ochre)]"
                  : "border-[var(--tl-moss)]/35 bg-[var(--tl-moss-soft)] text-[var(--tl-moss)]"
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
              className={`${labelChipClass} border-[var(--tl-outline)] bg-[var(--tl-surface)] text-[var(--tl-ink-faint)]`}
              title={`${hiddenLabelCount} more labels`}
            >
              +{hiddenLabelCount}
            </span>
          )}
        </div>
      </div>
      {claimOwner && (
        <div className="mt-1.5 min-w-0">
          <span
            aria-label={
              claimElapsed
                ? `Claimed by ${claimOwner}, ${claimVerb} ${claimElapsed}`
                : `Claimed by ${claimOwner}`
            }
            className="inline-flex max-w-full min-w-0 items-center gap-1 rounded border border-[var(--tl-outline)] bg-[var(--tl-bg-quiet)] px-1.5 py-0.5 text-[10px] leading-3 text-[var(--tl-ink-muted)]"
            title={claimTitle}
          >
            <Bot size={11} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 truncate">{claimOwner}</span>
            {claimElapsed && (
              <span className="shrink-0 whitespace-nowrap">
                {" "}
                {claimVerb} <span className="tabular-nums">{claimElapsed}</span>
              </span>
            )}
          </span>
        </div>
      )}
      <div className="mt-1 flex min-w-0 justify-end">
        <span
          className="shrink-0 text-[10px] tabular-nums text-[var(--tl-ink-faint)]"
          title={new Date(task.updated_at).toLocaleString()}
        >
          {formatRelativeTime(task.updated_at)}
        </span>
      </div>
    </div>
  );
}

function buildClaimTitle(
  task: Task,
  owner: string,
  claimVerb: "working" | "worked",
  claimElapsed: string
): string {
  const parts = [`Owner: ${owner}`];
  if (claimElapsed) {
    parts.push(`${claimVerb === "worked" ? "Worked" : "Working"} ${claimElapsed}`);
  }
  if (task.claimed_at) {
    parts.push(
      `Claimed ${formatRelativeTime(task.claimed_at)} (${new Date(task.claimed_at).toLocaleString()})`
    );
  }
  if (task.lease_expires_at) {
    parts.push(`Lease expires ${new Date(task.lease_expires_at).toLocaleString()}`);
  }
  return parts.join(" · ");
}
