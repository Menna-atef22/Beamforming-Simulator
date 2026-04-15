// This component is no longer used - replaced by SignalProfileView
// Kept for backwards compatibility
import { ArrayElement } from "@/types/beamforming";

interface ExtraViewProps {
  array: ArrayElement[];
  steeringAngleDeg: number;
  title?: string;
}

export default function ExtraView({ array, steeringAngleDeg, title }: ExtraViewProps) {
  return null;
}
