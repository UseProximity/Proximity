// Rating teardrop pin. Ported from apps/web/src/components/listings/MapView.js's
// buildPinSVGElement — a white dot for unreviewed listings, or a star clipped to
// the fractional rating (gold when a perfect 5), matching web's Browse map pins.
// Forwards a ref to the underlying Svg so PinIconAtlas can rasterize instances
// (via Svg#toDataURL) into static images for the map's SymbolLayer — several
// instances render side by side in the atlas, so gradient/clip ids are
// namespaced per instance to avoid collisions, mirroring web's per-marker safeId.
import { forwardRef } from "react";
import Svg, { Defs, LinearGradient, Stop, ClipPath, Rect, Path, Circle } from "react-native-svg";

const PIN_PATH =
  "M2.10342 24.897C4.01562 32.1187 12.8496 42.2217 17.49 47.001C22.6189 42.2217 30.6445 31.1218 32.8766 24.897C35.6237 17.2363 34.3335 1.67745 17.4901 1.00098C1.36353 1.67745 -0.827361 17.1308 2.10342 24.897Z";
const STAR_PATH =
  "M17.0293 8.79004C17.1878 8.34883 17.8122 8.34883 17.9707 8.79004L20.4404 15.668C20.6507 16.2534 21.2013 16.6479 21.8232 16.6602L29.2773 16.8076C29.7553 16.817 29.9486 17.427 29.5635 17.71L23.6768 22.0293C23.1599 22.4086 22.9415 23.0747 23.1328 23.6865L25.2832 30.5664C25.4241 31.0173 24.9192 31.3935 24.5273 31.1299L18.3379 26.9619C17.8315 26.621 17.1685 26.621 16.6621 26.9619L10.4727 31.1299C10.0808 31.3935 9.57593 31.0173 9.7168 30.5664L11.8672 23.6865C12.0585 23.0747 11.8401 22.4086 11.3232 22.0293L5.43652 17.71C5.05135 17.427 5.24468 16.817 5.72266 16.8076L13.1768 16.6602C13.7987 16.6479 14.3493 16.2534 14.5596 15.668L17.0293 8.79004Z";

const STAR_BOTTOM = 31.4;
const STAR_HEIGHT = 23.06;

export const ListingMapPin = forwardRef(function ListingMapPin({ rating, isActive, uid = "default" }, ref) {
  const hasRating = rating != null && rating > 0;
  const pinBodyStop2 = isActive ? "#FFDFDF" : "#E8000B";
  const pinBodyStopOpacity = isActive ? 0.9 : 1;
  const pgId = `pg-${uid}`;
  const sgId = `sg-${uid}`;
  const scId = `sc-${uid}`;

  if (!hasRating) {
    const circleFill = isActive ? "#FFA2A2" : "#FFFFFF";
    return (
      <Svg ref={ref} width={35} height={49} viewBox="0 0 35 49">
        <Defs>
          <LinearGradient id={pgId} x1="17.5" y1="1" x2="17.5" y2="47" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="0.18" stopColor={pinBodyStop2} stopOpacity={pinBodyStopOpacity} />
          </LinearGradient>
        </Defs>
        <Path d={PIN_PATH} fill={`url(#${pgId})`} stroke="#E8000B" strokeWidth={2} />
        <Circle cx={17.5} cy={20} r={5.5} fill={circleFill} opacity={0.9} />
      </Svg>
    );
  }

  const fillHeight = (rating / 5) * STAR_HEIGHT;
  const clipY = STAR_BOTTOM - fillHeight;
  const isGold = rating >= 5 && !isActive;
  const starFill = isGold ? `url(#${sgId})` : isActive ? "#FFA2A2" : "#FFFFF6";
  const starStroke = isGold ? `url(#${sgId})` : isActive ? "#FFA2A2" : "#FFFFF6";

  return (
    <Svg ref={ref} width={35} height={49} viewBox="0 0 35 49">
      <Defs>
        <LinearGradient id={pgId} x1="17.5" y1="1" x2="17.5" y2="47" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.18" stopColor={pinBodyStop2} stopOpacity={pinBodyStopOpacity} />
        </LinearGradient>
        {isGold && (
          <LinearGradient id={sgId} x1="17.5" y1="8.2" x2="17.5" y2="31.4" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#D69121" />
            <Stop offset="0.45" stopColor="#F7D14A" />
            <Stop offset="0.78" stopColor="#F7EF84" />
            <Stop offset="1" stopColor="#FFFDEB" />
          </LinearGradient>
        )}
        <ClipPath id={scId}>
          <Rect x={4} y={clipY} width={27} height={fillHeight} />
        </ClipPath>
      </Defs>
      <Path d={PIN_PATH} fill={`url(#${pgId})`} stroke="#E8000B" strokeWidth={2} />
      <Path d={STAR_PATH} fill={starFill} clipPath={`url(#${scId})`} />
      <Path d={STAR_PATH} fill="none" stroke={starStroke} strokeWidth={0.75} />
    </Svg>
  );
});
