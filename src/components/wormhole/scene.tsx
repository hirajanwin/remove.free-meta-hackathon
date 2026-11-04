import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { Gallery } from "./gallery";
import { BackgroundGrid } from "./background-grid";
import { CentreShape } from "./centre-shape";
import { CAMERA, type WormholePreset } from "@/lib/wormhole/presets";
import type { Atlas } from "@/lib/wormhole/atlas";
import type { VirtualScroll } from "@/lib/wormhole/virtual-scroll";

interface SceneProps {
  atlas: Atlas;
  scroll: VirtualScroll;
  preset: WormholePreset;
  instanceCount: number;
  speed: number;
  imageScale: number;
  reducedMotion: boolean;
  bloom: boolean;
  /** 0 off, 1 per-instance colours, 2 depth fade, 3 flat. */
  debugMode: number;
  onCanvas: (el: HTMLCanvasElement | null) => void;
}

/**
 * Camera drift and scroll-driven pullback.
 *
 * The reference tracks the mouse across the whole window; here the listener is
 * on the canvas, so moving the pointer over the sidebar does not swing a scene
 * the user is not pointing at. Under reduced motion the drift is off entirely
 * and the camera simply sits at its base distance — unprompted movement is the
 * thing being asked about, and this moves without being asked.
 */
function CameraRig({
  scroll,
  reducedMotion,
}: {
  scroll: VirtualScroll;
  reducedMotion: boolean;
}) {
  const { camera, gl } = useThree();
  const pointer = React.useRef({ x: 0, y: 0 });
  const smoothed = React.useRef({ x: 0, y: 0 });
  const targetZoom = React.useRef(CAMERA.baseZoom);
  const currentZoom = React.useRef(CAMERA.baseZoom);

  React.useEffect(() => {
    if (reducedMotion) return;
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onLeave = () => {
      pointer.current.x = 0;
      pointer.current.y = 0;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, reducedMotion]);

  useFrame(() => {
    if (!reducedMotion) {
      smoothed.current.x +=
        (pointer.current.x - smoothed.current.x) * CAMERA.smoothing;
      smoothed.current.y +=
        (pointer.current.y - smoothed.current.y) * CAMERA.smoothing;
      camera.position.x = smoothed.current.x * CAMERA.panIntensityX;
      camera.position.y = smoothed.current.y * CAMERA.panIntensityY;
    } else {
      camera.position.x = 0;
      camera.position.y = 0;
    }

    // Scrolling fast pulls the camera back, so a flick shows more of the ring.
    // Kept under reduced motion: it is a direct response to the user's own
    // input, and losing it makes a fast scroll feel like nothing happened.
    targetZoom.current += Math.abs(scroll.velocity.current) * CAMERA.zoomSpeed;
    targetZoom.current = THREE.MathUtils.clamp(
      targetZoom.current,
      CAMERA.baseZoom,
      CAMERA.maxZoomOut,
    );
    currentZoom.current += (targetZoom.current - currentZoom.current) * 0.1;
    camera.position.z = currentZoom.current;
    targetZoom.current = THREE.MathUtils.lerp(
      targetZoom.current,
      CAMERA.baseZoom,
      1 - CAMERA.zoomDecay,
    );

    camera.lookAt(0, 0.1, 0);
  });

  return null;
}

/**
 * R3F's container is `width/height: 100%`, and it needs a parent whose height
 * is definite for that to mean anything.
 *
 * The stage is a flex item: its height comes from flex layout while its
 * specified `height` stays `auto`, and a percentage height does not resolve
 * against an auto-height parent — it becomes auto. R3F then sized itself to
 * the canvas's intrinsic 300x150 default and stayed there, because its own
 * measurement never changed afterwards; a window resize was enough to snap it
 * to the right size, which is what identified this.
 *
 * An absolutely positioned box against the relative stage is definite from the
 * first layout pass, so R3F measures correctly on mount rather than eventually.
 */
/**
 * Re-measure when the document becomes visible.
 *
 * R3F sizes its canvas from a ResizeObserver on its container, and in a hidden
 * document that observation does not arrive — the canvas keeps the HTML
 * default 300x150 inside a correctly sized box and stays there, because the
 * container's size never changes afterwards to trigger a second look. Anyone
 * who middle-clicks a link to this page and switches to the tab later lands in
 * exactly that state.
 *
 * Found while debugging: the canvas was 300x150 and a single window `resize`
 * snapped it to 501x702, which is what identified the cause as measurement
 * rather than layout.
 */
/**
 * Prompt R3F to measure again when the document becomes visible.
 *
 * R3F sizes itself from a ResizeObserver on its container, and it does not
 * call `configure` — which is what creates the renderer and mounts the scene —
 * until that observation reports a non-zero size. In a hidden document the
 * observation never arrives, so nothing inside <Canvas> exists at all and the
 * bare canvas element sits at the HTML default 300x150 forever, because the
 * container's size never changes afterwards to prompt a second look. Anyone
 * who middle-clicks a link here and switches to the tab later lands in exactly
 * that state.
 *
 * This has to live OUTSIDE <Canvas>. The first version of it was an R3F child
 * component, which cannot work: it was waiting inside the very thing that had
 * not mounted. That took a while to see, and what showed it was that a
 * `visibilitychange` never had any effect while the same `resize` dispatched
 * from the console fixed the size every time.
 *
 * A window resize rather than the store's `setSize`: it goes through R3F's own
 * measurement path, which is the one that demonstrably works.
 */
function useMeasureOnReveal() {
  React.useEffect(() => {
    const sync = () => {
      if (!document.hidden) window.dispatchEvent(new Event("resize"));
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
}

export function Scene({
  atlas,
  scroll,
  preset,
  instanceCount,
  speed,
  imageScale,
  reducedMotion,
  bloom,
  debugMode,
  onCanvas,
}: SceneProps) {
  useMeasureOnReveal();

  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0, CAMERA.baseZoom], fov: CAMERA.fov }}
        // Transparent, so the page's own background token shows through and the
        // wormhole sits in the app's surface rather than on a black plate of its
        // own. The preset's colour is painted by the wrapper element.
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        // Capped at 2: the fragment stage runs a 5x5 halftone neighbourhood per
        // pixel, so a 3x display would triple that for no visible gain.
        dpr={[1, 2]}
        onCreated={({ gl }) => onCanvas(gl.domElement)}
        style={{ touchAction: "none" }}
      >
        {/* Grid first, so it is behind everything. Suppressed in every debug
            view: the point of those is to read the gallery's own geometry, and
            a ruled cylinder behind it defeats that. */}
        {preset.grid.enabled && debugMode === 0 && (
          <BackgroundGrid grid={preset.grid} />
        )}
        <CameraRig scroll={scroll} reducedMotion={reducedMotion} />
        {preset.shape.kind !== "none" && debugMode === 0 && (
          <CentreShape
            scroll={scroll}
            shape={preset.shape}
            reducedMotion={reducedMotion}
          />
        )}
        <Gallery
          atlas={atlas}
          scroll={scroll}
          preset={preset}
          instanceCount={instanceCount}
          speed={speed}
          imageScale={imageScale}
          reducedMotion={reducedMotion}
          debugMode={debugMode}
        />
        {bloom && debugMode === 0 && (
          <EffectComposer>
            <Bloom
              intensity={preset.bloomIntensity}
              luminanceThreshold={preset.bloomThreshold}
              luminanceSmoothing={preset.bloomSmoothing}
              radius={preset.bloomRadius}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

export default Scene;
