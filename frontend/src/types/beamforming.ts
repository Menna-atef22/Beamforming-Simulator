/**
 * Shared types for beamforming simulation
 * Replaces types previously imported from engine modules
 */

// Beamforming parameters
export interface BeamformingParams {
  numElements: number;
  spacing: number;
  wavelength: number;
  steeringAngleDeg: number;
  amplitude: number;
  snrDb: number;
  windowType: "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";
  noiseEnabled: boolean;
  apodizationEnabled: boolean;
}

// Array element in a beamforming array
export interface ArrayElement {
  index: number;
  x: number;
  y: number;
  amplitude: number;
  phase: number;
}

// Beam pattern data (angles and magnitudes)
export interface BeamPattern {
  angles: number[];
  magnitudes: number[];
  magnitudesDb: number[];
}

// Beam metrics
export interface BeamMetrics {
  beamwidthDeg: number;
  sllDb: number;
  mainLobeAngleDeg: number;
}

// 2D Interference map
export interface InterferenceMapData {
  grid: number[][];
  xRange: number[];
  yRange: number[];
  maxVal: number;
}

// Signal profile (line cut)
export interface SignalProfile {
  position: number;
  amplitude: number;
}

// Full beamforming result
export interface BeamformingResult {
  array: ArrayElement[];
  beamPattern: BeamPattern;
  beamPatternNoSteer: BeamPattern;
  interferenceMap: InterferenceMapData;
  metrics: BeamMetrics;
  signalProfile: SignalProfile[];
}

// Window function types
export type WindowType = "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";
