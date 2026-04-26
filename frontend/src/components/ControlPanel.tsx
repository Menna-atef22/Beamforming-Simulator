import {
  BeamformingParams,
  BeamMetrics,
  WindowType,
} from "@/types/beamforming";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ControlPanelProps {
  params: BeamformingParams;
  onParamChange: <K extends keyof BeamformingParams>(
    key: K,
    value: BeamformingParams[K],
  ) => void;
  metrics?: BeamMetrics;
  extra?: React.ReactNode;
  sliderLabels?: Partial<Record<"amplitude" | "profileDepth", string>>;
  hiddenSliders?: Partial<Record<"amplitude" | "profileDepth", boolean>>;
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`space-y-1.5 ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}>
      <div className="flex justify-between items-center">
        <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {label}
        </Label>
        <span className="text-xs font-mono text-foreground tabular-nums">
          {value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}
          {unit && <span className="text-muted-foreground ml-0.5">{unit}</span>}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        className={disabled ? "pointer-events-none" : "cursor-pointer"}
      />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <div className="w-1.5 h-1.5 rounded-full beam-gradient" />
      <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
    </div>
  );
}

export default function ControlPanel({
  params,
  onParamChange,
  metrics,
  extra,
  sliderLabels,
  hiddenSliders,
}: ControlPanelProps) {
  const c = 3e8;
  const rawWavelength = params.wavelength ?? undefined;
  const rawFrequencyGhz = params.frequency ?? undefined; // frontend frequency stored as GHz
  const wavelengthFromFreq = rawFrequencyGhz ? c / (Number(rawFrequencyGhz) * 1e9) : undefined;
  const wavelength = Math.max(1e-6, Number(rawWavelength ?? wavelengthFromFreq ?? 1.0));
  const steeringRad = ((params.steeringAngleDeg ?? 0) * Math.PI) / 180;
  const rawPhase =
    ((2 * Math.PI) / wavelength) *
    (params.spacing ?? 0.5) *
    Math.sin(steeringRad);
  // Normalise to [-π, +π]
  const phaseShift = (((rawPhase + Math.PI) % (2 * Math.PI)) - Math.PI).toFixed(3);
  const geometry = params.geometry ?? "linear";

  return (
    <div className="p-4 space-y-3 h-full overflow-y-auto bg-card/60">
      {/* Title */}
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full beam-gradient" />
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">
          Parameters
        </h2>
      </div>

      {/* Beamforming Controls */}
      <SectionHeader title="Beamforming" />
      <SliderControl
        label="Elements (N)"
        value={params.numElements}
        min={2}
        max={32}
        step={1}
        onChange={(v) => onParamChange("numElements", v)}
      />
      <SliderControl
        label="Spacing (d/λ)"
        value={params.spacing}
        min={0.1}
        max={2.0}
        step={0.05}
        unit="λ"
        onChange={(v) => onParamChange("spacing", v)}
      />
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Geometry
          </Label>
          <span className="text-xs font-mono text-foreground capitalize">
            {geometry}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant={geometry === "linear" ? "default" : "secondary"}
            className="h-8 text-[10px] font-mono uppercase tracking-wider"
            onClick={() => onParamChange("geometry", "linear")}
          >
            Linear
          </Button>
          <Button
            type="button"
            size="sm"
            variant={geometry === "curved" ? "default" : "secondary"}
            className="h-8 text-[10px] font-mono uppercase tracking-wider"
            onClick={() => onParamChange("geometry", "curved")}
          >
            Curved
          </Button>
        </div>
      </div>
      {geometry === "curved" && (
        <SliderControl
          label="Radius (R)"
          value={params.radius ?? 5}
          min={1}
          max={20}
          step={0.1}
          unit="λ"
          onChange={(v) => onParamChange("radius", v)}
        />
      )}
      <SliderControl
        label="Frequency"
        value={params.frequency ?? 1.0}
        min={0.1}
        max={30.0}
        step={0.01}
        unit="GHz"
        onChange={(v) => onParamChange("frequency", v)}
      />
      <SliderControl
        label="Steering (θ)"
        value={params.steeringAngleDeg ?? 0}
        min={params.scanRangeDeg === 360 ? 0 : -90}
        max={params.scanRangeDeg === 360 ? 360 : 90}
        step={1}
        unit="°"
        disabled={params.autoSteer}
        onChange={(v) => onParamChange("steeringAngleDeg", v)}
      />
      {!hiddenSliders?.amplitude && (
        <SliderControl
          label={sliderLabels?.amplitude ?? "Amplitude"}
          value={params.amplitude}
          min={0.1}
          max={2.0}
          step={0.05}
          onChange={(v) => onParamChange("amplitude", v)}
        />
      )}

      {!hiddenSliders?.profileDepth && (
        <SliderControl
          label={sliderLabels?.profileDepth ?? "Profile Depth"}
          value={params.profileDepth ?? 2.0}
          min={0.1}
          max={100}
          step={0.1}
          unit="m"
          onChange={(v) => onParamChange("profileDepth", v)}
        />
      )}

      {/* Signal Quality */}
      <SectionHeader title="Signal Quality" />
      <SliderControl
        label="SNR"
        value={params.snrDb}
        min={0}
        max={60}
        step={1}
        unit="dB"
        onChange={(v) => onParamChange("snrDb", v)}
      />
      <div className="flex justify-between items-center py-1">
        <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Phase Shift
        </Label>
        <span className="text-xs font-mono text-foreground tabular-nums">
          {phaseShift} rad
        </span>
      </div>

      {/* Windowing */}
      <SectionHeader title="Windowing" />
      <Select
        value={params.windowType}
        onValueChange={(v) => onParamChange("windowType", v as WindowType)}
      >
        <SelectTrigger className="h-8 text-xs font-mono bg-secondary/50 border-border/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="rectangular">Rectangular</SelectItem>
          <SelectItem value="hamming">Hamming</SelectItem>
          <SelectItem value="hanning">Hanning</SelectItem>
          <SelectItem value="blackman">Blackman</SelectItem>
          <SelectItem value="kaiser">Kaiser</SelectItem>
        </SelectContent>
      </Select>

      {/* Toggles */}
      <SectionHeader title="Toggles" />
      <div className="flex justify-between items-center py-1">
        <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Noise
        </Label>
        <Switch
          checked={params.noiseEnabled}
          onCheckedChange={(v) => onParamChange("noiseEnabled", v)}
        />
      </div>
      <div className="flex justify-between items-center py-1">
        <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Apodization
        </Label>
        <Switch
          checked={params.apodizationEnabled}
          onCheckedChange={(v) => onParamChange("apodizationEnabled", v)}
        />
      </div>

      {/* Outputs */}
      {metrics && (
        <>
          <SectionHeader title="Outputs" />
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-[9px] font-mono text-muted-foreground uppercase">
                Beamwidth
              </div>
              <div className="text-sm font-mono font-bold text-foreground">
                {metrics.beamwidthDeg.toFixed(1)}°
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-2 text-center">
              <div className="text-[9px] font-mono text-muted-foreground uppercase">
                SLL
              </div>
              <div className="text-sm font-mono font-bold text-foreground">
                {isFinite(metrics.sllDb) ? metrics.sllDb.toFixed(1) : "—"} dB
              </div>
            </div>
          </div>
        </>
      )}

      {extra && (
        <div className="pt-2 border-t border-border/50 space-y-3">{extra}</div>
      )}
    </div>
  );
}
