"""FastAPI REST API server for beamforming backend"""

import sys
import os

# Ensure proper imports
backend_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(backend_dir)
sys.path.insert(0, backend_dir)
sys.path.insert(0, project_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    # Try relative imports first (when run as module)
    from .api.routes import router
except ImportError:
    # Fall back to absolute imports (when run directly)
    import sys
    import os
    sys.path.insert(0, os.path.dirname(__file__))
    from api.routes import router

app = FastAPI(
    title="Beam Weaver Backend",
    description="Beamforming simulation API with support for 5G, Radar, and Ultrasound",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the router
app.include_router(router)


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "Beam Weaver Backend", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    print("Starting Beam Weaver Backend Server...")
    print("API available at http://localhost:5000")
    print("\nAvailable endpoints:")
    print("  GET  /health                      - Health check")
    print("  POST /api/simulate/beamforming    - Beamforming simulation")
    print("  POST /api/simulate/5g             - 5G simulation")
    print("  POST /api/simulate/radar          - Radar simulation")
    print("  POST /api/simulate/ultrasound     - Ultrasound simulation")
    print("\nAPI Documentation: http://localhost:5000/docs")
    print("ReDoc Documentation: http://localhost:5000/redoc")
    uvicorn.run(app, host="127.0.0.1", port=5000)
