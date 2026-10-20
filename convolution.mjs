import {fft2d} from './fft.mjs';
export const KERNELS = {
  gaussian:{name:'Sfocatura gaussiana',size:3,values:[1,2,1,2,4,2,1,2,1],divisor:16,view:'clip',description:'Il centro pesa di più dei vicini. Le variazioni rapide si attenuano: l’immagine diventa più morbida.'},
  mean:{name:'Media dei vicini',size:3,values:[1,1,1,1,1,1,1,1,1],divisor:9,view:'clip',description:'Ogni pixel diventa la media del suo vicinato. Più grande è la finestra, più forte è la sfocatura.'},
  sharpen:{name:'Nitidezza',size:3,values:[0,-1,0,-1,5,-1,0,-1,0],divisor:1,view:'clip',description:'Si rinforza il centro e si sottraggono i vicini. I dettagli vengono accentuati; i toni uniformi restano invariati.'},
  laplace:{name:'Contorni · Laplaciano',size:3,values:[0,-1,0,-1,4,-1,0,-1,0],divisor:1,view:'signed',description:'Su un’area uniforme i contributi si annullano. Ai cambiamenti di luminosità compaiono valori positivi e negativi.'},
  sobel:{name:'Contorni verticali · Sobel',size:3,values:[1,0,-1,2,0,-2,1,0,-1],divisor:1,view:'signed',description:'Confronta i due lati del vicinato per evidenziare variazioni orizzontali di luminosità, cioè bordi verticali.'},
  shift:{name:'Spostamento di 1 pixel',size:3,values:[0,0,0,0,0,1,0,0,0],divisor:1,view:'clip',description:'Un solo coefficiente, a destra del centro: l’immagine si sposta di un pixel verso destra. Cambia la fase, non il modulo di H.'},
  identity:{name:'Identità · nessuna modifica',size:3,values:[0,0,0,0,1,0,0,0,0],divisor:1,view:'clip',description:'Si conserva solo il pixel centrale. Il guadagno vale 1 e la fase vale 0 a tutte le frequenze.'}
};
export function convolveDirect(input,n,kernel,k,boundary='wrap') {
  const out=new Float64Array(n*n),c=(k-1)/2;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    let sum=0;
    for(let ky=0;ky<k;ky++)for(let kx=0;kx<k;kx++){
      let yy=y-(ky-c),xx=x-(kx-c);
      if(boundary==='wrap'){yy=(yy+n)%n;xx=(xx+n)%n;}
      else if(yy<0||yy>=n||xx<0||xx>=n)continue;
      sum+=input[yy*n+xx]*kernel[ky*k+kx];
    }out[y*n+x]=sum;
  }return out;
}
export function convolveFrequency(input,n,kernel,k,boundary='wrap') {
  let fftSize=n;if(boundary==='zero'){fftSize=1;while(fftSize<n+k-1)fftSize*=2;}
  const re=new Float64Array(fftSize*fftSize),im=new Float64Array(re.length),hr=new Float64Array(re.length),hi=new Float64Array(re.length),c=(k-1)/2;
  for(let y=0;y<n;y++)re.set(input.subarray(y*n,(y+1)*n),y*fftSize);
  // Put the kernel centre at the FFT origin, preserving phase for asymmetric kernels.
  for(let y=0;y<k;y++)for(let x=0;x<k;x++)hr[((y-c+fftSize)%fftSize)*fftSize+(x-c+fftSize)%fftSize]+=kernel[y*k+x];
  fft2d(re,im,fftSize);fft2d(hr,hi,fftSize);
  for(let p=0;p<re.length;p++){const r=re[p]*hr[p]-im[p]*hi[p];im[p]=re[p]*hi[p]+im[p]*hr[p];re[p]=r;}
  fft2d(re,im,fftSize,true);
  const out=new Float64Array(n*n);for(let y=0;y<n;y++)out.set(re.subarray(y*fftSize,y*fftSize+n),y*n);
  return {out,hr,hi,fftSize};
}
export function compareArrays(a,b){let max=0,sum=0;for(let p=0;p<a.length;p++){const d=a[p]-b[p];max=Math.max(max,Math.abs(d));sum+=d*d;}return {max,rmse:Math.sqrt(sum/a.length)};}
export function sampleNeighborhood(input,n,kernel,k,x,y,boundary='wrap'){
  const c=(k-1)/2,items=[];
  for(let dy=-c;dy<=c;dy++)for(let dx=-c;dx<=c;dx++){
    let xx=x+dx,yy=y+dy;const outside=xx<0||yy<0||xx>=n||yy>=n;
    if(boundary==='wrap'){xx=(xx+n)%n;yy=(yy+n)%n;}
    const pixel=boundary==='zero'&&outside?0:input[yy*n+xx],weight=kernel[(c-dy)*k+c-dx];
    items.push({pixel,weight,product:pixel*weight,outside,x:xx,y:yy});
  }return items;
}
export function displayValue(v,mode='clip'){return Math.round(Math.max(0,Math.min(255,mode==='signed'?128+v/2:mode==='abs'?Math.abs(v):v)));}
