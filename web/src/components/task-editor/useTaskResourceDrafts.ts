import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Task, TaskImage, TaskLink } from "../../lib/api";
import { useAddDependency, useAddLink, useUploadImage } from "../../hooks/queries";

export type PendingImage = TaskImage & {
  file: File;
  pending: boolean;
  preview_url?: string;
};

export type DisplayImage = TaskImage & {
  pending?: boolean;
  preview_url?: string;
};

export type PendingLink = TaskLink & {
  pending: boolean;
};

export type DisplayLink = TaskLink & {
  pending?: boolean;
};

let draftId = 0;

function nextDraftId(prefix: string): string {
  draftId += 1;
  return `${prefix}-${draftId}`;
}

export function createFilePreviewURL(file: File): string | undefined {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  return URL.createObjectURL(file);
}

export function revokeFilePreviewURL(url: string | undefined) {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(url);
}

export function createPendingImage(taskId: string, file: File, previewURL?: string): PendingImage {
  return {
    id: nextDraftId("draft-image"),
    task_id: taskId,
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    uploaded_at: 0,
    preview_url: previewURL,
    file,
    pending: true,
  };
}

export function createPendingLink(taskId: string, url: string, label: string): PendingLink {
  return {
    id: nextDraftId("draft-link"),
    task_id: taskId,
    url,
    label,
    created_at: 0,
    pending: true,
  };
}

type TaskResourceDrafts = {
  pendingImages: PendingImage[];
  setPendingImages: Dispatch<SetStateAction<PendingImage[]>>;
  pendingLinks: PendingLink[];
  setPendingLinks: Dispatch<SetStateAction<PendingLink[]>>;
  pendingDependencyIds: string[];
  setPendingDependencyIds: Dispatch<SetStateAction<string[]>>;
  isResourceSaving: boolean;
  replayCreateResources: (task: Task) => Promise<void>;
};

export function useTaskResourceDrafts(projectId: string): TaskResourceDrafts {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingLinks, setPendingLinks] = useState<PendingLink[]>([]);
  const [pendingDependencyIds, setPendingDependencyIds] = useState<string[]>([]);
  const createdPendingDependencyIdsRef = useRef<Set<string>>(new Set());

  const uploadImage = useUploadImage(projectId);
  const addLink = useAddLink(projectId);
  const addDependency = useAddDependency(projectId);

  const replayCreateResources = useCallback(
    async (task: Task) => {
      for (const image of pendingImages) {
        if (!image.pending) continue;
        const uploaded = await uploadImage.mutateAsync({
          taskId: task.id,
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
          taskId: task.id,
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
        await addDependency.mutateAsync({ taskId: task.id, dependsOn });
        createdPendingDependencyIdsRef.current.add(dependsOn);
      }
    },
    [addDependency, addLink, pendingDependencyIds, pendingImages, pendingLinks, uploadImage]
  );

  return {
    pendingImages,
    setPendingImages,
    pendingLinks,
    setPendingLinks,
    pendingDependencyIds,
    setPendingDependencyIds,
    isResourceSaving: uploadImage.isPending || addLink.isPending || addDependency.isPending,
    replayCreateResources,
  };
}
