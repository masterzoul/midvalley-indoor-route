import fs from 'node:fs/promises';

const DIRECTORY_URL='https://www.midvalley.com.my/shop/directory/';
const FACILITIES_URL='https://www.midvalley.com.my/about/services-facilities/';
const OUT='data/places.generated.json';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const decode=s=>String(s||'')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
  .replace(/\s+/g,' ').trim();

async function fetchText(url,attempt=1){
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MidValleyIndoorRoute/1.0','accept':'text/html,application/xhtml+xml'}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }catch(err){
    if(attempt>=4)throw err;
    await sleep(700*attempt);
    return fetchText(url,attempt+1);
  }
}

function slug(s){return decode(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'place'}

function inferFloor(lot){
  const x=String(lot||'').toUpperCase().replace(/\s+/g,'');
  if(/^LG/.test(x))return 'LG';
  if(/^P1/.test(x))return 'P1';
  if(/^P2/.test(x))return 'P2';
  if(/^G[-\d]/.test(x)||/^G\b/.test(x))return 'G';
  if(/^F[-\d]/.test(x)||/^F\b/.test(x))return '1';
  if(/^S[-\d]/.test(x)||/^S\b/.test(x))return '2';
  if(/^T[-\d]/.test(x)||/^T\b/.test(x))return '3';
  return '';
}

function extractTenantLinks(html){
  const set=new Set();
  const re=/href=["']([^"']*\/tenant\/[^"']+\/SHOP)["']/gi;
  for(const m of html.matchAll(re)){
    try{set.add(new URL(m[1],DIRECTORY_URL).href)}catch{}
  }
  return [...set];
}

function firstTag(html,tag){
  const m=html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));
  return m?decode(m[1]):'';
}

function parseTenant(html,url){
  let name=firstTag(html,'h2');
  let lot=firstTag(html,'h6');
  lot=lot.replace(/^lot\s*[:#-]?\s*/i,'').trim();
  if(lot&&name.toLowerCase().endsWith(lot.toLowerCase()))name=name.slice(0,-lot.length).trim();
  if(!name||!lot)return null;
  const floor=inferFloor(lot);
  return {
    id:`mvm-${slug(name)}-${slug(lot)}`,
    name,
    mall:'Mid Valley Megamall',
    floor,
    lot,
    kind:'tenant',
    officialUrl:url,
    dataConfidence:'official-name-and-lot'
  };
}

function facilities(){return [
  {id:'mvm-centre-court-g',name:'Centre Court',mall:'Mid Valley Megamall',floor:'G',lot:'',kind:'facility',routeNode:'centre-g',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-1',name:'Centre Court',mall:'Mid Valley Megamall',floor:'1',lot:'',kind:'facility',routeNode:'centre-1',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-2',name:'Centre Court',mall:'Mid Valley Megamall',floor:'2',lot:'',kind:'facility',routeNode:'centre-2',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-3',name:'Centre Court',mall:'Mid Valley Megamall',floor:'3',lot:'',kind:'facility',routeNode:'centre-3',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-north-court-g',name:'North Court',mall:'Mid Valley Megamall',floor:'G',lot:'',kind:'landmark',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-south-court-g',name:'South Court',mall:'Mid Valley Megamall',floor:'G',lot:'',kind:'landmark',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-info-centre-1',name:'Information Counter - Centre Court',mall:'Mid Valley Megamall',floor:'1',lot:'',kind:'facility',officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-info-north-g',name:'Information Counter - North Court',mall:'Mid Valley Megamall',floor:'G',lot:'',kind:'facility',officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-info-south-g',name:'Information Counter - South Court',mall:'Mid Valley Megamall',floor:'G',lot:'',kind:'facility',officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-surau-3',name:'Surau / Prayer Room',mall:'Mid Valley Megamall',floor:'3',lot:'',kind:'facility',officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-nursing-2',name:'Nursing Room',mall:'Mid Valley Megamall',floor:'2',lot:'',kind:'facility',officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'}
]}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(err){console.error('Failed',items[i],err.message);out[i]=null}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;
}

const directory=await fetchText(DIRECTORY_URL);
const links=extractTenantLinks(directory);
console.log(`Found ${links.length} tenant links.`);
if(links.length<300)throw new Error(`Safety stop: only ${links.length} tenant links found.`);

const parsed=(await mapLimit(links,12,async url=>parseTenant(await fetchText(url),url))).filter(Boolean);
console.log(`Parsed ${parsed.length} tenant pages.`);
if(parsed.length<300)throw new Error(`Safety stop: only ${parsed.length} tenant pages parsed.`);

const unique=new Map();for(const p of parsed)unique.set(p.id,p);
const places=[...unique.values(),...facilities()].sort((a,b)=>(a.floor||'').localeCompare(b.floor||'')||a.name.localeCompare(b.name));
const payload={schemaVersion:1,sourceMode:'generated',updatedAt:new Date().toISOString(),mallScope:['Mid Valley Megamall'],source:DIRECTORY_URL,tenantCount:unique.size,places};
await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n','utf8');
console.log(`Wrote ${places.length} places (${unique.size} tenants + ${places.length-unique.size} facilities/landmarks) to ${OUT}.`);
