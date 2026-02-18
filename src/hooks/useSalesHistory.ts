import { useCallback, useEffect, useMemo, useState } from "react";
import {
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isOnline } from "@/lib/sync";

export interface SaleEvent {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  productPrice: number;
  qtyChange: number;
  createdAt: string;
}

export type DateFilter = "today" | "this-week" | "this-month" | "custom";

type ProductPreview = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "name" | "sku" | "price"
>;

type SalesQueryRow = Pick<
  Database["public"]["Tables"]["inventory_events"]["Row"],
  "id" | "product_id" | "qty_change" | "created_at"
> & {
  products: ProductPreview | ProductPreview[] | null;
};

export function useSalesHistory(
  dateFilter: DateFilter,
  customRange?: { start: Date; end: Date }
) {
  const [sales, setSales] = useState<SaleEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (dateFilter) {
      case "today":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "this-week":
        return {
          start: startOfWeek(now, { weekStartsOn: 1 }),
          end: endOfDay(now),
        };
      case "this-month":
        return { start: startOfMonth(now), end: endOfDay(now) };
      case "custom":
        return customRange ?? { start: startOfDay(now), end: endOfDay(now) };
    }
  }, [dateFilter, customRange]);

  const fetchSales = useCallback(async () => {
    if (!isOnline()) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("inventory_events")
        .select(
          `
          id,
          product_id,
          qty_change,
          created_at,
          products (
            name,
            sku,
            price
          )
        `
        )
        .eq("type", "sale")
        .eq("status", "applied")
        .gte("created_at", dateRange.start.toISOString())
        .lte("created_at", dateRange.end.toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as SalesQueryRow[];
      const formattedSales: SaleEvent[] = rows.map((row) => {
        const product = Array.isArray(row.products)
          ? row.products[0]
          : row.products;

        return {
          id: row.id,
          productId: row.product_id,
          productName: product?.name ?? "Desconocido",
          productSku: product?.sku ?? "",
          productPrice: Number(product?.price ?? 0),
          qtyChange: row.qty_change,
          createdAt: row.created_at,
        };
      });

      setSales(formattedSales);
    } catch (err) {
      console.error("No se pudo cargar el historial de ventas:", err);
    } finally {
      setLoading(false);
    }
  }, [dateRange.end, dateRange.start]);

  useEffect(() => {
    void fetchSales();
  }, [fetchSales]);

  const voidSale = useCallback(
    async (saleEventId: string, reason?: string) => {
      if (!isOnline()) {
        return { success: false, error: "Sin conexion. Intenta de nuevo en linea." };
      }

      const { error } = await supabase.rpc("admin_void_sale_event", {
        p_event_id: saleEventId,
        // Always send p_reason so PostgREST resolves the intended signature.
        p_reason: reason?.trim() ? reason.trim() : "",
      });

      if (error) {
        if (
          error.message.includes(
            "Could not find the function public.admin_void_sale_event",
          )
        ) {
          return {
            success: false,
            error:
              "Funcion de anulacion no desplegada en Supabase. Ejecuta la migracion 20260217_000005 y recarga el schema.",
          };
        }
        if (error.message.includes('column reference "product_id" is ambiguous')) {
          return {
            success: false,
            error:
              "Funcion de anulacion desactualizada en Supabase. Ejecuta la migracion 20260218_000006 y recarga el schema.",
          };
        }
        return { success: false, error: error.message };
      }

      await fetchSales();
      return { success: true };
    },
    [fetchSales],
  );

  const summary = useMemo(() => {
    const totalItems = sales.reduce((sum, sale) => sum + Math.abs(sale.qtyChange), 0);
    const totalRevenue = sales.reduce(
      (sum, sale) => sum + Math.abs(sale.qtyChange) * sale.productPrice,
      0
    );

    return { totalItems, totalRevenue };
  }, [sales]);

  return { sales, summary, loading, dateRange, refetch: fetchSales, voidSale };
}
