"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Map as LeafletMap, LayerGroup as LeafletLayerGroup, Layer, Marker } from "leaflet";
import type { Company, Location } from "@/lib/types";

interface GlobeViewProps {
  locations: Location[];
  companiesById: ReadonlyMap<string, Company>;
  focusKey: string;
  focusResults: boolean;
}

type LeafletModule = typeof import("leaflet");
type MarkerOrigin = "saved" | "prospect" | "unknown";

const PUBLIC_SOURCES = new Set([
  "ABR",
  "FIRECRAWL_SEARCH",
  "OPENSTREETMAP",
  "OVERTURE_MAPS",
]);

function originForCompany(company: Company | undefined): MarkerOrigin {
  const source = String(company?.source ?? "").trim().toUpperCase();
  if (["LEGACY_EXCEL", "LEGACY_SHEET", "MSV_WORKBOOK"].includes(source)) return "saved";
  if (PUBLIC_SOURCES.has(source)) return "prospect";
  return "unknown";
}

const ORIGIN_LABELS: Record<MarkerOrigin, string> = {
  saved: "From MSV’s workbook",
  prospect: "Public-source prospect",
  unknown: "Source not recorded",
};

function countOrigins(rows: Location[], origins: ReadonlyMap<string, MarkerOrigin>) {
  const counts: Record<MarkerOrigin, number> = { saved: 0, prospect: 0, unknown: 0 };
  for (const row of rows) counts[origins.get(row.companyId) ?? "unknown"] += 1;
  return counts;
}

function markerKind(counts: Record<MarkerOrigin, number>): MarkerOrigin | "mixed" {
  const present = (Object.keys(counts) as MarkerOrigin[]).filter((key) => counts[key] > 0);
  return present.length === 1 ? present[0] : "mixed";
}

function markerIconHtml(rows: Location[], origins: ReadonlyMap<string, MarkerOrigin>): string {
  const counts = countOrigins(rows, origins);
  const total = Math.max(rows.length, 1);
  const savedStop = Math.round((counts.saved / total) * 100);
  const prospectStop = savedStop + Math.round((counts.prospect / total) * 100);
  const kind = markerKind(counts);
  const label = rows.length > 1 ? `<b class="genlead-map-marker-count">${rows.length}</b>` : "";
  return `<span class="genlead-map-marker genlead-map-marker--${kind}" style="--genlead-saved-stop:${savedStop}%;--genlead-prospect-stop:${prospectStop}%" aria-hidden="true">${label}</span>`;
}

function markerTitle(rows: Location[], origins: ReadonlyMap<string, MarkerOrigin>): string {
  const counts = countOrigins(rows, origins);
  return [
    counts.saved ? `${counts.saved} from MSV’s workbook` : "",
    counts.prospect ? `${counts.prospect} public-source` : "",
    counts.unknown ? `${counts.unknown} source not recorded` : "",
  ].filter(Boolean).join(" · ");
}

const DEFAULT_CENTER: [number, number] = [15, 0];
const DEFAULT_ZOOM = 2;

function PopupContent({ rows, origins }: { rows: Location[]; origins: ReadonlyMap<string, MarkerOrigin> }): HTMLElement {
  const root = document.createElement("div");
  root.className = "genlead-map-popup";

  for (const row of rows.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "genlead-map-popup-item";
    const name = document.createElement("strong");
    name.className = "genlead-map-popup-title";
    name.textContent = row.siteName || "Saved business location";
    item.appendChild(name);

    const origin = document.createElement("span");
    const kind = origins.get(row.companyId) ?? "unknown";
    origin.className = `genlead-map-origin-badge genlead-map-origin-badge--${kind}`;
    origin.textContent = ORIGIN_LABELS[kind];
    item.appendChild(origin);

    const detail = [row.suburb, row.state, row.postcode, row.country]
      .filter(Boolean)
      .join(", ");
    if (detail) {
      const address = document.createElement("div");
      address.className = "genlead-map-popup-address";
      address.textContent = detail;
      item.appendChild(address);
    }
    if (row.coordinateSource === "POSTCODE_CENTROID") {
      const accuracy = document.createElement("small");
      accuracy.textContent = "Approximate postcode centre";
      item.appendChild(accuracy);
    }
    if (row.companyId) {
      const link = document.createElement("a");
      link.className = "genlead-map-popup-link";
      link.href = `/companies?companyId=${encodeURIComponent(row.companyId)}`;
      link.textContent = "View company";
      item.appendChild(link);
    }
    root.appendChild(item);
  }

  if (rows.length > 8) {
    const more = document.createElement("small");
    more.textContent = `and ${rows.length - 8} more locations at this point`;
    root.appendChild(more);
  }
  return root;
}

