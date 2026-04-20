import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import HeatmapView from "@/components/HeatmapView";
import BeamPlot from "@/components/BeamPlot";
import ComparisonView from "@/components/ComparisonView";
import SignalProfileView from "@/components/SignalProfileView";
import { useDebounce } from "@/hooks/useDebounce";
import { useBeamformingAPI } from "@/hooks/useBeamformingAPI";
import { BeamformingParams } from "@/types/beamforming";
import { BeamformingResult } from "@/types/beamforming";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState, useRef, useEffect } from "react";
import "./Home.css";

export default function Home() {
  const [params, setParams] = useState<BeamformingParams>({
    numElements: 8,
    spacing: 0.5,
    wavelength: 1.0,
    steeringAngleDeg: 0,
    amplitude: 1.0,
    snrDb: 30,
    windowType: "rectangular",
    noiseEnabled: true,
    apodizationEnabled: false,
  });
  
  const debouncedParams = useDebounce(params, 300);
  const isInitialLoadRef = useRef(true);
  const [result, setResult] = useState<BeamformingResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { simulate, error: apiError } = useBeamformingAPI();

  // Run simulation when debounced params change - FIXED: no state in deps
  useEffect(() => {
    let isMounted = true;
    
    const runSim = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await simulate({
          num_elements: debouncedParams.numElements,
          spacing: debouncedParams.spacing,
          wavelength: debouncedParams.wavelength,
          steering_angle_deg: debouncedParams.steeringAngleDeg,
          amplitude: debouncedParams.amplitude,
          snr_db: debouncedParams.snrDb,
          window_type: debouncedParams.windowType,
          noise_enabled: debouncedParams.noiseEnabled,
          apodization_enabled: debouncedParams.apodizationEnabled,
        });
        
        if (!isMounted) return;
        
        if (res?.success && res?.data) {
          const converted: BeamformingResult = {
            array: res.data.array,
            beamPattern: {
              angles: res.data.beam_pattern.angles,
              magnitudes: res.data.beam_pattern.magnitudes,
              magnitudesDb: res.data.beam_pattern.magnitudes_db,
            },
            beamPatternNoSteer: {
              angles: res.data.beam_pattern_no_steer.angles,
              magnitudes: res.data.beam_pattern_no_steer.magnitudes,
              magnitudesDb: res.data.beam_pattern_no_steer.magnitudes_db,
            },
            interferenceMap: {
              grid: res.data.interference_map.grid,
              xRange: res.data.interference_map.x_range,
              yRange: res.data.interference_map.y_range,
              maxVal: res.data.interference_map.max_val,
            },
            metrics: {
              beamwidthDeg: res.data.metrics.beamwidth_deg,
              sllDb: res.data.metrics.sll_db,
              mainLobeAngleDeg: res.data.metrics.main_lobe_angle_deg,
            },
            signalProfile: res.data.signal_profile,
          };
          setResult(converted);
          isInitialLoadRef.current = false;
        } else {
          setError(res.error || apiError || "Simulation failed");
        }
      } catch (err) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Simulation failed";
          setError(msg);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    runSim();
    return () => {
      isMounted = false;
    };
  }, [debouncedParams, simulate]);

  const updateParam = <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  if (error && isInitialLoadRef.current) {
    return (
      <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} metrics={result?.metrics} />}>
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  return (
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} metrics={result?.metrics} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full relative">
        {isInitialLoadRef.current && (
          <div className="absolute inset-0 flex items-center justify-center z-20 rounded home-loading-overlay">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Running simulation...</p>
            </div>
          </div>
        )}
        
        {result ? (
          <>
            <HeatmapView data={result.interferenceMap} title="Interference Heatmap" />
            <BeamPlot beamPattern={result.beamPattern} title="Beam Pattern (Main Lobe + Side Lobes)" />
            <ComparisonView before={result.beamPatternNoSteer} after={result.beamPattern} title="Before vs After (Steering + Apodization)" />
            <SignalProfileView data={result.signalProfile} title="Signal Profile (Line Cut at y=2)" />
          </>
        ) : (
          <>
            <div className="glass-panel p-3" />
            <div className="glass-panel p-3" />
            <div className="glass-panel p-3" />
            <div className="glass-panel p-3" />
          </>
        )}
      </div>
    </MainLayout>
  );
}
