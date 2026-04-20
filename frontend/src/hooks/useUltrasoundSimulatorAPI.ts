/**
 * Hook for ultrasound simulation API
 * Handles B-mode imaging and optional Doppler processing
 */

import { useState, useCallback } from "react";
import type { UltrasoundParams, UltrasoundResult, Scatterer } from "../types/beamforming";
import { apiFetch } from "@/lib/apiClient";

// Type exports for components
export interface SimulatorUltrasoundResponse {
  success: boolean;
  data: UltrasoundResult;
}
export type UltrasoundReflection = Scatterer;

interface RawPhantomEllipse {
  region_id?: number;
  label?: string;
  intensity?: number;
  a?: number;
  b?: number;
  x0?: number;
  y0?: number;
  phi_deg?: number;
  phiDeg?: number;
  acoustic_impedance_mrayl?: number;
  attenuation_db_cm_mhz?: number;
  backscatter_coeff?: number;
  speed_of_sound_mps?: number;
  scatter_density?: number;
  boundary_roughness?: number;
}

interface RawReflection {
  depth_mm?: number;
  amplitude?: number;
}

const MODIFIED_SHEPP_LOGAN_FALLBACK = {
  model: "modified_shepp_logan",
  domain: [-1, 1] as [number, number],
  ellipses: [
    { regionId: 1, label: "Background Soft Tissue", intensity: 1.0, a: 0.69, b: 0.92, x0: 0.0, y0: 0.0, phiDeg: 0.0, acousticImpedanceMrayl: 1.63, attenuationDbCmMhz: 0.50, backscatterCoeff: 0.28, speedOfSoundMps: 1540, scatterDensity: 0.55, boundaryRoughness: 0.35 },
    { regionId: 2, label: "CSF/Ventricle-like Region", intensity: -0.8, a: 0.6624, b: 0.874, x0: 0.0, y0: -0.0184, phiDeg: 0.0, acousticImpedanceMrayl: 1.51, attenuationDbCmMhz: 0.02, backscatterCoeff: 0.06, speedOfSoundMps: 1505, scatterDensity: 0.10, boundaryRoughness: 0.10 },
    { regionId: 3, label: "Dense Lesion A", intensity: -0.2, a: 0.11, b: 0.31, x0: 0.22, y0: 0.0, phiDeg: -18.0, acousticImpedanceMrayl: 1.72, attenuationDbCmMhz: 0.85, backscatterCoeff: 0.44, speedOfSoundMps: 1570, scatterDensity: 0.62, boundaryRoughness: 0.48 },
    { regionId: 4, label: "Dense Lesion B", intensity: -0.2, a: 0.16, b: 0.41, x0: -0.22, y0: 0.0, phiDeg: 18.0, acousticImpedanceMrayl: 1.68, attenuationDbCmMhz: 0.78, backscatterCoeff: 0.40, speedOfSoundMps: 1560, scatterDensity: 0.58, boundaryRoughness: 0.46 },
    { regionId: 5, label: "Parenchyma-like Region", intensity: 0.1, a: 0.21, b: 0.25, x0: 0.0, y0: 0.35, phiDeg: 0.0, acousticImpedanceMrayl: 1.65, attenuationDbCmMhz: 0.60, backscatterCoeff: 0.32, speedOfSoundMps: 1545, scatterDensity: 0.50, boundaryRoughness: 0.40 },
    { regionId: 6, label: "Calcification 1", intensity: 0.1, a: 0.046, b: 0.046, x0: 0.0, y0: 0.1, phiDeg: 0.0, acousticImpedanceMrayl: 5.50, attenuationDbCmMhz: 6.00, backscatterCoeff: 0.85, speedOfSoundMps: 3200, scatterDensity: 0.25, boundaryRoughness: 0.82 },
    { regionId: 7, label: "Calcification 2", intensity: 0.1, a: 0.046, b: 0.046, x0: 0.0, y0: -0.1, phiDeg: 0.0, acousticImpedanceMrayl: 5.20, attenuationDbCmMhz: 5.40, backscatterCoeff: 0.80, speedOfSoundMps: 3000, scatterDensity: 0.22, boundaryRoughness: 0.78 },
    { regionId: 8, label: "Cystic Node 1", intensity: 0.1, a: 0.046, b: 0.023, x0: -0.08, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.49, attenuationDbCmMhz: 0.04, backscatterCoeff: 0.04, speedOfSoundMps: 1490, scatterDensity: 0.08, boundaryRoughness: 0.08 },
    { regionId: 9, label: "Cystic Node 2", intensity: 0.1, a: 0.023, b: 0.023, x0: 0.0, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.50, attenuationDbCmMhz: 0.05, backscatterCoeff: 0.05, speedOfSoundMps: 1495, scatterDensity: 0.09, boundaryRoughness: 0.09 },
    { regionId: 10, label: "Cystic Node 3", intensity: 0.1, a: 0.023, b: 0.046, x0: 0.06, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.52, attenuationDbCmMhz: 0.05, backscatterCoeff: 0.05, speedOfSoundMps: 1500, scatterDensity: 0.09, boundaryRoughness: 0.09 },
  ],
};

