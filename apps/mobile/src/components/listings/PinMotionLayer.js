// The Browse map's merge and split motion, ported from web's MapView.js
// (animateIn / animateOut). A Mapbox layer cannot animate one pin on its own,
// so the pins that are entering or leaving are drawn by this second layer for
// PIN_MOTION_MS while JS steps their opacity, size and offset. Only this
// component re-renders on each frame, so the static layer's shape (every other
// pin) is not rebuilt during the motion.
import { memo, useEffect, useMemo, useState } from "react";
import { Easing } from "react-native";
import Mapbox from "../../lib/mapbox";
import { worldPoint } from "../../lib/mapPinGroups";
import { PIN_LAYER_STYLE, pinFeature } from "./pinIcons";

// Web's PIN_MOTION: 220ms, cubic-bezier(0.2, 0, 0, 1).
const PIN_MOTION_MS = 220;
const ease = Easing.bezier(0.2, 0, 0, 1);
const IDENTITY = { opacity: 1, scale: 1, ox: 0, oy: 0 };

// What changes between two sets of pins (see buildPins in BrowseMapView),
// following web's rules. A new pin starts from the pin its first listing was
// in before: the same listing changing state (selected or not) grows or
// shrinks in place; a pin split off a larger group slides out of it; anything
// else fades in. A pin going away heads for the pin its first listing is in
// now: one joining a larger group slides into it while fading; the same
// listing changing state just goes; anything else fades where it is.
// `hidden` holds the entering pins' keys, which the static layer leaves out
// until the motion ends.
export function pinTransition(prev, next, zoom) {
  const prevKeys = new Set(prev.map((p) => p.key));
  const nextKeys = new Set(next.map((p) => p.key));
  const cameFrom = new Map();
  prev.forEach((p) => p.members.forEach((l) => cameFrom.set(l._id, p)));
  const wentTo = new Map();
  next.forEach((p) => p.members.forEach((l) => wentTo.set(l._id, p)));
  const scale = 2 ** zoom;
  // Screen offset from one pin to another.
  const offsetTo = (from, to) => {
    const a = worldPoint(from.lng, from.lat);
    const b = worldPoint(to.lng, to.lat);
    return { ox: (b.x - a.x) * scale, oy: (b.y - a.y) * scale };
  };

  const entering = next
    .filter((pin) => !prevKeys.has(pin.key))
    .map((pin) => {
      const source = cameFrom.get(pin.members[0]._id);
      if (source && !source.isCluster && !pin.isCluster) {
        return { pin, from: { ...IDENTITY, scale: source.size / pin.size }, to: IDENTITY };
      }
      const split = source && source.members.length > pin.members.length;
      return { pin, from: { ...IDENTITY, opacity: 0, scale: 0.6, ...(split ? offsetTo(pin, source) : {}) }, to: IDENTITY };
    });
  const leaving = prev
    .filter((pin) => !nextKeys.has(pin.key))
    .flatMap((pin) => {
      const target = wentTo.get(pin.members[0]._id);
      if (target && !target.isCluster && !pin.isCluster) return [];
      const merge = target && target.members.length > pin.members.length;
      return [{ pin, from: IDENTITY, to: { ...IDENTITY, opacity: 0, scale: 0.6, ...(merge ? offsetTo(pin, target) : {}) } }];
    });
  return { moves: [...entering, ...leaving], hidden: new Set(entering.map((m) => m.pin.key)) };
}

const lerp = (a, b, t) => a + (b - a) * t;

export const PinMotionLayer = memo(function PinMotionLayer({ transition, onDone }) {
  // The progress is stored with the transition it belongs to, so a new
  // transition starts from 0 on its first render rather than from where the
  // last one ended.
  const [frame, setFrame] = useState({ transition: null, t: 0 });
  const t = frame.transition === transition ? frame.t : 0;

  useEffect(() => {
    if (!transition) return undefined;
    const start = Date.now();
    let id;
    const tick = () => {
      const linear = Math.min(1, (Date.now() - start) / PIN_MOTION_MS);
      setFrame({ transition, t: ease(linear) });
      if (linear < 1) id = requestAnimationFrame(tick);
      else onDone(transition);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [transition, onDone]);

  const shape = useMemo(
    () => ({
      type: "FeatureCollection",
      features: (transition?.moves ?? []).map(({ pin, from, to }) =>
        pinFeature(pin, {
          opacity: lerp(from.opacity, to.opacity, t),
          scale: lerp(from.scale, to.scale, t),
          ox: lerp(from.ox, to.ox, t),
          oy: lerp(from.oy, to.oy, t),
        })
      ),
    }),
    [transition, t]
  );

  return (
    <Mapbox.ShapeSource id="listings-motion-source" shape={shape}>
      <Mapbox.SymbolLayer id="listings-motion-icons" style={PIN_LAYER_STYLE} />
    </Mapbox.ShapeSource>
  );
});
