import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { FileCode2, FileText, ImagePlus, Plus, Tag, Trash2, X } from "lucide-react";
import {
  STATES,
  STATE_LABELS,
  taskImageURL,
  type Project,
  type Task,
  type TaskDoc,
  type TaskImage,
  type TaskLink,
  type TaskState,
  type TaskType,
} from "../lib/api";
import {
  useAddDependency,
  useAddLink,
  useCreateTask,
  useCreateDoc,
  useDeleteDependency,
  useDeleteDoc,
  useDeleteImage,
  useDeleteLink,
  useGetDoc,
  useUpdateDoc,
  useUpdateTask,
  useUploadImage,
} from "../hooks/queries";

const MarkdownDescriptionDialog = lazy(() =>
  import("./MarkdownDescriptionDialog").then((module) => ({
    default: module.MarkdownDescriptionDialog,
  }))
);

const MarkdownDocumentDialog = lazy(() =>
  import("./MarkdownDocumentDialog").then((module) => ({
    default: module.MarkdownDocumentDialog,
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
    labels: [],
    created_at: 0,
    updated_at: 0,
    depends_on: [],
    links: [],
    images: [],
    docs: [],
  };
}

type PendingImage = TaskImage & {
  file: File;
  pending: boolean;
  preview_url?: string;
};

type DisplayImage = TaskImage & {
  pending?: boolean;
  preview_url?: string;
};

type PendingLink = TaskLink & {
  pending: boolean;
};

type DisplayLink = TaskLink & {
  pending?: boolean;
};

let draftId = 0;

function nextDraftId(prefix: string): string {
  draftId += 1;
  return `${prefix}-${draftId}`;
}

function createFilePreviewURL(file: File): string | undefined {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  return URL.createObjectURL(file);
}

function revokeFilePreviewURL(url: string | undefined) {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(url);
}

export function TaskEditor({
  project,
  task,
  allTasks,
  onClose,
  mode = task ? "edit" : "create",
}: Props) {
  const isCreate = mode === "create";
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const currentTask = createdTask ?? task ?? createEmptyTask(project.id);
  const [title, setTitle] = useState(currentTask.title);
  const [description, setDescription] = useState(currentTask.description);
  const [type, setType] = useState<TaskType>(currentTask.type);
  const [state, setState] = useState<TaskState>(currentTask.state);
  const [priority, setPriority] = useState(currentTask.priority);
  const [labels, setLabels] = useState<string[]>(currentTask.labels ?? []);
  const [error, setError] = useState<string | null>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [pendingDependencyIds, setPendingDependencyIds] = useState<string[]>([]);
  const markdownButtonRef = useRef<HTMLButtonElement>(null);

  const create = useCreateTask(project.id);
  const update = useUpdateTask(project.id);
  const uploadImage = useUploadImage(project.id);
  const addLink = useAddLink(project.id);
  const addDependency = useAddDependency(project.id);
  const isSaving =
    create.isPending ||
    update.isPending ||
    uploadImage.isPending ||
    addLink.isPending ||
    addDependency.isPending;
  const createdPendingDependencyIdsRef = useRef<Set<string>>(new Set());

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
        let activeTask = createdTask;
        if (!activeTask) {
          activeTask = await create.mutateAsync({
            title: trimmedTitle,
            description,
            type,
            priority,
            labels,
            auto_start: state !== "pending",
          });
          setCreatedTask(activeTask);
        }
        if (activeTask.state !== state) {
          activeTask = await update.mutateAsync({ id: activeTask.id, patch: { state } });
          setCreatedTask(activeTask);
        }
        for (const image of pendingImages) {
          if (!image.pending) continue;
          const uploaded = await uploadImage.mutateAsync({
            taskId: activeTask.id,
            file: image.file,
          });
          setPendingImages((current) =>
            current.map((item) =>
              item.id === image.id
                ? {
                    ...uploaded,
                    file: item.file,
                    pending: false,
                    preview_url: item.preview_url,
                  }
                : item
            )
          );
        }
        for (const link of pendingLinks) {
          if (!link.pending) continue;
          const createdLink = await addLink.mutateAsync({
            taskId: activeTask.id,
            url: link.url,
            label: link.label,
          });
          setPendingLinks((current) =>
            current.map((item) =>
              item.id === link.id ? { ...createdLink, pending: false } : item
            )
          );
        }
        for (const dependsOn of pendingDependencyIds) {
          if (createdPendingDependencyIdsRef.current.has(dependsOn)) continue;
          await addDependency.mutateAsync({ taskId: activeTask.id, dependsOn });
          createdPendingDependencyIdsRef.current.add(dependsOn);
        }
      } else {
        await update.mutateAsync({
          id: currentTask.id,
          patch: { title: trimmedTitle, description, type, state, priority, labels },
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

          <LabelSection labels={labels} setLabels={setLabels} />

          <ImageSection
            project={project}
            task={currentTask}
            pendingImages={isCreate ? pendingImages : undefined}
            setPendingImages={isCreate ? setPendingImages : undefined}
          />

          <DocSection project={project} task={currentTask} disabled={isCreate || !currentTask.id} />

          <LinkSection
            project={project}
            task={currentTask}
            pendingLinks={isCreate ? pendingLinks : undefined}
            setPendingLinks={isCreate ? setPendingLinks : undefined}
          />

          <DependsSection
            project={project}
            task={currentTask}
            allTasks={allTasks}
            pendingDependencyIds={isCreate ? pendingDependencyIds : undefined}
            setPendingDependencyIds={isCreate ? setPendingDependencyIds : undefined}
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

type DocDialogState = {
  mode: "create" | "edit";
  id?: string;
  title: string;
  content: string;
};

const MAX_TASK_LABELS = 20;
const MAX_TASK_LABEL_LENGTH = 64;

function LabelSection({
  labels,
  setLabels,
}: {
  labels: string[];
  setLabels: Dispatch<SetStateAction<string[]>>;
}) {
  const [draft, setDraft] = useState("");

  const addLabel = useCallback(() => {
    const label = draft.trim();
    if (!label) return;
    setLabels((current) => {
      if (current.length >= MAX_TASK_LABELS) return current;
      const exists = current.some((item) => item.toLowerCase() === label.toLowerCase());
      return exists ? current : [...current, label];
    });
    setDraft("");
  }, [draft, setLabels]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addLabel();
  };

  const removeLabel = (label: string) => {
    setLabels((current) => current.filter((item) => item !== label));
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">Labels</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {labels.map((label) => (
          <span
            key={label}
            className="inline-flex max-w-full items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
          >
            <Tag size={11} aria-hidden="true" className="shrink-0 text-slate-400" />
            <span className="truncate">{label}</span>
            <button
              type="button"
              aria-label={`Remove label ${label}`}
              className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => removeLabel(label)}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="New label"
        className="w-full text-xs border rounded px-2 py-1"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_TASK_LABEL_LENGTH}
        disabled={labels.length >= MAX_TASK_LABELS}
        placeholder={
          labels.length >= MAX_TASK_LABELS
            ? "Maximum of 20 labels reached"
            : "Type a label and press Enter or comma"
        }
      />
    </div>
  );
}

function ImageSection({
  project,
  task,
  disabled = false,
  pendingImages,
  setPendingImages,
}: {
  project: Project;
  task: Task;
  disabled?: boolean;
  pendingImages?: PendingImage[];
  setPendingImages?: Dispatch<SetStateAction<PendingImage[]>>;
}) {
  const [images, setImages] = useState<TaskImage[]>(task.images ?? []);
  const displayedImages = pendingImages ?? images;
  const [previewImage, setPreviewImage] = useState<DisplayImage | null>(null);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewDragging, setPreviewDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftPreviewURLsRef = useRef<Set<string>>(new Set());
  const previewDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const upload = useUploadImage(project.id);
  const del = useDeleteImage(project.id);

  useEffect(() => {
    setImages(task.images ?? []);
  }, [task.id, task.images]);

  useEffect(() => {
    const draftPreviewURLs = draftPreviewURLsRef.current;
    return () => {
      for (const url of draftPreviewURLs) {
        revokeFilePreviewURL(url);
      }
      draftPreviewURLs.clear();
    };
  }, []);

  useEffect(() => {
    if (!previewImage) return;
    setPreviewOffset({ x: 0, y: 0 });
    setPreviewDragging(false);
    previewDragRef.current = null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPreviewImage(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewImage]);

  const startPreviewDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    event.preventDefault();
    event.stopPropagation();
    previewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: previewOffset.x,
      originY: previewOffset.y,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort in browser test environments.
    }
    setPreviewDragging(true);
  };

  const previewDragTransform = (x: number, y: number) =>
    `translate3d(${x}px, ${y}px, 0)`;

  const movePreviewDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const x = drag.originX + event.clientX - drag.startX;
    const y = drag.originY + event.clientY - drag.startY;
    event.currentTarget.style.transform = previewDragTransform(x, y);
  };

  const stopPreviewDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const x = drag.originX + event.clientX - drag.startX;
    const y = drag.originY + event.clientY - drag.startY;
    previewDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is best-effort in browser test environments.
    }
    event.currentTarget.style.transform = previewDragTransform(x, y);
    setPreviewOffset({ x, y });
    setPreviewDragging(false);
  };

  const appendImage = useCallback((image: TaskImage) => {
    setImages((current) =>
      current.some((item) => item.id === image.id) ? current : [...current, image]
    );
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      if (upload.isPending || disabled) return;
      if (setPendingImages) {
        const previewURL = createFilePreviewURL(file);
        if (previewURL) draftPreviewURLsRef.current.add(previewURL);
        const image: PendingImage = {
          id: nextDraftId("draft-image"),
          task_id: task.id,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_at: 0,
          preview_url: previewURL,
          file,
          pending: true,
        };
        setPendingImages((current) => [...current, image]);
        setError(null);
        return;
      }
      const image = await upload.mutateAsync({ taskId: task.id, file });
      appendImage(image);
      setError(null);
    },
    [appendImage, disabled, setPendingImages, task.id, upload]
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

  const removeImage = async (image: DisplayImage) => {
    try {
      if (image.pending && setPendingImages) {
        revokeFilePreviewURL(image.preview_url);
        if (image.preview_url) draftPreviewURLsRef.current.delete(image.preview_url);
        setPendingImages((current) => current.filter((item) => item.id !== image.id));
        if (previewImage?.id === image.id) setPreviewImage(null);
        setError(null);
        return;
      }
      await del.mutateAsync(image.id);
      revokeFilePreviewURL(image.preview_url);
      if (image.preview_url) draftPreviewURLsRef.current.delete(image.preview_url);
      if (setPendingImages) {
        setPendingImages((current) => current.filter((item) => item.id !== image.id));
      } else {
        setImages((current) => current.filter((item) => item.id !== image.id));
      }
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
      {displayedImages.length > 0 ? (
        <ul className="space-y-1">
          {displayedImages.map((image) => (
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
          className="fixed inset-0 z-50 bg-slate-950/90 text-white flex items-center justify-center overflow-hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreviewImage(null);
          }}
        >
          <div className="absolute top-3 left-3 right-3 z-10 h-10 rounded bg-black/40 px-3 shadow-lg backdrop-blur flex items-center gap-3">
            <p className="text-sm font-medium text-white truncate flex-1 min-w-0">
              {previewImage.filename}
            </p>
            <button
              type="button"
              aria-label="Close image preview"
              className="h-7 w-7 rounded text-white/70 hover:bg-white/10 hover:text-white flex items-center justify-center"
              onClick={() => setPreviewImage(null)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div
            className="h-full w-full p-4 pt-16 flex items-center justify-center"
            onClick={(event) => {
              if (event.target === event.currentTarget) setPreviewImage(null);
            }}
          >
            <img
              alt={previewImage.filename}
              src={
                previewImage.pending
                  ? previewImage.preview_url ?? ""
                  : taskImageURL(previewImage.id)
              }
              draggable={false}
              className={
                "max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] object-contain select-none will-change-transform " +
                (previewDragging ? "cursor-grabbing" : "cursor-grab")
              }
              style={{
                transform: previewDragTransform(previewOffset.x, previewOffset.y),
              }}
              onPointerDown={startPreviewDrag}
              onPointerMove={movePreviewDrag}
              onPointerUp={stopPreviewDrag}
              onPointerCancel={stopPreviewDrag}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function DocSection({
  project,
  task,
  disabled = false,
}: {
  project: Project;
  task: Task;
  disabled?: boolean;
}) {
  const [docs, setDocs] = useState<TaskDoc[]>(task.docs ?? []);
  const [dialog, setDialog] = useState<DocDialogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createDoc = useCreateDoc(project.id);
  const getDoc = useGetDoc();
  const updateDoc = useUpdateDoc(project.id);
  const deleteDoc = useDeleteDoc(project.id);
  const isSaving = createDoc.isPending || updateDoc.isPending;

  useEffect(() => {
    setDocs(task.docs ?? []);
  }, [task.id, task.docs]);

  const openDoc = async (doc: TaskDoc) => {
    if (disabled) return;
    try {
      const fetched = await getDoc.mutateAsync(doc.id);
      setDialog({
        mode: "edit",
        id: fetched.id,
        title: fetched.title,
        content: fetched.content ?? "",
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveDialog = async () => {
    if (!dialog || isSaving) return;
    const title = dialog.title.trim();
    if (!title) return;
    try {
      if (dialog.mode === "create") {
        const created = await createDoc.mutateAsync({
          taskId: task.id,
          title,
          content: dialog.content,
        });
        setDocs((current) =>
          current.some((item) => item.id === created.id) ? current : [...current, created]
        );
      } else if (dialog.id) {
        const updated = await updateDoc.mutateAsync({
          docId: dialog.id,
          patch: { title, content: dialog.content },
        });
        setDocs((current) =>
          current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
        );
      }
      setDialog(null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeDoc = async (doc: TaskDoc) => {
    try {
      await deleteDoc.mutateAsync(doc.id);
      setDocs((current) => current.filter((item) => item.id !== doc.id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">Docs</p>
        {!disabled && (
          <button
            type="button"
            aria-label="Add doc"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={createDoc.isPending}
            onClick={() => setDialog({ mode: "create", title: "", content: "" })}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Add doc</span>
          </button>
        )}
      </div>
      {disabled ? (
        <p className="text-xs text-slate-400">Create the task before adding docs.</p>
      ) : docs.length > 0 ? (
        <ul className="space-y-1">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="text-xs flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1 group"
            >
              <button
                type="button"
                aria-label={`Open doc ${doc.title}`}
                className="flex flex-1 min-w-0 items-center gap-2 text-left"
                onClick={() => void openDoc(doc)}
              >
                <FileText size={14} aria-hidden="true" className="text-slate-400 shrink-0" />
                <span className="font-medium text-slate-700 truncate flex-1 min-w-0">
                  {doc.title}
                </span>
                <span className="text-slate-400 shrink-0">Markdown</span>
              </button>
              <button
                type="button"
                aria-label={`Delete doc ${doc.title}`}
                className="h-5 w-5 shrink-0 rounded text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 hover:text-red-600 flex items-center justify-center disabled:opacity-50"
                disabled={deleteDoc.isPending}
                onClick={() => void removeDoc(doc)}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No docs attached.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {dialog && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 bg-black/40 p-5 flex items-center justify-center text-sm text-white">
              Loading editor...
            </div>
          }
        >
          <MarkdownDocumentDialog
            title={dialog.title}
            content={dialog.content}
            isSaving={isSaving}
            onTitleChange={(title) => setDialog((current) => current && { ...current, title })}
            onContentChange={(content) =>
              setDialog((current) => current && { ...current, content })
            }
            onClose={() => setDialog(null)}
            onSave={saveDialog}
          />
        </Suspense>
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
  pendingLinks,
  setPendingLinks,
}: {
  project: Project;
  task: Task;
  disabled?: boolean;
  pendingLinks?: PendingLink[];
  setPendingLinks?: Dispatch<SetStateAction<PendingLink[]>>;
}) {
  const [links, setLinks] = useState<TaskLink[]>(task.links ?? []);
  const displayedLinks: DisplayLink[] = pendingLinks ?? links;
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
      if (setPendingLinks) {
        const link: PendingLink = {
          id: nextDraftId("draft-link"),
          task_id: task.id,
          url: url.trim(),
          label: label.trim(),
          created_at: 0,
          pending: true,
        };
        setPendingLinks((current) => [...current, link]);
        setUrl("");
        setLabel("");
        setError(null);
        return;
      }
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
      {displayedLinks.length > 0 && (
        <ul className="space-y-1">
          {displayedLinks.map((l) => (
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
                    if (l.pending && setPendingLinks) {
                      setPendingLinks((current) => current.filter((item) => item.id !== l.id));
                      return;
                    }
                    await del.mutateAsync(l.id);
                    if (setPendingLinks) {
                      setPendingLinks((current) => current.filter((item) => item.id !== l.id));
                    } else {
                      setLinks((current) => current.filter((item) => item.id !== l.id));
                    }
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
  pendingDependencyIds,
  setPendingDependencyIds,
}: {
  project: Project;
  task: Task;
  allTasks: Task[];
  disabled?: boolean;
  pendingDependencyIds?: string[];
  setPendingDependencyIds?: Dispatch<SetStateAction<string[]>>;
}) {
  const [dependencyIds, setDependencyIds] = useState<string[]>(task.depends_on ?? []);
  const selectedDependencyIds = pendingDependencyIds ?? dependencyIds;
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useAddDependency(project.id);
  const del = useDeleteDependency(project.id);

  useEffect(() => {
    setDependencyIds(task.depends_on ?? []);
  }, [task.id, task.depends_on]);

  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const candidates = disabled ? [] : allTasks.filter(
    (t) => t.id !== task.id && t.state !== "done" && !selectedDependencyIds.includes(t.id)
  );

  const addDependency = async (dependsOn: string) => {
    if (!dependsOn || add.isPending || disabled) return;
    setCandidate(dependsOn);
    try {
      if (setPendingDependencyIds) {
        setPendingDependencyIds((current) =>
          current.includes(dependsOn) ? current : [...current, dependsOn]
        );
        setError(null);
        return;
      }
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
      if (setPendingDependencyIds) {
        setPendingDependencyIds((current) => current.filter((id) => id !== dependsOn));
        setError(null);
        return;
      }
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
      {selectedDependencyIds.length > 0 ? (
        <ul className="space-y-1">
          {selectedDependencyIds.map((id) => {
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
