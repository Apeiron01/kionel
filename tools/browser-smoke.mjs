import { writeFileSync } from 'node:fs';
// Start the dev server and a disposable headless Chrome on localhost:9223.
// See TESTING.md. This exercises the real app; it is not a camera field test.
const target = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent('about:blank'), {method:'PUT'})).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject) => { ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}); });
let id=0; const pending=new Map(); const errors=[];
ws.addEventListener('message', e => {
  const msg=JSON.parse(e.data);
  if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description??''));
  if(msg.id){const call=pending.get(msg.id);if(call){pending.delete(msg.id);msg.error?call.reject(msg.error):call.resolve(msg.result);}}
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description??'evaluation failed');
  return result.result.value;
};
await send('Runtime.enable');await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:'https://127.0.0.1:5173/transfer.html'});
for(let i=0;i<40;i++){
 await new Promise(r=>setTimeout(r,250));
 if(await evaluate("!!document.querySelector('#identity-trust') && !document.querySelector('#identity-trust').textContent.includes('denetleniyor')")) break;
}
await evaluate(`(() => {
 const input=document.querySelector('#file'); const dt=new DataTransfer();
 dt.items.add(new File([new Uint8Array(1000000)],'review.bin'));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await new Promise(r=>setTimeout(r,500));
// Lisanssız cihaz kendi dosyasını aktaramaz; demo örnek dosyayla devam eder.
const demoRefusal=await evaluate(`document.querySelector('#send-stats').textContent.includes('requires a valid licence')`);
await evaluate(`document.querySelector('#demo-file').click()`);
await new Promise(r=>setTimeout(r,500));
await evaluate(`(() => {document.querySelector('#tiles').value='9';document.querySelector('#tiles').dispatchEvent(new Event('change',{bubbles:true}));})()`);
const mobile=await evaluate(`({title:document.title,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,stats:document.querySelector('#send-stats').textContent,tiles:[...document.querySelector('#tiles').options].map(o=>o.textContent),fit:getComputedStyle(document.querySelector('#qr')).objectFit,identity:document.querySelector('#identity-trust').textContent})`);
const readPublicKey=`new Promise((resolve,reject)=>{const r=indexedDB.open('kionel-secure-identity',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('keys','readonly').objectStore('keys').get('device-ed25519-v1');q.onsuccess=()=>{db.close();if(!q.result)reject(new Error('missing persistent key'));else resolve({pub:[...q.result.pub].join(','),extractable:q.result.priv.extractable});};q.onerror=()=>reject(q.error);};})`;
const beforeReload=await evaluate(readPublicKey);
await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(r=>writeFileSync('artifacts/web-review-mobile.png',Buffer.from(r.data,'base64')));
await send('Page.reload');
await new Promise(r=>setTimeout(r,1000));
const afterReload=await evaluate(readPublicKey);
const persistentIdentity={samePublicKey:beforeReload.pub===afterReload.pub,privateKeyExtractable:afterReload.extractable};
await send('Emulation.setDeviceMetricsOverride',{width:1365,height:900,deviceScaleFactor:1,mobile:false});
const desktop=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`);
await send('Page.navigate',{url:'https://127.0.0.1:5173/products.html'});
await new Promise(r=>setTimeout(r,1000));
const products=await evaluate(`({title:document.title,correctedStatus:document.body.innerText.includes('Doğrulama ve tasarım ortağı hazırlığında'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60),width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))})`);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
const productsMobile=await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`);
const result={demoRefusal,mobile,desktop,products,productsMobile,persistentIdentity,errors,physicalCameraTest:false};
writeFileSync('artifacts/browser-review.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
ws.close();
if(errors.length || !demoRefusal || mobile.scrollWidth>mobile.width || desktop.scrollWidth>desktop.width || products.scrollWidth>products.width || productsMobile.scrollWidth>productsMobile.width || !products.correctedStatus || !mobile.stats.includes('Estimated time') || !persistentIdentity.samePublicKey || persistentIdentity.privateKeyExtractable || !mobile.identity.includes('Lab pilot policy met')) process.exitCode=1;
