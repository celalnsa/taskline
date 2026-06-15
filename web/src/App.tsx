import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useQueryState } from "nuqs";
import { Sidebar } from "./components/Sidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { GraphView } from "./components/GraphView";
import { CreateTaskButton } from "./components/CreateTaskButton";
import { TaskEditor } from "./components/TaskEditor";
import { TaskSearchDialog } from "./components/TaskSearchDialog";
import { useProjects, useTasks } from "./hooks/queries";
import type { Project, Task } from "./lib/api";

type View = "kanban" | "graph";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // ?project=<name|id> survives page reload and back/forward; nuqs
  // keeps the URL and state in lockstep without a router dep.
  // history: "replace" so picking a project doesn't pollute the back
  // stack — users browser-back to leave the app, not to step through
  // every sidebar selection. nuqs defaults to "push".
  const [projectKey, setProjectKey] = useQueryState("project", {
    history: "replace",
  });
  const [viewKey, setViewKey] = useQueryState("view", {
    history: "replace",
  });
  const compactShell = useMediaQuery("(max-width: 639px)");
  const view = parseViewKey(viewKey);
  const projects = useProjects();
  const project: Project | null =
    projects.data?.find(
      (p) => p.name === projectKey || p.id === projectKey
    ) ?? null;
  const projectId = project?.id ?? null;
  const hasProject = projectId !== null;

  // Prefer the human-readable name in the URL; the resolver above also
  // accepts an id, so older saved links keep working.
  const selectProject = (p: Project) => {
    void setProjectKey(p.name);
    if (compactShell) setSidebarOpen(false);
  };
  const selectView = (next: View) => {
    void setViewKey(next === "kanban" ? null : next);
  };

  useEffect(() => {
    if (!hasProject) {
      setSidebarOpen(true);
      return;
    }
    setSidebarOpen(!compactShell);
  }, [compactShell, hasProject, projectId]);

  const sidebar = (
    <Sidebar
      selectedId={project?.id ?? null}
      onSelect={selectProject}
      className={
        compactShell && hasProject
          ? "h-full w-72 max-w-[82vw] p-4 shadow-[var(--tl-shadow-lift)]"
          : undefined
      }
    />
  );
  const showSidebar = sidebarOpen || !hasProject;

  return (
    <div className="taskline-theme h-screen w-screen flex bg-[var(--tl-bg)] text-[var(--tl-ink)]">
      {showSidebar &&
        (compactShell && hasProject ? (
          <div className="fixed inset-0 z-50 flex sm:hidden">
            <button
              type="button"
              aria-label="Close sidebar"
              className="absolute inset-0 bg-[rgba(37,34,29,0.34)]"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="relative z-10 h-full">{sidebar}</div>
          </div>
        ) : (
          sidebar
        ))}
      <main
        data-visual-style="wabi-sabi"
        className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[var(--tl-bg)]"
      >
        {project ? (
          <ProjectWorkspace
            key={project.id}
            project={project}
            view={view}
            onViewChange={selectView}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
          />
        ) : (
          <Welcome
            unresolved={!!projectKey && projects.isSuccess && !project}
            keyValue={projectKey}
          />
        )}
      </main>
    </div>
  );
}

function ProjectWorkspace({
  project,
  view,
  onViewChange,
  sidebarOpen,
  onToggleSidebar,
}: {
  project: Project;
  view: View;
  onViewChange: (next: View) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const tasksQ = useTasks(project.id);
  const tasks = tasksQ.data ?? [];
  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const cmd = event.metaKey || event.ctrlKey;
      if (cmd && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--tl-outline)] bg-[var(--tl-surface)] px-6 py-3 shadow-[0_1px_0_rgba(255,255,255,0.55)] max-sm:px-3 max-sm:py-2 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 max-sm:basis-full">
          <button
            type="button"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            onClick={onToggleSidebar}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] text-[var(--tl-ink-muted)] shadow-[var(--tl-shadow-paper)] transition hover:border-[var(--tl-outline-strong)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          >
            <SidebarIcon size={16} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight text-[var(--tl-ink)]">
              {project.name}
            </h2>
            {project.description && (
              <p className="mt-0.5 truncate text-xs text-[var(--tl-ink-muted)]">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            aria-label="Search tasks"
            title="Search tasks"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] text-[var(--tl-ink-muted)] shadow-[var(--tl-shadow-paper)] transition hover:border-[var(--tl-outline-strong)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tl-focus)]"
          >
            <Search size={16} aria-hidden="true" />
          </button>
          <ViewToggle view={view} onChange={onViewChange} />
          <CreateTaskButton project={project} allTasks={tasks} />
        </div>
      </header>
      <section className="relative flex-1 overflow-hidden bg-[var(--tl-bg)]">
        <div className="box-border h-full">
          {view === "kanban" ? (
            <KanbanBoard project={project} />
          ) : (
            <GraphView project={project} />
          )}
        </div>
      </section>
      {searchOpen && (
        <TaskSearchDialog
          project={project}
          onClose={() => setSearchOpen(false)}
          onSelect={(task) => {
            setSearchOpen(false);
            setEditingTask(task);
          }}
        />
      )}
      {editingTask && (
        <TaskEditor
          project={project}
          task={editingTask}
          allTasks={tasks}
          onClose={() => setEditingTask(null)}
        />
      )}
    </>
  );
}

function parseViewKey(value: string | null): View {
  return value === "graph" ? "graph" : "kanban";
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setMatches(false);
      return;
    }
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string }[] = [
    { id: "kanban", label: "Kanban" },
    { id: "graph", label: "Graph" },
  ];
  return (
    <div
      aria-label="Board view"
      className="inline-flex overflow-hidden rounded-md border border-[var(--tl-outline)] bg-[var(--tl-surface-raised)] text-xs shadow-[var(--tl-shadow-paper)]"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={
            "px-3 py-1.5 max-sm:px-2 " +
            (view === o.id
              ? "bg-[var(--tl-primary)] text-[var(--tl-surface)]"
              : "bg-[var(--tl-surface-raised)] text-[var(--tl-ink-muted)] hover:bg-[var(--tl-bg-quiet)] hover:text-[var(--tl-ink)]")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Welcome({
  unresolved,
  keyValue,
}: {
  unresolved: boolean;
  keyValue: string | null;
}) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--tl-bg)] text-[var(--tl-ink-muted)]">
      <div className="text-center max-w-md space-y-3">
        <h2 className="text-2xl font-bold text-[var(--tl-ink)]">taskline</h2>
        {unresolved && keyValue && (
          <p className="text-sm text-[var(--tl-ochre)]">
            No project matches <code className="font-mono">{keyValue}</code>{" "}
            in the URL. Pick another from the sidebar.
          </p>
        )}
        <p className="text-sm">
          Pick a project from the sidebar, or create one with <kbd>+ New</kbd>.
        </p>
        <p className="text-xs text-[var(--tl-ink-faint)]">
          The kanban view auto-refreshes every 10 seconds — changes you
          make from the CLI in another terminal will appear here.
        </p>
      </div>
    </div>
  );
}
