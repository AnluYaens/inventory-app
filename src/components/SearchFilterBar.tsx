import {
  Search,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductFilters } from "@/hooks/useProducts";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface SearchFilterBarProps {
  filters: ProductFilters;
  categories: string[];
  onFiltersChange: (filters: ProductFilters) => void;
}

const stockStatusOptions = [
  { value: "all", label: "Todos" },
  { value: "in-stock", label: "Con stock" },
  { value: "low-stock", label: "Stock bajo" },
  { value: "out-of-stock", label: "Sin stock" },
] as const;

export function SearchFilterBar({
  filters,
  categories,
  onFiltersChange,
}: SearchFilterBarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showStockSection, setShowStockSection] = useState(true);
  const [showCategorySection, setShowCategorySection] = useState(true);
  const filtersPanelId = "inventory-filters-panel";
  const chipsScrollRef = useRef<HTMLDivElement | null>(null);

  const updateFilters = (updates: Partial<ProductFilters>) => {
    onFiltersChange({ ...filters, ...updates });
  };

  const clearFilters = () => {
    onFiltersChange({ search: "", category: null, stockStatus: "all" });
  };

  const hasActiveFilters =
    filters.search || filters.category || filters.stockStatus !== "all";
  const activeCount =
    Number(Boolean(filters.category)) + Number(filters.stockStatus !== "all");

  const scrollFilters = (direction: "left" | "right") => {
    const node = chipsScrollRef.current;
    if (!node) return;
    node.scrollBy({
      left: direction === "left" ? -220 : 220,
      behavior: "smooth",
    });
  };

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar productos o SKU..."
          value={filters.search}
          onChange={(e) => updateFilters({ search: e.target.value })}
          className="search-input pl-10 pr-10"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => updateFilters({ search: "" })}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded-full"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Filters Toggle */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((prev) => !prev)}
          aria-label={showFilters ? "Ocultar filtros" : "Mostrar filtros"}
          aria-expanded={showFilters}
          aria-controls={filtersPanelId}
          className="rounded-full"
        >
          <Filter className="mr-2 h-4 w-4" />
          Filtros
          {activeCount > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>

        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            aria-label="Limpiar filtros"
            className="rounded-full text-xs"
          >
            <X className="h-3 w-3" />
            Limpiar
          </Button>
        )}
      </div>

      {/* Filter Chips Panel */}
      {showFilters && (
        <div
          id={filtersPanelId}
          className="rounded-2xl border border-border bg-card/70 p-2.5 animate-fade-in"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3"
              aria-expanded={showStockSection}
              aria-controls={`${filtersPanelId}-stock`}
              onClick={() => setShowStockSection((prev) => !prev)}
            >
              Stock
              {showStockSection ? (
                <ChevronUp className="ml-1 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-3"
              aria-expanded={showCategorySection}
              aria-controls={`${filtersPanelId}-categories`}
              onClick={() => setShowCategorySection((prev) => !prev)}
            >
              Categorías
              {showCategorySection ? (
                <ChevronUp className="ml-1 h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={() => scrollFilters("left")}
              aria-label="Desplazar filtros a la izquierda"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div
              ref={chipsScrollRef}
              className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 min-w-0 flex-1"
              role="group"
              aria-label="Opciones de filtro de inventario"
              tabIndex={0}
            >
              {showStockSection && (
                <div
                  id={`${filtersPanelId}-stock`}
                  className="contents"
                >
                  {stockStatusOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={filters.stockStatus === option.value}
                      onClick={() => updateFilters({ stockStatus: option.value })}
                      className={cn(
                        "filter-chip whitespace-nowrap",
                        filters.stockStatus === option.value && "filter-chip-active",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}

              {showStockSection && showCategorySection && (
                <div className="w-px h-5 bg-border flex-shrink-0" aria-hidden="true" />
              )}

              {showCategorySection && (
                <div
                  id={`${filtersPanelId}-categories`}
                  className="contents"
                >
                  <button
                    type="button"
                    aria-pressed={!filters.category}
                    onClick={() => updateFilters({ category: null })}
                    className={cn(
                      "filter-chip whitespace-nowrap",
                      !filters.category && "filter-chip-active",
                    )}
                  >
                    Todas las categorías
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={filters.category === cat}
                      onClick={() => updateFilters({ category: cat })}
                      className={cn(
                        "filter-chip whitespace-nowrap",
                        filters.category === cat && "filter-chip-active",
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {!showStockSection && !showCategorySection && (
                <p className="px-2 text-xs text-muted-foreground whitespace-nowrap">
                  Activa Stock o Categorías para mostrar filtros
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={() => scrollFilters("right")}
              aria-label="Desplazar filtros a la derecha"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
