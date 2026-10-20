import {messages} from './i18n-data.mjs';
const reverse=new Map(Object.entries(messages).map(([key,value])=>[value,key]));
let language='it';
try{const saved=globalThis.localStorage?.getItem('fourier-language');language=['it','en'].includes(saved)?saved:((globalThis.navigator?.language||'it').startsWith('it')?'it':'en');}catch{}
const textBindings=new Map(),staticBindings=[],attributeBindings=[],listeners=new Set();
export const getLanguage=()=>language;
export const locale=()=>language==='en'?'en-US':'it-IT';
export function t(key,params={}){
  if(typeof key!=='string')return String(key??'');
  const canonical=Object.hasOwn(messages,key)?key:(reverse.get(key)||key);
  const template=language==='en'?(messages[canonical]??canonical):canonical;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g,(_,name)=>typeof params[name]==='string'?t(params[name]):String(params[name]??''));
}
export function number(value,digits=3){return Math.abs(value)<1e-10?'0':Math.abs(value)<10**(-digits)?scientific(value):Number(value.toFixed(digits)).toLocaleString(locale(),{maximumFractionDigits:digits});}
export function scientific(value){return value===0?'0':value.toExponential(2).replace('.',language==='it'?',':'.');}
export function setText(target,render){
  const element=typeof target==='string'?document.getElementById(target):target;if(!element)return;
  const renderer=typeof render==='function'?render:()=>render;
  element.dataset.dynamicText='';textBindings.set(element,renderer);element.textContent=t(renderer());
}
export function onLanguageChange(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
function applyStatic(){
  for(const {node,key,prefix,suffix} of staticBindings)if(node.isConnected)node.data=prefix+t(key)+suffix;
  for(const {element,name,key} of attributeBindings)if(element.isConnected)element.setAttribute(name,t(key));
  document.documentElement.lang=language;
  const selector=document.getElementById('language');if(selector)selector.value=language;
  const stage=document.getElementById('source-stage');if(stage)stage.setAttribute('data-drop-label',t('Rilascia qui la tua immagine'));
}
export function setLanguage(next){
  if(!['it','en'].includes(next))return;language=next;
  try{globalThis.localStorage?.setItem('fourier-language',next);}catch{}
  if(typeof document!=='undefined'){
    applyStatic();
    for(const [element,render] of textBindings){if(element.isConnected)element.textContent=t(render());else textBindings.delete(element);}
  }
  for(const listener of listeners)listener();
}
export function initI18n(){
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const node=walker.currentNode,parent=node.parentElement;if(!parent||parent.closest('script,style,[data-dynamic-text]'))continue;
    const value=node.data.trim(),key=Object.hasOwn(messages,value)?value:reverse.get(value);if(!key)continue;
    staticBindings.push({node,key,prefix:node.data.match(/^\s*/)[0],suffix:node.data.match(/\s*$/)[0]});
  }
  for(const element of document.querySelectorAll('[aria-label],[title],meta[name="description"]'))for(const name of ['aria-label','title','content']){
    const value=element.getAttribute(name);if(!value)continue;const key=Object.hasOwn(messages,value)?value:reverse.get(value);if(key)attributeBindings.push({element,name,key});
  }
  document.getElementById('language').addEventListener('change',event=>setLanguage(event.target.value));
  applyStatic();
}
