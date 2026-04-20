"""Compatibility ASGI entrypoint for Uvicorn.

Allows running the backend with either:
- uvicorn app:app
- uvicorn main:app
- uvicorn backend.main:app
"""

try:
	# Package-style import (e.g., `uvicorn backend.main:app`).
	from .app import app
except ImportError:
	# Script-style import when CWD is `backend` (e.g., `uvicorn main:app`).
	from app import app

