pragma circom 2.1.4;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves (userLat, userLon) is within radius of (targetLat, targetLon).
// Coordinates are scaled integers (e.g., degrees * 1e6).
template SpatialCheck() {
    // Public signals
    signal input targetLat;
    signal input targetLon;
    signal input radiusSq;

    // Private signals
    signal input userLat;
    signal input userLon;
    signal input salt;

    // delta = user - target
    signal latDiff;
    signal lonDiff;
    latDiff <== userLat - targetLat;
    lonDiff <== userLon - targetLon;

    // squared distance
    signal latDiffSq;
    signal lonDiffSq;
    signal distSq;
    latDiffSq <== latDiff * latDiff;
    lonDiffSq <== lonDiff * lonDiff;
    distSq <== latDiffSq + lonDiffSq;

    // radius check
    component distCheck = LessEqThan(64);
    distCheck.in[0] <== distSq;
    distCheck.in[1] <== radiusSq;
    distCheck.out === 1;

    // hash nullifier
    component hasher = Poseidon(3);
    hasher.inputs[0] <== userLat;
    hasher.inputs[1] <== userLon;
    hasher.inputs[2] <== salt;

    // Nullifier omitted in public signals for this demo; use hasher.out if needed.
}

component main { public [targetLat, targetLon, radiusSq] } = SpatialCheck();
