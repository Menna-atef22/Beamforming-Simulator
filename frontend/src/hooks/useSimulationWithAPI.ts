import { useState, useCallback, useEffect } from "react";
import { BeamformingParams, BeamformingResult } from "@/types/beamforming";
import { useBeamformingAPI } from "./useBeamformingAPI";

const defaultParams: BeamformingParams = {
  numElements: 8,
  spacing: 0.5,
  geometry: "linear",
  radius: 5,
  wavelength: 1.0,
  steeringAngleDeg: 0,
  amplitude: 1.0,
  snrDb: 30,
  windowType: "rectangular",
  noiseEnabled: true,
  apodizationEnabled: false,
};

export type SimulationMode = "api";

export function useSimulationWithAPI(
  initialParams?: Partial<BeamformingParams>,
  mode: SimulationMode = "api"
) {
  const [params, setParams] = useState<BeamformingParams>({
    ...defaultParams,
    ...initialParams,
  });

  const [result, setResult] = useState<BeamformingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useBeamformingAPI();

  // Run simulation when params change - FIXED: avoid api object in dependency
  useEffect(() => {
    let isMounted = true;
    
    const runSimulation = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await api.simulate({
          num_elements: params.numElements,
          spacing: params.spacing,
          geometry: params.geometry,
          radius: params.radius,
          wavelength: params.wavelength,
          steering_angle_deg: params.steeringAngleDeg,
          amplitude: params.amplitude,
          snr_db: params.snrDb,
          window_type: params.windowType,
          noise_enabled: params.noiseEnabled,
          apodization_enabled: params.apodizationEnabled,
        });

        if (!isMounted) return;

        if (response && response.success && response.data) {
          // Convert API response to BeamformingResult format
          const converted: BeamformingResult = {
            array: response.data.array,
            beamPattern: {
              angles: response.data.beam_pattern.angles,
              magnitudes: response.data.beam_pattern.magnitudes,
              magnitudesDb: response.data.beam_pattern.magnitudes_db,
            },
            beamPatternNoSteer: {
              angles: response.data.beam_pattern_no_steer.angles,
              magnitudes: response.data.beam_pattern_no_steer.magnitudes,
              magnitudesDb: response.data.beam_pattern_no_steer.magnitudes_db,
            },
            interferenceMap: {
              grid: response.data.interference_map.grid,
              xRange: response.data.interference_map.x_range,
              yRange: response.data.interference_map.y_range,
              maxVal: response.data.interference_map.max_val,
            },
            metrics: {
              beamwidthDeg: response.data.metrics.beamwidth_deg,
              sllDb: response.data.metrics.sll_db,
              mainLobeAngleDeg: response.data.metrics.main_lobe_angle_deg,
            },
            signalProfile: response.data.signal_profile,
          };
          setResult(converted);
        } else if (response?.error) {
          setError(response.error);
        } else {
          setError(api.error || "Simulation failed");
        }
      } catch (err) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Simulation failed";
          setError(msg);
          console.error("[Simulation Error]", msg);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    runSimulation();
    
    return () => {
      isMounted = false;
    };
  }, [params]); // FIXED: removed api from dependencies

  const updateParam = useCallback(
    <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return {
    params,
    setParams,
    updateParam,
    result,
    isLoading,
    error: error || api.error,
  };
}
