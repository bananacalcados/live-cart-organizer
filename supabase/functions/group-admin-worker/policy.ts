export function classifyActionError(status: number, result: { code?: string } | null, error: string) {
  if (result?.code === 'GROUP_FORBIDDEN' || status === 403 || /GROUP_FORBIDDEN|forbidden|not.?admin|403|sem permiss[aã]o/i.test(error)) {
    return { permanent: true, instanceFailure: false, message: 'Número não é admin do grupo' };
  }
  if (result?.code === 'UNSUPPORTED_ACTION') {
    return { permanent: true, instanceFailure: false, message: error };
  }
  return { permanent: false, instanceFailure: true, message: error };
}

// Claim counts the initial attempt; attempts 1 and 2 can each retry once.
export const canRetry = (attempts: number) => attempts < 3;

export function supportsGroupAction(provider: string, action: string) {
  const common = ['set_only_admins_send', 'set_only_admins_add', 'promote_admin', 'demote_admin', 'add_participant', 'remove_participant'];
  return (provider === 'wasender' ? common : provider === 'uazapi' || provider === 'zapi'
    ? [...common, 'rename', 'set_description', 'set_photo', 'pin_message'] : []).includes(action);
}