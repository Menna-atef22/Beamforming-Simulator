"""Gaussian noise based on SNR"""
import math
import random
from typing import List


def gaussian_random() -> float:
    """Generate Gaussian random number using Box-Muller transform"""
    u = 0
    v = 0
    while u == 0:
        u = random.random()
    while v == 0:
        v = random.random()
    return math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v)


def add_noise(signal: float, snr_db: float) -> float:
    """Add Gaussian noise to signal based on SNR"""
    snr_linear = math.pow(10, snr_db / 10)
    noise_power = (signal * signal) / snr_linear
    noise = gaussian_random() * math.sqrt(noise_power)
    return signal + noise


def add_noise_to_array(signals: List[float], snr_db: float) -> List[float]:
    """Add noise to array of signals"""
    return [add_noise(s, snr_db) for s in signals]
