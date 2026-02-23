import type { DateFilter } from "@/hooks/useSalesHistory";
import { cn } from "@/lib/utils";

interface DateFilterBarProps {
  activeFilter: DateFilter;
  onFilterChange: (filter: DateFilter) => void;
}

const filterOptions = [
  { value: "today" as DateFilter, label: "Hoy" },
  { value: "this-week" as DateFilter, label: "Esta semana" },
  { value: "this-month" as DateFilter, label: "Este mes" },
];

export function DateFilterBar({
  activeFilter,
  onFilterChange,
}: DateFilterBarProps) {
  return (
    <div
      className="grid grid-cols-1 gap-2 pb-1 sm:flex sm:flex-wrap sm:items-center"
      role="group"
      aria-label="Filtro de fecha"
    >
      {filterOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={activeFilter === option.value}
          onClick={() => onFilterChange(option.value)}
          className={cn(
            "filter-chip whitespace-nowrap",
            activeFilter === option.value && "filter-chip-active",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
