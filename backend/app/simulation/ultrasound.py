from __future__ import annotations

import math

import numpy as np

from ..schemas import (
    PhantomShape,
    ProbeState,
    ScanLine,
    UltrasoundRequest,
    UltrasoundResponse,
    VesselState,
)

SOUND_SPEED_M_S = 1540.0
MM_PER_PHANTOM_UNIT = 60.0


def default_phantom_shapes() -> list[PhantomShape]:
    # A Shepp-Logan style phantom expressed as editable ellipses.
    return [
        PhantomShape(
            id="shape-1",
            label="Outer Tissue",
            cx=0.0,
            cy=0.0,
            rx=0.88,
            ry=1.0,
            angle_deg=0.0,
            acoustic_impedance_mrayl=1.58,
            attenuation_db_cm_mhz=0.55,
            reflectivity=0.18,
            scatter=0.25,
        ),
        PhantomShape(
            id="shape-2",
            label="Core Fat",
            cx=0.0,
            cy=-0.02,
            rx=0.82,
            ry=0.94,
            angle_deg=0.0,
            acoustic_impedance_mrayl=1.47,
            attenuation_db_cm_mhz=0.62,
            reflectivity=0.23,
            scatter=0.24,
        ),
        PhantomShape(
            id="shape-3",
            label="Lesion A",
            cx=0.22,
            cy=-0.16,
            rx=0.16,
            ry=0.22,
            angle_deg=14.0,
            acoustic_impedance_mrayl=1.88,
            attenuation_db_cm_mhz=0.95,
            reflectivity=0.66,
            scatter=0.44,
        ),
        PhantomShape(
            id="shape-4",
            label="Lesion B",
            cx=-0.28,
            cy=0.15,
            rx=0.2,
            ry=0.12,
            angle_deg=-20.0,
            acoustic_impedance_mrayl=1.76,
            attenuation_db_cm_mhz=0.78,
            reflectivity=0.52,
            scatter=0.4,
        ),
        PhantomShape(
            id="shape-5",
            label="Cyst",
            cx=0.02,
            cy=0.28,
            rx=0.12,
            ry=0.08,
            angle_deg=0.0,
            acoustic_impedance_mrayl=1.44,
            attenuation_db_cm_mhz=0.28,
            reflectivity=0.08,
            scatter=0.05,
        ),
        PhantomShape(
            id="shape-6",
            label="Fibrous Band",
            cx=-0.06,
            cy=-0.37,
            rx=0.1,
            ry=0.24,
            angle_deg=8.0,
            acoustic_impedance_mrayl=1.93,
            attenuation_db_cm_mhz=1.12,
            reflectivity=0.72,
            scatter=0.52,
        ),
    ]


def default_vessel() -> VesselState:
    return VesselState(x=0.35, y=-0.22, radius=0.09, velocity_cm_s=30.0, direction_deg=28.0)


def _point_inside_shape(x: float, y: float, shape: PhantomShape) -> bool:
    theta = math.radians(shape.angle_deg)
    dx = x - shape.cx
    dy = y - shape.cy
    xr = dx * math.cos(theta) + dy * math.sin(theta)
    yr = -dx * math.sin(theta) + dy * math.cos(theta)
    return (xr / shape.rx) ** 2 + (yr / shape.ry) ** 2 <= 1.0


def _dominant_shape(x: float, y: float, shapes: list[PhantomShape]) -> PhantomShape | None:
    active: list[PhantomShape] = [shape for shape in shapes if _point_inside_shape(x, y, shape)]
    if not active:
        return None
    return max(active, key=lambda s: s.reflectivity + 0.5 * s.scatter)


