"""API Routes and endpoint definitions for FastAPI"""

import logging
from fastapi import APIRouter, HTTPException
from typing import Dict, Any

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

from ..service import SimulationService
from .schemas import (
    BeamformingParamsSchema,
    FiveGParamsSchema,
    RadarParamsSchema,
    UltrasoundParamsSchema,
    UltrasoundDopplerPhysicsParamsSchema,
)

# Create FastAPI router
router = APIRouter(prefix="/api", tags=["simulations"])


# ============================================================================
# Helper function to handle simulation responses
# ============================================================================

def _handle_simulation_response(result: Dict[str, Any], endpoint: str) -> Dict[str, Any]:
    """Convert service response to API response.
    
    Args:
        result: Service layer result dictionary.
        endpoint: Endpoint name for logging.
    
    Returns:
        API response dictionary or raises HTTPException.
    
    Raises:
        HTTPException: On failure.
    """
    if result.get("success"):
        logger.info(f"[{endpoint}] Simulation completed successfully")
        return result.get("data", {})
    else:
        error_msg = result.get("error", "Simulation failed")
        logger.warning(f"[{endpoint}] Simulation error: {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)


# ============================================================================
# Beamforming Endpoint
# ============================================================================

@router.post("/simulate/beamforming")
async def beamforming_route(params: BeamformingParamsSchema) -> Dict[str, Any]:
    """Compute beamforming pattern with specified array and steering parameters.
    
    **Request Parameters:**
    - `num_elements`: Number of array elements (1-256)
    - `spacing`: Element spacing in wavelengths (0.25-1.0)
    - `frequency`: Operating frequency in Hz (1e6-100e9)
    - `steering_angle_deg`: Steering angle in degrees (-180 to 180)
    - `amplitude`: Signal amplitude (0-1)
    - `snr_db`: SNR in dB (0-100)
    - `window_type`: Apodization window ("hamming", "hann", "blackman")
    - `enable_noise`: Add thermal noise
    - `grid_size`: Angle grid resolution (default: 360)
    
    **Returns:**
    - Beam pattern with magnitudes (linear and dB)
    - Computed metrics (beamwidth, SLL, directivity)
    """
    try:
        logger.info(f"[Beamforming] Endpoint called with: {params.dict()}")
        result = SimulationService.run_beamforming(params.dict())
        return _handle_simulation_response(result, "Beamforming")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Beamforming] Route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 5G Network Endpoint
# ============================================================================

@router.post("/simulate/5g")
async def five_g_route(params: FiveGParamsSchema) -> Dict[str, Any]:
    """Simulate 5G network with towers and mobile users.
    
    **Request Parameters:**
    - `num_elements`: Antenna elements per tower (4-64)
    - `spacing`: Element spacing in wavelengths
    - `frequency`: Frequency in Hz (typical: 28e9 for 5G mmWave)
    - `snr_db`: SNR in dB
    - `auto_steer`: Auto-steer towers toward nearest user
    - `enable_noise`: Add noise to simulation
    - `grid_size`: Angle grid resolution for beam patterns
    
    **Returns:**
    - Tower positions and current steering angles
    - User positions and received signal strength
    - Tower-user connectivity matrix (distance, angle, gain, path loss)
    - Network coverage metrics
    - Beam patterns for each tower
    """
    try:
        logger.info(f"[5G] Endpoint called with: {params.dict()}")
        result = SimulationService.run_5g(params.dict())
        return _handle_simulation_response(result, "5G")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[5G] Route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Radar Endpoint
# ============================================================================

@router.post("/simulate/radar")
async def radar_route(params: RadarParamsSchema) -> Dict[str, Any]:
    """Simulate radar system with target detection and Doppler processing.
    
    **Request Parameters:**
    - `num_elements`: Antenna elements (8-128)
    - `spacing`: Element spacing in wavelengths
    - `frequency`: Operating frequency in Hz (typical: 10e9)
    - `snr_db`: SNR in dB
    - `steering_angle_deg`: Beam steering angle
    - `scan_range_deg`: Angular scan range (default: 360°)
    - `enable_noise`: Add thermal noise and clutter
    - `grid_size`: Number of angle bins
    - `compute_doppler`: Compute range-Doppler map
    
    **Returns:**
    - Azimuth scan results (angle and received power)
    - Detected targets with SNR and confidence
    - Range-Doppler map with velocity estimates
    - Performance metrics (detection rate, false alarms)
    """
    try:
        logger.info(f"[Radar] Endpoint called with: {params.dict()}")
        result = SimulationService.run_radar(params.dict())
        return _handle_simulation_response(result, "Radar")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Radar] Route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Ultrasound Endpoint
# ============================================================================

@router.post("/simulate/ultrasound")
async def ultrasound_route(params: UltrasoundParamsSchema) -> Dict[str, Any]:
    """Simulate ultrasound B-mode and Doppler imaging.
    
    **Request Parameters:**
    - `num_elements`: Array elements (32-256)
    - `spacing`: Element spacing in wavelengths
    - `frequency`: Ultrasound frequency in Hz (typical: 5e6 for 5 MHz)
    - `snr_db`: SNR in dB
    - `max_depth_mm`: Maximum imaging depth in mm
    - `num_samples`: Axial sample points
    - `enable_noise`: Add thermal noise
    - `enable_speckle`: Add speckle pattern (realistic texture)
    - `run_doppler`: Also compute Doppler velocity imaging
    - `target_depth_mm`: Depth for Doppler imaging
    
    **Returns (B-mode):**
    - Depth axis (mm) and intensity profile (linear and dB)
    - Image quality metrics (contrast, SNR)
    - Tissue layer structure
    
    **Returns (Doppler, if requested):**
    - Doppler frequency spectrum
    - Mean velocity and pulsatility index
    - Blood flow velocity estimates
    """
    try:
        logger.info(f"[Ultrasound] Endpoint called with: {params.dict()}")
        result = SimulationService.run_ultrasound(params.dict())
        return _handle_simulation_response(result, "Ultrasound")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Ultrasound] Route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ultrasound/doppler-physics")
async def ultrasound_doppler_physics_route(params: UltrasoundDopplerPhysicsParamsSchema) -> Dict[str, Any]:
    """Evaluate Doppler physics equations for frontend time-trace rendering."""
    try:
        logger.info(f"[UltrasoundDopplerPhysics] Endpoint called with: {params.dict()}")
        result = SimulationService.compute_ultrasound_doppler_physics(params.dict())
        return _handle_simulation_response(result, "UltrasoundDopplerPhysics")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[UltrasoundDopplerPhysics] Route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Health Check Endpoint
# ============================================================================

@router.get("/health")
async def health_check() -> Dict[str, str]:
    """Health check endpoint to verify API is running.
    
    **Returns:**
    - Status message indicating API health
    """
    return {"status": "healthy", "message": "Beamforming simulator API is running"}
