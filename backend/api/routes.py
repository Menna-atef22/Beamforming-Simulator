"""API Routes and endpoint definitions for FastAPI"""

import sys
import logging
from fastapi import APIRouter, HTTPException
from typing import Dict, Any

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

try:
    from ..service import SimulationService
    from ..serializers import (
        serialize_beamforming_result,
        serialize_5g_result,
        serialize_radar_result,
        serialize_ultrasound_result
    )
    from .schemas import (
        BeamformingParamsSchema,
        BeamformingResultSchema,
        FiveGResultSchema,
        RadarResultSchema,
        UltrasoundResultSchema,
        ErrorResponseSchema
    )
except ImportError:
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from service import SimulationService
    from serializers import (
        serialize_beamforming_result,
        serialize_5g_result,
        serialize_radar_result,
        serialize_ultrasound_result
    )
    from .schemas import (
        BeamformingParamsSchema,
        BeamformingResultSchema,
        FiveGResultSchema,
        RadarResultSchema,
        UltrasoundResultSchema,
        ErrorResponseSchema
    )


# ============================================================================
# Simulation Handlers (API business logic layer)
# ============================================================================

def beamforming_simulation(params_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Handle beamforming simulation request"""
    try:
        logger.info(f"[Beamforming] Starting simulation with params: {params_dict}")
        result = SimulationService.run_beamforming(params_dict)
        logger.info("[Beamforming] Simulation completed successfully")
        return {
            "success": True,
            "data": serialize_beamforming_result(result)
        }
    except Exception as e:
        logger.error(f"[Beamforming] Simulation failed: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


def five_g_simulation(params_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Handle 5G simulation request"""
    try:
        logger.info(f"[5G] Starting simulation with params: {params_dict}")
        result = SimulationService.run_5g(params_dict)
        logger.info("[5G] Simulation completed successfully")
        return {
            "success": True,
            "data": serialize_5g_result(result)
        }
    except Exception as e:
        logger.error(f"[5G] Simulation failed: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


def radar_simulation(params_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Handle Radar simulation request"""
    try:
        logger.info(f"[Radar] Starting simulation with params: {params_dict}")
        result = SimulationService.run_radar(params_dict)
        logger.info("[Radar] Simulation completed successfully")
        return {
            "success": True,
            "data": serialize_radar_result(result)
        }
    except Exception as e:
        logger.error(f"[Radar] Simulation failed: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


def ultrasound_simulation(params_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Handle Ultrasound simulation request"""
    try:
        logger.info(f"[Ultrasound] Starting simulation with params: {params_dict}")
        result = SimulationService.run_ultrasound(params_dict)
        logger.info("[Ultrasound] Simulation completed successfully")
        return {
            "success": True,
            "data": serialize_ultrasound_result(result)
        }
    except Exception as e:
        logger.error(f"[Ultrasound] Simulation failed: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================================
# FastAPI Routes
# ============================================================================

# Create FastAPI router
router = APIRouter(prefix="/api", tags=["simulations"])


@router.post(
    "/simulate/beamforming",
    response_model=BeamformingResultSchema,
    responses={400: {"model": ErrorResponseSchema}, 500: {"model": ErrorResponseSchema}}
)
async def beamforming_route(params: BeamformingParamsSchema):
    """Beamforming simulation endpoint"""
    try:
        logger.info("[Route] Beamforming endpoint called")
        result = beamforming_simulation(params.dict())
        if result.get("success"):
            logger.info("[Route] Beamforming route returning success")
            return result
        else:
            error_msg = result.get("error", "Simulation failed")
            logger.warning(f"[Route] Beamforming simulation error: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Route] Beamforming route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/simulate/5g",
    response_model=FiveGResultSchema,
    responses={400: {"model": ErrorResponseSchema}, 500: {"model": ErrorResponseSchema}}
)
async def five_g_route(params: BeamformingParamsSchema):
    """5G simulation endpoint"""
    try:
        logger.info("[Route] 5G endpoint called")
        result = five_g_simulation(params.dict())
        if result.get("success"):
            logger.info("[Route] 5G route returning success")
            return result
        else:
            error_msg = result.get("error", "Simulation failed")
            logger.warning(f"[Route] 5G simulation error: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Route] 5G route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/simulate/radar",
    response_model=RadarResultSchema,
    responses={400: {"model": ErrorResponseSchema}, 500: {"model": ErrorResponseSchema}}
)
async def radar_route(params: BeamformingParamsSchema):
    """Radar simulation endpoint"""
    try:
        logger.info("[Route] Radar endpoint called")
        result = radar_simulation(params.dict())
        if result.get("success"):
            logger.info("[Route] Radar route returning success")
            return result
        else:
            error_msg = result.get("error", "Simulation failed")
            logger.warning(f"[Route] Radar simulation error: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Route] Radar route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/simulate/ultrasound",
    response_model=UltrasoundResultSchema,
    responses={400: {"model": ErrorResponseSchema}, 500: {"model": ErrorResponseSchema}}
)
async def ultrasound_route(params: BeamformingParamsSchema):
    """Ultrasound simulation endpoint"""
    try:
        logger.info("[Route] Ultrasound endpoint called")
        result = ultrasound_simulation(params.dict())
        if result.get("success"):
            logger.info("[Route] Ultrasound route returning success")
            return result
        else:
            error_msg = result.get("error", "Simulation failed")
            logger.warning(f"[Route] Ultrasound simulation error: {error_msg}")
            raise HTTPException(status_code=400, detail=error_msg)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Route] Ultrasound route exception: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))
