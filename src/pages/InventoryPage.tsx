import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { ProductCard } from "@/components/ProductCard";
import { SearchFilterBar } from "@/components/SearchFilterBar";
import { useProducts, type ProductFilters } from "@/hooks/useProducts";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSync } from "@/contexts/SyncContext";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import {
  exportInventoryToExcel,
  type InventoryExcelRow,
} from "@/lib/exportInventoryExcel";
import { toast } from "sonner";

export default function InventoryPage() {
  const rawCatalogPdfUrl = String(import.meta.env.VITE_CATALOG_PDF_URL ?? "").trim();
  const catalogPdfUrl = rawCatalogPdfUrl || "/catalogo.pdf";
  const { refreshCache, isOnline } = useSync();
  const { role } = useAuth();
  const PAGE_SIZE = 25;
  const [filters, setFilters] = useState<ProductFilters>({
    search: "",
    category: null,
    stockStatus: "all",
  });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const didMountRef = useRef(false);

  const {
    products,
    categories,
    loading,
    sellProduct,
    restockProduct,
    setProductPrice,
  } = useProducts(filters);

  const handleRefresh = async () => {
    if (isOnline) {
      await refreshCache();
    }
  };

  const handleOpenCatalogPdf = () => {
    try {
      const parsed = new URL(catalogPdfUrl, window.location.origin);
      const isSameOriginFile = parsed.origin === window.location.origin;
      const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";

      if (!isHttp) {
        toast.error("URL de catálogo inválida");
        return;
      }

      if (!isSameOriginFile && parsed.protocol !== "https:") {
        toast.error("La URL externa del catálogo debe usar HTTPS");
        return;
      }

      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch {
      toast.error("No se pudo abrir el catálogo PDF");
    }
  };

  const handleExport = async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const allProducts = await db.products.toArray();
      if (allProducts.length === 0) {
        toast.error("No hay productos para exportar");
        return;
      }

      let storeName = "AMEN";
      if (isOnline) {
        const { data: storeData, error: storeError } = await supabase
          .from("store_settings")
          .select("store_name")
          .limit(1)
          .maybeSingle();
        if (!storeError && storeData?.store_name?.trim()) {
          storeName = storeData.store_name.trim();
        }
      }

      const latestSaleByProduct = new Map<
        string,
        { buyer: string; saleDate: string }
      >();

      if (isOnline) {
        const { data: saleRows, error: saleError } = await supabase
          .from("inventory_events")
          .select("product_id, note, created_at")
          .eq("type", "sale")
          .eq("status", "applied")
          .order("created_at", { ascending: false });

        if (!saleError && saleRows) {
          for (const sale of saleRows) {
            if (latestSaleByProduct.has(sale.product_id)) continue;
            const saleDate = new Date(sale.created_at);
            latestSaleByProduct.set(sale.product_id, {
              buyer: sale.note?.trim() || "",
              saleDate: Number.isNaN(saleDate.getTime())
                ? ""
                : saleDate.toLocaleDateString("es-ES"),
            });
          }
        }
      }

      const rows: InventoryExcelRow[] = allProducts.map((product) => {
        const quantity = Math.max(0, Number(product.stock) || 0);
        const unitCostEur = Number(product.cost ?? 0);
        const totalCostEur = Number((unitCostEur * quantity).toFixed(2));
        const finalPrice = Number(Number(product.price ?? 0).toFixed(2));
        const lastSale = latestSaleByProduct.get(product.id);

        return {
          storeName,
          sku: product.sku || "-",
          description: product.name || "-",
          category: product.category?.trim() || "-",
          size: product.size?.trim() || "-",
          color: product.color?.trim() || "",
          quantity,
          unitCostEur,
          totalCostEur,
          finalPrice,
          buyer: lastSale?.buyer || "",
          saleDate: lastSale?.saleDate || "",
        };
      });

      exportInventoryToExcel(rows);
      toast.success(`Excel exportado (${rows.length} productos)`);
    } catch (error) {
      console.error("No se pudo exportar inventario:", error);
      toast.error("No se pudo exportar a Excel");
    } finally {
      setExporting(false);
    }
  };

  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage]);

  const visibleProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return products.slice(start, start + PAGE_SIZE);
  }, [currentPage, products]);

  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalItems);
  const canManageInventory = role === "admin";

  return (
    <AppLayout>
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Inventario</h1>
            <p className="text-sm text-muted-foreground">
              {products.length} producto{products.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenCatalogPdf}
              title={`Abrir catálogo PDF (${catalogPdfUrl})`}
            >
              <FileText className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Catálogo PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
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
            <Button
              size="sm"
              onClick={() => void handleExport()}
              disabled={loading || exporting}
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {exporting ? "Exportando..." : "Exportar Excel"}
            </Button>
          </div>
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
                  canManage={canManageInventory}
                  onSell={(buyerName) => sellProduct(product.id, buyerName)}
                  onRestock={(qty) => restockProduct(product.id, qty)}
                  onUpdatePrice={(price) => setProductPrice(product.id, price)}
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
