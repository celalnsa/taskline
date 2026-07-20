import { useEffect } from "react";
import { History, X } from "lucide-react";
import type { Task, TaskEvent } from "../lib/api";

interface Props {
  task: Task;
  events: TaskEvent[];
  isLoading: boolean;
  error: Error | null;
  onClose: () => void;
}

type EventChange = {
  before?: unknown;
  after?: unknown;
  changed?: boolean;
};

export function TaskHistoryDialog({ task, events, isLoading, error, onClose }: Props) {
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(37,34,29,0.44)] p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`History for ${task.title}`}
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] shadow-[var(--tl-shadow-lift)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--tl-outline)] px-4 py-3">
          <History size={18} aria-hidden="true" className="shrink-0 text-[var(--tl-water)]" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--tl-ink)]">Task history</h3>
            <p className="truncate text-xs text-[var(--tl-ink-muted)]">{task.title}</p>
          </div>
          <button
            type="button"
            aria-label="Close task history"
            title="Close"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--tl-ink-muted)] transition hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-[var(--tl-ink-muted)]">Loading history...</p>
          ) : error ? (
            <div role="alert" className="rounded-md border border-[var(--tl-rust)]/35 bg-[var(--tl-rust-soft)] px-3 py-2 text-sm text-[var(--tl-rust)]">
              {error.message}
            </div>
          ) : events.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--tl-ink-muted)]">No operations recorded.</p>
          ) : (
            <ol className="space-y-3">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface)] px-3 py-3"
                >
                  <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                    <span className="rounded border border-[var(--tl-water)]/30 bg-[var(--tl-water-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--tl-water)]">
                      {event.actor}
                    </span>
                    <p className="min-w-0 flex-1 text-sm font-medium text-[var(--tl-ink)]">
                      {event.summary}
                    </p>
                    <time
                      dateTime={new Date(event.created_at).toISOString()}
                      className="shrink-0 text-[10px] tabular-nums text-[var(--tl-ink-faint)] max-sm:w-full"
                      title={new Date(event.created_at).toLocaleString()}
                    >
                      {new Date(event.created_at).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-[10px] uppercase text-[var(--tl-ink-faint)]">
                    {event.action.replaceAll("_", " ")}
                  </p>
                  <EventChanges event={event} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function EventChanges({ event }: { event: TaskEvent }) {
  const changes = readChanges(event.details);
  if (Object.keys(changes).length === 0) return null;
  return (
    <dl className="mt-3 space-y-2 border-t border-[var(--tl-outline)] pt-2">
      {Object.entries(changes).map(([field, change]) => (
        <div key={field} className="min-w-0">
          <dt className="text-[10px] font-medium uppercase text-[var(--tl-ink-muted)]">{field}</dt>
          {change.changed && change.before === undefined && change.after === undefined ? (
            <dd className="mt-0.5 text-xs text-[var(--tl-ink)]">Content changed</dd>
          ) : (
            <dd className="mt-1 grid min-w-0 grid-cols-2 gap-2 max-sm:grid-cols-1">
              <ChangeValue label="Before" value={change.before} />
              <ChangeValue label="After" value={change.after} />
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function ChangeValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded border border-[var(--tl-outline)] bg-[var(--tl-bg-quiet)] px-2 py-1.5">
      <p className="text-[9px] uppercase text-[var(--tl-ink-faint)]">{label}</p>
      <p className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-xs text-[var(--tl-ink)]">
        {formatChangeValue(value)}
      </p>
    </div>
  );
}

function readChanges(details: Record<string, unknown>): Record<string, EventChange> {
  const raw = details.changes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const changes: Record<string, EventChange> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      changes[field] = value as EventChange;
    }
  }
  return changes;
}

function formatChangeValue(value: unknown): string {
  if (value === undefined) return "(not set)";
  if (value === null) return "null";
  if (typeof value === "string") return value || "(empty)";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
