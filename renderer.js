/**
 * WebGL2 2D Photometric Beam Ray Tracer
 *
 * Technique: Per-pixel ray marching in a fragment shader.
 * For each pixel on the floor grid, we:
 *   1. Compute angle from light to pixel relative to light direction
 *   2. Sample the photometric distribution at that angle
 *   3. Apply inverse-square falloff
 *   4. Test against wall segments (shadow rays)
 *   5. Apply source-size-based penumbra (soft shadows)
 *   6. Optional bounce pass via ping-pong FBOs
 */

// ============================================================
//  SHADERS
// ============================================================

const VERT_SHADER = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Main lighting pass — direct illumination
const FRAG_DIRECT = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

// View transform
uniform vec2 u_viewOffset;   // world-space center of view
uniform float u_viewScale;   // pixels per world-unit (meter)
uniform vec2 u_resolution;   // canvas size in pixels

// Light params
uniform vec2 u_lightPos;     // world-space
uniform float u_lightDir;    // radians, 0 = right, CCW
uniform float u_intensity;   // multiplier
uniform float u_peakCandela; // cd
uniform vec3 u_lightColor;   // RGB [0,1]

// Photometric distribution — 256-sample 1D texture
uniform sampler2D u_distTex;

// Source quality
uniform float u_sourceSize;  // [0,1] affects penumbra

// Walls: packed as vec4(x1,y1,x2,y2) up to 64 walls
uniform int u_wallCount;
uniform vec4 u_walls[64];
uniform int u_wallTypes[64];  // 0 = diffuse wall, 1 = mirror board
uniform float u_wallReflectances[64]; // per-wall reflectance

// Grid
uniform float u_gridScale;   // meters per grid cell
uniform bool u_showGrid;
uniform bool u_showLux;

// Overhead mount height (0 = in-plane, >0 = overhead pointing down)
uniform float u_mountHeight;
// Tilt from vertical: 0 = straight down, PI/2 = horizontal
uniform float u_tiltAngle;

// Converts UV to world position
vec2 uvToWorld(vec2 uv) {
  vec2 ndc = (uv - 0.5) * u_resolution / u_viewScale;
  ndc.y = -ndc.y; // flip Y: WebGL UV origin is bottom-left, screen is top-left
  return ndc + u_viewOffset;
}

// Sample photometric distribution: angle in radians from beam center -> intensity [0,1]
float sampleDist(float angleRad) {
  float angleDeg = abs(angleRad) * 57.2957795;
  float u = clamp(angleDeg / 180.0, 0.0, 1.0);
  float raw = texture(u_distTex, vec2(u, 0.5)).r;
  // Smooth spill: real lights don't hard-cut at the field angle.
  // Gaussian-ish decay models housing reflections, lens flare, ambient spill.
  float spill = exp(-angleDeg * angleDeg * 0.001) * 0.03;
  return raw + spill;
}

// Segment intersection: returns t along ray or -1
float segIntersect(vec2 ro, vec2 rd, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ao = ro - a;
  float denom = rd.x * ab.y - rd.y * ab.x;
  if (abs(denom) < 1e-8) return -1.0;
  float t = (ao.y * ab.x - ao.x * ab.y) / denom;
  float s = (ao.y * rd.x - ao.x * rd.y) / denom;
  if (t > 0.001 && s >= 0.0 && s <= 1.0) return t;
  return -1.0;
}

