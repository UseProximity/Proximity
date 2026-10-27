import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "expo-router";
import apiClient from "../../lib/apiClient";
import { getErrorMessage } from "../../lib/apiError";
import { ERROR_MESSAGES } from "../../lib/errorMessages";
import {
  EMPTY_REPLY_SENDERS,
  RELOAD_DELAYS_MS,
  approvedNote,
  approvedSenderLabel,
  approvedSenders,
  bannerHasContent,
  canApproveDomain,
  declinedNote,
  fetchReplySenders,
  formatReceived,
  heldReplyWho,
} from "../../lib/heldReplies";

// Above the composer, for the landlord only: emailed replies to this conversation from
// someone who is not set up to reply for them yet. Each shows who sent it and what it
// says, with Approve (that address, or everyone at their company) and Not them.
// Approving delivers the reply in the background, so the conversation is reloaded a
// few seconds later (onDelivered). Underneath, a quiet line lists who is already
// approved, with a way to remove them. Shows nothing when there is nothing to show.
// The server decides who may see or act on any of this; the screen only mounts the
// banner for landlords.

function Action({ label, onPress, disabled, variant }) {
  const styles = {
    primary: ["rounded-lg bg-gray-900 px-3 py-2", "text-[13px] font-semibold text-white"],
    secondary: ["rounded-lg border border-gray-300 bg-white px-3 py-2", "text-[13px] font-semibold text-gray-900"],
    danger: ["px-1 py-2", "text-[13px] font-semibold text-red-700 underline"],
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`${styles[0]} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={styles[1]}>{label}</Text>
    </Pressable>
  );
}

function HeldReply({ held, busy, onDecide }) {
  return (
    <View className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
      <Text className="text-[13px] leading-5 text-amber-900">
        <Text className="font-semibold">{heldReplyWho(held)}</Text> replied for you by email on{" "}
        {formatReceived(held.receivedAt)}. It is waiting because this address is not set up to reply for you.
      </Text>
      {held.preview ? (
        <Text className="mt-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[13px] leading-5 text-gray-800">
          {held.preview}
        </Text>
      ) : null}
      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <Action label="Approve and deliver" variant="primary" disabled={busy} onPress={() => onDecide(held, "approve", "address")} />
        {canApproveDomain(held) ? (
          <Action
            label={`Approve everyone @${held.domain}`}
            variant="secondary"
            disabled={busy}
            onPress={() => onDecide(held, "approve", "domain")}
          />
        ) : null}
        <Action label="Not them" variant="danger" disabled={busy} onPress={() => onDecide(held, "decline", "address")} />
      </View>
    </View>
  );
}

export function HeldRepliesBanner({ threadId, onDelivered }) {
  const { height } = useWindowDimensions();
  const [data, setData] = useState(EMPTY_REPLY_SENDERS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { text, error }

  // The thread this banner is currently showing, or null once it unmounts. Every async
  // result checks it, so a slow answer for a previous thread (or after leaving the
  // screen) never lands on the wrong conversation.
  const activeThread = useRef(threadId);
  const loadSeq = useRef(0);
  const timers = useRef([]);
  const onDeliveredRef = useRef(onDelivered);
  onDeliveredRef.current = onDelivered;

  useEffect(() => {
    activeThread.current = threadId;
    setData(EMPTY_REPLY_SENDERS);
    setNote(null);
    setBusy(false);
    return () => {
      activeThread.current = null;
      loadSeq.current += 1;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [threadId]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    // A failed load comes back empty, so the banner hides silently rather than showing
    // earlier data or an error.
    const next = await fetchReplySenders(() => apiClient.chat.getReplySenders(threadId));
    // Only the newest request for the current thread may write, so a slow or failed
    // older one cannot clear or overwrite what a newer one loaded.
    if (activeThread.current !== threadId || seq !== loadSeq.current) return;
    setData(next);
  }, [threadId]);

  // On first show and every time the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function decide(held, decision, scope) {
    setBusy(true);
    setNote(null);
    try {
      const out = await apiClient.chat.decideReplySender(threadId, { heldId: held.id, decision, scope });
      if (activeThread.current !== threadId) return;
      if (decision === "decline") {
        setNote({ text: declinedNote(held.fromEmail) });
      } else {
        setNote({ text: approvedNote(out?.delivering) });
        // Delivery runs after the response; reload once it has had time to land.
        for (const ms of RELOAD_DELAYS_MS) {
          timers.current.push(
            setTimeout(() => {
              if (activeThread.current === threadId) onDeliveredRef.current?.();
            }, ms)
          );
        }
      }
    } catch (err) {
      if (activeThread.current !== threadId) return;
      setNote({ error: true, text: getErrorMessage(err, ERROR_MESSAGES.CHAT.REPLY_DECIDE) });
    } finally {
      if (activeThread.current === threadId) {
        setBusy(false);
        load();
      }
    }
  }

  async function remove(id) {
    setBusy(true);
    setNote(null);
    try {
      await apiClient.chat.removeReplySender(id);
    } catch (err) {
      // Already gone (404) needs no message: the reload below drops it from the list.
      if (activeThread.current === threadId && err?.status !== 404) {
        setNote({ error: true, text: getErrorMessage(err, ERROR_MESSAGES.CHAT.REPLY_REMOVE) });
      }
    } finally {
      if (activeThread.current === threadId) {
        setBusy(false);
        load();
      }
    }
  }

  if (!bannerHasContent(data, note)) return null;

  const approved = approvedSenders(data);

  return (
    <View className="px-4 pt-2">
      {/* Capped so several held replies (or an open keyboard) never take the whole screen. */}
      <ScrollView
        style={{ maxHeight: Math.min(280, Math.round(height * 0.35)) }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          {data.held.map((held) => (
            <HeldReply key={held.id} held={held} busy={busy} onDecide={decide} />
          ))}
          {note ? (
            <Text
              accessibilityLiveRegion="polite"
              className={`text-xs ${note.error ? "text-red-700" : "text-green-700"}`}
            >
              {note.text}
            </Text>
          ) : null}
          {approved.length > 0 ? (
            <View>
              <Text className="text-xs leading-5 text-gray-500">Also replying for you by email:</Text>
              <View className="flex-row flex-wrap items-center">
                {approved.map((sender, i) => (
                  <View key={sender.id} className="flex-row items-center mr-3">
                    <Text className="text-xs leading-5 text-gray-700">
                      {approvedSenderLabel(sender)}
                      {i < approved.length - 1 ? "," : ""}{" "}
                    </Text>
                    <Pressable
                      onPress={() => remove(sender.id)}
                      disabled={busy}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${approvedSenderLabel(sender)}`}
                      accessibilityState={{ disabled: busy }}
                      className={busy ? "opacity-50" : ""}
                    >
                      <Text className="text-xs text-gray-500 underline">remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
