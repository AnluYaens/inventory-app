import type { SaleEvent } from "@/hooks/useSalesHistory";
import { format } from "date-fns";

interface SalesListProps {
  sales: SaleEvent[];
  currency?: string;
}

export function SalesList({ sales, currency = "USD" }: SalesListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  if (sales.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No sales in this period</p>
      </div>
    );
  }

  // Group sales by date
  const groupedSales = sales.reduce(
    (acc, sale) => {
      const date = format(new Date(sale.createdAt), "yyyy-MM-dd");
      if (!acc[date]) acc[date] = [];
      acc[date].push(sale);
      return acc;
    },
    {} as Record<string, SaleEvent[]>,
  );

  return (
    <div className="space-y-6">
      {Object.entries(groupedSales).map(([date, daySales]) => (
        <div key={date}>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            {format(new Date(date), "EEEE, MMMM d")}
          </h3>
          <div className="space-y-2">
            {daySales.map((sale) => (
              <div
                key={sale.id}
                className="bg-card rounded-xl border border-border p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="text-lg">📦</span>
                  </div>
                  <div>
                    <p className="font-medium text-sm">{sale.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(sale.createdAt), "h:mm a")} ·{" "}
                      {sale.productSku}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm text-primary">
                    {formatCurrency(
                      Math.abs(sale.qtyChange) * sale.productPrice,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Qty: {Math.abs(sale.qtyChange)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
