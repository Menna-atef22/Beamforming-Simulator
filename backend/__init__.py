"""Beam Weaver Backend Package - Beamforming simulator for 5G, Radar, and Ultrasound"""

__version__ = "0.1.0"

# Core beamforming components
from .core import (
    BeamformingEngine,
    ArrayModel,
    SignalModel,
    NoiseModel,
    WindowFunction,
    BeamformingResult,
    BeamPattern,
    BeamMetrics
)

# Specialized simulators
from .simulators import (
    Simulator5G,
    SimulatorRadar,
    SimulatorUltrasound,
    Tower,
    User,
    RadarTarget,
    TissueLayer,
    Scatterer
)

__all__ = [
    # Core components
    "BeamformingEngine",
    "ArrayModel",
    "SignalModel",
    "NoiseModel",
    "WindowFunction",
    "BeamformingResult",
    "BeamPattern",
    "BeamMetrics",
    
    # Simulators
    "Simulator5G",
    "SimulatorRadar",
    "SimulatorUltrasound",
    
    # 5G types
    "Tower",
    "User",
    
    # Radar types
    "RadarTarget",
    
    # Ultrasound types
    "TissueLayer",
    "Scatterer"
]
