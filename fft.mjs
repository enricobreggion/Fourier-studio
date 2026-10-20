// Radix-2 complex FFT. Inverse transforms include normalization.
export function fft1d(re, im, inverse = false) {
  const n = re.length;
  if (n !== im.length || n < 1 || (n & (n - 1))) throw new Error('FFT requires equal power-of-two arrays');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / len, cr = Math.cos(angle), ci = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export function fft2d(re, im, n, inverse = false) {
  for (let y = 0; y < n; y++) fft1d(re.subarray(y*n, (y+1)*n), im.subarray(y*n, (y+1)*n), inverse);
  const r = new Float64Array(n), m = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) { r[y] = re[y*n+x]; m[y] = im[y*n+x]; }
    fft1d(r, m, inverse);
    for (let y = 0; y < n; y++) { re[y*n+x] = r[y]; im[y*n+x] = m[y]; }
  }
}
