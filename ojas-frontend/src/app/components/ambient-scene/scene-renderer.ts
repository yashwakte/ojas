/** How the device should be treated, decided once by the component. */
export interface SceneProfile {
  /** Flour motes across the three depth layers. */
  motes: number;
  /** Cap on the drawing buffer's pixel ratio. */
  maxDpr: number;
  /** Frames per second to aim for; touch screens get fewer to spare battery and heat. */
  fps: number;
  /** Still frame only: no drift, no easing. */
  still: boolean;
}

/**
 * The saffron aurora: one full-screen quad. A few soft colour fields - saffron, turmeric, rose,
 * sage - warped by slow noise over the page's own off-white. Scroll slides the fields; each part
 * of the shop (`uMood`) arranges them differently, so moving between pages shifts the light
 * rather than repeating it.
 *
 * It is drawn into a canvas an eighth of the screen's size, about fifteen times a second, and the
 * browser stretches it to full screen. Drawn at full resolution every frame it cost a throttled
 * phone more than half its scrolling frames (2026-09-23 measurement); being nothing but soft
 * gradients, it looks the same stretched.
 */
/** How much smaller than the screen the aurora is drawn. */
const AURORA_DOWNSCALE = 8;
/** Seconds between aurora redraws; its movement is far slower than this. */
const AURORA_INTERVAL = 1 / 15;
const AURORA_VERTEX = `
attribute vec2 aQuad;
varying vec2 vUv;
void main() {
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

const AURORA_FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform float uTime, uScroll, uAspect, uStrength, uMood;
uniform vec2 uPointer;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
float field(vec2 uv, vec2 c, float r) {
  vec2 d = uv - c;
  d.x *= uAspect;
  return exp(-dot(d, d) / (r * r));
}

void main() {
  vec2 uv = vUv;
  vec2 warp = vec2(fbm(uv * 2.2 + uTime * 0.035), fbm(uv * 2.2 - uTime * 0.03 + 3.1)) - 0.5;
  uv += warp * 0.22;

  float s = uScroll + uMood * 0.37;
  vec3 ground = vec3(0.985, 0.978, 0.968);
  vec3 saffron = vec3(0.99, 0.73, 0.56);
  vec3 turmeric = vec3(0.99, 0.87, 0.60);
  vec3 rose = vec3(0.98, 0.81, 0.79);
  vec3 sage = vec3(0.85, 0.90, 0.79);

  vec3 col = ground;
  col = mix(col, saffron, field(uv, vec2(0.15 + 0.1 * sin(uTime * 0.05 + uMood), 0.85 - fract(s * 0.9) * 1.2), 0.42) * 0.85);
  col = mix(col, turmeric, field(uv, vec2(0.85 + 0.08 * cos(uTime * 0.04), 0.45 + 0.35 * sin(s * 3.0 + uTime * 0.02)), 0.40) * 0.8);
  col = mix(col, rose, field(uv, vec2(0.55 + 0.25 * sin(s * 2.1), 0.1 + 0.25 * cos(uTime * 0.03 + uMood)), 0.38) * 0.7);
  col = mix(col, sage, field(uv, vec2(0.25 + 0.2 * cos(s * 2.7), 0.35 + 0.1 * sin(uTime * 0.045)), 0.30) * 0.55);
  // The light leans a little towards the pointer on a desktop.
  col = mix(col, saffron, field(vUv, uPointer, 0.28) * 0.18);

  col = mix(ground, col, uStrength);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The flour drift: motes across the full width in three depth layers. Near layers are larger,
 * softer and move further with the scroll than far ones - that difference is the parallax that
 * reads as depth. They rise slowly on their own and wrap, so the field never empties.
 */
const MOTE_VERTEX = `
attribute vec4 aMote;
uniform float uTime, uScrollPx, uViewH, uSize;
varying float vAlpha, vSeed;
void main() {
  float depth = aMote.z;
  float speed = mix(0.25, 1.25, depth);
  float y = aMote.y + uTime * (0.006 + aMote.w * 0.01) * speed + uScrollPx / uViewH * speed * 0.9;
  y = mod(y + 1.2, 2.4) - 1.2;
  float x = aMote.x + sin(uTime * 0.18 + aMote.w * 30.0) * 0.02 * speed;
  gl_Position = vec4(x, y, 0.0, 1.0);
  gl_PointSize = uSize * mix(1.2, 6.5, depth * depth) * (0.6 + aMote.w * 0.8);
  vAlpha = mix(0.35, 0.8, 1.0 - depth * 0.55);
  vSeed = aMote.w;
}`;

const MOTE_FRAGMENT = `
precision mediump float;
varying float vAlpha, vSeed;
uniform float uStrength;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float soft = pow(1.0 - smoothstep(0.0, 0.25, d), 2.0);
  vec3 wheat = vec3(0.86, 0.66, 0.40);
  vec3 saffron = vec3(0.93, 0.42, 0.14);
  vec3 col = mix(wheat, saffron, step(0.82, vSeed));
  float a = soft * vAlpha * 0.55 * uStrength;
  gl_FragColor = vec4(col * a, a);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/**
 * The storefront backdrop the owner picked on 2026-09-23 ("C" of three live options): the saffron
 * aurora with flour motes drifting through it. It replaced a single morphing particle form that
 * sat in one margin - a backdrop has to cover the whole page evenly, behind everything.
 *
 * Raw WebGL on two canvases: the aurora small and seldom (see AURORA_DOWNSCALE), the motes at
 * screen resolution every frame. Everything the page tells it - scroll, page, pointer - arrives
 * as a target that each frame eases towards, so nothing ever snaps.
 */
