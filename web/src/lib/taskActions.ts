import type { Task } from "./api";

export function confirmTaskDelete(task: Task): boolean {
  return globalThis.confirm(
    `Delete task "${task.title}"? This cascades to dependencies and images.`
  );
}

export function createTaskCloneDraft(task: Task): Task {
  return {
    id: "",
    project_id: task.project_id,
    title: task.title,
    description: task.description,
    type: task.type,
    state: task.state,
    priority: task.priority,
    labels: [...(task.labels ?? [])],
    depends_on: [],
    links: [],
    images: [],
    docs: [],
    created_at: 0,
    updated_at: 0,
  };
}

export async function copyTaskIDToClipboard(task: Task): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(task.id);
      return;
    } catch {
      // Clipboard access can be denied on non-secure LAN HTTP origins.
    }
  }

  if (
    typeof document === "undefined" ||
    !document.body ||
    typeof document.execCommand !== "function"
  ) {
    throw new Error("Unable to copy task ID.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = task.id;
  textarea.dataset.tasklineClipboard = "true";
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Unable to copy task ID.");
    }
  } finally {
    textarea.remove();
  }
}
