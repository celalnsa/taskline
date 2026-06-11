import type { Task } from "./api";

export function confirmTaskDelete(task: Task): boolean {
  return globalThis.confirm(
    `Delete task "${task.title}"? This cascades to dependencies and images.`
  );
}

export function createTaskCopyDraft(task: Task): Task {
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
