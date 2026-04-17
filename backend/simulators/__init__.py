"""Simulators package - specialized simulation modules with OOP architecture"""

# 5G Network Simulator
from .simulator_5g import (
    Simulator5G,
    Tower,
    User,
    TowerConnectivityInfo,
    FiveGResult
)

# Radar Simulator
from .simulator_radar import (
    SimulatorRadar,
    RadarTarget,
    DetectedPeak,
    RadarScanResult
)

# Ultrasound Simulator
from .simulator_ultrasound import (
    SimulatorUltrasound,
    TissueLayer,
    Scatterer,
    UltrasoundBModeResult,
    UltrasoundDopplerResult
)

__all__ = [
    # 5G Simulator exports
    "Simulator5G",
    "Tower",
    "User",
    "TowerConnectivityInfo",
    "FiveGResult",
    
    # Radar Simulator exports
    "SimulatorRadar",
    "RadarTarget",
    "DetectedPeak",
    "RadarScanResult",
    
    # Ultrasound Simulator exports
    "SimulatorUltrasound",
    "TissueLayer",
    "Scatterer",
    "UltrasoundBModeResult",
    "UltrasoundDopplerResult"
]
