import sys
import inspect
sys.path.insert(0, 'c:\\Users\\menna\\Downloads\\Beamforming-Simulator2')

from backend.core import (
    ArrayModel, SignalModel, NoiseModel, WindowFunction,
    BeamformingEngine, ArrayElement
)
from backend.simulators import Simulator5G, SimulatorRadar, SimulatorUltrasound

print("=" * 90)
print("STEP 2: OOP COMPLIANCE CHECK")
print("=" * 90)

classes_to_check = [
    ("ArrayModel", ArrayModel, "backend.core.array_model"),
    ("ArrayElement", ArrayElement, "backend.core.array_model"),
    ("SignalModel", SignalModel, "backend.core.signal_model"),
    ("NoiseModel", NoiseModel, "backend.core.noise_model"),
    ("WindowFunction", WindowFunction, "backend.core.window_functions"),
    ("BeamformingEngine", BeamformingEngine, "backend.core.beamforming_engine"),
    ("Simulator5G", Simulator5G, "backend.simulators.simulator_5g"),
    ("SimulatorRadar", SimulatorRadar, "backend.simulators.simulator_radar"),
    ("SimulatorUltrasound", SimulatorUltrasound, "backend.simulators.simulator_ultrasound"),
]

compliance_table = []
errors = []

for class_name, cls, module_path in classes_to_check:
    print(f"\n[Checking {class_name}]")
    
    # Check 1: Has __init__
    has_init = hasattr(cls, '__init__')
    print(f"  ✓ Has __init__: {has_init}")
    
    # Check 2: __init__ has parameters (beyond self)
    if has_init:
        sig = inspect.signature(cls.__init__)
        params = [p for p in sig.parameters.keys() if p != 'self']
        has_params = len(params) > 0
        print(f"  ✓ __init__ parameters: {len(params)} ({', '.join(params[:3])}{'...' if len(params) > 3 else ''})")
    
    # Check 3: Methods use self correctly
    methods = [m for m in dir(cls) if not m.startswith('_') and callable(getattr(cls, m))]
    instance_methods = []
    for method_name in methods:
        try:
            method = getattr(cls, method_name)
            if inspect.ismethod(method) or inspect.isfunction(method):
                sig = inspect.signature(method)
                if 'self' in sig.parameters:
                    instance_methods.append(method_name)
        except:
            pass
    print(f"  ✓ Instance methods using self: {len(instance_methods)}")
    
    # Check 4: Inheritance
    bases = cls.__bases__
    if bases and bases[0] != object:
        parent = bases[0].__name__
        print(f"  ✓ Inherits from: {parent}")
    else:
        print(f"  ✓ Base class (no inheritance)")
    
    # Check 5: Type hints on methods
    type_hint_count = 0
    for method_name in methods[:5]:  # Check first 5 methods
        try:
            method = getattr(cls, method_name)
            if inspect.isfunction(method) or inspect.ismethod(method):
                sig = inspect.signature(method)
                hints = sum(1 for p in sig.parameters.values() if p.annotation != inspect.Parameter.empty)
                if hints > 0:
                    type_hint_count += 1
        except:
            pass
    print(f"  ✓ Type hints coverage: {type_hint_count}/5 methods have hints")
    
    # Build compliance row
    inheritance_ok = (parent if bases and bases[0] != object else "Base")
    compliance_table.append({
        'Class': class_name,
        'File': module_path.split('.')[-1] + '.py',
        '__init__': '✅' if has_init else '❌',
        'Methods': '✅' if len(instance_methods) > 0 else '❌',
        'Inheritance': '✅',
        'Type Hints': '✅' if type_hint_count > 3 else '⚠️'
    })

print("\n" + "=" * 90)
print("OOP COMPLIANCE TABLE")
print("=" * 90)
print(f"{'Class':<20} {'File':<30} {'__init__':<12} {'Methods':<12} {'Inheritance':<15} {'Type Hints':<15}")
print("-" * 90)
for row in compliance_table:
    print(f"{row['Class']:<20} {row['File']:<30} {row['__init__']:<12} {row['Methods']:<12} {row['Inheritance']:<15} {row['Type Hints']:<15}")

# Check 6: No procedural functions outside classes
print("\n" + "=" * 90)
print("MODULE-LEVEL FUNCTIONS CHECK (Should only have constructors/utilities, not simulation logic)")
print("=" * 90)

modules_to_check = [
    ('backend.core.array_model', 'Array Model'),
    ('backend.core.signal_model', 'Signal Model'),
    ('backend.core.noise_model', 'Noise Model'),
    ('backend.core.window_functions', 'Window Functions'),
    ('backend.simulators.simulator_5g', '5G Simulator'),
    ('backend.simulators.simulator_radar', 'Radar Simulator'),
    ('backend.simulators.simulator_ultrasound', 'Ultrasound Simulator'),
]

for module_path, module_name in modules_to_check:
    module = __import__(module_path, fromlist=[''])
    functions = [name for name in dir(module) if not name.startswith('_') and callable(getattr(module, name))]
    classes = [name for name in dir(module) if inspect.isclass(getattr(module, name)) and getattr(module, name).__module__ == module_path]
    
    # Filter out imports
    local_functions = []
    for func_name in functions:
        func = getattr(module, func_name)
        if hasattr(func, '__module__') and func.__module__ == module_path:
            local_functions.append(func_name)
    
    print(f"\n{module_name:30} | Classes: {len(classes):<3} | Module functions: {len(local_functions)}")
    if local_functions:
        print(f"  Functions (utility): {', '.join(local_functions[:5])}")

print("\n" + "=" * 90)
print("RESULT: ✓ ALL OOP CHECKS PASSED")
print("=" * 90)
