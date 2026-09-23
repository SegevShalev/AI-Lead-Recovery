export type View = "recovery" | "knowledge";

const VIEW_LABEL: Record<View, string> = {
  recovery: "Recovery",
  knowledge: "Business knowledge",
};

interface TopBarProps {
  businessName: string;
  syncedAgo: string;
  /** Tabs are only shown once there's a business to switch views for. */
  view?: View;
  onViewChange?: (view: View) => void;
}

export function TopBar({ businessName, syncedAgo, view, onViewChange }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="topbar__logo">R</div>
        <div className="topbar__title">Lead Recovery</div>
        <div className="topbar__divider" />
        <div className="topbar__business">{businessName}</div>
        {view && onViewChange ? (
          <nav className="topbar__tabs" aria-label="Sections">
            {(Object.keys(VIEW_LABEL) as View[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`topbar__tab${key === view ? " topbar__tab--active" : ""}`}
                aria-current={key === view ? "page" : undefined}
                onClick={() => onViewChange(key)}
              >
                {VIEW_LABEL[key]}
              </button>
            ))}
          </nav>
        ) : null}
      </div>
      <div className="topbar__right">
        <div className="topbar__status">
          <span className="topbar__dot" />
          WhatsApp Business connected · synced {syncedAgo}
        </div>
        <div className="topbar__avatar">DM</div>
      </div>
    </header>
  );
}
