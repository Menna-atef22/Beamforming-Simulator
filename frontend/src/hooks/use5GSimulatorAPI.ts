/**
 * Hook for 5G network simulation API
 * Handles tower/user management and connectivity analysis
 */

import { useState, useCallback } from "react";
import type { FiveGParams, FiveGResult, Tower, User } from "../types/beamforming";
import { apiFetch } from "@/lib/apiClient";

// Type exports for components
export interface Simulator5GResponse {
  success: boolean;
  data: FiveGResult;
}
export type { Tower, User };

export interface UserPosition { id: number; x: number; y: number; }
export interface TowerPosition { id: number; x: number; y: number; }

export function use5GSimulatorAPI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulate = useCallback(async (
    params: FiveGParams & Record<string, any>,
    _isInitialLoad?: boolean
  ): Promise<Simulator5GResponse | null> => {
    setLoading(true);
    setError(null);

    try {
      const requestBody: Record<string, any> = {
        num_elements: params.numElements ?? 16,
        spacing: params.spacing ?? 0.5,
        frequency: params.frequency ?? 28e9,
        snr_db: params.snrDb ?? 30,
        auto_steer: params.autoSteer !== false,
        enable_noise: params.enableNoise !== false,
        grid_size: params.gridSize ?? 80,
      };

      // Forward custom user/tower positions if present
      if (params.users) requestBody.users = params.users;
      if (params.towers) requestBody.towers = params.towers;
      // Forward previous connection state for handoff hysteresis
      if (params.current_connections) requestBody.current_connections = params.current_connections;

      const response = await apiFetch("/api/simulate/5g", {
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
