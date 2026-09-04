const state={places:[],topology:null,from:null,to:null};
const $=id=>document.getElementById(id);
const els={fromInput:$('fromInput'),toInput:$('toInput'),fromResults:$('fromResults'),toResults:$('toResults'),swapBtn:$('swapBtn'),routeBtn:$('routeBtn'),routeCard:$('routeCard'),routeTitle:$('routeTitle'),routeSteps:$('routeSteps'),routeNote:$('routeNote'),confidenceBadge:$('confidenceBadge'),dataStatus:$('dataStatus'),dataUpdated:$('dataUpdated')};

const norm=s=>(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,' ').replace(/\s+/g,' ').trim();
const floorLabel=f=>({MZ:'Mezzanine',UG:'Upper Ground',LG:'Lower Ground',P1:'Parking Level P1',P2:'Parking Level P2',G:'Ground Floor','1':'First Floor','2':'Second Floor','3':'Third Floor','4':'Fourth Floor','5':'Fifth Floor','6':'Sixth Floor'}[String(f)]||`Aras ${f||'?'}`);
const placeMeta=p=>[p.mall,floorLabel(p.floor),p.lot?`Lot ${p.lot}`:'',p.area||'',p.kind==='parking'?'Parking':''].filter(Boolean).join(' · ');
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const semanticGroups=[
  {id:'prayer',terms:['surau','solat','sembahyang','sembahyang','prayer','pray','musolla','musolla','musholla'],match:['surau','prayer room','prayer','musolla']},
  {id:'cinema',terms:['pawagam','wayang','filem','tonton','movie','movies','cinema','bioskop'],match:['cinema','entertainment','golden screen cinemas','gsc','aurum theatre','theatre']},
  {id:'food',terms:['makan','makanan','selera','jamuan','air','minuman','drink','drinks','food','restaurant','restoran','cafe','kafe','foodcourt','food court','dining','makan tengah hari','makan malam'],match:['food','beverage','restaurant','cafe','coffee','bakery','dessert','snack','food court','bistro','fast food','specialty beverage','f&b','dining']},
  {id:'toilet',terms:['tandas','toilet','restroom','washroom','wc','bilik air'],match:['toilet','restroom','washroom','wc']},
  {id:'parking',terms:['parking','parkir','carpark','car park','kereta','parking kereta'],match:['parking','car park','carpark','valet']},
  {id:'lift',terms:['lift','elevator'],match:['lift','elevator']},
  {id:'escalator',terms:['escalator','eskalator','tangga bergerak'],match:['escalator','eskalator']},
  {id:'baby',terms:['bayi','baby','nursing','breastfeed','breastfeeding','menyusu','nursery'],match:['nursing room','baby room','baby','nursing']},
  {id:'train',terms:['lrt','ktm','train','tren','stesen','station','abdullah hukum','komuter'],match:['lrt','ktm','train','station','komuter','abdullah hukum']},
  {id:'money',terms:['atm','bank','duit','cash','money changer','tukar wang','pengurup wang'],match:['atm','bank','money changer','financial']},
  {id:'pharmacy',terms:['farmasi','pharmacy','ubat','drugstore'],match:['pharmacy','personal care','guardian','watsons']},
  {id:'info',terms:['info','information','kaunter','concierge','customer service'],match:['information counter','concierge','customer service']},
  {id:'coffee',terms:['kopi','coffee','latte','espresso'],match:['coffee','cafe','specialty beverage']},
  {id:'fitness',terms:['gym','fitness','senaman','workout'],match:['fitness','gym']},
  {id:'bowling',terms:['bowling','bowl'],match:['bowling','bowl']}
];

