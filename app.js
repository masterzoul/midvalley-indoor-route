const state={places:[],topology:null,from:null,to:null};
const $=id=>document.getElementById(id);
const els={fromInput:$('fromInput'),toInput:$('toInput'),fromResults:$('fromResults'),toResults:$('toResults'),swapBtn:$('swapBtn'),routeBtn:$('routeBtn'),routeCard:$('routeCard'),routeTitle:$('routeTitle'),routeSteps:$('routeSteps'),routeNote:$('routeNote'),confidenceBadge:$('confidenceBadge'),dataStatus:$('dataStatus'),dataUpdated:$('dataUpdated')};

const norm=s=>(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,' ').replace(/\s+/g,' ').trim();
const floorLabel=f=>({LG:'Lower Ground',P1:'P1',P2:'P2',G:'Ground Floor','1':'First Floor','2':'Second Floor','3':'Third Floor'}[String(f)]||`Aras ${f||'?'}`);
const placeMeta=p=>[floorLabel(p.floor),p.lot?`Lot ${p.lot}`:'',p.kind==='facility'?'Facility':''].filter(Boolean).join(' · ');

async function loadJson(primary,fallback){try{const r=await fetch(primary,{cache:'no-store'});if(!r.ok)throw new Error();return await r.json()}catch(e){const r=await fetch(fallback,{cache:'no-store'});if(!r.ok)throw new Error(`Gagal memuatkan ${primary}`);return await r.json()}}

async function boot(){
  try{
    const [pd,td]=await Promise.all([
      loadJson('data/places.generated.json','data/places.seed.json'),
      loadJson('data/topology.generated.json','data/route-topology.json')
    ]);
    state.places=(pd.places||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
    state.topology=td;
    els.dataStatus.textContent=`${state.places.length} lokasi tersedia`;
    els.dataUpdated.textContent=pd.updatedAt?`Dikemas kini ${new Date(pd.updatedAt).toLocaleString('ms-MY')}`:'Data asas';
  }catch(err){els.dataStatus.textContent='Data gagal dimuatkan';els.dataUpdated.textContent='Cuba refresh halaman';}
}

function searchPlaces(q){
  const tokens=norm(q).split(' ').filter(Boolean);if(!tokens.length)return [];
  return state.places.filter(p=>{
    const hay=norm([p.name,p.floor,p.lot,p.kind,p.mall].join(' '));
    return tokens.every(t=>hay.includes(t));
  }).sort((a,b)=>{
    const nq=norm(q),an=norm(a.name),bn=norm(b.name);
    const ae=an===nq?0:an.startsWith(nq)?1:2;const be=bn===nq?0:bn.startsWith(nq)?1:2;
    return ae-be||a.name.localeCompare(b.name);
  }).slice(0,12);
}

function wirePicker(input,results,key){
  const render=()=>{
    const items=searchPlaces(input.value);
    results.innerHTML='';
    if(!input.value.trim()||!items.length){results.hidden=true;return;}
    items.forEach(p=>{
      const b=document.createElement('button');b.type='button';b.className='result';
      b.innerHTML=`<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(placeMeta(p))}</span>`;
      b.onclick=()=>selectPlace(key,p,input,results);results.appendChild(b);
    });
    results.hidden=false;
  };
  input.addEventListener('input',()=>{state[key]=null;render()});
  input.addEventListener('focus',render);
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();const first=searchPlaces(input.value)[0];if(first)selectPlace(key,first,input,results);input.blur();
    }
  });
  document.addEventListener('click',e=>{if(e.target!==input&&!results.contains(e.target))results.hidden=true});
}

function selectPlace(key,p,input,results){state[key]=p;input.value=p.name;results.hidden=true;input.blur()}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function nodeMap(){return new Map((state.topology?.nodes||[]).map(n=>[n.id,n]))}
function edges(){return state.topology?.edges||[]}
function placeNodeId(p){return p?.routeNode||null}

