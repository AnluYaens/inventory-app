import Dexie, { type Table } from "dexie";

// Types for offline storage
export interface CachedProduct {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  size: string | null;
  color: string | null;
  price: number;
  cost: number | null;
  image_url: string | null;
  stock: number;
  created_at: string;
  updated_at: string;
}

export interface QueuedEvent {
  id?: number;
  localId: string;
  productId: string;
  type: "sale" | "restock" | "adjustment";
  qtyChange: number;
  note: string | null;
  deviceId: string;
  createdAt: string;
  status: "pending" | "syncing" | "synced" | "conflict";
  errorMessage?: string;
}

export interface SyncState {
  id: string;
  lastSyncAt: string | null;
  lastSyncAttemptAt?: string | null;
  status: "offline" | "syncing" | "synced" | "conflict";
  lastError?: string | null;
  lastErrorDetails?: string | null;
  lastRetryAt?: string | null;
  retryCount?: number;
}

export interface LocalSettings {
  id: string;
  storeName: string;
  currency: string;
  deviceId: string;
}

// Dexie database class
class InventoryDB extends Dexie {
  products!: Table<CachedProduct, string>;
  eventQueue!: Table<QueuedEvent, number>;
  syncState!: Table<SyncState, string>;
  settings!: Table<LocalSettings, string>;

  constructor() {
    super("StockFlowDB");

    this.version(1).stores({
      products: "id, sku, category, name",
      eventQueue: "++id, localId, productId, status, createdAt",
      syncState: "id",
      settings: "id",
    });
  }
}

export const db = new InventoryDB();

// Helper to generate unique device ID
export function getDeviceId(): string {
  let deviceId = localStorage.getItem("stockflow_device_id");
  if (!deviceId) {
    deviceId = `device_${crypto.randomUUID()}`;
    localStorage.setItem("stockflow_device_id", deviceId);
  }
  return deviceId;
}

// Helper to generate local event ID
export function generateLocalEventId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
