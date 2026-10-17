/** Only messages explicitly sent to the presenter may interrupt the live. */
export function isPresenterMessage(alert: { alert_type?: string | null }): boolean {
  return alert.alert_type === "team_message";
}