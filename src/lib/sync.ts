import { db, getDeviceId, generateLocalEventId } from "./db";
import type { CachedProduct, QueuedEvent } from "./db";
import { supabase } from "@/integrations/supabase/client";

let inFlightSync: Promise<{ synced: number; conflicts: number }> | null = null;

export type { QueuedEvent };
export type SyncStatus = "offline" | "syncing" | "synced" | "conflict";

export interface SyncDiagnostics {
  lastSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  retryCount: number;
  lastRetryAt: string | null;
  lastError: string | null;
  lastErrorDetails: string | null;
}

interface NormalizedSyncError {
  userMessage: string;
  technicalDetails: string;
}

interface SyncStatePatch {
  lastSyncAt?: string | null;
  lastSyncAttemptAt?: string | null;
  lastError?: string | null;
  lastErrorDetails?: string | null;
  lastRetryAt?: string | null;
  retryCount?: number;
}

function normalizeSyncError(err: unknown): NormalizedSyncError {
  const genericMessage =
    "No se pudo sincronizar. Reintentando automaticamente.";
  if (err instanceof Error) {
    return {
      userMessage: genericMessage,
      technicalDetails: err.message,
    };
  }
  if (typeof err === "object" && err != null) {
    const e = err as Record<string, unknown>;
    const code = typeof e.code === "string" ? e.code : "";
    const userMessage =
      code === "PGRST203"
        ? "Error de configuracion en sync (RPC). Contacta soporte."
        : genericMessage;
    return {
      userMessage,
      technicalDetails: JSON.stringify({
        message: e.message,
        code: e.code,
        details: e.details,
        hint: e.hint,
        status: e.status,
      }),
    };
  }
  return {
    userMessage: genericMessage,
    technicalDetails: String(err),
  };
}

// Check online status
export function isOnline(): boolean {
  return navigator.onLine;
}

// Queue an inventory event locally
export async function queueInventoryEvent(
  productId: string,
  type: "sale" | "restock" | "adjustment",
  qtyChange: number,
  note: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  const deviceId = getDeviceId();
  const localId = generateLocalEventId();

  // Get current product from cache
  const product = await db.products.get(productId);
  if (!product) {
    return { success: false, error: "Producto no encontrado" };
  }

  // For sales, check if we have enough stock locally
  if (type === "sale" && product.stock + qtyChange < 0) {
    return { success: false, error: "Stock insuficiente" };
  }

  // Update local stock optimistically
  await db.products.update(productId, {
    stock: product.stock + qtyChange,
  });

  // Add to queue
  await db.eventQueue.add({
    localId,
    productId,
    type,
    qtyChange,
    note,
    deviceId,
    createdAt: new Date().toISOString(),
    status: "pending",
  });

  // Try to sync if online
  if (isOnline()) {
    void syncEvents();
  }

  return { success: true };
}

// Sync pending events to server
export async function syncEvents(): Promise<{
  synced: number;
  conflicts: number;
}> {
  if (inFlightSync) return inFlightSync;
  inFlightSync = runSyncEvents();
  try {
    return await inFlightSync;
  } finally {
    inFlightSync = null;
  }
}

