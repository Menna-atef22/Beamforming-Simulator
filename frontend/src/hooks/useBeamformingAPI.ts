/**
 * Hook for beamforming API communication
 * Provides access to generic beamforming simulation endpoint
 */

import { useState, useCallback } from "react";
import type {
  BeamformingParams,
  BeamformingResult,
} from "../types/beamforming";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export type BeamformingAPIResponse = { success: boolean; data: any };

export function useBeamformingAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(
    async (params: any): Promise<BeamformingAPIResponse | null> => {
      setLoading(true);
      setError(null);

      try {
        const requestBody = {
          num_elements: params.num_elements ?? params.numElements ?? 8,
          spacing: params.spacing ?? 0.5,
          wavelength: params.wavelength ?? 1.0,
          steering_angle_deg: params.steering_angle_deg ?? params.steeringAngleDeg ?? 0,
          amplitude: params.amplitude ?? 1.0,
          snr_db: params.snr_db ?? params.snrDb ?? 30,
          window_type: params.window_type ?? params.windowType ?? "rectangular",
          noise_enabled: params.noise_enabled !== undefined ? params.noise_enabled : (params.noiseEnabled ?? true),
          apodization_enabled: params.apodization_enabled !== undefined ? params.apodization_enabled : (params.apodizationEnabled ?? false),
        };

        const response = await fetch(`${API_BASE}/api/simulate/beamforming`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        console.error("[useBeamformingAPI] Error:", message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, error, simulate };
}
