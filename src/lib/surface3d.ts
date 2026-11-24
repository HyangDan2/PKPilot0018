/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — 3D surface geometry and painting (WO-03)

   Two renderers share one description of the picture:

   · `buildSurfaceGeometry` turns a Z grid into world-space vertices, smooth
     normals, per-vertex colours and index buffers. The WebGL canvas draws it
     interactively (`Surface3DView`).
   · `surfaceSvgBody` paints the same geometry with a painter's algorithm into
     SVG. It is the static projection used when WebGL is unavailable, and the
     one every export path (SVG, PNG, print) goes through — an exported figure
     never depends on a GPU.

   Zero dependencies and no network: the colour maps come from contour.ts, the
   matrix maths is here, and nothing is fetched at run time.
   ───────────────────────────────────────────────────────────────────────── */

import type { SurfaceProjection, SurfaceViewConfig } from './chartConfig';
import { marchingSquares, sampleColormap, stitchSegments } from './contour';
import type { ContourColormap } from './chartConfig';

/** Grid points per axis for each resolution preset (WO-03). */
export const SURFACE_RESOLUTIONS = { draft: 41, standard: 101, high: 201, ultra: 401 } as const;

/**
 * The highest grid the surface engine will build.
 *
 * Ultra is 401×401 = 160 801 vertices: about 10 MB of vertex data plus a
 * 3.8 MB index buffer, which every WebGL 1 implementation accepts. Nothing
 * larger is offered, so a hostile project file cannot ask for a gigabyte.
 */
export const SURFACE_MAX_GRID = 401;

export const SURFACE_MESH_MAX_GRID = 121;

export function surfaceResolutionPoints(resolution: string | undefined): number {
  switch (resolution) {
    case 'draft': return SURFACE_RESOLUTIONS.draft;
    case 'high': return SURFACE_RESOLUTIONS.high;
    case 'ultra': return SURFACE_RESOLUTIONS.ultra;
    case 'standard':
    default: return SURFACE_RESOLUTIONS.standard;
  }
}

export interface SurfaceGrid {
  xs: number[];
  ys: number[];
  /** z[j][i] at (xs[i], ys[j]); NaN where the model cannot predict. */
  z: number[][];
}

export interface SurfaceExtent {
  zMin: number;
  zMax: number;
}

/** Finite extent of a grid without spreading 160k numbers onto the stack. */
export function surfaceExtent(grid: SurfaceGrid): SurfaceExtent {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const row of grid.z) {
    for (const value of row) {
      if (!Number.isFinite(value)) continue;
      if (value < zMin) zMin = value;
      if (value > zMax) zMax = value;
    }
  }
  return Number.isFinite(zMin) ? { zMin, zMax } : { zMin: 0, zMax: 0 };
}

/* ── camera ───────────────────────────────────────────────────────────── */

export interface SurfaceCameraBasis {
  /** Where the eye stands, in world units (the box is ±1 in x/y). */
  eye: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  distance: number;
  /** Pixels per world unit at the origin for this zoom. */
  unit: number;
  width: number;
  height: number;
}

export interface ProjectedPoint {
  /** Canvas pixel coordinates. */
  x: number;
  y: number;
  /** Distance along the view direction; larger is farther away. */
  depth: number;
  /** False when the point sits behind the eye (never drawn). */
  visible: boolean;
}

const CAMERA_DISTANCE = 4.2;

const sub = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: [number, number, number], b: [number, number, number]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: [number, number, number]): [number, number, number] => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/**
 * Camera basis for an azimuth / elevation pair.
 *
 * The world is Z-up: azimuth 0 looks along −X from +X, and elevation lifts the
 * eye above the XY plane. The up vector is clamped short of the pole so a
 * top view has a defined screen direction instead of a degenerate cross
 * product.
 */
export function cameraBasis(
  camera: { azimuth: number; elevation: number; zoom: number; panX: number; panY: number },
  projection: SurfaceProjection,
  width: number,
  height: number,
): SurfaceCameraBasis {
  const azimuth = (camera.azimuth * Math.PI) / 180;
  const elevation = (Math.max(2, Math.min(89, camera.elevation)) * Math.PI) / 180;
  const direction: [number, number, number] = [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
  ];
  const distance = projection === 'perspective' ? CAMERA_DISTANCE : CAMERA_DISTANCE;
  const eye: [number, number, number] = [direction[0] * distance, direction[1] * distance, direction[2] * distance];
  const forward = normalize([-direction[0], -direction[1], -direction[2]]);
  const worldUp: [number, number, number] = [0, 0, 1];
  let right = cross(forward, worldUp);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-9) right = [1, 0, 0];
  right = normalize(right);
  const up = normalize(cross(right, forward));
  const unit = (Math.min(width, height) / 2) * 0.9 * camera.zoom;
  return { eye, right, up, forward, distance, unit, width, height };
}

