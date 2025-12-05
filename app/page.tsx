"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import Script from "next/script";

import SideBlock from "./components/SideBlock";
import SpreadBlock from "./components/SpreadBlock";
import VolumeBlock from "./components/VolumeBlock";
import TVLSparkline from "./components/TVLSparkline";
import { proveLocation } from "../lib/zkProver";

type TVLPoint = { value: number };

type Market = {
  id: number;
  title: string;
  yes: number;
  no: number;
  tvl: TVLPoint[];
  region: string;
};

const REGIONS = {
  'west-lafayette': {
    name: 'West Lafayette, IN',
    minLat: 40.40,
    maxLat: 40.50,
    minLon: -86.95,
    maxLon: -86.85,
  },
  'powell': {
    name: 'Powell, OH',
    minLat: 40.13,
    maxLat: 40.23,
    minLon: -83.10,
    maxLon: -83.00,
  }
};

export default function Page() {
  const [mounted, setMounted] = useState(false);
  const [locationProof, setLocationProof] = useState<any>(null);
  const [detectedRegion, setDetectedRegion] = useState<any>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProvingLocation, setIsProvingLocation] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (wallet.connected && !detectedRegion) {
      detectLocation();
    }
  }, [wallet.connected]);

  const detectLocation = async () => {
    setIsDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });
      
      const { latitude, longitude } = position.coords;
      
      for (const [regionId, bounds] of Object.entries(REGIONS)) {
        if (
          latitude >= bounds.minLat && latitude <= bounds.maxLat &&
          longitude >= bounds.minLon && longitude <= bounds.maxLon
        ) {
          setDetectedRegion({ id: regionId, ...bounds, userLat: latitude, userLon: longitude });
          break;
        }
      }
      
      if (!detectedRegion) {
        // Fallback for demo
        setDetectedRegion({ 
          id: 'west-lafayette', 
          ...REGIONS['west-lafayette'],
          userLat: 40.45, 
          userLon: -86.90 
        });
      }
    } catch (error) {
      console.error('Location detection failed:', error);
      setDetectedRegion({ 
        id: 'west-lafayette', 
        ...REGIONS['west-lafayette'],
        userLat: 40.45, 
        userLon: -86.90 
      });
    }
    setIsDetecting(false);
  };

  const generateZKProof = async () => {
    if (!detectedRegion) return;
    
    setIsProvingLocation(true);
    try {
      const salt = Math.floor(Math.random() * 1000000);
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
    } catch (error) {
      console.error('ZK proof generation failed:', error);
      alert('Proof generation failed. Check console for details.');
    }
    setIsProvingLocation(false);
  };

  const markets: Market[] = [
    {
      id: 1,
      title: "Will Powell HS win the state championship?",
      yes: 0.42,
      no: 0.58,
      tvl: [{ value: 3000 }, { value: 4800 }, { value: 6400 }],
      region: 'powell',
    },
    {
      id: 2,
      title: "Will AQI in West Lafayette exceed 120 tomorrow?",
      yes: 0.35,
      no: 0.65,
      tvl: [{ value: 1800 }, { value: 2600 }, { value: 3200 }],
      region: 'west-lafayette',
    },
    {
      id: 3,
      title: "Will gas in Powell hit $4.00/gal by Sept 30?",
      yes: 0.28,
      no: 0.72,
      tvl: [{ value: 2200 }, { value: 2800 }, { value: 3600 }],
      region: 'powell',
    },
  ];

  const filteredMarkets = locationProof 
    ? markets.filter(m => m.region === locationProof.region)
    : [];

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
              <p className="text-xs text-emerald-400 font-semibold mb-1">✓ Location Verified</p>
              <p className="text-xs text-slate-400">{REGIONS[locationProof.region as keyof typeof REGIONS]?.name}</p>
              <p className="text-[10px] text-slate-500 mt-2">
                Valid until {new Date(locationProof.validUntil).toLocaleString()}
              </p>
            </div>
          )}
          
          <SideBlock />
        </aside>

        <main className="flex-1 p-6 md:p-10 space-y-8">
          {!wallet.connected && (
            <div className="text-center py-20">
              <h2 className="text-3xl font-bold mb-4">Connect Your Wallet</h2>
              <p className="text-slate-400 mb-8">Connect to start trading on local markets</p>
              {mounted && <WalletMultiButton />}
            </div>
          )}

          {wallet.connected && !locationProof && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 text-center">
                <h2 className="text-2xl font-bold mb-4">Verify Your Location</h2>
                <p className="text-slate-400 mb-6">
                  Generate a zero-knowledge proof that you're in {detectedRegion ? REGIONS[detectedRegion.id as keyof typeof REGIONS]?.name : 'a supported region'} without revealing your exact address.
                </p>
                
                {!detectedRegion ? (
                  <button
                    onClick={detectLocation}
                    disabled={isDetecting}
                    className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 disabled:opacity-50 font-semibold"
                  >
                    {isDetecting ? 'Detecting Location...' : 'Detect My Location'}
                  </button>
                ) : (
                  <div>
                    <div className="bg-sky-500/20 border border-sky-400 rounded-lg p-4 mb-6">
                      <p className="font-semibold mb-1">Location Detected</p>
                      <p className="text-sm text-slate-300">{REGIONS[detectedRegion.id as keyof typeof REGIONS]?.name}</p>
                    </div>
                    <button
                      onClick={generateZKProof}
                      disabled={isProvingLocation}
                      className="px-6 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 font-semibold"
                    >
                      {isProvingLocation ? 'Generating Proof... (this may take 10-30 seconds)' : 'Generate ZK Proof'}
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
                    {REGIONS[locationProof.region as keyof typeof REGIONS]?.name}
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

                      <button className="shrink-0 px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-sm font-semibold">
                        Trade
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
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

                      <div className="grid grid-cols-2 gap-3">
                        <SpreadBlock yes={m.yes} no={m.no} />
                        <VolumeBlock tvl={m.tvl[m.tvl.length - 1].value} />
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
