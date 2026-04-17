"""Beamforming core engine package with OOP architecture"""

# Array model
from .array_model import ArrayElement, ArrayModel

# Signal model
from .signal_model import (
    SignalModel,
    wave_number,
    phase_shift,
    element_signal,
    array_factor,
    array_factor_weighted
)

# Noise model
from .noise_model import NoiseModel, gaussian_random, add_noise, add_noise_to_array

# Window functions
from .window_functions import WindowFunction, apply_window

# Interference map
from .interference_map import InterferenceMap, InterferenceMapResult

# Beamforming engine
from .beamforming_engine import (
    BeamformingEngine,
    BeamPattern,
    BeamMetrics,
    BeamformingResult
)

__all__ = [
    # Array model
    "ArrayElement",
    "ArrayModel",
    
    # Signal model
    "SignalModel",
    "wave_number",
    "phase_shift",
    "element_signal",
    "array_factor",
    "array_factor_weighted",
    
    # Noise model
    "NoiseModel",
    "gaussian_random",
    "add_noise",
    "add_noise_to_array",
    
    # Window functions
    "WindowFunction",
    "apply_window",
    
    # Interference map
    "InterferenceMap",
    "InterferenceMapResult",
    
    # Beamforming engine
    "BeamformingEngine",
    "BeamPattern",
    "BeamMetrics",
    "BeamformingResult"
]
