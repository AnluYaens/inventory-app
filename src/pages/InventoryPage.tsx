import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ProductCard } from "@/components/ProductCard";
import { SearchFilterBar } from "@/components/SearchFilterBar";
import { useProducts, type ProductFilters } from "@/hooks/useProducts";
import { Loader2, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSync } from "@/contexts/SyncContext";

export default function InventoryPage() {
  const { refreshCache, isOnline } = useSync();
  const PAGE_SIZE = 50;
  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    category: null,
    stockStatus: "all",
  });
  const [page, setPage] = useState(1);

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

  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return products.slice(start, start + PAGE_SIZE);
  }, [currentPage, products]);

  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalItems);

  return (
    <AppLayout>
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
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
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleProducts.map((product) => (
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                Mostrando {rangeStart}-{rangeEnd} de {totalItems}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  Anterior
                </Button>
                <span className="text-sm text-muted-foreground min-w-24 text-center">
                  Pagina {currentPage} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
