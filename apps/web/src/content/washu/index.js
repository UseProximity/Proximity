/*
 * Static import map for /washu page copy. The JSON files are the ONLY thing
 * the content-refresh workflow edits; this index changes only when a page is
 * added or removed (which also touches lib/washuPages.js).
 */
import pillar from "./_pillar.json";
import studioApartments from "./studio-apartments.json";
import oneBedroomApartments from "./1-bedroom-apartments.json";
import twoBedroomApartments from "./2-bedroom-apartments.json";
import threeBedroomApartments from "./3-bedroom-apartments.json";
import apartmentsUnder1000 from "./apartments-under-1000.json";
import apartmentsUnder1500 from "./apartments-under-1500.json";
import universityCityApartments from "./university-city-apartments.json";
import delmarLoopApartments from "./delmar-loop-apartments.json";
import claytonApartments from "./clayton-apartments.json";
import centralWestEndApartments from "./central-west-end-apartments.json";
import demunApartments from "./demun-apartments.json";
import skinkerDebaliviereApartments from "./skinker-debaliviere-apartments.json";

export const washuContent = {
  _pillar: pillar,
  "studio-apartments": studioApartments,
  "1-bedroom-apartments": oneBedroomApartments,
  "2-bedroom-apartments": twoBedroomApartments,
  "3-bedroom-apartments": threeBedroomApartments,
  "apartments-under-1000": apartmentsUnder1000,
  "apartments-under-1500": apartmentsUnder1500,
  "university-city-apartments": universityCityApartments,
  "delmar-loop-apartments": delmarLoopApartments,
  "clayton-apartments": claytonApartments,
  "central-west-end-apartments": centralWestEndApartments,
  "demun-apartments": demunApartments,
  "skinker-debaliviere-apartments": skinkerDebaliviereApartments,
};