async function runSyncEvents(): Promise<{ synced: number; conflicts: number }> {
  if (!isOnline()) {
    return { synced: 0, conflicts: 0 };
  }

  await updateSyncState("syncing", {
    lastSyncAttemptAt: new Date().toISOString(),
  });

  const pendingEvents = await db.eventQueue
    .where("status")
    .anyOf(["pending", "syncing"])
    .toArray();

  let synced = 0;
  let conflicts = 0;

  for (const event of pendingEvents) {
    try {
      // Mark as syncing
      await db.eventQueue.update(event.id!, { status: "syncing" });

      // Call the RPC function
      const { data, error } = await supabase.rpc("apply_inventory_event", {
        p_product_id: event.productId,
        p_type: event.type,
        p_qty_change: event.qtyChange,
        p_note: event.note ?? undefined,
        p_device_id: event.deviceId,
        p_local_id: event.localId,
      });

      if (error) {
        throw error;
      }

      const result = data?.[0];
      if (!result) {
        throw new Error("El RPC de inventario no retorno resultado");
      }

      if (result.event_status === "conflict") {
        await db.eventQueue.update(event.id!, {
          status: "conflict",
          errorMessage: result.error_message || "Ocurrio un conflicto",
        });
        conflicts++;
      } else {
        await db.products.update(event.productId, { stock: result.new_stock });
        await db.eventQueue.update(event.id!, { status: "synced" });
        synced++;
      }
    } catch (err) {
      const normalized = normalizeSyncError(err);
      const state = await db.syncState.get("main");
      const nextRetryCount = (state?.retryCount ?? 0) + 1;
      const retryAt = new Date().toISOString();
      console.error("Failed to sync event", {
        eventId: event.id,
        localId: event.localId,
        productId: event.productId,
        userMessage: normalized.userMessage,
        technicalDetails: normalized.technicalDetails,
        raw: err,
      });
      await db.eventQueue.update(event.id!, {
        status: "pending",
        errorMessage: normalized.technicalDetails,
      });
      await updateSyncState("syncing", {
        lastError: normalized.userMessage,
        lastErrorDetails: normalized.technicalDetails,
        retryCount: nextRetryCount,
        lastRetryAt: retryAt,
      });
    }
  }

  // Refresh cache from server
  await refreshProductCache();

  // Update sync state
  const hasConflicts =
    conflicts > 0 ||
    (await db.eventQueue.where("status").equals("conflict").count()) > 0;
  const remainingPending = await db.eventQueue
    .where("status")
    .anyOf(["pending", "syncing"])
    .count();
  const finalStatus: SyncStatus = hasConflicts
    ? "conflict"
    : remainingPending > 0
      ? "syncing"
      : "synced";

  if (finalStatus === "synced") {
    await updateSyncState("synced", {
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      lastErrorDetails: null,
      retryCount: 0,
      lastRetryAt: null,
    });
  } else if (finalStatus === "conflict") {
    await updateSyncState("conflict", {
      lastError: "Hay conflictos de inventario pendientes.",
    });
  } else {
    await updateSyncState("syncing");
  }

  return { synced, conflicts };
}

// Refresh local cache from server
export async function refreshProductCache(): Promise<void> {
  if (!isOnline()) return;

  try {
    // Fetch products with stock
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("*");

    if (productsError) throw productsError;

    const { data: snapshots, error: snapshotsError } = await supabase
      .from("stock_snapshots")
      .select("*");

    if (snapshotsError) throw snapshotsError;

    // Create stock lookup
    const stockLookup = new Map(
      snapshots?.map((s) => [s.product_id, s.stock]) || [],
    );

    // Apply optimistic deltas from pending local events so UI does not
    // "revert" while events are waiting to sync.
    const pendingEvents = await db.eventQueue
      .where("status")
      .anyOf(["pending", "syncing"])
      .toArray();
    const pendingDeltaLookup = new Map<string, number>();
    for (const event of pendingEvents) {
      pendingDeltaLookup.set(
        event.productId,
        (pendingDeltaLookup.get(event.productId) ?? 0) + event.qtyChange,
      );
    }

    // Transform and cache
    const cachedProducts: CachedProduct[] = (products || []).map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      size: p.size,
      color: p.color,
      price: Number(p.price),
      cost: p.cost ? Number(p.cost) : null,
      image_url: p.image_url,
      stock: (stockLookup.get(p.id) ?? 0) + (pendingDeltaLookup.get(p.id) ?? 0),
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    // Clear and repopulate
    await db.products.clear();
    await db.products.bulkPut(cachedProducts);

    // Update sync timestamp
    const previous = await db.syncState.get("main");
    await db.syncState.put({
      id: "main",
      lastSyncAt: new Date().toISOString(),
      lastSyncAttemptAt: previous?.lastSyncAttemptAt ?? null,
      status: "synced",
      lastError: null,
      lastErrorDetails: null,
      retryCount: 0,
      lastRetryAt: null,
    });
  } catch (err) {
    console.error("Failed to refresh cache:", err);
  }
}