export class SceneRenderer {
  private readonly ga: WebGLRenderingContext;
  private readonly gl: WebGLRenderingContext;
  private readonly aurora: WebGLProgram;
  private readonly motes: WebGLProgram;
  private readonly quad: WebGLBuffer;
  private readonly moteBuffer: WebGLBuffer;
  private readonly loc: Record<string, WebGLUniformLocation | null> = {};
  private readonly quadAttr: number;
  private readonly moteAttr: number;

  private width = 1;
  private height = 1;
  private dpr = 1;

  // Targets, set from outside.
  scrollPx = 0;
  scrollProgress = 0;
  /** Which arrangement of the light this part of the shop gets; see moodForPath. */
  mood = 0;
  pointerX = 0.5;
  pointerY = 0.5;

  // Live values, eased each frame.
  private liveScrollPx = 0;
  private liveProgress = 0;
  private liveMood = 0;
  private livePointerX = 0.5;
  private livePointerY = 0.5;
  private fade = 0;
  private lastAurora = -1;

  private constructor(
    private readonly auroraCanvas: HTMLCanvasElement,
    private readonly canvas: HTMLCanvasElement,
    ga: WebGLRenderingContext,
    gl: WebGLRenderingContext,
    aurora: WebGLProgram,
    motes: WebGLProgram,
    private readonly profile: SceneProfile,
  ) {
    this.ga = ga;
    this.gl = gl;
    this.aurora = aurora;
    this.motes = motes;

    this.quad = ga.createBuffer()!;
    ga.bindBuffer(ga.ARRAY_BUFFER, this.quad);
    ga.bufferData(ga.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ga.STATIC_DRAW);

    this.moteBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, moteField(profile.motes), gl.STATIC_DRAW);

