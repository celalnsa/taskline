import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { ArrowUpDown, Check } from "lucide-react";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskState,
} from "../lib/api";
import { useDeleteTask, useTasks, useUpdateTask } from "../hooks/queries";
import { createTaskCopyDraft } from "../lib/taskActions";
import { TaskCard } from "./TaskCard";
import { TaskContextMenu } from "./TaskContextMenu";
import { TaskEditor } from "./TaskEditor";

interface Props {
  project: Project;
}

// Module-level stable empty reference so `tasks` keeps the same identity
// across renders while the query is loading. Otherwise `[] !== []` would
// invalidate every dependent useMemo on each render.
const NO_TASKS: Task[] = [];

type TaskMenuState = {
  task: Task;
  x: number;
  y: number;
};

type BoardPanState = {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
};

type ColumnSortMode = "execution" | "priority" | "created" | "updated";

const SORT_OPTIONS: Array<{ id: ColumnSortMode; label: string }> = [
  { id: "execution", label: "Next execution order" },
  { id: "priority", label: "Priority high to low" },
  { id: "created", label: "Created oldest first" },
  { id: "updated", label: "Recently updated" },
];

const BOARD_PAN_BLOCK_SELECTOR = [
  "[data-task-card]",
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='dialog']",
  "[role='menu']",
  "[contenteditable='true']",
].join(",");

function canStartBoardPan(target: EventTarget | null) {
  return target instanceof Element && !target.closest(BOARD_PAN_BLOCK_SELECTOR);
}

function isScrollbarPointer(event: React.PointerEvent<HTMLDivElement>) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const horizontalScrollbarHeight = el.offsetHeight - el.clientHeight;
  const verticalScrollbarWidth = el.offsetWidth - el.clientWidth;
  return (
    (horizontalScrollbarHeight > 0 &&
      event.clientY >= rect.bottom - horizontalScrollbarHeight) ||
    (verticalScrollbarWidth > 0 && event.clientX >= rect.right - verticalScrollbarWidth)
  );
}

export function KanbanBoard({ project }: Props) {
  const tasksQ = useTasks(project.id);
  const updateTask = useUpdateTask(project.id);
  const deleteTask = useDeleteTask(project.id);
  const [editing, setEditing] = useState<Task | null>(null);
  const [copyDraft, setCopyDraft] = useState<Task | null>(null);
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columnSortModes, setColumnSortModes] = useState<Record<TaskState, ColumnSortMode>>(() =>
    createDefaultColumnSortModes()
  );
  const [openSortMenu, setOpenSortMenu] = useState<TaskState | null>(null);
  const boardPan = useRef<BoardPanState | null>(null);
  // Track which task is currently being dragged so we can render it in a
  // <DragOverlay>. Without the overlay, the card stays in its source
  // column's DOM and gets visually clipped by the column's overflow-auto
  // (and the kanban scroller's overflow-x-auto/overflow-y-hidden), which
  // is what made cards "disappear" mid-drag.
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(
    // 4px movement before a drag begins so click-to-edit isn't hijacked.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const tasks = tasksQ.data ?? NO_TASKS;

  // doneIds drives the "blocked" badge — every dep must be in done state.
  const doneIds = useMemo(
    () => new Set(tasks.filter((t) => t.state === "done").map((t) => t.id)),
    [tasks]
  );
  const isBlocked = (t: Task) => isTaskBlocked(t, doneIds);

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
      out[k].sort((a, b) => compareTasksForColumn(a, b, columnSortModes[k], doneIds));
    }
    return out;
  }, [columnSortModes, doneIds, tasks]);

  function updateColumnSortMode(state: TaskState, mode: ColumnSortMode) {
    setColumnSortModes((current) => ({ ...current, [state]: mode }));
    setOpenSortMenu(null);
  }

  function onDragStart(ev: DragStartEvent) {
    const t = tasks.find((t) => t.id === String(ev.active.id));
    setActiveTask(t ?? null);
  }

  function onDragEnd(ev: DragEndEvent) {
    setActiveTask(null);
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

  function deleteTaskWithError(task: Task) {
    deleteTask.mutate(task.id, {
      onError: (err) => {
        setError((err as Error).message);
        setTimeout(() => setError(null), 5000);
      },
    });
  }

  function startBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      event.pointerType !== "mouse" ||
      isScrollbarPointer(event) ||
      !canStartBoardPan(event.target)
    ) {
      return;
    }
    boardPan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = boardPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startX);
    event.preventDefault();
  }

  function stopBoardPan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = boardPan.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    boardPan.current = null;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && (
        <div className="border-b border-[var(--tl-rust)]/35 bg-[var(--tl-rust-soft)] px-6 py-2 text-sm text-[var(--tl-rust)]">
          {error}
        </div>
      )}
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div
          data-testid="kanban-scroll-region"
          className="flex-1 cursor-grab overflow-x-auto overflow-y-hidden active:cursor-grabbing"
          onPointerDown={startBoardPan}
          onPointerMove={moveBoardPan}
          onPointerUp={stopBoardPan}
          onPointerCancel={stopBoardPan}
          onPointerLeave={stopBoardPan}
        >
          <div className="flex h-full w-fit min-w-full gap-3 p-4">
            {STATES.map((s) => (
              <Column
                key={s}
                state={s}
                count={grouped[s].length}
                sortMode={columnSortModes[s]}
                isSortMenuOpen={openSortMenu === s}
                onToggleSortMenu={() => setOpenSortMenu((current) => (current === s ? null : s))}
                onSortModeChange={(mode) => updateColumnSortMode(s, mode)}
              >
                {grouped[s].map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    isBlocked={isBlocked(t)}
                    onClick={() => setEditing(t)}
                    onContextMenu={(event) => {
                      setTaskMenu({ task: t, x: event.clientX, y: event.clientY });
                    }}
                  />
                ))}
              </Column>
            ))}
          </div>
        </div>
        {/* Render the dragged card in a portal-positioned overlay so it
            isn't clipped by the column / scroller overflow boxes. */}
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              isBlocked={isBlocked(activeTask)}
              onClick={() => {}}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      {editing && (
        <TaskEditor
          project={project}
          task={editing}
          allTasks={tasks}
          onClose={() => setEditing(null)}
        />
      )}
      {copyDraft && (
        <TaskEditor
          project={project}
          task={copyDraft}
          allTasks={tasks}
          mode="create"
          onClose={() => setCopyDraft(null)}
        />
      )}
      {taskMenu && (
        <TaskContextMenu
          task={taskMenu.task}
          position={{ x: taskMenu.x, y: taskMenu.y }}
          onClose={() => setTaskMenu(null)}
          onDelete={deleteTaskWithError}
          onCopy={(task) => setCopyDraft(createTaskCopyDraft(task))}
        />
      )}
    </div>
  );
}

