// The wormhole's one shader.
//
// Adapted from cortiz2894/showcase-images, whose cylindrical gallery does the
// whole thing in a single instanced draw: the helix layout, the bend onto the
// cylinder, the centre squeeze, and every visual effect live in these two
// programs. Twenty images cost one draw call and one texture.
//
// The substantive change is alpha. That gallery shows photographs, so its
// fragment stage builds an opaque rectangle and its alpha comes from a rounded
// rect mask. This one shows cutouts — PNGs whose entire point is that the
// background is gone — so the texture's own alpha has to survive to
// gl_FragColor, or the wormhole is a ring of grey rectangles with a subject
// painted on each. Every place that had to change for that is marked.

/**
 * Where a vertex lands — the geometry, as a standalone function.
 *
 * Pulled out of `main` so it can be included somewhere other than a vertex
 * shader. `parity.html` compiles this same chunk into a FRAGMENT shader and
 * evaluates it over a grid, which is what lets a golden-vector gate compare it
 * against an independent JS implementation of the same maths (see
 * `lib/wormhole/parity.ts`).
 *
 * The first version of that gate tried to rewrite the vertex shader's source
 * with regexes to extract this. It was already broken by the debug branch
 * before it was ever run, and it would have broken again on any edit here.
 * A shared chunk is both the working answer and the honest one: the thing under
 * test is literally the thing that ships.
 *
 * `uDebugMode == 3` is the flat view — a tangent plane, so the bend can be seen
 * by its absence. It lives here too rather than in the caller, because it is a
 * statement about where the vertex goes.
 */
export const geometryChunk = /* glsl */ `
#define TAU 6.283185307179586

vec3 plWormholePosition(
  vec3 scaled,
  float angleOffset,
  float positionY,
  float radius,
  float scrollOffset,
  float totalHeight,
  float curvature,
  float rotation,
  float squeezeAmount,
  float squeezeWidth,
  int debugMode,
  out float depthFade,
  out float worldY
) {
  // Wrap into a ring: an image leaving the top re-enters at the bottom, so a
  // finite number of instances scrolls forever.
  float scrolledY = positionY + scrollOffset;
  scrolledY = mod(scrolledY + totalHeight * 0.5, totalHeight) - totalHeight * 0.5;

  float y = scrolledY + scaled.y;
  worldY = y;

  float squeezeGauss = exp(-(y * y) / (squeezeWidth * squeezeWidth));
  float squeezedRadius = radius * (1.0 - squeezeAmount * squeezeGauss);

  // Reduced into one revolution before it reaches sin/cos.
  //
  // A GPU's sin and cos lose accuracy as their argument grows, and the rotation
  // uniform used to accumulate every frame without bound — a few minutes of
  // idle turning puts it in the thousands. Measured on this machine: sin() is
  // off by 1.9e-4 for an angle under 2*PI and 3.5e-4 at 4000 radians, so
  // leaving it unwrapped roughly doubles the error in every vertex position.
  //
  // Worth being precise about what this did and did not fix. It is NOT what
  // the parity gate was reporting — that disagreement is the driver's trig
  // accuracy and reducing the angle does not change it. This is a separate,
  // smaller, real improvement that the investigation happened to turn up. The
  // caller also wraps the rotation uniform, which is the same fix applied where
  // the number is generated.
  float angle = mod(angleOffset + rotation, TAU);

  if (debugMode == 3) {
    float fx = sin(angle) * squeezedRadius + scaled.x * cos(angle);
    float fz = cos(angle) * squeezedRadius - scaled.x * sin(angle);
    depthFade = smoothstep(-squeezedRadius, squeezedRadius * 0.5, fz);
    return vec3(fx, y, fz);
  }

  // Bend the plane around the cylinder: a vertex's own x becomes an angle,
  // so a flat quad arrives curved rather than chorded across the circle.
  float theta = scaled.x / (squeezedRadius * curvature);
  float finalAngle = angle + theta;

  float x = sin(finalAngle) * squeezedRadius;
  float z = cos(finalAngle) * squeezedRadius;

  depthFade = smoothstep(-squeezedRadius, squeezedRadius * 0.5, z);
  return vec3(x, y, z);
}
`;

