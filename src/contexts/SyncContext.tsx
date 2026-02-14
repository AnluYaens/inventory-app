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
  getLastSyncErrorDetails,
  getPendingEventsCount,
  getSyncDiagnostics,
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
  lastErrorDetails: string | null;
  lastSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  retryCount: number;
  lastRetryAt: string | null;
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
  const [lastErrorDetails, setLastErrorDetails] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncAttemptAt, setLastSyncAttemptAt] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastRetryAt, setLastRetryAt] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline());

  const updateStatus = useCallback(async () => {
    const [
      nextStatus,
      nextPendingCount,
      nextConflicts,
      nextLastError,
      nextLastErrorDetails,
      diagnostics,
    ] =
      await Promise.all([
        getSyncStatus(),
        getPendingEventsCount(),
        getConflictEvents(),
        getLastSyncError(),
        getLastSyncErrorDetails(),
        getSyncDiagnostics(),
      ]);

    setStatus(nextStatus);
    setPendingCount(nextPendingCount);
    setConflicts(nextConflicts);
    setLastError(nextLastError);
    setLastErrorDetails(nextLastErrorDetails);
    setLastSyncAt(diagnostics.lastSyncAt);
    setLastSyncAttemptAt(diagnostics.lastSyncAttemptAt);
    setRetryCount(diagnostics.retryCount);
    setLastRetryAt(diagnostics.lastRetryAt);
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
    const bootstrap = window.setTimeout(() => {
      void (async () => {
        try {
          setOnline(isOnline());
          await updateStatus();
        } catch (err) {
          console.error("Failed to bootstrap sync status:", err);
        }
      })();
    }, 0);

    const handleOnline = () => {
      setOnline(true);
      void updateStatus();
    };

    const handleOffline = () => {
      setOnline(false);
      setStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.clearTimeout(bootstrap);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [updateStatus]);

  return (
    <SyncContext.Provider
      value={{
        status,
        pendingCount,
        conflicts,
        lastError,
        lastErrorDetails,
        lastSyncAt,
        lastSyncAttemptAt,
        retryCount,
        lastRetryAt,
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
