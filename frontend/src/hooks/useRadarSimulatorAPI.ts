import { useState, useCallback } from "react";
import { BeamformingParams } from "@/types/beamforming";

const API_BASE = "http://localhost:5000";

export interface RadarTarget {
  id: number;
  range: number;
  angle: number;
  velocity: number;
  rcs: number;
}

export interface SimulatorRadarResponse {
  success: boolean;
  data?: {
    angles: number[];
    returns: number[];
    targets: RadarTarget[];
  };
  error?: string;
}

export function useRadarSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (params: BeamformingParams, isInitial: boolean = false): Promise<SimulatorRadarResponse | null> => {
    // Use full loading only on initial load, use lighter update state for subsequent calls
    if (isInitial) {
      setLoading(true);
    } else {
      setIsUpdating(true);
    }
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/radar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          num_elements: params.numElements,
          spacing: params.spacing,
          wavelength: params.wavelength,
          steering_angle_deg: params.steeringAngleDeg,
          amplitude: params.amplitude,
          snr_db: params.snrDb,
          window_type: params.windowType,
          noise_enabled: params.noiseEnabled,
          apodization_enabled: params.apodizationEnabled,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errorData.error || errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      console.error("[Radar API Error]", errorMsg);
      return null;
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, []);

  return { simulate, loading, isUpdating, error };
}
