import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useTasks(projectIdOrName: string | null) {
  return useQuery({
    queryKey: ["tasks", projectIdOrName],
    queryFn: () => api.listTasks(projectIdOrName!),
    enabled: !!projectIdOrName,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      api.createProject(name, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useCreateTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.createTask>[1]) =>
      api.createTask(projectIdOrName, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useUpdateTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTask>[1] }) =>
      api.updateTask(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useDeleteTask(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useUploadImage(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, file }: { taskId: string; file: File }) =>
      api.uploadTaskImage(taskId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useDeleteImage(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (imageId: string) => api.deleteTaskImage(imageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useCreateDoc(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, title, content }: { taskId: string; title: string; content: string }) =>
      api.createTaskDoc(taskId, { title, content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useDeleteDoc(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.deleteTaskDoc(docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useAddDependency(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, dependsOn }: { taskId: string; dependsOn: string }) =>
      api.addDependency(taskId, dependsOn),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useDeleteDependency(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, dependsOn }: { taskId: string; dependsOn: string }) =>
      api.deleteDependency(taskId, dependsOn),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useAddLink(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, url, label }: { taskId: string; url: string; label: string }) =>
      api.addLink(taskId, url, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}

export function useDeleteLink(projectIdOrName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.deleteLink(linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectIdOrName] }),
  });
}
