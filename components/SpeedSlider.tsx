"use client";

import { REPLAY_SPEEDS } from "@/lib/replay";

type SpeedSliderProps = {
  value: number;
  onChange: (speed: number) => void;
};

/**
 * Replay speed as a slider that snaps to the allowed speeds.
 *
 * The steps are not evenly spaced as numbers (0.1 to 3), so the slider runs
 * over the index and the value is looked up. That makes every stop reachable
 * by dragging or with an arrow key, and puts the ticks at even intervals.
 */
export function SpeedSlider({ value, onChange }: SpeedSliderProps) {
  const last = REPLAY_SPEEDS.length - 1;
  const index = Math.max(0, REPLAY_SPEEDS.indexOf(value as (typeof REPLAY_SPEEDS)[number]));

  return (
    <div className="speed-slider">
      <div className="speed-track">
        <div className="speed-ticks" aria-hidden>
          {REPLAY_SPEEDS.map((speed, i) => (
            <span
              key={speed}
              className="speed-tick"
              data-passed={i <= index || undefined}
              style={{ left: `calc(0.5rem + ${(i / last) * 100}% - ${(i / last) * 1}rem)` }}
            />
          ))}
        </div>
        <input
          type="range"
          className="range"
          min={0}
          max={last}
          step={1}
          value={index}
          aria-label="Replay speed"
          aria-valuetext={`${REPLAY_SPEEDS[index]} times speed`}
          onChange={(event) => onChange(REPLAY_SPEEDS[Number(event.target.value)])}
        />
      </div>
      <span className="micro speed-read">{REPLAY_SPEEDS[index]}</span>
    </div>
  );
}
