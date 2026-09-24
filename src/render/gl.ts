/**
 * Fullscreen WebGL2 fragment-shader background: a gently pulsing nebula that
 * warms up where the gravity field pulls hard and cools/dims near
 * anti-gravity nodes. Falls back to a Canvas2D gradient if WebGL2 is
 * unavailable (older mobile browsers, headless envs without GPU, etc).
 */
import type { GameState } from '../sim/types';
import { computeLetterbox } from './layout';

export interface BackgroundRenderer {
  render(state: GameState, timeSec: number): void;
  resize(cssW: number, cssH: number, dpr: number): void;
  destroy(): void;
}

const VERT_SRC = `#version 300 es
layout(location=0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform vec2 u_resolution;
uniform vec4 u_letterbox; // x, y, w, h in pixels
uniform float u_time;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  frag.y = u_resolution.y - frag.y; // flip to top-left origin, matches world y-down
  vec2 uv = (frag - u_letterbox.xy) / u_letterbox.zw;

  float field = texture(u_field, clamp(uv, 0.0, 1.0)).r; // 0..1, 0.5 ~= neutral
  float signedField = (field - 0.5) * 2.0; // -1..1

  float pulse = 0.92 + 0.08 * sin(u_time * 0.6);
  float n = noise(uv * vec2(9.0, 5.0) + u_time * 0.03) * 0.5 +
            noise(uv * vec2(20.0, 11.0) - u_time * 0.05) * 0.25;

  vec3 base = vec3(0.02, 0.025, 0.05);
  vec3 warm = vec3(1.0, 0.45, 0.18);
  vec3 hot  = vec3(1.0, 0.78, 0.35);
  vec3 cool = vec3(0.05, 0.12, 0.28);
  vec3 coolDim = vec3(0.01, 0.01, 0.03);

  float hi = smoothstep(0.25, 0.95, signedField);
  float veryHi = smoothstep(0.6, 1.0, signedField);
  float lo = smoothstep(-0.25, -0.95, signedField);

  vec3 col = base;
  col = mix(col, cool, lo * 0.6);
  col = mix(col, coolDim, lo * 0.4);
  col += warm * hi * 0.4;
  col += hot * veryHi * 0.4;
  col += n * 0.035 * (0.4 + hi);
  col *= pulse;

  float vignette = 1.0 - 0.35 * smoothstep(0.4, 1.15, length(uv - 0.5) * 1.3);
  col *= vignette;

  outColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile error: ${info}`);
  }
  return sh;
}

function createWebGL2Renderer(canvas: HTMLCanvasElement): BackgroundRenderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
    }
  } catch (e) {
    console.warn('[gl] falling back to Canvas2D background:', e);
    return null;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // fullscreen triangle (covers -1..1 clip space with one triangle, no seams)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const u_field = gl.getUniformLocation(program, 'u_field');
  const u_resolution = gl.getUniformLocation(program, 'u_resolution');
  const u_letterbox = gl.getUniformLocation(program, 'u_letterbox');
  const u_time = gl.getUniformLocation(program, 'u_time');

  let cssW = canvas.clientWidth || 1;
  let cssH = canvas.clientHeight || 1;
  let dpr = 1;
  let fieldBytes: Uint8Array | null = null;

  function resize(w: number, h: number, ratio: number) {
    cssW = w;
    cssH = h;
    dpr = ratio;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    gl!.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(state: GameState, timeSec: number) {
    const gridW = state.gridW;
    const gridH = state.gridH;
    if (!fieldBytes || fieldBytes.length !== gridW * gridH) {
      fieldBytes = new Uint8Array(gridW * gridH);
    }
    // z-score normalize (not min/max) so a lone hotspot doesn't wash the
    // whole grid warm: most cells sit near the mean -> render as dark base,
    // only genuine outliers (strong pull / strong repulsion) read as hot/cool.
    let sum = 0;
    for (let i = 0; i < state.field.length; i++) sum += state.field[i];
    const mean = sum / state.field.length;
    let variance = 0;
    for (let i = 0; i < state.field.length; i++) {
      const d = state.field[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / state.field.length) || 1;
    const scale = std * 2.2;
    for (let i = 0; i < state.field.length; i++) {
      const z = Math.max(-1, Math.min(1, (state.field[i] - mean) / scale));
      fieldBytes[i] = Math.round(((z + 1) / 2) * 255);
    }

    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.R8,
      gridW,
      gridH,
      0,
      gl!.RED,
      gl!.UNSIGNED_BYTE,
      fieldBytes,
    );

    const lb = computeLetterbox(cssW, cssH, state.width, state.height);

    gl!.useProgram(program);
    gl!.bindVertexArray(vao);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.uniform1i(u_field, 0);
    gl!.uniform2f(u_resolution, cssW * dpr, cssH * dpr);
    gl!.uniform4f(u_letterbox, lb.x * dpr, lb.y * dpr, lb.w * dpr, lb.h * dpr);
    gl!.uniform1f(u_time, timeSec);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.bindVertexArray(null);
  }

  function destroy() {
    gl!.deleteProgram(program);
    gl!.deleteBuffer(buf);
    gl!.deleteVertexArray(vao);
    gl!.deleteTexture(tex);
  }

  return { render, resize, destroy };
}

function createCanvas2DFallback(canvas: HTMLCanvasElement): BackgroundRenderer {
  const ctx = canvas.getContext('2d')!;
  let cssW = canvas.clientWidth || 1;
  let cssH = canvas.clientHeight || 1;
  let dpr = 1;

  function resize(w: number, h: number, ratio: number) {
    cssW = w;
    cssH = h;
    dpr = ratio;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
  }

  function render(_state: GameState, timeSec: number) {
    const w = canvas.width;
    const h = canvas.height;
    const pulse = 0.9 + 0.1 * Math.sin(timeSec * 0.6);
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.7,
    );
    g.addColorStop(0, `rgba(${40 * pulse}, ${28 * pulse}, ${60 * pulse}, 1)`);
    g.addColorStop(0.5, 'rgba(10,10,22,1)');
    g.addColorStop(1, 'rgba(3,4,9,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    void dpr;
    void cssW;
    void cssH;
  }

  return { render, resize, destroy() {} };
}

export function createBackgroundRenderer(canvas: HTMLCanvasElement): BackgroundRenderer {
  return createWebGL2Renderer(canvas) ?? createCanvas2DFallback(canvas);
}
