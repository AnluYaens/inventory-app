import { DollarSign, Package } from "lucide-react";

interface SalesSummaryProps {
  totalRevenue: number;
  totalItems: number;
  currency?: string;
}

export function SalesSummary({
  totalRevenue,
  totalItems,
  currency = "USD",
}: SalesSummaryProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="summary-card">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            Revenue
          </span>
        </div>
        <p className="text-2xl font-bold gradient-text">
          {formatCurrency(totalRevenue)}
        </p>
      </div>

      <div className="summary-card">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            Items Sold
          </span>
        </div>
        <p className="text-2xl font-bold">{totalItems}</p>
      </div>
    </div>
  );
}
