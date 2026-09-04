import fs from 'node:fs/promises';

const DIRECTORY_URL='https://www.midvalley.com.my/shop/directory/';
const FACILITIES_URL='https://www.midvalley.com.my/about/services-facilities/';
const PARKING_URL='https://www.midvalley.com.my/locate/parking/index.aspx';
const OUT='data/places.generated.json';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const decode=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
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
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MidValleyIndoorRoute/2.0','accept':'text/html,application/xhtml+xml'}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }catch(err){
    if(attempt>=4)throw err;
    await sleep(700*attempt);
    return fetchText(url,attempt+1);
  }
}
function slug(s){return decode(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'place'}
function inferFloor(lot){
  const x=String(lot||'').toUpperCase().replace(/\s+/g,'');
  if(x.startsWith('LG'))return 'LG';if(x.startsWith('P1')||x.startsWith('NP1')||x.startsWith('SP1'))return 'P1';if(x.startsWith('P2')||x.startsWith('NP2')||x.startsWith('SP2'))return 'P2';
  if(x.startsWith('G'))return 'G';if(x.startsWith('F'))return '1';if(x.startsWith('S'))return '2';if(x.startsWith('T'))return '3';return '';
}
function extractTenantLinks(html){const set=new Set();const re=/href=["']([^"']*\/tenant\/[^"']+\/SHOP)["']/gi;for(const m of html.matchAll(re)){try{set.add(new URL(m[1],DIRECTORY_URL).href)}catch{}}return [...set]}
function firstTag(html,tag){const m=html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?decode(m[1]):''}
function extractCategory(html){
  const plain=decode(html);const m=plain.match(/\bCATEGORY\b\s+(.+?)\s+\bOPERATIONS HOURS\b/i);if(!m)return '';
  return m[1].replace(/\s*>\s*/g,' > ').replace(/\s+/g,' ').trim().slice(0,240);
}
function keywordsFromCategory(category,name){
  const s=(category+' '+name).toLowerCase(),out=[];
  if(/food|beverage|restaurant|cafe|coffee|bakery|dessert|snack|bistro|fast food|food court/.test(s))out.push('food','makan','makanan','minuman','restaurant','restoran','cafe','food court');
  if(/entertainment|cinema/.test(s)||/golden screen|gsc/i.test(name))out.push('cinema','pawagam','wayang','filem','movie','tonton');
  if(/pharmacy|personal care/.test(s))out.push('pharmacy','farmasi','ubat');
  if(/fitness/.test(s))out.push('fitness','gym','senaman');
  if(/bank|financial/.test(s))out.push('bank','atm','duit');
  return [...new Set(out)];
}
function parseTenant(html,url){
  let name=firstTag(html,'h2');let lot=firstTag(html,'h6');lot=lot.replace(/^lot\s*[:#-]?\s*/i,'').trim();if(lot&&name.toLowerCase().endsWith(lot.toLowerCase()))name=name.slice(0,-lot.length).trim();if(!name||!lot)return null;
  const category=extractCategory(html);return {id:`mvm-${slug(name)}-${slug(lot)}`,name,mall:'Mid Valley Megamall',floor:inferFloor(lot),lot,kind:'tenant',category,keywords:keywordsFromCategory(category,name),officialUrl:url,dataConfidence:'official-name-lot-category'};
}
function facilities(){return [
  {id:'mvm-centre-court-g',name:'Centre Court',mall:'Mid Valley Megamall',floor:'G',kind:'landmark',keywords:['centre court','court'],routeNode:'centre-g',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-1',name:'Centre Court',mall:'Mid Valley Megamall',floor:'1',kind:'landmark',keywords:['centre court','court'],routeNode:'centre-1',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-2',name:'Centre Court',mall:'Mid Valley Megamall',floor:'2',kind:'landmark',keywords:['centre court','court'],routeNode:'centre-2',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-centre-court-3',name:'Centre Court',mall:'Mid Valley Megamall',floor:'3',kind:'landmark',keywords:['centre court','court'],routeNode:'centre-3',officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-north-court-g',name:'North Court',mall:'Mid Valley Megamall',floor:'G',kind:'landmark',keywords:['north court'],officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-south-court-g',name:'South Court',mall:'Mid Valley Megamall',floor:'G',kind:'landmark',keywords:['south court'],officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-east-entrance-g',name:'East Entrance',mall:'Mid Valley Megamall',floor:'G',kind:'entrance',keywords:['entrance','pintu masuk'],officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-west-entrance-g',name:'West Entrance',mall:'Mid Valley Megamall',floor:'G',kind:'entrance',keywords:['entrance','pintu masuk'],officialUrl:'https://www.midvalley.com.my/shop/mall-map/',dataConfidence:'official-floor-plan'},
  {id:'mvm-info-centre-1',name:'Information Counter - Centre Court',mall:'Mid Valley Megamall',floor:'1',kind:'information',keywords:['information','info','kaunter','concierge'],officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-info-north-g',name:'Information Counter - North Court',mall:'Mid Valley Megamall',floor:'G',kind:'information',keywords:['information','info','kaunter','concierge'],officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-info-south-g',name:'Information Counter - South Court',mall:'Mid Valley Megamall',floor:'G',kind:'information',keywords:['information','info','kaunter','concierge'],officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-surau-3',name:'Surau / Prayer Room - South Court Mezzanine',mall:'Mid Valley Megamall',floor:'3',area:'3rd Floor Mezzanine, South Court',kind:'prayer',aliases:['surau','prayer room','musolla'],keywords:['solat','sembahyang','prayer','surau'],officialUrl:FACILITIES_URL,dataConfidence:'official-floor-plus-verified-area'},
  {id:'mvm-nursing-2',name:'Nursing Room',mall:'Mid Valley Megamall',floor:'2',kind:'baby',keywords:['nursing','baby','bayi','menyusu'],officialUrl:FACILITIES_URL,dataConfidence:'official-facilities-page'},
  {id:'mvm-gsc-t001',name:'Golden Screen Cinemas (GSC)',mall:'Mid Valley Megamall',floor:'3',lot:'T-001',kind:'cinema',category:'LEISURE & ENTERTAINMENT > Entertainment',keywords:['gsc','cinema','pawagam','wayang','filem','movie','tonton'],officialUrl:'https://www.midvalley.com.my/tenant/GoldenScreenCinemasGSC/cb240802-dba3-4718-a0b2-a260b083f0cf/SHOP',dataConfidence:'official-tenant-page'},
  {id:'mvm-parking-p1-a',name:'Parking - P1 Zone A',mall:'Mid Valley Megamall',floor:'P1',area:'Zone A',kind:'parking',keywords:['parking','parkir','kereta','car park'],officialUrl:PARKING_URL,dataConfidence:'official-floor-plan-and-parking-page'},
  {id:'mvm-parking-p1-c',name:'Parking - P1 Zone C',mall:'Mid Valley Megamall',floor:'P1',area:'Zone C',kind:'parking',keywords:['parking','parkir','kereta','car park'],officialUrl:PARKING_URL,dataConfidence:'official-floor-plan-and-parking-page'},
  {id:'mvm-parking-p2-a',name:'Parking - P2 Zone A',mall:'Mid Valley Megamall',floor:'P2',area:'Zone A',kind:'parking',keywords:['parking','parkir','kereta','car park','ladies parking'],officialUrl:PARKING_URL,dataConfidence:'official-floor-plan-and-parking-page'},
  {id:'mvm-parking-p2-c',name:'Parking - P2 Zone C',mall:'Mid Valley Megamall',floor:'P2',area:'Zone C',kind:'parking',keywords:['parking','parkir','kereta','car park'],officialUrl:PARKING_URL,dataConfidence:'official-floor-plan-and-parking-page'},
  {id:'mvm-parking-upper-g',name:'Upper Parking - Zone G',mall:'Mid Valley Megamall',floor:'',area:'Upper Level Zone G',kind:'parking',keywords:['parking','parkir','kereta','upper parking','zone g'],officialUrl:PARKING_URL,dataConfidence:'official-parking-page'},
  {id:'mvm-parking-upper-h',name:'Upper Parking - Zone H',mall:'Mid Valley Megamall',floor:'',area:'Upper Level Zone H',kind:'parking',keywords:['parking','parkir','kereta','upper parking','zone h'],officialUrl:PARKING_URL,dataConfidence:'official-parking-page'}
]}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(err){console.error('Failed',items[i],err.message);out[i]=null}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

const directory=await fetchText(DIRECTORY_URL);const links=extractTenantLinks(directory);console.log(`Found ${links.length} Mid Valley tenant links.`);if(links.length<300)throw new Error(`Safety stop: only ${links.length} tenant links found.`);
const parsed=(await mapLimit(links,12,async url=>parseTenant(await fetchText(url),url))).filter(Boolean);console.log(`Parsed ${parsed.length} Mid Valley tenant pages.`);if(parsed.length<300)throw new Error(`Safety stop: only ${parsed.length} tenant pages parsed.`);
const unique=new Map();for(const p of parsed)unique.set(p.id,p);for(const p of facilities())unique.set(p.id,p);
const places=[...unique.values()].sort((a,b)=>(a.mall||'').localeCompare(b.mall||'')||(a.floor||'').localeCompare(b.floor||'')||a.name.localeCompare(b.name));
const tenantCount=parsed.length;const payload={schemaVersion:2,sourceMode:'generated',updatedAt:new Date().toISOString(),mallScope:['Mid Valley Megamall'],sources:[DIRECTORY_URL,FACILITIES_URL,PARKING_URL],tenantCount,places};
await fs.mkdir('data',{recursive:true});await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n','utf8');console.log(`Wrote ${places.length} Mid Valley places (${tenantCount} tenants plus facilities/parking) to ${OUT}.`);