function Column({
  state,
  count,
  sortMode,
  isSortMenuOpen,
  onToggleSortMenu,
  onSortModeChange,
  children,
}: {
  state: TaskState;
  count: number;
  sortMode: ColumnSortMode;
  isSortMenuOpen: boolean;
  onToggleSortMenu: () => void;
  onSortModeChange: (mode: ColumnSortMode) => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  const stateLabel = STATE_LABELS[state];

  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${state}`}
      className={
        "flex-1 min-w-48 max-w-72 rounded-lg border border-[var(--tl-outline)] bg-[var(--tl-surface-muted)] p-3 flex flex-col gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition " +
        (isOver ? "ring-2 ring-[var(--tl-moss)]" : "")
      }
    >
      <div className="relative mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-[var(--tl-ink-muted)]">
          {stateLabel} ({count})
        </h3>
        <button
          type="button"
          aria-label={`Sort ${stateLabel} tasks`}
          aria-expanded={isSortMenuOpen}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] text-[var(--tl-ink-muted)] shadow-[var(--tl-shadow-paper)] hover:border-[var(--tl-outline-strong)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          onClick={onToggleSortMenu}
        >
          <ArrowUpDown size={14} aria-hidden="true" />
        </button>
        {isSortMenuOpen && (
          <div
            role="menu"
            aria-label={`Sort ${stateLabel} tasks`}
            className="absolute right-0 top-8 z-30 w-44 rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] p-1 text-xs shadow-[var(--tl-shadow-lift)]"
          >
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={sortMode === option.id}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
                onClick={() => onSortModeChange(option.id)}
              >
                <span>{option.label}</span>
                {sortMode === option.id && <Check size={13} aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-visible">
        <div
          data-testid={`column-scroll-${state}`}
          className="-mr-2 h-full overflow-y-auto pr-2"
        >
          <div data-testid={`column-card-stack-${state}`} className="space-y-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function createDefaultColumnSortModes(): Record<TaskState, ColumnSortMode> {
  return Object.fromEntries(STATES.map((state) => [state, "execution"])) as Record<
    TaskState,
    ColumnSortMode
  >;
}

function compareTasksForColumn(
  a: Task,
  b: Task,
  mode: ColumnSortMode,
  doneIds: Set<string>
): number {
  if (mode === "created") return compareCreatedOldestFirst(a, b);
  if (mode === "updated") return compareUpdatedNewestFirst(a, b);
  if (mode === "priority") return comparePriorityHighToLow(a, b);

  const blockedDelta = Number(isTaskBlocked(a, doneIds)) - Number(isTaskBlocked(b, doneIds));
  return blockedDelta || comparePriorityHighToLow(a, b);
}

function comparePriorityHighToLow(a: Task, b: Task): number {
  return b.priority - a.priority || a.created_at - b.created_at || a.title.localeCompare(b.title);
}

function compareCreatedOldestFirst(a: Task, b: Task): number {
  return a.created_at - b.created_at || b.priority - a.priority || a.title.localeCompare(b.title);
}

function compareUpdatedNewestFirst(a: Task, b: Task): number {
  return b.updated_at - a.updated_at || comparePriorityHighToLow(a, b);
}

function isTaskBlocked(task: Task, doneIds: Set<string>) {
  return !!task.depends_on?.length && task.depends_on.some((dep) => !doneIds.has(dep));
}
