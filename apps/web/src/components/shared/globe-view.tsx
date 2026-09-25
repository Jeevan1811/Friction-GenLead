"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { Map as LeafletMap, LayerGroup as LeafletLayerGroup } from "leaflet";
import type { Location } from "@/lib/types";

interface GlobeViewProps {
  locations: Location[];
}

type LeafletModule = typeof import("leaflet");

const DEFAULT_CENTER: [number, number] = [15, 0];
const DEFAULT_ZOOM = 2;

function PopupContent({ rows }: { rows: Location[] }): HTMLElement {
  const root = document.createElement("div");
  root.className = "genlead-map-popup";

  for (const row of rows.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "genlead-map-popup-item";
    const name = document.createElement("strong");
    name.textContent = row.siteName || "Saved business location";
    item.appendChild(name);

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

export function GlobeView({ locations }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const markersRef = useRef<LeafletLayerGroup | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const mappableLocations = useMemo(
    () => locations.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng)),
    [locations],
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
      const marker = leaflet.circleMarker([lat, lng], {
        radius: rows.length > 1 ? 9 : 7,
        color: "#FFFFFF",
        weight: 2,
        fillColor: "#C8372D",
        fillOpacity: 0.95,
      });
      marker.bindPopup(PopupContent({ rows }));
      if (rows.length > 1) marker.bindTooltip(String(rows.length), { permanent: true, direction: "center", className: "genlead-map-count" });
      marker.addTo(layer);
    }

    if (points.length === 1) {
      map.setView(points[0], 13);
    } else if (points.length > 1) {
      map.fitBounds(leaflet.latLngBounds(points), { padding: [28, 28], maxZoom: 13 });
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [mappableLocations, status]);

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
        {status === "ready" && mappableLocations.length === 0 && (
          <div className="genlead-map-empty" role="status">
            No saved locations have coordinates yet. New mapped prospects appear here; Australian postcode-only records use approximate postcode centres.
          </div>
        )}
      </div>
      <p className="genlead-map-credit">
        Map data © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a>
      </p>
    </>
  );
}
