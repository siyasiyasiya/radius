"use client";

import { useEffect, useMemo, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import Script from "next/script";
import { Connection, PublicKey } from "@solana/web3.js";

import SideBlock from "./components/SideBlock";
import SpreadBlock from "./components/SpreadBlock";
import VolumeBlock from "./components/VolumeBlock";
import TVLSparkline from "./components/TVLSparkline";
import { proveLocation } from "../lib/zkProver";
import TradeModal from "./components/TradeModal";
import {
  AnchorWallet,
  fetchMarkets,
  placeOrderOnChain,
} from "../lib/hyperlocalClient";
import { submitLocationProof } from "../lib/zkLocationClient";

type TVLPoint = { value: number };

type Market = {
  id: string;
  title: string;
  status: any;
  resolved: boolean;
  outcome: number;
  closeTime: number;
};

const REGIONS = {
  "west-lafayette": {
    name: "West Lafayette, IN",
    minLat: 40.4,
    maxLat: 40.5,
    minLon: -86.95,
    maxLon: -86.85,
  },
  powell: {
    name: "Powell, OH",
    minLat: 40.13,
    maxLat: 40.23,
    minLon: -83.1,
    maxLon: -83.0,
  },
};

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [locationProof, setLocationProof] = useState<any>(null);
  const [detectedRegion, setDetectedRegion] = useState<any>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProvingLocation, setIsProvingLocation] = useState(false);
  const [userStatePda, setUserStatePda] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const wallet = useWallet();
  const connection = useMemo(
    () => new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed"),
    []
  );

  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [defaultSide, setDefaultSide] = useState<"yes" | "no">("yes");
  const [isSubmittingTrade, setIsSubmittingTrade] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (wallet.connected && !detectedRegion) {
      detectLocation();
    }
    if (wallet.connected) {
      loadMarkets();
    }
  }, [wallet.connected]);

  const loadMarkets = async () => {
    if (!wallet.publicKey) return;
    try {
      const mks = await fetchMarkets(connection, wallet as AnchorWallet);
      setMarkets(
        mks.map((m) => ({
          id: m.publicKey.toBase58(),
          title: m.question,
          status: m.status,
          resolved: m.resolved,
          outcome: m.outcome,
          closeTime: m.closeTime,
        }))
      );
    } catch (e) {
      console.error("Failed to fetch markets", e);
    }
  };

  const detectLocation = async () => {
    setIsDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const { latitude, longitude } = position.coords;

      let foundRegion: any = null;

      for (const [regionId, bounds] of Object.entries(REGIONS)) {
        if (
          latitude >= bounds.minLat &&
          latitude <= bounds.maxLat &&
          longitude >= bounds.minLon &&
          longitude <= bounds.maxLon
        ) {
          foundRegion = {
            id: regionId,
            ...bounds,
            userLat: latitude,
            userLon: longitude,
          };
          break;
        }
      }

      if (foundRegion) {
        setDetectedRegion(foundRegion);
      } else {
        setDetectedRegion({
          id: "west-lafayette",
          ...REGIONS["west-lafayette"],
          userLat: 40.45,
          userLon: -86.9,
        });
      }
    } catch (error) {
      console.error("Location detection failed:", error);
      setDetectedRegion({
        id: "west-lafayette",
        ...REGIONS["west-lafayette"],
        userLat: 40.45,
        userLon: -86.9,
      });
    }
    setIsDetecting(false);
  };

  const generateZKProof = async () => {
    if (!detectedRegion) return;

    setIsProvingLocation(true);
    try {
      const salt = Math.floor(Math.random() * 1_000_000);
      const proof = await proveLocation({
        userLat: detectedRegion.userLat,
        userLon: detectedRegion.userLon,
        minLat: detectedRegion.minLat,
        maxLat: detectedRegion.maxLat,
        minLon: detectedRegion.minLon,
        maxLon: detectedRegion.maxLon,
        salt,
      });

      setLocationProof({
        region: detectedRegion.id,
        proof: proof.proofPacked,
        publicInputs: proof.publicInputsPacked,
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      });

      if (!wallet.publicKey) throw new Error("Wallet not connected");
      const submitRes = await submitLocationProof(
        wallet,
        proof.proofPacked,
        proof.publicInputsPacked
      );
      setUserStatePda(submitRes.userStatePda.toBase58());
    } catch (error) {
      console.error("ZK proof generation failed:", error);
      alert("Proof generation failed. Check console for details.");
    }
    setIsProvingLocation(false);
  };

  const handleSubmitTrade = async ({
    side,
    amount,
    slippageBps,
  }: {
    side: "yes" | "no";
    amount: number;
    slippageBps: number;
  }) => {
    if (!selectedMarket || !wallet.publicKey || !userStatePda) return;

    try {
      setIsSubmittingTrade(true);

      const lamports = Math.round(amount * 1_000_000); // USDC 6 decimals

      const sig = await placeOrderOnChain({
        connection,
        wallet: wallet as AnchorWallet,
        market: new PublicKey(selectedMarket.id),
        userLocation: new PublicKey(userStatePda),
        amount: lamports,
        side,
        minSharesOut: 0,
      });

      console.log("Trade sent, tx:", sig);
      alert(`Trade submitted: ${sig}`);

      setSelectedMarket(null);
    } catch (err) {
      console.error("Trade failed", err);
      alert("Trade failed. See console for details.");
    } finally {
      setIsSubmittingTrade(false);
    }
  };

  const filteredMarkets = markets;

  return (
    <>
      <Script src="/zk/snarkjs.min.js" strategy="beforeInteractive" />

      <div className="flex min-h-screen bg-slate-950 text-slate-50">
        <aside className="hidden md:flex md:w-72 bg-slate-900 border-r border-slate-800 p-6 flex-col gap-8">
          <h1 className="text-2xl font-bold tracking-tight">Radius</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Local prediction markets
          </p>

          {locationProof && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-xs text-emerald-400 font-semibold mb-1">
                ✓ Location Verified
              </p>
              <p className="text-xs text-slate-400">
                {
                  REGIONS[
                    locationProof.region as keyof typeof REGIONS
                  ]?.name
                }
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                Valid until{" "}
                {new Date(locationProof.validUntil).toLocaleString()}
              </p>
            </div>
          )}

          <SideBlock />
        </aside>

        <main className="flex-1 p-6 md:p-10 space-y-8">
          {!wallet.connected && (
            <div className="text-center py-20">
              <h2 className="text-3xl font-bold mb-4">Connect Your Wallet</h2>
              <p className="text-slate-400 mb-8">
                Connect to start trading on local markets
              </p>
              {mounted && <WalletMultiButton />}
            </div>
          )}

          {wallet.connected && !locationProof && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">
                  Verify Your Location
                </h2>
                <p className="text-slate-400 mb-6">
                  Generate a zero knowledge proof that you are in{" "}
                  {detectedRegion
                    ? REGIONS[
                        detectedRegion.id as keyof typeof REGIONS
                      ]?.name
                    : "a supported region"}{" "}
                  without revealing your exact address.
                </p>

                {!detectedRegion ? (
                  <button
                    onClick={detectLocation}
                    disabled={isDetecting}
                    className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 font-semibold"
                  >
                    {isDetecting
                      ? "Detecting Location..."
                      : "Detect My Location"}
                  </button>
                ) : (
                  <div>
                    <div className="bg-sky-500/20 border border-sky-400 rounded-lg p-4 mb-6">
                      <p className="font-semibold mb-1">Location Detected</p>
                      <p className="text-sm text-slate-300">
                        {
                          REGIONS[
                            detectedRegion.id as keyof typeof REGIONS
                          ]?.name
                        }
                      </p>
                    </div>
                    <button
                      onClick={generateZKProof}
                      disabled={isProvingLocation}
                      className="px-6 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 font-semibold"
                    >
                      {isProvingLocation
                        ? "Generating Proof... (this may take 10-30 seconds)"
                        : "Generate ZK Proof"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {locationProof && (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
                    {
                      REGIONS[
                        locationProof.region as keyof typeof REGIONS
                      ]?.name
                    }
                  </h2>
                  <p className="text-sm text-slate-400">
                    {filteredMarkets.length} local markets available
                  </p>
                </div>

                {mounted && <WalletMultiButton />}
              </div>

              <div className="space-y-5">
                {filteredMarkets.map((m) => (
                  <section
                    key={m.id}
                    className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 md:p-6 flex flex-col gap-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          #{m.id.toString().padStart(2, "0")} • Local only
                        </p>
                        <h3 className="text-base md:text-lg font-medium">
                          {m.title}
                        </h3>
                      </div>

                      <button
                        className="shrink-0 px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-sm font-semibold"
                        onClick={() => {
                          setSelectedMarket(m);
                          setDefaultSide("yes");
                        }}
                      >
                        Trade
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
                      <div className="flex flex-col gap-4">
                        <div className="text-sm text-slate-400">
                          Status:{" "}
                          {("open" in (m.status as any) && "Open") ||
                            ("disputed" in (m.status as any) && "Disputed") ||
                            ("resolved" in (m.status as any) && "Resolved")}
                        </div>
                        <div className="text-sm text-slate-400">
                          Outcome:{" "}
                          {m.resolved
                            ? m.outcome === 1
                              ? "YES"
                              : m.outcome === 2
                              ? "NO"
                              : "None"
                            : "TBD"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Market: {m.id}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <SpreadBlock yes={0.5} no={0.5} />
                        <VolumeBlock tvl={0} />
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {selectedMarket && (
        <TradeModal
          open={!!selectedMarket}
          market={selectedMarket}
          defaultSide={defaultSide}
          onClose={() => setSelectedMarket(null)}
          onSubmit={handleSubmitTrade}
          isSubmitting={isSubmittingTrade}
        />
      )}
    </>
  );
}
