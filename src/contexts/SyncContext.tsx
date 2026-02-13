import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getConflictEvents,
  getLastSyncError,
  getPendingEventsCount,
  getSyncStatus,
  isOnline,
  refreshProductCache,
  syncEvents,
  type QueuedEvent,
  type SyncStatus,
} from "@/lib/sync";

interface SyncContextType {
  status: SyncStatus;
  pendingCount: number;
  conflicts: QueuedEvent[];
  lastError: string | null;
  isOnline: boolean;
  sync: () => Promise<void>;
  refreshCache: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<QueuedEvent[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());

  const updateStatus = useCallback(async () => {
    const [nextStatus, nextPendingCount, nextConflicts, nextLastError] =
      await Promise.all([
        getSyncStatus(),
        getPendingEventsCount(),
        getConflictEvents(),
        getLastSyncError(),
      ]);

    setStatus(nextStatus);
    setPendingCount(nextPendingCount);
    setConflicts(nextConflicts);
    setLastError(nextLastError);
  }, []);

  const sync = useCallback(async () => {
    if (!isOnline()) return;
    setStatus("syncing");
    await syncEvents();
    await updateStatus();
  }, [updateStatus]);

  const refreshCache = useCallback(async () => {
    await refreshProductCache();
    await updateStatus();
  }, [updateStatus]);

  useEffect(() => {
    const runSyncCycle = () => {
      void (async () => {
        try {
          setOnline(isOnline());
          await updateStatus();
          if (!isOnline()) return;

          const pending = await getPendingEventsCount();
          if (pending > 0) {
            await sync();
          }
        } catch (err) {
          console.error("Sync cycle failed:", err);
        }
      })();
    };

    const bootstrap = window.setTimeout(() => {
      runSyncCycle();
    }, 0);

    const handleOnline = () => {
      setOnline(true);
      runSyncCycle();
    };

    const handleOffline = () => {
      setOnline(false);
      setStatus("offline");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runSyncCycle();
      }
    };

    const handleFocus = () => {
      runSyncCycle();
    };

    const handlePageShow = () => {
      runSyncCycle();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);

    const interval = window.setInterval(() => {
      runSyncCycle();
    }, 5000);

    return () => {
      window.clearTimeout(bootstrap);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
  }, [sync, updateStatus]);

  return (
    <SyncContext.Provider
      value={{
        status,
        pendingCount,
        conflicts,
        lastError,
        isOnline: online,
        sync,
        refreshCache,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error("useSync must be used within a SyncProvider");
  }
  return context;
}
