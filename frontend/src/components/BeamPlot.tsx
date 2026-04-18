import { BeamPattern } from "@/types/beamforming";
import PolarPlot from "./PolarPlot";

interface BeamPlotProps {
  beamPattern: BeamPattern;
  title?: string;
  useDb?: boolean;
}

export default function BeamPlot({ beamPattern, title = "Beam Pattern", useDb = false }: BeamPlotProps) {
  return (
    <PolarPlot
      angles={beamPattern.angles}
      magnitudes={beamPattern.magnitudes}
      magnitudesDb={beamPattern.magnitudesDb}
      useDb={useDb}
      title={title}
    />
  );
}
