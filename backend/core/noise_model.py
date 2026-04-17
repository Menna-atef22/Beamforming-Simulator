"""Gaussian noise modeling based on SNR - OOP implementation"""

import math
import random
from typing import List, Optional


class NoiseModel:
    """Models Gaussian noise addition based on Signal-to-Noise Ratio (SNR).
    
    This class encapsulates noise generation and application using the Box-Muller
    transform for Gaussian random variables. Supports parametric control of noise
    levels and optional noise disable for ideal scenarios.
    
    Attributes:
        snr_db: Signal-to-Noise Ratio in decibels.
        snr_linear: SNR converted to linear scale (10^(SNR_dB/10)).
        noise_enabled: Whether noise should be applied (default: True).
    """
    
    def __init__(self, snr_db: float, noise_enabled: bool = True) -> None:
        """Initialize NoiseModel with SNR setting.
        
        Args:
            snr_db: SNR in decibels. Can be float('inf') for no noise.
            noise_enabled: Whether to enable noise (default: True).
        
        Raises:
            ValueError: If snr_db is negative (not inf).
        """
        if not math.isinf(snr_db) and snr_db < 0:
            raise ValueError("snr_db must be >= 0 or inf")
        
        self.snr_db: float = snr_db
        
        # Convert to linear scale: SNR_linear = 10^(SNR_dB/10)
        if math.isinf(snr_db):
            self.snr_linear: float = float('inf')
        else:
            self.snr_linear = math.pow(10, snr_db / 10)
        
        self.noise_enabled: bool = noise_enabled
    
    def enable_noise(self) -> None:
        """Enable noise addition."""
        self.noise_enabled = True
    
    def disable_noise(self) -> None:
        """Disable noise addition (equivalent to infinite SNR)."""
        self.noise_enabled = False
    
    @staticmethod
    def _gaussian_random() -> float:
        """Generate Gaussian random number using Box-Muller transform.
        
        Converts two uniform random variables to one Gaussian random variable
        with zero mean and unit variance (N(0,1)).
        
        Returns:
            Gaussian random number with mean=0, variance=1.
        """
        u = 0.0
        v = 0.0
        while u == 0:
            u = random.random()
        while v == 0:
            v = random.random()
        
        # Box-Muller formula: sqrt(-2*ln(u)) * cos(2π*v)
        return math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v)
    
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
        
        if math.isinf(self.snr_linear) or self.snr_linear == 0:
            return 0.0
        
        return signal_power / self.snr_linear
    
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
    
    def add_noise_to_scalar(self, signal: float) -> float:
        """Add Gaussian noise to a scalar signal.
        
        Noise is generated based on signal power and configured SNR:
        noisy_signal = signal + gaussian_noise * sqrt(noise_power)
        
        Args:
            signal: Scalar signal value.
        
        Returns:
            Signal with added noise (or unchanged if noise disabled).
        """
        if not self.noise_enabled or math.isinf(self.snr_linear):
            return signal
        
        signal_power = signal * signal if signal != 0 else 1e-10
        noise_power = self.compute_noise_power(signal_power)
        
        if noise_power <= 0:
            return signal
        
        # Generate Gaussian noise: N(0, noise_power)
        gaussian_var = self._gaussian_random()
        noise = gaussian_var * math.sqrt(noise_power)
        
        return signal + noise
    
    def add_noise_to_complex(self, real: float, imag: float) -> tuple:
        """Add Gaussian noise to complex signal (I/Q components).
        
        Applies independent noise to real and imaginary parts.
        
        Args:
            real: Real (I) component.
            imag: Imaginary (Q) component.
        
        Returns:
            Tuple of (noisy_real, noisy_imag).
        """
        if not self.noise_enabled or math.isinf(self.snr_linear):
            return (real, imag)
        
        # Signal power: |signal|^2 = real^2 + imag^2
        signal_power = real*real + imag*imag
        noise_power = self.compute_noise_power(signal_power)
        
        if noise_power <= 0:
            return (real, imag)
        
        # Independent noise on each component
        noise_real = self._gaussian_random() * math.sqrt(noise_power)
        noise_imag = self._gaussian_random() * math.sqrt(noise_power)
        
        return (real + noise_real, imag + noise_imag)
    
    def add_noise_to_array(self, signals: List[float]) -> List[float]:
        """Add Gaussian noise to an array of signals.
        
        Args:
            signals: List of signal values.
        
        Returns:
            List of noisy signals (same length as input).
        """
        return [self.add_noise_to_scalar(s) for s in signals]
    
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
        if math.isinf(snr_db):
            self.snr_linear = float('inf')
        else:
            self.snr_linear = math.pow(10, snr_db / 10)

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
    return noise_model.add_noise_to_scalar(signal)

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