function semanticFor(token){
  const t=norm(token);
  return semanticGroups.find(g=>g.terms.some(x=>norm(x)===t))||null;
}
function searchable(p){return norm([p.name,p.mall,p.floor,p.lot,p.kind,p.area,p.category,p.categories,p.keywords,p.aliases,p.description].flat().filter(Boolean).join(' '))}
function tokenMatches(p,token){
  const hay=searchable(p),t=norm(token),g=semanticFor(t);
  if(g)return g.match.some(m=>hay.includes(norm(m)));
  if(hay.includes(t))return true;
  if(t.length>=3){
    const words=hay.split(' ');
    return words.some(w=>w.startsWith(t)||t.startsWith(w)&&w.length>=4);
  }
  return false;
}
function scorePlace(p,q,tokens){
  const nq=norm(q),name=norm(p.name),hay=searchable(p);let score=0;
  if(name===nq)score+=1200;else if(name.startsWith(nq))score+=900;else if(name.includes(nq))score+=700;
  for(const token of tokens){
    const g=semanticFor(token);
    if(g){
      if(g.match.some(m=>name.includes(norm(m))))score+=420;
      if(g.match.some(m=>hay.includes(norm(m))))score+=260;
      if((p.kind||'').toLowerCase()===g.id)score+=180;
    }else{
      if(name===token)score+=300;else if(name.startsWith(token))score+=220;else if(name.includes(token))score+=160;else if(hay.includes(token))score+=90;
    }
  }
  if(p.dataConfidence?.startsWith('official'))score+=8;
  return score;
}

async function loadJson(primary,fallback){try{const r=await fetch(primary,{cache:'no-store'});if(!r.ok)throw new Error();return await r.json()}catch(e){const r=await fetch(fallback,{cache:'no-store'});if(!r.ok)throw new Error(`Gagal memuatkan ${primary}`);return await r.json()}}
async function boot(){
  try{
    const [pd,td]=await Promise.all([loadJson('data/places.generated.json','data/places.seed.json'),loadJson('data/topology.generated.json','data/route-topology.json')]);
    state.places=(pd.places||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));state.topology=td;
    els.dataStatus.textContent=`${state.places.length} lokasi tersedia`;
    els.dataUpdated.textContent=pd.updatedAt?`Dikemas kini ${new Date(pd.updatedAt).toLocaleString('ms-MY')}`:'Data asas';
  }catch(err){els.dataStatus.textContent='Data gagal dimuatkan';els.dataUpdated.textContent='Cuba refresh halaman';}
}

function searchPlaces(q){
  const nq=norm(q);if(!nq)return [];
  const tokens=nq.split(' ').filter(Boolean);
  return state.places
    .filter(p=>tokens.every(t=>tokenMatches(p,t)))
    .map(p=>({p,score:scorePlace(p,q,tokens)}))
    .sort((a,b)=>b.score-a.score||a.p.name.localeCompare(b.p.name))
    .slice(0,40)
    .map(x=>x.p);
}

