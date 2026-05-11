// Thin REST wrapper for taskline-server. Mirrors the canonical Project /
// Task shapes from server/api/model/model.go — keep them in sync.

export type TaskState =
  | "pending"
  | "start"
  | "design"
  | "dev"
  | "review"
  | "done";

export const STATES: TaskState[] = [
  "pending",
  "start",
  "design",
  "dev",
  "review",
  "done",
];

export const STATE_LABELS: Record<TaskState, string> = {
  pending: "Pending",
  start: "Start",
  design: "Design",
  dev: "Dev",
  review: "Review",
  done: "Done",
};

export type TaskType = "feature" | "bug";

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  type: TaskType;
  state: TaskState;
  priority: number;
  depends_on?: string[];
  images?: TaskImage[];
  links?: TaskLink[];
  created_at: number;
  updated_at: number;
}

export interface TaskImage {
  id: string;
  task_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: number;
}

export interface TaskLink {
  id: string;
  task_id: string;
  url: string;
  label: string;
  created_at: number;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // body wasn't JSON; keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Projects ──────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const r = await request<{ projects: Project[] }>("GET", "/api/v1/projects");
  return r.projects ?? [];
}

export async function createProject(
  name: string,
  description: string
): Promise<Project> {
  return request<Project>("POST", "/api/v1/projects", { name, description });
}

// ─── Tasks ─────────────────────────────────────────────────────────────

export async function listTasks(projectIdOrName: string): Promise<Task[]> {
  const r = await request<{ tasks: Task[] }>(
    "GET",
    `/api/v1/projects/${encodeURIComponent(projectIdOrName)}/tasks`
  );
  return r.tasks ?? [];
}

export async function createTask(
  projectIdOrName: string,
  input: {
    title: string;
    description?: string;
    type: TaskType;
    priority: number;
    auto_start?: boolean;
  }
): Promise<Task> {
  return request<Task>(
    "POST",
    `/api/v1/projects/${encodeURIComponent(projectIdOrName)}/tasks`,
    input
  );
}

export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "description" | "type" | "state" | "priority">>
): Promise<Task> {
  return request<Task>("PATCH", `/api/v1/tasks/${encodeURIComponent(id)}`, patch);
}

export async function deleteTask(id: string): Promise<void> {
  await request<unknown>("DELETE", `/api/v1/tasks/${encodeURIComponent(id)}`);
}

export async function addDependency(
  taskId: string,
  dependsOn: string
): Promise<void> {
  await request<unknown>(
    "POST",
    `/api/v1/tasks/${encodeURIComponent(taskId)}/deps`,
    { depends_on: dependsOn }
  );
}

export async function addLink(
  taskId: string,
  url: string,
  label: string
): Promise<TaskLink> {
  return request<TaskLink>(
    "POST",
    `/api/v1/tasks/${encodeURIComponent(taskId)}/links`,
    { url, label }
  );
}

export async function deleteLink(linkId: string): Promise<void> {
  await request<unknown>(
    "DELETE",
    `/api/v1/links/${encodeURIComponent(linkId)}`
  );
}

export { ApiError };
