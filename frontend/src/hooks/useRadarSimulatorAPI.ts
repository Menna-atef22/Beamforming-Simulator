/**
 * Hook for radar simulation API
 * Handles target detection, range-Doppler processing, and scan results
 */

import { useState, useCallback } from "react";
import type { RadarParams, RadarScanResult, RadarTarget } from "../types/beamforming";
import { apiFetch } from "@/lib/apiClient";

// Type exports for components
export interface SimulatorRadarResponse {
  success: boolean;
  data: RadarScanResult;
}
export type { RadarTarget };

export function useRadarSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (
    params: RadarParams,
    _isInitialLoad?: boolean
  ): Promise<SimulatorRadarResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        num_elements: params.numElements ?? 32,
        spacing: params.spacing ?? 0.5,
        frequency: params.frequency ?? 10e9,
        snr_db: params.snrDb ?? 15,
        steering_angle_deg: params.steeringAngleDeg ?? 0,
        scan_range_deg: params.scanRangeDeg ?? 360,
        enable_noise: params.enableNoise !== false,
        grid_size: params.gridSize ?? 360,
        compute_doppler: params.computeDoppler !== false,
      };

      const response = await apiFetch("/api/simulate/radar", {
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
      const data: RadarScanResult = {
        anglesDeg: rawData.angles || [],
        magnitudes: rawData.magnitudes || [],
        magnitudesDb: rawData.magnitudes_db || [],
        targets: (rawData.targets || []).map((t: any) => ({
          id: t.id,
          angleDeg: t.angle_deg || t.angle || 0,
          distanceM: t.distance_m || t.range || 0,
          rcsDbsm: t.rcs_dbsm || t.rcs || 0,
          velocityMps: t.velocity_mps || 0,
        })),
        detections: (rawData.detections || []).map((d: any) => ({
          angleDeg: d.angle_deg || 0,
          distanceM: d.distance_m || 0,
          snrDb: d.snr_db || 0,
          power: d.power || 0,
          confidence: d.confidence || 0,
        })),
        rangeDopplerMap: {
          rangesM: rawData.range_doppler_map?.ranges_m || [],
          dopplerShiftsHz: rawData.range_doppler_map?.doppler_shifts_hz || [],
          velocitiesMps: rawData.range_doppler_map?.velocities_mps || [],
        },
        metrics: rawData.metrics || {},
        noiseBuffer: rawData.noise_buffer || [],
      };
      
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("[useRadarSimulatorAPI] Error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error };
}
