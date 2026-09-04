import json
from datetime import datetime, timezone
from pathlib import Path

src = Path('data/route-topology.json')
out = Path('data/topology.generated.json')
data = json.loads(src.read_text(encoding='utf-8'))
data['generatedAt'] = datetime.now(timezone.utc).isoformat()
data['source'] = 'Guarded verified topology seed. No tenant position is inferred from lot numbering.'
out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'Wrote {out}')
