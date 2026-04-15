"""Verify clean architecture: routes → service → simulators → core"""

import sys
import os
import re
sys.path.insert(0, '.')

print("=" * 80)
print("ARCHITECTURE VERIFICATION TEST")
print("=" * 80)
print()

# Test 1: Verify routes.py only calls service.py
print("TEST 1: Verify routes.py calls service.py ONLY")
print("-" * 80)
with open('api/routes.py', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()
    
# Look for function calls (excluding imports and comments)
lines = content.split('\n')
service_calls = 0
direct_core_calls = 0
direct_sim_calls = 0

for line in lines:
    # Skip imports and comments
    if line.strip().startswith('import') or line.strip().startswith('from') or line.strip().startswith('#'):
        continue
    # Count SimulationService calls
    if 'SimulationService.' in line:
        service_calls += 1
    # Check for direct core calls (should be none)
    if re.search(r'\b(run_simulation|compute_beam_pattern|array_factor)\b', line) and 'from' not in line:
        direct_core_calls += 1
    # Check for direct simulator calls (should be none)
    if re.search(r'\b(simulate_5g|simulate_radar|simulate_ultrasound)\b', line) and 'from' not in line:
        direct_sim_calls += 1

print(f"  SimulationService calls: {service_calls}")
print(f"  Direct core calls: {direct_core_calls}")
print(f"  Direct simulator calls: {direct_sim_calls}")

if direct_core_calls == 0 and direct_sim_calls == 0:
    print("  ✓ routes.py calls service.py ONLY (no direct core or simulator imports)")
else:
    print(f"  ✗ ERROR: Found {direct_core_calls} direct core calls, {direct_sim_calls} direct simulator calls")

print()

# Test 2: Verify service.py calls simulators and core
print("TEST 2: Verify service.py calls simulators and core")
print("-" * 80)
with open('service.py', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

has_core_import = 'from .core import' in content or 'from core import' in content
has_sim_import = 'from .simulators import' in content or 'from simulators import' in content

print(f"  Imports core: {has_core_import}")
print(f"  Imports simulators: {has_sim_import}")

if has_core_import and has_sim_import:
    print("  ✓ service.py imports both core and simulators")
else:
    print(f"  ✗ ERROR: Missing imports")

# Check for service calling core and simulators
lines = content.split('\n')
core_calls = sum(1 for line in lines if 'run_simulation' in line and 'def' not in line and 'from' not in line)
sim_calls = sum(1 for line in lines if re.search(r'\b(simulate_5g|simulate_radar|simulate_ultrasound)\b', line) and 'def' not in line and 'from' not in line)

print(f"  Core function calls: {core_calls}")
print(f"  Simulator function calls: {sim_calls}")

if core_calls > 0 and sim_calls > 0:
    print("  ✓ service.py calls both core and simulators")

print()

# Test 3: Verify simulators import from core only
print("TEST 3: Verify simulators import from core ONLY")
print("-" * 80)

sim_files = [
    'simulators/simulator_5g.py',
    'simulators/simulator_radar.py', 
    'simulators/simulator_ultrasound.py'
]

all_good = True
for sim_file in sim_files:
    if not os.path.exists(sim_file):
        continue
        
    with open(sim_file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    has_core = 'from ..core import' in content or 'from core import' in content
    has_api = 'from ..api import' in content or 'from api import' in content
    has_service = 'from ..service import' in content or 'from service import' in content
    
    print(f"  {sim_file}:")
    print(f"    - imports from core: {has_core}")
    print(f"    - imports from api: {has_api}")
    print(f"    - imports from service: {has_service}")
    
    if has_core and not has_api and not has_service:
        print(f"    ✓ Clean (core only)")
    else:
        print(f"    ✗ ERROR: Unexpected imports")
        all_good = False

print()

# Test 4: Verify core modules have no service/api/simulator imports
print("TEST 4: Verify core modules are independent")
print("-" * 80)

core_files = [
    'core/array_model.py',
    'core/signal_model.py',
    'core/noise_model.py',
    'core/window_functions.py',
    'core/interference_map.py',
    'core/beamforming_engine.py'
]

for core_file in core_files:
    if not os.path.exists(core_file):
        continue
        
    with open(core_file, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    has_api = 'from ..api import' in content or 'from api import' in content
    has_service = 'from ..service import' in content or 'from service import' in content
    has_sim = 'from ..simulators import' in content or 'from simulators import' in content
    
    print(f"  {core_file}:")
    if not has_api and not has_service and not has_sim:
        print(f"    ✓ No external dependencies (pure physics)")
    else:
        deps = []
        if has_api: deps.append('api')
        if has_service: deps.append('service')
        if has_sim: deps.append('simulators')
        print(f"    ✗ ERROR: Unexpected imports: {deps}")
        all_good = False

print()

# Test 5: Visualize the architecture
print("TEST 5: Architecture Flow Visualization")
print("-" * 80)
print("""
  ┌─────────────────────────────────────────┐
  │ API Routes (api/routes.py)              │
  │ - beamforming_route                     │
  │ - five_g_route                          │
  │ - radar_route                           │
  │ - ultrasound_route                      │
  └──────────────────┬──────────────────────┘
                     │ calls
                     ▼
  ┌─────────────────────────────────────────┐
  │ Service Layer (service.py)              │
  │ - run_beamforming()                     │
  │ - run_5g()                              │
  │ - run_radar()                           │
  │ - run_ultrasound()                      │
  └──┬────────────────────────────────────┬─┘
     │                                    │
     │ calls                              │ calls
     ▼                                    ▼
  ┌──────────────────────┐        ┌──────────────────────┐
  │ Core (core/*.py)     │        │ Simulators/*.py      │
  │ - run_simulation()   │        │ - simulate_5g()      │
  │ - compute_*()        │        │ - simulate_radar()   │
  │ - array_factor()     │        │ - simulate_ultrasound()
  │ - apply_window()     │        │                      │
  │ - add_noise()        │        └────────┬─────────────┘
  │ - etc.               │                 │ uses
  └──────────────────────┘                 │
                                           ▼
                                      ┌────────────┐
                                      │ Core       │
                                      └────────────┘
""")

print()
print("=" * 80)
if all_good:
    print("✓ ARCHITECTURE VERIFIED: Clean layering with no circular dependencies")
else:
    print("✗ ARCHITECTURE HAS ISSUES: See errors above")
print("=" * 80)
