/**
 * Reusable parameter slider with label, value display, and optional numeric input
 */
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  showInput?: boolean;
}

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
  showInput = true,
}: ParameterSliderProps) {
  const [inputVal, setInputVal] = useState("");
  const [editing, setEditing] = useState(false);
  const displayVal = Number.isInteger(step) ? String(value) : value.toFixed(2);

  const commitInput = () => {
    setEditing(false);
    const n = parseFloat(inputVal);
    if (!isNaN(n)) {
      onChange(Math.max(min, Math.min(max, n)));
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="sim-param-label truncate">{label}</span>
        {showInput && editing ? (
          <input
            autoFocus
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={commitInput}
            onKeyDown={(e) => e.key === "Enter" && commitInput()}
            className="w-16 rounded bg-input px-1.5 py-0.5 text-right text-xs text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            min={min}
            max={max}
            step={step}
          />
        ) : (
          <span
            className="sim-param-value cursor-pointer hover:text-primary transition-colors"
            onClick={() => {
              setEditing(true);
              setInputVal(displayVal);
            }}
            title="Click to edit"
          >
            {displayVal}
            {unit && <span className="text-muted-foreground ml-0.5 text-[0.65rem]">{unit}</span>}
          </span>
        )}
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
