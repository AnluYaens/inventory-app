import { db, getDeviceId, generateLocalEventId } from "./db";
import type { CachedProduct, QueuedEvent } from "./db";
import { supabase } from "@/integrations/supabase/client";

export type { QueuedEvent };
export type SyncStatus = "offline" | "syncing" | "synced" | "conflict";

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
    return { success: false, error: "Product not found" };
  }

  // For sales, check if we have enough stock locally
  if (type === "sale" && product.stock + qtyChange < 0) {
    return { success: false, error: "Insufficient stock" };
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
    syncEvents();
  }

  return { success: true };
}

// Sync pending events to server
export async function syncEvents(): Promise<{
  synced: number;
  conflicts: number;
}> {
  if (!isOnline()) {
    return { synced: 0, conflicts: 0 };
  }

  await updateSyncState("syncing");

  const pendingEvents = await db.eventQueue
    .where("status")
    .equals("pending")
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
      });

      if (error) {
        throw error;
      }

      const result = data?.[0];

      if (result?.event_status === "conflict") {
        await db.eventQueue.update(event.id!, {
          status: "conflict",
          errorMessage: result.error_message || "Conflict occurred",
        });
        conflicts++;
      } else {
        await db.eventQueue.update(event.id!, { status: "synced" });
        synced++;
      }
    } catch (err) {
      console.error("Failed to sync event:", err);
      await db.eventQueue.update(event.id!, {
        status: "pending",
        errorMessage: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // Refresh cache from server
  await refreshProductCache();

  // Update sync state
  const hasConflicts =
    conflicts > 0 ||
    (await db.eventQueue.where("status").equals("conflict").count()) > 0;
  await updateSyncState(hasConflicts ? "conflict" : "synced");

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
      stock: stockLookup.get(p.id) || 0,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    // Clear and repopulate
    await db.products.clear();
    await db.products.bulkPut(cachedProducts);

    // Update sync timestamp
    await db.syncState.put({
      id: "main",
      lastSyncAt: new Date().toISOString(),
      status: "synced",
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

  return state.status;
}

// Update sync state
async function updateSyncState(status: SyncStatus): Promise<void> {
  await db.syncState.put({
    id: "main",
    lastSyncAt: status === "synced" ? new Date().toISOString() : null,
    status,
  });
}

// Get pending events count
export async function getPendingEventsCount(): Promise<number> {
  return db.eventQueue.where("status").anyOf(["pending", "syncing"]).count();
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
