import Head from "next/head";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { proveLocation } from "../lib/zkProver";

export default function Home() {
  const logRef = useRef(null);
  const [userCoords, setUserCoords] = useState(null);
  const [targetLat, setTargetLat] = useState("");
  const [targetLon, setTargetLon] = useState("");
  const [radius, setRadius] = useState(500);
  const [salt, setSalt] = useState("0");
  const [busy, setBusy] = useState(false);

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

  const handleProve = async () => {
    if (!userCoords) {
      log("Click 'Use browser geolocation' first.");
      return;
    }
    setBusy(true);
    log("Generating proof...");
    try {
      const tLat = parseFloat(targetLat);
      const tLon = parseFloat(targetLon);
      const rad = parseFloat(radius);
      if (!Number.isFinite(tLat) || !Number.isFinite(tLon)) {
        throw new Error("Enter a valid target latitude/longitude.");
      }
      if (!Number.isFinite(rad) || rad <= 0) {
        throw new Error("Enter a valid radius in meters.");
      }
      const result = await proveLocation({
        userLat: userCoords.latitude,
        userLon: userCoords.longitude,
        targetLat: tLat,
        targetLon: tLon,
        radiusMeters: rad,
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
          Prove you are within a radius of a target point using the Circom Groth16 circuit. Artifacts are served from{" "}
          <code>/zk</code>.
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
            <div className="field">
              <label>Target latitude</label>
              <input
                type="number"
                step="0.000001"
                value={targetLat}
                onChange={(e) => setTargetLat(e.target.value)}
                placeholder="e.g. 40.4217"
              />
            </div>
            <div className="field">
              <label>Target longitude</label>
              <input
                type="number"
                step="0.000001"
                value={targetLon}
                onChange={(e) => setTargetLon(e.target.value)}
                placeholder="e.g. -86.9070"
              />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Radius (meters)</label>
              <input type="number" step="1" value={radius} onChange={(e) => setRadius(e.target.value)} />
            </div>
            <div className="field">
              <label>Nullifier salt</label>
              <input type="text" value={salt} onChange={(e) => setSalt(e.target.value)} />
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
