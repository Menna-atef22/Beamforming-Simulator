# SINGLE SOURCE OF TRUTH FOR ALL NOISE CALCULATIONS — DO NOT ADD NOISE ANYWHERE ELSE
"""Gaussian noise modeling based on SNR - OOP implementation"""

import math
import random
from typing import List, Optional

_last_snr: Optional[float] = None
_last_noise: float = 0.0

def get_noise_amplitude(snr_db: float) -> float:
    """Centralized utility for SNR-to-noise multiplier."""
    global _last_snr, _last_noise
    if snr_db == _last_snr:
        return _last_noise
    
    capped = min(snr_db, 100)
    if math.isinf(capped) or capped >= 100:
        _last_snr = snr_db
        _last_noise = 0.0
        return 0.0
        
    _last_snr = snr_db
    _last_noise = math.pow(10, -capped / 10)
    return _last_noise


class NoiseModel:
    """Models Gaussian noise addition based on Signal-to-Noise Ratio (SNR).
    
    This class encapsulates noise generation and application using the Box-Muller
    transform for Gaussian random variables. Supports parametric control of noise
    levels and optional noise disable for ideal scenarios.
    
    Attributes:
        snr_db: Signal-to-Noise Ratio in decibels.
        snr_linear: SNR converted to linear scale (10^(SNR_dB/10)).
    """

    # Precomputed Gaussian cache for fast per-pixel noise without repeated RNG.
    # Stores N(0,1) samples in a flat list of length CACHE_W*CACHE_H.
    _noise_cache: Optional[List[float]] = None
    _noise_cache_w: int = 256
    _noise_cache_h: int = 256
    
    def __init__(self, snr_db: float) -> None:
        """Initialize NoiseModel with SNR setting.
        
        Args:
            snr_db: SNR in decibels. Can be float('inf') for no noise.
        
        Raises:
            ValueError: If snr_db is negative (not inf).
        """
        if not math.isinf(snr_db) and snr_db < 0:
            raise ValueError("snr_db must be >= 0 or inf")
        
        self.snr_db: float = snr_db
        self.noise_multiplier = get_noise_amplitude(snr_db)
        
        # Noise is controlled purely by snr_db (inf => no noise).
    
    # Cached Box-Muller spare — avoids discarding the second generated sample.
    _spare: Optional[float] = None

    @classmethod
    def _gaussian_random(cls) -> float:
        """Generate Gaussian random number using cached Box-Muller transform.
        
        Generates two independent N(0,1) samples per Box-Muller call and caches
        the second one, halving the number of expensive log/cos operations.
        
        Returns:
            Gaussian random number with mean=0, variance=1.
        """
        if cls._spare is not None:
            val = cls._spare
            cls._spare = None
            return val
        
        u = 0.0
        while u == 0:
            u = random.random()
        v = random.random()
        
        # Box-Muller: produces two independent samples.
        mag = math.sqrt(-2.0 * math.log(u))
        cls._spare = mag * math.sin(2.0 * math.pi * v)
        return mag * math.cos(2.0 * math.pi * v)

    @classmethod
    def _init_noise_cache(cls) -> None:
        """Initialize a deterministic cache of N(0,1) samples."""
        if cls._noise_cache is not None:
            return
        rng = random.Random(1337)
        n = cls._noise_cache_w * cls._noise_cache_h
        # Use Box-Muller with the local RNG so results are deterministic.
        out: List[float] = []
        out_extend = out.extend
        for _ in range(n // 2):
            u1 = max(1e-12, rng.random())
            u2 = rng.random()
            r = math.sqrt(-2.0 * math.log(u1))
            theta = 2.0 * math.pi * u2
            out_extend([r * math.cos(theta), r * math.sin(theta)])
        if len(out) < n:
            out.append(0.0)
        cls._noise_cache = out[:n]

    @classmethod
    def cached_gaussian(cls, xi: int, yi: int, channel: int = 0) -> float:
        """Fetch a cached N(0,1) sample for a pixel index and channel.

        channel=0/1 can be used to get decorrelated-ish I/Q samples.
        """
        cls._init_noise_cache()
        w = cls._noise_cache_w
        h = cls._noise_cache_h
        # Mix xi/yi/channel into the cache index; keep it cheap/deterministic.
        x = int(xi) % w
        y = int(yi) % h
        idx = (y * w + x + (channel * 9973)) % (w * h)
        return cls._noise_cache[idx] if cls._noise_cache is not None else 0.0
    
    def compute_noise_power(self, signal_power: float) -> float:
        """Compute noise power given signal power and SNR.
        
        Noise power = Signal Power / SNR_linear
        
        Args:
            signal_power: Power of the signal (must be >= 0).
        
        Returns:
            Noise power in same units as signal power.
        
        Raises:
            ValueError: If signal_power < 0.
        """
        if signal_power < 0:
            raise ValueError("signal_power must be >= 0")
        
        if self.noise_multiplier == 0.0:
            return 0.0
        
        return signal_power * self.noise_multiplier

    def get_noise_power(self, signal_power: float = 1.0) -> float:
        """Get noise power (normalized or relative to signal power).
        
        Convenience method that wraps compute_noise_power with a default
        signal power of 1.0 for quick access to normalized noise level.
        
        Args:
            signal_power: Power of the signal (default: 1.0).
        
        Returns:
            Noise power.
        """
        return self.compute_noise_power(signal_power)
    
    def add_noise_to_scalar(self, signal: float, reference_power: float = 1.0) -> float:
        """Add Gaussian noise to a scalar signal."""
        if self.noise_multiplier == 0.0: return signal
        noise_power = self.compute_noise_power(reference_power)
        # Skip imperceptible noise (SNR so high that std < 1e-9)
        if noise_power < 1e-18: return signal
        return signal + self._gaussian_random() * math.sqrt(noise_power)
    
    def add_noise_to_complex(self, real: float, imag: float, reference_power: float = 1.0) -> tuple:
        """Add Gaussian noise to complex signal (I/Q components)."""
        if self.noise_multiplier == 0.0: return (real, imag)
        noise_power = self.compute_noise_power(reference_power)
        # Skip imperceptible noise
        if noise_power < 1e-18: return (real, imag)
        noise_std = math.sqrt(noise_power)
        return (real + self._gaussian_random() * noise_std, imag + self._gaussian_random() * noise_std)
    
    def add_noise_to_array(self, signals: List[float]) -> List[float]:
        """Add Gaussian noise to an array of signals.
        
        Args:
            signals: List of signal values.
        
        Returns:
            List of noisy signals (same length as input).
        """
        if not signals:
            return []
        if self.noise_multiplier == 0.0:
            return list(signals)
        # Use a stable reference power to avoid noise vanishing in dark regions.
        reference_power = 1.0
        noise_power = self.compute_noise_power(reference_power)
        if noise_power <= 0:
            return list(signals)
        sigma = math.sqrt(noise_power)
        return [s + self._gaussian_random() * sigma for s in signals]
    
    def set_snr(self, snr_db: float) -> None:
        """Update SNR setting.
        
        Args:
            snr_db: New SNR value in decibels.
        
        Raises:
            ValueError: If snr_db is negative (not inf).
        """
        if not math.isinf(snr_db) and snr_db < 0:
            raise ValueError("snr_db must be >= 0 or inf")
        
        self.snr_db = snr_db
        self.noise_multiplier = get_noise_amplitude(snr_db)

    def enable_noise(self) -> None:
        """Enable noise addition."""
        self.noise_multiplier = get_noise_amplitude(self.snr_db)

    def disable_noise(self) -> None:
        """Disable noise addition."""
        self.noise_multiplier = 0.0

# Module-level functions for backward compatibility
def gaussian_random() -> float:
    """Generate Gaussian random number using Box-Muller transform.
    
    Returns:
        Gaussian random number with mean=0, variance=1.
    """
    return NoiseModel._gaussian_random()


def add_noise(signal: float, snr_db: float = float('inf')) -> float:
    """Add Gaussian noise to a scalar signal.
    
    Args:
        signal: Scalar signal value.
        snr_db: Signal-to-Noise Ratio in decibels (default: inf for no noise).
    
    Returns:
        Signal with added noise.
    """
    noise_model = NoiseModel(snr_db)
    return noise_model.add_noise_to_scalar(signal, reference_power=1.0)

def add_noise_to_array(signals: list, snr_db: float = float('inf')) -> list:
    """Add Gaussian noise to an array of signals.
    
    Args:
        signals: List of signal values.
        snr_db: Signal-to-Noise Ratio in decibels (default: inf for no noise).
    
    Returns:
        List of noisy signals.
    """
    noise_model = NoiseModel(snr_db)
    return noise_model.add_noise_to_array(signals)
