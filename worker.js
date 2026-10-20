import { fft2d } from './fft.mjs';
let channels = null, n = 0;
self.onmessage = ({data}) => {
  try {
    const {type, id, size, pixels, mask} = data;
    if (type === 'forward') {
      n = size; channels = [];
      for (let c = 0; c < 3; c++) {
        const re = new Float64Array(n*n), im = new Float64Array(n*n);
        for (let p = 0; p < n*n; p++) re[p] = pixels[p*4+c];
        fft2d(re, im, n); channels.push({re, im});
      }
      const magnitudes = new Float64Array(n*n); let max = 0;
      for (let p = 0; p < n*n; p++) {
        let v = 0;
        for (const {re, im} of channels) v += Math.hypot(re[p], im[p]) / 3;
        magnitudes[p] = Math.log1p(v); max = Math.max(max, magnitudes[p]);
      }
      const spectrum = new Uint8ClampedArray(n*n*4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const p = ((y+n/2)%n)*n + (x+n/2)%n, q = (y*n+x)*4;
        const v = Math.pow(magnitudes[p]/(max || 1), 1.55);
        spectrum[q] = 8+v*185; spectrum[q+1] = 17+v*211; spectrum[q+2] = 28+v*227; spectrum[q+3] = 255;
      }
      self.postMessage({type, id, spectrum}, [spectrum.buffer]);
    } else if (type === 'inverse') {
      if (!channels) throw new Error('Carica prima un’immagine');
      const output = new Uint8ClampedArray(n*n*4);
      for (let c = 0; c < 3; c++) {
        const re = channels[c].re.slice(), im = channels[c].im.slice();
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const p = y*n+x, q = ((y+n/2)%n)*n + (x+n/2)%n, factor = mask[q]/255;
          re[p] *= factor; im[p] *= factor;
        }
        fft2d(re, im, n, true);
        for (let p = 0; p < n*n; p++) { output[p*4+c] = re[p]; output[p*4+3] = 255; }
      }
      self.postMessage({type, id, output}, [output.buffer]);
    }
  } catch (error) { self.postMessage({type:'error', id:data.id, message:error.message}); }
};
