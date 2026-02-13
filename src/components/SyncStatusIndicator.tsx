import { WifiOff, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import { cn } from "@/lib/utils";

interface SyncStatusIndicatorProps {
  iconOnly?: boolean;
}

export function SyncStatusIndicator({ iconOnly = false }: SyncStatusIndicatorProps) {
  const { status, pendingCount, sync, isOnline } = useSync();

  const statusConfig = {
    offline: {
      icon: WifiOff,
      label: "Sin conexion",
      className: "sync-offline",
    },
    syncing: {
      icon: RefreshCw,
      label: "Sincronizando...",
      className: "sync-syncing",
    },
    synced: {
      icon: CheckCircle,
      label: "Sincronizado",
      className: "sync-synced",
    },
    conflict: {
      icon: AlertTriangle,
      label: "Conflictos",
      className: "sync-conflict",
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;
  const ariaLabel =
    pendingCount > 0 && status !== "syncing"
      ? `${config.label} (${pendingCount} pendientes)`
      : config.label;

  return (
    <button
      onClick={() => isOnline && sync()}
      disabled={!isOnline || status === "syncing"}
      title={ariaLabel}
      aria-label={ariaLabel}
      className={cn(
        "sync-indicator touch-target transition-transform active:scale-95",
        iconOnly && "px-2.5 py-2 min-w-0 justify-center",
        config.className,
        status === "syncing" && "pulse-sync",
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5", status === "syncing" && "animate-spin")}
      />
      {!iconOnly && <span>{config.label}</span>}
      {!iconOnly && pendingCount > 0 && status !== "syncing" && (
        <span className="ml-1 text-xs opacity-75">({pendingCount})</span>
      )}
    </button>
  );
}
