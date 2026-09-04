const url='https://www.thegardensmall.com.my/floor-map';
const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 MidValleyIndoorRoute/2.0','accept':'text/html'}});
if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
const html=await r.text();
console.log('GARDENS_HTML_LENGTH',html.length);
for(const needle of ['DOME Cafe','F-237B','Aurum Theatre','FF-201','Surau']){
  const i=html.toLowerCase().indexOf(needle.toLowerCase());
  console.log(`\n--- ${needle} @ ${i} ---`);
  if(i>=0)console.log(html.slice(Math.max(0,i-1400),Math.min(html.length,i+2200)));
}
