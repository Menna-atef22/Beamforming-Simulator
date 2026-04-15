"""Signal and wave propagation models"""
import math
from typing import Tuple, List


def wave_number(wavelength: float) -> float:
    """Calculate wave number from wavelength"""
    return (2 * math.pi) / wavelength


def phase_shift(k: float, n: int, d: float, theta_rad: float) -> float:
    """Calculate phase shift for array element"""
    return k * n * d * math.sin(theta_rad)


def element_signal(
    amplitude: float,
    phase: float,
    additional_phase: float
) -> dict:
    """Calculate element signal components"""
    total_phase = phase + additional_phase
    return {
        "real": amplitude * math.cos(total_phase),
        "imag": amplitude * math.sin(total_phase)
    }


def array_factor(
    num_elements: int,
    spacing: float,
    wavelength: float,
    steering_angle_rad: float,
    theta_rad: float,
    amplitude: float = 1.0
) -> float:
    """Calculate array factor without weighting"""
    k = wave_number(wavelength)
    real = 0
    imag = 0
    
    for n in range(num_elements):
        steering_phase = phase_shift(k, n, spacing, steering_angle_rad)
        observe_phase = phase_shift(k, n, spacing, theta_rad)
        phase = observe_phase - steering_phase
        real += amplitude * math.cos(phase)
        imag += amplitude * math.sin(phase)
    
    return math.sqrt(real * real + imag * imag) / num_elements


def array_factor_weighted(
    num_elements: int,
    spacing: float,
    wavelength: float,
    steering_angle_rad: float,
    theta_rad: float,
    amplitude: float,
    weights: List[float]
) -> float:
    """Calculate array factor with weighting (apodization)"""
    k = wave_number(wavelength)
    real = 0
    imag = 0
    total_weight = 0
    
    for n in range(num_elements):
        w = weights[n] if n < len(weights) else 1.0
        total_weight += w
        steering_phase = phase_shift(k, n, spacing, steering_angle_rad)
        observe_phase = phase_shift(k, n, spacing, theta_rad)
        phase = observe_phase - steering_phase
        real += amplitude * w * math.cos(phase)
        imag += amplitude * w * math.sin(phase)
    
    return math.sqrt(real * real + imag * imag) / total_weight
