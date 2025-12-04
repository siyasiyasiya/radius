"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import SideBlock from "./components/SideBlock";
import SpreadBlock from "./components/SpreadBlock";
import VolumeBlock from "./components/VolumeBlock";
import TVLSparkline from "./components/TVLSparkline";

type TVLPoint = { value: number };

type Market = {
  id: number;
  title: string;
  yes: number;
  no: number;
  tvl: TVLPoint[];
};

export default function Page() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const markets: Market[] = [
    {
      id: 1,
      title: "Will Powell HS win the state championship?",
      yes: 0.42,
      no: 0.58,
      tvl: [{ value: 3000 }, { value: 4800 }, { value: 6400 }],
    },
    {
      id: 2,
      title: "Will AQI in West Lafayette exceed 120 tomorrow?",
      yes: 0.35,
      no: 0.65,
      tvl: [{ value: 1800 }, { value: 2600 }, { value: 3200 }],
    },
    {
      id: 3,
      title: "Will gas in Powell hit $4.00/gal by Sept 30?",
      yes: 0.28,
      no: 0.72,
      tvl: [{ value: 2200 }, { value: 2800 }, { value: 3600 }],
    },
  ];

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50">
      {/* LEFT RAIL */}
      <aside className="hidden md:flex md:w-72 bg-slate-900 border-r border-slate-800 p-6 flex-col gap-8">
        <h1 className="text-2xl font-bold tracking-tight">Radius</h1>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          Local prediction markets
        </p>
        <SideBlock />
      </aside>

      {/* MAIN AREA */}
      <main className="flex-1 p-6 md:p-10 space-y-8">
        {/* Top header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
              Powell / West Lafayette
            </h2>
            <p className="text-sm text-slate-400">
              Connect wallet and verify location to trade these markets.
            </p>
          </div>

          {/* Only render on client to avoid hydration mismatch */}
          {mounted && <WalletMultiButton />}
        </div>

        {/* Markets list */}
        <div className="space-y-5">
          {markets.map((m) => (
            <section
              key={m.id}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 flex flex-col gap-4"
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">
                    #{m.id.toString().padStart(2, "0")} • Local vs global
                    probability
                  </p>
                  <h3 className="text-base md:text-lg font-medium">
                    {m.title}
                  </h3>
                </div>

                <button className="shrink-0 px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-sm font-semibold">
                  Trade
                </button>
              </div>

              {/* Numbers row */}
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
                {/* YES / NO & sparkline */}
                <div className="flex flex-col gap-4">
                  <div className="flex gap-6">
                    <div>
                      <div className="text-[11px] uppercase text-slate-500">
                        Yes
                      </div>
                      <div className="text-lg font-semibold text-emerald-400">
                        {(m.yes * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-slate-500">
                        No
                      </div>
                      <div className="text-lg font-semibold text-rose-400">
                        {(m.no * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div className="h-12">
                    <TVLSparkline data={m.tvl} />
                  </div>
                </div>

                {/* Spread + TVL cards */}
                <div className="grid grid-cols-2 gap-3">
                  <SpreadBlock yes={m.yes} no={m.no} />
                  <VolumeBlock tvl={m.tvl[m.tvl.length - 1].value} />
                </div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
