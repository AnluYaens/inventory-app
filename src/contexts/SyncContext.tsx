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
  isOnline: boolean;
  sync: () => Promise<void>;
  refreshCache: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>("offline");
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<QueuedEvent[]>([]);
  const [online, setOnline] = useState(isOnline());

  const updateStatus = useCallback(async () => {
    const [nextStatus, nextPendingCount, nextConflicts] = await Promise.all([
      getSyncStatus(),
      getPendingEventsCount(),
      getConflictEvents(),
    ]);

    setStatus(nextStatus);
    setPendingCount(nextPendingCount);
    setConflicts(nextConflicts);
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
      void updateStatus();
      if (isOnline()) {
        void sync();
      }
    }, 0);

    const handleOnline = () => {
      setOnline(true);
      void sync();
    };

    const handleOffline = () => {
      setOnline(false);
      setStatus("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = window.setInterval(() => {
      void updateStatus();
    }, 5000);

    return () => {
      window.clearTimeout(bootstrap);
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
