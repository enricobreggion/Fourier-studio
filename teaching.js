import {t,setText,onLanguageChange,number as fmt,scientific} from './i18n.mjs';
import {KERNELS,sampleNeighborhood,displayValue} from './convolution.mjs';
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('./convolution-worker.js',import.meta.url),{type:'module'});
let mode='fourier',sourceData=null,input=null,n=256,k=3,raw=[...KERNELS.gaussian.values],divisor=16;
let preset='gaussian',lastPreset='gaussian',responseMode='magnitude',computed=null,seq=0,timer=null,exportPending=false;
let px=128,py=128,selectedTerm=-1,experiment='blur',valid=true;
const experiments={
  blur:{preset:'mean',question:'Filtro medio',answer:'La media smussa le variazioni rapide. Il modulo di H è alto vicino al centro e più basso per molte frequenze elevate. Un filtro medio finito ha anche lobi: non è un taglio circolare ideale.'},
  edges:{preset:'laplace',question:'Filtro Laplaciano',answer:'I contributi si annullano: il risultato è zero. Il guadagno al centro dello spettro è H(0,0) = 0, quindi la componente costante è eliminata. Ai bordi delle forme emergono valori con segno; nella vista firmata, il grigio indica zero.'},
  shift:{preset:'shift',question:'Filtro di spostamento',answer:'Questo kernel prende il vicino a sinistra, perché nella convoluzione la matrice viene ruotata di 180°. Le frequenze mantengono la loro ampiezza, ma cambiano fase. La risposta di fase è una rampa che produce lo spostamento. Con bordi a zero compaiono pixel neri sul lato lasciato libero.'}
};
function setMode(next,recompute=true){
  window.history.replaceState(null,'',next==='fourier'?location.pathname+location.search:'#'+next);
  mode=next;setText($('reset').querySelector('span'),()=>(mode==='fourier'?'Ripristina':'Ripristina immagine'));$('reset').title=t(mode==='fourier'?'Ripristina immagine e maschera':'Ripristina l’immagine; il kernel si ripristina dal suo pannello');$('fourier-panel').hidden=mode!=='fourier';$('teaching-panel').hidden=mode==='fourier';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',b.dataset.mode===mode);});
  $('spatial-view').hidden=mode==='bridge';$('bridge-view').hidden=mode!=='bridge';
  setText($('lesson-eyebrow'),()=>(mode==='bridge'?'DUE DOMINI, LA STESSA OPERAZIONE':'NEL DOMINIO DELLO SPAZIO'));
  setText($('lesson-title'),()=>(mode==='bridge'?'Confronto tra spazio e frequenze':'Convoluzione spaziale'));
  setText($('lesson-lead'),()=>(mode==='bridge'?'Convoluzione diretta e moltiplicazione in frequenza con lo stesso kernel e le stesse condizioni al bordo.':'Il kernel determina la somma pesata dei pixel del vicinato.'));
  setText($('switch-perspective'),()=>(mode==='bridge'?'← Convoluzione spaziale':'Confronto Fourier →'));
  if(recompute&&mode!=='fourier'&&input&&!computed)schedule();
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('switch-perspective').onclick=()=>setMode(mode==='bridge'?'convolution':'bridge');
$('projector').onclick=()=>{
  const enabled=document.body.classList.toggle('lecture-view');$('projector').setAttribute('aria-pressed',enabled);
  setText($('projector').querySelector('span'),()=>(enabled?'Vista completa':'Vista compatta'));
};
function buildMatrix(){
  $('kernel-grid').style.setProperty('--kernel-size',k);$('kernel-grid').replaceChildren();
  for(let i=0;i<k*k;i++){
    const field=document.createElement('input');field.type='number';field.step='any';field.min='-1000000';field.max='1000000';field.value=raw[i];
    field.setAttribute('aria-label',t('Kernel, riga {row}, colonna {column}{centre}',{row:Math.floor(i/k)+1,column:i%k+1,centre:i===(k*k-1)/2?', centro':''}));
    if(i===(k*k-1)/2)field.className='kernel-center';field.addEventListener('input',()=>{markCustom();readAndSchedule();});$('kernel-grid').append(field);
  }
}
function markCustom(){preset='custom';$('kernel-preset').value='custom';setText($('kernel-description'),()=>('Kernel personalizzato: coefficienti e divisore modificabili.'));clearExperiment();}
function readKernel(){
  const fields=[...$('kernel-grid').querySelectorAll('input')];
  const values=fields.map(f=>f.valueAsNumber),d=$('kernel-divisor').valueAsNumber;
  valid=values.every((v,i)=>Number.isFinite(v)&&Math.abs(v)<=1e6&&fields[i].value!=='')&&Number.isFinite(d)&&d!==0&&Math.abs(d)<=1e6&&Math.abs(d)>=1e-6;
  setText($('kernel-validation'),()=>(valid?'':'Completa i coefficienti con valori da −1.000.000 a 1.000.000. Il divisore deve essere diverso da zero e avere modulo tra 0,000001 e 1.000.000.'));
  $('normalize-kernel').disabled=!values.every(Number.isFinite)||Math.abs(values.reduce((a,b)=>a+b,0))<1e-10;
  if(valid){raw=values;divisor=d;setText($('kernel-sum'),()=>(fmt(raw.reduce((a,b)=>a+b,0)/divisor)));}
  else setText($('kernel-sum'),()=>('—'));
  return valid;
}
function readAndSchedule(){readKernel();schedule();renderInspector();}
function usePreset(key){
  const p=KERNELS[key];if(!p)return;preset=lastPreset=key;k=p.size;raw=[...p.values];divisor=p.divisor;selectedTerm=-1;
  $('kernel-preset').value=key;$('kernel-size').value=k;$('kernel-divisor').value=divisor;$('output-display').value=p.view;
  setText($('kernel-description'),()=>(p.description));buildMatrix();readKernel();displayExplanation();schedule();renderInspector();
}
$('kernel-preset').onchange=e=>{clearExperiment();usePreset(e.target.value);};
$('kernel-reset').onclick=()=>{clearExperiment();usePreset(lastPreset);};
$('kernel-divisor').oninput=()=>{markCustom();readAndSchedule();};
$('normalize-kernel').onclick=()=>{
  const sum=[...$('kernel-grid').querySelectorAll('input')].reduce((a,f)=>a+f.valueAsNumber,0);
  if(!Number.isFinite(sum)||Math.abs(sum)<1e-10)return;$('kernel-divisor').value=sum;markCustom();readAndSchedule();
};
$('kernel-size').onchange=()=>{
  const next=Number($('kernel-size').value),c=(k-1)/2,nc=(next-1)/2,previous=raw;
  if(preset==='mean') {raw=new Array(next*next).fill(1);divisor=next*next;}
  else{raw=new Array(next*next).fill(0);for(let y=0;y<next;y++)for(let x=0;x<next;x++){const yy=y-nc+c,xx=x-nc+c;if(yy>=0&&yy<k&&xx>=0&&xx<k)raw[y*next+x]=previous[yy*k+xx];}}
  const wasMean=preset==='mean';k=next;$('kernel-divisor').value=divisor;buildMatrix();markCustom();
  if(wasMean)setText($('kernel-description'),()=>(t('Media su {count} vicini: ogni peso effettivo vale 1/{count}.',{count:k*k})));
  selectedTerm=-1;readAndSchedule();
};
function prepareSource(){
  if(!sourceData)return;n=Number($('teaching-resolution').value);
  const original=document.createElement('canvas');original.width=original.height=sourceData.size;
  original.getContext('2d').putImageData(new ImageData(sourceData.pixels,sourceData.size,sourceData.size),0,0);
  const scaled=document.createElement('canvas');scaled.width=scaled.height=n;const ctx=scaled.getContext('2d');ctx.drawImage(original,0,0,n,n);
  const pixels=ctx.getImageData(0,0,n,n).data;input=new Float64Array(n*n);
  for(let p=0;p<input.length;p++)input[p]=Math.round(.2126*pixels[p*4]+.7152*pixels[p*4+1]+.0722*pixels[p*4+2]);
  px=Math.min(n-1,Math.round(n*(sourceData.name==='step-and-impulse.png'?.5:.56)));py=Math.min(n-1,Math.round(n*.45));selectedTerm=-1;
  $('pixel-x').max=$('pixel-y').max=n-1;setText($('teaching-source-name'),()=>(`${sourceData.name} · ${n} × ${n} px`));
  for(const id of ['conv-input','conv-output','bridge-direct','bridge-fourier','bridge-difference']){$(id).width=$(id).height=n;}
  drawInput();renderInspector();schedule();
}
window.addEventListener('fourier:source',e=>{sourceData=e.detail;prepareSource();});
$('teaching-resolution').onchange=prepareSource;
function pending(message){
  setText($('teaching-state'),()=>(message));setText($('equivalence-title'),()=>(message));setText($('equivalence-icon'),()=>('…'));
  setText($('equivalence-detail'),()=>('Stessa immagine, stesso kernel, stessa gestione dei bordi.'));
  for(const id of ['dc-gain','max-gain','fft-dimension'])setText(id,()=> '—');
  $('teaching-panel').classList.add('computing');$('teaching-panel').setAttribute('aria-busy','true');
}
function schedule(){
  clearTimeout(timer);seq++;computed=null;
  if(!valid){pending('Completa la matrice per proseguire.');return;}
  if(!input){pending('Carica un’immagine per iniziare.');return;}
  pending('Calcolo dei due percorsi…');
  if(mode==='fourier')return;
  const id=seq;
  timer=setTimeout(()=>{worker.postMessage({id,input:input.slice(),n,kernel:Float64Array.from(raw,v=>v/divisor),k,boundary:$('boundary').value});},160);
}
worker.onmessage=({data})=>{
  if(data.id!==seq)return;
  $('teaching-panel').classList.remove('computing');$('teaching-panel').setAttribute('aria-busy','false');
  if(data.error){computed=null;setText($('teaching-state'),()=>(t('Errore di calcolo.')));setText($('equivalence-title'),()=>('Confronto non disponibile'));exportPending=false;return;}
  computed=data;drawResults();drawResponse();renderInspector();
  const equivalent=data.metrics.max<1e-6;
  setText($('equivalence-icon'),()=>(equivalent?'=':'≠'));setText($('equivalence-title'),()=>(equivalent?'I due percorsi coincidono entro la precisione numerica.':'Differenza numerica superiore alla soglia.'));
  setText($('equivalence-detail'),()=>(t('Errore massimo: {max} · RMSE: {rmse} · soglia assoluta: 10⁻⁶ livelli.',{max:scientific(data.metrics.max),rmse:scientific(data.metrics.rmse)})));
  setText($('teaching-state'),()=>(t('Aggiornato · {size} × {size} · bordi {boundary}',{size:n,boundary:$('boundary').value==='wrap'?'circolari':'a zero'})));
  if(exportPending){exportPending=false;exportLesson();}
};
worker.onerror=()=>{computed=null;exportPending=false;setText($('teaching-state'),()=>('Motore di calcolo non disponibile. Ricarica la pagina.'));setText($('equivalence-title'),()=>('Confronto non disponibile'));};
function imagePixels(values,mode){
  const p=new Uint8ClampedArray(n*n*4);for(let i=0;i<n*n;i++){
    // Stabilize display rounding at half-integer ties. The comparison always retains raw floating-point results.
    const v=displayValue(Math.round(values[i]*1e8)/1e8,mode);p[i*4]=p[i*4+1]=p[i*4+2]=v;p[i*4+3]=255;
  }return new ImageData(p,n,n);
}
function drawInput(){
  if(!input)return;const ctx=$('conv-input').getContext('2d');ctx.putImageData(imagePixels(input,'clip'),0,0);
  ctx.lineWidth=Math.max(.75,n/256);ctx.strokeStyle='#8bbbf5';const c=(k-1)/2;
  ctx.strokeRect(px-c-.5,py-c-.5,k+1,k+1);ctx.beginPath();ctx.moveTo(px-7,py+.5);ctx.lineTo(px-3,py+.5);ctx.moveTo(px+4,py+.5);ctx.lineTo(px+8,py+.5);ctx.moveTo(px+.5,py-7);ctx.lineTo(px+.5,py-3);ctx.moveTo(px+.5,py+4);ctx.lineTo(px+.5,py+8);ctx.stroke();
  $('pixel-x').value=px;$('pixel-y').value=py;
}
function drawResults(){
  if(!computed)return;const display=$('output-display').value;
  const direct=imagePixels(computed.direct,display),spectral=imagePixels(computed.spectral,display);
  $('conv-output').getContext('2d').putImageData(direct,0,0);$('bridge-direct').getContext('2d').putImageData(direct,0,0);$('bridge-fourier').getContext('2d').putImageData(spectral,0,0);
  const diff=new Uint8ClampedArray(n*n*4);for(let p=0;p<n*n;p++){const v=Math.min(255,Math.abs(computed.direct[p]-computed.spectral[p])*255);diff[p*4]=diff[p*4+1]=diff[p*4+2]=v;diff[p*4+3]=255;}
  $('bridge-difference').getContext('2d').putImageData(new ImageData(diff,n,n),0,0);
}
function displayExplanation(){
  const explanations={clip:'Sotto 0 diventa nero; sopra 255 diventa bianco. Il calcolo numerico rimane invariato.',signed:'Grigio (128) = zero; scuro = negativo; chiaro = positivo. Codifica fissa: 128 + g/2, poi taglio a 0–255.',abs:'Visualizziamo |g|: i negativi diventano positivi. I valori oltre 255 vengono tagliati. Il confronto usa ancora g con segno.'};
  setText($('display-explanation'),()=>(explanations[$('output-display').value]));
  document.querySelectorAll('.display-note').forEach(e=>setText(e,()=>({clip:'Visualizzazione: valori limitati a 0–255.',signed:'Visualizzazione con segno: grigio = zero.',abs:'Visualizzazione: valore assoluto, limitato a 255.'}[$('output-display').value])));
}
$('output-display').onchange=()=>{displayExplanation();drawResults();};
$('boundary').onchange=()=>{
  setText($('boundary-explanation'),()=>($('boundary').value==='wrap'?'Il bordo destro continua a sinistra e viceversa. Lo stesso vale per alto e basso.':'Ogni pixel esterno all’immagine vale zero. La FFT aggiunge zeri per evitare che i bordi opposti si mescolino.'));
  schedule();renderInspector();
};
function selectPixel(x,y){if(!input)return;px=Math.max(0,Math.min(n-1,Math.round(x)));py=Math.max(0,Math.min(n-1,Math.round(y)));selectedTerm=-1;drawInput();renderInspector();}
$('conv-input').onclick=e=>{const b=e.currentTarget.getBoundingClientRect();selectPixel((e.clientX-b.left)/b.width*n,(e.clientY-b.top)/b.height*n);};
$('conv-input').onkeydown=e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(d){e.preventDefault();selectPixel(px+d[0],py+d[1]);}};
for(const [id,axis] of [['pixel-x','x'],['pixel-y','y']])$(id).onchange=()=>{const v=$(id).valueAsNumber;if(Number.isFinite(v))selectPixel(axis==='x'?v:px,axis==='y'?v:py);};
$('inspect-border').onclick=()=>{setMode('convolution');selectPixel(0,Math.floor(n/2));$('spatial-view').scrollIntoView({behavior:'smooth',block:'start'});};
function renderInspector(){
  drawInput();if(!input||!valid){for(const id of ['neighborhood-grid','flipped-grid','products-grid'])$(id).replaceChildren();for(const id of ['pixel-equation','pixel-result'])setText(id,()=> '—');setText($('pixel-step-detail'),()=>('Completa il kernel e il divisore per vedere il calcolo.'));setText($('step-progress'),()=>('—'));return;}
  const items=sampleNeighborhood(input,n,raw,k,px,py,$('boundary').value);
  for(const id of ['neighborhood-grid','flipped-grid','products-grid']){$(id).style.setProperty('--kernel-size',k);$(id).replaceChildren();}
  for(let i=0;i<items.length;i++){
    const item=items[i];
    for(const [id,value] of [['neighborhood-grid',item.pixel],['flipped-grid',item.weight],['products-grid',item.product]]){
      const cell=document.createElement('button');cell.type='button';cell.textContent=fmt(value,2);cell.dataset.cell=i;cell.className='number-cell';
      if(i===(k*k-1)/2)cell.classList.add('center-cell');if(i===selectedTerm)cell.classList.add('active-cell');
      if(id==='neighborhood-grid'){cell.style.background=`rgb(${item.pixel},${item.pixel},${item.pixel})`;cell.style.color=item.pixel>140?'#121922':'#eef2f8';if(item.outside)cell.classList.add('outside-cell');}
      else cell.classList.add(value<0?'negative-cell':value>0?'positive-cell':'zero-cell');
      cell.setAttribute('aria-label',t('{part} {row},{column}: {value}{outside}',{part:id==='neighborhood-grid'?'Pixel':id==='flipped-grid'?'Coefficiente ruotato':'Contributo',row:Math.floor(i/k)+1,column:i%k+1,value:fmt(value),outside:item.outside&&id==='neighborhood-grid'?', campione oltre il bordo':''}));
      cell.onclick=()=>{selectedTerm=i;renderInspector();};$(id).append(cell);
    }
  }
  const sum=items.reduce((a,v)=>a+v.product,0),final=sum/divisor;
  setText($('pixel-equation'),()=>(`${fmt(sum)} ÷ ${fmt(divisor)} = ${fmt(final)}`));setText($('pixel-result'),()=>(fmt(final)));
  setText($('step-progress'),()=>(selectedTerm<0?'Tutti i contributi':t('Contributo {index} di {count}',{index:selectedTerm+1,count:items.length})));
  setText($('step-next'),()=>(selectedTerm<0?'Un prodotto alla volta →':selectedTerm===items.length-1?'Ricomincia dal primo →':'Prodotto successivo →'));
  if(selectedTerm>=0){const item=items[selectedTerm],partial=items.slice(0,selectedTerm+1).reduce((a,v)=>a+v.product,0);setText($('pixel-step-detail'),()=>(t('{pixel} × {weight} = {product}. Somma parziale ({index}/{count}): {sum} (prima del divisore).{outside}',{pixel:fmt(item.pixel),weight:fmt(item.weight),product:fmt(item.product),index:selectedTerm+1,count:items.length,sum:fmt(partial),outside:item.outside?' Questo campione supera il bordo: si applica la regola selezionata.':''})));}
  else setText($('pixel-step-detail'),()=>(t('La somma usa tutti i {count} contributi. {note}',{count:items.length,note:items.some(v=>v.outside)?'Le celle con bordo tratteggiato indicano campioni oltre il limite dell’immagine.':'Le celle corrispondenti mostrano pixel, coefficiente e prodotto.'})));
}
$('step-next').onclick=()=>{if(!valid)return;selectedTerm=(selectedTerm+1)%(k*k);renderInspector();};$('step-all').onclick=()=>{selectedTerm=-1;renderInspector();};
function drawResponse(){
  if(!computed)return;const {hr,hi,fftSize:s}=computed,w=256,pixels=new Uint8ClampedArray(w*w*4);let max=0;
  for(let i=0;i<hr.length;i++)max=Math.max(max,Math.hypot(hr[i],hi[i]));
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){
    const xx=(Math.floor(x*s/w)+s/2)%s,yy=(Math.floor(y*s/w)+s/2)%s,p=yy*s+xx,q=(y*w+x)*4,mag=Math.hypot(hr[p],hi[p]);let rgb;
    if(responseMode==='magnitude'){const v=max?Math.log1p(mag)/Math.log1p(max):0;rgb=[9+v*168,19+v*195,36+v*218];}
    else if(mag<max*1e-10||max===0)rgb=[12,16,24];
    else {const phase=Math.atan2(hi[p],hr[p]);rgb=phase>=0?[155-phase/Math.PI*90,169-phase/Math.PI*65,190+phase/Math.PI*65]:[155+phase/Math.PI*75,169-phase/Math.PI*56,190-phase/Math.PI*60];}
    pixels[q]=rgb[0];pixels[q+1]=rgb[1];pixels[q+2]=rgb[2];pixels[q+3]=255;
  }
  $('kernel-response').getContext('2d').putImageData(new ImageData(pixels,w,w),0,0);
  setText($('dc-gain'),()=>(fmt(raw.reduce((a,b)=>a+b,0)/divisor)));setText($('max-gain'),()=>(fmt(max)));setText($('fft-dimension'),()=>(t('{size} × {size}{padding}',{size:s,padding:$('boundary').value==='zero'?' · con zeri aggiunti':''})));
  setText($('response-title'),()=>(responseMode==='magnitude'?'Guadagno per frequenza':'Fase delle componenti'));
  setText($('response-description'),()=>(responseMode==='magnitude'?'Il modulo mostra il guadagno di ogni frequenza. La mappa è normalizzata al proprio massimo.':'La fase può cambiare anche quando il modulo è costante. Il kernel di spostamento ne è un esempio. Dove il modulo è nullo, la fase non è definita.'));
  setText($('response-legend'),()=>(responseMode==='magnitude'?'Chiaro = guadagno alto. Frequenza zero al centro.':'Ciano: −π · grigio: 0 · blu: +π. Nero: modulo nullo.'));
  drawGainPlot(max);
}
function drawGainPlot(max){
  const canvas=$('response-plot'),ctx=canvas.getContext('2d'),{hr,hi,fftSize:s}=computed;
  const W=canvas.width,H=canvas.height,L=44,R=18,T=20,B=36,plotW=W-L-R,plotH=H-T-B,top=Math.max(1.25,max*1.1);
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0f151d';ctx.fillRect(0,0,W,H);ctx.font='12px system-ui';
  for(let j=0;j<4;j++){const value=top*j/3,y=H-B-value/top*plotH;ctx.strokeStyle='#233041';ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(W-R,y);ctx.stroke();ctx.fillStyle='#97a4b4';ctx.fillText(fmt(value,1),5,y+4);}
  ctx.setLineDash([5,5]);ctx.strokeStyle='#8796a8';const one=H-B-plotH/top;ctx.beginPath();ctx.moveTo(L,one);ctx.lineTo(W-R,one);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle='#8bbbf5';ctx.lineWidth=2;ctx.beginPath();for(let x=0;x<plotW;x++){const u=(Math.floor(x/plotW*s)+s/2)%s,v=Math.hypot(hr[u],hi[u]),y=H-B-v/top*plotH;if(x===0)ctx.moveTo(L+x,y);else ctx.lineTo(L+x,y);}ctx.stroke();
  ctx.fillStyle='#97a4b4';ctx.fillText(fmt(-.5,1),L,H-14);ctx.fillText('0',L+plotW/2-3,H-14);ctx.fillText(`+${fmt(.5,1)} ${t('cicli/pixel')}`,W-R-105,H-14);ctx.fillText('|H|',6,13);
}
for(const [id,next] of [['response-magnitude','magnitude'],['response-phase','phase']])$(id).onclick=()=>{responseMode=next;for(const b of ['response-magnitude','response-phase']){$(b).classList.toggle('selected',b===id);$(b).setAttribute('aria-pressed',b===id);}drawResponse();};
function clearExperiment(){experiment=null;document.querySelectorAll('[data-experiment]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});setText($('experiment-question'),()=>('Kernel personalizzato.'));setText($('experiment-explanation'),()=>('La risposta del filtro dipende dai coefficienti e dal divisore.'));$('experiment-answer').open=false;}
function useExperiment(key){const e=experiments[key];usePreset(e.preset);experiment=key;document.querySelectorAll('[data-experiment]').forEach(b=>{b.classList.toggle('active',b.dataset.experiment===key);b.setAttribute('aria-pressed',b.dataset.experiment===key);});setText($('experiment-question'),()=>(e.question));setText($('experiment-explanation'),()=>(e.answer));$('experiment-answer').open=false;if(key==='shift'&&mode==='bridge')$('response-phase').click();}
document.querySelectorAll('[data-experiment]').forEach(b=>b.onclick=()=>useExperiment(b.dataset.experiment));
$('export').addEventListener('click',e=>{
  if(mode==='fourier')return;e.preventDefault();e.stopImmediatePropagation();if(!valid){setText($('teaching-state'),()=>('Completa prima i coefficienti del kernel.'));return;}
  if(!computed){exportPending=true;schedule();return;}exportLesson();
},true);
function exportLesson(){
  if(!computed)return;$('conv-output').toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(sourceData?.name||t('immagine')).replace(/\.[^.]+$/,'')+t('-convoluzione.png');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);setText($('teaching-state'),()=>('Esportato il risultato della convoluzione con la scala di visualizzazione selezionata.'));},'image/png');
}
useExperiment('blur');

