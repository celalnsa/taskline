import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileCode2, ImagePlus } from "lucide-react";
import {
  STATES,
  STATE_LABELS,
  type Project,
  type Task,
  type TaskImage,
  type TaskState,
  type TaskType,
} from "../lib/api";
import {
  useAddDependency,
  useAddLink,
  useDeleteLink,
  useDeleteTask,
  useUpdateTask,
  useUploadImage,
} from "../hooks/queries";

const MarkdownDescriptionDialog = lazy(() =>
  import("./MarkdownDescriptionDialog").then((module) => ({
    default: module.MarkdownDescriptionDialog,
  }))
);

interface Props {
  project: Project;
  task: Task;
  allTasks: Task[];
  onClose: () => void;
}

export function TaskEditor({ project, task, allTasks, onClose }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [type, setType] = useState<TaskType>(task.type);
  const [state, setState] = useState<TaskState>(task.state);
  const [priority, setPriority] = useState(task.priority);
  const [depTarget, setDepTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const markdownButtonRef = useRef<HTMLButtonElement>(null);

  const update = useUpdateTask(project.id);
  const del = useDeleteTask(project.id);
  const addDep = useAddDependency(project.id);

  const closeMarkdownEditor = () => {
    setMarkdownOpen(false);
    window.setTimeout(() => markdownButtonRef.current?.focus(), 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (markdownOpen) {
        closeMarkdownEditor();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markdownOpen, onClose]);

  // Filter dep candidates: any other task in the same project that this
  // task isn't already blocked on.
  const depCandidates = allTasks.filter(
    (t) => t.id !== task.id && !task.depends_on?.includes(t.id)
  );

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
      <div className="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[90vh] flex flex-col">
        <button
          type="button"
          aria-label="Close"
          className="absolute top-2 right-2 z-10 text-slate-400 hover:text-slate-700 text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100"
          onClick={onClose}
        >
          ×
        </button>
        <div className="p-6 space-y-3 overflow-y-auto">
        <div className="flex items-start justify-between pr-8">
          <h3 className="font-bold text-base">Edit task</h3>
          <code className="text-[10px] text-slate-400">{task.id.slice(0, 8)}</code>
        </div>
        <input
          className="w-full text-sm border rounded px-2 py-1.5 font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="task-description" className="text-xs text-slate-500">
              Description
            </label>
            <button
              ref={markdownButtonRef}
              type="button"
              aria-label="Open markdown editor"
              className="h-7 w-7 rounded border border-slate-200 bg-white/75 text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-900 flex items-center justify-center"
              onClick={() => setMarkdownOpen(true)}
            >
              <FileCode2 size={15} aria-hidden="true" />
            </button>
          </div>
          <textarea
            id="task-description"
            aria-label="Description"
            className="w-full text-sm border rounded px-2 py-1.5 resize-y min-h-[6rem]"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs space-y-1">
            <span className="text-slate-500">Type</span>
            <select
              className="w-full border rounded px-2 py-1"
              value={type}
              onChange={(e) => setType(e.target.value as TaskType)}
            >
              <option value="feature">feature</option>
              <option value="bug">bug</option>
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="text-slate-500">State</span>
            <select
              className="w-full border rounded px-2 py-1"
              value={state}
              onChange={(e) => {
                setState(e.target.value as TaskState);
                setError(null);
              }}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span className="text-slate-500">Priority</span>
            <input
              type="number"
              className="w-full border rounded px-2 py-1 tabular-nums"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            />
          </label>
        </div>

        <DepSection task={task} allTasks={allTasks} />

        <ImageSection project={project} task={task} />

        <LinkSection project={project} task={task} />

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-end gap-2">
            <select
              className="flex-1 text-xs border rounded px-2 py-1"
              value={depTarget}
              onChange={(e) => setDepTarget(e.target.value)}
            >
              <option value="">add dependency…</option>
              {depCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.state})
                </option>
              ))}
            </select>
            <button
              className="text-xs px-3 py-1 rounded bg-slate-700 text-white disabled:opacity-50"
              disabled={!depTarget || addDep.isPending}
              onClick={async () => {
                try {
                  await addDep.mutateAsync({ taskId: task.id, dependsOn: depTarget });
                  setDepTarget("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Block on
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-between pt-3 border-t">
          <button
            className="text-sm px-3 py-1.5 rounded text-red-600 hover:bg-red-50"
            onClick={async () => {
              if (!confirm(`Delete task "${task.title}"? This cascades to dependencies and images.`)) return;
              try {
                await del.mutateAsync(task.id);
                onClose();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded border"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              disabled={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({
                    id: task.id,
                    patch: { title, description, type, state, priority },
                  });
                  onClose();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        </div>
      </div>
      {markdownOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black/40 p-5 flex items-center justify-center text-sm text-white">
              Loading editor…
            </div>
          }
        >
          <MarkdownDescriptionDialog
            value={description}
            onChange={setDescription}
            onClose={closeMarkdownEditor}
          />
        </Suspense>
      )}
    </div>
  );
}

function ImageSection({ project, task }: { project: Project; task: Task }) {
  const [images, setImages] = useState<TaskImage[]>(task.images ?? []);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadImage(project.id);

  useEffect(() => {
    setImages(task.images ?? []);
  }, [task.id, task.images]);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file || upload.isPending) return;
    if (!file.type.startsWith("image/")) {
      setError("Selected file is not an image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    try {
      const image = await upload.mutateAsync({ taskId: task.id, file });
      setImages((current) =>
        current.some((item) => item.id === image.id) ? current : [...current, image]
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">Images</p>
        <label
          className={
            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 " +
            (upload.isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer")
          }
        >
          <ImagePlus size={14} aria-hidden="true" />
          <span>{upload.isPending ? "Uploading..." : "Upload image"}</span>
          <input
            ref={inputRef}
            aria-label="Image attachment"
            className="sr-only"
            type="file"
            accept="image/*"
            disabled={upload.isPending}
            onChange={onFileChange}
          />
        </label>
      </div>
      {images.length > 0 ? (
        <ul className="space-y-1">
          {images.map((image) => (
            <li
              key={image.id}
              className="text-xs flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1"
            >
              <span className="font-medium text-slate-700 truncate flex-1 min-w-0">
                {image.filename}
              </span>
              <span className="text-slate-400 shrink-0">
                {image.mime_type || "unknown"}
              </span>
              <span className="text-slate-500 tabular-nums shrink-0">
                {formatFileSize(image.size_bytes)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No images attached.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${formatNumber(kib)} KB`;
  return `${formatNumber(kib / 1024)} MB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function LinkSection({ project, task }: { project: Project; task: Task }) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddLink(project.id);
  const del = useDeleteLink(project.id);

  const links = task.links ?? [];

  const submit = async () => {
    if (!url.trim() || add.isPending) return;
    try {
      await add.mutateAsync({ taskId: task.id, url: url.trim(), label: label.trim() });
      setUrl("");
      setLabel("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium text-slate-500">Links</p>
      {links.length > 0 && (
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.id} className="text-xs flex items-center gap-2">
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 hover:underline truncate flex-1"
                title={l.url}
              >
                {l.label || l.url}
              </a>
              <button
                type="button"
                className="text-[10px] text-slate-400 hover:text-red-600"
                onClick={async () => {
                  try {
                    await del.mutateAsync(l.id);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-stretch gap-2">
        <input
          type="url"
          className="flex-1 min-w-0 text-xs border rounded px-2 py-1"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="w-32 text-xs border rounded px-2 py-1"
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="text-xs px-3 py-1 rounded bg-slate-700 text-white disabled:opacity-50"
          disabled={!url.trim() || add.isPending}
          onClick={submit}
        >
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function DepSection({ task, allTasks }: { task: Task; allTasks: Task[] }) {
  if (!task.depends_on?.length) return null;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  return (
    <div className="border-t pt-3 space-y-1">
      <p className="text-xs font-medium text-slate-500">Blocks until done:</p>
      <ul className="space-y-1">
        {task.depends_on.map((id) => {
          const dep = byId.get(id);
          return (
            <li key={id} className="text-xs flex items-center gap-2">
              <code className="text-slate-400">{id.slice(0, 8)}</code>
              {dep ? (
                <>
                  <span className="font-medium">{dep.title}</span>
                  <span
                    className={
                      "px-1 rounded text-[10px] " +
                      (dep.state === "done"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800")
                    }
                  >
                    {dep.state}
                  </span>
                </>
              ) : (
                <span className="text-slate-400 italic">(deleted)</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
