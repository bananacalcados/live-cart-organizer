type Config = Record<string, any>;

/** Store both outcomes by stable step ID, not mutable list position. */
export function waitReplyBranches(config: Config, fallbackNextId?: string): Record<string, string> {
  const branches = config.buttonBranches || {};
  const replied = branches['btn-replied'] || config.nextStepId || fallbackNextId;
  const timeout = branches['btn-timeout'];
  return {
    ...(config.branches || {}),
    __wait_reply__: 'true',
    __timeout_action__: timeout ? 'continue' : (config.timeoutAction || 'cancel'),
    __timeout_message__: config.timeoutMessage || '',
    __timeout_template__: config.timeoutTemplateName || '',
    __timeout_tag__: config.timeoutTag || '',
    ...(replied ? { __replied__: replied } : { __reply_stop__: 'true' }),
    ...(timeout ? { __timeout__: timeout } : {}),
  };
}

export function waitReplyExpiresAt(config: Config, now = Date.now()): string {
  const hours = Number(config.timeoutHours) || 24;
  return new Date(now + Math.max(1, hours) * 3_600_000).toISOString();
}

export function replyTarget(branches: Record<string, string>, isButton: boolean, text: string): string | null {
  if (branches.__wait_reply__ === 'true') return branches.__replied__ || null;
  if (isButton) {
    const entry = Object.entries(branches).find(([key]) => !key.startsWith('__') && key.toLowerCase() === text.trim().toLowerCase());
    return entry?.[1] || null;
  }
  return null;
}
