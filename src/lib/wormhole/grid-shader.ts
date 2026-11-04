// The green grid the wormhole sits inside.
//
// Straight from cortiz2894/showcase-images' BackgroundGrid, which is the piece
// that gives that scene its look: a large cylinder enclosing the gallery,
// rendered on its inside face, ruled with a major/minor grid and a dot at every
// major intersection. Radius 32 against the gallery's 6, so the images travel
// through the middle of it.
//
// Two details do the work. It is drawn on `BackSide` — you are inside the
// cylinder looking out at its far wall. And the fragment stage fades out the
// part of the wall directly behind the gallery (`uHorizontalFade`), so the grid
// reads as walls to the left and right rather than as a backdrop pasted behind
// the subject.

export const gridVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const gridFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uGridSize;
  uniform float uSubdivisions;
  uniform float uMajorLineWidth;
  uniform float uMinorLineWidth;
  uniform float uDotSize;
  uniform vec3 uMajorLineColor;
  uniform vec3 uMinorLineColor;
  uniform vec3 uDotColor;
  uniform float uMajorLineOpacity;
  uniform float uMinorLineOpacity;
  uniform float uDotOpacity;
  uniform vec3 uBgColor;
  uniform float uBgOpacity;
  uniform float uTileX;
  uniform float uTileY;

  // Hide the wall directly behind the gallery, keep the sides.
  uniform float uHorizontalFade;
  uniform float uHorizontalFadeSoftness;

  varying vec2 vUv;

  void main() {
    // Tiled, because the cylinder's own UVs are one unit around and the grid
    // needs many cells per revolution.
    vec2 uv = vec2(vUv.x * uTileX, vUv.y * uTileY);

    // Major grid: distance to the nearest cell edge, in both axes.
    float cellSize = uGridSize;
    vec2 majorGrid = mod(uv, cellSize);
    vec2 majorDist = min(majorGrid, cellSize - majorGrid);
    float majorLine = min(majorDist.x, majorDist.y);
    float majorMask = 1.0 - smoothstep(0.0, uMajorLineWidth, majorLine);

    // Minor grid, subdivided inside each major cell. Masked by the major grid
    // so the two do not double up along shared lines.
    float subCellSize = cellSize / uSubdivisions;
    vec2 minorGrid = mod(uv, subCellSize);
    vec2 minorDist = min(minorGrid, subCellSize - minorGrid);
    float minorLine = min(minorDist.x, minorDist.y);
    float minorMask = 1.0 - smoothstep(0.0, uMinorLineWidth, minorLine);
    minorMask *= (1.0 - majorMask);

    // A dot at every major intersection.
    vec2 nearestMajor = floor(uv / cellSize + 0.5) * cellSize;
    float distToDot = length(uv - nearestMajor);
    float dotMask = 1.0 - smoothstep(0.0, uDotSize, distToDot);

    // vUv.x runs 0..1 around the cylinder, so distance from 0.5 is how far
    // round the side a fragment is: 0 straight ahead, 1 directly behind.
    float horzDist = abs(vUv.x - 0.5) * 2.0;
    float horzMask = smoothstep(uHorizontalFade, uHorizontalFade + uHorizontalFadeSoftness, horzDist);

    vec3 color = uBgColor;
    float alpha = uBgOpacity;

    color = mix(color, uMinorLineColor, minorMask * uMinorLineOpacity);
    alpha = max(alpha, minorMask * uMinorLineOpacity);

    color = mix(color, uMajorLineColor, majorMask * uMajorLineOpacity);
    alpha = max(alpha, majorMask * uMajorLineOpacity);

    color = mix(color, uDotColor, dotMask * uDotOpacity);
    alpha = max(alpha, dotMask * uDotOpacity);

    alpha *= horzMask;

    // Premultiplied, to match the gallery's own blend mode. The reference uses
    // straight alpha with three's default blending; mixing the two in one
    // scene puts a dark rim on every grid line where it crosses the fade.
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;
