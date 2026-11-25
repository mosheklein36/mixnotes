import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { audioContentType, deriveProjectName, errorMessage, uploadVersion } from "@mixnotes/shared";
import { sb } from "./supabase";

const QUEUE_KEY = "mixnotes.queue";
const FOLDER_KEY = "mixnotes.folder";
const LAST_ACTIVE_KEY = "mixnotes.lastActiveAt";
const RETRY_MS = 30_000;
const MAX_HISTORY = 50;

export type UploadStatus = "pending" | "uploading" | "done" | "duplicate" | "failed";

export interface UploadItem {
  hash: string;
  path: string;
  filename: string;
  size: number;
  status: UploadStatus;
  error?: string;
  projectName: string;
  attempts: number;
  updatedAt: number;
}

interface FileReadyEvent {
  path: string;
  filename: string;
  hash: string;
  size: number;
}

export type WatchState = { kind: "idle" } | { kind: "watching"; folder: string } | { kind: "error"; folder: string; message: string };

function loadQueue(): UploadItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as UploadItem[];
    // Anything interrupted mid-upload is retried.
    return items.map((i) => (i.status === "uploading" ? { ...i, status: "pending" } : i));
  } catch {
    return [];
  }
}

function probeDuration(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 5000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

export function useUploader(userId: string | null) {
  const [items, setItems] = useState<UploadItem[]>(loadQueue);
  const [folder, setFolderState] = useState<string | null>(() => localStorage.getItem(FOLDER_KEY));
  const [watch, setWatch] = useState<WatchState>({ kind: "idle" });
  const [online, setOnline] = useState(navigator.onLine);
  const itemsRef = useRef(items);
  const busyRef = useRef(false);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    itemsRef.current = items;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  }, [items]);

  const patch = useCallback((hash: string, change: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.hash === hash ? { ...i, ...change, updatedAt: Date.now() } : i)));
  }, []);

  const processQueue = useCallback(async () => {
    if (busyRef.current || !userIdRef.current) return;
    busyRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "pending");
        if (!next) break;
        itemsRef.current = itemsRef.current.map((i) => (i.hash === next.hash ? { ...i, status: "uploading" } : i));
        patch(next.hash, { status: "uploading", error: undefined });
        try {
          const buf = await invoke<ArrayBuffer>("read_file", { path: next.path });
          const contentType = audioContentType(next.filename);
          const blob = new Blob([buf], { type: contentType });
          const durationSeconds = await probeDuration(blob);
          const result = await uploadVersion(sb, {
            filename: next.filename,
            fileHash: next.hash,
            bytes: blob,
            contentType,
            projectName: next.projectName,
            durationSeconds,
          });
          patch(next.hash, { status: result.status === "uploaded" ? "done" : "duplicate", attempts: next.attempts + 1 });
          itemsRef.current = itemsRef.current.map((i) => (i.hash === next.hash ? { ...i, status: "done" } : i));
        } catch (err) {
          patch(next.hash, { status: "failed", error: errorMessage(err), attempts: next.attempts + 1 });
          itemsRef.current = itemsRef.current.map((i) => (i.hash === next.hash ? { ...i, status: "failed" } : i));
        }
      }
    } finally {
      busyRef.current = false;
      if (itemsRef.current.some((i) => i.status === "pending")) setTimeout(() => void processQueueRef.current(), 0);
    }
  }, [patch]);
  const processQueueRef = useRef(processQueue);
  processQueueRef.current = processQueue;

  const retry = useCallback(
    (hash?: string) => {
      setItems((prev) => {
        const next = prev.map((i) =>
          i.status === "failed" && (hash == null || i.hash === hash) ? { ...i, status: "pending" as const } : i,
        );
        itemsRef.current = next;
        return next;
      });
    },
    [],
  );

  // Incoming files from the Rust watcher.
  useEffect(() => {
    const unlisten = listen<FileReadyEvent>("file-ready", ({ payload }) => {
      setItems((prev) => {
        const existing = prev.find((i) => i.hash === payload.hash);
        if (existing && existing.status !== "failed") return prev;
        const item: UploadItem = {
          hash: payload.hash,
          path: payload.path,
          filename: payload.filename,
          size: payload.size,
          status: "pending",
          projectName: deriveProjectName(payload.filename),
          attempts: existing?.attempts ?? 0,
          updatedAt: Date.now(),
        };
        const next = [item, ...prev.filter((i) => i.hash !== payload.hash)];
        itemsRef.current = next;
        return next;
      });
    });
    const unlistenErr = listen<string>("watch-error", ({ payload }) =>
      setWatch((w) => (w.kind === "idle" ? w : { kind: "error", folder: w.folder, message: payload })),
    );
    return () => {
      unlisten.then((f) => f());
      unlistenErr.then((f) => f());
    };
  }, []);

  // Start/stop the watcher with the selected folder.
  useEffect(() => {
    if (!folder || !userId) {
      invoke("stop_watching").catch(() => {});
      setWatch({ kind: "idle" });
      return;
    }
    const since = Number(localStorage.getItem(LAST_ACTIVE_KEY) ?? Date.now());
    invoke("start_watching", { path: folder, sinceMs: since })
      .then(() => setWatch({ kind: "watching", folder }))
      .catch((err) => setWatch({ kind: "error", folder, message: errorMessage(err) }));
    const heartbeat = setInterval(() => localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())), 15_000);
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    return () => clearInterval(heartbeat);
  }, [folder, userId]);

  // Retry failures periodically and when the connection returns.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      retry();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = setInterval(() => {
      if (navigator.onLine && itemsRef.current.some((i) => i.status === "failed")) retry();
    }, RETRY_MS);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(timer);
    };
  }, [retry]);

  // Drain the queue after every committed change, so new items never depend on render timing.
  useEffect(() => {
    if (userId && items.some((i) => i.status === "pending")) void processQueue();
  }, [items, userId, processQueue]);

  const setFolder = useCallback((path: string) => {
    // Files already in a newly selected folder are ignored.
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    localStorage.setItem(FOLDER_KEY, path);
    setFolderState(path);
  }, []);

  const clearHistory = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status === "pending" || i.status === "uploading" || i.status === "failed"));
  }, []);

  return { items, folder, watch, online, setFolder, retry, clearHistory };
}

export type Uploader = ReturnType<typeof useUploader>;
