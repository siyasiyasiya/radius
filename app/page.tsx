"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import Script from "next/script";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";

import SideBlock from "./components/SideBlock";
import SpreadBlock from "./components/SpreadBlock";
import VolumeBlock from "./components/VolumeBlock";
import TVLSparkline from "./components/TVLSparkline";
import { proveLocation } from "../lib/zkProver";
import TradeModal from "./components/TradeModal";
import CreateMarketModal from "./components/CreateMarketModal";
import {
  AnchorWallet,
  fetchMarkets,
  placeOrderOnChain,
  createMarket,
  regionIdFromName,
  hashManifest,
} from "../lib/hyperlocalClient";
import { submitLocationProof } from "../lib/zkLocationClient";

// Devnet USDC mint address
const USDC_MINT_DEVNET = new PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr");
// USDC has 6 decimals
const USDC_DECIMALS = 6;

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
  // Bounds for dynamically created markets (from geocoding)
  bounds?: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
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

  // Create market modal state
  const [showCreateMarket, setShowCreateMarket] = useState(false);
  const [isCreatingMarket, setIsCreatingMarket] = useState(false);

  // USDC balance and deposit state
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  
  // User's positions in markets
  const [userPositions, setUserPositions] = useState<Record<string, { yes: number; no: number }>>({});

  // Fetch USDC balance from chain
  const fetchUsdcBalance = useCallback(async () => {
    if (!wallet.publicKey) {
      setUsdcBalance(null);
      return;
    }
    
    setIsLoadingBalance(true);
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT_DEVNET, wallet.publicKey);
      const accountInfo = await getAccount(connection, ata);
      const balance = Number(accountInfo.amount) / Math.pow(10, USDC_DECIMALS);
      setUsdcBalance(balance);
    } catch (err: any) {
      // Account doesn't exist = 0 balance
      if (err.name === "TokenAccountNotFoundError") {
        setUsdcBalance(0);
      } else {
        console.error("Failed to fetch USDC balance:", err);
        setUsdcBalance(0);
      }
    } finally {
      setIsLoadingBalance(false);
    }
  }, [wallet.publicKey, connection]);

  // Fetch balance when wallet connects
  useEffect(() => {
    if (wallet.connected && wallet.publicKey) {
      fetchUsdcBalance();
    } else {
      setUsdcBalance(null);
    }
  }, [wallet.connected, wallet.publicKey, fetchUsdcBalance]);

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
    // First check predefined regions
    if (tradableRegions.includes(market.regionId)) {
      return true;
    }
    
    // For dynamically created markets, check if user is within the market's bounds
    if (market.bounds && detectedRegion) {
      const { minLat, maxLat, minLon, maxLon } = market.bounds;
      const userLat = detectedRegion.userLat;
      const userLon = detectedRegion.userLon;
      
      return (
        userLat >= minLat &&
        userLat <= maxLat &&
        userLon >= minLon &&
        userLon <= maxLon
      );
    }
    
    return false;
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
    if (!selectedMarket || !wallet.publicKey || !userStatePda) {
      if (!userStatePda) {
        alert("Please verify your location first before trading.");
      }
      return;
    }
    
    // Check balance
    if (usdcBalance === null || amount > usdcBalance) {
      alert("Insufficient USDC balance. Click 'Get USDC' to get devnet tokens.");
      return;
    }

    try {
      setIsSubmittingTrade(true);

      // Convert amount to USDC base units (6 decimals)
      const amountBaseUnits = Math.floor(amount * 1_000_000);
      
      // Calculate minimum shares out with slippage
      const price = side === "yes" ? selectedMarket.yesPrice : selectedMarket.noPrice;
      const expectedShares = amount / price;
      const minSharesOut = Math.floor(expectedShares * (1 - slippageBps / 10000) * 1_000_000);

      const userLocationPubkey = new PublicKey(userStatePda);

      console.log("Placing order on-chain:", {
        market: selectedMarket.id,
        side,
        amountUsdc: amount,
        amountBaseUnits,
        minSharesOut,
        userLocation: userLocationPubkey.toBase58(),
      });

      // Execute real on-chain transaction
      const txSignature = await placeOrderOnChain({
        connection,
        wallet: wallet as AnchorWallet,
        market: new PublicKey(selectedMarket.id),
        userLocation: userLocationPubkey,
        amount: amountBaseUnits,
        side,
        minSharesOut,
      });

      console.log("Trade executed:", {
        market: selectedMarket.id,
        side,
        amount,
        tx: txSignature,
      });

      // Refresh actual USDC balance from chain
      await fetchUsdcBalance();
      
      // Update user positions locally (will be refreshed from chain in future)
      const sharesReceived = amount / price;
      setUserPositions(prev => ({
        ...prev,
        [selectedMarket.id]: {
          yes: (prev[selectedMarket.id]?.yes || 0) + (side === "yes" ? sharesReceived : 0),
          no: (prev[selectedMarket.id]?.no || 0) + (side === "no" ? sharesReceived : 0),
        }
      }));

      // Update market volume
      setMarkets(prev => prev.map(m => 
        m.id === selectedMarket.id 
          ? { ...m, volume: m.volume + amount }
          : m
      ));

      alert(`✅ Trade successful!\n\nBought ~${sharesReceived.toFixed(2)} ${side.toUpperCase()} shares for $${amount.toFixed(2)} USDC\n\nTx: ${txSignature.slice(0, 20)}...`);
      setSelectedMarket(null);
    } catch (err: any) {
      console.error("Trade failed", err);
      
      // Parse common errors
      let errorMsg = "Trade failed. See console for details.";
      if (err?.message?.includes("insufficient")) {
        errorMsg = "Insufficient USDC balance.";
      } else if (err?.message?.includes("LocationNotVerified")) {
        errorMsg = "Location not verified. Please verify your location first.";
      } else if (err?.message?.includes("WrongRegion")) {
        errorMsg = "You are not in the correct region to trade this market.";
      } else if (err?.message?.includes("MarketClosed")) {
        errorMsg = "This market is closed for trading.";
      } else if (err?.message) {
        errorMsg = `Trade failed: ${err.message}`;
      }
      
      alert(errorMsg);
    } finally {
      setIsSubmittingTrade(false);
    }
  };

  // Handle market creation
  const handleCreateMarket = async (data: {
    question: string;
    regionId: string;
    regionName: string;
    closeTime: Date;
    manifest: {
      q: string;      // question
      loc: string;    // location (short)
      t: string;      // type ("LLM")
    };
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  }) => {
    if (!wallet.publicKey) return;

    try {
      setIsCreatingMarket(true);

      // Generate region ID hash from region name
      const regionIdHash = regionIdFromName(data.regionId);
      
      // The manifest is auto-generated and stored on-chain as JSON string
      // We serialize it and hash it for verification
      const manifestJson = JSON.stringify(data.manifest);
      const manifestHashArr = hashManifest(manifestJson);

      // Close time as unix timestamp (seconds)
      const closeTimeUnix = Math.floor(data.closeTime.getTime() / 1000);

      console.log("Creating market:", {
        question: data.question,
        regionId: data.regionId,
        regionName: data.regionName,
        bounds: data.bounds,
        closeTime: closeTimeUnix,
        manifest: data.manifest,
      });

      const result = await createMarket({
        connection,
        wallet: wallet as AnchorWallet,
        regionId: regionIdHash,
        question: data.question,
        closeTime: closeTimeUnix,
        manifestUrl: manifestJson, // Store the manifest JSON directly
        manifestHash: manifestHashArr,
      });

      console.log("Market created:", result);
      alert(`Market created! TX: ${result.txSignature}`);

      // Add the new market to local state (include bounds for tradability check)
      const newMarket: Market = {
        id: result.marketPubkey.toBase58(),
        title: data.question,
        regionId: data.regionId,
        regionName: data.regionName,
        status: { open: {} },
        resolved: false,
        outcome: 0,
        closeTime: closeTimeUnix * 1000, // Convert back to ms for display
        yesPrice: 0.5,
        noPrice: 0.5,
        volume: 0,
        bounds: data.bounds, // Store bounds for dynamic tradability check
      };

      setMarkets((prev) => [newMarket, ...prev]);
      setShowCreateMarket(false);
    } catch (err: any) {
      console.error("Market creation failed", err);
      alert(`Market creation failed: ${err.message || "See console for details"}`);
    } finally {
      setIsCreatingMarket(false);
    }
  };

  // Get available regions for the create market modal
  const availableRegionsForModal = Object.entries(REGIONS)
    .filter(([id]) => id !== "current-location")
    .map(([id, data]) => ({
      id,
      name: data.name,
      minLat: data.minLat,
      maxLat: data.maxLat,
      minLon: data.minLon,
      maxLon: data.maxLon,
    }));

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

          {/* USDC Balance Section */}
          {wallet.connected && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Balance</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-white">$</span>
                  </div>
                  <span className="text-xs text-slate-400">USDC</span>
                </div>
              </div>
              <p className="text-2xl font-bold text-white mb-3">
                {isLoadingBalance ? (
                  <span className="text-slate-500">Loading...</span>
                ) : usdcBalance !== null ? (
                  `$${usdcBalance.toFixed(2)}`
                ) : (
                  <span className="text-slate-500">--</span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDepositModal(true)}
                  className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Get USDC
                </button>
                <button
                  onClick={fetchUsdcBalance}
                  disabled={isLoadingBalance}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm transition-colors disabled:opacity-50"
                  title="Refresh balance"
                >
                  <svg className={`w-4 h-4 ${isLoadingBalance ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Portfolio Summary */}
          {wallet.connected && Object.keys(userPositions).length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <h3 className="text-xs text-slate-400 uppercase tracking-wide mb-3">Your Positions</h3>
              <div className="space-y-2">
                {Object.entries(userPositions).map(([marketId, position]) => {
                  const market = markets.find((m) => m.id === marketId);
                  if (!market || (position.yes === 0 && position.no === 0)) return null;
                  const positionValue = 
                    position.yes * market.yesPrice + position.no * market.noPrice;
                  const potentialValue = Math.max(position.yes, position.no);
                  return (
                    <div key={marketId} className="text-xs border-b border-slate-700 pb-2 last:border-0">
                      <p className="text-slate-300 truncate mb-1">{market.title.slice(0, 30)}...</p>
                      <div className="flex justify-between text-slate-500">
                        <span>
                          {position.yes > 0 && <span className="text-emerald-400">{position.yes.toFixed(1)} YES</span>}
                          {position.yes > 0 && position.no > 0 && " / "}
                          {position.no > 0 && <span className="text-red-400">{position.no.toFixed(1)} NO</span>}
                        </span>
                        <span className="text-slate-400">${positionValue.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-600 mt-3 pt-3 flex justify-between">
                <span className="text-xs text-slate-400">Total Value</span>
                <span className="text-sm font-bold text-white">
                  ${Object.entries(userPositions).reduce((total, [marketId, position]) => {
                    const market = markets.find((m) => m.id === marketId);
                    if (!market) return total;
                    return total + position.yes * market.yesPrice + position.no * market.noPrice;
                  }, 0).toFixed(2)}
                </span>
              </div>
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

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowCreateMarket(true)}
                    className="px-4 py-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-sm font-semibold flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Market
                  </button>
                  {mounted && <WalletMultiButton />}
                </div>
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
                        <div className="flex gap-2">
                          <button
                            className="shrink-0 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold"
                            onClick={() => {
                              setSelectedMarket(m);
                              setDefaultSide("yes");
                            }}
                          >
                            Yes {(m.yesPrice * 100).toFixed(0)}¢
                          </button>
                          <button
                            className="shrink-0 px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-sm font-semibold"
                            onClick={() => {
                              setSelectedMarket(m);
                              setDefaultSide("no");
                            }}
                          >
                            No {(m.noPrice * 100).toFixed(0)}¢
                          </button>
                        </div>
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

                    {/* User Position Display */}
                    {userPositions[m.id] && (userPositions[m.id].yes > 0 || userPositions[m.id].no > 0) && (
                      <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 mt-2">
                        <p className="text-xs text-sky-400 font-semibold mb-2">Your Position</p>
                        <div className="flex gap-4 text-sm">
                          {userPositions[m.id].yes > 0 && (
                            <span className="text-emerald-400">
                              {userPositions[m.id].yes.toFixed(2)} YES (${(userPositions[m.id].yes * m.yesPrice).toFixed(2)})
                            </span>
                          )}
                          {userPositions[m.id].no > 0 && (
                            <span className="text-red-400">
                              {userPositions[m.id].no.toFixed(2)} NO (${(userPositions[m.id].no * m.noPrice).toFixed(2)})
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-slate-500">Status:</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            "open" in (m.status as any) 
                              ? "bg-emerald-500/20 text-emerald-400" 
                              : "bg-slate-500/20 text-slate-400"
                          }`}>
                            {("open" in (m.status as any) && "Open") ||
                              ("disputed" in (m.status as any) && "Disputed") ||
                              ("resolved" in (m.status as any) && "Resolved")}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Closes: {new Date(m.closeTime).toLocaleDateString()}
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

      <CreateMarketModal
        open={showCreateMarket}
        onClose={() => setShowCreateMarket(false)}
        onSubmit={handleCreateMarket}
        isSubmitting={isCreatingMarket}
        availableRegions={availableRegionsForModal}
        userTradableRegions={tradableRegions}
        userLocation={detectedRegion ? { lat: detectedRegion.userLat, lon: detectedRegion.userLon } : null}
      />

      {/* Get USDC Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowDepositModal(false)}
          />
          <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Get Devnet USDC</h2>
              <button
                onClick={() => setShowDepositModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* USDC Info */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
                  <span className="text-lg font-bold text-white">$</span>
                </div>
                <div>
                  <p className="font-semibold">USDC on Devnet</p>
                  <p className="text-xs text-slate-400">For testing prediction markets</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-800 rounded-lg p-4">
                <p className="text-sm font-medium mb-2">USDC Mint Address:</p>
                <code className="text-xs text-sky-400 break-all bg-slate-900 p-2 rounded block">
                  4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
                </code>
              </div>

              <div className="space-y-3">
                <p className="text-sm text-slate-400">Options to get devnet USDC:</p>
                
                <a
                  href="https://faucet.circle.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 font-semibold text-center transition-colors"
                >
                  Circle Faucet →
                </a>
                
                <a
                  href={`https://spl-token-faucet.com/?token-name=USDC-Dev`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 font-semibold text-center transition-colors"
                >
                  SPL Token Faucet →
                </a>
              </div>

              {wallet.publicKey && (
                <div className="bg-slate-800 rounded-lg p-3 mt-4">
                  <p className="text-xs text-slate-400 mb-1">Your Wallet:</p>
                  <code className="text-xs text-slate-300 break-all">
                    {wallet.publicKey.toBase58()}
                  </code>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                fetchUsdcBalance();
                setShowDepositModal(false);
              }}
              className="w-full mt-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors"
            >
              Done - Refresh Balance
            </button>

            <p className="text-xs text-slate-500 mt-4 text-center">
              Devnet tokens have no real value
            </p>
          </div>
        </div>
      )}
    </>
  );
}