export const vertexShader = /* glsl */ `
  uniform float uRadius;
  uniform float uScrollOffset;
  uniform float uTotalHeight;
  uniform float uScale;
  uniform float uCurvature;
  uniform float uRotation;

  // Hourglass pinch at the centre, driven by scroll speed.
  uniform float uSqueezeAmount;
  uniform float uSqueezeWidth;
  uniform int uDebugMode;

  attribute float aAngleOffset;
  attribute float aPositionY;
  attribute float aTextureIndex;
  attribute float aSlotIndex;

  varying vec2 vUv;
  varying float vTextureIndex;
  varying float vSlotIndex;
  varying float vDepthFade;
  varying float vWorldY;

${geometryChunk}

  void main() {
    vUv = uv;
    vTextureIndex = aTextureIndex;
    vSlotIndex = aSlotIndex;

    vec3 p = plWormholePosition(
      position * uScale,
      aAngleOffset,
      aPositionY,
      uRadius,
      uScrollOffset,
      uTotalHeight,
      uCurvature,
      uRotation,
      uSqueezeAmount,
      uSqueezeWidth,
      uDebugMode,
      vDepthFade,
      vWorldY
    );

    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uAtlasCols;
  uniform float uAtlasRows;
  uniform float uTime;

  uniform float uChromaticAberration;
  uniform float uOpacity;
  uniform float uSaturation;
  uniform float uBrightness;
  uniform float uEmission;
  uniform float uScanLines;
  uniform float uScanLineSpeed;
  uniform float uScanLineDensity;

  uniform float uDistanceFadeStart;
  uniform float uDistanceFadeEnd;

  uniform float uFlickerIntensity;
  uniform float uFlickerSpeed;

  // Frame around each slot. Off by default here: a cutout's silhouette is the
  // subject, and a rectangle drawn around it puts back exactly the box the
  // product exists to remove.
  uniform float uBorderWidth;
  uniform vec3 uBorderColor;
  uniform float uBorderEmission;

  uniform float uCornerSize;
  uniform float uCornerWidth;
  uniform float uCornerOffset;

  uniform int uDitherEnabled;
  uniform float uDitherCellSize;
  uniform float uDitherGap;
  uniform float uDitherContrast;
  uniform float uDitherBaseScale;
  uniform float uDitherIntensity;
  uniform int uDitherMode;
  uniform int uDitherShape;
  uniform int uDitherUseColor;
  uniform vec3 uDitherFgColor;
  uniform float uDitherAspect;

  // Debug views, from the reference. 0 = off, 1 = per-instance colours,
  // 2 = depth fade, 3 = flat (no cylinder bend).
  uniform int uDebugMode;

  varying vec2 vUv;
  varying float vTextureIndex;
  varying float vSlotIndex;
  varying float vDepthFade;
  varying float vWorldY;

  #define PI 3.14159265359

  vec2 getTileUV(vec2 localUV) {
    float idx = floor(vTextureIndex + 0.5);
    float col = mod(idx, uAtlasCols);
    float row = floor(idx / uAtlasCols);
    float tileU = (col + localUV.x) / uAtlasCols;
    float tileV = 1.0 - (row + 1.0 - localUV.y) / uAtlasRows;
    return vec2(tileU, tileV);
  }

  // All eleven dot shapes from the reference.
  float sdCircle(vec2 p, float r) { return length(p) - r; }
  float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  float sdDiamond(vec2 p, float r) { vec2 q = abs(p) / r; return (q.x + q.y - 1.0) * r * 0.7071; }
  float sdHex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p.yx);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float sdOctagon(vec2 p, float r) {
    const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
    p = abs(p);
    p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    return length(p) - r;
  }
  float sdStar5(vec2 p, float r, float ratio) {
    vec2 q = p / r;
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
    q.x = abs(q.x);
    q -= 2.0 * max(dot(k1, q), 0.0) * k1;
    q -= 2.0 * max(dot(k2, q), 0.0) * k2;
    q.x = abs(q.x);
    q.y -= 1.0;
    vec2 ba = ratio * vec2(0.587785252292, 0.809016994375) - vec2(0, 1);
    float h = clamp(dot(q, ba) / dot(ba, ba), 0.0, 1.0);
    return length(q - ba * h) * sign(q.y * ba.x - q.x * ba.y) * r;
  }

  float getLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  mat2 rotate2d(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

  /**
   * Halftone the cutout.
   *
   * Reduced from the reference's sixteen modes and eleven shapes to the three
   * shapes and one mode that survived looking at them, because every branch
   * here is a branch every fragment pays for. The 5x5 neighbourhood stays: a
   * cell's dot can grow past its own bounds, so a fragment has to test the
   * neighbours whose dots might cover it.
   *
   * ALPHA: the reference returns mix(bgColor, shapeColor, mask) and an alpha
   * of mask, which paints an opaque background wherever no dot lands. Here
   * the cell's own texture alpha is carried out separately, so a dot outside
   * the subject is not drawn at all rather than drawn onto a grey card.
   */
  vec4 applyDither(vec2 localUV) {
    vec2 pixelUV = localUV;
    pixelUV.x *= uDitherAspect;

    float cellsCountY = 1.0 / (uDitherCellSize / 100.0);
    vec2 currentCellIndex = floor(pixelUV * cellsCountY);

    float globalMinDist = 100.0;
    float maxPriority = -1.0;
    vec3 finalShapeColor = vec3(0.0);
    float finalShapeAlpha = 0.0;
    float aa = 2.0 / (uDitherCellSize);

    for (float y = -2.0; y <= 2.0; y++) {
      for (float x = -2.0; x <= 2.0; x++) {
        vec2 neighborIndex = currentCellIndex + vec2(x, y);
        vec2 neighborCenterUV = (neighborIndex + 0.5) / cellsCountY;
        neighborCenterUV.x /= uDitherAspect;

        if (neighborCenterUV.x < 0.0 || neighborCenterUV.x > 1.0 ||
            neighborCenterUV.y < 0.0 || neighborCenterUV.y > 1.0) continue;

        vec4 sampled = texture2D(uAtlas, getTileUV(neighborCenterUV));
        vec3 col = sampled.rgb;

        float contrastFactor = (1.015 * (uDitherContrast + 1.0)) / (1.015 - uDitherContrast);
        col = clamp(contrastFactor * (col - 0.5) + 0.5, 0.0, 1.0);

        float luma = getLuma(col);
        // Transparent cells contribute no dot. Without this the halftone
        // tiles the whole quad and the cutout's silhouette disappears.
        if (sampled.a < 0.04) continue;

        // All thirteen modes from the reference. Each decides how a cell's
        // luminance becomes a dot: its size, its rotation, or its offset.
        float scaleX = uDitherBaseScale;
        float scaleY = uDitherBaseScale;
        float rot = 0.0;
        vec2 offset = vec2(0.0);

        if (uDitherMode == 1) { scaleX = scaleY = luma * uDitherBaseScale * 1.5; }
        else if (uDitherMode == 2) { scaleX = scaleY = (1.0 - luma) * uDitherBaseScale * 1.5; }
        else if (uDitherMode == 3) { rot = luma * PI * uDitherIntensity; }
        else if (uDitherMode == 4) { scaleY = luma * uDitherBaseScale * 3.0; scaleX = uDitherBaseScale * 0.4; }
        else if (uDitherMode == 5) { scaleX = luma * uDitherBaseScale * 3.0; scaleY = uDitherBaseScale * 0.4; }
        else if (uDitherMode == 6) {
          if (mod(neighborIndex.x + neighborIndex.y, 2.0) < 0.5)
            scaleX = scaleY = luma * uDitherBaseScale * 1.5;
          else
            scaleX = scaleY = (1.0 - luma) * uDitherBaseScale * 1.5;
        }
        else if (uDitherMode == 8) { offset.x = (luma - 0.5) * uDitherIntensity; }
        else if (uDitherMode == 9) { offset.y = luma * uDitherIntensity; }
        else if (uDitherMode == 10) { scaleX = scaleY = abs(luma - 0.5) * 2.0 * uDitherBaseScale; }
        else if (uDitherMode == 12) {
          float q = floor(luma * 4.0) / 4.0;
          scaleX = scaleY = q * uDitherBaseScale * 1.5;
        }
        else if (uDitherMode == 13) {
          float n = fract(sin(dot(neighborIndex, vec2(12.9898, 78.233))) * 43758.5453);
          scaleX = scaleY = (luma + n * 0.5) * uDitherBaseScale;
        }
        else if (uDitherMode == 15) {
          scaleX = scaleY = (luma < 0.5) ? 0.0 : uDitherBaseScale;
        }

        if (scaleX < 0.001 || scaleY < 0.001) continue;

        vec2 cellCenter = (neighborIndex + 0.5 + offset) / cellsCountY;
        vec2 p = pixelUV - cellCenter;
        if (rot != 0.0) p = rotate2d(rot) * p;
        p *= cellsCountY;

        float gapFactor = 1.0 - (uDitherGap / uDitherCellSize);
        float effSize = 0.5 * gapFactor;

        float d = 1.0;
        if (uDitherShape == 0) d = sdCircle(p, effSize * scaleX);
        else if (uDitherShape == 1) d = sdBox(p, vec2(effSize * scaleX, effSize * scaleY));
        else if (uDitherShape == 2) d = sdDiamond(p, effSize * scaleX);
        else if (uDitherShape == 3) d = sdHex(p, effSize * scaleX);
        else if (uDitherShape == 4) d = sdBox(p, vec2(effSize * scaleX * 0.2, effSize * scaleY));
        else if (uDitherShape == 5) d = sdBox(p, vec2(effSize * scaleX, effSize * scaleY * 0.2));
        else if (uDitherShape == 6) d = sdBox(rotate2d(0.785) * p, vec2(effSize * scaleX * 0.2, effSize * scaleY * 1.5));
        else if (uDitherShape == 7) d = sdOctagon(p, effSize * scaleX);
        else if (uDitherShape == 8) d = sdStar5(vec2(p.x, -p.y), effSize * scaleX, 0.5);
        else if (uDitherShape == 9) d = max(sdBox(p, vec2(effSize * scaleX)), -sdBox(p, vec2(effSize * scaleX * 0.8)));
        else d = min(sdBox(p, vec2(effSize * scaleX * 0.2, effSize * scaleY)), sdBox(p, vec2(effSize * scaleX, effSize * scaleY * 0.2)));

        globalMinDist = min(globalMinDist, d);

        if (d < aa && luma > maxPriority) {
          maxPriority = luma;
          finalShapeColor = (uDitherUseColor == 1) ? col : uDitherFgColor;
          finalShapeAlpha = sampled.a;
        }
      }
    }

    float mask = 1.0 - smoothstep(0.0, aa, globalMinDist);
    return vec4(finalShapeColor, mask * finalShapeAlpha);
  }

  float cornerMask(vec2 uv, float cornerLen, float lineW, float offset) {
    float mask = 0.0;
    float o = offset;
    if (uv.x >= o && uv.x < o + cornerLen && uv.y >= o && uv.y < o + lineW) mask = 1.0;
    if (uv.x >= o && uv.x < o + lineW && uv.y >= o && uv.y < o + cornerLen) mask = 1.0;
    if (uv.x > 1.0 - o - cornerLen && uv.x <= 1.0 - o && uv.y >= o && uv.y < o + lineW) mask = 1.0;
    if (uv.x > 1.0 - o - lineW && uv.x <= 1.0 - o && uv.y >= o && uv.y < o + cornerLen) mask = 1.0;
    if (uv.x >= o && uv.x < o + cornerLen && uv.y > 1.0 - o - lineW && uv.y <= 1.0 - o) mask = 1.0;
    if (uv.x >= o && uv.x < o + lineW && uv.y > 1.0 - o - cornerLen && uv.y <= 1.0 - o) mask = 1.0;
    if (uv.x > 1.0 - o - cornerLen && uv.x <= 1.0 - o && uv.y > 1.0 - o - lineW && uv.y <= 1.0 - o) mask = 1.0;
    if (uv.x > 1.0 - o - lineW && uv.x <= 1.0 - o && uv.y > 1.0 - o - cornerLen && uv.y <= 1.0 - o) mask = 1.0;
    return mask;
  }

  void main() {
    // Debug: one hue per instance, spaced by the golden ratio so neighbours
    // never land on a similar colour. This is what makes a duplicated slot
    // position obvious — two instances at the same place show as one colour
    // covering another.
    if (uDebugMode == 1) {
      // By SLOT, not by texture. The reference hues by texture index, which
      // gives every slot showing the same picture the same colour — useless
      // for the thing this view is for, since two slots at one position are
      // most likely two slots showing the same picture. Per-slot hues make an
      // overlap read as one colour cut in half by another.
      float hue = fract(floor(vSlotIndex + 0.5) * 0.618033988749);
      float c = 0.72;
      float x = c * (1.0 - abs(mod(hue * 6.0, 2.0) - 1.0));
      float m = 0.9 - c;
      vec3 rgb;
      float h6 = hue * 6.0;
      if (h6 < 1.0) rgb = vec3(c, x, 0.0);
      else if (h6 < 2.0) rgb = vec3(x, c, 0.0);
      else if (h6 < 3.0) rgb = vec3(0.0, c, x);
      else if (h6 < 4.0) rgb = vec3(0.0, x, c);
      else if (h6 < 5.0) rgb = vec3(x, 0.0, c);
      else rgb = vec3(c, 0.0, x);
      gl_FragColor = vec4(rgb + m, 1.0);
      return;
    }

    // Debug: the depth fade as greyscale.
    if (uDebugMode == 2) {
      gl_FragColor = vec4(vec3(vDepthFade), 1.0);
      return;
    }

    // ALPHA: three channels are sampled at offsets for the aberration, but the
    // alpha comes from the centre sample alone. Taking it from a shifted
    // sample would smear the silhouette sideways by the aberration amount,
    // which on a hair-level matte is exactly the artefact this app spends a
    // refine pass removing.
    float caStrength = uChromaticAberration * (0.3 + 0.7 * (1.0 - vDepthFade));
    vec2 caOffset = vec2(caStrength, 0.0);

    vec4 centerSample = texture2D(uAtlas, getTileUV(vUv));
    float r = texture2D(uAtlas, getTileUV(vUv + caOffset)).r;
    float b = texture2D(uAtlas, getTileUV(vUv - caOffset)).b;

    vec3 color = vec3(r, centerSample.g, b);
    float alpha = centerSample.a;

    if (uDitherEnabled == 1) {
      vec4 dithered = applyDither(vUv);
      color = dithered.rgb;
      alpha = dithered.a;
    }

    float lum = getLuma(color);
    color = mix(vec3(lum), color, uSaturation);
    color *= uBrightness;

    if (uScanLines > 0.0) {
      float scanLine = sin((vWorldY * uScanLineDensity + uTime * uScanLineSpeed) * PI) * 0.5 + 0.5;
      color *= 1.0 - uScanLines * (1.0 - scanLine) * 0.3;
    }

    // The far side of the cylinder reads as behind rather than merely smaller.
    color *= mix(0.15, 1.0, smoothstep(0.0, 0.5, vDepthFade));
    color += color * uEmission;

    float distFade = 1.0 - smoothstep(uDistanceFadeStart, uDistanceFadeEnd, abs(vWorldY));

    float flicker = 1.0;
    if (uFlickerIntensity > 0.0) {
      float t = uTime * uFlickerSpeed;
      float f1 = sin(t * 13.0) * 0.5 + 0.5;
      float f2 = sin(t * 37.0 + 1.7) * 0.5 + 0.5;
      float f3 = sin(t * 59.0 + 4.1) * 0.5 + 0.5;
      float combined = f1 * f2 + f3 * 0.3;
      float glitchSeed = fract(sin(floor(t * 8.0)) * 43758.5453);
      combined = mix(combined, 0.1, step(0.92, glitchSeed));
      flicker = 1.0 - uFlickerIntensity * (1.0 - clamp(combined, 0.3, 1.0));
    }

    // Frame and brackets are drawn over whatever alpha the cutout has, and
    // contribute their own — so a frame is visible even where the subject is
    // not, which is the only reason to have one.
    vec3 borderGlow = uBorderColor * (1.0 + uBorderEmission);
    float frame = 0.0;
    if (uBorderWidth > 0.0) {
      vec2 q = abs(vUv - 0.5);
      float edge = max(q.x, q.y);
      frame = step(0.5 - uBorderWidth, edge);
    }
    float corners = uCornerSize > 0.0
      ? cornerMask(vUv, uCornerSize, uCornerWidth, uCornerOffset)
      : 0.0;
    float chrome = max(frame, corners);
    color = mix(color, borderGlow, chrome);

    float finalAlpha = max(alpha, chrome) * uOpacity * distFade;

    // Premultiplied output. Straight alpha on a DoubleSide transparent mesh
    // haloes wherever a soft matte edge meets the dark scene, because the
    // blend interpolates toward whatever RGB sits under a nearly-zero alpha.
    gl_FragColor = vec4(color * flicker * finalAlpha, finalAlpha);
  }
`;
