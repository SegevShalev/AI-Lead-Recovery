import { formatMoney } from "../lib/format.js";

interface HeroProps {
  total: number;
  openCount: number;
  recoveredTotal: number;
  replyRate: string;
  topFiveValue: number;
  onRecoverTop: () => void;
}

export function Hero({
  total,
  openCount,
  recoveredTotal,
  replyRate,
  topFiveValue,
  onRecoverTop,
}: HeroProps) {
  return (
    <section className="hero">
      <div className="hero__main">
        <div className="hero__label">Potential recoverable revenue</div>
        <div className="hero__total">{formatMoney(total)}</div>
        <div className="hero__desc">
          Sitting in <strong>{openCount} conversations</strong> that went quiet in the last 90 days.
          Most of it is one message away.
        </div>
      </div>
      <div className="hero__side">
        <div className="hero__stats">
          <div>
            <div className="hero__stat-value">{formatMoney(recoveredTotal)}</div>
            <div className="hero__stat-label">Recovered this month</div>
          </div>
          <div className="hero__stat-divider" />
          <div>
            <div className="hero__stat-value">{replyRate}</div>
            <div className="hero__stat-label">Reply rate on follow-ups</div>
          </div>
        </div>
        <button type="button" className="hero__cta" onClick={onRecoverTop}>
          Recover the top 5 → {formatMoney(topFiveValue)}
        </button>
      </div>
    </section>
  );
}
