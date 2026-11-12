export function supportAiFailureAlert(total: number, failed: number): boolean {
  return total > 0 && failed / total > 0.10;
}
