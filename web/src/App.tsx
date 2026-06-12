import { useState } from "react";
import { useQueryState } from "nuqs";
import { Sidebar } from "./components/Sidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { GraphView } from "./components/GraphView";
import { CreateTaskButton } from "./components/CreateTaskButton";
import { useProjects, useTasks } from "./hooks/queries";
import type { Project } from "./lib/api";

type View = "kanban" | "graph";

export default function App() {
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
      <Sidebar selectedId={project?.id ?? null} onSelect={selectProject} />
      <main className="flex-1 flex flex-col overflow-hidden">
        {project ? (
          <ProjectWorkspace key={project.id} project={project} />
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

function ProjectWorkspace({ project }: { project: Project }) {
  const [view, setView] = useState<View>("kanban");
  const tasksQ = useTasks(project.id);
  const tasks = tasksQ.data ?? [];

  return (
    <>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight text-slate-900">
            {project.name}
          </h2>
          {project.description && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{project.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
