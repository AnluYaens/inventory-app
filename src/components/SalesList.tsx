import type { SaleEvent } from "@/hooks/useSalesHistory";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SalesListProps {
  sales: SaleEvent[];
  currency?: string;
  canVoid?: boolean;
  canDelete?: boolean;
  onVoidSale?: (
    sale: SaleEvent,
    reason?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteSale?: (
    sale: SaleEvent,
    reason?: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

export function SalesList({
  sales,
  currency = "USD",
  canVoid = false,
  canDelete = false,
  onVoidSale,
  onDeleteSale,
}: SalesListProps) {
  const [processingSaleId, setProcessingSaleId] = useState<string | null>(null);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-US", {
      style: "currency",
      currency,
    }).format(amount);
  };

  const handleVoidSale = async (sale: SaleEvent) => {
    if (!canVoid || !onVoidSale) return;

    const confirmed = window.confirm(
      "Esta accion anulara la venta y restaurara el stock. Deseas continuar?",
    );
    if (!confirmed) return;

    const reasonInput = window.prompt("Motivo (opcional):", "") ?? "";

    setProcessingSaleId(sale.id);
    try {
      await onVoidSale(sale, reasonInput);
    } finally {
      setProcessingSaleId(null);
    }
  };

  const handleDeleteSale = async (sale: SaleEvent) => {
    if (!canDelete || !onDeleteSale) return;

    const confirmed = window.confirm(
      "Esta accion borrara la venta del historial y NO restaurara stock. Deseas continuar?",
    );
    if (!confirmed) return;

    const reasonInput = window.prompt("Motivo (opcional):", "") ?? "";

    setProcessingSaleId(sale.id);
    try {
      await onDeleteSale(sale, reasonInput);
    } finally {
      setProcessingSaleId(null);
    }
  };

  if (sales.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No hay ventas en este periodo</p>
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
            {format(new Date(date), "EEEE, d MMMM", { locale: es })}
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
                      {format(new Date(sale.createdAt), "h:mm a", {
                        locale: es,
                      })}{" "}
                      ·{" "}
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
                    Cantidad: {Math.abs(sale.qtyChange)}
                  </p>
                  <div className="mt-2 flex flex-col gap-2 items-end">
                    {canVoid && onVoidSale && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleVoidSale(sale)}
                        disabled={processingSaleId === sale.id}
                      >
                        {processingSaleId === sale.id ? "Procesando..." : "Anular venta"}
                      </Button>
                    )}
                    {canDelete && onDeleteSale && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteSale(sale)}
                        disabled={processingSaleId === sale.id}
                      >
                        {processingSaleId === sale.id
                          ? "Procesando..."
                          : "Borrar venta"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
