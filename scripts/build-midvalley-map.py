import csv
import io
import json
import re
import subprocess
import urllib.request
from collections import Counter
from pathlib import Path

from PIL import Image

PDF_URL = 'https://www.midvalley.com.my/pdf/shop-mall-map.pdf'
WORK = Path('/tmp/midvalley-floor-map')
OUT = Path('data/midvalley-map.generated.json')
WORK.mkdir(parents=True, exist_ok=True)

pdf = WORK / 'map.pdf'
req = urllib.request.Request(PDF_URL, headers={'User-Agent': 'Mozilla/5.0 MidValleyIndoorRoute/2.0'})
with urllib.request.urlopen(req, timeout=45) as r:
    pdf.write_bytes(r.read())

prefix = WORK / 'map'
subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-png', '-r', '240', str(pdf), str(prefix)], check=True)
png = prefix.with_suffix('.png')
img = Image.open(png).convert('RGB')
w, h = img.size

# Palette statistics help us keep the walkable-corridor extraction tied to the official map artwork.
thumb = img.copy()
thumb.thumbnail((900, 2200))
q = thumb.quantize(colors=24, method=Image.Quantize.MEDIANCUT).convert('RGB')
palette = [{'rgb': list(rgb), 'count': count} for rgb, count in Counter(q.getdata()).most_common(24)]

# One OCR pass only. We use it for lot/zone labels and validate candidates against lot-like syntax.
tsv = subprocess.check_output(['tesseract', str(png), 'stdout', '--psm', '11', 'tsv'], text=True, stderr=subprocess.DEVNULL)
reader = csv.DictReader(io.StringIO(tsv), delimiter='\t')
lot_re = re.compile(r'^(?:LG|G|F|S|T|P1|P2|SP1|SP2|NP1|NP2|TK|FK|GK|SK|PK)?[-]?[A-Z]?[0-9]{1,3}[A-Z]?(?:[-/&][A-Z0-9]+)*$', re.I)
raw = []
for row in reader:
    text = (row.get('text') or '').strip()
    if not text:
        continue
    compact = re.sub(r'\s+', '', text).replace('—', '-').replace('–', '-')
    if not lot_re.match(compact):
        continue
    try:
        conf = float(row.get('conf') or -1)
        left = int(row.get('left') or 0); top = int(row.get('top') or 0)
        width = int(row.get('width') or 0); height = int(row.get('height') or 0)
    except ValueError:
        continue
    if conf < 20:
        continue
    raw.append({'text': compact.upper(), 'confidence': conf, 'x': left + width/2, 'y': top + height/2, 'w': width, 'h': height})

# The official single-page mall map stacks floors vertically. Determine floor bands from the artwork proportions.
# Values are deliberately broad; later topology validation attaches only lot labels that match current official tenant data.
bands = [
    ('3', 0.06, 0.25),
    ('2', 0.24, 0.43),
    ('1', 0.41, 0.59),
    ('G', 0.57, 0.74),
    ('LG', 0.72, 0.86),
    ('P1', 0.84, 0.93),
    ('P2', 0.91, 0.985),
]

def floor_for(y):
    r = y / h
    matches = [(f, lo, hi) for f, lo, hi in bands if lo <= r <= hi]
    if not matches:
        return ''
    return min(matches, key=lambda x: abs(r - (x[1]+x[2])/2))[0]

lots = []
seen = set()
for item in raw:
    floor = floor_for(item['y'])
    key = (floor, item['text'], round(item['x']/8), round(item['y']/8))
    if key in seen:
        continue
    seen.add(key)
    lots.append({**item, 'floor': floor, 'xNorm': round(item['x']/w, 6), 'yNorm': round(item['y']/h, 6)})

payload = {
    'schemaVersion': 1,
    'source': PDF_URL,
    'generatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
    'image': {'width': w, 'height': h},
    'palette': palette,
    'ocrCandidates': lots,
    'note': 'OCR candidates are not route truth by themselves. They must match current official tenant lots before use.'
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
print(f'Official floor map: {w}x{h}; extracted {len(lots)} lot-like OCR candidates.')