// Shadow test — hard shadow + one-sided analytical penumbra
// Center ray determines core shadow (always correct/opaque).
// Penumbra only softens the LIT side of shadow edges (no light leaks).
float shadowTest(vec2 origin, vec2 target, int skipW) {
  vec2 dir = target - origin;
  float dist = length(dir);
  if (dist < 0.001) return 1.0;
  vec2 rd = dir / dist;

  float srcR = u_sourceSize * 0.15; // source half-width in meters
  float shadow = 1.0;

  for (int w = 0; w < 64; w++) {
    if (w >= u_wallCount) break;
    if (w == skipW) continue;

    vec2 a = u_walls[w].xy;
    vec2 b = u_walls[w].zw;

    // Center ray test — this is ALWAYS authoritative for blocking
    float t = segIntersect(origin, rd, a, b);
    bool centerBlocked = (t > 0.001 && t < dist - 0.001);

    if (centerBlocked) {
      // Wall fully blocks center ray → shadow = 0, no penumbra leak
      shadow = 0.0;
      continue;
    }

    if (srcR < 0.005) continue; // hard source, center not blocked = fully lit

    // Center ray NOT blocked — check if a wall endpoint is close enough
    // to partially block the extended source (penumbra on lit side only)
    vec2 oa = a - origin;
    vec2 ob = b - origin;
    float dA = abs(oa.x * rd.y - oa.y * rd.x);
    float dB = abs(ob.x * rd.y - ob.y * rd.x);
    float projA = dot(oa, rd);
    float projB = dot(ob, rd);

    float nearD = srcR;
    if (projA > 0.0 && projA < dist && dA < srcR) nearD = min(nearD, dA);
    if (projB > 0.0 && projB < dist && dB < srcR) nearD = min(nearD, dB);

    if (nearD < srcR) {
      // Partial shadow: nearD=0 → half source blocked (0.5), nearD=srcR → fully lit (1.0)
      float lit = 0.5 + 0.5 * smoothstep(0.0, srcR, nearD);
      shadow = min(shadow, lit);
    }
  }

  return shadow;
}

// Reflect point across a line defined by two points
vec2 reflectPoint(vec2 p, vec2 a, vec2 b) {
  vec2 ab = normalize(b - a);
  vec2 ap = p - a;
  float proj = dot(ap, ab);
  vec2 closest = a + ab * proj;
  return 2.0 * closest - p;
}

// Reflect angle across a wall's normal
float reflectDir(float dir, vec2 a, vec2 b) {
  vec2 wallDir = normalize(b - a);
  vec2 wallNormal = vec2(-wallDir.y, wallDir.x);
  vec2 lightVec = vec2(cos(dir), sin(dir));
  vec2 reflected = lightVec - 2.0 * dot(lightVec, wallNormal) * wallNormal;
  return atan(reflected.y, reflected.x);
}

// Check if a point can "see" a wall segment (is within the mirror's extent)
bool canSeeMirror(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ap = p - a;
  float t = dot(ap, ab) / dot(ab, ab);
  return t > -0.1 && t < 1.1; // small margin
}