/** Project one world point to canvas pixels with the same maths the shader uses. */
export function projectPoint(
  point: [number, number, number],
  basis: SurfaceCameraBasis,
  projection: SurfaceProjection,
  camera: { panX: number; panY: number },
): ProjectedPoint {
  const relative = sub(point, basis.eye);
  const cx = dot(relative, basis.right);
  const cy = dot(relative, basis.up);
  const cz = dot(relative, basis.forward);
  const centerX = basis.width / 2 + camera.panX * basis.width * 0.5;
  const centerY = basis.height / 2 - camera.panY * basis.height * 0.5;
  if (projection === 'orthographic') {
    return {
      x: centerX + cx * 0.55 * basis.unit,
      y: centerY - cy * 0.55 * basis.unit,
      depth: cz,
      visible: true,
    };
  }
  if (cz <= 0.05) return { x: centerX, y: centerY, depth: cz, visible: false };
  const scale = (0.55 * CAMERA_DISTANCE) / cz;
  return { x: centerX + cx * scale * basis.unit, y: centerY - cy * scale * basis.unit, depth: cz, visible: true };
}

/**
 * Column-major 4×4 matrix for WebGL that reproduces `projectPoint`.
 *
 * clip = M · [p, 1]; the perspective divide by w reproduces the same screen
 * position, which is what keeps the canvas and the exported SVG aligned.
 */
export function cameraMatrix(
  basis: SurfaceCameraBasis,
  projection: SurfaceProjection,
  camera: { panX: number; panY: number },
  aspect: { width: number; height: number },
): Float32Array {
  const { right, up, forward, eye } = basis;
  const sx = (2 * basis.unit) / Math.max(1, aspect.width);
  const sy = (2 * basis.unit) / Math.max(1, aspect.height);
  // Pan is a translation applied after the divide; expressed in clip space it is
  // the fraction of the half-viewport the eye moved.
  const panX = camera.panX;
  const panY = camera.panY;
  if (projection === 'orthographic') {
    const rows = [
      [sx * 0.55 * right[0], sx * 0.55 * right[1], sx * 0.55 * right[2], -sx * 0.55 * dot(right, eye) + panX],
      [sy * 0.55 * up[0], sy * 0.55 * up[1], sy * 0.55 * up[2], -sy * 0.55 * dot(up, eye) + panY],
      // z_ndc = c·depth + d, monotonic over the box: the depth test orders faces.
      [0.3 * forward[0], 0.3 * forward[1], 0.3 * forward[2], -0.3 * dot(forward, eye) - 1],
      [0, 0, 0, 1],
    ];
    return toColumnMajor(rows);
  }
  const k = 0.55 * CAMERA_DISTANCE;
  // Near / far in world units; z_ndc = a + b / depth keeps the depth buffer
  // monotonic in exactly the range the box occupies.
  const near = 0.5;
  const far = 15;
  const a = (far + near) / (far - near);
  const b = (-2 * far * near) / (far - near);
  const rows = [
    // Pan is added inside w so it shifts the picture by the same amount at every depth.
    [k * sx * right[0] + panX * forward[0], k * sx * right[1] + panX * forward[1], k * sx * right[2] + panX * forward[2], -k * sx * dot(right, eye) - panX * dot(forward, eye)],
    [k * sy * up[0] + panY * forward[0], k * sy * up[1] + panY * forward[1], k * sy * up[2] + panY * forward[2], -k * sy * dot(up, eye) - panY * dot(forward, eye)],
    [a * forward[0], a * forward[1], a * forward[2], -a * dot(forward, eye) + b],
    [forward[0], forward[1], forward[2], -dot(forward, eye)],
  ];
  return toColumnMajor(rows);
}

function toColumnMajor(rows: number[][]): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) out[c * 4 + r] = rows[r][c];
  }
  return out;
}

/* ── geometry ─────────────────────────────────────────────────────────── */

