"""Start the FastAPI backend server"""
import uvicorn
import sys
import os

# Set working directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Run server
if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=5000,
        reload=True
    )
