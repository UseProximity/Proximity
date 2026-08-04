/*
 * Client shell for /messages: applies ?thread=<uuid> once, then renders MessagesPanel
 * at full height under the sticky site header.
 */
"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMessages } from "@/context/MessagesContext";
import MessagesPanel from "@/components/chat/MessagesPanel";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function MessagesPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");
  const { setActiveThreadId, markThreadRead } = useMessages();
  const appliedThreadRef = useRef(null);

  useEffect(() => {
    if (!threadParam || !UUID_RE.test(threadParam)) return;
    if (appliedThreadRef.current === threadParam) return;
    appliedThreadRef.current = threadParam;
    setActiveThreadId(threadParam);
    markThreadRead(threadParam).catch(() => {});
  }, [threadParam, setActiveThreadId, markThreadRead]);

  return (
    <div className="h-[calc(100dvh-83px)] md:h-[calc(100dvh-104px)] border-t border-gray-100">
      <MessagesPanel onBrowse={() => router.push("/browse")} />
    </div>
  );
}
