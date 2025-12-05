"use client";

import { useState, useEffect, useRef } from "react";

interface Region {
  id: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface GeocodeSuggestion {
  place_id: number;
  display_name: string;
  boundingbox: string[];
  lat: string;
  lon: string;
}

// Compact manifest format to fit within Solana transaction limits
interface ResolutionManifest {
  q: string;      // question
  loc: string;    // location (short)
  t: string;      // type ("LLM")
}

interface CreateMarketModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    question: string;
    regionId: string;
    regionName: string;
    closeTime: Date;
    manifest: ResolutionManifest;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  }) => Promise<void>;
  isSubmitting: boolean;
  availableRegions: Region[];
  userTradableRegions: string[];
  userLocation?: { lat: number; lon: number } | null;
}

export default function CreateMarketModal({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  availableRegions,
  userTradableRegions,
  userLocation,
}: CreateMarketModalProps) {
  const [question, setQuestion] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<{
    name: string;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  } | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState<number>(60); // Default 1 hour
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Duration options
  const DURATION_OPTIONS = [
    { label: "1 min", value: 1 },
    { label: "5 min", value: 5 },
    { label: "15 min", value: 15 },
    { label: "30 min", value: 30 },
    { label: "45 min", value: 45 },
    { label: "1 hour", value: 60 },
    { label: "2 hours", value: 120 },
    { label: "6 hours", value: 360 },
    { label: "12 hours", value: 720 },
    { label: "1 day", value: 1440 },
    { label: "7 days", value: 10080 },
  ];

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setQuestion("");
      setLocationQuery("");
      setSelectedLocation(null);
      setSuggestions([]);
      setDurationMinutes(60);
      setErrors({});
      setShowSuggestions(false);
    }
  }, [open]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchSuggestions = async (query: string) => {
    setFetchingSuggestions(true);
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "6",
        polygon_geojson: "0",
        addressdetails: "1",
      });
      
      // Bias results around user's location if available
      if (userLocation) {
        const d = 0.5; // degrees ~55km
        const viewbox = [
          userLocation.lon - d,
          userLocation.lat - d,
          userLocation.lon + d,
          userLocation.lat + d,
        ].join(",");
        params.set("viewbox", viewbox);
      }
      
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: {
            "User-Agent": "radius-markets/0.1",
            "Accept-Language": "en",
          },
        }
      );
      
      if (!resp.ok) throw new Error(`Geocode failed: ${resp.status}`);
      const data = await resp.json();
      setSuggestions(data || []);
      setShowSuggestions(true);
    } catch (err) {
      console.error("Geocode error:", err);
      setSuggestions([]);
    } finally {
      setFetchingSuggestions(false);
    }
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setLocationQuery(q);
    setSelectedLocation(null);
    setSuggestions([]);
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setShowSuggestions(false);
      return;
    }
    
    debounceRef.current = setTimeout(() => fetchSuggestions(q.trim()), 350);
  };

  const handleQueryFocus = () => {
    if (locationQuery.trim().length >= 2 && suggestions.length === 0) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(locationQuery.trim()), 100);
    } else if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  };

  const selectSuggestion = (sug: GeocodeSuggestion) => {
    const [s, n, w, e] = sug.boundingbox.map((v) => parseFloat(v));
    setSelectedLocation({
      name: sug.display_name,
      bounds: { minLat: s, maxLat: n, minLon: w, maxLon: e },
    });
    setLocationQuery(sug.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // Check if selected location is within user's tradable regions
  const isLocationInTradableRegion = (): boolean => {
    if (!selectedLocation || !userLocation) return false;
    
    // Check if user's location is within the selected bounds
    const { minLat, maxLat, minLon, maxLon } = selectedLocation.bounds;
    return (
      userLocation.lat >= minLat &&
      userLocation.lat <= maxLat &&
      userLocation.lon >= minLon &&
      userLocation.lon <= maxLon
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!question.trim()) {
      newErrors.question = "Question is required";
    } else if (question.length > 128) {
      newErrors.question = "Question must be 128 characters or less";
    } else if (!question.endsWith("?")) {
      newErrors.question = "Question should end with a question mark";
    }

    if (!selectedLocation) {
      newErrors.region = "Please search and select a location";
    } else if (!isLocationInTradableRegion()) {
      newErrors.region = "You must be within this location to create a market here";
    }

    if (durationMinutes < 1) {
      newErrors.closeTime = "Market must be open for at least 1 minute";
    } else if (durationMinutes > 525600) { // 1 year in minutes
      newErrors.closeTime = "Market cannot be open for more than 1 year";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !selectedLocation) return;

    const closeTime = new Date();
    closeTime.setTime(closeTime.getTime() + durationMinutes * 60 * 1000);

    // Create a region ID from the location name (simplified)
    const regionId = selectedLocation.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .substring(0, 32);

    // Shorten location name if needed (keep first part before comma)
    const shortLocation = selectedLocation.name.split(",")[0].trim();

    // Auto-generate a COMPACT resolution manifest (must fit in 256 bytes on-chain)
    const manifest = {
      q: question.trim(),
      loc: shortLocation,
      t: "LLM",
    };

    await onSubmit({
      question: question.trim(),
      regionId,
      regionName: selectedLocation.name,
      closeTime,
      manifest,
      bounds: selectedLocation.bounds,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Create New Market</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Question */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Question
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will something happen by a certain date?"
              className={`w-full bg-slate-800 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none ${
                errors.question ? "border-red-500" : "border-slate-700"
              }`}
              rows={3}
              maxLength={128}
            />
            <div className="flex justify-between mt-1">
              {errors.question ? (
                <span className="text-xs text-red-400">{errors.question}</span>
              ) : (
                <span className="text-xs text-slate-500">
                  Binary yes/no question
                </span>
              )}
              <span className="text-xs text-slate-500">
                {question.length}/128
              </span>
            </div>
          </div>

          {/* Region - Searchable */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Region
            </label>
            <div className="relative" ref={inputRef}>
              <input
                type="text"
                value={locationQuery}
                onChange={handleQueryChange}
                onFocus={handleQueryFocus}
                placeholder="Search for a location (e.g. University of Michigan)"
                autoComplete="off"
                className={`w-full bg-slate-800 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  errors.region ? "border-red-500" : "border-slate-700"
                }`}
              />
              
              {fetchingSuggestions && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4 text-slate-400" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              )}
              
              {/* Suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {suggestions.map((sug) => (
                    <button
                      key={sug.place_id}
                      type="button"
                      onClick={() => selectSuggestion(sug)}
                      className="w-full px-4 py-3 text-left text-sm text-slate-300 hover:bg-slate-700 border-b border-slate-700 last:border-b-0 transition-colors"
                    >
                      <div className="line-clamp-2">{sug.display_name}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            {errors.region && (
              <span className="text-xs text-red-400 mt-1 block">
                {errors.region}
              </span>
            )}
            
            {selectedLocation && (
              <div className="mt-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                <p className="text-xs text-emerald-400 font-semibold mb-1">
                  ✓ Location Selected
                </p>
                <p className="text-xs text-slate-400 line-clamp-2">
                  {selectedLocation.name}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  Bounds: [{selectedLocation.bounds.minLat.toFixed(4)}°, {selectedLocation.bounds.maxLat.toFixed(4)}°] lat
                </p>
                {!isLocationInTradableRegion() && (
                  <p className="text-xs text-amber-400 mt-2">
                    ⚠️ You are not currently within this location
                  </p>
                )}
              </div>
            )}
            
            <p className="text-xs text-slate-500 mt-1">
              Only users within this location can trade this market
            </p>
          </div>

          {/* Duration Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Market Duration
            </label>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDurationMinutes(opt.value)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    durationMinutes === opt.value
                      ? "bg-sky-500 text-white"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.closeTime && (
              <span className="text-xs text-red-400 mt-1 block">
                {errors.closeTime}
              </span>
            )}
            <p className="text-xs text-slate-500 mt-2">
              Closes:{" "}
              {new Date(
                Date.now() + durationMinutes * 60 * 1000
              ).toLocaleString()}
            </p>
          </div>

          {/* Auto-generated manifest info */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>AI Oracle will auto-resolve this market</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              The oracle searches the web for "{question || "your question"}" and uses AI to determine the outcome.
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedLocation}
              className="flex-1 px-4 py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating...
                </span>
              ) : (
                "Create Market"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