    for (const name of ['uTime', 'uScroll', 'uAspect', 'uStrength', 'uMood', 'uPointer']) {
      this.loc['a.' + name] = ga.getUniformLocation(aurora, name);
    }
    for (const name of ['uTime', 'uScrollPx', 'uViewH', 'uSize', 'uStrength']) {
      this.loc['m.' + name] = gl.getUniformLocation(motes, name);
    }
    this.quadAttr = ga.getAttribLocation(aurora, 'aQuad');
    this.moteAttr = gl.getAttribLocation(motes, 'aMote');
  }

  /** Null when the device cannot draw it; the caller then leaves the page as it was. */
  static create(
    auroraCanvas: HTMLCanvasElement,
    moteCanvas: HTMLCanvasElement,
    profile: SceneProfile,
  ): SceneRenderer | null {
    const options: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    };
    const ga = auroraCanvas.getContext('webgl', { ...options, alpha: false }) as WebGLRenderingContext | null;
    const gl = moteCanvas.getContext('webgl', options) as WebGLRenderingContext | null;
    if (!ga || !gl) return null;
    const aurora = link(ga, AURORA_VERTEX, AURORA_FRAGMENT);
    const motes = link(gl, MOTE_VERTEX, MOTE_FRAGMENT);
    if (!aurora || !motes) return null;
    return new SceneRenderer(auroraCanvas, moteCanvas, ga, gl, aurora, motes, profile);
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.profile.maxDpr);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.auroraCanvas.width = Math.max(16, Math.round(width / AURORA_DOWNSCALE));
    this.auroraCanvas.height = Math.max(16, Math.round(height / AURORA_DOWNSCALE));
    this.ga.viewport(0, 0, this.auroraCanvas.width, this.auroraCanvas.height);
    this.lastAurora = -1;
  }

  /** One frame. `dt` in seconds since the last. */
  frame(time: number, dt: number): void {
    const { gl, profile } = this;
    const still = profile.still;
    const ease = (rate: number) => (still ? 1 : 1 - Math.pow(0.001, dt * rate));

    this.liveScrollPx += (this.scrollPx - this.liveScrollPx) * ease(2.2);
    this.liveProgress += (this.scrollProgress - this.liveProgress) * ease(1.2);
    this.liveMood += (this.mood - this.liveMood) * ease(0.6);
    this.livePointerX += (this.pointerX - this.livePointerX) * ease(0.8);
    this.livePointerY += (this.pointerY - this.livePointerY) * ease(0.8);
    this.fade += (1 - this.fade) * ease(0.8);

    const t = still ? 0 : time;
    const narrow = this.width < 700;

    // The aurora: small, and only every AURORA_INTERVAL. Its canvas is opaque, so no blending.
    if (still || this.lastAurora < 0 || time - this.lastAurora >= AURORA_INTERVAL) {
      this.lastAurora = time;
      const ga = this.ga;
      ga.useProgram(this.aurora);
      ga.bindBuffer(ga.ARRAY_BUFFER, this.quad);
      ga.enableVertexAttribArray(this.quadAttr);
      ga.vertexAttribPointer(this.quadAttr, 2, ga.FLOAT, false, 0, 0);
      ga.uniform1f(this.loc['a.uTime'], t);
      ga.uniform1f(this.loc['a.uScroll'], this.liveProgress);
      ga.uniform1f(this.loc['a.uAspect'], this.width / Math.max(1, this.height));
      ga.uniform1f(this.loc['a.uStrength'], this.fade * (narrow ? 0.8 : 1));
      ga.uniform1f(this.loc['a.uMood'], this.liveMood);
      ga.uniform2f(this.loc['a.uPointer'], this.livePointerX, this.livePointerY);
      ga.drawArrays(ga.TRIANGLE_STRIP, 0, 4);
      ga.disableVertexAttribArray(this.quadAttr);
    }

    // The motes, every frame, at screen resolution over a cleared transparent canvas.
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.motes);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuffer);
    gl.enableVertexAttribArray(this.moteAttr);
    gl.vertexAttribPointer(this.moteAttr, 4, gl.FLOAT, false, 0, 0);
    gl.uniform1f(this.loc['m.uTime'], t);
    gl.uniform1f(this.loc['m.uScrollPx'], this.liveScrollPx);
    gl.uniform1f(this.loc['m.uViewH'], this.height);
    gl.uniform1f(this.loc['m.uSize'], this.dpr * (narrow ? 1.25 : 1.4));
    gl.uniform1f(this.loc['m.uStrength'], this.fade);
    gl.drawArrays(gl.POINTS, 0, profile.motes);
    gl.disableVertexAttribArray(this.moteAttr);
  }

  dispose(): void {
    const { ga, gl } = this;
    ga.deleteBuffer(this.quad);
    ga.deleteProgram(this.aurora);
    gl.deleteBuffer(this.moteBuffer);
    gl.deleteProgram(this.motes);
    ga.getExtension('WEBGL_lose_context')?.loseContext();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * The motes, four floats each: x across the full width (-1..1), y (-1.2..1.2, wrapped by the
 * shader), depth (0 far .. ~1 near, in three layers) and a per-mote seed. Seeded, so a visitor
 * sees the same field from page to page rather than a fresh scatter.
 */
export function moteField(count: number, seed = 20260923): Float32Array {
  let state = seed >>> 0;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const layer = i % 3;
    data[i * 4] = rand() * 2 - 1;
    data[i * 4 + 1] = rand() * 2.4 - 1.2;
    data[i * 4 + 2] = (layer + rand() * 0.6) / 2.6;
    data[i * 4 + 3] = rand();
  }
  return data;
}
