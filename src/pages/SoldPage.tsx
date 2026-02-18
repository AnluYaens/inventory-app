import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SalesSummary } from "@/components/SalesSummary";
import { SalesList } from "@/components/SalesList";
import { DateFilterBar } from "@/components/DateFilterBar";
import { useSalesHistory, type DateFilter } from "@/hooks/useSalesHistory";
import { Loader2, ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useSync } from "@/contexts/SyncContext";
import { useAuth } from "@/contexts/AuthContext";
import type { SaleEvent } from "@/hooks/useSalesHistory";
import { toast } from "sonner";

export default function SoldPage() {
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const { sales, summary, loading, dateRange, voidSale, deleteSale } =
    useSalesHistory(dateFilter);
  const { isOnline } = useSync();
  const { role } = useAuth();
  const canVoidSales = role === "admin";

  const handleVoidSale = async (sale: SaleEvent, reason?: string) => {
    const result = await voidSale(sale.id, reason);
    if (!result.success) {
      toast.error(result.error || "No se pudo anular la venta");
      return result;
    }

    toast.success("Venta anulada y stock restaurado");
    return result;
  };

  const handleDeleteSale = async (sale: SaleEvent, reason?: string) => {
    const result = await deleteSale(sale.id, reason);
    if (!result.success) {
      toast.error(result.error || "No se pudo borrar la venta");
      return result;
    }

    toast.success("Venta borrada sin modificar stock");
    return result;
  };

  return (
    <AppLayout>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            {format(dateRange.start, "d MMM", { locale: es })} -{" "}
            {format(dateRange.end, "d MMM, yyyy", { locale: es })}
          </p>
        </div>

        {/* Date Filter */}
        <DateFilterBar
          activeFilter={dateFilter}
          onFilterChange={setDateFilter}
        />

        {!isOnline ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4 mx-auto">
              <ShoppingBag className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium mb-1">Modo sin conexion</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              El historial de ventas requiere internet
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Cargando ventas...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <SalesSummary
              totalRevenue={summary.totalRevenue}
              totalItems={summary.totalItems}
            />

            {/* Sales List */}
            <div className="mt-6">
              <h2 className="font-semibold mb-3">Transacciones</h2>
              {!canVoidSales && (
                <p className="text-xs text-muted-foreground mb-3">
                  Solo administradores pueden anular o borrar ventas.
                </p>
              )}
              <SalesList
                sales={sales}
                canVoid={canVoidSales}
                onVoidSale={handleVoidSale}
                canDelete={canVoidSales}
                onDeleteSale={handleDeleteSale}
              />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