export interface SurfaceGeometryOptions {
  colormap?: ContourColormap;
  zMin?: number;
  zMax?: number;
  zScale?: number;
  meshDensity?: number;
  /** Include the wireframe index buffer (a wireframe-only view needs it). */
  includeLines?: boolean;
}

export interface SurfaceGeometry {
  grid: SurfaceGrid;
  /** Vertex grid size. */
  nx: number;
  ny: number;
  /** Interleaved position(3) + normal(3) + colour(3) per vertex. */
  vertices: Float32Array;
  /** Triangle indices; cells with a non-finite corner are left out. */
  indices: Uint32Array;
  /** Line indices for the mesh at `meshDensity`. */
  lines: Uint32Array;
  /** World box the surface occupies. */
  box: { x: [number, number]; y: [number, number]; z: [number, number] };
  zMin: number;
  zMax: number;
  /** Cell count actually drawn (a NaN cell is not a face). */
  faces: number;
}

const Z_HALF = 0.45;

/** World position of grid node (i, j). */
export function nodeWorld(
  i: number,
  j: number,
  grid: SurfaceGrid,
  zMin: number,
  zMax: number,
  zScale: number,
): [number, number, number] {
  const nx = grid.xs.length;
  const ny = grid.ys.length;
  const x = nx > 1 ? (i / (nx - 1)) * 2 - 1 : 0;
  const y = ny > 1 ? (j / (ny - 1)) * 2 - 1 : 0;
  const value = grid.z[j]?.[i];
  const t = Number.isFinite(value) && zMax > zMin ? ((value as number) - zMin) / (zMax - zMin) : 0.5;
  return [x, y, (t - 0.5) * 2 * Z_HALF * zScale];
}

/**
 * Build the drawable mesh.
 *
 * Normals are the accumulated face normals (smooth shading), so a ridge is a
 * ridge rather than a facet. A cell with any NaN corner produces no triangle
 * and no mesh edge: a masked prediction must not be painted as a plane.
 */
export function buildSurfaceGeometry(grid: SurfaceGrid, options: SurfaceGeometryOptions = {}): SurfaceGeometry {
  const { xs, ys } = grid;
  const nx = xs.length;
  const ny = ys.length;
  const extent = surfaceExtent(grid);
  const zMin = Number.isFinite(options.zMin) ? (options.zMin as number) : extent.zMin;
  const zMax = Number.isFinite(options.zMax) ? (options.zMax as number) : extent.zMax;
  // A constant surface has no extent; give it a flat middle plane.
  const lo = zMax > zMin ? zMin : zMin - 0.5;
  const hi = zMax > zMin ? zMax : zMax + 0.5;
  const zScale = Number.isFinite(options.zScale) && (options.zScale as number) > 0 ? (options.zScale as number) : 1;
  const colormap = options.colormap ?? 'sigrun-classic';
  const meshDensity = Math.max(1, Math.round(options.meshDensity ?? 8));
  const includeLines = options.includeLines !== false;
  const vertices = new Float32Array(nx * ny * 9);
  const positions: [number, number, number][] = new Array(nx * ny);
  const colors: [number, number, number][] = new Array(nx * ny);
  const normals: [number, number, number][] = new Array(nx * ny).fill([0, 0, 1]);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const world = nodeWorld(i, j, grid, lo, hi, zScale);
      const index = j * nx + i;
      positions[index] = world;
      const value = grid.z[j]?.[i];
      const t = Number.isFinite(value) ? ((value as number) - lo) / (hi - lo || 1) : 0.5;
      colors[index] = hexToUnit(sampleColormap(colormap, t));
    }
  }
  // Face normals accumulated per vertex.
  const accum: [number, number, number][] = new Array(nx * ny).fill(null).map(() => [0, 0, 0]);
  const triangleIndices: number[] = [];
  let faces = 0;
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      const values = [grid.z[j]?.[i], grid.z[j]?.[i + 1], grid.z[j + 1]?.[i + 1], grid.z[j + 1]?.[i]];
      if (!values.every((value) => Number.isFinite(value))) continue;
      faces += 1;
      const triangles: [number, number, number][] = [[a, b, c], [a, c, d]];
      triangles.forEach(([p, q, r]) => {
        const normal = cross(sub(positions[q], positions[p]), sub(positions[r], positions[p]));
        [p, q, r].forEach((vertex) => {
          const target = accum[vertex];
          target[0] += normal[0];
          target[1] += normal[1];
          target[2] += normal[2];
        });
        triangleIndices.push(p, q, r);
      });
    }
  }
  const box: SurfaceGeometry['box'] = { x: [-1, 1], y: [-1, 1], z: [-Z_HALF * zScale, Z_HALF * zScale] };
  for (let index = 0; index < positions.length; index += 1) {
    const normal = accum[index];
    const length = Math.hypot(normal[0], normal[1], normal[2]);
    normals[index] = length > 1e-12 ? [normal[0] / length, normal[1] / length, normal[2] / length] : [0, 0, 1];
    const base = index * 9;
    vertices[base] = positions[index][0];
    vertices[base + 1] = positions[index][1];
    vertices[base + 2] = positions[index][2];
    vertices[base + 3] = normals[index][0];
    vertices[base + 4] = normals[index][1];
    vertices[base + 5] = normals[index][2];
    vertices[base + 6] = colors[index][0];
    vertices[base + 7] = colors[index][1];
    vertices[base + 8] = colors[index][2];
  }
  // Mesh lines: every `meshDensity`-th row and column, split where a cell is masked.
  const lineIndices: number[] = [];
  if (includeLines) {
    for (let j = 0; j < ny; j += meshDensity) {
      for (let i = 0; i < nx - 1; i += 1) {
        const v0 = grid.z[j]?.[i];
        const v1 = grid.z[j]?.[i + 1];
        if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
        lineIndices.push(j * nx + i, j * nx + i + 1);
      }
    }
    for (let i = 0; i < nx; i += meshDensity) {
      for (let j = 0; j < ny - 1; j += 1) {
        const v0 = grid.z[j]?.[i];
        const v1 = grid.z[j + 1]?.[i];
        if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
        lineIndices.push(j * nx + i, (j + 1) * nx + i);
      }
    }
  }
  return {
    grid,
    nx,
    ny,
    vertices,
    indices: new Uint32Array(triangleIndices),
    lines: new Uint32Array(lineIndices),
    box,
    zMin: lo,
    zMax: hi,
    faces,
  };
}