function shortestPath(start,end){
  const nodes=nodeMap(),adj=new Map();
  for(const e of edges()){
    if(!adj.has(e.from))adj.set(e.from,[]);if(!adj.has(e.to))adj.set(e.to,[]);
    adj.get(e.from).push({to:e.to,w:e.weight||1,edge:e});adj.get(e.to).push({to:e.from,w:e.weight||1,edge:e});
  }
  const dist=new Map([[start,0]]),prev=new Map(),q=new Set(nodes.keys());
  while(q.size){let u=null,best=Infinity;for(const n of q){const d=dist.get(n)??Infinity;if(d<best){best=d;u=n}}if(u===null)break;q.delete(u);if(u===end)break;for(const x of adj.get(u)||[]){if(!q.has(x.to))continue;const alt=best+x.w;if(alt<(dist.get(x.to)??Infinity)){dist.set(x.to,alt);prev.set(x.to,{node:u,edge:x.edge})}}}
  if(!dist.has(end))return null;const out=[];let cur=end;while(cur!==start){const p=prev.get(cur);if(!p)return null;out.push({from:p.node,to:cur,edge:p.edge});cur=p.node}return out.reverse();
}

function graphRoute(a,b){
  const s=placeNodeId(a),t=placeNodeId(b);if(!s||!t)return null;const path=shortestPath(s,t);if(!path)return null;
  const nodes=nodeMap();const steps=[`Mula di ${a.name}${a.lot?` (Lot ${a.lot})`:''}.`];
  for(const seg of path){const from=nodes.get(seg.from),to=nodes.get(seg.to),e=seg.edge;let text=e.instruction||'';if(!text){if(from?.floor!==to?.floor)text=`Gunakan ${e.mode||'escalator/lif'} dari ${floorLabel(from?.floor)} ke ${floorLabel(to?.floor)}.`;else text=`Teruskan ke ${to?.name||'landmark seterusnya'}.`}steps.push(text)}
  steps.push(`Tiba di ${b.name}${b.lot?` (Lot ${b.lot})`:''}.`);return {verified:true,steps};
}

function fallbackRoute(a,b){
  const steps=[`Mula di ${a.name}${a.lot?` (Lot ${a.lot})`:''}, ${floorLabel(a.floor)}.`];
  if(String(a.floor)===String(b.floor)){
    steps.push(`Kekal di ${floorLabel(a.floor)} dan ikut koridor utama menuju ${b.name}.`);
  }else{
    steps.push('Berjalan ke Centre Court dan cari escalator atau lif utama.');
    steps.push(`${Number(String(a.floor).replace(/\D/g,''))>Number(String(b.floor).replace(/\D/g,''))?'Turun':'Naik'} ke ${floorLabel(b.floor)}.`);
    steps.push(`Dari Centre Court, teruskan melalui koridor utama menuju ${b.name}.`);
  }
  steps.push(`Tiba di ${b.name}${b.lot?` (Lot ${b.lot})`:''}.`);
  return {verified:false,steps};
}

function showRoute(){
  const a=state.from,b=state.to;if(!a||!b){alert('Pilih lokasi From dan To daripada senarai.');return}if(a.id===b.id){alert('From dan To ialah lokasi yang sama.');return}
  const route=graphRoute(a,b)||fallbackRoute(a,b);
  els.routeTitle.textContent=`${a.name} → ${b.name}`;els.routeSteps.innerHTML='';route.steps.forEach(s=>{const li=document.createElement('li');li.textContent=s;els.routeSteps.appendChild(li)});
  els.confidenceBadge.textContent=route.verified?'DISAHKAN':'BUTIRAN BELUM DISAHKAN';els.confidenceBadge.className=`badge ${route.verified?'verified':'partial'}`;
  els.routeNote.textContent=route.verified?'Arahan ini datang daripada topologi laluan yang telah disahkan.':'Lokasi kedai dan aras datang daripada data rasmi, tetapi urutan landmark/kiri/kanan untuk pasangan lokasi ini belum disahkan. App sengaja tidak mereka-reka arahan.';
  els.routeCard.hidden=false;els.routeCard.scrollIntoView({behavior:'smooth',block:'start'});
}

wirePicker(els.fromInput,els.fromResults,'from');wirePicker(els.toInput,els.toResults,'to');
els.swapBtn.onclick=()=>{const p=state.from;state.from=state.to;state.to=p;const v=els.fromInput.value;els.fromInput.value=els.toInput.value;els.toInput.value=v};
els.routeBtn.onclick=showRoute;
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
boot();
