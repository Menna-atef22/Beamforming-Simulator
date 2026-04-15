"""5G Simulator for beamforming"""

import math
from typing import List
from dataclasses import dataclass

try:
    from ..core import BeamformingParams, compute_beam_pattern
except ImportError:
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from core import BeamformingParams, compute_beam_pattern


@dataclass
class Tower:
    id: int
    x: float
    y: float
    steering_angle_deg: float


@dataclass
class User:
    id: int
    x: float
    y: float
    signal_strength: float = 0


@dataclass
class FiveGResult:
    towers: List[Tower]
    users: List[User]
    beam_patterns: List[dict]


def simulate_5g(params: BeamformingParams) -> FiveGResult:
    """Simulate 5G beam steering and coverage"""
    towers = [
        Tower(id=1, x=-3, y=0, steering_angle_deg=20),
        Tower(id=2, x=0, y=0, steering_angle_deg=-10),
        Tower(id=3, x=3, y=0, steering_angle_deg=35),
    ]
    
    users = [
        User(id=1, x=1, y=3, signal_strength=0),
        User(id=2, x=-2, y=4, signal_strength=0),
    ]
    
    beam_patterns = []
    
    # Compute beam patterns and steer toward nearest user
    for tower in towers:
        min_dist = float('inf')
        best_angle = 0
        
        for user in users:
            dx = user.x - tower.x
            dy = user.y - tower.y
            dist = math.sqrt(dx * dx + dy * dy)
            
            if dist < min_dist:
                min_dist = dist
                best_angle = math.atan2(dx, dy) * 180 / math.pi
        
        tower.steering_angle_deg = best_angle
        
        bp = compute_beam_pattern(params, best_angle)
        beam_patterns.append({
            "tower_id": tower.id,
            "angles": bp.angles,
            "magnitudes": bp.magnitudes
        })
    
    # Calculate signal strength for each user
    for user in users:
        total_signal = 0
        
        for tower in towers:
            dx = user.x - tower.x
            dy = user.y - tower.y
            dist = math.sqrt(dx * dx + dy * dy)
            angle_deg = math.atan2(dx, dy) * 180 / math.pi
            
            bp = compute_beam_pattern(params, tower.steering_angle_deg)
            
            # Find beam gain at user angle
            gain = 0
            for i, angle in enumerate(bp.angles):
                if abs(angle - angle_deg) < 1:
                    gain = bp.magnitudes[i]
                    break
            
            total_signal += (gain * params.amplitude) / max(dist, 0.1)
        
        user.signal_strength = total_signal
    
    return FiveGResult(towers, users, beam_patterns)