export function useUltrasoundSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (
    params: UltrasoundParams,
    _isInitialLoad?: boolean
  ): Promise<SimulatorUltrasoundResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      // Build request with safe defaults for all ultrasound parameters
      const requestBody = {
        num_elements: params.numElements ?? 64,
        spacing: params.spacing ?? 0.3,
        frequency: params.frequency ?? 5e6,
        snr_db: params.snrDb ?? 25,
        window_type: params.windowType ?? "rectangular",
        steering_angle_deg: params.steeringAngleDeg ?? 0,
        max_depth_mm: params.maxDepthMm ?? 100,
        num_samples: params.numSamples ?? 512,
        enable_noise: params.enableNoise !== false,
        enable_speckle: params.enableSpeckle !== false,
        run_doppler: params.runDoppler === true,
        target_depth_mm: params.targetDepthMm ?? 50,
        probe_param_rad: params.probeParamRad,
        phantom_regions: params.phantomRegions?.map((region) => ({
          region_id: region.regionId,
          label: region.label,
          intensity: region.intensity,
          a: region.a,
          b: region.b,
          x0: region.x0,
          y0: region.y0,
          phi_deg: region.phiDeg,
          acoustic_impedance_mrayl: region.acousticImpedanceMrayl,
          attenuation_db_cm_mhz: region.attenuationDbCmMhz,
          backscatter_coeff: region.backscatterCoeff,
          speed_of_sound_mps: region.speedOfSoundMps,
          scatter_density: region.scatterDensity,
          boundary_roughness: region.boundaryRoughness,
        })),
      };

      const response = await apiFetch("/api/simulate/ultrasound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const rawData = await response.json();
      const payload = rawData?.data ?? rawData;

      const phantom = payload.bmode?.phantom
        ? {
            model: payload.bmode.phantom.model || "modified_shepp_logan",
            domain: payload.bmode.phantom.domain || [-1, 1],
            ellipses: (payload.bmode.phantom.ellipses || []).map((ellipse: RawPhantomEllipse, index: number) => ({
              regionId: ellipse.region_id ?? index + 1,
              label: ellipse.label ?? `Region ${index + 1}`,
              intensity: ellipse.intensity ?? 0,
              a: ellipse.a ?? 0,
              b: ellipse.b ?? 0,
              x0: ellipse.x0 ?? 0,
              y0: ellipse.y0 ?? 0,
              phiDeg: ellipse.phi_deg ?? ellipse.phiDeg ?? 0,
              acousticImpedanceMrayl: ellipse.acoustic_impedance_mrayl ?? 1.6,
              attenuationDbCmMhz: ellipse.attenuation_db_cm_mhz ?? 0.5,
              backscatterCoeff: ellipse.backscatter_coeff ?? 0.3,
              speedOfSoundMps: ellipse.speed_of_sound_mps ?? 1540,
              scatterDensity: ellipse.scatter_density ?? 0.5,
              boundaryRoughness: ellipse.boundary_roughness ?? 0.3,
            })),
          }
        : MODIFIED_SHEPP_LOGAN_FALLBACK;
      
      // Transform API response (snake_case) to TypeScript types (camelCase)
      const data: UltrasoundResult = {
        bmode: {
          depthsMm: payload.bmode?.depths_mm || [],
          amplitudes: payload.bmode?.amplitudes || [],
          amplitudesDb: payload.bmode?.amplitudes_db || [],
          reflections: (payload.bmode?.reflections || []).map((reflection: RawReflection) => ({
            depthMm: reflection.depth_mm ?? 0,
            amplitude: reflection.amplitude ?? 0,
          })),
          metrics: payload.bmode?.metrics || {},
          phantom,
        },
        doppler: payload.doppler ? {
          frequenciesHz: payload.doppler.frequencies_hz || [],
          power: payload.doppler.power || [],
          powerDb: payload.doppler.power_db || [],
          meanVelocityMms: payload.doppler.mean_velocity_mms || 0,
          maxVelocityMms: payload.doppler.max_velocity_mms || 0,
          pulsatilityIndex: payload.doppler.pulsatility_index || 0,
        } : undefined,
      };
      
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("[useUltrasoundSimulatorAPI] Error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error };
}