void main() {
  vec2 worldPos = uvToWorld(v_uv);

  // Vector from light to this point (horizontal)
  vec2 toPoint = worldPos - u_lightPos;
  float dist2D = length(toPoint);

  float photIntensity;
  float falloff;

  if (u_mountHeight > 0.0) {
    // Overhead light at height h, tilted by tiltAngle from vertical
    // toward lightDir direction
    float h = u_mountHeight;
    float dist3D = sqrt(dist2D * dist2D + h * h);

    // 3D aim axis: (sin(tilt)*cos(dir), sin(tilt)*sin(dir), -cos(tilt))
    float sinTilt = sin(u_tiltAngle);
    float cosTilt = cos(u_tiltAngle);
    vec2 aimDir2D = vec2(cos(u_lightDir), sin(u_lightDir));

    // dot(aim3D, toPoint3D) where toPoint3D = (dx, dy, -h)
    float dotAV = sinTilt * dot(aimDir2D, toPoint) + cosTilt * h;

    // Photometric angle = angle between aim axis and vector to floor point
    float cosPhotAngle = clamp(dotAV / dist3D, -1.0, 1.0);
    float photAngle = acos(cosPhotAngle);

    photIntensity = sampleDist(photAngle);
    // Inverse square on 3D distance
    falloff = 1.0 / max(dist3D * dist3D, 0.01);
    // Lambert's cosine: floor incidence angle (h / dist3D)
    falloff *= h / dist3D;
  } else {
    // In-plane beam light (existing behavior)
    float pointAngle = atan(toPoint.y, toPoint.x);
    float relAngle = pointAngle - u_lightDir;
    relAngle = mod(relAngle + 3.14159265, 6.28318530) - 3.14159265;
    photIntensity = sampleDist(relAngle);
    falloff = 1.0 / max(dist2D * dist2D, 0.01);
  }

  // Shadow (2D wall occlusion — walls are vertical barriers)
  float shadow = shadowTest(u_lightPos, worldPos, -1);

  // Final illuminance (lux)
  float lux = u_peakCandela * u_intensity * photIntensity * falloff * shadow;

  // Mirror reflections — virtual light source for each mirror
  float mirrorLux = 0.0;
  for (int m = 0; m < 64; m++) {
    if (m >= u_wallCount) break;
    if (u_wallTypes[m] != 1) continue; // skip non-mirrors

    vec2 a = u_walls[m].xy;
    vec2 b = u_walls[m].zw;
    vec2 wallDir = normalize(b - a);
    vec2 wallNormal = vec2(-wallDir.y, wallDir.x);

    // Virtual light = reflection of real light across mirror line
    vec2 vLight = reflectPoint(u_lightPos, a, b);
    float vDir = reflectDir(u_lightDir, a, b);

    // Which side of the mirror is the pixel on?
    float pixelSide = dot(worldPos - a, wallNormal);
    float lightSide = dot(u_lightPos - a, wallNormal);

    // Mirror only reflects to the same side as the light
    if (pixelSide * lightSide < 0.0) continue;

    // Check that the ray from virtual light to pixel passes through the mirror segment
    vec2 vToP = worldPos - vLight;
    float vDist = length(vToP);
    if (vDist < 0.01) continue;
    vec2 vRd = vToP / vDist;

    // How close does the ray pass to the mirror segment?
    // Use parameter along mirror to soft-clip at mirror edges
    vec2 ab = b - a;
    float mirrorLen = length(ab);
    vec2 vToA = a - vLight;
    float denom = vRd.y * ab.x - vRd.x * ab.y;
    if (abs(denom) < 1e-8) continue;
    float sMirror = (vToA.y * vRd.x - vToA.x * vRd.y) / denom;
    float tMirror = (vToA.y * ab.x - vToA.x * ab.y) / denom;
    if (tMirror < 0.0) continue;

    // Soft edge falloff at mirror boundaries (instead of hard clip)
    float edgeSoftness = u_sourceSize * 0.1 / max(mirrorLen, 0.01);
    float mirrorMask = smoothstep(-edgeSoftness, edgeSoftness, sMirror)
                     * smoothstep(-edgeSoftness, edgeSoftness, 1.0 - sMirror);
    if (mirrorMask < 0.001) continue;

    // The virtual light's beam pattern
    float vPhotIntensity;
    float vFalloff;
    if (u_mountHeight > 0.0) {
      // Overhead with tilt: apply same 3D tilt math to virtual source
      float vh = u_mountHeight;
      float vDist3D = sqrt(vDist * vDist + vh * vh);
      float vSinTilt = sin(u_tiltAngle);
      float vCosTilt = cos(u_tiltAngle);
      vec2 vAimDir2D = vec2(cos(vDir), sin(vDir));
      float vDotAV = vSinTilt * dot(vAimDir2D, vToP) + vCosTilt * vh;
      float vCosPhot = clamp(vDotAV / vDist3D, -1.0, 1.0);
      vPhotIntensity = sampleDist(acos(vCosPhot));
      vFalloff = vh / (vDist3D * vDist3D * vDist3D);
    } else {
      float vAngle = atan(vToP.y, vToP.x);
      float vRelAngle = vAngle - vDir;
      vRelAngle = mod(vRelAngle + 3.14159265, 6.28318530) - 3.14159265;
      vPhotIntensity = sampleDist(vRelAngle);
      vFalloff = 1.0 / max(vDist * vDist, 0.01);
    }

    // Shadow tests: light → mirror, then mirror → pixel (not virtual light → pixel,
    // which traverses the virtual side and can be falsely occluded by real walls)
    vec2 mirrorPt = vLight + vRd * tMirror;
    float sToMirror = shadowTest(u_lightPos, mirrorPt, m);
    float vShadow = shadowTest(mirrorPt, worldPos, m);

    float refl = u_wallReflectances[m];
    mirrorLux += u_peakCandela * u_intensity * vPhotIntensity * vFalloff * vShadow * sToMirror * refl * mirrorMask;
  }

  // Store linear lux * light color in FBO (tone mapping happens in display pass)
  // Clamp to safe half-float range to prevent Inf/NaN in RGBA16F
  fragColor = vec4(min(u_lightColor * (lux + mirrorLux), vec3(60000.0)), 1.0);
}
`;

// Bounce lighting pass — half-res, Jacobi iteration
// Reads direct light (full res) + previous bounce (half res),
// outputs ONLY bounce contribution (not direct).
const FRAG_BOUNCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_directTex;   // full-res direct illumination (constant)
uniform sampler2D u_prevBounce;  // half-res previous bounce accumulation
uniform vec2 u_resolution;      // FULL canvas resolution (for coordinate mapping)
uniform vec2 u_viewOffset;
uniform float u_viewScale;
uniform float u_reflectance;

// Walls
uniform int u_wallCount;
uniform vec4 u_walls[64];
uniform int u_wallTypes[64]; // 0 = diffuse wall, 1 = mirror

vec2 uvToWorld(vec2 uv) {
  vec2 ndc = (uv - 0.5) * u_resolution / u_viewScale;
  ndc.y = -ndc.y;
  return ndc + u_viewOffset;
}

vec2 worldToUV(vec2 world) {
  vec2 ndc = (world - u_viewOffset) * u_viewScale / u_resolution;
  ndc.y = -ndc.y;
  return ndc + 0.5;
}

// Segment intersection for bounce occlusion
float segIntersectB(vec2 ro, vec2 rd, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ao = ro - a;
  float denom = rd.x * ab.y - rd.y * ab.x;
  if (abs(denom) < 1e-8) return -1.0;
  float t = (ao.y * ab.x - ao.x * ab.y) / denom;
  float s = (ao.y * rd.x - ao.x * rd.y) / denom;
  if (t > 0.01 && s >= 0.0 && s <= 1.0) return t;
  return -1.0;
}

// Check if path from A to B is blocked by any wall (skip wall index skipW)
bool isOccluded(vec2 from, vec2 to, int skipW) {
  vec2 dir = to - from;
  float dist = length(dir);
  if (dist < 0.01) return false;
  vec2 rd = dir / dist;
  for (int w = 0; w < 64; w++) {
    if (w >= u_wallCount) break;
    if (w == skipW) continue;
    float t = segIntersectB(from, rd, u_walls[w].xy, u_walls[w].zw);
    if (t > 0.0 && t < dist - 0.05) return true;
  }
  return false;
}

void main() {
  vec3 bounce = vec3(0.0);
  vec2 worldPos = uvToWorld(v_uv);

  for (int w = 0; w < 64; w++) {
    if (w >= u_wallCount) break;

    // Mirrors reflect specularly (handled in direct pass), not diffusely
    if (u_wallTypes[w] == 1) continue;

    vec2 a = u_walls[w].xy;
    vec2 b = u_walls[w].zw;

    vec2 wDir = normalize(b - a);
    vec2 wNorm = vec2(-wDir.y, wDir.x);
    float wLen = length(b - a);

    // Which side of the wall is the pixel on?
    float side = sign(dot(worldPos - a, wNorm));
    vec2 faceN = wNorm * side;
    float perpDist = abs(dot(worldPos - a, wNorm));
    if (perpDist < 0.05) continue;

    // Pixel in wall-aligned coordinates
    float pu = dot(worldPos - a, wDir);
    float pn = max(perpDist, 0.05);  // atan form factor is bounded, mild clamp ok

    // Early reject: total form factor for entire wall
    float ffTotal = (atan((pu) / pn) - atan((pu - wLen) / pn)) / 3.14159;
    if (ffTotal < 0.001) continue;

    // 12 sub-segments with analytical 2D form factors (atan-based, energy-conserving)
    // Using cos(θ)/r falloff — correct for 2D radiosity with tall walls.
    // Form factor = [atan(u0/pn) - atan(u1/pn)] / π, bounded in [0, 1].
    const int N = 12;
    for (int s = 0; s < N; s++) {
      float s0 = float(s) / float(N) * wLen;
      float s1 = float(s + 1) / float(N) * wLen;

      // Analytical sub-segment form factor
      float ff = (atan((pu - s0) / pn) - atan((pu - s1) / pn)) / 3.14159;
      if (ff <= 0.0) continue;

      // Sample total light at wall midpoint (direct + previous bounce)
      float tMid = (float(s) + 0.5) / float(N);
      vec2 wallPt = mix(a, b, tMid);
      vec2 samplePt = wallPt + faceN * 0.08;
      vec2 uv = worldToUV(samplePt);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

      vec3 wallLight = texture(u_directTex, uv).rgb + texture(u_prevBounce, uv).rgb;

      // Occlusion
      if (isOccluded(wallPt + faceN * 0.02, worldPos, w)) continue;

      bounce += wallLight * ff * u_reflectance;
    }
  }

  // Output bounce ONLY (not direct) — Jacobi iteration: bounce_n = ρ·gather(direct + bounce_{n-1})
  fragColor = vec4(min(bounce, vec3(60000.0)), 1.0);
}
`;

