import { useState, useCallback } from "react";
import { BeamformingParams } from "@/types/beamforming";

const API_BASE = "http://localhost:5000";

export interface UltrasoundReflection {
  depth: number;
  intensity: number;
  tissue: string;
}

export interface SimulatorUltrasoundResponse {
  success: boolean;
  data?: {
    depths: number[];
    amplitudes: number[];
    reflections: UltrasoundReflection[];
  };
  error?: string;
}

export function useUltrasoundSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (params: BeamformingParams): Promise<SimulatorUltrasoundResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/ultrasound`, {
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
      console.error("[Ultrasound API Error]", errorMsg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error };
}