def _scan_line(
    shapes: list[PhantomShape],
    probe: ProbeState,
    surface_angle_deg: float,
    beam_direction_deg: float,
    snr: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[list[float]]]:
    depth_count = 260
    depths_mm = np.linspace(0.0, probe.max_depth_mm, depth_count)
    amplitude = np.zeros(depth_count)

    surface_rad = math.radians(surface_angle_deg)
    beam_rad = math.radians(beam_direction_deg)

    probe_xy = np.array([1.02 * math.cos(surface_rad), 1.02 * math.sin(surface_rad)])
    beam_vec = np.array([math.cos(beam_rad), math.sin(beam_rad)])

    prev_shape: PhantomShape | None = None
    intersections: list[list[float]] = []

    for i, depth_mm in enumerate(depths_mm):
        dist_units = depth_mm / MM_PER_PHANTOM_UNIT
        point = probe_xy + beam_vec * dist_units
        x, y = float(point[0]), float(point[1])

        if x**2 + y**2 > 1.05**2:
            continue

        shape = _dominant_shape(x, y, shapes)
        if shape is not None:
            depth_cm = depth_mm / 10.0
            attenuation = math.exp(-shape.attenuation_db_cm_mhz * probe.frequency_mhz * depth_cm / 20.0)
            speckle = shape.scatter * np.random.normal(0.0, 0.2)
            amplitude[i] += max(0.0, shape.reflectivity * attenuation + speckle)

        if shape is not prev_shape:
            z1 = prev_shape.acoustic_impedance_mrayl if prev_shape else 1.48
            z2 = shape.acoustic_impedance_mrayl if shape else 1.48
            contrast = abs((z2 - z1) / (z2 + z1 + 1e-9))
            boundary_echo = contrast * (1.0 + (shape.reflectivity if shape else 0.05))
            amplitude[i] += boundary_echo
            intersections.append([x, y])

        prev_shape = shape

    snr_noise = np.random.normal(0.0, 0.35 / math.sqrt(snr + 1.0), depth_count)
    envelope = np.clip(amplitude + snr_noise, 0.0, None)
    envelope = np.convolve(envelope, np.array([0.2, 0.6, 0.2]), mode="same")
    envelope /= np.max(envelope) + 1e-9

    return depths_mm, envelope, probe_xy, intersections


def _build_b_mode(
    shapes: list[PhantomShape],
    scan_lines: list[ScanLine],
    probe: ProbeState,
    snr: float,
) -> list[list[float]]:
    if not scan_lines:
        return [[]]

    lines: list[np.ndarray] = []
    for line in scan_lines[-120:]:
        _, envelope, _, _ = _scan_line(
            shapes,
            probe,
            line.surface_angle_deg,
            line.beam_direction_deg,
            snr,
        )
        lines.append(envelope)

    b_mode = np.stack(lines, axis=0)
    return b_mode.tolist()


def _doppler(
    probe: ProbeState,
    vessel: VesselState,
    snr: float,
) -> tuple[np.ndarray, np.ndarray, float]:
    beam_rad = math.radians(probe.beam_direction_deg)
    vessel_rad = math.radians(vessel.direction_deg)
    theta = vessel_rad - beam_rad

    velocity_m_s = vessel.velocity_cm_s / 100.0
    f0 = probe.frequency_mhz * 1e6
    fd = (2.0 * f0 * velocity_m_s * math.cos(theta)) / SOUND_SPEED_M_S

    freq_axis = np.linspace(-8000.0, 8000.0, 320)
    sigma = 230.0 + 24.0 * vessel.velocity_cm_s
    gaussian = np.exp(-0.5 * ((freq_axis - fd) / sigma) ** 2)

    noise = np.random.normal(0.0, 0.12 / math.sqrt(snr + 1.0), freq_axis.shape)
    spectrum = np.clip(gaussian + noise, 0.0, None)
    spectrum /= np.max(spectrum) + 1e-9

    color_flow_velocity = vessel.velocity_cm_s * math.cos(theta)
    return freq_axis, spectrum, color_flow_velocity


def simulate_ultrasound(req: UltrasoundRequest) -> UltrasoundResponse:
    depths_mm, envelope, probe_xy, intersections = _scan_line(
        req.shapes,
        req.probe,
        req.probe.surface_angle_deg,
        req.probe.beam_direction_deg,
        req.snr,
    )

    b_mode = _build_b_mode(req.shapes, req.scan_lines, req.probe, req.snr)
    freq_axis, spectrum, color_flow_velocity = _doppler(req.probe, req.vessel, req.snr)

    return UltrasoundResponse(
        a_mode_depths_mm=depths_mm.tolist(),
        a_mode_amplitude=envelope.tolist(),
        b_mode_image=b_mode,
        doppler_freq_axis_hz=freq_axis.tolist(),
        doppler_spectrum=spectrum.tolist(),
        color_flow_velocity_cm_s=float(color_flow_velocity),
        probe_xy=[float(probe_xy[0]), float(probe_xy[1])],
        intersections=intersections,
    )
