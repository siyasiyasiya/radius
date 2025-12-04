type Props = {
    yes: number;
    no: number;
  };
  
  export default function SpreadBlock({ yes, no }: Props) {
    const spreadBp = Math.round(Math.abs(yes - no) * 10000); // 0.42 → 4200bp
  
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">
          Spread
        </div>
        <div className="text-sm font-semibold text-sky-400 mt-1">
          {spreadBp} bp
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          Difference between local YES and NO prices.
        </p>
      </div>
    );
  }
  