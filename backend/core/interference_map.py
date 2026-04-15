"""2D interference map generation"""
import math
from typing import List
from dataclasses import dataclass

from .signal_model import wave_number
from .noise_model import add_noise


@dataclass
class InterferenceMapData:
    grid: List[List[float]]
    x_range: List[float]
    y_range: List[float]
    max_val: float


def generate_interference_map(
    num_elements: int,
    spacing: float,
    wavelength: float,
    steering_angle_rad: float,
    amplitude: float,
    snr_db: float,
    grid_size: int = 80
) -> InterferenceMapData:
    """Generate 2D interference map"""
    k = wave_number(wavelength)
    extent = 5
    x_range = []
    y_range = []
    grid = []
    max_val = 0
    
    offset = ((num_elements - 1) * spacing) / 2
    
    # Generate coordinate ranges
    for i in range(grid_size):
        x_range.append(-extent + (2 * extent * i) / (grid_size - 1))
        y_range.append(0 + (extent * i) / (grid_size - 1))
    
    # Generate grid
    for yi in range(grid_size):
        row = []
        for xi in range(grid_size):
            px = x_range[xi]
            py = y_range[yi]
            real = 0
            imag = 0
            
            for n in range(num_elements):
                ex = n * spacing - offset
                dx = px - ex
                dy = py
                dist = math.sqrt(dx * dx + dy * dy)
                
                if dist < 0.001:
                    continue
                
                steer_phase = k * n * spacing * math.sin(steering_angle_rad)
                phase = k * dist - steer_phase
                amp = amplitude / math.sqrt(dist)
                real += amp * math.cos(phase)
                imag += amp * math.sin(phase)
            
            mag = math.sqrt(real * real + imag * imag)
            if snr_db < 100:
                mag = add_noise(mag, snr_db)
            mag = max(0, mag)
            if mag > max_val:
                max_val = mag
            row.append(mag)
        
        grid.append(row)
    
    return InterferenceMapData(grid, x_range, y_range, max_val)
