/**
 * Hook for 5G network simulation API
 * Handles tower/user management and connectivity analysis
 */

import { useState, useCallback } from "react";
import type { FiveGParams, FiveGResult, Tower, User } from "../types/beamforming";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Type exports for components
export interface Simulator5GResponse {
  success: boolean;
  data: FiveGResult;
}
export type { Tower, User };

export function use5GSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (
    params: FiveGParams,
    _isInitialLoad?: boolean
  ): Promise<Simulator5GResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        num_elements: params.numElements ?? 16,
        spacing: params.spacing ?? 0.5,
        frequency: params.frequency ?? 28e9,
        snr_db: params.snrDb ?? 30,
        auto_steer: params.autoSteer !== false,
        enable_noise: params.enableNoise !== false,
        grid_size: params.gridSize ?? 80,
      };

      const response = await fetch(`${API_BASE}/api/simulate/5g`, {
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
      const data: FiveGResult = {
        towers: rawData.towers || [],
        users: rawData.users || [],
        connectivityMap: rawData.connectivity_map || [],
        networkCoverage: rawData.network_coverage || {},
        beamPatterns: rawData.beam_patterns || [],
      };
      
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("[use5GSimulatorAPI] Error:", message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { simulate, loading, error };
}