function hexToUnit(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  const value = (offset: number) => parseInt(full.slice(offset, offset + 2), 16) / 255;
  return [value(0) || 0, value(2) || 0, value(4) || 0];
}

/** The shading multiplier a face receives, in the painter and in the shader. */
export function shadeFactor(
  normal: [number, number, number],
  config: Pick<SurfaceViewConfig, 'lighting' | 'lightAzimuth' | 'lightElevation' | 'ambient' | 'diffuse'>,
): number {
  if (!config.lighting) return 1;
  const azimuth = (config.lightAzimuth * Math.PI) / 180;
  const elevation = (config.lightElevation * Math.PI) / 180;
  const light: [number, number, number] = [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
  ];
  const lambert = Math.max(0, dot(normalize(normal), light));
  return Math.max(0.05, config.ambient + config.diffuse * lambert);
}

export function lightDirection(config: Pick<SurfaceViewConfig, 'lightAzimuth' | 'lightElevation'>): [number, number, number] {
  const azimuth = (config.lightAzimuth * Math.PI) / 180;
  const elevation = (config.lightElevation * Math.PI) / 180;
  return [
    Math.cos(elevation) * Math.cos(azimuth),
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
  ];
}

/* ── static SVG painting ──────────────────────────────────────────────── */

export interface SurfacePaintStyle {
  surface: string;
  plot: string;
  ink: string;
  label: string;
  grid: string;
  alarm: string;
  fontFamily: string;
  mono: string;
}

export interface SurfacePaintInput {
  grid: SurfaceGrid;
  config: SurfaceViewConfig;
  style: SurfacePaintStyle;
  width: number;
  height: number;
  xLabel: string;
  yLabel: string;
  zLabel: string;
  points?: { x: number; y: number; z?: number; label?: string; kind?: 'design' | 'stationary' | 'optimal' }[];
  xRange?: [number, number];
  yRange?: [number, number];
  /** Which levels the floor projection draws, in data units. */
  floorLevels?: number[];
  /** Painted when the environment cannot use WebGL. */
  fallbackNotice?: string;
  /**
   * Draw only what sits on top of the surface (box, labels, points). The WebGL
   * canvas draws the surface itself, and this frame is layered over it — the
   * same code decides where a label goes in both renderers.
   */
  frameOnly?: boolean;
}

