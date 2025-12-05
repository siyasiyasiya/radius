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
  regionId: string;
  regionName: string;
  status: any;
  resolved: boolean;
  outcome: number;
  closeTime: number;
  yesPrice: number;
  noPrice: number;
  volume: number;
};

const REGIONS = {
  // Michigan State - large bounding box
  "michigan": {
    name: "Michigan",
    minLat: 41.696,
    maxLat: 48.306,
    minLon: -90.418,
    maxLon: -82.122,
  },
  // Ann Arbor area
  "ann-arbor": {
    name: "Ann Arbor, MI",
    minLat: 42.22,
    maxLat: 42.32,
    minLon: -83.82,
    maxLon: -83.68,
  },
  // UMich Campus - expanded bounds to cover central, north, and south campus
  "umich": {
    name: "University of Michigan",
    minLat: 42.265,   // South of Michigan Stadium
    maxLat: 42.296,   // North of North Campus
    minLon: -83.755,  // West of the Big House
    maxLon: -83.710,  // East of Medical Campus
  },
  // Detroit
  "detroit": {
    name: "Detroit, MI",
    minLat: 42.25,
    maxLat: 42.45,
    minLon: -83.30,
    maxLon: -82.90,
  },
  // Chicago (for testing out-of-state)
  "chicago": {
    name: "Chicago, IL",
    minLat: 41.65,
    maxLat: 42.02,
    minLon: -87.94,
    maxLon: -87.52,
  },
  // New York (for testing far away)
  "nyc": {
    name: "New York City",
    minLat: 40.49,
    maxLat: 40.92,
    minLon: -74.26,
    maxLon: -73.70,
  },
  // Dynamic region for current location
  "current-location": {
    name: "Current Location",
    minLat: 0,
    maxLat: 0,
    minLon: 0,
    maxLon: 0,
  },
};

