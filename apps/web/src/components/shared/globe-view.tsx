"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Map as LeafletMap, LayerGroup as LeafletLayerGroup } from "leaflet";
import type { Company, Location } from "@/lib/types";

interface GlobeViewProps {
  locations: Location[];
  companiesById: ReadonlyMap<string, Company>;
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
  unknown: "Origin not recorded",
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
    counts.unknown ? `${counts.unknown} origin not recorded` : "",
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
      address.textContent = detail;
      item.appendChild(address);
    }
    if (row.coordinateSource === "POSTCODE_CENTROID") {
      const accuracy = document.createElement("small");
      accuracy.textContent = "Approximate postcode centre";
      item.appendChild(accuracy);
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

export function GlobeView({ locations, companiesById }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const markersRef = useRef<LeafletLayerGroup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
        leaflet.tileLayer(
          process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
          },
        ).addTo(map);
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

    layer.clearLayers();
    const groups = new Map<string, Location[]>();
    for (const row of mappableLocations) {
      const key = `${row.lat},${row.lng}`;
      const current = groups.get(key) ?? [];
      current.push(row);
      groups.set(key, current);
    }

    const points: [number, number][] = [];
    for (const rows of groups.values()) {
      const first = rows[0];
      const lat = Number(first.lat);
      const lng = Number(first.lng);
      points.push([lat, lng]);
      const marker = leaflet.marker([lat, lng], {
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
      marker.bindPopup(PopupContent({ rows, origins: originByCompanyId }));
      if (rows.length > 1) marker.bindTooltip(markerTitle(rows, originByCompanyId), { direction: "top", className: "genlead-map-count" });
      marker.addTo(layer);
    }

    if (points.length === 1) {
      map.setView(points[0], 13);
    } else if (points.length > 1) {
      map.fitBounds(leaflet.latLngBounds(points), { padding: [28, 28], maxZoom: 13 });
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [mappableLocations, originByCompanyId, status]);

  return (
    <>
      <div className="surface-card genlead-map-card" aria-label="Saved business locations map">
        <div ref={containerRef} className="genlead-map-canvas" />
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
              ? "No locations match these filters. Change or clear a filter below."
              : mappableLocations.length === 0
                ? `${locations.length.toLocaleString()} matching locations have no coordinates. They remain available in the list below.`
                : `${mappableLocations.length.toLocaleString()} of ${locations.length.toLocaleString()} matching locations mapped${locations.length > mappableLocations.length ? ` · ${ (locations.length - mappableLocations.length).toLocaleString()} without coordinates` : ""}.`}
          </div>
        )}
      </div>
      <div className="genlead-map-legend" role="list" aria-label="Map marker legend">
        {(["saved", "prospect", "unknown"] as MarkerOrigin[]).map((origin) => (
          <div
            className="genlead-map-legend-item"
            role="listitem"
            aria-label={`${ORIGIN_LABELS[origin]}: ${originCounts[origin].toLocaleString()} mapped locations`}
            key={origin}
          >
            <span className={`genlead-map-marker genlead-map-marker--${origin}`} aria-hidden="true" />
            <span>{ORIGIN_LABELS[origin]}</span>
            <strong>{originCounts[origin].toLocaleString()}</strong>
            <span className="genlead-map-legend-unit">locations</span>
          </div>
        ))}
      </div>
      <p className="genlead-map-credit">
        Map data © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a>
      </p>
    </>
  );
}
