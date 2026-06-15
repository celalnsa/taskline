import { useState } from "react";
import type { Project } from "../lib/api";
import { useCreateProject, useProjects } from "../hooks/queries";

interface Props {
  selectedId: string | null;
  onSelect: (project: Project) => void;
  className?: string;
}

export function Sidebar({ selectedId, onSelect, className }: Props) {
  const projects = useProjects();
  const createProject = useCreateProject();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <aside
      aria-label="Projects"
      className={
        "shrink-0 border-r border-[var(--tl-outline)] bg-[var(--tl-surface)] flex flex-col gap-3 " +
        (className ?? "w-64 p-4")
      }
    >
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight text-[var(--tl-ink)]">taskline</h1>
        <button
          className="text-xs px-2 py-1 rounded-md bg-[var(--tl-primary)] text-[var(--tl-surface)] shadow-[var(--tl-shadow-paper)] hover:bg-[var(--tl-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? "Cancel" : "+ New"}
        </button>
      </div>
      {creating && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const created = await createProject.mutateAsync({ name, description });
            setName("");
            setDescription("");
            setCreating(false);
            onSelect(created);
          }}
          className="space-y-2 border-b border-[var(--tl-outline)] pb-3"
        >
          <input
            className="w-full text-sm border border-[var(--tl-outline)] rounded-md px-2 py-1"
            placeholder="project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="w-full text-sm border border-[var(--tl-outline)] rounded-md px-2 py-1"
            placeholder="description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            type="submit"
            disabled={createProject.isPending}
            className="w-full text-sm bg-[var(--tl-moss)] text-[var(--tl-surface)] rounded-md py-1 hover:bg-[color-mix(in_srgb,var(--tl-moss)_82%,black)] disabled:opacity-50"
          >
            {createProject.isPending ? "Creating…" : "Create"}
          </button>
          {createProject.error && (
            <p className="text-xs text-[var(--tl-rust)]">{(createProject.error as Error).message}</p>
          )}
        </form>
      )}
      <nav className="flex-1 overflow-auto">
        {projects.isLoading && <p className="text-sm text-[var(--tl-ink-muted)]">Loading…</p>}
        {projects.error && (
          <p className="text-sm text-[var(--tl-rust)]">
            Failed to load projects: {(projects.error as Error).message}
          </p>
        )}
        {projects.data?.length === 0 && (
          <p className="text-xs text-[var(--tl-ink-muted)]">No projects yet.</p>
        )}
        <ul className="space-y-1">
          {projects.data?.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p)}
                  className={
                    "w-full text-left text-sm px-2 py-1.5 rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)] " +
                    (active
                      ? "bg-[var(--tl-primary)] text-[var(--tl-surface)] shadow-[var(--tl-shadow-paper)]"
                      : "text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)]")
                  }
                >
                  {p.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
