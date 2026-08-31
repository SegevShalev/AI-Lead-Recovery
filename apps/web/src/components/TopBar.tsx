interface TopBarProps {
  businessName: string;
  syncedAgo: string;
}

export function TopBar({ businessName, syncedAgo }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <div className="topbar__logo">R</div>
        <div className="topbar__title">Lead Recovery</div>
        <div className="topbar__divider" />
        <div className="topbar__business">{businessName}</div>
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
