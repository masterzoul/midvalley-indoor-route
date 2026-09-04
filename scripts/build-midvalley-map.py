import csv
import hashlib
import io
import json
import re
import subprocess
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime, timezone

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

PDF_URL = 'https://www.midvalley.com.my/pdf/shop-mall-map.pdf'
WORK = Path('/tmp/midvalley-floor-map')
OUT = Path('data/midvalley-map.generated.json')
PLACES = Path('data/places.generated.json')
EXTRACTOR_VERSION = 4
WORK.mkdir(parents=True, exist_ok=True)

pdf = WORK / 'map.pdf'
req = urllib.request.Request(PDF_URL, headers={'User-Agent': 'Mozilla/5.0 MidValleyIndoorRoute/4.0'})
with urllib.request.urlopen(req, timeout=45) as r:
    pdf_bytes = r.read()
pdf.write_bytes(pdf_bytes)
pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()

# Avoid repeating OCR on the daily tenant sync when the official floor-plan PDF
# has not changed. A new extractor version intentionally forces one fresh pass.
if OUT.exists():
    try:
        old = json.loads(OUT.read_text(encoding='utf-8'))
        if old.get('sourceSha256') == pdf_sha and old.get('extractorVersion') == EXTRACTOR_VERSION:
            print(f'Official floor map unchanged ({pdf_sha[:12]}); reusing {OUT}.')
            raise SystemExit(0)
    except (json.JSONDecodeError, OSError):
        pass

# The PDF has no useful machine-readable text layer. Render once, then perform
# ONE OCR pass on a composite of enlarged floor crops. This is substantially
# more reliable than OCR on the full tall page while still avoiding repeated OCR.
prefix = WORK / 'map'
subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-png', '-r', '600', str(pdf), str(prefix)], check=True)
png = prefix.with_suffix('.png')
img = Image.open(png).convert('RGB')
w, h = img.size

# Bands are tied to the official stacked one-page Mid Valley map artwork.
bands = [
    ('3', 0.010, 0.195),
    ('2', 0.195, 0.310),
    ('1', 0.305, 0.420),
    ('G', 0.415, 0.545),
    ('LG', 0.535, 0.655),
    ('P1', 0.650, 0.760),
    ('P2', 0.750, 0.875),
]

thumb = img.copy(); thumb.thumbnail((900, 2200))
q = thumb.quantize(colors=24, method=Image.Quantize.MEDIANCUT).convert('RGB')
palette = [{'rgb': list(rgb), 'count': count} for rgb, count in Counter(q.getdata()).most_common(24)]

# Crop away most of the green page margin, enlarge each floor independently,
# increase local contrast, then stack all floors into one OCR image.
x0 = int(w * 0.075)
x1 = int(w * 0.825)
scale = 2.0
separator = 48
tiles = []
max_width = 0
for floor, lo, hi in bands:
    y0 = max(0, int(h * max(0, lo - 0.006)))
    y1 = min(h, int(h * min(1, hi + 0.006)))
    crop = img.crop((x0, y0, x1, y1))
    gray = ImageOps.grayscale(crop)
    gray = ImageOps.autocontrast(gray, cutoff=0.5)
    gray = ImageEnhance.Contrast(gray).enhance(1.75)
    gray = gray.filter(ImageFilter.UnsharpMask(radius=1.2, percent=165, threshold=2))
    enlarged = gray.resize((int(gray.width * scale), int(gray.height * scale)), Image.Resampling.LANCZOS)
    tiles.append({'floor': floor, 'y0': y0, 'y1': y1, 'image': enlarged})
    max_width = max(max_width, enlarged.width)

composite_height = sum(t['image'].height for t in tiles) + separator * (len(tiles) - 1)
composite = Image.new('L', (max_width, composite_height), 255)
cy = 0
for t in tiles:
    t['compositeTop'] = cy
    composite.paste(t['image'], (0, cy))
    cy += t['image'].height + separator
ocr_png = WORK / 'floors-ocr.png'
composite.save(ocr_png, optimize=True)

cmd = [
    'tesseract', str(ocr_png), 'stdout', '--psm', '11',
    '-c', 'preserve_interword_spaces=1',
    '-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-()/&',
    'tsv'
]
tsv = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
rows = list(csv.DictReader(io.StringIO(tsv), delimiter='\t'))

# Match an OCR coordinate back to the source floor tile/original PDF raster.
def source_point(cx, cy):
    for t in tiles:
        top = t['compositeTop']
        bottom = top + t['image'].height
        if top <= cy <= bottom:
            sx = x0 + cx / scale
            sy = t['y0'] + (cy - top) / scale
            return t['floor'], sx, sy
    return '', cx / scale, cy / scale

PREFIXES = ('SP1', 'SP2', 'NP1', 'NP2', 'LG', 'GE', 'G', 'F', 'S', 'T')
# O/I/L are allowed in the numeric portion because they are common OCR errors.
lot_like_re = re.compile(r'(?:SP1|SP2|NP1|NP2|LG|GE|G|F|S|T)-?[0-9OIL]{1,3}[A-Z]?')

def canon(text):
    x = str(text or '').upper().replace('—', '-').replace('–', '-')
    x = x.replace('G(E)', 'GE')
    return re.sub(r'[^A-Z0-9()\-/&]', '', x)

