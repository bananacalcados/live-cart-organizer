export type SimStop = { city: string; state: string };

export type SimulationRecord = {
  tracking_code: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  stops: SimStop[];
  posted_at: string;
  step_interval_days: number;
  manual_offset_days: number;
  status: string;
};

export type TrackingEvent = {
  title: string;
  detail?: string;
  city: string;
  state: string;
  at: string; // ISO
};

/** Hash determinístico simples a partir do código, para minutos "naturais". */
const seedFrom = (code: string) => {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return h;
};

const withNaturalTime = (base: Date, code: string, index: number) => {
  const seed = seedFrom(code + ':' + index);
  const d = new Date(base);
  d.setHours(8 + (seed % 11), (seed >> 4) % 60, (seed >> 9) % 60, 0);
  return d;
};

/** Gera a linha do tempo completa (inclusive eventos futuros). */
export function buildTimeline(sim: SimulationRecord): TrackingEvent[] {
  const stops = Array.isArray(sim.stops) ? sim.stops : [];
  const interval = Math.max(1, sim.step_interval_days || 2);
  const posted = new Date(sim.posted_at);
  const offsetMs = (sim.manual_offset_days || 0) * 86400000;

  const legs: TrackingEvent[] = [];
  let index = 0;
  const at = (i: number) =>
    withNaturalTime(new Date(posted.getTime() + i * interval * 86400000 - offsetMs), sim.tracking_code, i).toISOString();

  legs.push({
    title: 'Objeto postado',
    city: sim.origin_city,
    state: sim.origin_state,
    at: withNaturalTime(new Date(posted.getTime() - offsetMs), sim.tracking_code, 0).toISOString(),
  });

  const path: SimStop[] = [
    { city: sim.origin_city, state: sim.origin_state },
    ...stops,
    { city: sim.destination_city, state: sim.destination_state },
  ];

  for (let i = 1; i < path.length; i++) {
    index = i;
    legs.push({
      title: 'Objeto em trânsito',
      detail: `de ${path[i - 1].city}/${path[i - 1].state} para ${path[i].city}/${path[i].state}`,
      city: path[i - 1].city,
      state: path[i - 1].state,
      at: at(i),
    });
  }

  index += 1;
  legs.push({
    title: 'Objeto saiu para entrega ao destinatário',
    city: sim.destination_city,
    state: sim.destination_state,
    at: at(index),
  });

  index += 1;
  legs.push({
    title: 'Objeto entregue ao destinatário',
    city: sim.destination_city,
    state: sim.destination_state,
    at: at(index),
  });

  return legs;
}

/** Apenas os eventos já ocorridos (mais recentes primeiro). */
export function visibleTimeline(sim: SimulationRecord, now: Date = new Date()): TrackingEvent[] {
  const all = buildTimeline(sim);
  const passed = all.filter((e) => new Date(e.at).getTime() <= now.getTime());
  const list = passed.length ? passed : [all[0]];
  if (sim.status === 'paused') {
    // pausada: congela no penúltimo evento ocorrido
    const frozen = list.slice(0, Math.max(1, list.length - 0));
    return frozen.reverse();
  }
  return list.reverse();
}

export function currentStatusLabel(sim: SimulationRecord, now: Date = new Date()): string {
  const visible = visibleTimeline(sim, now);
  return visible[0]?.title ?? 'Objeto postado';
}

export function estimatedDelivery(sim: SimulationRecord): string {
  const all = buildTimeline(sim);
  return all[all.length - 1].at;
}

export function generateTrackingCode(): string {
  const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  return `BC${digits}BR`;
}
