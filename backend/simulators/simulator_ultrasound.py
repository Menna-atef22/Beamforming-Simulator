"""Ultrasound Simulator for beamforming"""

import math
from typing import List
from dataclasses import dataclass

try:
    from ..core import BeamformingParams, array_factor, add_noise
except ImportError:
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from core import BeamformingParams, array_factor, add_noise


@dataclass
class UltrasoundResult:
    depths: List[float]
    amplitudes: List[float]
    reflections: List[dict]


def simulate_ultrasound(params: BeamformingParams) -> UltrasoundResult:
    """Simulate ultrasound imaging with beamforming"""
    max_depth = 15  # cm
    num_points = 300
    depths = []
    amplitudes = []
    steer_rad = params.steering_angle_deg * math.pi / 180
    
    # Tissue layers with reflections
    reflections = [
        {"depth": 3, "amplitude": 0.8},
        {"depth": 6.5, "amplitude": 0.5},
        {"depth": 9, "amplitude": 0.9},
        {"depth": 12, "amplitude": 0.3},
    ]
    
    for i in range(num_points):
        depth = (max_depth * i) / (num_points - 1)
        depths.append(depth)
        
        # Attenuation with depth
        signal = params.amplitude * math.exp(-0.15 * depth)
        
        # Beam focusing effect
        af = array_factor(
            params.num_elements,
            params.spacing,
            params.wavelength,
            steer_rad,
            steer_rad,
            params.amplitude
        )
        signal *= af
        
        # Add reflections as Gaussian pulses
        for ref in reflections:
            dist = abs(depth - ref["depth"])
            signal += ref["amplitude"] * math.exp(-(dist * dist) / 0.1)
        
        signal = add_noise(abs(signal), params.snr_db)
        amplitudes.append(max(0, signal))
    
    return UltrasoundResult(depths, amplitudes, reflections)
