import { BeamPattern } from "@/types/beamforming";
import PolarPlot from "./PolarPlot";

interface BeamSeries {
  id?: number | string;
  angles: number[];
  magnitudes: number[];
  magnitudesDb?: number[];
  color?: string;
  label?: string;
}

interface BeamPlotProps {
  beamPattern: BeamPattern;
  beamPatterns?: BeamSeries[];
  title?: string;
  useDb?: boolean;
}

export default function BeamPlot({ beamPattern, beamPatterns, title = "Beam Pattern", useDb = false }: BeamPlotProps) {
  return (
    <PolarPlot
      angles={beamPattern.angles}
      magnitudes={beamPattern.magnitudes}
      magnitudesDb={beamPattern.magnitudesDb}
      series={beamPatterns}
      useDb={useDb}
      title={title}
    />
  );
}