// Compositing / display pass — tone mapping + overlays
const FRAG_DISPLAY = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_directTex;  // full-res direct illumination
uniform sampler2D u_bounceTex;  // half-res bounce (bilinear upsampled)
uniform vec2 u_resolution;
uniform vec2 u_viewOffset;
uniform float u_viewScale;
uniform float u_gridScale;
uniform bool u_showGrid;
uniform bool u_showLux;

vec2 uvToWorld(vec2 uv) {
  vec2 ndc = (uv - 0.5) * u_resolution / u_viewScale;
  ndc.y = -ndc.y;
  return ndc + u_viewOffset;
}

void main() {
  vec3 direct = max(texture(u_directTex, v_uv).rgb, vec3(0.0));
  vec3 bounce = max(texture(u_bounceTex, v_uv).rgb, vec3(0.0));
  vec3 linear = min(direct + bounce, vec3(60000.0));

  // Tone map from linear lux to display
  float lum = dot(linear, vec3(0.2126, 0.7152, 0.0722));
  float brightness = 1.0 - exp(-lum * 0.003);
  vec3 color = (lum > 0.001) ? linear * (brightness / lum) : vec3(0.0);

  vec2 worldPos = uvToWorld(v_uv);

  // Grid overlay — minor + major lines
  if (u_showGrid) {
    // Pixel size in world units (for resolution-independent line width)
    float pxWorld = 1.0 / u_viewScale;

    // Minor grid
    vec2 gridPos = worldPos / u_gridScale;
    vec2 grid = abs(fract(gridPos - 0.5) - 0.5) * u_gridScale;
    float minorLine = 1.0 - smoothstep(0.0, pxWorld * 1.5, min(grid.x, grid.y));

    // Major grid (every 5 cells)
    float majorScale = u_gridScale * 5.0;
    vec2 majorPos = worldPos / majorScale;
    vec2 majorGrid = abs(fract(majorPos - 0.5) - 0.5) * majorScale;
    float majorLine = 1.0 - smoothstep(0.0, pxWorld * 2.5, min(majorGrid.x, majorGrid.y));

    // Origin axes (x=0, y=0)
    float axisX = 1.0 - smoothstep(0.0, pxWorld * 3.0, abs(worldPos.y));
    float axisY = 1.0 - smoothstep(0.0, pxWorld * 3.0, abs(worldPos.x));
    float axisLine = max(axisX, axisY);

    // Composite: minor=dim, major=medium, axes=bright
    float gridAlpha = max(max(minorLine * 0.12, majorLine * 0.25), axisLine * 0.4);
    color = max(color, vec3(gridAlpha));
  }

  // Lux contours
  if (u_showLux && lum > 1.0) {
    float logLux = log(lum) / log(10.0);
    float frac1 = abs(fract(logLux) - 0.5) * 2.0;
    float contour = 1.0 - smoothstep(0.0, 0.03, frac1);
    color += vec3(0.6, 0.4, 0.15) * contour * 0.08;
  }

  fragColor = vec4(color, 1.0);
}
`;

// ============================================================
//  RENDERER CLASS
// ============================================================

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error('WebGL2 not supported');

    const gl = this.gl;
    this.hasFloatFBO = !!gl.getExtension('EXT_color_buffer_float');
    this.hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');

    this.programs = {};
    this.fbos = {};
    this.textures = {};

    this._initShaders();
    this._initGeometry();
    this._initDistTexture();
    this._initFBOs();

    // State
    this.viewOffset = [0, 0];
    this.viewScale = 80; // pixels per meter
  }

  _compile(src, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      console.error('Source:', src);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  _link(vert, frag) {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  _initShaders() {
    const gl = this.gl;
    const vs = this._compile(VERT_SHADER, gl.VERTEX_SHADER);

    const directFS = this._compile(FRAG_DIRECT, gl.FRAGMENT_SHADER);
    this.programs.direct = this._link(vs, directFS);

    const bounceFS = this._compile(FRAG_BOUNCE, gl.FRAGMENT_SHADER);
    this.programs.bounce = this._link(vs, bounceFS);

    const displayFS = this._compile(FRAG_DISPLAY, gl.FRAGMENT_SHADER);
    this.programs.display = this._link(vs, displayFS);
  }

  _initGeometry() {
    const gl = this.gl;
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1
    ]), gl.STATIC_DRAW);

    // Bind to all programs
    for (const name of Object.keys(this.programs)) {
      const prog = this.programs[name];
      const loc = gl.getAttribLocation(prog, 'a_pos');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(null);
  }

  _initDistTexture() {
    const gl = this.gl;
    this.textures.dist = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dist);

    // Use R32F if float linear filtering is available, otherwise R16F or R8
    const filter = this.hasFloatLinear ? gl.LINEAR : gl.NEAREST;

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 1, 0, gl.RED, gl.FLOAT,
      new Float32Array(256));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  _initFBOs() {
    // We'll create these on resize
    this.fboA = null;         // Full-res direct light
    this.fboBounceA = null;   // Half-res bounce ping-pong
    this.fboBounceB = null;   // Half-res bounce ping-pong
  }

  _createFBO(width, height) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Try RGBA16F first, fall back to RGBA8 for iOS compatibility
    if (this.hasFloatFBO) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // Check FBO completeness — if RGBA16F failed, retry with RGBA8
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && this.hasFloatFBO) {
      console.warn('RGBA16F FBO incomplete, falling back to RGBA8');
      this.hasFloatFBO = false;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, tex, width, height };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      const gl = this.gl;
      // Clean up old FBOs
      for (const fbo of [this.fboA, this.fboBounceA, this.fboBounceB]) {
        if (fbo) { gl.deleteFramebuffer(fbo.fbo); gl.deleteTexture(fbo.tex); }
      }
      // Full-res for direct light
      this.fboA = this._createFBO(w, h);
      // Half-res for bounce (4x fewer pixels)
      const hw = Math.max(1, w >> 1);
      const hh = Math.max(1, h >> 1);
      this.fboBounceA = this._createFBO(hw, hh);
      this.fboBounceB = this._createFBO(hw, hh);
    }
  }

  /**
   * Upload photometric distribution data to GPU
   */
  uploadDistribution(data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dist);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.FLOAT, data);
  }

  /**
   * Main render call
   */
  render(params) {
    const gl = this.gl;
    const {
      lightPos, lightDir, intensity, peakCandela, lightColor,
      sourceSize, walls, wallTypes, gridScale, showGrid, showLux,
      bounceEnabled, bouncePasses, reflectance, mountHeight, tiltAngle
    } = params;

    const w = this.canvas.width;
    const h = this.canvas.height;

    gl.viewport(0, 0, w, h);

    // ---- Pass 1: Direct illumination ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const dp = this.programs.direct;
    gl.useProgram(dp);
    gl.bindVertexArray(this.quadVAO);

    // Uniforms
    gl.uniform2f(gl.getUniformLocation(dp, 'u_viewOffset'), this.viewOffset[0], this.viewOffset[1]);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_viewScale'), this.viewScale);
    gl.uniform2f(gl.getUniformLocation(dp, 'u_resolution'), w, h);

    gl.uniform2f(gl.getUniformLocation(dp, 'u_lightPos'), lightPos[0], lightPos[1]);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_lightDir'), lightDir);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_intensity'), intensity);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_peakCandela'), peakCandela);
    gl.uniform3f(gl.getUniformLocation(dp, 'u_lightColor'), lightColor[0], lightColor[1], lightColor[2]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dist);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_distTex'), 0);

    gl.uniform1f(gl.getUniformLocation(dp, 'u_sourceSize'), sourceSize);

    gl.uniform1i(gl.getUniformLocation(dp, 'u_wallCount'), walls.length);
    const wTypes = wallTypes || [];
    for (let i = 0; i < Math.min(walls.length, 64); i++) {
      gl.uniform4f(
        gl.getUniformLocation(dp, `u_walls[${i}]`),
        walls[i][0], walls[i][1], walls[i][2], walls[i][3]
      );
      const wt = wTypes[i] || 0;
      gl.uniform1i(gl.getUniformLocation(dp, `u_wallTypes[${i}]`), wt);
      // Mirror boards: ~0.9 reflectance; diffuse walls use global reflectance
      gl.uniform1f(
        gl.getUniformLocation(dp, `u_wallReflectances[${i}]`),
        wt === 1 ? 0.9 : reflectance
      );
    }

    gl.uniform1f(gl.getUniformLocation(dp, 'u_gridScale'), gridScale);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_showGrid'), showGrid ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_showLux'), showLux ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_mountHeight'), mountHeight || 0);
    gl.uniform1f(gl.getUniformLocation(dp, 'u_tiltAngle'), tiltAngle || 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- Pass 2+: Bounce passes at HALF resolution ----
    // Jacobi iteration: bounce_n = ρ·gather(direct + bounce_{n-1})
    // Output is bounce-only; display composites direct + bounce.
    // Always clear bounce FBO so stale data doesn't persist after walls are removed
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBounceA.fbo);
    gl.viewport(0, 0, this.fboBounceA.width, this.fboBounceA.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, w, h);

    let bounceTex = this.fboBounceA.tex; // default: zero bounce
    if (bounceEnabled && walls.length > 0) {
      const bp = this.programs.bounce;
      gl.useProgram(bp);
      gl.bindVertexArray(this.quadVAO);

      const hw = this.fboBounceA.width;
      const hh = this.fboBounceA.height;
      gl.viewport(0, 0, hw, hh);

      // Use FULL resolution for coordinate mapping (UV→world stays consistent)
      gl.uniform2f(gl.getUniformLocation(bp, 'u_resolution'), w, h);
      gl.uniform2f(gl.getUniformLocation(bp, 'u_viewOffset'), this.viewOffset[0], this.viewOffset[1]);
      gl.uniform1f(gl.getUniformLocation(bp, 'u_viewScale'), this.viewScale);
      gl.uniform1f(gl.getUniformLocation(bp, 'u_reflectance'), reflectance);
      gl.uniform1i(gl.getUniformLocation(bp, 'u_wallCount'), walls.length);
      for (let i = 0; i < Math.min(walls.length, 64); i++) {
        gl.uniform4f(
          gl.getUniformLocation(bp, `u_walls[${i}]`),
          walls[i][0], walls[i][1], walls[i][2], walls[i][3]
        );
        gl.uniform1i(
          gl.getUniformLocation(bp, `u_wallTypes[${i}]`),
          (wTypes[i] || 0)
        );
      }

      // Direct light always on texture unit 0
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
      gl.uniform1i(gl.getUniformLocation(bp, 'u_directTex'), 0);

      // Clear initial bounce to zero
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboBounceA.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);

      let src = this.fboBounceA;  // previous bounce (starts at 0)
      let dst = this.fboBounceB;

      for (let pass = 0; pass < bouncePasses; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Previous bounce on texture unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(gl.getUniformLocation(bp, 'u_prevBounce'), 1);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        [src, dst] = [dst, src];
      }
      bounceTex = src.tex;
    }

    // ---- Final: Display to screen (full resolution) ----
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const disp = this.programs.display;
    gl.useProgram(disp);
    gl.bindVertexArray(this.quadVAO);

    // Direct light (full res) on unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform1i(gl.getUniformLocation(disp, 'u_directTex'), 0);

    // Bounce (half res, bilinear upsampled) on unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bounceTex);
    gl.uniform1i(gl.getUniformLocation(disp, 'u_bounceTex'), 1);

    gl.uniform2f(gl.getUniformLocation(disp, 'u_resolution'), w, h);
    gl.uniform2f(gl.getUniformLocation(disp, 'u_viewOffset'), this.viewOffset[0], this.viewOffset[1]);
    gl.uniform1f(gl.getUniformLocation(disp, 'u_viewScale'), this.viewScale);
    gl.uniform1f(gl.getUniformLocation(disp, 'u_gridScale'), gridScale);
    gl.uniform1i(gl.getUniformLocation(disp, 'u_showGrid'), showGrid ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(disp, 'u_showLux'), showLux ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Draw walls and light icon as an overlay using 2D canvas
   */
  drawOverlay(ctx, params) {
    const { lightPos, lightDir, walls, wallTypes, sourceSize, mountHeight, tiltAngle, gridScale, showGrid } = params;
    const wTypes = wallTypes || [];
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // World to screen transform
    const worldToScreen = (wx, wy) => {
      const sx = (wx - this.viewOffset[0]) * this.viewScale + w / 2;
      const sy = (wy - this.viewOffset[1]) * this.viewScale + h / 2;
      return [sx, sy];
    };

    // Draw walls with grabbable endpoints
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const isMirror = wTypes[i] === 1;
      const [x1, y1] = worldToScreen(wall[0], wall[1]);
      const [x2, y2] = worldToScreen(wall[2], wall[3]);
      // Wall line — mirrors are cyan/reflective, walls are white
      if (isMirror) {
        ctx.strokeStyle = '#4ff';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Reflective hatching
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / len * 8, ny = dx / len * 8;
        for (let t = 0; t <= 1; t += 0.08) {
          const px = x1 + dx * t, py = y1 + dy * t;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + nx, py + ny);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      // Endpoints
      ctx.fillStyle = '#fff';
      for (const [px, py] of [[x1, y1], [x2, y2]]) {
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      // Midpoint (drag handle)
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw light fixture icon
    const [lx, ly] = worldToScreen(lightPos[0], lightPos[1]);
    const iconSize = 8 + sourceSize * 20;
    const isOverhead = mountHeight > 0;

    ctx.save();
    ctx.translate(lx, ly);

    if (isOverhead) {
      // Overhead icon: concentric circles with tilt direction arrow
      ctx.fillStyle = 'rgba(255, 153, 0, 0.3)';
      ctx.beginPath();
      ctx.arc(0, 0, iconSize * 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f90';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, iconSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const tilt = tiltAngle || 0;
      if (tilt > 0.05) {
        // Tilt direction arrow — length proportional to tilt angle
        const arrowLen = iconSize * 0.5 + iconSize * 1.2 * (tilt / (Math.PI / 2));
        ctx.save();
        ctx.rotate(lightDir);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(arrowLen, 0);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(arrowLen, 0);
        ctx.lineTo(arrowLen - 5, -3);
        ctx.lineTo(arrowLen - 5, 3);
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();
      } else {
        // Crosshair for straight-down (no tilt)
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        const cr = iconSize * 0.6;
        ctx.beginPath();
        ctx.moveTo(-cr, 0); ctx.lineTo(cr, 0);
        ctx.moveTo(0, -cr); ctx.lineTo(0, cr);
        ctx.stroke();
      }

      // Height + tilt label
      const dpr = window.devicePixelRatio || 1;
      ctx.font = `${Math.round(10 * dpr)}px monospace`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tiltDeg = Math.round((tilt / Math.PI) * 180);
      const label = tiltDeg > 0
        ? `${mountHeight.toFixed(1)}m / ${tiltDeg}°`
        : `${mountHeight.toFixed(1)}m`;
      ctx.fillText(label, 0, iconSize + 4 * dpr);
    } else {
      ctx.rotate(lightDir);

      // Body
      ctx.fillStyle = '#f90';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, iconSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Direction indicator
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(iconSize * 0.5, 0);
      ctx.lineTo(iconSize * 1.5, 0);
      ctx.stroke();

      // Arrow head
      ctx.beginPath();
      ctx.moveTo(iconSize * 1.5, 0);
      ctx.lineTo(iconSize * 1.1, -4);
      ctx.lineTo(iconSize * 1.1, 4);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    ctx.restore();

    // Grid distance labels (on major grid lines)
    if (showGrid && gridScale > 0) {
      const majorScale = gridScale * 5;
      const dpr = window.devicePixelRatio || 1;
      const fontSize = Math.round(11 * dpr);
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Compute visible world bounds
      const worldLeft = this.viewOffset[0] - w / (2 * this.viewScale);
      const worldRight = this.viewOffset[0] + w / (2 * this.viewScale);
      const worldTop = this.viewOffset[1] - h / (2 * this.viewScale);
      const worldBottom = this.viewOffset[1] + h / (2 * this.viewScale);

      // Label major vertical lines (x-axis values)
      const xStart = Math.ceil(worldLeft / majorScale) * majorScale;
      for (let x = xStart; x <= worldRight; x += majorScale) {
        const [sx] = worldToScreen(x, 0);
        // Place label near top of screen
        const label = x === 0 ? '0' : `${x.toFixed(x % 1 === 0 ? 0 : 1)}m`;
        ctx.fillText(label, sx + 3 * dpr, 4 * dpr);
      }

      // Label major horizontal lines (y-axis values)
      ctx.textBaseline = 'bottom';
      const yStart = Math.ceil(worldTop / majorScale) * majorScale;
      for (let y = yStart; y <= worldBottom; y += majorScale) {
        const [, sy] = worldToScreen(0, y);
        const label = y === 0 ? '0' : `${y.toFixed(y % 1 === 0 ? 0 : 1)}m`;
        ctx.fillText(label, 4 * dpr, sy - 3 * dpr);
      }
    }
  }
}
