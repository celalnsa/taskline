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
  const projects = useProjects();
  const project: Project | null =
    projects.data?.find(
      (p) => p.name === projectKey || p.id === projectKey
    ) ?? null;

  // Prefer the human-readable name in the URL; the resolver above also
  // accepts an id, so older saved links keep working.
  const selectProject = (p: Project) => {
    void setProjectKey(p.name);
  };

  return (
    <div className="h-screen w-screen flex">
      {(sidebarOpen || !project) && (
        <Sidebar selectedId={project?.id ?? null} onSelect={selectProject} />
      )}
      <main className="flex-1 flex flex-col overflow-hidden">
        {project ? (
          <ProjectWorkspace
            key={project.id}
            project={project}
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
  sidebarOpen,
  onToggleSidebar,
}: {
  project: Project;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const [view, setView] = useState<View>("kanban");
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
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            onClick={onToggleSidebar}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <SidebarIcon size={16} aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight text-slate-900">
              {project.name}
            </h2>
            {project.description && (
              <p className="mt-0.5 truncate text-xs text-slate-500">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label="Search tasks"
            title="Search tasks"
            onClick={() => setSearchOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <Search size={16} aria-hidden="true" />
          </button>
          <ViewToggle view={view} onChange={setView} />
          <CreateTaskButton project={project} allTasks={tasks} />
        </div>
      </header>
      <section className="relative flex-1 overflow-hidden bg-slate-50">
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

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string }[] = [
    { id: "kanban", label: "Kanban" },
    { id: "graph", label: "Graph" },
  ];
  return (
    <div
      aria-label="Board view"
      className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={
            "px-3 py-1.5 " +
            (view === o.id
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-600 hover:bg-slate-100")
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
    <div className="flex-1 flex items-center justify-center text-slate-500">
      <div className="text-center max-w-md space-y-3">
        <h2 className="text-2xl font-bold text-slate-700">taskline</h2>
        {unresolved && keyValue && (
          <p className="text-sm text-amber-700">
            No project matches <code className="font-mono">{keyValue}</code>{" "}
            in the URL. Pick another from the sidebar.
          </p>
        )}
        <p className="text-sm">
          Pick a project from the sidebar, or create one with <kbd>+ New</kbd>.
        </p>
        <p className="text-xs text-slate-400">
          The kanban view auto-refreshes every 10 seconds — changes you
          make from the CLI in another terminal will appear here.
        </p>
      </div>
    </div>
  );
}
