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

// Grid
uniform float u_gridScale;   // meters per grid cell
uniform bool u_showGrid;
uniform bool u_showLux;

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
  // Add soft spill past beam edge — real fixtures have housing reflections / lens spill
  float spill = exp(-angleDeg * 0.06) * 0.015;
  return raw + spill;
}

// Segment intersection: returns t along ray or -1
float segIntersect(vec2 ro, vec2 rd, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 ao = ro - a;
  float denom = rd.x * ab.y - rd.y * ab.x;
  if (abs(denom) < 1e-8) return -1.0;
  float t = (ao.x * ab.y - ao.y * ab.x) / denom;
  float s = (ao.x * rd.y - ao.y * rd.x) / denom;
  if (t > 0.001 && s >= 0.0 && s <= 1.0) return t;
  return -1.0;
}

// Shadow test with soft penumbra based on source size
float shadowTest(vec2 origin, vec2 target) {
  vec2 dir = target - origin;
  float dist = length(dir);
  if (dist < 0.001) return 1.0;
  vec2 rd = dir / dist;

  // For soft shadows, sample multiple rays offset perpendicular to the ray direction
  // based on source size
  vec2 perp = vec2(-rd.y, rd.x);
  float penumbraRadius = u_sourceSize * 0.15; // world-space offset

  int samples = (u_sourceSize > 0.05) ? 5 : 1;
  float lit = 0.0;

  for (int s = 0; s < 5; s++) {
    if (s >= samples) break;
    float offset = 0.0;
    if (samples > 1) {
      offset = (float(s) / float(samples - 1) - 0.5) * 2.0 * penumbraRadius;
    }
    vec2 sampleOrigin = origin + perp * offset;
    vec2 sampleDir = target - sampleOrigin;
    float sampleDist2 = length(sampleDir);
    vec2 sRd = sampleDir / sampleDist2;

    bool blocked = false;
    for (int w = 0; w < 64; w++) {
      if (w >= u_wallCount) break;
      float t = segIntersect(sampleOrigin, sRd, u_walls[w].xy, u_walls[w].zw);
      if (t > 0.0 && t < sampleDist2 - 0.01) {
        blocked = true;
        break;
      }
    }
    if (!blocked) lit += 1.0;
  }
  return lit / float(samples);
}

void main() {
  vec2 worldPos = uvToWorld(v_uv);

  // Vector from light to this point
  vec2 toPoint = worldPos - u_lightPos;
  float dist = length(toPoint);

  // Angle from light direction to this point
  float pointAngle = atan(toPoint.y, toPoint.x);
  float relAngle = pointAngle - u_lightDir;
  // Normalize to [-PI, PI]
  relAngle = mod(relAngle + 3.14159265, 6.28318530) - 3.14159265;

  // Photometric intensity at this angle
  float photIntensity = sampleDist(relAngle);

  // Inverse square falloff: E = I / d^2  (illuminance in lux)
  float falloff = 1.0 / max(dist * dist, 0.01);

  // Shadow
  float shadow = shadowTest(u_lightPos, worldPos);

  // Final illuminance (lux)
  float lux = u_peakCandela * u_intensity * photIntensity * falloff * shadow;

  // Convert lux to visible brightness (tone mapping)
  // Using filmic-style curve for nice rolloff
  float brightness = 1.0 - exp(-lux * 0.003);

  vec3 color = u_lightColor * brightness;

  // Grid overlay
  if (u_showGrid) {
    vec2 gridPos = worldPos / u_gridScale;
    vec2 grid = abs(fract(gridPos - 0.5) - 0.5);
    float line = min(grid.x, grid.y);
    float gridLine = 1.0 - smoothstep(0.0, 0.02, line);
    // Subtle grid
    vec3 gridColor = vec3(0.12) * gridLine;
    color = max(color, gridColor * 0.4);
  }

  // Lux contours
  if (u_showLux) {
    float luxVal = u_peakCandela * u_intensity * photIntensity * falloff * shadow;
    // Draw contours at powers of 10 and 0.5x
    float logLux = log(max(luxVal, 0.1)) / log(10.0);
    float frac1 = abs(fract(logLux) - 0.5) * 2.0;
    float contour = 1.0 - smoothstep(0.0, 0.06, frac1);
    color += vec3(0.7, 0.5, 0.2) * contour * 0.15 * smoothstep(0.0, 0.01, luxVal);
  }

  fragColor = vec4(color, 1.0);
}
`;

// Bounce lighting pass
const FRAG_BOUNCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prevPass;  // previous illumination
uniform vec2 u_resolution;
uniform vec2 u_viewOffset;
uniform float u_viewScale;
uniform float u_reflectance;

// Walls
uniform int u_wallCount;
uniform vec4 u_walls[64];

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

// Simple GI approximation: sample nearby illuminated wall surfaces
// and add their reflected contribution
void main() {
  vec3 existing = texture(u_prevPass, v_uv).rgb;

  // Sample reflected light from wall surfaces
  vec3 bounce = vec3(0.0);
  vec2 worldPos = uvToWorld(v_uv);

  // For each wall, compute its contribution as a diffuse reflector
  for (int w = 0; w < 64; w++) {
    if (w >= u_wallCount) break;

    vec2 a = u_walls[w].xy;
    vec2 b = u_walls[w].zw;

    // Sample a few points along the wall
    for (int s = 0; s < 4; s++) {
      float t = (float(s) + 0.5) / 4.0;
      vec2 wallPt = mix(a, b, t);
      vec2 wallUV = worldToUV(wallPt);

      if (wallUV.x < 0.0 || wallUV.x > 1.0 || wallUV.y < 0.0 || wallUV.y > 1.0) continue;

      // Light arriving at wall point
      vec3 wallLight = texture(u_prevPass, wallUV).rgb;

      // Distance and direction from wall point to our pixel
      vec2 toUs = worldPos - wallPt;
      float dist = length(toUs);
      if (dist < 0.1) continue;

      // Wall normal (perpendicular to wall segment)
      vec2 wallDir = normalize(b - a);
      vec2 wallNormal = vec2(-wallDir.y, wallDir.x);

      // Cosine factor (wall emits as lambertian)
      float cosWall = abs(dot(normalize(toUs), wallNormal));

      // Inverse square from wall to pixel
      float atten = cosWall / (dist * dist + 1.0);

      bounce += wallLight * atten * u_reflectance * 0.2;
    }
  }

  fragColor = vec4(existing + bounce, 1.0);
}
`;

