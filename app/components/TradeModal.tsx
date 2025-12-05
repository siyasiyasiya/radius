"use client";

import { useState } from "react";

type Market = {
  id: string;
  title: string;
  status: any;
  resolved: boolean;
  outcome: number;
  closeTime: number;
  yesPrice: number;
  noPrice: number;
};

type Props = {
  open: boolean;
  market: Market;
  defaultSide: "yes" | "no";
  onClose: () => void;
  onSubmit: (params: {
    side: "yes" | "no";
    amount: number;
    slippageBps: number;
  }) => Promise<void>;
  isSubmitting: boolean;
};

export default function TradeModal({
  open,
  market,
  defaultSide,
  onClose,
  onSubmit,
  isSubmitting,
}: Props) {
  const [side, setSide] = useState<"yes" | "no">(defaultSide);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100); // 1% default

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    await onSubmit({ side, amount: parsedAmount, slippageBps });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 text-xl"
        >
          ✕
        </button>

        <h2 className="text-xl font-bold mb-2">Trade</h2>
        <p className="text-sm text-slate-400 mb-6 line-clamp-2">{market.title}</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Side Selection */}
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 mb-2 block">
              Position
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSide("yes")}
                className={`py-3 rounded-lg font-semibold transition-colors ${
                  side === "yes"
                    ? "bg-emerald-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                YES
              </button>
              <button
                type="button"
                onClick={() => setSide("no")}
                className={`py-3 rounded-lg font-semibold transition-colors ${
                  side === "no"
                    ? "bg-rose-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                NO
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 mb-2 block">
              Amount (USDC)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          {/* Price & Returns Info */}
          {amount && parseFloat(amount) > 0 && (
            <div className="bg-slate-800/50 rounded-lg p-4 space-y-2 border border-slate-700">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Current Price</span>
                <span className="font-medium">
                  {((side === "yes" ? market.yesPrice : market.noPrice) * 100).toFixed(0)}¢ per share
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Shares you'll get</span>
                <span className="font-medium">
                  ~{(parseFloat(amount) / (side === "yes" ? market.yesPrice : market.noPrice)).toFixed(2)}
                </span>
              </div>
              <div className="border-t border-slate-700 my-2"></div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Potential Return (if {side.toUpperCase()} wins)</span>
                <span className={`font-bold ${side === "yes" ? "text-emerald-400" : "text-red-400"}`}>
                  ${(parseFloat(amount) / (side === "yes" ? market.yesPrice : market.noPrice)).toFixed(2)}
                  <span className="text-slate-500 font-normal ml-1">
                    (+{(((1 / (side === "yes" ? market.yesPrice : market.noPrice)) - 1) * 100).toFixed(0)}%)
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Slippage */}
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 mb-2 block">
              Slippage Tolerance
            </label>
            <div className="flex gap-2">
              {[50, 100, 200, 500].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    slippageBps === bps
                      ? "bg-sky-500 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting || !amount}
            className={`w-full py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              side === "yes" 
                ? "bg-emerald-500 hover:bg-emerald-400" 
                : "bg-red-500 hover:bg-red-400"
            }`}
          >
            {isSubmitting ? "Submitting..." : `Buy ${side.toUpperCase()} @ ${((side === "yes" ? market.yesPrice : market.noPrice) * 100).toFixed(0)}¢`}
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center mt-4">
          Market: {market.id.slice(0, 8)}...{market.id.slice(-4)}
        </p>
      </div>
    </div>
  );
}
