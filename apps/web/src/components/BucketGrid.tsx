import type { BucketSummary, FilterKey } from "../lib/dashboard.js";
import { formatMoney } from "../lib/format.js";

interface BucketGridProps {
  buckets: BucketSummary[];
  activeFilter: FilterKey;
  onToggle: (key: BucketSummary["key"]) => void;
}

export function BucketGrid({ buckets, activeFilter, onToggle }: BucketGridProps) {
  return (
    <div className="buckets">
      {buckets.map((bucket) => (
        <button
          key={bucket.key}
          type="button"
          className={`bucket${activeFilter === bucket.key ? " bucket--active" : ""}`}
          onClick={() => onToggle(bucket.key)}
        >
          <div className="bucket__head">
            <div className="bucket__title">{bucket.title}</div>
            <div className="bucket__count">
              {bucket.count} {bucket.count === 1 ? "customer" : "customers"}
            </div>
          </div>
          <div className="bucket__amount">{formatMoney(bucket.amount)}</div>
          <div className="bucket__bar">
            <div
              className="bucket__bar-fill"
              style={{ width: `${bucket.fillPercent}%`, background: bucket.barColor }}
            />
          </div>
          <div className="bucket__note">{bucket.note}</div>
        </button>
      ))}
    </div>
  );
}