const teachingGuide=document.createElement('dialog');
teachingGuide.id='teaching-guide';teachingGuide.setAttribute('aria-labelledby','teaching-guide-title');
teachingGuide.innerHTML=`<button class="close-dialog" aria-label="Chiudi guida">×</button><h2 id="teaching-guide-title">Convoluzione e frequenze</h2><ol><li><strong>Kernel</strong>I coefficienti e il divisore definiscono il filtro. Nel calcolo locale il kernel viene ruotato di 180° e moltiplicato per il vicinato del pixel selezionato.</li><li><strong>Confronto Fourier</strong>La convoluzione diretta e il prodotto complesso F × H sono calcolati separatamente. L’errore massimo e il RMSE confrontano i valori prima della visualizzazione.</li><li><strong>Bordi e visualizzazione</strong>I due percorsi usano gli stessi bordi e la stessa scala. Con bordi a zero, la FFT usa zeri aggiunti. I valori negativi restano disponibili nel calcolo.</li></ol><div class="guide-note">Immagine e kernel sono condivisi tra Convoluzione e Confronto Fourier. La modalità Fourier conserva la propria maschera. La vista compatta nasconde la barra superiore.</div><button class="button primary">Chiudi</button>`;
document.body.append(teachingGuide);teachingGuide.querySelectorAll('button').forEach(b=>b.onclick=()=>teachingGuide.close());
$('help').addEventListener('click',e=>{if(mode!=='fourier'){e.preventDefault();e.stopImmediatePropagation();teachingGuide.showModal();}},true);

const initialMode=location.hash.slice(1);if(['convolution','bridge'].includes(initialMode))setMode(initialMode);
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);setMode(['convolution','bridge'].includes(next)?next:'fourier');});

onLanguageChange(()=>{
  setMode(mode,false);
  for(const [i,field] of [...$('kernel-grid').querySelectorAll('input')].entries())field.setAttribute('aria-label',t('Kernel, riga {row}, colonna {column}{centre}',{row:Math.floor(i/k)+1,column:i%k+1,centre:i===(k*k-1)/2?', centro':''}));
  renderInspector();if(computed)drawResponse();
});
