import { Search, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductFilters } from "@/hooks/useProducts";
import { useState } from "react";
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
            onClick={() => updateFilters({ search: "" })}
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
            className="rounded-full text-xs"
          >
            <X className="h-3 w-3" />
            Limpiar
          </Button>
        )}
      </div>

      {/* Filter Chips Panel */}
      {showFilters && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 animate-fade-in">
          {/* Stock Status Filters */}
          {stockStatusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => updateFilters({ stockStatus: option.value })}
              className={cn(
                "filter-chip whitespace-nowrap",
                filters.stockStatus === option.value && "filter-chip-active",
              )}
            >
              {option.label}
            </button>
          ))}

          <div className="w-px h-5 bg-border flex-shrink-0" />

          {/* Category Filters */}
          <button
            onClick={() => updateFilters({ category: null })}
            className={cn(
              "filter-chip whitespace-nowrap",
              !filters.category && "filter-chip-active",
            )}
          >
            Todas las categorias
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
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
    </div>
  );
}
