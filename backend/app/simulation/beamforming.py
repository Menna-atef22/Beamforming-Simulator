from __future__ import annotations

import math

import numpy as np

from ..schemas import BeamformingRequest, BeamformingResponse

C = 299_792_458.0


def window_weights(count: int, window_type: str, alpha: float) -> np.ndarray:
    if window_type == "rectangular":
        return np.ones(count)
    if window_type == "hamming":
        return np.hamming(count)
    if window_type == "hann":
        return np.hanning(count)
    if window_type == "blackman":
        return np.blackman(count)

    # Tukey interpolation between rectangular and Hann for controllable apodization.
    if alpha <= 0.0:
        return np.ones(count)
    if alpha >= 1.0:
        return np.hanning(count)

    n = np.arange(count)
    w = np.ones(count)
    edge = alpha * (count - 1) / 2.0
    left = n < edge
    right = n > (count - 1) * (1 - alpha / 2)
    w[left] = 0.5 * (1 + np.cos(np.pi * (2 * n[left] / (alpha * (count - 1)) - 1)))
    w[right] = 0.5 * (
        1
        + np.cos(
            np.pi
            * (
                2 * n[right] / (alpha * (count - 1))
                - 2 / alpha
                + 1
            )
        )
    )
    return w


def _half_power_bw(angles_deg: np.ndarray, profile_db: np.ndarray, peak_idx: int) -> float:
    peak_db = profile_db[peak_idx]
    hp_level = peak_db - 3.0

    left_idx = peak_idx
    while left_idx > 0 and profile_db[left_idx] > hp_level:
        left_idx -= 1

    right_idx = peak_idx
    while right_idx < len(profile_db) - 1 and profile_db[right_idx] > hp_level:
        right_idx += 1

    return float(max(angles_deg[right_idx] - angles_deg[left_idx], 0.5))


def simulate_beamforming(req: BeamformingRequest) -> BeamformingResponse:
    frequency_hz = max(req.carrier_frequency_hz, 1_000.0)
    wavelength = C / frequency_hz
    k = 2.0 * math.pi / wavelength

    spacing = min(max(req.element_spacing_m, 0.001), req.aperture_m)
    positions = (np.arange(req.num_elements) - (req.num_elements - 1) / 2.0) * spacing

    weights = window_weights(req.num_elements, req.window_type, req.apodization_alpha)
    weights = weights / (np.max(weights) + 1e-12)

    steer_rad = math.radians(req.steering_angle_deg)
    phase_offset_rad = math.radians(req.phase_offset_deg)
    steer_phase = k * positions * np.sin(steer_rad) + phase_offset_rad

    x = np.linspace(-req.view_extent_m, req.view_extent_m, req.sample_points)
    y = np.linspace(0.25, req.view_extent_m * 1.8, req.sample_points)
    xx, yy = np.meshgrid(x, y)

    distance = np.sqrt((xx[..., None] - positions[None, None, :]) ** 2 + yy[..., None] ** 2)
    pressure = np.sum(
        req.amplitude * weights[None, None, :] * np.exp(1j * (k * distance - steer_phase[None, None, :])),
        axis=2,
    )

    real_pressure = np.real(pressure)
    signed_map = real_pressure / (np.max(np.abs(real_pressure)) + 1e-12)

    snr = max(req.snr, 0.0)
    noise_scale = 1.0 / np.sqrt(snr + 1.0)
    noisy_map = np.clip(signed_map + np.random.normal(0.0, noise_scale * 0.25, signed_map.shape), -1.0, 1.0)

    beam_angles = np.linspace(-90.0, 90.0, 361)
    angle_rad = np.deg2rad(beam_angles)
    phase_grid = k * positions[:, None] * (np.sin(angle_rad)[None, :] - np.sin(steer_rad))
    array_factor = np.sum(weights[:, None] * np.exp(1j * phase_grid), axis=0)

    gain = np.abs(array_factor)
    gain_norm = gain / (np.max(gain) + 1e-12)
    profile_db = 20.0 * np.log10(np.maximum(gain_norm, 1e-6))
    profile_db += np.random.normal(0.0, noise_scale * 2.4, profile_db.shape)
    profile_db = np.clip(profile_db, -55.0, 2.0)

    peak_idx = int(np.argmax(profile_db))
    half_power_bw = _half_power_bw(beam_angles, profile_db, peak_idx)

    return BeamformingResponse(
        x_axis=x.tolist(),
        y_axis=y.tolist(),
        constructive_map=noisy_map.tolist(),
        beam_angles_deg=beam_angles.tolist(),
        beam_profile_db=profile_db.tolist(),
        main_lobe_deg=float(beam_angles[peak_idx]),
        half_power_bw_deg=half_power_bw,
    )
