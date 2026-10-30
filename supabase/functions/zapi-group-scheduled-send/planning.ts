export interface PlannedRoute { instance_id: string | null; base: string }

/** Group order is preserved inside each instance's independent lane. */
export function partitionGroupRoutes<T extends PlannedRoute>(routes: T[]): T[][] {
  const lanes = new Map<string, T[]>();
  for (const route of routes) {
    const key = route.instance_id || "unassigned";
    const lane = lanes.get(key) || [];
    lane.push(route);
    lanes.set(key, lane);
  }
  return [...lanes.values()];
}