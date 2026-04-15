"""Beamforming core engine package"""

from .array_model import ArrayElement, create_linear_array
from .signal_model import (
    wave_number,
    phase_shift,
    element_signal,
    array_factor,
    array_factor_weighted
)
from .noise_model import gaussian_random, add_noise, add_noise_to_array
from .window_functions import apply_window
from .interference_map import generate_interference_map, InterferenceMapData
from .beamforming_engine import (
    BeamformingParams,
    BeamPattern,
    BeamMetrics,
    BeamformingResult,
    compute_beam_pattern,
    compute_metrics,
    run_simulation,
    deg_to_rad
)

__all__ = [
    "ArrayElement",
    "create_linear_array",
    "wave_number",
    "phase_shift",
    "element_signal",
    "array_factor",
    "array_factor_weighted",
    "gaussian_random",
    "add_noise",
    "add_noise_to_array",
    "apply_window",
    "generate_interference_map",
    "InterferenceMapData",
    "BeamformingParams",
    "BeamPattern",
    "BeamMetrics",
    "BeamformingResult",
    "compute_beam_pattern",
    "compute_metrics",
    "run_simulation",
    "deg_to_rad"
]

