import './teaching.js';
const $ = id => document.getElementById(id);
const source = $('source'), result = $('result'), spectrum = $('spectrum');
const srcCtx = source.getContext('2d', {willReadFrequently:true}), resCtx = result.getContext('2d');
const specCtx = spectrum.getContext('2d');
const maskCanvas = document.createElement('canvas'), maskCtx = maskCanvas.getContext('2d', {willReadFrequently:true});
let n = 512, tool = 'brush', view = 'original', history = [], drawing = null, baseSpectrum = null;
let originalImage = null, originalName = '', preset = 'none', forwardId = 0, inverseId = 0, seq = 0;
let pendingInverse = false, showAfterForward = false, busy = false, ready = false, inverseTimer, toastTimer;
let lastLoad = 0, revision = 0, resultRevision = -1, exportPending = false;
const worker = new Worker(new URL('./worker.js', import.meta.url), {type:'module'});
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000); }
function status(title, detail, loading=false) {
  $('status').textContent = title; $('status-detail').textContent = detail;
  $('status-dot').classList.toggle('busy', loading); busy = loading;
}
function setView(next) {
  view = next;
  source.hidden = next !== 'original'; result.hidden = next !== 'result';
  $('tab-original').classList.toggle('selected',next === 'original'); $('tab-original').setAttribute('aria-pressed',next === 'original');
  $('tab-result').classList.toggle('selected',next === 'result'); $('tab-result').setAttribute('aria-pressed',next === 'result');
  $('image-tag').textContent = next === 'original' ? 'ORIGINALE' : 'RICOSTRUZIONE iFFT';
}
function snapshot() {
  history.push({mask:maskCtx.getImageData(0,0,n,n), source:srcCtx.getImageData(0,0,n,n), preset});
  if (history.length > 12) history.shift(); $('undo').disabled = false;
}
function updatePresetUI() {
  document.querySelectorAll('[data-preset]').forEach(b => {b.classList.toggle('active',b.dataset.preset === preset); b.setAttribute('aria-pressed',b.dataset.preset === preset);});
  $('cutoff-row').hidden = preset === 'none' || preset === 'custom';
}
function resetMask() { maskCtx.fillStyle = '#fff'; maskCtx.fillRect(0,0,n,n); preset = 'none'; updatePresetUI(); }
function refreshSpectrum() {
  if (!baseSpectrum) return;
  const pixels = new Uint8ClampedArray(baseSpectrum), mask = maskCtx.getImageData(0,0,n,n).data;
  for (let p = 0; p < n*n; p++) { const q=p*4, f=mask[q]/255; for(let c=0;c<3;c++) pixels[q+c] *= f; }
  specCtx.putImageData(new ImageData(pixels,n,n),0,0);
}
function forward(show=false) {
  if (!originalImage) return;
  ready = false; revision++; forwardId = ++seq; inverseId = 0; resultRevision = -1; clearTimeout(inverseTimer);
  showAfterForward = show; pendingInverse = show || $('auto').checked;
  status('Analisi delle frequenze…','Calcolo FFT dei tre canali colore.',true);
  const pixels = srcCtx.getImageData(0,0,n,n).data;
  window.dispatchEvent(new CustomEvent('fourier:source', {detail:{pixels:pixels.slice(),size:n,name:originalName}}));
  worker.postMessage({type:'forward', id:forwardId, size:n, pixels},[pixels.buffer]);
}
function inverse(show=true) {
  clearTimeout(inverseTimer);
  if (!ready) { pendingInverse = true; showAfterForward ||= show; return; }
  inverseId = ++seq; const thisRevision = revision;
  const pixels = maskCtx.getImageData(0,0,n,n).data, mask = new Uint8Array(n*n);
  for(let p=0;p<n*n;p++) mask[p]=pixels[p*4];
  worker.postMessage({type:'inverse',id:inverseId,mask},[mask.buffer]);
  worker.currentRevision = thisRevision; worker.showResult = show;
  status('Ricostruzione in corso…','Trasformata inversa iFFT con la maschera attuale.',true);
}
function maskChanged(show=true) {
  revision++; refreshSpectrum();
  $('spectrum-hint').hidden = preset !== 'none';
  status('Maschera aggiornata', $('auto').checked ? 'Aggiornamento della ricostruzione…' : 'Premi Ricostruisci immagine per applicare le modifiche.');
  if ($('auto').checked) {clearTimeout(inverseTimer); inverseTimer=setTimeout(()=>inverse(show),90);}
}
worker.onmessage = ({data}) => {
  if (data.type === 'error') {if(data.id!==forwardId && data.id!==inverseId)return; status('Elaborazione non riuscita',data.message);toast(data.message);exportPending=false;return;}
  if (data.type === 'forward' && data.id === forwardId) {
    ready = true; baseSpectrum = data.spectrum; refreshSpectrum();
    status('Spettro pronto','Scegli un filtro o disegna direttamente sullo spettro.');
    if(pendingInverse) {const show=showAfterForward;pendingInverse=false;showAfterForward=false;inverse(show);}
  }
  if (data.type === 'inverse' && data.id === inverseId) {
    resCtx.putImageData(new ImageData(data.output,n,n),0,0);
    resultRevision = worker.currentRevision;
    if(worker.showResult) setView('result');
    const labels = {none:'Tutte le frequenze',low:'Filtro passa-basso',high:'Filtro passa-alto',band:'Filtro passa-banda',custom:'Maschera personalizzata'};
    status('Ricostruzione aggiornata',`${labels[preset]} · ${n} × ${n} px · elaborazione locale`);
    if(exportPending){if(resultRevision===revision){exportPending=false;download();}else inverse(true);}
  }
};
worker.onerror = () => { status('Impossibile avviare il laboratorio','Ricarica la pagina con un browser aggiornato.'); toast('Il motore di elaborazione non è disponibile.'); };
function resize() {
  for (const c of [source,result,spectrum,maskCanvas]) c.width=c.height=n;
  baseSpectrum=null; resetMask(); history=[]; $('undo').disabled=true;
  $('dimensions').textContent=`${n} × ${n} px`;
}
function drawOriginal() {
  srcCtx.fillStyle='#0c1422';srcCtx.fillRect(0,0,n,n);
  const w=originalImage.naturalWidth||originalImage.width, h=originalImage.naturalHeight||originalImage.height;
  const scale=Math.min(n/w,n/h), dw=w*scale, dh=h*scale;
  srcCtx.drawImage(originalImage,(n-dw)/2,(n-dh)/2,dw,dh);
  resCtx.drawImage(source,0,0);setView('original');
}
function loadImage(image,name) {
  originalImage=image;originalName=name;resize();drawOriginal();$('filename').textContent=name;
  $('spectrum-hint').hidden=false;forward(false);
}
async function loadFile(file) {
  if(!file)return;
  if(!file.type.startsWith('image/')){toast('Scegli un file immagine, per esempio JPG, PNG o WebP.');return;}
  if(file.size>30*1024*1024){toast('L’immagine è troppo grande. Scegli un file sotto i 30 MB.');return;}
  const load=++lastLoad,url=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{URL.revokeObjectURL(url);if(load!==lastLoad)return;loadImage(im,file.name);$('examples').selectedIndex=-1;toast('Immagine caricata. Le proporzioni sono mantenute sulla tela quadrata.');};
  im.onerror=()=>{URL.revokeObjectURL(url);toast('Questo formato non è leggibile. Prova con JPG, PNG o WebP.');};im.src=url;
}
function generatedExample(type) {
  const c=document.createElement('canvas');c.width=c.height=1024;const x=c.getContext('2d');
  x.fillStyle='#14221e';x.fillRect(0,0,1024,1024);
  if(type==='didactic'){
    x.fillStyle='#323232';x.fillRect(0,0,512,1024);x.fillStyle='#c8c8c8';x.fillRect(512,0,512,1024);
    x.fillStyle='#fff';x.fillRect(256,256,4,4);
    for(let j=700;j<950;j+=32){x.fillStyle='#646464';x.fillRect(80,j,350,8);}
  } else if(type==='grid'){
    for(let y=0;y<1024;y+=64)for(let k=0;k<1024;k+=64){x.fillStyle=((k+y)/64)%2?'#ccdfb5':'#25473c';x.fillRect(k,y,64,64);}
    x.fillStyle='#efb78b';x.beginPath();x.arc(512,512,220,0,2*Math.PI);x.fill();x.fillStyle='#183d34';x.fillRect(400,400,224,224);
  } else {
    const d=x.createImageData(1024,1024);
    for(let y=0;y<1024;y++)for(let k=0;k<1024;k++){
      const p=(y*1024+k)*4,v=(Math.sin(k*.08+Math.sin(y*.008)*6)+1)/2;
      d.data[p]=35+v*170;d.data[p+1]=65+v*150;d.data[p+2]=59+v*90;d.data[p+3]=255;
    } x.putImageData(d,0,0);x.fillStyle='#eadcb4';x.beginPath();x.arc(512,512,230,0,2*Math.PI);x.fill();
    x.strokeStyle='#234e42';x.lineWidth=7;for(let k=330;k<710;k+=20){x.beginPath();x.moveTo(k,350);x.lineTo(k,674);x.stroke();}
  }return c;
}
function chooseExample(type) {
  const load=++lastLoad;
  if(type==='architecture') {
    const im=new Image(); im.onload=()=>{if(load===lastLoad)loadImage(im,'architecture.jpg');};
    im.onerror=()=>{if(load===lastLoad){loadImage(generatedExample('waves'),'onde-e-geometrie.png');toast('Foto non disponibile: caricato un esempio geometrico.');}};im.src='./assets/architecture.jpg';
  } else loadImage(generatedExample(type),type==='grid'?'reticolo.png':type==='didactic'?'gradino-e-impulso.png':'onde-e-geometrie.png');
}
function applyPreset(type,record=true) {
  if(!originalImage)return;
  if(record)snapshot();preset=type;updatePresetUI();
  const radius=Number($('cutoff').value)/100*n/2, d=maskCtx.createImageData(n,n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const r=Math.hypot(x-n/2,y-n/2);let v=1;
    if(type==='low')v=Math.exp(-.5*(r/radius)**2);
    if(type==='high')v=1-Math.exp(-.5*(r/radius)**2);
    if(type==='band')v=Math.exp(-.5*(r/(radius*1.8))**2)*(1-Math.exp(-.5*(r/(radius*.6))**2));
    const p=(y*n+x)*4;d.data[p]=d.data[p+1]=d.data[p+2]=v*255;d.data[p+3]=255;
  }maskCtx.putImageData(d,0,0);maskChanged(true);
}
function selectTool(next) {
  tool=next;const labels={brush:'Pennello',circle:'Cerchio',line:'Linea',rectangle:'Rettangolo'};$('tool-name').textContent=labels[tool];
  document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('selected',b.dataset.tool===tool);b.setAttribute('aria-pressed',b.dataset.tool===tool);});$('arc-options').hidden=tool!=='circle';
}
function changeTarget() {
  const isSource=$('target').value==='source';$('mask-options').hidden=isSource;$('color-options').hidden=!isSource;$('fill').disabled=isSource;
  if(isSource)setView('original');
}
function point(event,canvas) {const b=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(n,(event.clientX-b.left)*n/b.width)),y:Math.max(0,Math.min(n,(event.clientY-b.top)*n/b.height))};}
function shape(ctx, start,end,points,mirror=false) {
  const t=p=>mirror?{x:(n-p.x)%n,y:(n-p.y)%n}:p;
  const a=t(start),b=t(end);ctx.lineWidth=Number($('size').value)*n/512;ctx.lineCap='round';ctx.lineJoin='round';
  if(tool==='rectangle') {ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);return;}
  ctx.beginPath();
  if(tool==='circle') {
    const from=Number($('arc-start').value)*Math.PI/180+(mirror?Math.PI:0),to=Number($('arc-end').value)*Math.PI/180+(mirror?Math.PI:0),radius=Math.hypot(b.x-a.x,b.y-a.y);
    if(Math.abs(to-from)>=Math.PI*2-0.001){ctx.arc(a.x,a.y,radius,0,Math.PI*2);ctx.fill();}
    else {ctx.moveTo(a.x,a.y);ctx.arc(a.x,a.y,radius,from,to);ctx.closePath();ctx.fill();}return;
  }
  if(tool==='brush'){
    ctx.moveTo(a.x,a.y);for(const p of points){const q=t(p);ctx.lineTo(q.x,q.y);}ctx.lineTo(b.x+.001,b.y+.001);
  }else{ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}ctx.stroke();
}
function paint(event) {
  if(!drawing)return;const ctx=drawing.target==='source'?srcCtx:maskCtx;
  const p=point(event,drawing.canvas);drawing.end=p;if(tool==='brush')drawing.points.push(p);
  ctx.putImageData(drawing.before,0,0);ctx.fillStyle=ctx.strokeStyle=drawing.target==='source'?$('color').value:($('mode').value==='remove'?'#000':'#fff');
  shape(ctx,drawing.start,p,drawing.points);
  if(drawing.target==='spectrum'&&$('symmetry').checked)shape(ctx,drawing.start,p,drawing.points,true);
  if(drawing.target==='spectrum')refreshSpectrum();
}
for(const [canvas,target] of [[source,'source'],[spectrum,'spectrum']]) {
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||!originalImage||!ready)return;
    e.preventDefault();$('target').value=target;changeTarget();snapshot();canvas.setPointerCapture(e.pointerId);
    const ctx=target==='source'?srcCtx:maskCtx,p=point(e,canvas);
    drawing={canvas,target,start:p,end:p,points:[p],before:ctx.getImageData(0,0,n,n),pointer:e.pointerId};paint(e);
  });
  canvas.addEventListener('pointermove',e=>{if(drawing&&drawing.canvas===canvas)paint(e);});
  canvas.addEventListener('pointerup',e=>{
    if(!drawing||drawing.canvas!==canvas)return;paint(e);const target=drawing.target;drawing=null;canvas.releasePointerCapture(e.pointerId);
    if(target==='source')forward($('auto').checked);else{preset='custom';updatePresetUI();maskChanged(true);}
  });
  canvas.addEventListener('pointercancel',()=>{
    if(!drawing)return;const target=drawing.target;drawing=null;if(target==='source')forward($('auto').checked);else{preset='custom';updatePresetUI();maskChanged(true);}
  });
}
$('upload').onclick=()=>$('file').click();
$('file').onchange=e=>{loadFile(e.target.files[0]);e.target.value='';};
$('examples').onchange=e=>chooseExample(e.target.value);
$('tab-original').onclick=()=>setView('original');
$('tab-result').onclick=()=>{if(resultRevision!==revision)inverse(true);else setView('result');};
$('apply').onclick=()=>inverse(true);
$('target').onchange=changeTarget;
$('reset').onclick=()=>{if(!originalImage)return;snapshot();drawOriginal();resetMask();$('spectrum-hint').hidden=false;forward(false);toast('Immagine e frequenze ripristinate.');};
$('undo').onclick=()=>{
  const previous=history.pop();if(!previous)return;
  maskCtx.putImageData(previous.mask,0,0);srcCtx.putImageData(previous.source,0,0);preset=previous.preset;updatePresetUI();$('undo').disabled=!history.length;
  forward(view==='result');toast('Ultima modifica annullata.');
};
$('clear').onclick=()=>{
  if(!originalImage)return;snapshot();
  if($('target').value==='source'){drawOriginal();forward(false);toast('Disegni sull’immagine rimossi.');}
  else{resetMask();maskChanged(true);toast('Maschera rimossa. Tutte le frequenze sono disponibili.');}
};
$('fill').onclick=()=>{if(!originalImage)return;snapshot();maskCtx.fillStyle='#000';maskCtx.fillRect(0,0,n,n);preset='custom';updatePresetUI();maskChanged(true);};
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));
for(const id of ['size','arc-start','arc-end'])$(id).oninput=()=>{$(id+'-value').textContent=$(id).value+(id==='size'?' px':'°');};
$('color').oninput=()=>{$('color-value').textContent=$('color').value.toUpperCase();};
$('cutoff').addEventListener('pointerdown',()=>{if(originalImage)snapshot();});
$('cutoff').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&originalImage)snapshot();});
$('cutoff').oninput=()=>{$('cutoff-value').textContent=$('cutoff').value+'%';applyPreset(preset,false);};
$('auto').onchange=()=>{if($('auto').checked&&resultRevision!==revision)inverse(view==='result');else if(!$('auto').checked)status('Anteprima automatica disattivata','Premi Ricostruisci immagine dopo le modifiche.');};
$('resolution').onchange=()=>{if(!originalImage)return;n=Number($('resolution').value);resize();drawOriginal();forward(false);toast(`Risoluzione ${n} × ${n}. La maschera è stata azzerata.`);};
function download() {
  result.toBlob(blob=>{if(!blob){toast('Esportazione non riuscita. Riprova.');return;}const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=originalName.replace(/\.[^.]+$/,'')+'-fourier.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('PNG esportato alla risoluzione di lavoro.');},'image/png');
}
$('export').onclick=()=>{if(!originalImage)return;if(resultRevision!==revision){exportPending=true;inverse(true);}else download();};
for(const b of document.querySelectorAll('[data-expand]')) b.onclick=async()=>{
  const stage=b.dataset.expand==='image'?$('source-stage'):spectrum.parentElement;
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(stage.requestFullscreen)await stage.requestFullscreen();else toast('Il browser non supporta la modalità a schermo intero.');}catch{toast('Schermo intero non disponibile in questa finestra.');}
};
$('help').onclick=()=>$('guide').showModal();$('close-guide').onclick=()=>$('guide').close();$('start').onclick=()=>$('guide').close();
$('guide').addEventListener('click',e=>{if(e.target===$('guide')){const b=$('guide').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('guide').close();}});
document.addEventListener('keydown',e=>{
  if(document.querySelector('[data-mode="fourier"]').getAttribute('aria-pressed')!=='true')return;
  if($('guide').open||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();return;}
  if(e.metaKey||e.ctrlKey||e.altKey)return;const keys={b:'brush',c:'circle',l:'line',r:'rectangle'};if(keys[e.key.toLowerCase()])selectTool(keys[e.key.toLowerCase()]);
});
const dropStage=$('source-stage');
let dragDepth=0;
dropStage.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;dropStage.classList.add('dragover');});
dropStage.addEventListener('dragover',e=>{e.preventDefault();});
dropStage.addEventListener('dragleave',()=>{if(--dragDepth<=0)dropStage.classList.remove('dragover');});
dropStage.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;dropStage.classList.remove('dragover');loadFile(e.dataTransfer.files[0]);});
chooseExample('architecture');
