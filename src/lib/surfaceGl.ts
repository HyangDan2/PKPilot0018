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
  /** Re-upload a new mesh into the same context (a new grid, a new style). */
  setGeometry(geometry: SurfaceGeometry): boolean;
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
  // A canvas keeps ONE context for its lifetime: if the previous renderer lost
  // it, this canvas can never draw again and the caller must fall back.
  if (context.isContextLost?.()) return null;
  const vertex = compile(context, context.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(context, context.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = context.createProgram();
  if (!vertex || !fragment || !program) return null;
  context.attachShader(program, vertex);
  context.attachShader(program, fragment);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) return null;
  context.useProgram(program);

  // WebGL 1 indices are 16-bit unless OES_element_index_uint is present. A
  // 401×401 grid has 160 801 vertices, so the extension decides whether this
  // canvas can draw the mesh at all; without it the caller falls back to the
  // static projection instead of showing an empty box.
  const uintIndices = context.getExtension('OES_element_index_uint');
  const indexType = uintIndices ? context.UNSIGNED_INT : context.UNSIGNED_SHORT;
  const vertexCount = geometry.vertices.length / 9;
  if (!uintIndices && vertexCount > 65535) return null;
  const triangleIndexData = uintIndices ? geometry.indices : Uint16Array.from(geometry.indices);
  const lineIndexData = uintIndices ? geometry.lines : Uint16Array.from(geometry.lines);

  const positionBuffer = context.createBuffer();
  const indexBuffer = context.createBuffer();
  const lineBuffer = context.createBuffer();
  const floorBuffer = context.createBuffer();
  if (!positionBuffer || !indexBuffer || !lineBuffer || !floorBuffer) return null;

  /* WebGL binds a buffer object to one target for its lifetime: asking for the
     other target is INVALID_OPERATION, and the bufferData that follows is
     dropped. The vertex data therefore goes through ARRAY_BUFFER and the two
     index buffers through ELEMENT_ARRAY_BUFFER — always, at creation and on
     every re-upload. */
  const drainErrors = () => { while (context.getError() !== context.NO_ERROR) { /* clear the queue */ } };
  const uploadArray = (target: WebGLBuffer, data: ArrayBufferView): boolean => {
    context.bindBuffer(context.ARRAY_BUFFER, target);
    context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
    return context.getError() === context.NO_ERROR;
  };
  const uploadElement = (target: WebGLBuffer, data: ArrayBufferView): boolean => {
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, target);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, data, context.STATIC_DRAW);
    return context.getError() === context.NO_ERROR;
  };
  drainErrors();
  const uploaded = uploadArray(positionBuffer, geometry.vertices)
    && uploadElement(indexBuffer, triangleIndexData)
    && uploadElement(lineBuffer, lineIndexData);
  // A buffer that did not take its data would draw garbage or an empty box;
  // the caller falls back to the static projection instead.
  if (!uploaded) return null;
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
  let triangleCount = geometry.indices.length;
  let lineCount = geometry.lines.length;
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
    if (options.renderMode !== 'wireframe' && triangleCount) {
      context.uniform1f(uFlat, 0);
      context.uniform1f(uOpacity, options.opacity);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
      context.drawElements(context.TRIANGLES, triangleCount, indexType, 0);
    }
    if (options.renderMode !== 'surface' && lineCount) {
      context.uniform1f(uFlat, 1);
      context.uniform3fv(uFlatColor, options.meshColor);
      context.uniform1f(uOpacity, options.renderMode === 'wireframe' ? 0.85 : 0.45);
      context.lineWidth(options.meshWidth);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, lineBuffer);
      context.drawElements(context.LINES, lineCount, indexType, 0);
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
    setGeometry(next: SurfaceGeometry) {
      if (!alive) return false;
      const nextVertexCount = next.vertices.length / 9;
      if (!uintIndices && nextVertexCount > 65535) return false;
      drainErrors();
      // Each buffer keeps the target it was created for: the vertex data goes
      // through ARRAY_BUFFER, the two index lists through ELEMENT_ARRAY_BUFFER.
      const ok = uploadArray(positionBuffer, next.vertices)
        && uploadElement(indexBuffer, uintIndices ? next.indices : Uint16Array.from(next.indices))
        && uploadElement(lineBuffer, uintIndices ? next.lines : Uint16Array.from(next.lines));
      if (!ok) return false;
      triangleCount = next.indices.length;
      lineCount = next.lines.length;
      return true;
    },
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
        // The context itself is NOT lost here: the same canvas is reused when
        // new geometry arrives (a resolution change, a new grid), and a lost
        // context cannot be revived, so releasing it would turn the next
        // render into a silent fallback.
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
