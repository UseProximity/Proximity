// Unit selector and lease options for the listing detail page. Mirrors the web's
// unit tabs + LeaseOptions (ListingModalInfo.js, LeaseOptions.js): a tab per
// unit, the open unit's identity, then one card per landlord with every lease
// they offer on it. The ordering, labels and grouping come from
// @proximity/shared (formatters/leases.js), ported from the web.
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { Bath, BedDouble, ChevronDown, ChevronUp, LayoutGrid, Ruler, X } from "lucide-react-native";
import {
  LEASE_SORTS,
  groupLeasesByLandlord,
  landlordLeaseSummary,
  leaseAvailabilityLabel,
  leaseDurationLabel,
  leasePriceLabel,
  leaseTermList,
  leaseTypeLabel,
} from "@proximity/shared";
import { ChatAvatar } from "../chat/ChatAvatar";
import { Button } from "../ui/Button";
import { ERROR_MESSAGES } from "../../lib/errorMessages";
import { showError } from "../../lib/showError";
import { colors, shadows } from "../../theme/tokens";

// A long list of landlords opens on the first few and grows on request.
const PAGE = 5;

// The open floor plan: a white panel on the dark backdrop (so a transparent plan stays
// readable), sized in pixels like the chat photo viewer. A PDF, or an image that fails
// to load, cannot be shown here, so it hands the file to `onOpenBrowser` instead.
// Mounted only while open, so its load state starts fresh each time.
function FloorPlanViewer({ url, onClose, onOpenBrowser }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState("loading");
  const unsupported = /\.pdf($|\?)/i.test(url) || status === "error";
  // Leaves room below the close button (top inset + 8 + 40) and above the bottom inset.
  const panelW = width - 32;
  const panelH = height - insets.top - insets.bottom - 72;

  return (
    <Pressable
      className="flex-1 bg-black/80 items-center justify-end"
      style={{ paddingBottom: insets.bottom + 16 }}
      onPress={onClose}
    >
      <Pressable
        className="bg-white rounded-2xl overflow-hidden items-center justify-center"
        style={{ width: panelW, height: panelH }}
      >
        {unsupported ? (
          <View className="items-center px-6">
            <Text className="text-sm text-gray-700 text-center mb-4">
              {status === "error" ? ERROR_MESSAGES.LISTINGS.FLOOR_PLAN_LOAD : "This floor plan is a PDF."}
            </Text>
            <Button onPress={() => onOpenBrowser(url)}>View floor plan</Button>
          </View>
        ) : (
          <>
            <Image
              source={{ uri: url }}
              resizeMode="contain"
              resizeMethod="resize"
              style={{ width: panelW, height: panelH }}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
            />
            {status === "loading" ? (
              <View className="absolute inset-0 items-center justify-center">
                <ActivityIndicator size="large" />
              </View>
            ) : null}
          </>
        )}
      </Pressable>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close floor plan"
        hitSlop={8}
        className="absolute right-4 w-10 h-10 rounded-full bg-black/50 items-center justify-center"
        style={{ top: insets.top + 8 }}
      >
        <X size={20} color="#ffffff" />
      </Pressable>
    </Pressable>
  );
}

function Cell({ label, children }) {
  return (
    <View className="w-1/2 pr-3 mb-2">
      <Text className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</Text>
      <Text className="text-xs text-gray-700">{children ?? "-"}</Text>
    </View>
  );
}

// One spec in the unit header: a small icon and its value.
function Stat({ icon: Icon, label }) {
  return (
    <View className="flex-row items-center mr-4">
      <Icon size={15} color={colors.textSecondary} strokeWidth={2} />
      <Text className="text-sm text-gray-700 ml-1.5">{label}</Text>
    </View>
  );
}

