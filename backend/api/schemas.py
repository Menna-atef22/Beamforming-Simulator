"""Pydantic schemas for request/response validation"""

from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict

WindowType = Literal["rectangular", "hamming", "hanning", "blackman", "kaiser"]
ArrayGeometryType = Literal["linear", "curved"]


class BeamformingParamsSchema(BaseModel):
    """Request schema for beamforming simulation"""
    num_elements: int = Field(default=16, ge=1, le=256, description="Number of array elements")
    spacing: float = Field(default=0.5, gt=0, le=10, description="Element spacing in wavelengths")
    geometry: ArrayGeometryType = Field(default="linear", description="Array geometry type")
    radius: float = Field(default=5.0, ge=1.0, le=20.0, description="Curvature radius in wavelengths")
    # Accept either frequency (Hz) or wavelength (m) - service resolves precedence
    frequency: Optional[float] = Field(default=None, gt=0, description="Signal frequency in Hz (takes precedence over wavelength)")
    wavelength: Optional[float] = Field(default=None, gt=0, description="Signal wavelength in m (used only when frequency is absent)")
    steering_angle_deg: float = Field(default=0, ge=-90, le=90, description="Beam steering angle in degrees")
    amplitude: float = Field(default=1.0, gt=0, description="Signal amplitude")
    snr_db: float = Field(default=30, ge=-100, le=200, description="Signal-to-noise ratio in dB")
    window_type: WindowType = Field(default="rectangular", description="Apodization window type")
    noise_enabled: bool = Field(default=False, description="Enable noise simulation")
    apodization_enabled: bool = Field(default=False, description="Enable window function")
    profile_depth: Optional[float] = Field(default=None, gt=0, description="Profile depth in meters (line cut)")

    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 16,
                "spacing": 0.5,
                "geometry": "linear",
                "radius": 5.0,
                "frequency": 10e9,
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


class PhantomEllipseSchema(BaseModel):
    """Single Shepp-Logan ellipse parameter row."""
    intensity: float
    a: float
    b: float
    x0: float
    y0: float
    phi_deg: float


class UltrasoundPhantomSchema(BaseModel):
    """Phantom definition used by frontend visualization."""
    model: str
    domain: List[float]
    ellipses: List[PhantomEllipseSchema]


class UltrasoundBModeSchema(BaseModel):
    """B-mode response payload."""
    depths_mm: List[float]
    amplitudes: List[float]
    amplitudes_db: List[float]
    metrics: Dict[str, float]
    phantom: Optional[UltrasoundPhantomSchema] = None
    reflections: Optional[List[Dict[str, float]]] = None


class UltrasoundDopplerSchema(BaseModel):
    """Doppler response payload."""
    frequencies_hz: List[float]
    power: List[float]
    power_db: List[float]
    mean_velocity_mms: float
    max_velocity_mms: float
    pulsatility_index: float


class UltrasoundResponseSchema(BaseModel):
    """Ultrasound simulation response"""
    bmode: UltrasoundBModeSchema
    doppler: Optional[UltrasoundDopplerSchema] = None


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

class UserPositionSchema(BaseModel):
    """User position override for 5G simulation"""
    id: int
    x: float
    y: float


class TowerPositionSchema(BaseModel):
    """Tower position + per-tower parameter overrides for 5G simulation"""
    id: int
    x: float
    y: float
    num_elements: Optional[int] = Field(default=None, ge=4, le=64, description="Per-tower element count")
    spacing: Optional[float] = Field(default=None, gt=0, description="Per-tower spacing in wavelengths")
    frequency: Optional[float] = Field(default=None, gt=0, description="Per-tower frequency in Hz")
    steering_angle_deg: Optional[float] = Field(default=None, ge=-90, le=90, description="Per-tower steering angle")
    amplitude: Optional[float] = Field(default=None, gt=0, description="Per-tower amplitude")
    snr_db: Optional[float] = Field(default=None, ge=-100, le=200, description="Per-tower SNR in dB")
    window_type: Optional[WindowType] = Field(default=None, description="Per-tower window type")
    noise_enabled: Optional[bool] = Field(default=None, description="Per-tower noise toggle")
    apodization_enabled: Optional[bool] = Field(default=None, description="Per-tower apodization toggle")
    geometry: Optional[ArrayGeometryType] = Field(default=None, description="Per-tower geometry")
    radius: Optional[float] = Field(default=None, ge=1.0, le=200.0, description="Per-tower curvature radius in wavelengths")
    coverage_radius_m: Optional[float] = Field(default=None, gt=0, le=20, description="Per-tower coverage radius in m")


class FiveGParamsSchema(BaseModel):
    """5G simulation parameters"""
    num_elements: int = Field(default=16, ge=4, le=64, description="Antenna elements per tower")
    spacing: float = Field(default=0.5, gt=0, description="Element spacing in wavelengths")
    frequency: float = Field(default=28e9, gt=0, description="Operating frequency in Hz")
    snr_db: float = Field(default=30, ge=-100, le=200, description="SNR in dB")
    auto_steer: bool = Field(default=True, description="Auto-steer towers toward nearest user")
    enable_noise: bool = Field(default=False, description="Add noise to simulation")
    grid_size: int = Field(default=80, ge=16, le=360, description="Angle grid resolution")
    users: Optional[List[UserPositionSchema]] = Field(default=None, description="Custom user positions (overrides defaults)")
    towers: Optional[List[TowerPositionSchema]] = Field(default=None, description="Custom tower positions (overrides defaults)")
    current_connections: Optional[Dict[str, int]] = Field(default=None, description="Previous {user_id: tower_id} map for handoff hysteresis")
    
    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 16,
                "spacing": 0.5,
                "frequency": 28e9,
                "snr_db": 30,
                "auto_steer": True,
                "enable_noise": False,
                "grid_size": 80,
                "users": [{"id": 101, "x": 1.0, "y": 3.0}, {"id": 102, "x": -2.0, "y": 4.0}]
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
    window_type: WindowType = Field(default="rectangular", description="Apodization window type")
    steering_angle_deg: float = Field(default=0, ge=-90, le=90, description="Beam steering angle in degrees")
    max_depth_mm: float = Field(default=100, gt=0, description="Maximum imaging depth in mm")
    num_samples: int = Field(default=512, ge=128, le=2048, description="Depth sample points")
    enable_noise: bool = Field(default=True, description="Add thermal noise")
    enable_speckle: bool = Field(default=True, description="Add speckle pattern")
    run_doppler: bool = Field(default=False, description="Compute Doppler imaging")
    target_depth_mm: float = Field(default=50, gt=0, description="Doppler imaging depth in mm")
    probe_param_rad: Optional[float] = Field(
        default=None,
        description="Probe placement parameter in radians along phantom outer boundary"
    )
    phantom_regions: Optional[List[Dict[str, float | int | str]]] = Field(
        default=None,
        description="Optional editable phantom regions with geometric and acoustic properties"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "num_elements": 64,
                "spacing": 0.3,
                "frequency": 5e6,
                "snr_db": 25,
                "window_type": "rectangular",
                "steering_angle_deg": 0,
                "max_depth_mm": 100,
                "num_samples": 512,
                "enable_noise": True,
                "enable_speckle": True,
                "run_doppler": False,
                "target_depth_mm": 50
            }
        }