// Mock markets with region assignments
// Each market is assigned to a specific region - users can only see/trade markets for regions they're in
const MOCK_MARKETS: Array<{
  id: string;
  title: string;
  regionId: string;
  regionName: string;
  status: { open: {} } | { resolved: {} };
  resolved: boolean;
  outcome: number;
  closeTime: number;
  yesPrice: number;
  noPrice: number;
  volume: number;
}> = [
  // Michigan state-wide markets
  {
    id: "mkt-mi-weather",
    title: "Will Michigan see more than 80 inches of snow this winter?",
    regionId: "michigan",
    regionName: "Michigan",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 90 * 24 * 60 * 60 * 1000,
    yesPrice: 0.62,
    noPrice: 0.38,
    volume: 15420,
  },
  {
    id: "mkt-mi-football",
    title: "Will Michigan win the Big Ten Championship this year?",
    regionId: "michigan",
    regionName: "Michigan",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
    yesPrice: 0.71,
    noPrice: 0.29,
    volume: 89200,
  },
  // Ann Arbor markets
  {
    id: "mkt-aa-zingermans",
    title: "Will Zingerman's open a new location in Ann Arbor by 2025?",
    regionId: "ann-arbor",
    regionName: "Ann Arbor",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 180 * 24 * 60 * 60 * 1000,
    yesPrice: 0.35,
    noPrice: 0.65,
    volume: 4230,
  },
  {
    id: "mkt-aa-aata",
    title: "Will AATA expand TheRide bus routes to Ypsilanti this year?",
    regionId: "ann-arbor",
    regionName: "Ann Arbor",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 60 * 24 * 60 * 60 * 1000,
    yesPrice: 0.48,
    noPrice: 0.52,
    volume: 2100,
  },
  {
    id: "mkt-aa-rent",
    title: "Will average rent in Ann Arbor exceed $2000/month by June?",
    regionId: "ann-arbor",
    regionName: "Ann Arbor",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 200 * 24 * 60 * 60 * 1000,
    yesPrice: 0.78,
    noPrice: 0.22,
    volume: 8900,
  },
  // UMich campus markets
  {
    id: "mkt-um-dining",
    title: "Will South Quad dining hall get renovated before Fall semester?",
    regionId: "umich",
    regionName: "UMich Campus",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 240 * 24 * 60 * 60 * 1000,
    yesPrice: 0.22,
    noPrice: 0.78,
    volume: 1850,
  },
  {
    id: "mkt-um-gameday",
    title: "Will attendance at the next home game exceed 110,000?",
    regionId: "umich",
    regionName: "UMich Campus",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 14 * 24 * 60 * 60 * 1000,
    yesPrice: 0.85,
    noPrice: 0.15,
    volume: 12400,
  },
  {
    id: "mkt-um-library",
    title: "Will the Hatcher Graduate Library be open 24/7 during finals?",
    regionId: "umich",
    regionName: "UMich Campus",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 10 * 24 * 60 * 60 * 1000,
    yesPrice: 0.91,
    noPrice: 0.09,
    volume: 3200,
  },
  // Detroit markets (should NOT show for UMich user)
  {
    id: "mkt-det-lions",
    title: "Will the Lions make the playoffs this season?",
    regionId: "detroit",
    regionName: "Detroit",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 45 * 24 * 60 * 60 * 1000,
    yesPrice: 0.67,
    noPrice: 0.33,
    volume: 145000,
  },
  {
    id: "mkt-det-auto",
    title: "Will GM announce new EV factory in Detroit metro by Q2?",
    regionId: "detroit",
    regionName: "Detroit",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 120 * 24 * 60 * 60 * 1000,
    yesPrice: 0.41,
    noPrice: 0.59,
    volume: 23500,
  },
  // Chicago markets (should NOT show)
  {
    id: "mkt-chi-bears",
    title: "Will the Bears finish above .500 this season?",
    regionId: "chicago",
    regionName: "Chicago",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 60 * 24 * 60 * 60 * 1000,
    yesPrice: 0.28,
    noPrice: 0.72,
    volume: 67000,
  },
  // NYC markets (should NOT show)
  {
    id: "mkt-nyc-subway",
    title: "Will MTA implement congestion pricing by March?",
    regionId: "nyc",
    regionName: "NYC",
    status: { open: {} },
    resolved: false,
    outcome: 0,
    closeTime: Date.now() + 90 * 24 * 60 * 60 * 1000,
    yesPrice: 0.55,
    noPrice: 0.45,
    volume: 234000,
  },
];

// Helper function to check if a point is within a region's bounds
function isPointInRegion(lat: number, lon: number, region: typeof REGIONS[keyof typeof REGIONS]): boolean {
  return lat >= region.minLat && lat <= region.maxLat && lon >= region.minLon && lon <= region.maxLon;
}

// Get all regions that contain the user's location (hierarchical)
function getMatchingRegions(lat: number, lon: number): string[] {
  const matches: string[] = [];
  for (const [regionId, bounds] of Object.entries(REGIONS)) {
    if (regionId === "current-location") continue;
    if (isPointInRegion(lat, lon, bounds)) {
      matches.push(regionId);
    }
  }
  return matches;
}

