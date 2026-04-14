/**
 * Core Beamforming Engine
 *
 * Implements phased array simulation with:
 * - Constructive/destructive interference computation
 * - Phase shifting and beam steering
 * - Apodization/windowing for sidelobe reduction
 * - SNR noise modeling
 */

export interface BeamformingParams {
  frequency: number; // Hz
  numElements: number; // Number of antenna elements
  elementSpacing: number; // In wavelengths (d/λ)
  phaseShift: number; // Radians
  amplitude: number; // 0-1
  steeringAngle: number; // Degrees (-90 to 90)
  snr: number; // Signal-to-noise ratio (0-1000)
  windowType: WindowType; // Apodization window
}

export type WindowType = "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";

export interface BeamResult {
  /** 2D interference pattern [y][x], normalized 0-1 */
  heatmap: Float32Array[];
  /** Beam profile: array of { angle, magnitude } */
  beamProfile: { angle: number; magnitude: number }[];
  /** Peak sidelobe level in dB */
  peakSidelobeLevel: number;
  /** Main lobe width in degrees (3dB beamwidth) */
  mainLobeWidth: number;
}

/** Speed of light */
const C = 3e8;

/**
 * Compute window coefficients for apodization
 */
export function computeWindow(type: WindowType, n: number): number[] {
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    switch (type) {
      case "rectangular":
        w[i] = 1;
        break;
      case "hamming":
        w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
        break;
      case "hanning":
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        break;
      case "blackman":
        w[i] =
          0.42 -
          0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) +
          0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
        break;
      case "kaiser": {
        // Kaiser with beta=6
        const beta = 6;
        const alpha = (n - 1) / 2;
        const ratio = (i - alpha) / alpha;
        w[i] = bessel0(beta * Math.sqrt(1 - ratio * ratio)) / bessel0(beta);
        break;
      }
    }
  }
  return w;
}

/** Modified Bessel function of the first kind, order 0 */
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k <= 20; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}

/**
 * Compute the array factor (beam profile) for a uniform linear array
 * Returns magnitude vs angle in degrees
 */
export function computeBeamProfile(
  params: BeamformingParams,
  angleResolution: number = 0.5,
): { angle: number; magnitude: number }[] {
  const { numElements, elementSpacing, steeringAngle, windowType } = params;
  const weights = computeWindow(windowType, numElements);
  const steerRad = (steeringAngle * Math.PI) / 180;
  const profile: { angle: number; magnitude: number }[] = [];

  for (let angleDeg = -90; angleDeg <= 90; angleDeg += angleResolution) {
    const angleRad = (angleDeg * Math.PI) / 180;
    // Phase difference between adjacent elements
    const psi = 2 * Math.PI * elementSpacing * (Math.sin(angleRad) - Math.sin(steerRad));

    let realSum = 0;
    let imagSum = 0;
    for (let i = 0; i < numElements; i++) {
      const phase = i * psi;
      realSum += weights[i] * Math.cos(phase);
      imagSum += weights[i] * Math.sin(phase);
    }
    const magnitude = Math.sqrt(realSum * realSum + imagSum * imagSum);
    profile.push({ angle: angleDeg, magnitude });
  }

  // Normalize
  const maxMag = Math.max(...profile.map((p) => p.magnitude));
  if (maxMag > 0) {
    for (const p of profile) {
      p.magnitude /= maxMag;
    }
  }

  return profile;
}

/**
 * Compute 2D interference heatmap
 * Maps the field intensity on a 2D grid around the array
 */
