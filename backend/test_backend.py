"""Backend integration test - test all 4 simulation endpoints"""

import requests
import json
import sys
from typing import Dict, Any

API_URL = "http://localhost:5000"
TIMEOUT = 10

def test_endpoint(endpoint: str, params: Dict[str, Any], name: str) -> bool:
    """Test a single endpoint"""
    print(f"\n{'='*70}")
    print(f"Testing: {name}")
    print(f"{'='*70}")
    print(f"Endpoint: POST {endpoint}")
    print(f"Params: {json.dumps(params, indent=2)}")
    
    try:
        response = requests.post(
            f"{API_URL}{endpoint}",
            json=params,
            timeout=TIMEOUT
        )
        
        print(f"\nStatus: {response.status_code}")
        
        if response.status_code != 200:
            print(f"ERROR: Expected 200, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        # Check response structure
        if "success" not in data:
            print("ERROR: Missing 'success' key in response")
            return False
        
        if not data["success"]:
            print(f"ERROR: success=false, error={data.get('error', 'unknown')}")
            return False
        
        if "data" not in data:
            print("ERROR: Missing 'data' key in response")
            return False
        
        result = data["data"]
        print(f"Result keys: {list(result.keys())}")
        
        # Validate response structure based on endpoint
        if endpoint == "/api/simulate/beamforming":
            # Beamforming response
            required_fields = ["array", "beam_pattern", "metrics"]
            missing = [f for f in required_fields if f not in result]
            if missing:
                print(f"ERROR: Missing required fields: {missing}")
                return False
            
            if not isinstance(result["array"], list) or len(result["array"]) == 0:
                print(f"ERROR: Invalid array")
                return False
            print(f"✓ Array: {len(result['array'])} elements")
            
            bp = result["beam_pattern"]
            if not all(k in bp for k in ["angles", "magnitudes", "magnitudes_db"]):
                print(f"ERROR: Invalid beam_pattern structure")
                return False
            print(f"✓ Beam pattern: {len(bp['angles'])} angle points")
            
            metrics = result["metrics"]
            required_metrics = ["beamwidth_deg", "sll_db", "main_lobe_angle_deg"]
            missing_metrics = [m for m in required_metrics if m not in metrics]
            if missing_metrics:
                print(f"ERROR: Missing metrics: {missing_metrics}")
                return False
            print(f"✓ Metrics:")
            print(f"    - beamwidth: {metrics['beamwidth_deg']:.2f}°")
            print(f"    - SLL: {metrics['sll_db']:.2f} dB")
            print(f"    - main lobe angle: {metrics['main_lobe_angle_deg']:.2f}°")
            
        elif endpoint == "/api/simulate/5g":
            # 5G response
            required_fields = ["towers", "users", "beam_patterns"]
            missing = [f for f in required_fields if f not in result]
            if missing:
                print(f"ERROR: Missing required fields: {missing}")
                return False
            print(f"✓ 5G Result:")
            print(f"    - towers: {len(result.get('towers', []))} towers")
            print(f"    - users: {len(result.get('users', []))} users")
            print(f"    - beam patterns: {len(result.get('beam_patterns', []))} patterns")
            
        elif endpoint == "/api/simulate/radar":
            # Radar response
            required_fields = ["angles", "returns", "targets", "beam_width_deg"]
            missing = [f for f in required_fields if f not in result]
            if missing:
                print(f"ERROR: Missing required fields: {missing}")
                return False
            print(f"✓ Radar Result:")
            print(f"    - angles: {len(result.get('angles', []))} points")
            print(f"    - returns: {len(result.get('returns', []))} returns")
            print(f"    - targets: {len(result.get('targets', []))} targets")
            print(f"    - beam width: {result.get('beam_width_deg', 0):.2f}°")
            
        elif endpoint == "/api/simulate/ultrasound":
            # Ultrasound response
            required_fields = ["depths", "amplitudes", "reflections"]
            missing = [f for f in required_fields if f not in result]
            if missing:
                print(f"ERROR: Missing required fields: {missing}")
                return False
            print(f"✓ Ultrasound Result:")
            print(f"    - depths: {len(result.get('depths', []))} depth points")
            print(f"    - amplitudes: {len(result.get('amplitudes', []))} amplitude points")
            print(f"    - reflections: {len(result.get('reflections', []))} reflections")
        
        print(f"\n✓ PASSED: {name}")
        return True
        
    except requests.exceptions.ConnectionError:
        print(f"ERROR: Cannot connect to {API_URL}")
        print("Make sure backend is running: python -m uvicorn app:app --reload")
        return False
    except requests.exceptions.Timeout:
        print(f"ERROR: Request timed out after {TIMEOUT}s")
        return False
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")
        return False


def main():
    """Run all tests"""
    print("=" * 70)
    print("BACKEND INTEGRATION TEST SUITE")
    print("=" * 70)
    
    base_params = {
        "num_elements": 16,
        "spacing": 0.5,
        "wavelength": 1.0,
        "steering_angle_deg": 0,
        "amplitude": 1.0,
        "snr_db": 30,
        "window_type": "rectangular",
        "noise_enabled": True,
        "apodization_enabled": False
    }
    
    tests = [
        ("/api/simulate/beamforming", base_params, "Beamforming Simulation"),
        ("/api/simulate/5g", base_params, "5G Simulation"),
        ("/api/simulate/radar", base_params, "Radar Simulation"),
        ("/api/simulate/ultrasound", base_params, "Ultrasound Simulation"),
    ]
    
    results = []
    for endpoint, params, name in tests:
        passed = test_endpoint(endpoint, params, name)
        results.append((name, passed))
    
    # Summary
    print(f"\n\n{'='*70}")
    print("TEST SUMMARY")
    print(f"{'='*70}")
    
    for name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{status}: {name}")
    
    total = len(results)
    passed = sum(1 for _, p in results if p)
    
    print(f"\n{passed}/{total} tests passed")
    
    if passed == total:
        print("\n✓ ALL TESTS PASSED - Backend is working!")
        return 0
    else:
        print(f"\n✗ {total - passed} test(s) failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
