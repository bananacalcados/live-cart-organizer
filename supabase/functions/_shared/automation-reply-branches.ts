type Config = Record<string, any>;

/** Store both outcomes by stable step ID, not mutable list position. */
export function waitReplyBranches(config: Config, fallbackNextId?: string): Record<string, string> {
  const branches = config.buttonBranches || {};
  const explicit = Object.prototype.hasOwnProperty.call(config, 'nextStepId') || Object.keys(branches).some(key => key === 'btn-replied' || key === 'btn-timeout');
  const replied = branches['btn-replied'] || config.nextStepId || (explicit ? undefined : fallbackNextId);
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
    ...(branches['btn-clicked'] ? { __clicked__: branches['btn-clicked'] } : {}),
    ...(branches['btn-reacted'] ? { __reacted__: branches['btn-reacted'] } : {}),
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

/** Follow saved edges when present; never wander into a different outcome. */
export function continuationIndices(steps: Array<{ id: string; action_config?: Config }>, start: number): number[] | null {
  const wired = steps.some(step => Object.prototype.hasOwnProperty.call(step.action_config || {}, 'nextStepId') || Object.keys(step.action_config?.buttonBranches || {}).some(key => key === 'btn-replied' || key === 'btn-timeout'));
  if (!wired) return null;
  const indices: number[] = [];
  let index = start;
  while (index >= 0 && index < steps.length && !indices.includes(index)) {
    indices.push(index);
    const nextId = steps[index].action_config?.nextStepId;
    if (!nextId) break;
    index = steps.findIndex(step => step.id === nextId);
  }
  return indices;
}

export type WaitOutcome = 'replied' | 'clicked' | 'reacted';

/** Destino de um engajamento. Clique/reação sem caminho próprio NÃO encerram a espera. */
export function engagementTarget(branches: Record<string, string>, outcome: WaitOutcome): { consume: boolean; target: string | null } {
  if (outcome === 'replied') return { consume: true, target: replyTarget(branches, false, '') };
  const t = branches[outcome === 'clicked' ? '__clicked__' : '__reacted__'];
  return t ? { consume: true, target: t } : { consume: false, target: null };
}
