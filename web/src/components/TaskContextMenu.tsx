import { Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Task } from "../lib/api";
import { confirmTaskDelete } from "../lib/taskActions";

type MenuPosition = {
  x: number;
  y: number;
};

interface Props {
  task: Task;
  position: MenuPosition;
  onEdit?: (task: Task) => void;
  onCopy: (task: Task) => void;
  onDelete: (task: Task) => void;
  onClose: () => void;
}

export function TaskContextMenu({
  task,
  position,
  onEdit,
  onCopy,
  onDelete,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const style = useMemo<CSSProperties>(() => {
    const width = 148;
    const height = onEdit ? 120 : 84;
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    const left =
      viewportWidth > 0
        ? Math.max(8, Math.min(position.x, viewportWidth - width - 8))
        : position.x;
    const top =
      viewportHeight > 0
        ? Math.max(8, Math.min(position.y, viewportHeight - height - 8))
        : position.y;
    return { left, top };
  }, [onEdit, position.x, position.y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Task actions for ${task.title}`}
      className="fixed z-50 w-36 rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] p-1 text-sm shadow-[var(--tl-shadow-lift)]"
      style={style}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {onEdit && (
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          onClick={() => {
            onClose();
            onEdit(task);
          }}
        >
          <Pencil size={14} aria-hidden="true" />
          Edit
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
        onClick={() => {
          onClose();
          onCopy(task);
        }}
      >
        <Copy size={14} aria-hidden="true" />
        Copy
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--tl-rust)] hover:bg-[var(--tl-rust-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
        onClick={() => {
          onClose();
          if (!confirmTaskDelete(task)) return;
          onDelete(task);
        }}
      >
        <Trash2 size={14} aria-hidden="true" />
        Delete
      </button>
    </div>
  );
}
