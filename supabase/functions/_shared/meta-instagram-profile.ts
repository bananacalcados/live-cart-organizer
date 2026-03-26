interface InstagramConversationParticipant {
  id?: string;
  username?: string;
}

interface InstagramConversationResponse {
  data?: Array<{
    participants?: {
      data?: InstagramConversationParticipant[];
    };
  }>;
}

export async function fetchInstagramSenderUsername(accessToken: string, senderId: string) {
  const url = new URL('https://graph.instagram.com/v25.0/me/conversations');
  url.searchParams.set('platform', 'instagram');
  url.searchParams.set('user_id', senderId);
  url.searchParams.set('fields', 'id,participants');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Instagram conversations lookup failed with status ${response.status}`);
  }

  const payload = await response.json() as InstagramConversationResponse;
  for (const conversation of payload.data || []) {
    for (const participant of conversation.participants?.data || []) {
      if (participant.id === senderId && participant.username) {
        return `@${participant.username}`;
      }
    }
  }

  return null;
}