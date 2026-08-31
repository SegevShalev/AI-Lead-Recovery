import type { FilterKey } from "../lib/dashboard.js";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lead", label: "Leads" },
  { key: "quote", label: "Quotes" },
  { key: "dormant", label: "Dormant" },
];

interface FilterBarProps {
  active: FilterKey;
  onSelect: (key: FilterKey) => void;
}

export function FilterBar({ active, onSelect }: FilterBarProps) {
  return (
    <div className="filter-bar">
      {FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={`filter-pill${active === filter.key ? " filter-pill--active" : ""}`}
          onClick={() => onSelect(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
