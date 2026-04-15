"""Radar Simulator for beamforming"""

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
class RadarTarget:
    angle_deg: float
    distance: float
    rcs: float  # radar cross section


@dataclass
class RadarScanResult:
    angles: List[float]
    returns: List[float]
    targets: List[RadarTarget]
    beam_width_deg: float


def simulate_radar(
    params: BeamformingParams,
    scan_speed_deg: float = 5,
    beam_width_deg: float = 10
) -> RadarScanResult:
    """Simulate radar scanning with beamforming"""
    targets = [
        RadarTarget(angle_deg=30, distance=4, rcs=1.0),
        RadarTarget(angle_deg=-45, distance=6, rcs=0.6),
        RadarTarget(angle_deg=70, distance=3, rcs=0.8),
        RadarTarget(angle_deg=-20, distance=8, rcs=0.4),
    ]
    
    angles = []
    returns = []
    steer_rad = params.steering_angle_deg * math.pi / 180
    
    # Scan across full azimuth
    for deg in range(-180, 180):
        theta_rad = deg * math.pi / 180
        angles.append(deg)
        
        return_signal = 0
        
        # Check each target
        for target in targets:
            target_rad = target.angle_deg * math.pi / 180
            angle_diff = abs(deg - target.angle_deg)
            
            # Beam pattern gain
            af = array_factor(
                params.num_elements,
                params.spacing,
                params.wavelength,
                steer_rad,
                target_rad,
                params.amplitude
            )
            
            # Gaussian beam shape
            beam_gain = math.exp(
                -(angle_diff * angle_diff) / (2 * (beam_width_deg / 2.35) ** 2)
            )
            
            # Radar equation: signal ∝ RCS / distance^2
            range_factor = target.rcs / (target.distance ** 2)
            return_signal += af * beam_gain * range_factor * params.amplitude
        
        return_signal = add_noise(return_signal, params.snr_db)
        returns.append(max(0, return_signal))
    
    return RadarScanResult(angles, returns, targets, beam_width_deg)
