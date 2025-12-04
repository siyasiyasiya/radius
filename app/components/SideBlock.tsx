export default function SideBlock() {
    return (
      <div className="space-y-6 text-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Region
          </p>
          <p className="text-slate-100 font-medium">
            Powell / West Lafayette, IN
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Only wallets that prove residency here can trade.
          </p>
        </div>
  
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Categories
          </p>
          <ul className="text-xs text-slate-300 space-y-1">
            <li>• Weather & AQI</li>
            <li>• Local economy</li>
            <li>• Transit & infrastructure</li>
            <li>• Referendums & civic events</li>
          </ul>
        </div>
  
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
            Oracle
          </p>
          <p className="text-xs text-slate-300">
            Switchboard weather / gas APIs. Global Polymarket prices shown
            read-only for comparison.
          </p>
        </div>
      </div>
    );
  }
  