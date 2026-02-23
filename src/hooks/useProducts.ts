import { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/db";
import {
  refreshProductCache,
  queueInventoryEvent,
  isOnline,
  updateProductPrice,
} from "@/lib/sync";
import { useLiveQuery } from "dexie-react-hooks";

export interface ProductFilters {
  search: string;
  category: string | null;
  stockStatus: "all" | "in-stock" | "low-stock" | "out-of-stock";
}

function normalizeSearchText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompactText(value: string | null | undefined): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
}

export function useProducts(filters: ProductFilters) {
  const [loading, setLoading] = useState(true);

  // Live query from IndexedDB
  const products = useLiveQuery(async () => {
    // Get all products first, then filter
    let results = await db.products.toArray();

    // Apply search filter
    if (filters.search) {
      const searchText = normalizeSearchText(filters.search);
      const searchCompact = normalizeCompactText(filters.search);
      results = results.filter(
        (p) => {
          const nameText = normalizeSearchText(p.name);
          const skuText = normalizeSearchText(p.sku);
          const categoryText = normalizeSearchText(p.category);

          if (
            nameText.includes(searchText) ||
            skuText.includes(searchText) ||
            categoryText.includes(searchText)
          ) {
            return true;
          }

          if (!searchCompact) return false;

          const skuCompact = normalizeCompactText(p.sku);
          return skuCompact.includes(searchCompact);
        },
      );
    }

    // Apply category filter
    if (filters.category) {
      results = results.filter((p) => p.category === filters.category);
    }

    // Apply stock status filter
    if (filters.stockStatus !== "all") {
      results = results.filter((p) => {
        if (filters.stockStatus === "out-of-stock") return p.stock === 0;
        if (filters.stockStatus === "low-stock")
          return p.stock > 0 && p.stock <= 5;
        // "In Stock" should include any available inventory.
        if (filters.stockStatus === "in-stock") return p.stock > 0;
        return true;
      });
    }

    results.sort((a, b) =>
      a.sku.localeCompare(b.sku, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return results;
  }, [filters.search, filters.category, filters.stockStatus]);

  // Get unique categories
  const categories = useLiveQuery(async () => {
    const all = await db.products.toArray();
    const cats = new Set(all.map((p) => p.category).filter(Boolean));
    return Array.from(cats) as string[];
  }, []);

  // Initial data load
  useEffect(() => {
    async function init() {
      setLoading(true);

      // Check if we have cached data
      const count = await db.products.count();

      // If online and no cache or stale, refresh
      if (isOnline() && count === 0) {
        await refreshProductCache();
      }

      setLoading(false);
    }

    init();
  }, []);

  // Actions
  const sellProduct = useCallback(async (productId: string, buyerName?: string) => {
    const note = buyerName?.trim() ? buyerName.trim() : null;
    return queueInventoryEvent(productId, "sale", -1, note);
  }, []);

  const restockProduct = useCallback(
    async (productId: string, qty: number = 1) => {
      return queueInventoryEvent(productId, "restock", qty);
    },
    [],
  );

  const adjustProduct = useCallback(
    async (productId: string, qtyChange: number, note: string) => {
      return queueInventoryEvent(productId, "adjustment", qtyChange, note);
    },
    [],
  );

  const setProductPrice = useCallback(async (productId: string, price: number) => {
    return updateProductPrice(productId, price);
  }, []);

  return {
    products: products || [],
    categories: categories || [],
    loading,
    sellProduct,
    restockProduct,
    adjustProduct,
    setProductPrice,
    refresh: refreshProductCache,
  };
}