// LocalStorage keys for persistence
const STORAGE_KEYS = {
  LOCATION_PROOF: 'radius_location_proof',
  DETECTED_REGION: 'radius_detected_region',
  USER_STATE_PDA: 'radius_user_state_pda',
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

  // Load persisted state from localStorage on mount
  useEffect(() => {
    setMounted(true);
    
    // Restore persisted location proof and region
    try {
      const savedProof = localStorage.getItem(STORAGE_KEYS.LOCATION_PROOF);
      const savedRegion = localStorage.getItem(STORAGE_KEYS.DETECTED_REGION);
      const savedPda = localStorage.getItem(STORAGE_KEYS.USER_STATE_PDA);
      
      if (savedProof) {
        const proof = JSON.parse(savedProof);
        // Check if proof is still valid (not expired)
        if (proof.validUntil && proof.validUntil > Date.now()) {
          setLocationProof(proof);
          console.log("Restored location proof from storage");
        } else {
          // Clear expired proof
          localStorage.removeItem(STORAGE_KEYS.LOCATION_PROOF);
          console.log("Cleared expired location proof");
        }
      }
      
      if (savedRegion) {
        setDetectedRegion(JSON.parse(savedRegion));
        console.log("Restored detected region from storage");
      }
      
      if (savedPda) {
        setUserStatePda(savedPda);
        console.log("Restored user state PDA from storage");
      }
    } catch (e) {
      console.error("Failed to restore persisted state:", e);
    }
  }, []);

  // Persist locationProof when it changes
  useEffect(() => {
    if (mounted && locationProof) {
      localStorage.setItem(STORAGE_KEYS.LOCATION_PROOF, JSON.stringify(locationProof));
    }
  }, [locationProof, mounted]);

  // Persist detectedRegion when it changes
  useEffect(() => {
    if (mounted && detectedRegion) {
      localStorage.setItem(STORAGE_KEYS.DETECTED_REGION, JSON.stringify(detectedRegion));
    }
  }, [detectedRegion, mounted]);

  // Persist userStatePda when it changes
  useEffect(() => {
    if (mounted && userStatePda) {
      localStorage.setItem(STORAGE_KEYS.USER_STATE_PDA, userStatePda);
    }
  }, [userStatePda, mounted]);

  useEffect(() => {
    if (wallet.connected && !detectedRegion) {
      detectLocation();
    }
  }, [wallet.connected]);

  // Load all markets, track which regions user can trade in
  const [tradableRegions, setTradableRegions] = useState<string[]>([]);
  
  useEffect(() => {
    // Always show all markets
    setMarkets(MOCK_MARKETS);
    
    // Update tradable regions when location is detected
    if (detectedRegion) {
      const matchingRegionIds = getMatchingRegions(detectedRegion.userLat, detectedRegion.userLon);
      console.log("User location:", { lat: detectedRegion.userLat, lon: detectedRegion.userLon });
      console.log("Tradable regions:", matchingRegionIds);
      setTradableRegions(matchingRegionIds);
    }
  }, [detectedRegion]);

  // Helper to check if user can trade a market
  const canTradeMarket = (market: Market): boolean => {
    return tradableRegions.includes(market.regionId);
  };

  const loadMarkets = async () => {
    // All markets are always loaded
    setMarkets(MOCK_MARKETS);
  };

  const detectLocation = async () => {
    setIsDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });

      const { latitude, longitude } = position.coords;
      console.log("Browser location detected:", { latitude, longitude });

      // First check if user is in a predefined region
      let foundRegion: any = null;
      for (const [regionId, bounds] of Object.entries(REGIONS)) {
        if (regionId === "current-location") continue; // Skip dynamic region
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

      // If not in a predefined region, create a dynamic bounding box around user's location
      if (!foundRegion) {
        // Create a ~0.1 degree (~11km) bounding box around the user
        const BBOX_SIZE = 0.05; // ~5.5km radius
        foundRegion = {
          id: "current-location",
          name: "Your Location",
          minLat: latitude - BBOX_SIZE,
          maxLat: latitude + BBOX_SIZE,
          minLon: longitude - BBOX_SIZE,
          maxLon: longitude + BBOX_SIZE,
          userLat: latitude,
          userLon: longitude,
        };
        console.log("Created dynamic region:", foundRegion);
      }

      setDetectedRegion(foundRegion);
    } catch (error) {
      console.error("Location detection failed:", error);
      alert("Location detection failed. Please allow location access and try again.");
    }
    setIsDetecting(false);
  };

  const generateZKProof = async () => {
    if (!detectedRegion) {
      alert("Please detect your location first");
      return;
    }

    setIsProvingLocation(true);
    try {
      console.log("Generating ZK proof for region:", detectedRegion);
      
      const salt = Math.floor(Math.random() * 1_000_000);
      const proofInput = {
        userLat: detectedRegion.userLat,
        userLon: detectedRegion.userLon,
        minLat: detectedRegion.minLat,
        maxLat: detectedRegion.maxLat,
        minLon: detectedRegion.minLon,
        maxLon: detectedRegion.maxLon,
        salt,
      };
      console.log("Proof input:", proofInput);
      
      const proof = await proveLocation(proofInput);
      console.log("ZK Proof generated successfully:", proof);

      if (!wallet.publicKey) {
        alert("Please connect your wallet first");
        setIsProvingLocation(false);
        return;
      }
      
      console.log("Submitting proof to blockchain...");
      const submitRes = await submitLocationProof(
        wallet,
        proof.proofPacked,
        proof.publicInputsPacked
      );
      
      console.log("Blockchain submission successful:", submitRes);
      setUserStatePda(submitRes.userStatePda.toBase58());
      
      setLocationProof({
        region: detectedRegion.id,
        proof: proof.proofPacked,
        publicInputs: proof.publicInputsPacked,
        validUntil: Date.now() + 24 * 60 * 60 * 1000,
      });
    } catch (error: any) {
      console.error("ZK proof generation failed:", error);
      alert(`Proof generation failed: ${error?.message || "Check console for details."}`);
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
                {detectedRegion?.name || "Your Location"}
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                Valid until{" "}
                {new Date(locationProof.validUntil).toLocaleString()}
              </p>
              <button
                onClick={() => {
                  // Clear all persisted state
                  localStorage.removeItem(STORAGE_KEYS.LOCATION_PROOF);
                  localStorage.removeItem(STORAGE_KEYS.DETECTED_REGION);
                  localStorage.removeItem(STORAGE_KEYS.USER_STATE_PDA);
                  setLocationProof(null);
                  setDetectedRegion(null);
                  setUserStatePda(null);
                  setTradableRegions([]);
                }}
                className="mt-2 text-[10px] text-slate-500 hover:text-red-400 underline"
              >
                Clear verification
              </button>
            </div>
          )}

          <SideBlock 
            regionName={detectedRegion?.name}
            userLat={detectedRegion?.userLat}
            userLon={detectedRegion?.userLon}
            isVerified={!!locationProof}
          />
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
                  Generate a zero knowledge proof of your location
                  without revealing your exact coordinates.
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
                      <p className="font-semibold mb-1">📍 Location Detected</p>
                      <p className="text-sm text-slate-300">
                        {detectedRegion.name || "Your Location"}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {detectedRegion.userLat?.toFixed(4)}°, {detectedRegion.userLon?.toFixed(4)}°
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
                    {detectedRegion?.name || locationProof.region}
                  </h2>
                  <p className="text-sm text-slate-400">
                    {filteredMarkets.length} markets • {filteredMarkets.filter(m => canTradeMarket(m)).length} tradable
                  </p>
                </div>

                {mounted && <WalletMultiButton />}
              </div>

              <div className="space-y-5">
                {filteredMarkets.map((m) => {
                  const isTradable = canTradeMarket(m);
                  return (
                  <section
                    key={m.id}
                    className={`rounded-2xl p-5 md:p-6 flex flex-col gap-4 border transition-all ${
                      isTradable 
                        ? "bg-slate-900/80 border-slate-800" 
                        : "bg-slate-900/40 border-slate-800/50 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          #{m.id.toString().padStart(2, "0")} • {m.regionName}
                          {!isTradable && (
                            <span className="ml-2 text-amber-500/80">🔒 Outside your region</span>
                          )}
                        </p>
                        <h3 className={`text-base md:text-lg font-medium ${!isTradable && "text-slate-400"}`}>
                          {m.title}
                        </h3>
                      </div>

                      {isTradable ? (
                        <button
                          className="shrink-0 px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-sm font-semibold"
                          onClick={() => {
                            setSelectedMarket(m);
                            setDefaultSide("yes");
                          }}
                        >
                          Trade
                        </button>
                      ) : (
                        <button
                          disabled
                          className="shrink-0 px-4 py-2 rounded-full bg-slate-700 text-slate-500 text-sm font-semibold cursor-not-allowed"
                          title="You must be in this region to trade"
                        >
                          Locked
                        </button>
                      )}
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
                        <SpreadBlock yes={m.yesPrice} no={m.noPrice} />
                        <VolumeBlock tvl={m.volume} />
                      </div>
                    </div>
                  </section>
                  );
                })}
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
