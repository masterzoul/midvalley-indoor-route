import fs from 'node:fs/promises';

const DIRECTORY='https://spsetia.com/retails/inc-klec/directory/';
const HOME='https://spsetia.com/retails/inc-klec/';
const OUT='data/inc.generated.json';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchText(url,attempt=1){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MidValleyIndoorRoute/3.0','accept':'text/html'}});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text()}catch(e){if(attempt>=3)throw e;await sleep(700*attempt);return fetchText(url,attempt+1)}}
function decode(s){return String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#8217;/g,"'").replace(/&#038;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/\s+/g,' ').trim()}
function slug(s){return decode(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'place'}
function firstTag(html,tag){const m=html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?decode(m[1]):''}
function floorFromUrl(url){const m=url.match(/\/level-([^/]+)\//i);if(!m)return'';const s=m[1].toLowerCase();if(s==='g')return'G';if(s.startsWith('1'))return'1';if(s.startsWith('2'))return'2';if(s.startsWith('3'))return'3';if(s.startsWith('4'))return'4';if(s.startsWith('5'))return'5';if(s.includes('ug'))return'UG';return s.toUpperCase()}
function extractLinks(html){const set=new Set();for(const m of html.matchAll(/href=["']([^"']*\/retails\/inc-klec\/level-[^"'#?]+\/)["']/gi)){try{const u=new URL(m[1],DIRECTORY).href;if(!/\/(directory|contact-us|getting-here|happenings|sweet-deals)\/?$/i.test(u))set.add(u)}catch{}}return[...set]}
const food=/\b(cafe|coffee|food|kitchen|restaurant|juice|bakery|bread|toast|salad|cuisine|oldtown|zus|starbucks|degayo|superluna|bungkus|bms|suria food court|krapow|george town|bar)\b/i;
const health=/\b(clinic|wellness|physio|dental|skin|watsons|pharmacy)\b/i;
function keywords(name){const a=[];if(food.test(name))a.push('food','makan','makanan','selera','jamuan','air','minuman','restaurant','restoran','cafe','food court');if(health.test(name))a.push('health','clinic','wellness','farmasi','pharmacy','ubat');if(/coffee|starbucks|zus|degayo|oldtown|cafe/i.test(name))a.push('coffee','kopi','latte');if(/suria food court/i.test(name))a.push('food court','medan selera');return[...new Set(a)]}
function parsePage(html,url){let name=firstTag(html,'h1')||firstTag(html,'h2');if(!name){const t=firstTag(html,'title');name=t.split(' - S P Setia')[0].trim()}if(!name)return null;const floor=floorFromUrl(url);const plain=decode(html);const pats=[/\b(?:G|UG|L1|L2|L3|L4|L5)-\d{1,3}[A-Z]?(?:\s*&\s*(?:[A-Z]+-)?\d{1,3}[A-Z]?)?/i,/\b\d-\d{2}[A-Z]?(?:\s*&\s*\d{2}[A-Z]?)?(?:\s*,\s*The Hub)?/i,/\bM\s*,\s*Common Area\b/i];let lot='';for(const p of pats){const m=plain.match(p);if(m){lot=m[0].trim();break}}return{id:`inc-${slug(name)}-${slug(lot||floor)}`,name,mall:'INC KL Eco City (formerly KL Eco City Mall)',floor,lot,kind:'tenant',keywords:keywords(name),officialUrl:url,dataConfidence:'official-INC-directory'}}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){console.error('INC fetch failed',items[i],e.message);out[i]=null}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

const [dir,home]=await Promise.all([fetchText(DIRECTORY),fetchText(HOME)]);const links=[...new Set([...extractLinks(dir),...extractLinks(home)])];console.log(`Found ${links.length} INC tenant links in official pages.`);
let tenants=[];if(links.length){tenants=(await mapLimit(links,10,async u=>parsePage(await fetchText(u),u))).filter(Boolean)}
// Always preserve official landmarks/currently verified facilities even when the directory is client-loaded.
const facilities=[
 {id:'inc-main-concourse-g',name:'Main Concourse - INC KL Eco City',mall:'INC KL Eco City (formerly KL Eco City Mall)',floor:'G',kind:'landmark',keywords:['main concourse','concourse','INC','KLEC'],officialUrl:'https://spsetia.com/retails/inc-klec/contact-us/',dataConfidence:'official-INC-page'},
 {id:'inc-surau-mz',name:'Surau / Prayer Room - INC KL Eco City',mall:'INC KL Eco City (formerly KL Eco City Mall)',floor:'MZ',area:'Mezzanine level below Ground; connected route toward LRT Abdullah Hukum',kind:'prayer',aliases:['KLEC surau','KL Eco City surau','INC surau','prayer room','musolla'],keywords:['surau','solat','sembahyang','prayer','musolla','KLEC','INC'],dataConfidence:'user-verified-location'}
];
const unique=new Map();for(const p of tenants)unique.set(p.id,p);for(const p of facilities)unique.set(p.id,p);const places=[...unique.values()].sort((a,b)=>(a.floor||'').localeCompare(b.floor||'')||a.name.localeCompare(b.name));
const payload={schemaVersion:1,sourceMode:'generated',updatedAt:new Date().toISOString(),mallScope:['INC KL Eco City'],source:DIRECTORY,tenantCount:tenants.length,places};await fs.mkdir('data',{recursive:true});await fs.writeFile(OUT,JSON.stringify(payload,null,2)+'\n');console.log(`Wrote ${places.length} INC locations (${tenants.length} directory tenants).`);
