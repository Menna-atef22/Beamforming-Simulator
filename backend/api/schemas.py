"""Pydantic schemas for request/response validation"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal

WindowType = Literal["rectangular", "hamming", "hanning", "blackman", "kaiser"]


class BeamformingParamsSchema(BaseModel):
    """Request schema for beamforming simulation"""
    num_elements: int = Field(default=16, ge=1, le=256, description="Number of array elements")
    spacing: float = Field(default=0.5, gt=0, le=10, description="Element spacing in wavelengths")
    wavelength: float = Field(default=1.0, gt=0, description="Signal wavelength")
    steering_angle_deg: float = Field(default=0, ge=-90, le=90, description="Beam steering angle in degrees")
    amplitude: float = Field(default=1.0, gt=0, description="Signal amplitude")
    snr_db: float = Field(default=30, ge=-100, le=200, description="Signal-to-noise ratio in dB")
    window_type: WindowType = Field(default="rectangular", description="Apodization window type")
    noise_enabled: bool = Field(default=False, description="Enable noise simulation")
    apodization_enabled: bool = Field(default=False, description="Enable window function")

    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 16,
                "spacing": 0.5,
                "wavelength": 1.0,
                "steering_angle_deg": 30,
                "amplitude": 1.0,
                "snr_db": 30,
                "window_type": "hamming",
                "noise_enabled": True,
                "apodization_enabled": True,
            }
        }


class ArrayElementSchema(BaseModel):
    """Array element representation"""
    index: int
    x: float
    y: float
    amplitude: float
    phase: float


class BeamPatternSchema(BaseModel):
    """Beam pattern data"""
    angles: List[float]
    magnitudes: List[float]
    magnitudes_db: List[float]


class BeamMetricsSchema(BaseModel):
    """Beam metrics"""
    beamwidth_deg: float
    sll_db: float
    main_lobe_angle_deg: float


class InterferenceMapSchema(BaseModel):
    """2D interference map"""
    grid: List[List[float]]
    x_range: List[float]
    y_range: List[float]
    max_val: float


class SignalProfilePointSchema(BaseModel):
    """Signal profile point"""
    position: float
    amplitude: float


class BeamformingResponseSchema(BaseModel):
    """Response schema for beamforming simulation"""
    array: List[ArrayElementSchema]
    beam_pattern: BeamPatternSchema
    beam_pattern_no_steer: BeamPatternSchema
    interference_map: InterferenceMapSchema
    metrics: BeamMetricsSchema
    signal_profile: List[SignalProfilePointSchema]


class BeamformingResultSchema(BaseModel):
    """Full beamforming result"""
    success: bool
    data: Optional[BeamformingResponseSchema] = None
    error: Optional[str] = None


# 5G Schemas
class TowerSchema(BaseModel):
    """5G Tower"""
    id: int
    x: float
    y: float
    steering_angle_deg: float


class UserSchema(BaseModel):
    """5G User"""
    id: int
    x: float
    y: float
    signal_strength: float


class BeamPatternTowerSchema(BaseModel):
    """Beam pattern for tower"""
    tower_id: int
    angles: List[float]
    magnitudes: List[float]
    magnitudes_db: Optional[List[float]] = None


class FiveGResponseSchema(BaseModel):
    """5G simulation response"""
    towers: List[TowerSchema]
    users: List[UserSchema]
    beam_patterns: List[BeamPatternTowerSchema]


class FiveGResultSchema(BaseModel):
    """5G result"""
    success: bool
    data: Optional[FiveGResponseSchema] = None
    error: Optional[str] = None


# Radar Schemas
class RadarTargetSchema(BaseModel):
    """Radar target"""
    id: int
    angle: float
    range: float
    velocity: float
    rcs: float


class RadarResponseSchema(BaseModel):
    """Radar simulation response"""
    angles: List[float]
    returns: List[float]
    targets: List[RadarTargetSchema]
    beam_width_deg: float


class RadarResultSchema(BaseModel):
    """Radar result"""
    success: bool
    data: Optional[RadarResponseSchema] = None
    error: Optional[str] = None


# Ultrasound Schemas
class ReflectionSchema(BaseModel):
    """Tissue reflection"""
    depth: float
    amplitude: float


class UltrasoundResponseSchema(BaseModel):
    """Ultrasound simulation response"""
    depths: List[float]
    amplitudes: List[float]
    reflections: List[ReflectionSchema]


class UltrasoundResultSchema(BaseModel):
    """Ultrasound result"""
    success: bool
    data: Optional[UltrasoundResponseSchema] = None
    error: Optional[str] = None


# Error response
class ErrorResponseSchema(BaseModel):
    """Error response"""
    success: bool = False
    error: str


# ============================================================================
# New Parameter Schemas for OOP Simulators
# ============================================================================

class FiveGParamsSchema(BaseModel):
    """5G simulation parameters"""
    num_elements: int = Field(default=16, ge=4, le=64, description="Antenna elements per tower")
    spacing: float = Field(default=0.5, gt=0, description="Element spacing in wavelengths")
    frequency: float = Field(default=28e9, gt=0, description="Operating frequency in Hz")
    snr_db: float = Field(default=30, ge=-100, le=200, description="SNR in dB")
    auto_steer: bool = Field(default=True, description="Auto-steer towers toward nearest user")
    enable_noise: bool = Field(default=False, description="Add noise to simulation")
    grid_size: int = Field(default=80, ge=16, le=360, description="Angle grid resolution")
    
    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 16,
                "spacing": 0.5,
                "frequency": 28e9,
                "snr_db": 30,
                "auto_steer": True,
                "enable_noise": False,
                "grid_size": 80
            }
        }


class RadarParamsSchema(BaseModel):
    """Radar simulation parameters"""
    num_elements: int = Field(default=32, ge=8, le=128, description="Antenna elements")
    spacing: float = Field(default=0.5, gt=0, description="Element spacing in wavelengths")
    frequency: float = Field(default=10e9, gt=0, description="Operating frequency in Hz")
    snr_db: float = Field(default=15, ge=-100, le=200, description="SNR in dB")
    steering_angle_deg: float = Field(default=0, ge=-180, le=180, description="Beam steering angle")
    scan_range_deg: float = Field(default=360, gt=0, le=360, description="Angular scan range")
    enable_noise: bool = Field(default=True, description="Add noise and clutter")
    grid_size: int = Field(default=360, ge=64, le=1024, description="Angle bins")
    compute_doppler: bool = Field(default=True, description="Compute Doppler map")
    
    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 32,
                "spacing": 0.5,
                "frequency": 10e9,
                "snr_db": 15,
                "steering_angle_deg": 0,
                "scan_range_deg": 360,
                "enable_noise": True,
                "grid_size": 360,
                "compute_doppler": True
            }
        }


class UltrasoundParamsSchema(BaseModel):
    """Ultrasound simulation parameters"""
    num_elements: int = Field(default=64, ge=32, le=256, description="Array elements")
    spacing: float = Field(default=0.3, gt=0, description="Element spacing in wavelengths")
    frequency: float = Field(default=5e6, gt=0, description="Ultrasound frequency in Hz")
    snr_db: float = Field(default=25, ge=-100, le=200, description="SNR in dB")
    steering_angle_deg: float = Field(default=0, ge=-90, le=90, description="Beam steering angle in degrees")
    max_depth_mm: float = Field(default=100, gt=0, description="Maximum imaging depth in mm")
    num_samples: int = Field(default=512, ge=128, le=2048, description="Depth sample points")
    enable_noise: bool = Field(default=True, description="Add thermal noise")
    enable_speckle: bool = Field(default=True, description="Add speckle pattern")
    run_doppler: bool = Field(default=False, description="Compute Doppler imaging")
    target_depth_mm: float = Field(default=50, gt=0, description="Doppler imaging depth in mm")
    
    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 64,
                "spacing": 0.3,
                "frequency": 5e6,
                "snr_db": 25,
                "steering_angle_deg": 0,
                "max_depth_mm": 100,
                "num_samples": 512,
                "enable_noise": True,
                "enable_speckle": True,
                "run_doppler": False,
                "target_depth_mm": 50
            }
        }