function DurationCell({ leaseTermMonths }) {
  const [open, setOpen] = useState(false);
  const months = leaseTermList(leaseTermMonths);
  const label = leaseDurationLabel(leaseTermMonths);
  // Past three terms the label is a range, so the full set sits behind a tap.
  if (months.length <= 3) return <Cell label="Duration">{label}</Cell>;
  return (
    <View className="w-1/2 pr-3 mb-2">
      <Text className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Duration</Text>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Lease terms, ${label}`}
        className="flex-row items-center"
      >
        <Text className="text-xs text-gray-700">{label}</Text>
        <View style={{ marginLeft: 2 }}>
          {open ? <ChevronUp size={12} color={colors.textMuted} /> : <ChevronDown size={12} color={colors.textMuted} />}
        </View>
      </Pressable>
      {open ? (
        <View className="flex-row flex-wrap mt-1">
          {months.map((m) => (
            <View key={m} className="rounded-full bg-gray-100 px-1.5 py-0.5 mr-1 mb-1">
              <Text className="text-[11px] font-medium text-gray-700">{m} mo</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function LeaseRow({ lease, inset }) {
  const [open, setOpen] = useState(false);
  const availability = leaseAvailabilityLabel(lease.availableFrom);
  const furnished = lease.furnished == null ? null : lease.furnished ? "Yes" : "No";
  const hasDetails = !!lease.description || furnished != null;
  const price = leasePriceLabel(lease.rent);

  return (
    <View className={inset ? "px-3 py-2.5" : "py-1"}>
      <View className="flex-row items-start">
        <View className="flex-1 flex-row flex-wrap">
          <View className="w-1/2 pr-3 mb-2">
            <Text className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Price</Text>
            {price ? (
              <Text className="text-sm font-semibold text-gray-900">
                {price}
                <Text className="font-normal text-gray-500">{lease.rentIsPerPerson ? "/person" : "/mo"}</Text>
              </Text>
            ) : (
              <Text className="text-sm font-semibold text-gray-600">Contact for Price</Text>
            )}
          </View>
          <View className="w-1/2 pr-3 mb-2">
            <Text className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Available on</Text>
            <Text className={`text-xs ${availability.now ? "font-semibold text-green-600" : "text-gray-700"}`}>
              {availability.text}
            </Text>
          </View>
          <DurationCell leaseTermMonths={lease.leaseTermMonths} />
          <Cell label="Lease type">{leaseTypeLabel(lease)}</Cell>
        </View>
        {hasDetails ? (
          <Pressable
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={open ? "Hide details" : "Show details"}
            accessibilityState={{ expanded: open }}
            hitSlop={8}
            className="p-2"
          >
            {open ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
          </Pressable>
        ) : null}
      </View>

      {open && hasDetails ? (
        <View className="mt-1 rounded-lg bg-gray-50 px-3 py-2.5">
          {lease.description ? <Text className="text-xs leading-5 text-gray-700">{lease.description}</Text> : null}
          {furnished != null ? (
            <Text className={`text-xs text-gray-600 ${lease.description ? "mt-2" : ""}`}>
              <Text className="text-gray-400">Furnished </Text>
              {furnished}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// One landlord on this unit: who they are, one Contact, and their options. A
// single option sits open under the name; several fold behind a one-line
// summary.
function LandlordCard({ group, onContact }) {
  const { landlordName, landlordImage, leases } = group;
  const single = leases.length === 1;
  const [open, setOpen] = useState(false);
  const expanded = single || open;

  return (
    <View className="px-4 py-3 border-t border-gray-100">
      <View className="flex-row items-center">
        <ChatAvatar name={landlordName} image={landlordImage} size={36} />
        <View className="flex-1 min-w-0 mx-3">
          <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
            {landlordName ?? "Landlord"}
          </Text>
          {single ? (
            <Text className="text-xs text-gray-500">1 lease option</Text>
          ) : (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              className="flex-row items-center"
            >
              <Text className="text-xs text-gray-500 shrink" numberOfLines={1}>
                {landlordLeaseSummary(leases)}
              </Text>
              <View style={{ marginLeft: 2 }}>
                {open ? <ChevronUp size={14} color={colors.textMuted} /> : <ChevronDown size={14} color={colors.textMuted} />}
              </View>
            </Pressable>
          )}
        </View>
        {onContact ? (
          <Pressable
            onPress={() => onContact(leases[0])}
            accessibilityRole="button"
            accessibilityLabel={`Contact ${landlordName ?? "landlord"}`}
            className="rounded-xl bg-red-600 active:bg-red-700 px-4 py-2.5"
          >
            <Text className="text-sm font-semibold text-white">Contact</Text>
          </Pressable>
        ) : null}
      </View>

      {expanded ? (
        <View className={`mt-3 ${single ? "" : "rounded-lg border border-gray-100 bg-gray-50"}`}>
          {leases.map((lease, i) => (
            <View key={lease.id} className={i > 0 ? "border-t border-gray-100" : ""}>
              <LeaseRow lease={lease} inset={!single} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Keyed by unit by the parent, so a different unit starts from the top with the
// default sort.
function LeaseList({ leases, onContact }) {
  const [sortBy, setSortBy] = useState("price");
  const [shown, setShown] = useState(PAGE);
  const groups = groupLeasesByLandlord(leases, sortBy);
  const visible = groups.slice(0, shown);
  const remaining = groups.length - visible.length;

  return (
    <View>
      {leases.length > 1 ? (
        <View className="px-4 pt-3 pb-2">
          <Text className="text-xs text-gray-500">
            {leases.length} lease options
            {groups.length > 1 ? ` from ${groups.length} landlords` : ""}
          </Text>
          <View className="flex-row items-center flex-wrap mt-2">
            <Text className="text-xs text-gray-500 mr-2 mb-1">Sort by</Text>
            {Object.entries(LEASE_SORTS).map(([key, s]) => (
              <Pressable
                key={key}
                onPress={() => setSortBy(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: sortBy === key }}
                className={`px-3 py-1 rounded-full border mr-2 mb-1 ${
                  sortBy === key ? "bg-red-600 border-red-600" : "bg-white border-gray-300"
                }`}
              >
                <Text className={`text-xs font-medium ${sortBy === key ? "text-white" : "text-gray-700"}`}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {visible.map((group) => (
        <LandlordCard key={group.key} group={group} onContact={onContact} />
      ))}

      {groups.length > PAGE ? (
        <View className="flex-row items-center justify-center border-t border-gray-100 px-4 py-2.5">
          {remaining > 0 ? (
            <Pressable onPress={() => setShown((n) => n + PAGE)} accessibilityRole="button" className="px-3 py-1.5">
              <Text className="text-xs font-semibold text-red-600">
                Show {Math.min(PAGE, remaining)} more <Text className="font-normal text-gray-400">({remaining} left)</Text>
              </Text>
            </Pressable>
          ) : null}
          {shown > PAGE ? (
            <Pressable onPress={() => setShown(PAGE)} accessibilityRole="button" className="px-3 py-1.5">
              <Text className="text-xs font-medium text-gray-500">Show less</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// `tabs` is buildUnitTabs(listing.unitTypes). `onContact(lease)` is omitted when
// the landlord cannot be messaged, which hides the Contact buttons.
export function UnitLeases({ tabs, selectedIdx, onSelectIdx, onContact }) {
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);
  // iOS cannot present a browser sheet over an open Modal, so "View floor plan" closes the
  // viewer first and the sheet opens once it has gone: from the Modal's onDismiss on iOS,
  // which Android never calls, so there it follows after a short delay. On iOS that timer
  // is only a safety net, as onDismiss normally opens the sheet first.
  const pendingUrl = useRef(null);
  if (!tabs.length) return null;

  const selected = tabs[selectedIdx] ?? tabs[0];
  const unit = selected.unit;
  // An absent `leases` key means "not loaded yet"; an empty array means none on
  // offer. They read differently.
  const loading = unit.leases === undefined;
  const leases = unit.leases ?? [];

  const openPending = () => {
    const url = pendingUrl.current;
    pendingUrl.current = null;
    if (url) WebBrowser.openBrowserAsync(url).catch(() => showError(ERROR_MESSAGES.LISTINGS.FLOOR_PLAN_OPEN));
  };
  const openInBrowser = (url) => {
    pendingUrl.current = url;
    setFloorPlanOpen(false);
    setTimeout(openPending, Platform.OS === "ios" ? 1000 : 350);
  };

  return (
    <View className="bg-white rounded-2xl border border-gray-50 overflow-hidden" style={shadows.subtle}>
      {tabs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          {tabs.map((tab, i) => {
            const active = i === selectedIdx;
            return (
              <Pressable
                key={tab.unit.id ?? i}
                onPress={() => onSelectIdx(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={`flex-1 px-4 py-2 border-b-2 items-center justify-center ${
                  active ? "bg-red-600 border-red-600" : "bg-red-50 border-red-200"
                }`}
              >
                <Text className={`text-sm font-semibold ${active ? "text-white" : "text-red-600"}`} numberOfLines={1}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View className="flex-row items-center px-4 py-3">
        <View className="flex-1 pr-3">
          {unit.name ? (
            <Text className="text-base font-bold text-gray-900 mb-1" numberOfLines={2}>
              {unit.name}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap items-center">
            <Stat icon={BedDouble} label={(unit.bedrooms ?? 0) === 0 ? "Studio" : `${unit.bedrooms} bed`} />
            <Stat icon={Bath} label={`${unit.bathrooms ?? "?"} bath`} />
            {unit.area != null ? <Stat icon={Ruler} label={`${Number(unit.area).toLocaleString("en-US")} sq ft`} /> : null}
          </View>
        </View>
        {unit.floorPlanImageUrl ? (
          <Pressable
            onPress={() => setFloorPlanOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="View floor plan"
            hitSlop={6}
            className="flex-row items-center rounded-full border border-red-200 bg-red-50 active:bg-red-100 px-3 py-1.5"
          >
            <LayoutGrid size={13} color={colors.primary} />
            <Text className="text-xs font-semibold text-red-600 ml-1.5">Floor plan</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View className="flex-row items-center px-4 py-4">
          <ActivityIndicator size="small" />
          <Text className="text-xs text-gray-500 ml-2">Loading lease options…</Text>
        </View>
      ) : leases.length === 0 ? (
        <Text className="px-4 py-4 text-xs text-gray-500">No lease is currently being offered on this unit.</Text>
      ) : (
        <LeaseList key={unit.id ?? selectedIdx} leases={leases} onContact={onContact} />
      )}

      <Modal
        visible={floorPlanOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFloorPlanOpen(false)}
        onDismiss={openPending}
      >
        {floorPlanOpen && unit.floorPlanImageUrl ? (
          <FloorPlanViewer
            key={unit.id ?? selectedIdx}
            url={unit.floorPlanImageUrl}
            onClose={() => setFloorPlanOpen(false)}
            onOpenBrowser={openInBrowser}
          />
        ) : null}
      </Modal>
    </View>
  );
}
