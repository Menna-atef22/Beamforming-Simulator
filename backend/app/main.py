from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import (
    BeamformingRequest,
    BeamformingResponse,
    FiveGRequest,
    FiveGResponse,
    PhantomResponse,
    RadarRequest,
    RadarResponse,
    UltrasoundRequest,
    UltrasoundResponse,
)
from .simulation.beamforming import simulate_beamforming
from .simulation.fiveg import simulate_fiveg
from .simulation.radar import simulate_radar
from .simulation.ultrasound import default_phantom_shapes, default_vessel, simulate_ultrasound

app = FastAPI(title="Beamforming Simulator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/beamforming/field", response_model=BeamformingResponse)
def beamforming_field(req: BeamformingRequest) -> BeamformingResponse:
    return simulate_beamforming(req)


@app.post("/api/fiveg/simulate", response_model=FiveGResponse)
def fiveg_simulate(req: FiveGRequest) -> FiveGResponse:
    return simulate_fiveg(req)


@app.get("/api/ultrasound/phantom", response_model=PhantomResponse)
def ultrasound_phantom() -> PhantomResponse:
    return PhantomResponse(shapes=default_phantom_shapes(), vessel=default_vessel())


@app.post("/api/ultrasound/simulate", response_model=UltrasoundResponse)
def ultrasound_simulate(req: UltrasoundRequest) -> UltrasoundResponse:
    return simulate_ultrasound(req)


@app.post("/api/radar/simulate", response_model=RadarResponse)
def radar_simulate(req: RadarRequest) -> RadarResponse:
    return simulate_radar(req)
