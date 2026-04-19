/**
 * Shared types for beamforming simulation backend
 * Defines interfaces for all simulator types (Beamforming, 5G, Radar, Ultrasound)
 */

// ============================================================================
// Generic Beamforming Parameters & Results
// ============================================================================

/** Generic beamforming simulation parameters */
export interface BeamformingParams {
  numElements: number;
  spacing: number;
  frequency: number;
  steeringAngleDeg?: number;
  amplitude: number;
  snrDb: number;
  windowType: WindowType;
  enableNoise?: boolean;
  gridSize?: number;
}

/** Array element in antenna array */
export interface ArrayElement {
  index: number;
  x: number;
  y: number;
  amplitude: number;
  phase: number;
}

/** Beam pattern across angular range */
export interface BeamPattern {
  angles: number[];
  magnitudes: number[];
  magnitudesDb: number[];
}

/** Computed beam metrics */
export interface BeamMetrics {
  beamwidthDeg: number;
  sllDb: number;
  mainLobeAngleDeg: number;
  directivityDb: number;
  gainPeak: number;
}

/** 2D spatial interference map */
export interface InterferenceMapData {
  grid: number[][];
  xRange: number[];
  yRange: number[];
  maxVal: number;
  extent: number;
}

/** Generic beamforming result */
export interface BeamformingResult {
  angles: number[];
  magnitudes: number[];
  magnitudesDb: number[];
  metrics: BeamMetrics;
}

/** Window function types */
export type WindowType = "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";

// ============================================================================
// 5G Network Simulator Types
// ============================================================================

/** 5G simulation parameters */
export interface FiveGParams extends BeamformingParams {
  autoSteer?: boolean;
  enableNoise?: boolean;
  gridSize?: number;
}

/** 5G tower with beamforming capabilities */
export interface Tower {
  id: number;
  x: number;
  y: number;
  steeringAngleDeg: number;
  beamwidthDeg: number;
  maxGainDb: number;
}

/** Mobile user receiving signal */
export interface User {
  id: number;
  x: number;
  y: number;
  signalStrength: number;
  snrDb: number;
}

/** Tower-user connectivity metrics */
export interface TowerConnectivityInfo {
  towerId: number;
  userId: number;
  distanceM: number;
  angleToUserDeg: number;
  angleOffsetFromBeamDeg: number;
  gainAtUser: number;
  pathLossDb: number;
  signalStrength: number;
}

/** Network coverage metrics */
export interface NetworkCoverage {
  numTowers: number;
  numUsers: number;
  totalSignal: number;
  averageSignal: number;
  maxSignal: number;
  minSignal: number;
}

/** Tower beam pattern for display */
export interface TowerBeamPattern {
  towerId: number;
  towerX: number;
  towerY: number;
  steeringAngleDeg: number;
  angles: number[];
  magnitudes: number[];
  magnitudesDb: number[];
  metrics: BeamMetrics;
}

/** Complete 5G simulation result */
export interface FiveGResult {
  towers: Tower[];
  users: User[];
  connectivityMap: TowerConnectivityInfo[];
  networkCoverage: NetworkCoverage;
  beamPatterns: TowerBeamPattern[];
}

// ============================================================================
// Radar Simulator Types
// ============================================================================

/** Radar simulation parameters */
export interface RadarParams extends BeamformingParams {
  steeringAngleDeg?: number;
  scanRangeDeg?: number;
  enableNoise?: boolean;
  gridSize?: number;
  computeDoppler?: boolean;
}

/** Radar target with RCS and velocity */
export interface RadarTarget {
  id: number;
  angleDeg: number;
  distanceM: number;
  rcsDbsm: number;
  velocityMps: number;
}

/** Detected radar peak with metrics */
export interface DetectedPeak {
  angleDeg: number;
  distanceM: number;
  snrDb: number;
  power: number;
  confidence: number;
}

/** Range-Doppler map data */
export interface RangeDopplerMap {
  rangesM: number[];
  dopplerShiftsHz: number[];
  velocitiesMps: number[];
}

/** Radar performance metrics */
export interface RadarMetrics {
  numTargets: number;
  numDetections: number;
  detectionRate: number;
  falseAlarms: number;
  avgSnrDb: number;
  avgConfidence: number;
}

/** Complete radar scan result */
export interface RadarScanResult {
  anglesDeg: number[];
  magnitudes: number[];
  magnitudesDb: number[];
  targets: RadarTarget[];
  detections: DetectedPeak[];
  rangeDopplerMap: RangeDopplerMap;
  metrics: RadarMetrics;
}

// ============================================================================
// Ultrasound Simulator Types
// ============================================================================

/** Ultrasound simulation parameters */
export interface UltrasoundParams extends BeamformingParams {
  maxDepthMm?: number;
  numSamples?: number;
  enableNoise?: boolean;
  enableSpeckle?: boolean;
  runDoppler?: boolean;
  targetDepthMm?: number;
  dynamicRangeDb?: number;
  focalDepthM?: number;
  tissueThicknessM?: number;
  phantomRegions?: PhantomEllipse[];
  probeParamRad?: number;
}

/** Acoustic tissue layer properties */
export interface TissueLayer {
  depthMm: number;
  thicknessMm: number;
  acousticImpedance: number;
  attenuationDbMm: number;
  reflectionCoefficient: number;
  speedOfSoundMps: number;
}

/** Point scatterer in tissue (speckle) */
export interface Scatterer {
  depthMm: number;
  lateralMm: number;
  scatteringAmplitude: number;
  motionVelocityMms: number;
}

/** B-mode image metrics */
export interface BmodeMetrics {
  contrastDb: number;
  speckleSNRDb: number;
  penetrationDepthMm: number;
  focalDepthMm: number;
  dynamicRangeDb: number;
}

/** Single Shepp-Logan ellipse row */
export interface PhantomEllipse {
  regionId: number;
  label: string;
  intensity: number;
  a: number;
  b: number;
  x0: number;
  y0: number;
  phiDeg: number;
  acousticImpedanceMrayl: number;
  attenuationDbCmMhz: number;
  backscatterCoeff: number;
  speedOfSoundMps: number;
  scatterDensity: number;
  boundaryRoughness: number;
}

export interface UltrasoundReflectionPoint {
  depthMm: number;
  amplitude: number;
}

/** Phantom definition for deterministic frontend rendering */
export interface UltrasoundPhantom {
  model: string;
  domain: [number, number] | number[];
  ellipses: PhantomEllipse[];
}

/** B-mode imaging result */
export interface UltrasoundBModeResult {
  depthsMm: number[];
  amplitudes: number[];
  amplitudesDb: number[];
  reflections?: UltrasoundReflectionPoint[];
  metrics: BmodeMetrics;
  phantom?: UltrasoundPhantom;
}

/** Doppler velocity spectrum */
export interface UltrasoundDopplerResult {
  frequenciesHz: number[];
  power: number[];
  powerDb: number[];
  meanVelocityMms: number;
  maxVelocityMms: number;
  pulsatilityIndex: number;
}

/** Complete ultrasound imaging result */
export interface UltrasoundResult {
  bmode: UltrasoundBModeResult;
  doppler?: UltrasoundDopplerResult;
}
