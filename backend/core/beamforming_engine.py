"""Main beamforming computation engine"""
import math
from typing import List
from dataclasses import dataclass, field

from .array_model import ArrayElement, create_linear_array
from .signal_model import array_factor_weighted, wave_number
from .noise_model import add_noise_to_array
from .interference_map import generate_interference_map, InterferenceMapData
from .window_functions import apply_window, WindowType


@dataclass
class BeamformingParams:
    num_elements: int
    spacing: float
    wavelength: float
    steering_angle_deg: float
    amplitude: float
    snr_db: float
    window_type: WindowType
    noise_enabled: bool
    apodization_enabled: bool


@dataclass
class BeamPattern:
    angles: List[float]
    magnitudes: List[float]
    magnitudes_db: List[float]


@dataclass
class BeamMetrics:
    beamwidth_deg: float
    sll_db: float
    main_lobe_angle_deg: float


@dataclass
class BeamformingResult:
    array: List[ArrayElement]
    beam_pattern: BeamPattern
    beam_pattern_no_steer: BeamPattern
    interference_map: InterferenceMapData
    metrics: BeamMetrics
    signal_profile: List[dict] = field(default_factory=list)


def deg_to_rad(deg: float) -> float:
    """Convert degrees to radians"""
    return (deg * math.pi) / 180


def compute_beam_pattern(
    params: BeamformingParams,
    steering_angle_deg: float
) -> BeamPattern:
    """Compute beam pattern for a given steering angle"""
    angles = []
    magnitudes = []
    magnitudes_db = []
    steer_rad = deg_to_rad(steering_angle_deg)
    
    # Choose apodization window
    if params.apodization_enabled:
        weights = apply_window(params.num_elements, params.window_type)
    else:
        weights = apply_window(params.num_elements, "rectangular")
    
    # Compute pattern over angular range
    for deg in [i * 0.5 for i in range(-180, 181)]:
        theta_rad = deg_to_rad(deg)
        af = array_factor_weighted(
            params.num_elements,
            params.spacing,
            params.wavelength,
            steer_rad,
            theta_rad,
            params.amplitude,
            weights
        )
        angles.append(deg)
        magnitudes.append(af)
        magnitudes_db.append(20 * math.log10(max(af, 1e-10)))
    
    return BeamPattern(angles, magnitudes, magnitudes_db)


def compute_metrics(beam_pattern: BeamPattern) -> BeamMetrics:
    """Compute beam metrics (beamwidth, sidelobe level, main lobe angle)"""
    max_mag = max(beam_pattern.magnitudes)
    max_idx = beam_pattern.magnitudes.index(max_mag)
    main_lobe_angle_deg = beam_pattern.angles[max_idx]
    half_power = max_mag / math.sqrt(2)
    
    # Find -3dB beamwidth
    left_idx = max_idx
    right_idx = max_idx
    
    while left_idx > 0 and beam_pattern.magnitudes[left_idx] > half_power:
        left_idx -= 1
    while right_idx < len(beam_pattern.magnitudes) - 1 and beam_pattern.magnitudes[right_idx] > half_power:
        right_idx += 1
    
    beamwidth_deg = beam_pattern.angles[right_idx] - beam_pattern.angles[left_idx]
    
    # Find SLL: peak of first sidelobe
    sidelobe_peak = 0
    
    # Search sidelobes on both sides
    for i in range(max(0, left_idx - 2)):
        sidelobe_peak = max(sidelobe_peak, beam_pattern.magnitudes[i])
    
    for i in range(right_idx + 2, len(beam_pattern.magnitudes)):
        sidelobe_peak = max(sidelobe_peak, beam_pattern.magnitudes[i])
    
    sll_db = 20 * math.log10(sidelobe_peak / max_mag) if sidelobe_peak > 0 else float('-inf')
    
    return BeamMetrics(abs(beamwidth_deg), sll_db, main_lobe_angle_deg)


def run_simulation(params: BeamformingParams) -> BeamformingResult:
    """Run complete beamforming simulation"""
    array = create_linear_array(params.num_elements, params.spacing, params.amplitude)
    steer_rad = deg_to_rad(params.steering_angle_deg)
    
    # Compute beam patterns
    beam_pattern = compute_beam_pattern(params, params.steering_angle_deg)
    beam_pattern_no_steer = compute_beam_pattern(params, 0)
    
    # Add noise if enabled
    if params.noise_enabled and params.snr_db < 100:
        beam_pattern.magnitudes = add_noise_to_array(beam_pattern.magnitudes, params.snr_db)
        beam_pattern.magnitudes_db = [20 * math.log10(max(m, 1e-10)) for m in beam_pattern.magnitudes]
    
    # Generate interference map
    interference_map = generate_interference_map(
        params.num_elements,
        params.spacing,
        params.wavelength,
        steer_rad,
        params.amplitude,
        params.snr_db if params.noise_enabled else 100
    )
    
    # Compute metrics
    metrics = compute_metrics(beam_pattern)
    
    # Compute signal profile: line cut at y=2 across x
    signal_profile = []
    k = wave_number(params.wavelength)
    offset = ((params.num_elements - 1) * params.spacing) / 2
    
    if params.apodization_enabled:
        weights = apply_window(params.num_elements, params.window_type)
    else:
        weights = apply_window(params.num_elements, "rectangular")
    
    for xi in range(80):
        px = -5 + (10 * xi) / 79
        py = 2
        real = 0
        imag = 0
        
        for n in range(params.num_elements):
            ex = n * params.spacing - offset
            dx = px - ex
            dist = math.sqrt(dx * dx + py * py)
            
            if dist < 0.001:
                continue
            
            steer_phase = k * n * params.spacing * math.sin(steer_rad)
            phase = k * dist - steer_phase
            amp = (params.amplitude * weights[n]) / math.sqrt(dist)
            real += amp * math.cos(phase)
            imag += amp * math.sin(phase)
        
        signal_profile.append({
            "position": px,
            "amplitude": math.sqrt(real * real + imag * imag)
        })
    
    return BeamformingResult(
        array,
        beam_pattern,
        beam_pattern_no_steer,
        interference_map,
        metrics,
        signal_profile
    )
