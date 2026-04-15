# 🚀 Quick Start Guide - Beam Weaver

After reorganization, here's how to get started:

## 📁 New Structure Overview
```
beam-weaver/
├── backend/         ← Python FastAPI backend (Port 5000)
├── frontend/        ← React TypeScript frontend (Port 8080)
├── README.md        ← Main documentation
└── package.json     ← Root package manager
```

## ⚡ Installation & Setup (One Time)

### Option A: Install All Dependencies at Once
```bash
# From root directory
npm run install:all
```

### Option B: Install Separately
```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend  
cd frontend
npm install
```

## 🏃 Running Development Servers

### Option 1: Run Both Servers Together
```bash
# From root directory
npm run dev
```
This opens:
- Frontend: http://localhost:8080
- Backend: http://localhost:5000

### Option 2: Run Servers Separately

**Backend (Terminal 1):**
```bash
cd backend
python run_server.py
```

**Frontend (Terminal 2):**
```bash
cd frontend
npm run dev
```

## 🛠️ Common Commands

### From Root Directory
```bash
npm run dev              # Run both servers
npm run build            # Build frontend for production
npm run test             # Run all tests
npm run lint             # Lint frontend code
npm run test:frontend    # Test frontend only
npm run test:backend     # Test backend only
```

### From Frontend Directory
```bash
cd frontend
npm run dev              # Dev server
npm run build            # Production build
npm run test             # Run tests
npm run lint             # ESLint check
```

### From Backend Directory
```bash
cd backend
python run_server.py              # Start server
python test_backend.py            # Run tests
python verify_architecture.py     # Verify structure
```

## 📝 Project Structure Details

**Backend** (`backend/`)
- `core/` - Beamforming computation engine
- `api/` - API routes and request handlers
- `simulators/` - 5G, Radar, Ultrasound simulators
- `app.py` - FastAPI entry point
- `requirements.txt` - Python dependencies

**Frontend** (`frontend/`)
- `src/` - React TypeScript source code
  - `pages/` - Simulator pages (5G, Radar, Ultrasound)
  - `components/` - Reusable UI components
  - `hooks/` - Custom API integration hooks
  - `types/` - TypeScript type definitions
- `package.json` - npm dependencies

## ✅ Verification Checklist

After moving to the new structure:
- [ ] Folders moved correctly (`backend/` and `frontend/` at root)
- [ ] `backend/` contains `core/`, `api/`, `simulators/`
- [ ] `frontend/` contains `src/`, `public/`, `package.json`
- [ ] Root `README.md` and `package.json` created
- [ ] `npm run install:all` completes successfully
- [ ] `npm run dev` starts both servers
- [ ] Frontend accessible at http://localhost:8080
- [ ] Backend accessible at http://localhost:5000

## 🐛 Troubleshooting

**Port already in use:**
```bash
# Kill process on port 8080 (frontend)
npx kill-port 8080

# Kill process on port 5000 (backend)
npx kill-port 5000
```

**Python not found:**
```bash
# Use python3 instead
cd backend
python3 run_server.py
```

**npm modules issues:**
```bash
# Clear and reinstall
cd frontend
rm -r node_modules
npm install
```

**Backend import errors:**
```bash
# Reinstall Python dependencies
cd backend
pip install -r requirements.txt --force-reinstall
```

## 📚 Full Documentation

See [README.md](README.md) for complete documentation and [PROJECT_README.md](PROJECT_README.md) for detailed architecture.

---

**Ready to develop!** 🎉
