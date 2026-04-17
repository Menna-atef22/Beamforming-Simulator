/**
 * Hook for ultrasound simulation API
 * Handles B-mode imaging and optional Doppler processing
 */

import { useState, useCallback } from "react";
import type { UltrasoundParams, UltrasoundResult, Scatterer } from "../types/beamforming";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Type exports for components
export interface SimulatorUltrasoundResponse {
  success: boolean;
  data: UltrasoundResult;
}
export type UltrasoundReflection = Scatterer;

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
        steering_angle_deg: params.steeringAngleDeg ?? 0,
        max_depth_mm: params.maxDepthMm ?? 100,
        num_samples: params.numSamples ?? 512,
        enable_noise: params.enableNoise !== false,
        enable_speckle: params.enableSpeckle !== false,
        run_doppler: params.runDoppler === true,
        target_depth_mm: params.targetDepthMm ?? 50,
      };

      const response = await fetch(`${API_BASE}/api/simulate/ultrasound`, {
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
      
      // Transform API response (snake_case) to TypeScript types (camelCase)
      const data: UltrasoundResult = {
        bmode: {
          depthsMm: rawData.bmode?.depths_mm || [],
          amplitudes: rawData.bmode?.amplitudes || [],
          amplitudesDb: rawData.bmode?.amplitudes_db || [],
          metrics: rawData.bmode?.metrics || {},
        },
        doppler: rawData.doppler ? {
          frequenciesHz: rawData.doppler.frequencies_hz || [],
          power: rawData.doppler.power || [],
          powerDb: rawData.doppler.power_db || [],
          meanVelocityMms: rawData.doppler.mean_velocity_mms || 0,
          maxVelocityMms: rawData.doppler.max_velocity_mms || 0,
          pulsatilityIndex: rawData.doppler.pulsatility_index || 0,
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
