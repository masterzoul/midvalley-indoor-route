import csv
import io
import json
import re
import subprocess
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from datetime import datetime, timezone

from PIL import Image

PDF_URL = 'https://www.midvalley.com.my/pdf/shop-mall-map.pdf'
WORK = Path('/tmp/midvalley-floor-map')
OUT = Path('data/midvalley-map.generated.json')
PLACES = Path('data/places.generated.json')
WORK.mkdir(parents=True, exist_ok=True)

pdf = WORK / 'map.pdf'
req = urllib.request.Request(PDF_URL, headers={'User-Agent': 'Mozilla/5.0 MidValleyIndoorRoute/3.1'})
with urllib.request.urlopen(req, timeout=45) as r:
    pdf.write_bytes(r.read())

# One high-resolution render + one OCR pass. The PDF has no useful text layer,
# so raster OCR is the last-resort source for printed lot coordinates.
prefix = WORK / 'map'
subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-png', '-r', '600', str(pdf), str(prefix)], check=True)
png = prefix.with_suffix('.png')
img = Image.open(png).convert('RGB')
w, h = img.size

thumb = img.copy(); thumb.thumbnail((900, 2200))
q = thumb.quantize(colors=24, method=Image.Quantize.MEDIANCUT).convert('RGB')
palette = [{'rgb': list(rgb), 'count': count} for rgb, count in Counter(q.getdata()).most_common(24)]

cmd=['tesseract',str(png),'stdout','--psm','11','-c','tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-()/&','tsv']
tsv=subprocess.check_output(cmd,text=True,stderr=subprocess.DEVNULL)
rows=list(csv.DictReader(io.StringIO(tsv),delimiter='\t'))

bands=[
    ('3',0.010,0.195),('2',0.205,0.300),('1',0.310,0.405),
    ('G',0.410,0.520),('LG',0.530,0.625),('P1',0.645,0.725),('P2',0.730,0.810),
]
def floor_for(y):
    r=y/h
    for f,lo,hi in bands:
        if lo<=r<=hi:return f
    return ''

def canon(text):
    x=str(text or '').upper().replace('—','-').replace('–','-')
    x=re.sub(r'[^A-Z0-9()/-]','',x)
    x=re.sub(r'^(LG|G|F|S|T|SP1|SP2|NP1|NP2)(.*)$',lambda m:m.group(1)+m.group(2).replace('O','0').replace('I','1').replace('L','1'),x)
    return x.replace('G(E)','GE')

lot_token_re=re.compile(r'(?:LG|GE|G|F|S|T|SP1|SP2|NP1|NP2)-?[0-9]{1,3}[A-Z]?')
def code_key(code):
    # Official directory commonly uses G-040 while map artwork/OCR reads G040.
    # Treat punctuation as formatting only; keep prefix, digits and suffix intact.
    return re.sub(r'[^A-Z0-9]','',canon(code))
def official_codes(lot):
    return {code_key(x) for x in lot_token_re.findall(canon(lot))}

code_to_tenants=defaultdict(list)
if PLACES.exists():
    pdata=json.loads(PLACES.read_text(encoding='utf-8'))
    for p in pdata.get('places',[]):
        if p.get('kind')!='tenant':continue
        for code in official_codes(p.get('lot','')):
            code_to_tenants[code].append({'id':p.get('id'),'name':p.get('name'),'lot':p.get('lot'),'floor':p.get('floor')})

groups=defaultdict(list)
for row in rows:
    text=(row.get('text') or '').strip()
    if not text:continue
    try:
        conf=float(row.get('conf') or -1); left=int(row.get('left') or 0); top=int(row.get('top') or 0); ww=int(row.get('width') or 0); hh=int(row.get('height') or 0)
    except ValueError:continue
    if conf<12:continue
    key=(row.get('page_num'),row.get('block_num'),row.get('par_num'),row.get('line_num'))
    groups[key].append((left,top,ww,hh,text,conf))

candidates=[];seen=set();matched_codes=set()
for words in groups.values():
    words.sort(key=lambda z:z[0]);line=''.join(wd[4] for wd in words);c=canon(line);tokens=lot_token_re.findall(c)
    if not tokens:continue
    left=min(z[0] for z in words);top=min(z[1] for z in words);right=max(z[0]+z[2] for z in words);bottom=max(z[1]+z[3] for z in words)
    cx=(left+right)/2;cy=(top+bottom)/2;floor=floor_for(cy)
    for raw_token in tokens:
        token=code_key(raw_token)
        expected=[t for t in code_to_tenants.get(token,[]) if not floor or not t.get('floor') or t.get('floor')==floor]
        if not expected:continue
        key=(floor,token,round(cx/10),round(cy/10))
        if key in seen:continue
        seen.add(key);matched_codes.add(token)
        candidates.append({'code':token,'ocrToken':raw_token,'ocrLine':line,'floor':floor,'x':round(cx,1),'y':round(cy,1),'xNorm':round(cx/w,7),'yNorm':round(cy/h,7),'confidence':round(sum(z[5] for z in words)/len(words),2),'tenants':expected})

audit=[]
for words in groups.values():
    words.sort(key=lambda z:z[0]);line=''.join(wd[4] for wd in words);c=canon(line);tokens=lot_token_re.findall(c)
    if not tokens:continue
    left=min(z[0] for z in words);top=min(z[1] for z in words);right=max(z[0]+z[2] for z in words);bottom=max(z[1]+z[3] for z in words);cx=(left+right)/2;cy=(top+bottom)/2
    audit.append({'text':line,'canonical':c,'tokens':[code_key(t) for t in tokens],'floor':floor_for(cy),'xNorm':round(cx/w,7),'yNorm':round(cy/h,7)})

payload={'schemaVersion':3,'source':PDF_URL,'generatedAt':datetime.now(timezone.utc).isoformat(),'image':{'width':w,'height':h,'dpi':600},'floorBands':[{'floor':f,'from':lo,'to':hi} for f,lo,hi in bands],'palette':palette,'matchedLotLabels':candidates,'matchedCodeCount':len(matched_codes),'officialCodeCount':len(code_to_tenants),'ocrAudit':audit,'note':'Coordinates are accepted only when normalized OCR lot codes match current official Mid Valley tenant lots on the same floor. Corridor/left-right routing still requires walkable-path validation.'}
OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(payload,indent=2)+'\n',encoding='utf-8')
print(f'Official floor map {w}x{h} @600dpi; matched {len(candidates)} lot-label positions across {len(matched_codes)} of {len(code_to_tenants)} official lot codes; {len(audit)} lot-like OCR lines audited.')
