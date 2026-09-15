/** Speeds a replay can run at. Shared by the playbar and storage. */
export const REPLAY_SPEEDS = [0.1, 1, 2, 3] as const;

export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Normal pace by default; 0.1 is there for following a line stroke by stroke. */
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 1;

/** Coerce anything stored or typed into one of the allowed speeds. */
export function normaliseSpeed(value: unknown): ReplaySpeed {
  const speed = Number(value);
  return REPLAY_SPEEDS.includes(speed as ReplaySpeed)
    ? (speed as ReplaySpeed)
    : DEFAULT_REPLAY_SPEED;
}
