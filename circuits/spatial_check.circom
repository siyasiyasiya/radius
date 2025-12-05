pragma circom 2.1.4;

include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/poseidon.circom";

template SpatialCheck() {
    // Public inputs (bounding box)
    signal input minLat;
    signal input maxLat;
    signal input minLon;
    signal input maxLon;
    
    // Private inputs
    signal input userLat;
    signal input userLon;
    signal input salt;

    // Range checks
    component latLower = LessEqThan(64);
    latLower.in[0] <== minLat;
    latLower.in[1] <== userLat;
    latLower.out === 1;

    component latUpper = LessEqThan(64);
    latUpper.in[0] <== userLat;
    latUpper.in[1] <== maxLat;
    latUpper.out === 1;

    component lonLower = LessEqThan(64);
    lonLower.in[0] <== minLon;
    lonLower.in[1] <== userLon;
    lonLower.out === 1;

    component lonUpper = LessEqThan(64);
    lonUpper.in[0] <== userLon;
    lonUpper.in[1] <== maxLon;
    lonUpper.out === 1;

    // Create nullifier with Poseidon
    component hash = Poseidon(3);
    hash.inputs[0] <== userLat;
    hash.inputs[1] <== userLon;
    hash.inputs[2] <== salt;

    signal output locationNullifier;
    locationNullifier <== hash.out;
}

component main {public [minLat, maxLat, minLon, maxLon]} = SpatialCheck();
