/** Speeds a replay can run at. Shared by the toolbar, the playbar and storage. */
export const REPLAY_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3] as const;

export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Slow by default: the point of a replay is to be followed, not raced. */
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 0.25;

/** Coerce anything stored or typed into one of the allowed speeds. */
export function normaliseSpeed(value: unknown): ReplaySpeed {
  const speed = Number(value);
  return REPLAY_SPEEDS.includes(speed as ReplaySpeed)
    ? (speed as ReplaySpeed)
    : DEFAULT_REPLAY_SPEED;
}
