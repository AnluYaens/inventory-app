import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SalesSummary } from "@/components/SalesSummary";
import { SalesList } from "@/components/SalesList";
import { DateFilterBar } from "@/components/DateFilterBar";
import { useSalesHistory, type DateFilter } from "@/hooks/useSalesHistory";
import { Loader2, ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import { useSync } from "@/contexts/SyncContext";

export default function SoldPage() {
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const { sales, summary, loading, dateRange } = useSalesHistory(dateFilter);
  const { isOnline } = useSync();

  return (
    <AppLayout>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold">Sales</h1>
          <p className="text-sm text-muted-foreground">
            {format(dateRange.start, "MMM d")} -{" "}
            {format(dateRange.end, "MMM d, yyyy")}
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
            <h3 className="font-medium mb-1">Offline Mode</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Sales history requires an internet connection
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Loading sales...</p>
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
              <h2 className="font-semibold mb-3">Transactions</h2>
              <SalesList sales={sales} />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
