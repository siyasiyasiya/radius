type Props = {
    tvl: number; // current TVL in USDC
  };
  
  export default function VolumeBlock({ tvl }: Props) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          TVL
        </div>
        <div className="text-sm font-semibold text-emerald-400 mt-1">
          ${tvl.toLocaleString()}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          Total value locked in this local market.
        </p>
      </div>
    );
  }
  