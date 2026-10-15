/**
 * Green-screen (chroma key) removal. The maths lives in `keyAlpha` / `despill`
 * (tested); `ChromaKeyer` runs the same maths on the GPU with WebGL, and falls
 * back to the CPU when WebGL isn't available.
 */

export interface ChromaKey {
  /** The background colour to remove, as #rrggbb. */
  color: string;
  /** How different a colour may be and still be removed, 0..1. */
  similarity: number;
  /** Soft edge width, 0..1. */
  smoothness: number;
  /** Removes the green/blue glow left on edges, 0..1. */
  spill: number;
}

export const DEFAULT_KEY: ChromaKey = { color: '#00b140', similarity: 0.28, smoothness: 0.1, spill: 0.5 };

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Chroma (Cb, Cr) of an RGB colour in 0..1, ignoring brightness so shadows on the screen still key. */
function chroma(r: number, g: number, b: number): [number, number] {
  return [-0.169 * r - 0.331 * g + 0.5 * b, 0.5 * r - 0.419 * g - 0.081 * b];
}

/** 0 = fully removed, 1 = fully kept, for a pixel (RGB 0..1) against a key. */
export function keyAlpha(r: number, g: number, b: number, key: [number, number, number], similarity: number, smoothness: number): number {
  const [cb, cr] = chroma(r, g, b);
  const [kb, kr] = chroma(key[0], key[1], key[2]);
  const dist = Math.hypot(cb - kb, cr - kr);
  const lo = similarity * 0.5;
  const hi = lo + Math.max(0.001, smoothness * 0.5);
  const x = Math.max(0, Math.min(1, (dist - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

/** Pull the key colour's channel down on kept pixels so edges don't glow green (or blue). */
export function despill(r: number, g: number, b: number, key: [number, number, number], amount: number): [number, number, number] {
  if (amount <= 0) return [r, g, b];
  if (key[1] >= key[2]) {
    const limit = Math.max(r, b);
    return [r, g > limit ? g - (g - limit) * amount : g, b];
  }
  const limit = Math.max(r, g);
  return [r, g, b > limit ? b - (b - limit) * amount : b];
}

const VERT = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec3 key;uniform float lo;uniform float hi;uniform float spill;
vec2 chroma(vec3 c){return vec2(-.169*c.r-.331*c.g+.5*c.b,.5*c.r-.419*c.g-.081*c.b);}
void main(){vec4 c=texture2D(tex,uv);float d=distance(chroma(c.rgb),chroma(key));float a=smoothstep(lo,hi,d);
vec3 o=c.rgb;if(key.g>=key.b){float l=max(o.r,o.b);if(o.g>l)o.g-=(o.g-l)*spill;}else{float l=max(o.r,o.g);if(o.b>l)o.b-=(o.b-l)*spill;}
gl_FragColor=vec4(o*a*c.a,a*c.a);}`;

/** Removes a key colour from frames. Reuse one instance; it keeps its GPU resources. */
export class ChromaKeyer {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private failed = false;

  private setup(): boolean {
    if (this.gl) return true;
    if (this.failed) return false;
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) return !(this.failed = true);
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return !(this.failed = true);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.gl = gl;
    this.prog = prog;
    return true;
  }

  /** Key `source` (already drawn at the wanted size on a canvas). Returns a canvas with transparency. */
  process(source: HTMLCanvasElement, key: ChromaKey): HTMLCanvasElement {
    const w = source.width;
    const h = source.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const k = hexToRgb(key.color);
    const lo = key.similarity * 0.5;
    const hi = lo + Math.max(0.001, key.smoothness * 0.5);
    if (this.setup()) {
      const gl = this.gl!;
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform3f(gl.getUniformLocation(this.prog!, 'key'), k[0], k[1], k[2]);
      gl.uniform1f(gl.getUniformLocation(this.prog!, 'lo'), lo);
      gl.uniform1f(gl.getUniformLocation(this.prog!, 'hi'), hi);
      gl.uniform1f(gl.getUniformLocation(this.prog!, 'spill'), key.spill);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.canvas;
    }
    // CPU fallback: same maths, pixel by pixel, written back into the source canvas.
    const ctx = source.getContext('2d')!;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      const a = keyAlpha(r, g, b, k, key.similarity, key.smoothness);
      const [r2, g2, b2] = despill(r, g, b, k, key.spill);
      d[i] = r2 * 255;
      d[i + 1] = g2 * 255;
      d[i + 2] = b2 * 255;
      d[i + 3] *= a;
    }
    ctx.putImageData(img, 0, 0);
    return source;
  }
}