// Get current sync status
export async function getSyncStatus(): Promise<SyncStatus> {
  const state = await db.syncState.get("main");
  if (!state) return "offline";

  if (!isOnline()) return "offline";

  const hasConflicts =
    (await db.eventQueue.where("status").equals("conflict").count()) > 0;
  if (hasConflicts) return "conflict";

  const pendingCount = await db.eventQueue
    .where("status")
    .anyOf(["pending", "syncing"])
    .count();
  if (pendingCount > 0) return "syncing";

  return state.status;
}

// Update sync state
async function updateSyncState(
  status: SyncStatus,
  patch: SyncStatePatch = {},
): Promise<void> {
  const previous = await db.syncState.get("main");
  const nextLastSyncAt =
    patch.lastSyncAt !== undefined
      ? patch.lastSyncAt
      : status === "synced"
        ? new Date().toISOString()
        : (previous?.lastSyncAt ?? null);

  await db.syncState.put({
    id: "main",
    lastSyncAt: nextLastSyncAt,
    lastSyncAttemptAt:
      patch.lastSyncAttemptAt !== undefined
        ? patch.lastSyncAttemptAt
        : (previous?.lastSyncAttemptAt ?? null),
    status,
    lastError:
      patch.lastError !== undefined ? patch.lastError : (previous?.lastError ?? null),
    lastErrorDetails:
      patch.lastErrorDetails !== undefined
        ? patch.lastErrorDetails
        : (previous?.lastErrorDetails ?? null),
    lastRetryAt:
      patch.lastRetryAt !== undefined
        ? patch.lastRetryAt
        : (previous?.lastRetryAt ?? null),
    retryCount:
      patch.retryCount !== undefined ? patch.retryCount : (previous?.retryCount ?? 0),
  });
}

// Get pending events count
export async function getPendingEventsCount(): Promise<number> {
  return db.eventQueue.where("status").anyOf(["pending", "syncing"]).count();
}

// Get latest sync error for support/troubleshooting
export async function getLastSyncError(): Promise<string | null> {
  const state = await db.syncState.get("main");
  if (state?.lastError) {
    return state.lastError;
  }

  const withError = await db.eventQueue
    .filter(
      (event) =>
        Boolean(event.errorMessage) &&
        (event.status === "pending" ||
          event.status === "syncing" ||
          event.status === "conflict"),
    )
    .toArray();

  if (withError.length === 0) {
    return null;
  }

  withError.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return withError[0]
    ? "No se pudo sincronizar. Reintentando automaticamente."
    : null;
}

export async function getLastSyncErrorDetails(): Promise<string | null> {
  const state = await db.syncState.get("main");
  if (state?.lastErrorDetails) {
    return state.lastErrorDetails;
  }

  const withError = await db.eventQueue
    .filter(
      (event) =>
        Boolean(event.errorMessage) &&
        (event.status === "pending" ||
          event.status === "syncing" ||
          event.status === "conflict"),
    )
    .toArray();

  if (withError.length === 0) {
    return null;
  }

  withError.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return withError[0]?.errorMessage ?? null;
}

export async function getSyncDiagnostics(): Promise<SyncDiagnostics> {
  const state = await db.syncState.get("main");
  return {
    lastSyncAt: state?.lastSyncAt ?? null,
    lastSyncAttemptAt: state?.lastSyncAttemptAt ?? null,
    retryCount: state?.retryCount ?? 0,
    lastRetryAt: state?.lastRetryAt ?? null,
    lastError: state?.lastError ?? null,
    lastErrorDetails: state?.lastErrorDetails ?? null,
  };
}

// Get conflict events
export async function getConflictEvents(): Promise<QueuedEvent[]> {
  return db.eventQueue.where("status").equals("conflict").toArray();
}

// Resolve conflict by removing the event
export async function resolveConflict(eventId: number): Promise<void> {
  await db.eventQueue.delete(eventId);
}

// Clean up old synced events (keep last 100)
export async function cleanupSyncedEvents(): Promise<void> {
  const synced = await db.eventQueue
    .where("status")
    .equals("synced")
    .reverse()
    .sortBy("createdAt");

  if (synced.length > 100) {
    const toDelete = synced.slice(100).map((e) => e.id!);
    await db.eventQueue.bulkDelete(toDelete);
  }
}
