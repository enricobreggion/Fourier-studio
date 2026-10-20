import {convolveDirect,convolveFrequency,compareArrays} from './convolution.mjs';
self.onmessage=({data})=>{try{
  const {id,input,n,kernel,k,boundary}=data;
  const direct=convolveDirect(input,n,kernel,k,boundary),frequency=convolveFrequency(input,n,kernel,k,boundary),metrics=compareArrays(direct,frequency.out);
  const {out,hr,hi,fftSize}=frequency;
  self.postMessage({id,direct,spectral:out,hr,hi,fftSize,metrics},[direct.buffer,out.buffer,hr.buffer,hi.buffer]);
}catch(error){self.postMessage({id:data.id,error:error.message});}};
