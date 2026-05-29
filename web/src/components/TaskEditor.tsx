import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { FileCode2, ImagePlus, Trash2, X } from "lucide-react";
import {
  STATES,
  STATE_LABELS,
  taskImageURL,
  type Project,
  type Task,
  type TaskImage,
  type TaskLink,
  type TaskState,
  type TaskType,
} from "../lib/api";
import {
  useAddDependency,
  useAddLink,
  useCreateTask,
  useDeleteDependency,
  useDeleteImage,
  useDeleteLink,
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
  allTasks: Task[];
  onClose: () => void;
  task?: Task;
  mode?: "create" | "edit";
}

function createEmptyTask(projectId: string): Task {
  return {
    id: "",
    project_id: projectId,
    title: "",
    description: "",
    type: "feature",
    state: "start",
    priority: 0,
    created_at: 0,
    updated_at: 0,
    depends_on: [],
    links: [],
    images: [],
  };
}

export function TaskEditor({
  project,
  task,
  allTasks,
  onClose,
  mode = task ? "edit" : "create",
}: Props) {
  const isCreate = mode === "create";
  const currentTask = task ?? createEmptyTask(project.id);
  const [title, setTitle] = useState(currentTask.title);
  const [description, setDescription] = useState(currentTask.description);
  const [type, setType] = useState<TaskType>(currentTask.type);
  const [state, setState] = useState<TaskState>(currentTask.state);
  const [priority, setPriority] = useState(currentTask.priority);
  const [error, setError] = useState<string | null>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const markdownButtonRef = useRef<HTMLButtonElement>(null);

  const create = useCreateTask(project.id);
  const update = useUpdateTask(project.id);
  const isSaving = create.isPending || update.isPending;
  const createdTaskRef = useRef<Task | null>(null);

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

  const save = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isSaving) {
      if (!trimmedTitle) setError("Title is required.");
      return;
    }
    try {
      if (isCreate) {
        let activeTask = createdTaskRef.current;
        if (!activeTask) {
          activeTask = await create.mutateAsync({
            title: trimmedTitle,
            description,
            type,
            priority,
            auto_start: state !== "pending",
          });
          createdTaskRef.current = activeTask;
        }
        if (activeTask.state !== state) {
          await update.mutateAsync({ id: activeTask.id, patch: { state } });
        }
      } else {
        await update.mutateAsync({
          id: currentTask.id,
          patch: { title: trimmedTitle, description, type, state, priority },
        });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

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
            <h3 className="font-bold text-base">
              {isCreate ? `New task in ${project.name}` : "Edit task"}
            </h3>
            {!isCreate && (
              <code className="text-[10px] text-slate-400">
                {currentTask.id.slice(0, 8)}
              </code>
            )}
          </div>
          <input
            aria-label="Title"
            className="w-full text-sm border rounded px-2 py-1.5 font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={isCreate}
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
                aria-label="Type"
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
                aria-label="State"
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
                aria-label="Priority"
                type="number"
                className="w-full border rounded px-2 py-1 tabular-nums"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              />
            </label>
          </div>

          <ImageSection project={project} task={currentTask} disabled={isCreate} />

          <LinkSection project={project} task={currentTask} disabled={isCreate} />

          <DependsSection
            project={project}
            task={currentTask}
            allTasks={allTasks}
            disabled={isCreate}
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end pt-3 border-t">
            <div className="flex gap-2">
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded border"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={isSaving}
                onClick={save}
              >
                {isSaving
                  ? isCreate
                    ? "Creating…"
                    : "Saving…"
                  : isCreate
                    ? "Create"
                    : "Save"}
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

function ImageSection({
  project,
  task,
  disabled = false,
}: {
  project: Project;
  task: Task;
  disabled?: boolean;
}) {
  const [images, setImages] = useState<TaskImage[]>(task.images ?? []);
  const [previewImage, setPreviewImage] = useState<TaskImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadImage(project.id);
  const del = useDeleteImage(project.id);

  useEffect(() => {
    setImages(task.images ?? []);
  }, [task.id, task.images]);

  useEffect(() => {
    if (!previewImage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPreviewImage(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewImage]);

  const appendImage = useCallback((image: TaskImage) => {
    setImages((current) =>
      current.some((item) => item.id === image.id) ? current : [...current, image]
    );
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      if (upload.isPending || disabled) return;
      const image = await upload.mutateAsync({ taskId: task.id, file });
      appendImage(image);
      setError(null);
    },
    [appendImage, disabled, task.id, upload]
  );

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file || upload.isPending || disabled) return;
    if (!file.type.startsWith("image/")) {
      setError("Selected file is not an image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    try {
      await uploadFile(file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const uploadPastedImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        await uploadFile(file);
      }
    },
    [uploadFile]
  );

  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void uploadPastedImages(files).catch((err) => setError((err as Error).message));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled, uploadPastedImages]);

  const removeImage = async (image: TaskImage) => {
    try {
      await del.mutateAsync(image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
      if (previewImage?.id === image.id) setPreviewImage(null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">Images</p>
        <label
          className={
            "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 " +
            (upload.isPending || disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer")
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
            disabled={upload.isPending || disabled}
            onChange={onFileChange}
          />
        </label>
      </div>
      {images.length > 0 ? (
        <ul className="space-y-1">
          {images.map((image) => (
            <li
              key={image.id}
              className="text-xs flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1 group"
            >
              <button
                type="button"
                aria-label={`View image ${image.filename}`}
                className="flex flex-1 min-w-0 items-center gap-2 text-left"
                onClick={() => setPreviewImage(image)}
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
              </button>
              <button
                type="button"
                aria-label={`Delete image ${image.filename}`}
                className="h-5 w-5 shrink-0 rounded text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-600 flex items-center justify-center disabled:opacity-50"
                disabled={del.isPending}
                onClick={() => void removeImage(image)}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No images attached.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          className="fixed inset-0 z-50 bg-black/60 p-5 flex items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewImage(null);
          }}
        >
          <div className="max-w-[min(960px,92vw)] max-h-[90vh] rounded bg-white shadow-xl flex flex-col overflow-hidden">
            <div className="h-10 px-3 border-b flex items-center gap-3">
              <p className="text-sm font-medium text-slate-700 truncate flex-1 min-w-0">
                {previewImage.filename}
              </p>
              <button
                type="button"
                aria-label="Close image preview"
                className="h-7 w-7 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center"
                onClick={() => setPreviewImage(null)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="bg-slate-950 p-2 flex items-center justify-center">
              <img
                alt={previewImage.filename}
                src={taskImageURL(previewImage.id)}
                className="max-w-[88vw] max-h-[78vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter((file) =>
    file.type.startsWith("image/")
  );
  if (files.length > 0) return files;

  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
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

function LinkSection({
  project,
  task,
  disabled = false,
}: {
  project: Project;
  task: Task;
  disabled?: boolean;
}) {
  const [links, setLinks] = useState<TaskLink[]>(task.links ?? []);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddLink(project.id);
  const del = useDeleteLink(project.id);

  useEffect(() => {
    setLinks(task.links ?? []);
  }, [task.id, task.links]);

  const submit = async () => {
    if (!url.trim() || add.isPending || disabled) return;
    try {
      const link = await add.mutateAsync({ taskId: task.id, url: url.trim(), label: label.trim() });
      setLinks((current) =>
        current.some((item) => item.id === link.id) ? current : [...current, link]
      );
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
            <li key={l.id} className="text-xs flex items-center gap-2 group">
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 hover:underline truncate flex-1 min-w-0"
                title={l.url}
              >
                {l.label || l.url}
              </a>
              <button
                type="button"
                aria-label={`Remove link ${l.label || l.url}`}
                className="h-5 w-5 shrink-0 rounded text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                onClick={async () => {
                  try {
                    await del.mutateAsync(l.id);
                    setLinks((current) => current.filter((item) => item.id !== l.id));
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <X size={12} aria-hidden="true" />
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
          disabled={disabled}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="w-32 text-xs border rounded px-2 py-1"
          placeholder="label (optional)"
          value={label}
          disabled={disabled}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="text-xs px-3 py-1 rounded bg-slate-700 text-white disabled:opacity-50"
          disabled={!url.trim() || add.isPending || disabled}
          onClick={submit}
        >
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function DependsSection({
  project,
  task,
  allTasks,
  disabled = false,
}: {
  project: Project;
  task: Task;
  allTasks: Task[];
  disabled?: boolean;
}) {
  const [dependencyIds, setDependencyIds] = useState<string[]>(task.depends_on ?? []);
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddDependency(project.id);
  const del = useDeleteDependency(project.id);

  useEffect(() => {
    setDependencyIds(task.depends_on ?? []);
  }, [task.id, task.depends_on]);

  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const candidates = disabled ? [] : allTasks.filter(
    (t) => t.id !== task.id && t.state !== "done" && !dependencyIds.includes(t.id)
  );

  const addDependency = async (dependsOn: string) => {
    if (!dependsOn || add.isPending || disabled) return;
    setCandidate(dependsOn);
    try {
      await add.mutateAsync({ taskId: task.id, dependsOn });
      setDependencyIds((current) =>
        current.includes(dependsOn) ? current : [...current, dependsOn]
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCandidate("");
    }
  };

  const removeDependency = async (dependsOn: string) => {
    try {
      await del.mutateAsync({ taskId: task.id, dependsOn });
      setDependencyIds((current) => current.filter((id) => id !== dependsOn));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <p className="text-xs font-medium text-slate-500">Depends</p>
      {dependencyIds.length > 0 ? (
        <ul className="space-y-1">
          {dependencyIds.map((id) => {
            const dep = byId.get(id);
            const label = dep?.title ?? id.slice(0, 8);
            return (
              <li key={id} className="text-xs flex items-center gap-2 group">
                <code className="text-slate-400">{id.slice(0, 8)}</code>
                {dep ? (
                  <>
                    <span className="font-medium min-w-0 truncate flex-1">{dep.title}</span>
                    <span
                      className={
                        "px-1 rounded text-[10px] shrink-0 " +
                        (dep.state === "done"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-800")
                      }
                    >
                      {dep.state}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400 italic flex-1">(deleted)</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove dependency ${label}`}
                  className="h-5 w-5 shrink-0 rounded text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-600 flex items-center justify-center"
                  onClick={() => removeDependency(id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No dependencies.</p>
      )}
      <select
        aria-label="Add dependency"
        className="w-full text-xs border rounded px-2 py-1"
        value={candidate}
        disabled={add.isPending || disabled}
        onChange={(e) => addDependency(e.target.value)}
      >
        <option value="">add dependency...</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title} ({t.state})
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
