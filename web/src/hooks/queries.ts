import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as api from "../lib/api";

const tasksQueryKey = (projectIdOrName: string | null) => ["tasks", projectIdOrName] as const;

function invalidateTasks(qc: QueryClient, projectIdOrName: string) {
  void qc.invalidateQueries({ queryKey: tasksQueryKey(projectIdOrName) });
}

function upsertTask(tasks: api.Task[] | undefined, task: api.Task): api.Task[] {
  if (!tasks) return [task];
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  if (index < 0) return [...tasks, task];
  const next = tasks.slice();
  next[index] = task;
  return next;
}

function removeTask(tasks: api.Task[] | undefined, taskId: string): api.Task[] {
  if (!tasks) return [];
  return tasks.filter((task) => task.id !== taskId);
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useTasks(projectIdOrName: string | null) {
  return useQuery({
    queryKey: tasksQueryKey(projectIdOrName),
    queryFn: () => api.listTasks(projectIdOrName!),
    enabled: !!projectIdOrName,
  });
}

export function useTaskSearch(projectIdOrName: string | null, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["tasks", "search", projectIdOrName, trimmed],
    queryFn: () => api.searchTasks(projectIdOrName!, trimmed),
    enabled: !!projectIdOrName && trimmed.length > 0,
  });
}

export function useTaskEvents(taskId: string | null) {
  return useQuery({
    queryKey: ["tasks", taskId, "events"],
    queryFn: () => api.listTaskEvents(taskId!),
    enabled: !!taskId,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      api.createProject(name, description),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCreateTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createTask>[1]) =>
      api.createTask(projectIdOrName, input),
    onSuccess: (task) => {
      qc.setQueryData<api.Task[]>(tasksQueryKey(projectIdOrName), (tasks) => upsertTask(tasks, task));
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useUpdateTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTask>[1] }) =>
      api.updateTask(id, patch),
    onSuccess: (task) => {
      qc.setQueryData<api.Task[]>(tasksQueryKey(projectIdOrName), (tasks) => upsertTask(tasks, task));
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useDeleteTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: (_result, taskId) => {
      qc.setQueryData<api.Task[]>(tasksQueryKey(projectIdOrName), (tasks) => removeTask(tasks, taskId));
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useUploadImage(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, file }: { taskId: string; file: File }) =>
      api.uploadTaskImage(taskId, file),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useDeleteImage(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => api.deleteTaskImage(imageId),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useCreateDoc(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, title, content }: { taskId: string; title: string; content: string }) =>
      api.createTaskDoc(taskId, { title, content }),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useGetDoc() {
  return useMutation({
    mutationFn: (docId: string) => api.getTaskDoc(docId),
  });
}

export function useUpdateDoc(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docId,
      patch,
    }: {
      docId: string;
      patch: Parameters<typeof api.updateTaskDoc>[1];
    }) => api.updateTaskDoc(docId, patch),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useDeleteDoc(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.deleteTaskDoc(docId),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useAddDependency(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, dependsOn }: { taskId: string; dependsOn: string }) =>
      api.addDependency(taskId, dependsOn),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useDeleteDependency(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, dependsOn }: { taskId: string; dependsOn: string }) =>
      api.deleteDependency(taskId, dependsOn),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useAddLink(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, url, label }: { taskId: string; url: string; label: string }) =>
      api.addLink(taskId, url, label),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}

export function useDeleteLink(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.deleteLink(linkId),
    onSuccess: () => {
      invalidateTasks(qc, projectIdOrName);
    },
  });
}
