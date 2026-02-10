import type { DateFilter } from "@/hooks/useSalesHistory";
import { cn } from "@/lib/utils";

interface DateFilterBarProps {
  activeFilter: DateFilter;
  onFilterChange: (filter: DateFilter) => void;
}

const filterOptions = [
  { value: "today" as DateFilter, label: "Today" },
  { value: "this-week" as DateFilter, label: "This Week" },
  { value: "this-month" as DateFilter, label: "This Month" },
];

export function DateFilterBar({
  activeFilter,
  onFilterChange,
}: DateFilterBarProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
      {filterOptions.map((option) => (
        <button
          key={option.value}
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
