type Tab = "drafts" | "leads" | "table" | "inbox" | "bulk-email" | "quotations" | "compliance";

type NavItem =
  | { id: Tab; label: string; count: number; alert?: boolean; external?: undefined }
  | { id: "quotation-agent"; label: string; count: number; external: string };

interface AppSidebarProps {
  navItems: NavItem[];
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onRefresh: () => void;
}

export function AppSidebar({ navItems, activeTab, onSelectTab, onRefresh }: AppSidebarProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col sticky top-0 h-screen">
      <div className="px-5 py-6 border-b border-slate-800">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Sales Agent</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-100">
          <span className="text-slate-500 font-normal">by </span>Izaan Bin Mujeeb
        </h1>
        <p className="mt-2 text-xs text-slate-500 leading-relaxed">Kafi Commodities</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = !("external" in item) && activeTab === item.id;
          const hasAlert = !("external" in item) && Boolean(item.alert);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if ("external" in item) {
                  window.open(item.external, "_blank", "noopener,noreferrer");
                  return;
                }
                onSelectTab(item.id);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition ${
                isActive
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-900/30"
                  : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                {hasAlert && (
                  <span
                    aria-label="new messages"
                    className={`shrink-0 ${isActive ? "text-white" : "text-emerald-400"} animate-pulse`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5-1.6-1.6V10a5.4 5.4 0 0 0-4-5.23V4a1.4 1.4 0 0 0-2.8 0v.77A5.4 5.4 0 0 0 6.6 10v5.4L5 17a.9.9 0 0 0 .64 1.54h12.72A.9.9 0 0 0 19 17Z" />
                    </svg>
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </span>
              {"external" in item ? (
                <span className="shrink-0 text-xs opacity-70">↗</span>
              ) : (
                <span
                  className={`shrink-0 text-xs tabular-nums px-1.5 py-0.5 rounded ${
                    hasAlert && !isActive
                      ? "bg-emerald-500/20 text-emerald-300"
                      : isActive
                        ? "bg-emerald-500/30 text-emerald-50"
                        : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800">
        <button
          type="button"
          onClick={onRefresh}
          className="w-full text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300"
        >
          Refresh
        </button>
      </div>
    </aside>
  );
}
