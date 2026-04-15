import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import HeatmapView from "@/components/HeatmapView";
import BeamPlot from "@/components/BeamPlot";
import ComparisonView from "@/components/ComparisonView";
import SignalProfileView from "@/components/SignalProfileView";
import { useSimulationWithAPI } from "@/hooks/useSimulationWithAPI";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Home() {
  const { params, updateParam, result, isLoading, error } = useSimulationWithAPI(undefined, "api");

  if (error) {
    return (
      <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} metrics={result?.metrics} />}>
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  if (isLoading || !result) {
    return (
      <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} metrics={result?.metrics} />}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Running simulation...</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} metrics={result.metrics} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        <HeatmapView data={result.interferenceMap} title="Interference Heatmap" />
        <BeamPlot beamPattern={result.beamPattern} title="Beam Pattern (Main Lobe + Side Lobes)" />
        <ComparisonView before={result.beamPatternNoSteer} after={result.beamPattern} title="Before vs After (Steering + Apodization)" />
        <SignalProfileView data={result.signalProfile} title="Signal Profile (Line Cut at y=2)" />
      </div>
    </MainLayout>
  );
}
