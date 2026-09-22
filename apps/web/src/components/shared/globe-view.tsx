"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Location } from "@/lib/fixtures";
// Cesium touches `window`/`document` at module load time, so it must never be
// statically imported (that would break server-side rendering in Next.js).
// The CSS import is safe statically — stylesheets have no window/document dependency.
import "cesium/Build/Cesium/Widgets/widgets.css";

// Minimal shape of the Cesium module we use, so we don't have to `any` every
// call site while still avoiding a static `import type` that could pull in
// the runtime module during SSR type-checking in some bundler configs.
type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumEntity = import("cesium").Entity;

interface GlobeViewProps {
  locations: Location[];
  onSelectLocation?: (locationId: string) => void;
}

const QLD_ACCENT = "#C8372D";

/** The exact placeholder markup previously shown on the Locations page,
 * reused as a fallback whenever the globe cannot initialize (e.g. WebGL
 * unavailable) so the page degrades gracefully instead of crashing. */
function MapPlaceholder({ message }: { message: string }) {
  return (
    <div
      className="surface-card"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        marginBottom: "24px",
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
      }}
    >
      <MapPin size={32} style={{ color: "var(--color-text-muted)" }} />
      <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>{message}</p>
    </div>
  );
}

export function GlobeView({ locations, onSelectLocation }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const handlerRef = useRef<import("cesium").ScreenSpaceEventHandler | null>(null);
  const onSelectLocationRef = useRef(onSelectLocation);
  onSelectLocationRef.current = onSelectLocation;

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Initialize the viewer once on mount.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!containerRef.current) return;

      try {
        window.CESIUM_BASE_URL = "/cesium/";
        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const viewer = new Cesium.Viewer(containerRef.current, {
          timeline: false,
          animation: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          vrButton: false,
          selectionIndicator: false,
          infoBox: false,
          baseLayer: false,
          msaaSamples: 4,
          contextOptions: { webgl: { preserveDrawingBuffer: true } },
        });
        viewer.targetFrameRate = 60;
        viewer.scene.globe.show = false;
        if (viewer.scene.skyAtmosphere) {
          viewer.scene.skyAtmosphere.show = true;
        }

        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        // Route 1 -> Route 2 -> Route 3 fallback chain for photorealistic tiles.
        await loadBestAvailableImagery(Cesium, viewer);
        if (cancelled) return;

        // Click-to-select wiring.
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((movement: { position: import("cesium").Cartesian2 }) => {
          const picked = viewer.scene.pick(movement.position);
          if (picked && picked.id) {
            const entity = picked.id as CesiumEntity;
            const locationId = typeof entity.id === "string" ? entity.id : undefined;
            if (locationId && onSelectLocationRef.current) {
              onSelectLocationRef.current(locationId);
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handlerRef.current = handler;

        setStatus("ready");
      } catch (err) {
        console.warn("[GlobeView] Failed to initialize Cesium viewer:", err);
        if (!cancelled) setStatus("error");
      }
    }

    init();

    return () => {
      cancelled = true;
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          // Viewer may already be partially torn down; ignore.
        }
        viewerRef.current = null;
      }
      cesiumRef.current = null;
    };
    // Intentionally run once on mount; entity updates are handled by the
    // effect below, keyed on `locations`, so we don't recreate the Viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diff/update entities whenever the (already-filtered) locations prop changes.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (status !== "ready" || !Cesium || !viewer) return;

    try {
      viewer.entities.removeAll();

      let plotted = 0;
      for (const loc of locations) {
        if (loc.lat == null || loc.lng == null) continue;
        viewer.entities.add({
          id: loc.locationId,
          position: Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString(QLD_ACCENT),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
          },
          label: {
            text: loc.siteName,
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString("#1A1A1A").withAlpha(0.75),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            pixelOffset: new Cesium.Cartesian2(0, -18),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        plotted += 1;
      }

      if (plotted > 0) {
        viewer.zoomTo(viewer.entities);
      } else {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(146, -22, 1500000),
        });
      }
    } catch (err) {
      console.warn("[GlobeView] Failed to update entities:", err);
    }
  }, [locations, status]);

  if (status === "error") {
    return <MapPlaceholder message="Map view unavailable" />;
  }

  return (
    <div
      className="surface-card"
      style={{
        position: "relative",
        height: 420,
        marginBottom: "24px",
        overflow: "hidden",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            background: "var(--color-bg)",
          }}
        >
          <MapPin size={32} style={{ color: "var(--color-text-muted)" }} />
          <p style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            Loading globe view...
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Route 1: direct Google Maps Platform key.
 * Route 2: Cesium ion token hosting Google's photorealistic tileset (ion asset 2275207).
 * Route 3: keyless fallback — OpenStreetMap imagery on the default globe.
 * Each route is wrapped so a failure falls through to the next, and route 3
 * never throws, matching the app's "never fail open" degrade-gracefully rule.
 */
async function loadBestAvailableImagery(Cesium: CesiumModule, viewer: CesiumViewer) {
  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const cesiumIonToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;

  if (googleApiKey) {
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({
        key: googleApiKey,
        onlyUsingWithGoogleGeocoder: true,
      });
      viewer.scene.primitives.add(tileset);
      viewer.scene.globe.show = false;
      return;
    } catch (err) {
      console.warn("[GlobeView] Google Photorealistic 3D Tiles (direct key) failed:", err);
    }
  }

  if (cesiumIonToken) {
    try {
      Cesium.Ion.defaultAccessToken = cesiumIonToken;
      const resource = await Cesium.IonResource.fromAssetId(2275207, {
        accessToken: cesiumIonToken,
      });
      const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
        cacheBytes: 1536 * 1024 * 1024,
        maximumCacheOverflowBytes: 1024 * 1024 * 1024,
        enableCollision: true,
      });
      viewer.scene.primitives.add(tileset);
      viewer.scene.globe.show = false;
      return;
    } catch (err) {
      console.warn("[GlobeView] Cesium ion photorealistic tileset failed:", err);
    }
  }

  // Route 3: keyless OSM globe. Never throws.
  try {
    viewer.scene.globe.show = true;
    viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({ url: "https://a.tile.openstreetmap.org/" })
    );
  } catch (err) {
    console.warn("[GlobeView] Keyless OSM imagery failed to load:", err);
    // Leave the globe visible with no imagery layer rather than throwing —
    // pins and camera controls still work.
    viewer.scene.globe.show = true;
  }
}
