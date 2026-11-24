/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the WebGL half of the 3D surface (WO-03)

   A small, dependency-free renderer: one program, two vertex buffers, a depth
   buffer. No scene graph, no loader, no CDN — the shader source is a string in
   this file and the geometry comes from `buildSurfaceGeometry`.

   The same picture is painted into SVG by `surfaceSvgBody`; this module only
   exists so dragging a 401×401 surface stays smooth. `createSurfaceGl` returns
   null on any failure (no WebGL, a driver that refuses the context, a lost
   context), which is how the caller knows to fall back to the static
   projection instead of showing a blank box.
   ───────────────────────────────────────────────────────────────────────── */

import type { SurfaceGeometry } from './surface3d';

const VERTEX_SHADER = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMvp;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  vNormal = aNormal;
  vColor = aColor;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uLight;
uniform float uAmbient;
uniform float uDiffuse;
uniform float uOpacity;
uniform float uFlat;
uniform vec3 uFlatColor;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  if (uFlat > 0.5) {
    gl_FragColor = vec4(uFlatColor, uOpacity);
    return;
  }
  vec3 normal = normalize(vNormal);
  float lambert = max(dot(normal, normalize(uLight)), 0.0);
  float shade = max(0.05, uAmbient + uDiffuse * lambert);
  gl_FragColor = vec4(clamp(vColor * shade, 0.0, 1.0), uOpacity);
}
`;

export interface SurfaceGlDrawOptions {
  /** Column-major MVP built by `cameraMatrix`. */
  mvp: Float32Array;
  opacity: number;
  renderMode: 'surface' | 'wireframe' | 'both';
  light: [number, number, number];
  ambient: number;
  diffuse: number;
  meshColor: [number, number, number];
  meshWidth: number;
  background: string | null;
  /** Extra line segments (the XY floor projection), as world-space pairs. */
  floorLines?: Float32Array | null;
  floorColor?: [number, number, number];
}

export interface SurfaceGlRenderer {
  draw(options: SurfaceGlDrawOptions): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
  /** True while the context is alive and usable. */
  readonly alive: boolean;
}

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

export function createSurfaceGl(canvas: HTMLCanvasElement, geometry: SurfaceGeometry): SurfaceGlRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false, depth: true })
      ?? canvas.getContext('experimental-webgl', { antialias: true, alpha: true })) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const context = gl;
  const vertex = compile(context, context.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(context, context.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = context.createProgram();
  if (!vertex || !fragment || !program) return null;
  context.attachShader(program, vertex);
  context.attachShader(program, fragment);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) return null;
  context.useProgram(program);

  const positionBuffer = context.createBuffer();
  const indexBuffer = context.createBuffer();
  const lineBuffer = context.createBuffer();
  const floorBuffer = context.createBuffer();
  if (!positionBuffer || !indexBuffer || !lineBuffer || !floorBuffer) return null;
  context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
  context.bufferData(context.ARRAY_BUFFER, geometry.vertices, context.STATIC_DRAW);
  context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
  context.bufferData(context.ELEMENT_ARRAY_BUFFER, geometry.indices, context.STATIC_DRAW);
  context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, lineBuffer);
  context.bufferData(context.ELEMENT_ARRAY_BUFFER, geometry.lines, context.STATIC_DRAW);
  context.bindBuffer(context.ARRAY_BUFFER, floorBuffer);

  const aPos = context.getAttribLocation(program, 'aPos');
  const aNormal = context.getAttribLocation(program, 'aNormal');
  const aColor = context.getAttribLocation(program, 'aColor');
  const uMvp = context.getUniformLocation(program, 'uMvp');
  const uLight = context.getUniformLocation(program, 'uLight');
  const uAmbient = context.getUniformLocation(program, 'uAmbient');
  const uDiffuse = context.getUniformLocation(program, 'uDiffuse');
  const uOpacity = context.getUniformLocation(program, 'uOpacity');
  const uFlat = context.getUniformLocation(program, 'uFlat');
  const uFlatColor = context.getUniformLocation(program, 'uFlatColor');
  let alive = true;
  let width = 1;
  let height = 1;
  let dpr = 1;

  const bindVertexBuffer = () => {
    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    const stride = 9 * 4;
    context.enableVertexAttribArray(aPos);
    context.vertexAttribPointer(aPos, 3, context.FLOAT, false, stride, 0);
    context.enableVertexAttribArray(aNormal);
    context.vertexAttribPointer(aNormal, 3, context.FLOAT, false, stride, 3 * 4);
    context.enableVertexAttribArray(aColor);
    context.vertexAttribPointer(aColor, 3, context.FLOAT, false, stride, 6 * 4);
  };

  const draw = (options: SurfaceGlDrawOptions) => {
    if (!alive) return;
    context.viewport(0, 0, width, height);
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.enable(context.BLEND);
    context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
    context.useProgram(program);
    context.uniformMatrix4fv(uMvp, false, options.mvp);
    context.uniform3fv(uLight, options.light);
    context.uniform1f(uAmbient, options.ambient);
    context.uniform1f(uDiffuse, options.diffuse);
    bindVertexBuffer();
    if (options.renderMode !== 'wireframe' && geometry.indices.length) {
      context.uniform1f(uFlat, 0);
      context.uniform1f(uOpacity, options.opacity);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
      context.drawElements(context.TRIANGLES, geometry.indices.length, context.UNSIGNED_INT, 0);
    }
    if (options.renderMode !== 'surface' && geometry.lines.length) {
      context.uniform1f(uFlat, 1);
      context.uniform3fv(uFlatColor, options.meshColor);
      context.uniform1f(uOpacity, options.renderMode === 'wireframe' ? 0.85 : 0.45);
      context.lineWidth(options.meshWidth);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, lineBuffer);
      context.drawElements(context.LINES, geometry.lines.length, context.UNSIGNED_INT, 0);
    }
    if (options.floorLines && options.floorLines.length) {
      // Floor lines come as raw world-space pairs: they are rebuilt when the
      // surface changes, so a dynamic buffer keeps that cheap.
      context.bindBuffer(context.ARRAY_BUFFER, floorBuffer);
      context.bufferData(context.ARRAY_BUFFER, options.floorLines, context.DYNAMIC_DRAW);
      context.disableVertexAttribArray(aNormal);
      context.disableVertexAttribArray(aColor);
      context.vertexAttribPointer(aPos, 3, context.FLOAT, false, 0, 0);
      context.uniform1f(uFlat, 1);
      context.uniform3fv(uFlatColor, options.floorColor ?? options.meshColor);
      context.uniform1f(uOpacity, 0.6);
      context.lineWidth(1);
      context.drawArrays(context.LINES, 0, options.floorLines.length / 3);
    }
    // Nothing reads dpr after the resize; keeping the reference avoids a
    // "declared but never read" build error and documents the backing store.
    void dpr;
  };

  return {
    draw,
    resize(nextWidth: number, nextHeight: number, nextDpr: number) {
      width = Math.max(1, Math.round(nextWidth * nextDpr));
      height = Math.max(1, Math.round(nextHeight * nextDpr));
      dpr = nextDpr;
      canvas.width = width;
      canvas.height = height;
      if (!alive) return;
      context.viewport(0, 0, width, height);
    },
    dispose() {
      alive = false;
      try {

        context.deleteBuffer(positionBuffer);
        context.deleteBuffer(indexBuffer);
        context.deleteBuffer(lineBuffer);
        context.deleteBuffer(floorBuffer);
        context.deleteProgram(program);
        context.deleteShader(vertex);
        context.deleteShader(fragment);
        const lose = context.getExtension('WEBGL_lose_context');
        lose?.loseContext();
      } catch {
        /* a lost context is already gone */
      }
    },
    get alive() {
      return alive;
    },
    // Kept for diagnostics: the actual backing-store size.
    get size() {
      return { width, height, dpr };
    },
  } as SurfaceGlRenderer;
}