const f1 = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : '0');

/**
 * Paint the surface as SVG with a painter's algorithm.
 *
 * Quads are sorted far-to-near and filled with their shaded colour, so the
 * nearest ridge hides the valley behind it. The grid is decimated to at most
 * `SURFACE_MESH_MAX_GRID` samples per axis: a 401² grid would emit 160k paths,
 * which no browser prints or exports in a useful time, and the decimated
 * picture is what the fallback claims to be (a static projection).
 */
export function surfaceSvgBody(input: SurfacePaintInput): string {
  const { grid, config, style, width, height } = input;
  if (grid.xs.length < 2 || grid.ys.length < 2) return '';
  const step = Math.max(1, Math.ceil(Math.max(grid.xs.length, grid.ys.length) / SURFACE_MESH_MAX_GRID));
  const sampled: SurfaceGrid = step === 1 ? grid : {
    xs: grid.xs.filter((_, i) => i % step === 0 || i === grid.xs.length - 1),
    ys: grid.ys.filter((_, j) => j % step === 0 || j === grid.ys.length - 1),
    z: grid.z.filter((_, j) => j % step === 0 || j === grid.ys.length - 1).map((row) => row.filter((_, i) => i % step === 0 || i === grid.xs.length - 1)),
  };
  const geometry = buildSurfaceGeometry(sampled, {
    colormap: config.colormap,
    zScale: config.zScale,
    meshDensity: Math.max(1, Math.round(config.meshDensity / step)),
    includeLines: config.renderMode !== 'surface',
  });
  const basis = cameraBasis(config.camera, config.projection, width, height);
  const project = (point: [number, number, number]) => projectPoint(point, basis, config.projection, config.camera);
  const box = geometry.box;

  let out = '';
  const frameOnly = input.frameOnly === true;
  // Background inside the frame keeps the box legible in white exports.
  if (!frameOnly && config.background !== 'surface') {
    const fill = config.background === 'dark' ? '#101322' : '#ffffff';
    out += `<rect data-chart-role="plot" x="0" y="0" width="${f1(width)}" height="${f1(height)}" fill="${fill}" opacity="0.001"/>`;
  }

  // The three rear faces of the box, painted as a faint floor and walls.
  const floor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => project([x, y, box.z[0]]));
  if (!frameOnly) {
    out += `<path data-chart-role="surface-floor" d="M${floor.map((p) => `${f1(p.x)} ${f1(p.y)}`).join('L')}Z" fill="${style.grid}" opacity="0.18" stroke="none"/>`;
  }

  if (!frameOnly && config.showFloorContours) {
    const levelCount = Math.max(2, Math.min(20, Math.round(config.floorLevelCount)));
    const zLo = input.grid.z.flat().filter((value) => Number.isFinite(value)).reduce((acc, value) => Math.min(acc, value), Infinity);
    const zHi = input.grid.z.flat().filter((value) => Number.isFinite(value)).reduce((acc, value) => Math.max(acc, value), -Infinity);
    if (Number.isFinite(zLo) && Number.isFinite(zHi) && zHi > zLo) {
      const levels = Array.from({ length: levelCount - 1 }, (_, i) => zLo + ((zHi - zLo) * (i + 1)) / levelCount);
      out += '<g data-chart-role="surface-floor-contours">';
      levels.forEach((level) => {
        // The same marching-squares engine the 2D contour uses: a floor line
        // and the contour drawn above it can never disagree about the grid.
        const lines = stitchSegments(marchingSquares(grid, level), 2);
        const path = lines
          .map((line) => {
            const mapped = line.points.map((node) => {
              const point: [number, number, number] = [node.x, node.y, box.z[0] + 0.002];
              const p = project(point);
              return `${f1(p.x)} ${f1(p.y)}`;
            });
            return mapped.length > 1 ? `M${mapped.join('L')}` : '';
          })
          .join('');
        if (path) out += `<path d="${path}" fill="none" stroke="${style.ink}" stroke-width="0.5" opacity="0.5"/>`;
      });
      out += '</g>';
    }
  }

  /* The surface itself: sort cells by mean depth, far to near. */
  const nx = geometry.nx;
  const ny = geometry.ny;
  const nodeScreen: ProjectedPoint[] = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const index = (j * nx + i) * 9;
      const world: [number, number, number] = [geometry.vertices[index], geometry.vertices[index + 1], geometry.vertices[index + 2]];
      nodeScreen.push(project(world));
    }
  }
  interface Quad { depth: number; points: ProjectedPoint[]; color: string; center: [number, number, number]; surfaceType?: string }
  const quads: Quad[] = [];
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = a + nx;
      const values = [sampled.z[j]?.[i], sampled.z[j]?.[i + 1], sampled.z[j + 1]?.[i + 1], sampled.z[j + 1]?.[i]];
      if (!values.every((value) => Number.isFinite(value))) continue;
      const screen = [nodeScreen[a], nodeScreen[b], nodeScreen[c], nodeScreen[d]];
      if (screen.some((p) => !p.visible)) continue;
      const centerWorld: [number, number, number] = [0, 0, 0];
      [a, b, c, d].forEach((vertex) => {
        centerWorld[0] += geometry.vertices[vertex * 9] / 4;
        centerWorld[1] += geometry.vertices[vertex * 9 + 1] / 4;
        centerWorld[2] += geometry.vertices[vertex * 9 + 2] / 4;
      });
      const normal: [number, number, number] = [
        (geometry.vertices[a * 9 + 3] + geometry.vertices[b * 9 + 3] + geometry.vertices[c * 9 + 3] + geometry.vertices[d * 9 + 3]) / 4,
        (geometry.vertices[a * 9 + 4] + geometry.vertices[b * 9 + 4] + geometry.vertices[c * 9 + 4] + geometry.vertices[d * 9 + 4]) / 4,
        (geometry.vertices[a * 9 + 5] + geometry.vertices[b * 9 + 5] + geometry.vertices[c * 9 + 5] + geometry.vertices[d * 9 + 5]) / 4,
      ];
      const value = (values[0]! + values[1]! + values[2]! + values[3]!) / 4;
      const t = (value - geometry.zMin) / (geometry.zMax - geometry.zMin || 1);
      const base = hexToUnit(sampleColormap(config.colormap, t));
      const shade = shadeFactor(normal, config);
      const color = rgbToHex(base[0] * shade, base[1] * shade, base[2] * shade);
      quads.push({
        depth: (screen[0].depth + screen[1].depth + screen[2].depth + screen[3].depth) / 4,
        points: screen,
        color,
        center: centerWorld,
      });
    }
  }
  quads.sort((a, b) => b.depth - a.depth);
  if (!frameOnly && config.renderMode !== 'wireframe') {
    out += `<g data-chart-role="surface-faces" opacity="${config.opacity.toFixed(2)}">`;
    quads.forEach((quad) => {
      out += `<path d="M${quad.points.map((p) => `${f1(p.x)} ${f1(p.y)}`).join('L')}Z" fill="${quad.color}" stroke="${quad.color}" stroke-width="0.35" stroke-linejoin="round"/>`;
    });
    out += '</g>';
  }
  if (!frameOnly && config.renderMode !== 'surface' && config.meshLineWidth > 0) {
    out += `<g data-chart-role="surface-mesh" fill="none" stroke="${style.ink}" stroke-width="${config.meshLineWidth.toFixed(2)}" opacity="${config.renderMode === 'wireframe' ? 0.85 : 0.42}" stroke-linejoin="round">`;
    const density = Math.max(1, Math.round(config.meshDensity / step));
    for (let j = 0; j < ny; j += density) {
      let path = '';
      let open = false;
      for (let i = 0; i < nx; i += 1) {
        const screen = nodeScreen[j * nx + i];
        const value = sampled.z[j]?.[i];
        if (!screen.visible || !Number.isFinite(value)) { open = false; continue; }
        path += `${open ? 'L' : 'M'}${f1(screen.x)} ${f1(screen.y)}`;
        open = true;
      }
      if (path) out += `<path d="${path}"/>`;
    }
    for (let i = 0; i < nx; i += density) {
      let path = '';
      let open = false;
      for (let j = 0; j < ny; j += 1) {
        const screen = nodeScreen[j * nx + i];
        const value = sampled.z[j]?.[i];
        if (!screen.visible || !Number.isFinite(value)) { open = false; continue; }
        path += `${open ? 'L' : 'M'}${f1(screen.x)} ${f1(screen.y)}`;
        open = true;
      }
      if (path) out += `<path d="${path}"/>`;
    }
    out += '</g>';
  }

  /* Box edges and axis labels. */
  if (config.showAxes) {
    out += `<g data-chart-role="surface-axes" fill="none" stroke="${style.ink}" stroke-width="0.8" opacity="0.75">`;
    const edges: [number, number, number][][] = [
      [[-1, -1, box.z[0]], [1, -1, box.z[0]]],
      [[1, -1, box.z[0]], [1, 1, box.z[0]]],
      [[1, 1, box.z[0]], [-1, 1, box.z[0]]],
      [[-1, 1, box.z[0]], [-1, -1, box.z[0]]],
      [[-1, -1, box.z[1]], [1, -1, box.z[1]]],
      [[1, -1, box.z[1]], [1, 1, box.z[1]]],
      [[1, 1, box.z[1]], [-1, 1, box.z[1]]],
      [[-1, 1, box.z[1]], [-1, -1, box.z[1]]],
      [[-1, -1, box.z[0]], [-1, -1, box.z[1]]],
      [[1, -1, box.z[0]], [1, -1, box.z[1]]],
      [[1, 1, box.z[0]], [1, 1, box.z[1]]],
      [[-1, 1, box.z[0]], [-1, 1, box.z[1]]],
    ];
    edges.forEach(([from, to]) => {
      const a = project(from);
      const b = project(to);
      out += `<path d="M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}"/>`;
    });
    out += '</g>';
    const xRange = input.xRange ?? [grid.xs[0], grid.xs[grid.xs.length - 1]];
    const yRange = input.yRange ?? [grid.ys[0], grid.ys[grid.ys.length - 1]];
    out += `<g data-chart-role="surface-axis-labels" font-family="${style.mono}" font-size="7.4" fill="${style.label}">`;
    ticksOf(xRange, 5).forEach((tick) => {
      const p = project([tick.t, -1, box.z[0]]);
      out += `<text x="${f1(p.x)}" y="${f1(p.y + 10)}" text-anchor="middle">${escapeText(tick.label)}</text>`;
    });
    ticksOf(yRange, 5).forEach((tick) => {
      const p = project([1, tick.t, box.z[0]]);
      out += `<text x="${f1(p.x + 5)}" y="${f1(p.y + 3)}" text-anchor="start">${escapeText(tick.label)}</text>`;
    });
    ticksOf([geometry.zMin, geometry.zMax], 4).forEach((tick) => {
      const p = project([1, -1, box.z[0] + (box.z[1] - box.z[0]) * tick.t]);
      out += `<text x="${f1(p.x + 5)}" y="${f1(p.y + 3)}" text-anchor="start">${escapeText(tick.label)}</text>`;
    });
    const xTitlePoint = project([0, -1.18, box.z[0]]);
    const yTitlePoint = project([1.18, 0, box.z[0]]);
    const zTitlePoint = project([1, -1, box.z[1] + 0.12]);
    out += `<text x="${f1(xTitlePoint.x)}" y="${f1(xTitlePoint.y + 6)}" text-anchor="middle" font-size="8.6">${escapeText(input.xLabel)}</text>`;
    out += `<text x="${f1(yTitlePoint.x + 8)}" y="${f1(yTitlePoint.y)}" text-anchor="start" font-size="8.6">${escapeText(input.yLabel)}</text>`;
    out += `<text x="${f1(zTitlePoint.x + 4)}" y="${f1(zTitlePoint.y - 4)}" text-anchor="start" font-size="8.6">${escapeText(input.zLabel)}</text>`;
    out += '</g>';
  }

  /* Experiment runs, stationary and optimal markers. */
  if (config.showPoints && input.points?.length) {
    out += '<g data-chart-role="surface-points">';
    input.points.forEach((point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const value = Number.isFinite(point.z) ? (point.z as number) : geometry.zMin;
      const world: [number, number, number] = [
        grid.xs.length > 1 ? ((point.x - grid.xs[0]) / (grid.xs[grid.xs.length - 1] - grid.xs[0])) * 2 - 1 : 0,
        grid.ys.length > 1 ? ((point.y - grid.ys[0]) / (grid.ys[grid.ys.length - 1] - grid.ys[0])) * 2 - 1 : 0,
        box.z[0] + ((value - geometry.zMin) / (geometry.zMax - geometry.zMin || 1)) * (box.z[1] - box.z[0]),
      ];
      const screen = project(world);
      if (!screen.visible) return;
      if (point.kind === 'stationary' || point.kind === 'optimal') {
        const shape = point.kind === 'stationary' ? 'diamond' : 'cross';
        out += markerPath(shape, screen.x, screen.y, 5, style.ink, ` data-chart-role="chart-point" data-kind="${point.kind}" data-x="${point.x}" data-y="${point.y}"${Number.isFinite(point.z) ? ` data-z="${point.z}"` : ''}`);
        if (point.label) out += `<text x="${f1(screen.x + 7)}" y="${f1(screen.y - 5)}" font-family="${style.mono}" font-size="7.6" fill="${style.ink}">${escapeText(point.label)}</text>`;
      } else {
        out += `<circle data-chart-role="chart-point" data-x="${point.x}" data-y="${point.y}"${Number.isFinite(point.z) ? ` data-z="${point.z}"` : ''} cx="${f1(screen.x)}" cy="${f1(screen.y)}" r="2.4" fill="${style.surface}" stroke="${style.ink}" stroke-width="0.9"/>`;
      }
    });
    out += '</g>';
  }
  return out;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function markerPath(shape: 'diamond' | 'cross', x: number, y: number, size: number, color: string, extra = ''): string {
  if (shape === 'diamond') {
    return `<path d="M${f1(x)} ${f1(y - size)}L${f1(x + size)} ${f1(y)}L${f1(x)} ${f1(y + size)}L${f1(x - size)} ${f1(y)}Z" fill="${color}" stroke="${color}"${extra}/>`;
  }
  return `<path d="M${f1(x - size)} ${f1(y)}L${f1(x + size)} ${f1(y)}M${f1(x)} ${f1(y - size)}L${f1(x)} ${f1(y + size)}" stroke="${color}" stroke-width="1.8"${extra}/>`;
}

