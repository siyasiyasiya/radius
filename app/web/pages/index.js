import Head from "next/head";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { proveLocation } from "../lib/zkProver";

export default function Home() {
  const logRef = useRef(null);
  const [userCoords, setUserCoords] = useState(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [target, setTarget] = useState(null); // {minLat, maxLat, minLon, maxLon}
  const [suggestions, setSuggestions] = useState([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const [salt, setSalt] = useState("0");
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef(null);

  const log = (msg) => {
    if (!logRef.current) return;
    logRef.current.textContent += `${msg}\n`;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  };

  const handleGeo = () => {
    log("Requesting browser geolocation...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ latitude, longitude });
        log(`Got coords: ${latitude}, ${longitude}`);
      },
      (err) => log(`Geolocation error: ${err.message}`)
    );
  };

  const selectLocation = (loc) => {
    const [s, n, w, e] = loc.boundingbox.map((v) => parseFloat(v));
    setTarget({ minLat: s, maxLat: n, minLon: w, maxLon: e });
    log(`Location set to ${loc.display_name}`);
    log(
      `BBox: [${s.toFixed(6)}, ${n.toFixed(6)}] lat, [${w.toFixed(6)}, ${e.toFixed(6)}] lon`
    );
  };

  const fetchSuggestions = async (query) => {
    setFetchingSuggestions(true);
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "5",
        polygon_geojson: "0",
        addressdetails: "1",
      });
      // Bias results around the user's current location if available.
      if (userCoords) {
        const d = 0.3; // degrees ~33km
        const viewbox = [
          userCoords.longitude - d,
          userCoords.latitude - d,
          userCoords.longitude + d,
          userCoords.latitude + d,
        ].join(",");
        params.set("viewbox", viewbox);
        // don't hard bound; still allow wider matches
      }
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { "User-Agent": "zk-location-demo/0.1", "Accept-Language": "en" },
      });
      if (!resp.ok) throw new Error(`Geocode failed: ${resp.status}`);
      const data = await resp.json();
      setSuggestions(data || []);
    } catch (err) {
      console.error(err);
      log(`Geocode error: ${err.message}`);
    } finally {
      setFetchingSuggestions(false);
    }
  };

  const handleQueryChange = (e) => {
    const q = e.target.value;
    setLocationQuery(q);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) return;
    debounceRef.current = setTimeout(() => fetchSuggestions(q.trim()), 350);
  };

  const handleQueryFocus = () => {
    if (locationQuery.trim().length >= 2) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(locationQuery.trim()), 50);
    }
  };

  const handleProve = async () => {
    if (!userCoords) {
      log("Click 'Use browser geolocation' first.");
      return;
    }
    if (!target) {
      log("Lookup a location first.");
      return;
    }
    setBusy(true);
    log("Generating proof...");
    try {
      const result = await proveLocation({
        userLat: userCoords.latitude,
        userLon: userCoords.longitude,
        minLat: target.minLat,
        maxLat: target.maxLat,
        minLon: target.minLon,
        maxLon: target.maxLon,
        salt: salt || "0",
      });
      log("Proof generated. Public signals:");
      log(JSON.stringify(result.rawPublicSignals, null, 2));
      log("Submit step is still stubbed. Wire to Solana client as needed.");
    } catch (err) {
      console.error(err);
      log(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    log("Ready. Click Use browser geolocation, set target + radius, then generate.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Head>
        <title>ZK Location Proof Demo</title>
      </Head>
      <Script src="/zk/snarkjs.min.js" strategy="beforeInteractive" />
      <main className="container">
        <h1>Local Prediction Markets – ZK Location Check</h1>
        <p className="note">
          Prove you are within the boundaries of a location (looked up via geocode) using the Circom Groth16 circuit.
          Artifacts are served from <code>/zk</code>.
        </p>
        <section className="card">
          <div className="row">
            <div className="field">
              <label>Your latitude</label>
              <input value={userCoords?.latitude?.toFixed(6) || ""} readOnly placeholder="Use geolocation" />
            </div>
            <div className="field">
              <label>Your longitude</label>
              <input value={userCoords?.longitude?.toFixed(6) || ""} readOnly placeholder="Use geolocation" />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ position: "relative" }}>
              <label>Location query</label>
              <input
                type="text"
                value={locationQuery}
                onChange={handleQueryChange}
                onFocus={handleQueryFocus}
                placeholder="e.g. Purdue University"
                autoComplete="off"
              />
              {fetchingSuggestions && <div className="muted">Searching...</div>}
              {suggestions.length > 0 && (
                <div className="suggestions">
                  {suggestions.map((sug) => (
                    <button
                      key={`${sug.place_id}`}
                      type="button"
                      onClick={() => {
                        selectLocation(sug);
                        setSuggestions([]);
                        setLocationQuery(sug.display_name);
                      }}
                    >
                      {sug.display_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Nullifier salt</label>
              <input type="text" value={salt} onChange={(e) => setSalt(e.target.value)} />
            </div>
            <div className="field">
              <label>Selected target</label>
              <input
                readOnly
                value={
                  target && target.minLat !== undefined
                    ? `[${target.minLat.toFixed(6)}, ${target.maxLat.toFixed(6)}] lat, [${target.minLon.toFixed(6)}, ${target.maxLon.toFixed(6)}] lon`
                    : ""
                }
                placeholder="Lookup a location first"
              />
            </div>
          </div>
          <div className="actions">
            <button onClick={handleGeo} disabled={busy}>
              Use browser geolocation
            </button>
            <button onClick={handleProve} className="primary" disabled={busy}>
              Generate proof & submit
            </button>
          </div>
        </section>
        <section className="card">
          <h3>Status</h3>
          <pre ref={logRef} />
        </section>
      </main>
    </>
  );
}
