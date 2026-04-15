import { useState, useCallback } from "react";

const API_BASE = "http://localhost:5000";

export interface BeamformingRequest {
  num_elements: number;
  spacing: number;
  wavelength: number;
  steering_angle_deg: number;
  amplitude: number;
  snr_db: number;
  window_type: "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";
  noise_enabled: boolean;
  apodization_enabled: boolean;
}

export interface BeamformingResponse {
  success: boolean;
  data?: {
    array: Array<{ index: number; x: number; y: number; amplitude: number; phase: number }>;
    beam_pattern: { angles: number[]; magnitudes: number[]; magnitudes_db: number[] };
    beam_pattern_no_steer: { angles: number[]; magnitudes: number[]; magnitudes_db: number[] };
    interference_map: { grid: number[][]; x_range: number[]; y_range: number[]; max_val: number };
    metrics: { beamwidth_deg: number; sll_db: number; main_lobe_angle_deg: number };
    signal_profile: Array<{ position: number; amplitude: number }>;
  };
  error?: string;
}

export function useBeamformingAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (params: BeamformingRequest): Promise<BeamformingResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/beamforming`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: BeamformingResponse = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("API Error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const simulate5G = useCallback(async (params: BeamformingRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/5g`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const simulateRadar = useCallback(async (params: BeamformingRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/radar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const simulateUltrasound = useCallback(async (params: BeamformingRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/simulate/ultrasound`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    simulate,
    simulate5G,
    simulateRadar,
    simulateUltrasound,
  };
}