export function computeHeatmap(
  params: BeamformingParams,
  width: number,
  height: number,
): Float32Array[] {
  const { numElements, elementSpacing, steeringAngle, amplitude, snr, windowType, frequency } =
    params;
  const wavelength = C / frequency;
  const d = elementSpacing * wavelength; // Physical spacing
  const weights = computeWindow(windowType, numElements);
  const steerRad = (steeringAngle * Math.PI) / 180;
  const k = (2 * Math.PI) / wavelength;

  const heatmap: Float32Array[] = [];
  // The array is centered at the bottom of the grid
  const arrayCenterX = width / 2;
  const arrayCenterY = height - 10;
  // Scale: each pixel represents some physical distance
  const scale = wavelength * 0.5; // each pixel = 0.5 wavelength

  let maxVal = 0;

  for (let y = 0; y < height; y++) {
    const row = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const dx = (x - arrayCenterX) * scale;
      const dy = (arrayCenterY - y) * scale; // y increases upward
      if (dy <= 0) {
        row[x] = 0;
        continue;
      }

      let realSum = 0;
      let imagSum = 0;

      for (let i = 0; i < numElements; i++) {
        const elemX = (i - (numElements - 1) / 2) * d;
        const rx = dx - elemX;
        const ry = dy;
        const r = Math.sqrt(rx * rx + ry * ry);
        if (r < 1e-10) continue;

        // Phase: propagation + steering
        const steerPhase = i * 2 * Math.PI * elementSpacing * Math.sin(steerRad);
        const phase = k * r - steerPhase;
        const w = (weights[i] * amplitude) / Math.sqrt(r); // 2D: 1/sqrt(r) falloff

        realSum += w * Math.cos(phase);
        imagSum += w * Math.sin(phase);
      }

      const intensity = realSum * realSum + imagSum * imagSum;
      row[x] = intensity;
      if (intensity > maxVal) maxVal = intensity;
    }
    heatmap.push(row);
  }

  // Normalize and add noise
  const noiseAmplitude = maxVal > 0 ? maxVal / (snr + 1) : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maxVal > 0) {
        heatmap[y][x] /= maxVal;
      }
      // Add Gaussian noise
      if (noiseAmplitude > 0 && maxVal > 0) {
        const noise = (Math.random() - 0.5) * 2 * (1 / (snr + 1));
        heatmap[y][x] = Math.max(0, Math.min(1, heatmap[y][x] + noise));
      }
    }
  }

  return heatmap;
}

/**
 * Analyze beam profile to extract metrics
 */
export function analyzeBeamProfile(profile: { angle: number; magnitude: number }[]): {
  peakSidelobeLevel: number;
  mainLobeWidth: number;
} {
  // Find main lobe peak
  let peakIdx = 0;
  let peakVal = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i].magnitude > peakVal) {
      peakVal = profile[i].magnitude;
      peakIdx = i;
    }
  }

  // Find 3dB points
  const threshold = peakVal * 0.707; // -3dB
  let leftIdx = peakIdx;
  let rightIdx = peakIdx;
  while (leftIdx > 0 && profile[leftIdx].magnitude > threshold) leftIdx--;
  while (rightIdx < profile.length - 1 && profile[rightIdx].magnitude > threshold) rightIdx++;
  const mainLobeWidth = profile[rightIdx].angle - profile[leftIdx].angle;

  // Find peak sidelobe (outside main lobe)
  let peakSidelobe = 0;
  for (let i = 0; i < leftIdx - 2; i++) {
    if (profile[i].magnitude > peakSidelobe) peakSidelobe = profile[i].magnitude;
  }
  for (let i = rightIdx + 2; i < profile.length; i++) {
    if (profile[i].magnitude > peakSidelobe) peakSidelobe = profile[i].magnitude;
  }

  const peakSidelobeLevel = peakSidelobe > 0 ? 20 * Math.log10(peakSidelobe / peakVal) : -100;

  return { peakSidelobeLevel, mainLobeWidth };
}

/**
 * Render heatmap to canvas ImageData using a color map
 */
export function heatmapToImageData(
  heatmap: Float32Array[],
  width: number,
  height: number,
): ImageData {
  const imageData = new ImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = heatmap[y]?.[x] ?? 0;
      const idx = (y * width + x) * 4;
      // Viridis-inspired colormap
      const [r, g, b] = viridisColor(val);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return imageData;
}

/** Purple-themed colormap: dark → deep purple → bright purple/white */
function viridisColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  // Black → deep indigo → purple → magenta → bright lavender
  const r = Math.round(255 * Math.max(0, Math.min(1, t * t * 1.8 + t * 0.15)));
  const g = Math.round(255 * Math.max(0, Math.min(1, t * t * t * 0.6)));
  const b = Math.round(255 * Math.max(0, Math.min(1, t * 0.6 + t * t * 0.45)));
  return [r, g, b];
}

/**
 * Compute array factor for a given angle (used by modules)
 */
export function computeArrayFactor(
  numElements: number,
  elementSpacing: number,
  steeringAngle: number,
  targetAngle: number,
  windowType: WindowType = "rectangular",
): number {
  const weights = computeWindow(windowType, numElements);
  const steerRad = (steeringAngle * Math.PI) / 180;
  const angleRad = (targetAngle * Math.PI) / 180;
  const psi = 2 * Math.PI * elementSpacing * (Math.sin(angleRad) - Math.sin(steerRad));

  let realSum = 0;
  let imagSum = 0;
  for (let i = 0; i < numElements; i++) {
    const phase = i * psi;
    realSum += weights[i] * Math.cos(phase);
    imagSum += weights[i] * Math.sin(phase);
  }
  const magnitude = Math.sqrt(realSum * realSum + imagSum * imagSum);
  const maxPossible = weights.reduce((a, b) => a + b, 0);
  return magnitude / maxPossible;
}
