import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ProductCard } from "@/components/ProductCard";
import { SearchFilterBar } from "@/components/SearchFilterBar";
import { useProducts, type ProductFilters } from "@/hooks/useProducts";
import { Loader2, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSync } from "@/contexts/SyncContext";

export default function InventoryPage() {
  const { refreshCache, isOnline } = useSync();
  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    category: null,
    stockStatus: "all",
  });

  const {
    products,
    categories,
    loading,
    sellProduct,
    restockProduct,
    adjustProduct,
  } = useProducts(filters);

  const handleRefresh = async () => {
    if (isOnline) {
      await refreshCache();
    }
  };

  return (
    <AppLayout>
      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Inventario</h1>
            <p className="text-sm text-muted-foreground">
              {products.length} producto{products.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={!isOnline || loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Actualizar
          </Button>
        </div>

        {/* Search & Filters */}
        <SearchFilterBar
          filters={filters}
          categories={categories}
          onFiltersChange={setFilters}
        />

        {/* Product List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">
              Cargando inventario...
            </p>
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium mb-1">No se encontraron productos</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {filters.search ||
              filters.category ||
              filters.stockStatus !== "all"
                ? "Prueba ajustando los filtros"
                : "Agrega productos para comenzar"}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onSell={() => sellProduct(product.id)}
                onRestock={(qty) => restockProduct(product.id, qty)}
                onAdjust={(qtyChange, note) =>
                  adjustProduct(product.id, qtyChange, note)
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