function popupDimensions(map: LeafletMap) {
  const size = map.getSize();
  // Reserve the content margins, close target and auto-pan gutter. Leaflet's
  // intrinsic sizing otherwise allows a long badge to collapse the title.
  const width = Math.max(120, Math.min(288, size.x - 96));
  return { minWidth: width, maxWidth: width, maxHeight: Math.max(120, Math.min(300, size.y - 100)) };
}

function zoomToLocations(map: LeafletMap, leaflet: LeafletModule, locations: Location[]) {
  const points: [number, number][] = [];
  const seen = new Set<string>();
  for (const row of locations) {
    const point: [number, number] = [Number(row.lat), Number(row.lng)];
    const key = `${point[0]},${point[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }

  if (points.length === 1) {
    map.setView(points[0], 13);
  } else if (points.length > 1) {
    map.fitBounds(leaflet.latLngBounds(points), { padding: [28, 28], maxZoom: 13 });
  }
}

export function GlobeView({ locations, companiesById, focusKey, focusResults }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const markersRef = useRef<LeafletLayerGroup | null>(null);
  const focusedKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [tilesDelayed, setTilesDelayed] = useState(false);

  const mappableLocations = useMemo(
    () => locations.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng)),
    [locations],
  );
  const originByCompanyId = useMemo(() => {
    const result = new Map<string, MarkerOrigin>();
    for (const [companyId, company] of companiesById) result.set(companyId, originForCompany(company));
    return result;
  }, [companiesById]);
  const originCounts = useMemo(
    () => countOrigins(mappableLocations, originByCompanyId),
    [mappableLocations, originByCompanyId],
  );

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let tileTimeout: ReturnType<typeof setTimeout> | undefined;
    let anyTileLoaded = false;

    async function initializeMap() {
      if (!containerRef.current) return;
      try {
        const leaflet = await import("leaflet");
        if (cancelled || !containerRef.current) return;
        leafletRef.current = leaflet;

        const map = leaflet.map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          minZoom: 2,
          worldCopyJump: true,
          scrollWheelZoom: true,
          preferCanvas: true,
        });
        const tiles = leaflet.tileLayer(
          process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
          },
        );
        tiles.on("tileload", () => {
          anyTileLoaded = true;
          if (!cancelled) {
            setTilesLoaded(true);
            setTilesDelayed(false);
          }
        });
        tiles.addTo(map);
        tileTimeout = setTimeout(() => {
          if (!cancelled && !anyTileLoaded) setTilesDelayed(true);
        }, 8000);
        markersRef.current = leaflet.layerGroup().addTo(map);
        mapRef.current = map;
        resizeObserver = new ResizeObserver(() => map.invalidateSize());
        resizeObserver.observe(containerRef.current);
        setStatus("ready");
      } catch (error) {
        console.error("[LocationMap] Failed to initialize map:", error);
        if (!cancelled) setStatus("error");
      }
    }

    void initializeMap();
    return () => {
      cancelled = true;
      if (tileTimeout) clearTimeout(tileTimeout);
      resizeObserver?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    const layer = markersRef.current;
    if (status !== "ready" || !map || !leaflet || !layer) return;

    const locationIdsByMarker = new Map<Layer, string>();
    const renderMarkers = () => {
      // Zooming rebuilds screen-space clusters. Keep the selected record open
      // rather than discarding its card when a resize finishes a pending zoom.
      let selectedLocationId: string | undefined;
      layer.eachLayer((marker) => {
        if (marker.isPopupOpen()) selectedLocationId = locationIdsByMarker.get(marker);
      });
      layer.clearLayers();
      locationIdsByMarker.clear();
      let selectedMarker: Marker | undefined;
      const groups = new Map<string, Location[]>();
      for (const row of mappableLocations) {
        // Screen-space buckets keep nearby red/teal points visible as one
        // mixed marker at overview zoom, and avoid thousands of DOM markers.
        const projected = map.project([Number(row.lat), Number(row.lng)], map.getZoom());
        const key = `${Math.floor(projected.x / 36)},${Math.floor(projected.y / 36)}`;
        const current = groups.get(key) ?? [];
        current.push(row);
        groups.set(key, current);
      }

      for (const rows of groups.values()) {
        const first = rows[0];
        const marker = leaflet.marker([Number(first.lat), Number(first.lng)], {
          title: markerTitle(rows, originByCompanyId),
          alt: markerTitle(rows, originByCompanyId),
          keyboard: true,
          icon: leaflet.divIcon({
            className: "genlead-map-div-icon",
            html: markerIconHtml(rows, originByCompanyId),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        });
        marker.bindPopup(PopupContent({ rows, origins: originByCompanyId }), {
          ...popupDimensions(map),
          className: "genlead-map-popover",
          autoPanPadding: [12, 12],
          keepInView: true,
        });
        if (rows.length > 1) marker.bindTooltip(markerTitle(rows, originByCompanyId), { direction: "top", className: "genlead-map-count" });
        marker.addTo(layer);
        locationIdsByMarker.set(marker, first.locationId);
        if (selectedLocationId && rows.some((row) => row.locationId === selectedLocationId)) selectedMarker = marker;
      }
      selectedMarker?.openPopup();
    };

    renderMarkers();
    const resizePopups = () => {
      layer.eachLayer((marker) => {
        const popup = marker.getPopup();
        if (!popup) return;
        Object.assign(popup.options, popupDimensions(map));
        if (popup.isOpen()) popup.update();
      });
    };
    map.on("zoomend", renderMarkers);
    map.on("resize", resizePopups);
    return () => { map.off("zoomend", renderMarkers); map.off("resize", resizePopups); };
  }, [mappableLocations, originByCompanyId, status]);

  // Keep the familiar world overview until a filter is applied. Filtering
  // reveals matching points; Sheet refreshes never override a user's camera.
  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (status !== "ready" || !map || !leaflet || focusedKeyRef.current === focusKey) return;
    if (mappableLocations.length === 0) {
      focusedKeyRef.current = null;
      return;
    }
    if (focusResults) {
      zoomToLocations(map, leaflet, mappableLocations);
    } else {
      const bounds = leaflet.latLngBounds(mappableLocations.map((row) => [Number(row.lat), Number(row.lng)] as [number, number]));
      map.setView(bounds.getCenter(), DEFAULT_ZOOM, { animate: false });
    }
    focusedKeyRef.current = focusKey;
  }, [focusKey, focusResults, mappableLocations, status]);

  return (
    <>
      <div className="surface-card genlead-map-card" aria-label="Saved business locations map">
        <div ref={containerRef} className="genlead-map-canvas" />
        {status === "ready" && mappableLocations.length > 0 && (
          <button
            type="button"
            className="genlead-map-fit-control"
            onClick={() => {
              const map = mapRef.current;
              const leaflet = leafletRef.current;
              if (map && leaflet) zoomToLocations(map, leaflet, mappableLocations);
            }}
          >
            <MapPin size={16} aria-hidden="true" />
            Zoom to results
          </button>
        )}
        {status === "loading" && (
          <div className="genlead-map-overlay">
            <MapPin size={28} />
            <span>Loading map…</span>
          </div>
        )}
        {status === "error" && (
          <div className="genlead-map-overlay" role="status">
            <MapPin size={28} />
            <span>Map could not load. Check your connection and reload the page.</span>
          </div>
        )}
        {status === "ready" && (
          <div className={mappableLocations.length ? "genlead-map-summary" : "genlead-map-empty"} role="status" aria-live="polite">
            {locations.length === 0
              ? "No matching locations"
              : mappableLocations.length === 0
                ? `${locations.length.toLocaleString()} without coordinates · see list below`
                : `${mappableLocations.length.toLocaleString()} / ${locations.length.toLocaleString()} mapped${locations.length > mappableLocations.length ? ` · ${(locations.length - mappableLocations.length).toLocaleString()} without coordinates` : ""}`}
          </div>
        )}
        {status === "ready" && !tilesLoaded && !tilesDelayed && (
          <div className="genlead-map-tile-status" role="status" aria-live="polite">
            Loading map tiles…
          </div>
        )}
      </div>
      {status === "ready" && !tilesLoaded && tilesDelayed && (
        <p className="genlead-map-tile-notice" role="status" aria-live="polite">Map tiles unavailable · points still shown</p>
      )}
      <div className="genlead-map-legend" role="list" aria-label="Map marker legend">
        {(["saved", "prospect", "unknown"] as MarkerOrigin[])
          .filter((origin) => originCounts[origin] > 0)
          .map((origin) => (
            <div
              className="genlead-map-legend-item"
              role="listitem"
              aria-label={`${ORIGIN_LABELS[origin]}: ${originCounts[origin].toLocaleString()} mapped locations`}
              key={origin}
            >
              <span className={`genlead-map-marker genlead-map-marker--${origin}`} aria-hidden="true" />
              <span>{ORIGIN_LABELS[origin]}</span>
              <strong>{originCounts[origin].toLocaleString()}</strong>
            </div>
          ))}
      </div>
      <p className="genlead-map-credit">
        <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a>
      </p>
    </>
  );
}
