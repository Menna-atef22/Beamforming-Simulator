"""Window functions for sidelobe control"""
import math
from typing import List, Literal

WindowType = Literal["rectangular", "hamming", "hanning", "blackman", "kaiser"]


def bessel_i0(x: float) -> float:
    """Approximate Bessel function I0 using series expansion"""
    sum_val = 1
    term = 1
    for k in range(1, 21):
        term *= (x / (2 * k)) * (x / (2 * k))
        sum_val += term
    return sum_val


def apply_window(num_elements: int, window_type: WindowType) -> List[float]:
    """Apply window function to array elements"""
    weights = [0] * num_elements
    N = num_elements - 1
    
    if window_type == "hamming":
        for n in range(num_elements):
            weights[n] = 0.54 - 0.46 * math.cos((2 * math.pi * n) / N)
    
    elif window_type == "hanning":
        for n in range(num_elements):
            weights[n] = 0.5 * (1 - math.cos((2 * math.pi * n) / N))
    
    elif window_type == "blackman":
        for n in range(num_elements):
            weights[n] = (0.42 - 0.5 * math.cos((2 * math.pi * n) / N) +
                         0.08 * math.cos((4 * math.pi * n) / N))
    
    elif window_type == "kaiser":
        # Kaiser window with beta=6
        beta = 6
        for n in range(num_elements):
            x = 2 * n / N - 1
            weights[n] = bessel_i0(beta * math.sqrt(1 - x * x)) / bessel_i0(beta)
    
    else:  # rectangular
        for n in range(num_elements):
            weights[n] = 1.0
    
    return weights
