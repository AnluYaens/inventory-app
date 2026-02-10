import { useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    async function fetchSales() {
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
            productName: product?.name ?? "Unknown",
            productSku: product?.sku ?? "",
            productPrice: Number(product?.price ?? 0),
            qtyChange: row.qty_change,
            createdAt: row.created_at,
          };
        });

        setSales(formattedSales);
      } catch (err) {
        console.error("Failed to fetch sales:", err);
      } finally {
        setLoading(false);
      }
    }

    void fetchSales();
  }, [dateRange]);

  const summary = useMemo(() => {
    const totalItems = sales.reduce((sum, sale) => sum + Math.abs(sale.qtyChange), 0);
    const totalRevenue = sales.reduce(
      (sum, sale) => sum + Math.abs(sale.qtyChange) * sale.productPrice,
      0
    );

    return { totalItems, totalRevenue };
  }, [sales]);

  return { sales, summary, loading, dateRange };
}
