import fs from 'node:fs/promises';

const URL='https://www.thegardensmall.com.my/floor-map';
const SERVICES='https://www.thegardensmall.com.my/services-and-amenities';
const OUT='data/gardens.generated.json';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchText(url,attempt=1){
  try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MidValleyIndoorRoute/2.0','accept':'text/html,application/xhtml+xml'}});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }catch(err){if(attempt>=4)throw err;await sleep(800*attempt);return fetchText(url,attempt+1)}
}
function jsString(s){try{return JSON.parse(`"${s}"`)}catch{return String(s||'').replace(/\\\//g,'/').replace(/\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\"/g,'"').replace(/\\n/g,' ')}}
function slug(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'place'}
function floorFromTitle(t){const x=String(t||'').toLowerCase();if(/\bp1\b/.test(x))return'P1';if(/\bp2\b/.test(x))return'P2';if(x.includes('lower ground'))return'LG';if(x.includes('ground'))return'G';if(x.includes('1st')||x.includes('first'))return'1';if(x.includes('2nd')||x.includes('second'))return'2';if(x.includes('3rd')||x.includes('third'))return'3';if(x.includes('4th')||x.includes('fourth'))return'4';if(x.includes('5th')||x.includes('fifth'))return'5';if(x.includes('6th')||x.includes('sixth'))return'6';return''}
function lotFromAbout(about){return String(about||'').replace(/,?\s*(?:lower ground floor|ground floor|first floor|1st floor|second floor|2nd floor|third floor|3rd floor|fourth floor|4th floor|fifth floor|5th floor|sixth floor|6th floor|level p1|p1|level p2|p2)\.?$/i,'').trim()}

const foodName=/\b(cafe|café|coffee|tea|restaurant|kitchen|bistro|bakery|bread|juice|burger|sushi|yakiniku|ramen|noodle|rice|chicken|thai|ippudo|maisen|putien|gong cha|baskin|chagee|nadeje|llaollao|tealive|din tai fung|boat noodle|canton-i|kgb|roast duck|kopitiam|yogurt|yoghurt|dessert|snack|tofu|fruit|scoop|shihlin|yuzu|wagyu|rakuzen|padi house|han room|absolute thai|alexis|dome|%arabica|eight ounce|nespresso|red kettle|venchi|lad[eä]rach|twg|boost|coliseum|yayoi|sushihan|sushi zanmai|fish bowl|kubis|kale|royce|barcook|breadstory|an viet|bananabro|bungkus|nyonya|purple cane|monster curry|chicken rice|yewyew|mogu|ko hyang|mr\. tuk tuk|penang flavours|genki|rich kopitiam|san francisco)\b/i;
const cinemaName=/\b(aurum theatre|cinema|redbox)\b/i;
const pharmacyName=/\b(pharmacy|watsons|health lane|apothecary)\b/i;
const fitnessName=/\b(fitness|gym|golf arena)\b/i;
const bankName=/\b(maybank|bank|money|merchantrade|jags money)\b/i;
function keywordPack(name,categoryId){
  const out=[];
  if(foodName.test(name)||String(categoryId)==='38')out.push('food','makan','makanan','selera','jamuan','air','minuman','drink','restaurant','restoran','cafe','kafe','food court','dining');
  if(cinemaName.test(name))out.push('cinema','pawagam','wayang','filem','movie','tonton','entertainment');
  if(pharmacyName.test(name))out.push('pharmacy','farmasi','ubat','personal care');
  if(fitnessName.test(name))out.push('fitness','gym','senaman','workout');
  if(bankName.test(name))out.push('bank','atm','duit','cash','money changer','tukar wang');
  return [...new Set(out)];
}

function parseLayers(html){
  const header=/\{"id":"([^"\\]+)","title":"((?:\\.|[^"\\])*)","show":(?:true|false),"map":"((?:\\.|[^"\\])*)","locations":\[/g;
  const hits=[...html.matchAll(header)];
  const places=[];
  for(let i=0;i<hits.length;i++){
    const h=hits[i],floorTitle=jsString(h[2]),floor=floorFromTitle(floorTitle),mapSvg=jsString(h[3]);
    const start=h.index+h[0].length,end=i+1<hits.length?hits[i+1].index:Math.min(html.length,start+160000);
    const seg=html.slice(start,end);
    const loc=/\{"id":"((?:\\.|[^"\\])*)","title":"((?:\\.|[^"\\])*)","about":"((?:\\.|[^"\\])*)"[\s\S]{0,800}?"category":"((?:\\.|[^"\\])*)"[\s\S]{0,800}?"x":"([0-9.]+)","y":"([0-9.]+)"[\s\S]{0,180}?\}/g;
    for(const m of seg.matchAll(loc)){
      const rawId=jsString(m[1]),name=jsString(m[2]).trim(),about=jsString(m[3]).trim(),categoryId=jsString(m[4]),x=Number(m[5]),y=Number(m[6]);
      if(!name||!Number.isFinite(x)||!Number.isFinite(y))continue;
      const lot=lotFromAbout(about);
      places.push({id:`tgm-${slug(rawId||name)}-${slug(lot||floor)}`,name,mall:'The Gardens Mall',floor,lot,kind:cinemaName.test(name)?'cinema':'tenant',categoryId,keywords:keywordPack(name,categoryId),x,y,mapSvg,officialUrl:URL,dataConfidence:'official-floor-map-coordinate'});
    }
  }
  const unique=new Map();for(const p of places)unique.set(`${p.floor}|${p.name}|${p.lot}`,p);return [...unique.values()];
}

function facilities(){return [
  {id:'tgm-surau-1-north',name:'Surau / Prayer Room - North',mall:'The Gardens Mall',floor:'1',area:'Level 1 North',kind:'prayer',aliases:['surau','prayer room','musolla'],keywords:['solat','sembahyang','prayer','surau'],officialUrl:SERVICES,dataConfidence:'official-service-plus-current-building-reference'},
  {id:'tgm-concierge-g',name:'Concierge Desk',mall:'The Gardens Mall',floor:'G',area:'Next to Watches of Switzerland, near escalator',kind:'information',keywords:['information','info','concierge','kaunter'],officialUrl:SERVICES,dataConfidence:'official-services-page'},
  {id:'tgm-baby-room',name:'Baby Room',mall:'The Gardens Mall',floor:'',kind:'baby',keywords:['baby','bayi','nursing','menyusu'],officialUrl:SERVICES,dataConfidence:'official-service-floor-not-specified'},
  {id:'tgm-disabled-washroom',name:'Disabled-friendly Washroom',mall:'The Gardens Mall',floor:'',kind:'toilet',keywords:['tandas','toilet','restroom','washroom','wc','oku'],officialUrl:SERVICES,dataConfidence:'official-service-floor-not-specified'},
  {id:'tgm-parking-p1',name:'Parking - P1',mall:'The Gardens Mall',floor:'P1',kind:'parking',keywords:['parking','parkir','kereta','car park'],officialUrl:URL,dataConfidence:'official-floor-map'},
  {id:'tgm-parking-p2',name:'Parking - P2',mall:'The Gardens Mall',floor:'P2',kind:'parking',keywords:['parking','parkir','kereta','car park'],officialUrl:URL,dataConfidence:'official-floor-map'},
  {id:'tgm-lrt-link-1',name:'Pedestrian Link to LRT Abdullah Hukum / KL Eco City',mall:'The Gardens Mall',floor:'1',area:'South side pedestrian bridge',kind:'transport',keywords:['lrt','abdullah hukum','kl eco city','inc mall','train','tren','stesen','station','bridge','link'],officialUrl:'https://www.thegardensmall.com.my/getting-here',dataConfidence:'official-getting-here'}
]}

const html=await fetchText(URL);const tenants=parseLayers(html);
if(tenants.length<150)throw new Error(`Safety stop: only ${tenants.length} Gardens map locations parsed.`);
const unique=new Map();for(const p of tenants)unique.set(p.id,p);for(const p of facilities())unique.set(p.id,p);
const places=[...unique.values()].sort((a,b)=>(a.floor||'').localeCompare(b.floor||'')||a.name.localeCompare(b.name));
const payload={schemaVersion:1,sourceMode:'generated',updatedAt:new Date().toISOString(),mallScope:['The Gardens Mall'],source:URL,tenantCount:tenants.length,places};
await fs.mkdir('data',{recursive:true});await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n','utf8');
console.log(`Wrote ${places.length} Gardens locations (${tenants.length} mapped store/anchor entries plus facilities) to ${OUT}.`);
