/**
 * Audio transcription helper using OpenAI Whisper API.
 * Downloads audio from URL and returns transcribed text.
 */

export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) {
    console.error('[transcribe] OPENAI_API_KEY not configured');
    return null;
  }

  try {
    // Download audio
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const audioRes = await fetch(audioUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!audioRes.ok) {
      console.error(`[transcribe] Failed to download audio: ${audioRes.status}`);
      return null;
    }

    const audioBuffer = await audioRes.arrayBuffer();
    if (audioBuffer.byteLength === 0) {
      console.error('[transcribe] Audio file is empty');
      return null;
    }

    // Detect extension from URL or content-type
    const contentType = audioRes.headers.get('content-type') || '';
    let ext = 'ogg';
    if (contentType.includes('mp3') || contentType.includes('mpeg')) ext = 'mp3';
    else if (contentType.includes('mp4') || contentType.includes('m4a')) ext = 'm4a';
    else if (contentType.includes('wav')) ext = 'wav';
    else if (contentType.includes('webm')) ext = 'webm';

    // Build multipart form data for Whisper API
    const boundary = '----WhisperBoundary' + Date.now();
    const audioBytes = new Uint8Array(audioBuffer);

    const preamble = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="model"',
      '',
      'whisper-1',
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="audio.${ext}"`,
      `Content-Type: audio/${ext}`,
      '',
      '',
    ].join('\r\n');

    const postamble = `\r\n--${boundary}--\r\n`;

    const preambleBytes = new TextEncoder().encode(preamble);
    const postambleBytes = new TextEncoder().encode(postamble);

    const body = new Uint8Array(preambleBytes.length + audioBytes.length + postambleBytes.length);
    body.set(preambleBytes, 0);
    body.set(audioBytes, preambleBytes.length);
    body.set(postambleBytes, preambleBytes.length + audioBytes.length);

    const whisperController = new AbortController();
    const whisperTimeout = setTimeout(() => whisperController.abort(), 60000);

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
      signal: whisperController.signal,
    });
    clearTimeout(whisperTimeout);

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error(`[transcribe] Whisper error ${whisperRes.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const result = await whisperRes.json();
    const text = result.text?.trim();

    if (!text) {
      console.log('[transcribe] Whisper returned empty transcription');
      return null;
    }

    console.log(`[transcribe] OK: "${text.slice(0, 100)}..." (${audioBuffer.byteLength} bytes)`);
    return text;
  } catch (err) {
    console.error('[transcribe] Error:', err);
    return null;
  }
}
