import Head from "next/head";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { proveLocation } from "../lib/zkProver";

export default function Home() {
  const logRef = useRef(null);
  const [userCoords, setUserCoords] = useState(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [target, setTarget] = useState(null); // {lat, lon, radiusMeters}
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
    const lat = parseFloat(loc.lat);
    const lon = parseFloat(loc.lon);
    const [s, n, w, e] = loc.boundingbox.map((v) => parseFloat(v));
    const centerLat = (n + s) / 2;
    const centerLon = (e + w) / 2;
    const latMeters = (n - s) * 111_000;
    const lonMeters = (e - w) * 111_000 * Math.cos((centerLat * Math.PI) / 180);
    const diagonal = Math.hypot(latMeters, lonMeters);
    const radiusMeters = (diagonal / 2) * 1.25 || 500;
    setTarget({ lat: centerLat, lon: centerLon, radiusMeters });
    log(`Location set to ${loc.display_name}`);
    log(`Center: ${centerLat.toFixed(6)}, ${centerLon.toFixed(6)} | Radius ~${Math.round(radiusMeters)}m`);
  };

  const fetchSuggestions = async (query) => {
    setFetchingSuggestions(true);
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&polygon_geojson=0`, {
        headers: { "User-Agent": "zk-location-demo/0.1" },
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
    setTarget(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) return;
    debounceRef.current = setTimeout(() => fetchSuggestions(q.trim()), 350);
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
        targetLat: target.lat,
        targetLon: target.lon,
        radiusMeters: target.radiusMeters,
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
                  target
                    ? `${target.lat.toFixed(6)}, ${target.lon.toFixed(6)} (~${Math.round(target.radiusMeters)}m)`
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