def code_key(raw):
    x = canon(raw).replace('-', '')
    prefix = next((p for p in PREFIXES if x.startswith(p)), '')
    if not prefix:
        return ''
    tail = x[len(prefix):]
    # Only correct OCR-confusable characters after a recognised lot prefix.
    tail = tail.replace('O', '0').replace('I', '1').replace('L', '1')
    m = re.match(r'^([0-9]{1,3})([A-Z]?)$', tail)
    if not m:
        return ''
    return prefix + m.group(1) + m.group(2)

def lot_tokens(text):
    c = canon(text)
    return [m.group(0) for m in lot_like_re.finditer(c)]

def official_codes(lot):
    # First capture normal prefixed codes.
    found = []
    c = canon(lot)
    for token in lot_tokens(c):
        key = code_key(token)
        if key:
            found.append(key)
    # Expand compact forms such as F-003 & 004 using the previous prefix.
    if found:
        prefix = re.match(r'^[A-Z0-9]+?(?=[0-9]{3}|[0-9]{2}|[0-9])', found[0])
        pfx = prefix.group(0) if prefix else ''
        for bare in re.findall(r'(?:&|/)[-]?([0-9]{1,3}[A-Z]?)', c):
            if pfx:
                found.append(pfx + bare)
    return set(found)

code_to_tenants = defaultdict(list)
if PLACES.exists():
    pdata = json.loads(PLACES.read_text(encoding='utf-8'))
    for p in pdata.get('places', []):
        if p.get('kind') != 'tenant':
            continue
        for code in official_codes(p.get('lot', '')):
            code_to_tenants[code].append({
                'id': p.get('id'), 'name': p.get('name'), 'lot': p.get('lot'), 'floor': p.get('floor')
            })

# Group words by OCR line. The composite-floor position is converted back to
# original source coordinates only after the line bounding box is known.
groups = defaultdict(list)
for row in rows:
    text = (row.get('text') or '').strip()
    if not text:
        continue
    try:
        conf = float(row.get('conf') or -1)
        left = int(row.get('left') or 0); top = int(row.get('top') or 0)
        ww = int(row.get('width') or 0); hh = int(row.get('height') or 0)
    except ValueError:
        continue
    if conf < 8:
        continue
    key = (row.get('page_num'), row.get('block_num'), row.get('par_num'), row.get('line_num'))
    groups[key].append((left, top, ww, hh, text, conf))

candidates = []
seen = set()
matched_codes = set()
audit = []
for words in groups.values():
    words.sort(key=lambda z: z[0])
    # Keep both joined and spaced variants because OCR may split G 040.
    joined = ''.join(wd[4] for wd in words)
    spaced = ' '.join(wd[4] for wd in words)
    raw_tokens = lot_tokens(joined) + lot_tokens(spaced.replace(' ', ''))
    if not raw_tokens:
        continue
    left = min(z[0] for z in words); top = min(z[1] for z in words)
    right = max(z[0] + z[2] for z in words); bottom = max(z[1] + z[3] for z in words)
    ccx = (left + right) / 2; ccy = (top + bottom) / 2
    floor, sx, sy = source_point(ccx, ccy)
    keys = []
    for raw_token in raw_tokens:
        token = code_key(raw_token)
        if not token or token in keys:
            continue
        keys.append(token)
        expected = [
            t for t in code_to_tenants.get(token, [])
            if not floor or not t.get('floor') or t.get('floor') == floor
        ]
        if not expected:
            continue
        dedupe = (floor, token, round(sx / 10), round(sy / 10))
        if dedupe in seen:
            continue
        seen.add(dedupe); matched_codes.add(token)
        candidates.append({
            'code': token,
            'ocrToken': raw_token,
            'ocrLine': spaced,
            'floor': floor,
            'x': round(sx, 1), 'y': round(sy, 1),
            'xNorm': round(sx / w, 7), 'yNorm': round(sy / h, 7),
            'confidence': round(sum(z[5] for z in words) / len(words), 2),
            'tenants': expected
        })
    audit.append({
        'text': spaced,
        'tokens': keys,
        'floor': floor,
        'xNorm': round(sx / w, 7), 'yNorm': round(sy / h, 7)
    })

payload = {
    'schemaVersion': 4,
    'extractorVersion': EXTRACTOR_VERSION,
    'source': PDF_URL,
    'sourceSha256': pdf_sha,
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'image': {'width': w, 'height': h, 'dpi': 600},
    'ocrStrategy': 'single-pass-composite-enlarged-floor-crops',
    'floorBands': [{'floor': f, 'from': lo, 'to': hi} for f, lo, hi in bands],
    'palette': palette,
    'matchedLotLabels': candidates,
    'matchedCodeCount': len(matched_codes),
    'officialCodeCount': len(code_to_tenants),
    'coveragePercent': round((len(matched_codes) / max(1, len(code_to_tenants))) * 100, 2),
    'ocrAudit': audit,
    'note': 'Lot coordinates are accepted only when a normalized OCR lot code matches a current official Mid Valley tenant lot on the same floor. This extractor performs one OCR pass only and reuses cached output when the official PDF is unchanged.'
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
print(
    f'Official floor map {w}x{h}; matched {len(candidates)} positions across '
    f'{len(matched_codes)} of {len(code_to_tenants)} official lot codes '
    f'({payload["coveragePercent"]}%) using one composite OCR pass.'
)
