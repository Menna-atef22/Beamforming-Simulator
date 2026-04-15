from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


WindowType = Literal["rectangular", "hamming", "hann", "blackman", "tukey"]


class BeamformingRequest(BaseModel):
    num_elements: int = Field(default=16, ge=2, le=128)
    element_spacing_m: float = Field(default=0.06, gt=0.001, le=1.0)
    carrier_frequency_hz: float = Field(default=3.5e9, gt=1e3, le=2e10)
    steering_angle_deg: float = Field(default=10.0, ge=-89.0, le=89.0)
    phase_offset_deg: float = Field(default=0.0, ge=-360.0, le=360.0)
    amplitude: float = Field(default=1.0, gt=0.01, le=20.0)
    aperture_m: float = Field(default=1.2, gt=0.1, le=20.0)
    sample_points: int = Field(default=90, ge=40, le=220)
    view_extent_m: float = Field(default=15.0, gt=1.0, le=1000.0)
    window_type: WindowType = "hann"
    apodization_alpha: float = Field(default=0.35, ge=0.0, le=1.0)
    snr: float = Field(default=50.0, ge=0.0, le=1000.0)


class BeamformingResponse(BaseModel):
    x_axis: list[float]
    y_axis: list[float]
    constructive_map: list[list[float]]
    beam_angles_deg: list[float]
    beam_profile_db: list[float]
    main_lobe_deg: float
    half_power_bw_deg: float


class TowerIn(BaseModel):
    id: str
    x: float
    y: float
    power_dbm: float = Field(default=43.0, ge=10.0, le=70.0)
    carrier_ghz: float = Field(default=3.5, ge=0.4, le=40.0)
    max_range_m: float = Field(default=120.0, ge=10.0, le=1000.0)
    num_elements: int = Field(default=32, ge=4, le=256)


class UserIn(BaseModel):
    id: str
    x: float
    y: float


class FiveGRequest(BaseModel):
    towers: list[TowerIn]
    users: list[UserIn]
    snr: float = Field(default=50.0, ge=0.0, le=1000.0)
    noise_floor_dbm: float = Field(default=-95.0, ge=-130.0, le=-40.0)


class LinkResult(BaseModel):
    tower_id: str
    user_id: str
    distance_m: float
    snr_db: float
    quality: float
    connected: bool


class TowerAutoParameters(BaseModel):
    id: str
    steering_angle_deg: float
    beam_width_deg: float
    suggested_power_dbm: float
    suggested_num_elements: int
    connected_user_ids: list[str]


class FiveGResponse(BaseModel):
    links: list[LinkResult]
    towers: list[TowerAutoParameters]


class PhantomShape(BaseModel):
    id: str
    label: str
    cx: float
    cy: float
    rx: float
    ry: float
    angle_deg: float
    acoustic_impedance_mrayl: float = Field(default=1.63, ge=1.2, le=2.2)
    attenuation_db_cm_mhz: float = Field(default=0.5, ge=0.05, le=2.5)
    reflectivity: float = Field(default=0.35, ge=0.0, le=1.0)
    scatter: float = Field(default=0.2, ge=0.0, le=1.0)


class ProbeState(BaseModel):
    surface_angle_deg: float = Field(default=270.0, ge=0.0, le=360.0)
    beam_direction_deg: float = Field(default=90.0, ge=0.0, le=360.0)
    frequency_mhz: float = Field(default=5.0, ge=1.0, le=18.0)
    max_depth_mm: float = Field(default=120.0, ge=20.0, le=300.0)


class VesselState(BaseModel):
    x: float = Field(default=0.25, ge=-0.95, le=0.95)
    y: float = Field(default=-0.2, ge=-0.95, le=0.95)
    radius: float = Field(default=0.08, ge=0.02, le=0.25)
    velocity_cm_s: float = Field(default=25.0, ge=0.0, le=180.0)
    direction_deg: float = Field(default=35.0, ge=0.0, le=360.0)


class ScanLine(BaseModel):
    surface_angle_deg: float = Field(ge=0.0, le=360.0)
    beam_direction_deg: float = Field(ge=0.0, le=360.0)


class UltrasoundRequest(BaseModel):
    shapes: list[PhantomShape]
    probe: ProbeState
    scan_lines: list[ScanLine] = Field(default_factory=list)
    vessel: VesselState = Field(default_factory=VesselState)
    snr: float = Field(default=50.0, ge=0.0, le=1000.0)


class UltrasoundResponse(BaseModel):
    a_mode_depths_mm: list[float]
    a_mode_amplitude: list[float]
    b_mode_image: list[list[float]]
    doppler_freq_axis_hz: list[float]
    doppler_spectrum: list[float]
    color_flow_velocity_cm_s: float
    probe_xy: list[float]
    intersections: list[list[float]]


class PhantomResponse(BaseModel):
    shapes: list[PhantomShape]
    vessel: VesselState


class RadarBody(BaseModel):
    id: str
    x: float
    y: float
    size_m: float = Field(default=4.0, ge=0.4, le=40.0)
    reflectivity: float = Field(default=1.0, ge=0.1, le=3.0)


class RadarRequest(BaseModel):
    bodies: list[RadarBody]
    current_angle_deg: float = Field(default=0.0, ge=0.0, le=360.0)
    scan_speed_deg_s: float = Field(default=40.0, ge=2.0, le=360.0)
    beam_width_deg: float = Field(default=18.0, ge=2.0, le=120.0)
    delta_time_s: float = Field(default=0.15, gt=0.01, le=1.0)
    max_range_m: float = Field(default=220.0, ge=20.0, le=2000.0)
    snr: float = Field(default=50.0, ge=0.0, le=1000.0)

    @model_validator(mode="after")
    def enforce_body_limit(self) -> "RadarRequest":
        if len(self.bodies) > 5:
            raise ValueError("Radar supports up to 5 bodies")
        return self


class RadarDetection(BaseModel):
    body_id: str
    range_m: float
    bearing_deg: float
    estimated_size_m: float
    strength: float


class RadarResponse(BaseModel):
    next_angle_deg: float
    detections: list[RadarDetection]
    sweep_points: list[list[float]]
    max_range_m: float
