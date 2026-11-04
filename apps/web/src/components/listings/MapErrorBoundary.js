/*
 * Keeps a map failure inside the map. Mapbox GL needs WebGL2, and its Map constructor
 * throws when that is missing (or the token is empty). That throw happens in an effect,
 * and with no error boundary React would unmount the whole page, listing details and
 * Contact included. Wrap every Mapbox map in this so only the map's box is replaced by
 * a message. `className` sizes that box to match the map it replaces.
 */
"use client";

import { Component } from "react";

export default class MapErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 px-4 text-center text-sm text-gray-500 ${this.props.className ?? ""}`}
      >
        Map unavailable on this device.
      </div>
    );
  }
}
