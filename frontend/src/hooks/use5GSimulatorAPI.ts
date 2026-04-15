import { useState, useCallback } from "react";
import { BeamformingParams } from "@/types/beamforming";

const API_BASE = "http://localhost:5000";

export interface Tower {
  id: number;
  x: number;
  y: number;
  power: number;
}

export interface User {
  id: number;
  x: number;
  y: number;
  signal_strength: number;
}

export interface BeamPatternData {
  tower_id: number;
  angles: number[];
  magnitudes: number[];
  magnitudes_db?: number[];
}

export interface Simulator5GResponse {
  success: boolean;
  data?: {
    towers: Tower[];
    users: User[];
    beam_patterns: BeamPatternData[];
  };
  error?: string;
}

export function use5GSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (params: BeamformingParams): Promise<Simulator5GResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/5g`, {
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
      console.error("[5G API Error]", errorMsg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error };
}
