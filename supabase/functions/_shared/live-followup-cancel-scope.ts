type CancelJob = {
  id: string;
  type: string;
  order_id: string | null;
  sequence_key: string;
};

/** Cart ownership stops only the redundant initial job, not its payment sequence. */
export function cancelScope(reason: string, job: CancelJob): {
  column: 'id' | 'order_id' | 'sequence_key';
  value: string;
} {
  if (reason === 'cart_already_contacted' && (job.type === 'B' || job.type === 'C')) {
    return { column: 'id', value: job.id };
  }
  return job.order_id
    ? { column: 'order_id', value: job.order_id }
    : { column: 'sequence_key', value: job.sequence_key };
}