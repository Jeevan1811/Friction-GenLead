// Cesium reads this global to know where to load its Workers/Assets/Widgets
// from at runtime. It must be set before `cesium` is imported.
export {};

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}