// Compositing / display pass
const FRAG_DISPLAY = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_lightTex;

void main() {
  fragColor = texture(u_lightTex, v_uv);
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
    this.fboA = null;
    this.fboB = null;
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
      // Recreate FBOs
      if (this.fboA) {
        this.gl.deleteFramebuffer(this.fboA.fbo);
        this.gl.deleteTexture(this.fboA.tex);
      }
      if (this.fboB) {
        this.gl.deleteFramebuffer(this.fboB.fbo);
        this.gl.deleteTexture(this.fboB.tex);
      }
      this.fboA = this._createFBO(w, h);
      this.fboB = this._createFBO(w, h);
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
      sourceSize, walls, gridScale, showGrid, showLux,
      bounceEnabled, bouncePasses, reflectance
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
    for (let i = 0; i < Math.min(walls.length, 64); i++) {
      gl.uniform4f(
        gl.getUniformLocation(dp, `u_walls[${i}]`),
        walls[i][0], walls[i][1], walls[i][2], walls[i][3]
      );
    }

    gl.uniform1f(gl.getUniformLocation(dp, 'u_gridScale'), gridScale);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_showGrid'), showGrid ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(dp, 'u_showLux'), showLux ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- Pass 2+: Bounce passes ----
    if (bounceEnabled && walls.length > 0) {
      const bp = this.programs.bounce;
      gl.useProgram(bp);
      gl.bindVertexArray(this.quadVAO);

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
      }

      let src = this.fboA;
      let dst = this.fboB;

      for (let pass = 0; pass < bouncePasses; pass++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(gl.getUniformLocation(bp, 'u_prevPass'), 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Swap
        [src, dst] = [dst, src];
      }
      // Result is in `src` after swaps
      this.finalTex = src.tex;
    } else {
      this.finalTex = this.fboA.tex;
    }

    // ---- Final: Display to screen ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const disp = this.programs.display;
    gl.useProgram(disp);
    gl.bindVertexArray(this.quadVAO);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.finalTex);
    gl.uniform1i(gl.getUniformLocation(disp, 'u_lightTex'), 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Draw walls and light icon as an overlay using 2D canvas
   */
  drawOverlay(ctx, params) {
    const { lightPos, lightDir, walls, sourceSize } = params;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // World to screen transform
    const worldToScreen = (wx, wy) => {
      const sx = (wx - this.viewOffset[0]) * this.viewScale + w / 2;
      const sy = (wy - this.viewOffset[1]) * this.viewScale + h / 2;
      return [sx, sy];
    };

    // Draw walls
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    for (const wall of walls) {
      const [x1, y1] = worldToScreen(wall[0], wall[1]);
      const [x2, y2] = worldToScreen(wall[2], wall[3]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Draw light fixture icon
    const [lx, ly] = worldToScreen(lightPos[0], lightPos[1]);
    const iconSize = 8 + sourceSize * 20;

    ctx.save();
    ctx.translate(lx, ly);
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

    ctx.restore();
  }
}
