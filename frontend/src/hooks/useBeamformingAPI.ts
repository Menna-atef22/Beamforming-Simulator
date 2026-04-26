/**
 * Hook for beamforming API communication
 * Provides access to generic beamforming simulation endpoint
 */

import { useState, useCallback } from "react";
import type {
  BeamformingParams,
  BeamformingResult,
} from "../types/beamforming";
import { apiFetch } from "@/lib/apiClient";

export type BeamformingAPIResponse = { success: boolean; data?: any; error?: string };

export function useBeamformingAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(
    async (params: any): Promise<BeamformingAPIResponse> => {
      setLoading(true);
      setError(null);

      try {
        const requestBody = {
          num_elements: params.num_elements ?? params.numElements ?? 8,
          spacing: params.spacing ?? 0.5,
          geometry: params.geometry ?? "linear",
          radius: params.radius ?? 5,
          // Frontend `frequency` is provided in GHz; convert to Hz for backend.
          frequency: params.frequency !== undefined ? Number(params.frequency) * 1e9 : undefined,
          wavelength: params.wavelength ?? undefined,
          steering_angle_deg: params.steering_angle_deg ?? params.steeringAngleDeg ?? 0,
          amplitude: params.amplitude ?? 1.0,
          snr_db: params.snr_db ?? params.snrDb ?? 30,
          window_type: params.window_type ?? params.windowType ?? "rectangular",
          noise_enabled: params.noise_enabled !== undefined ? params.noise_enabled : (params.noiseEnabled ?? true),
          apodization_enabled: params.apodization_enabled !== undefined ? params.apodization_enabled : (params.apodizationEnabled ?? false),
          profile_depth: params.profile_depth ?? params.profileDepth ?? undefined,
        };

        const response = await apiFetch("/api/simulate/beamforming", {
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
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, error, simulate };
}