function wirePicker(input,results,key){
  const render=()=>{
    const items=searchPlaces(input.value);results.innerHTML='';
    if(!input.value.trim()||!items.length){results.hidden=true;return;}
    items.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='result';b.innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(placeMeta(p))}</span>`;b.onclick=()=>selectPlace(key,p,input,results);results.appendChild(b)});
    results.hidden=false;
  };
  input.addEventListener('input',()=>{state[key]=null;render()});input.addEventListener('focus',render);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const first=searchPlaces(input.value)[0];if(first)selectPlace(key,first,input,results);input.blur()}});
  document.addEventListener('click',e=>{if(e.target!==input&&!results.contains(e.target))results.hidden=true});
}
function selectPlace(key,p,input,results){state[key]=p;input.value=p.name;results.hidden=true;input.blur()}

function nodeMap(){return new Map((state.topology?.nodes||[]).map(n=>[n.id,n]))}
function edges(){return state.topology?.edges||[]}
function placeNodeId(p){return p?.routeNode||null}
function shortestPath(start,end){
  const nodes=nodeMap(),adj=new Map();for(const e of edges()){if(!adj.has(e.from))adj.set(e.from,[]);if(!adj.has(e.to))adj.set(e.to,[]);adj.get(e.from).push({to:e.to,w:e.weight||1,edge:e});adj.get(e.to).push({to:e.from,w:e.weight||1,edge:e})}
  const dist=new Map([[start,0]]),prev=new Map(),q=new Set(nodes.keys());while(q.size){let u=null,best=Infinity;for(const n of q){const d=dist.get(n)??Infinity;if(d<best){best=d;u=n}}if(u===null)break;q.delete(u);if(u===end)break;for(const x of adj.get(u)||[]){if(!q.has(x.to))continue;const alt=best+x.w;if(alt<(dist.get(x.to)??Infinity)){dist.set(x.to,alt);prev.set(x.to,{node:u,edge:x.edge})}}}
  if(!dist.has(end))return null;const out=[];let cur=end;while(cur!==start){const p=prev.get(cur);if(!p)return null;out.push({from:p.node,to:cur,edge:p.edge});cur=p.node}return out.reverse();
}
function formatDetailedEdge(e,from,to){
  if(e.detail){
    const parts=[];
    if(e.detail.move)parts.push(e.detail.move);
    if(e.detail.left?.length)parts.push(`Kiri: ${e.detail.left.join(', ')}.`);
    if(e.detail.right?.length)parts.push(`Kanan: ${e.detail.right.join(', ')}.`);
    if(e.detail.ahead?.length)parts.push(`Di hadapan: ${e.detail.ahead.join(', ')}.`);
    if(e.detail.facilities?.length)parts.push(`Kemudahan sepanjang laluan: ${e.detail.facilities.join(', ')}.`);
    if(e.detail.turn)parts.push(e.detail.turn);
    return parts.join(' ');
  }
  if(e.instruction)return e.instruction;
  if(from?.floor!==to?.floor)return `Gunakan ${e.mode||'laluan menegak'} dari ${floorLabel(from?.floor)} ke ${floorLabel(to?.floor)}.`;
  return `Teruskan ke ${to?.name||'landmark seterusnya'}.`;
}
function graphRoute(a,b){
  const s=placeNodeId(a),t=placeNodeId(b);if(!s||!t)return null;const path=shortestPath(s,t);if(!path)return null;
  const nodes=nodeMap();const steps=[`Mula di ${a.name}${a.lot?` (Lot ${a.lot})`:''}, ${floorLabel(a.floor)}${a.area?` — ${a.area}`:''}.`];
  for(const seg of path){const from=nodes.get(seg.from),to=nodes.get(seg.to);steps.push(formatDetailedEdge(seg.edge,from,to))}
  steps.push(`Tiba di ${b.name}${b.lot?` (Lot ${b.lot})`:''}, ${floorLabel(b.floor)}${b.area?` — ${b.area}`:''}.`);return {verified:true,steps};
}
function fallbackRoute(a,b){
  return {verified:false,steps:[`Mula di ${a.name}${a.lot?` (Lot ${a.lot})`:''}, ${floorLabel(a.floor)}.`,`Laluan terperinci kiri/kanan untuk ${a.name} → ${b.name} belum mempunyai topologi yang disahkan. App tidak akan lagi menyuruh anda “cari Centre Court” atau mereka-reka arah.`,`Destinasi: ${b.name}${b.lot?` (Lot ${b.lot})`:''}, ${floorLabel(b.floor)}.`]};
}
function showRoute(){
  const a=state.from,b=state.to;if(!a||!b){alert('Pilih lokasi From dan To daripada senarai.');return}if(a.id===b.id){alert('From dan To ialah lokasi yang sama.');return}
  const route=graphRoute(a,b)||fallbackRoute(a,b);els.routeTitle.textContent=`${a.name} → ${b.name}`;els.routeSteps.innerHTML='';route.steps.forEach(s=>{const li=document.createElement('li');li.textContent=s;els.routeSteps.appendChild(li)});
  els.confidenceBadge.textContent=route.verified?'LALUAN TERPERINCI DISAHKAN':'LALUAN TERPERINCI BELUM SIAP';els.confidenceBadge.className=`badge ${route.verified?'verified':'partial'}`;
  els.routeNote.textContent=route.verified?'Arahan menyatakan belokan, landmark kiri/kanan dan kemudahan berdasarkan topologi laluan yang disahkan.':'Tiada arahan generik digunakan. Laluan hanya akan dipaparkan secara penuh apabila kedudukan koridor, kedai, lif, escalator dan kemudahan telah dipadankan dengan sumber pelan lantai.';
  els.routeCard.hidden=false;els.routeCard.scrollIntoView({behavior:'smooth',block:'start'});
}

wirePicker(els.fromInput,els.fromResults,'from');wirePicker(els.toInput,els.toResults,'to');
els.swapBtn.onclick=()=>{const p=state.from;state.from=state.to;state.to=p;const v=els.fromInput.value;els.fromInput.value=els.toInput.value;els.toInput.value=v};els.routeBtn.onclick=showRoute;
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));boot();
