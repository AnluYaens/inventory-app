import { WifiOff, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import { cn } from "@/lib/utils";

export function SyncStatusIndicator() {
  const { status, pendingCount, sync, isOnline } = useSync();

  const statusConfig = {
    offline: {
      icon: WifiOff,
      label: "Offline",
      className: "sync-offline",
    },
    syncing: {
      icon: RefreshCw,
      label: "Syncing...",
      className: "sync-syncing",
    },
    synced: {
      icon: CheckCircle,
      label: "Synced",
      className: "sync-synced",
    },
    conflict: {
      icon: AlertTriangle,
      label: "Conflicts",
      className: "sync-conflict",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <button
      onClick={() => isOnline && sync()}
      disabled={!isOnline || status === "syncing"}
      className={cn(
        "sync-indicator touch-target transition-transform active:scale-95",
        config.className,
        status === "syncing" && "pulse-sync",
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5", status === "syncing" && "animate-spin")}
      />
      <span>{config.label}</span>
      {pendingCount > 0 && status !== "syncing" && (
        <span className="ml-1 text-xs opacity-75">({pendingCount})</span>
      )}
    </button>
  );
}
