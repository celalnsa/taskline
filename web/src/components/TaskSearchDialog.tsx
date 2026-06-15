import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { STATE_LABELS, type Project, type Task } from "../lib/api";
import { useTaskSearch } from "../hooks/queries";

interface Props {
  project: Project;
  onClose: () => void;
  onSelect: (task: Task) => void;
}

function shortID(id: string): string {
  return id.slice(0, 8);
}

export function TaskSearchDialog({ project, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useTaskSearch(project.id, debouncedQuery);
  const tasks = results.data ?? [];
  const queryReady = debouncedQuery.trim() === query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(37,34,29,0.38)] px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tasks"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] shadow-[var(--tl-shadow-lift)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--tl-outline)] px-4 py-3">
          <Search size={18} aria-hidden="true" className="shrink-0 text-[var(--tl-ink-faint)]" />
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--tl-ink)] outline-none placeholder:text-[var(--tl-ink-faint)]"
          />
          <button
            type="button"
            aria-label="Close search"
            title="Close search"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--tl-ink-faint)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.trim() === "" ? null : results.isError ? (
            <div className="px-3 py-4 text-sm text-[var(--tl-rust)]">
              {(results.error as Error).message}
            </div>
          ) : (!queryReady || results.isFetching) && tasks.length === 0 ? (
            <div className="px-3 py-4 text-sm text-[var(--tl-ink-muted)]">Searching...</div>
          ) : tasks.length === 0 ? (
            <div className="px-3 py-4 text-sm text-[var(--tl-ink-muted)]">No matches</div>
          ) : (
            <div className="space-y-1">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelect(task)}
                  className="block w-full rounded-md px-3 py-2 text-left hover:bg-[var(--tl-bg-quiet)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-[var(--tl-ink-faint)]">{shortID(task.id)}</span>
                    <span className="rounded border border-[var(--tl-outline)] bg-[var(--tl-surface)] px-1.5 py-0.5 text-[11px] font-medium uppercase text-[var(--tl-ink-muted)]">
                      {STATE_LABELS[task.state]}
                    </span>
                    <span className="truncate text-sm font-medium text-[var(--tl-ink)]">
                      {task.title}
                    </span>
                  </div>
                  {(task.description || task.labels.length > 0) && (
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[var(--tl-ink-muted)]">
                      {task.labels.length > 0 && (
                        <span className="shrink-0">{task.labels.slice(0, 3).join(", ")}</span>
                      )}
                      {task.description && (
                        <span className="truncate">{task.description}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
