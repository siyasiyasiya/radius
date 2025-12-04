pragma circom 2.1.4;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves (userLat, userLon) is inside a bounding box.
// Coordinates are scaled integers (e.g., degrees * 1e6).
template SpatialCheck() {
    // Public signals: bounding box (min/max lat/lon)
    signal input minLat;
    signal input maxLat;
    signal input minLon;
    signal input maxLon;

    // Private signals
    signal input userLat;
    signal input userLon;
    signal input salt;

    // minLat <= userLat <= maxLat
    component latLower = LessEqThan(64);
    latLower.in[0] <== minLat;
    latLower.in[1] <== userLat;
    latLower.out === 1;

    component latUpper = LessEqThan(64);
    latUpper.in[0] <== userLat;
    latUpper.in[1] <== maxLat;
    latUpper.out === 1;

    // minLon <= userLon <= maxLon
    component lonLower = LessEqThan(64);
    lonLower.in[0] <== minLon;
    lonLower.in[1] <== userLon;
    lonLower.out === 1;

    component lonUpper = LessEqThan(64);
    lonUpper.in[0] <== userLon;
    lonUpper.in[1] <== maxLon;
    lonUpper.out === 1;
}

component main { public [minLat, maxLat, minLon, maxLon] } = SpatialCheck();