function ticksOf(range: [number, number], count: number): { t: number; label: string }[] {
  const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]];
  const span = hi - lo;
  const out: { t: number; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const fraction = count === 1 ? 0.5 : i / (count - 1);
    out.push({ t: fraction, label: formatNumber(lo + span * fraction, span) });
  }
  return out;
}

function formatNumber(value: number, span: number): string {
  if (!Number.isFinite(value)) return '—';
  const decimals = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  return value.toFixed(decimals);
}

/**
 * Camera presets. Top looks straight down, front/side stand on an axis, and
 * isometric is the 35° view every statistics text uses.
 */
export const SURFACE_VIEW_PRESETS: Record<'isometric' | 'top' | 'front' | 'side', { azimuth: number; elevation: number }> = {
  isometric: { azimuth: -55, elevation: 28 },
  top: { azimuth: 0, elevation: 89 },
  front: { azimuth: 0, elevation: 8 },
  side: { azimuth: -90, elevation: 8 },
};

/** The colourbar the 3D view and its export share. */
export function surfaceColorbarSvg(
  config: SurfaceViewConfig,
  style: SurfacePaintStyle,
  x: number,
  y: number,
  height: number,
  zMin: number,
  zMax: number,
  title: string,
  colormap: ContourColormap,
): string {
  if (!config.colorbar || !(zMax > zMin)) return '';
  const width = 12;
  let out = `<g data-chart-role="colorbar">`;
  const stops = Array.from({ length: 11 }, (_, i) => `<stop offset="${(i * 10).toFixed(0)}%" stop-color="${sampleColormap(colormap, i / 10)}"/>`).join('');
  out += `<defs><linearGradient id="sigrun-surface-bar" x1="0" x2="0" y1="1" y2="0">${stops}</linearGradient></defs>`;
  out += `<rect x="${f1(x)}" y="${f1(y)}" width="${width}" height="${f1(height)}" fill="url(#sigrun-surface-bar)" stroke="${style.grid}"/>`;
  ticksOf([0, 1], 5).forEach((tick) => {
    const value = zMin + (zMax - zMin) * tick.t;
    const py = y + height - height * tick.t;
    out += `<text x="${f1(x + width + 4)}" y="${f1(py + 3)}" font-family="${style.mono}" font-size="7.4" fill="${style.label}">${escapeText(formatNumber(value, zMax - zMin))}</text>`;
  });
  if (title) out += `<text x="${f1(x + 2)}" y="${f1(y - 5)}" font-family="${style.mono}" font-size="7.8" fill="${style.label}">${escapeText(title)}</text>`;
  out += '</g>';
  return out;
}
