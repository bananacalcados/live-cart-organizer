export interface ContactActivity {
  lastIn: string | null;
  lastOut: string | null;
}

export function isLiveContactUnread(activity: ContactActivity | undefined, seenAt = 0): boolean {
  const incoming = Date.parse(activity?.lastIn || "") || 0;
  const outgoing = Date.parse(activity?.lastOut || "") || 0;
  return incoming > Math.max(outgoing, seenAt);
}

export function compareLiveContacts(
  a: { unread: boolean; lastIncomingAt: string | null; createdAt: string; key: string },
  b: { unread: boolean; lastIncomingAt: string | null; createdAt: string; key: string },
): number {
  if (a.unread !== b.unread) return a.unread ? -1 : 1;
  const timeA = Date.parse((a.unread && a.lastIncomingAt) || a.createdAt) || 0;
  const timeB = Date.parse((b.unread && b.lastIncomingAt) || b.createdAt) || 0;
  return timeB - timeA || a.key.localeCompare(b.key);
}