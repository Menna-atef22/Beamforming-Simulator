from backend.service import SimulationService
r = SimulationService.run_5g({
    'num_elements': 16,
    # Coverage wide enough to serve both users from T2
    'towers': [
        {'id': 1, 'x': -30, 'y': 0},
        {'id': 2, 'x':   0, 'y': 0},
        {'id': 3, 'x':  30, 'y': 0},
    ],
    'users': [
        {'id': 101, 'x': 0.5, 'y': 1.5},
        {'id': 102, 'x': -0.5, 'y': 2.0},
    ]
})
if not r['success']:
    print('ERROR:', r['error'])
else:
    for c in r['data']['connectivity_map']:
        print(f"  {c}")
    for u in r['data']['users']:
        print(f"U{u['id']} -> T{u.get('connected_tower_id')}")
    for bp in r['data']['beam_patterns']:
        ea = bp.get('element_allocations', [])
        if ea:
            label = ' + '.join(f"{a['num_elements']}->U{a['user_id']}" for a in ea)
            print(f"T{bp['tower_id']}: {label}")
        else:
            print(f"T{bp['tower_id']}: no users")
