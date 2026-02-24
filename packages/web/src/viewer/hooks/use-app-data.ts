/**
 * App data management hook for the viewer.
 *
 * Handles mode detection (server vs static file drop), data loading,
 * polling, drag-and-drop file loading, and the refresh toast notification.
 *
 * Memory-efficient loading strategy:
 * 1. Load manifest + zones first (small, needed for sidebar/shell)
 * 2. Load remaining modules in the background without blocking the UI
 * 3. Polling uses selective refresh — only reloads files whose mtime changed
 */

import { useState, useEffect, useRef } from "preact/hooks";
import type { LoadedData } from "../types.js";
import {
  loadModules,
  loadFromFiles,
  detectMode,
  onDataChange,
  clearOnChange,
  startPolling,
  stopPolling,
} from "../loader.js";

export interface AppDataState {
  data: LoadedData;
  loading: boolean;
  mode: "server" | "static";
  refreshToast: boolean;
  showDrop: boolean;
  setLoading: (loading: boolean) => void;
}

const EMPTY_DATA: LoadedData = {
  manifest: null,
  inventory: null,
  imports: null,
  zones: null,
  components: null,
  callGraph: null,
};

/** Modules needed for the initial UI shell (sidebar, overview). */
const PRIORITY_MODULES: Array<keyof LoadedData> = ["manifest", "zones"];

/** Remaining modules loaded in background after shell renders. */
const DEFERRED_MODULES: Array<keyof LoadedData> = [
  "inventory", "imports", "components", "callGraph",
];

export function useAppData(): AppDataState {
  const [data, setData] = useState<LoadedData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"server" | "static">("static");
  const [refreshToast, setRefreshToast] = useState(false);
  const [showDrop, setShowDrop] = useState(false);
  const initialLoad = useRef(true);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Data change listener + mode detection
  useEffect(() => {
    onDataChange((newData) => {
      setData(newData);
      if (!initialLoad.current) {
        setRefreshToast(true);
        // Clear any pending toast dismiss timer before setting a new one
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setRefreshToast(false);
          toastTimerRef.current = null;
        }, 3000);
      }
    });

    detectMode().then(async (m) => {
      setMode(m);
      if (m === "server") {
        // Staged loading: load critical modules first for fast shell render,
        // then load the rest in the background without blocking the UI.
        await loadModules(PRIORITY_MODULES);
        setLoading(false);
        initialLoad.current = false;
        startPolling(5000);

        // Load remaining modules in the background (non-blocking).
        // Uses requestIdleCallback where available to avoid blocking the main
        // thread; falls back to setTimeout for environments without it.
        const scheduleDeferred = typeof requestIdleCallback === "function"
          ? requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 50);
        scheduleDeferred(() => {
          loadModules(DEFERRED_MODULES);
        });
      } else {
        setLoading(false);
        setShowDrop(true);
      }
    });

    return () => {
      stopPolling();
      clearOnChange();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  // Drag-and-drop (only active in static mode)
  useEffect(() => {
    if (mode === "server") return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(true);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      setShowDrop(false);
      if (e.dataTransfer?.files) {
        setLoading(true);
        await loadFromFiles(e.dataTransfer.files);
        setLoading(false);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setShowDrop(false);
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("dragleave", handleDragLeave);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
      document.removeEventListener("dragleave", handleDragLeave);
    };
  }, [mode]);

  return { data, loading, mode, refreshToast, showDrop, setLoading };
}
