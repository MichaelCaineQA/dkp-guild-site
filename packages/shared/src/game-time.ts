export type GamePhase = 'DAY' | 'NIGHT';

export interface GamePhaseConfig {
  /** Якорь цикла: момент начала известной дневной фазы. */
  anchor: Date;
  /** Длительность дня в минутах (T&L: 90). */
  dayMinutes: number;
  /** Длительность ночи в минутах (T&L: 30). */
  nightMinutes: number;
}

export interface GamePhaseInfo {
  phase: GamePhase;
  /** Момент следующей смены фазы. */
  switchesAt: Date;
}

/**
 * Игровой цикл фиксирован: день → ночь → день… (docs/PLAN.md, раздел 2.1).
 * Привязка к реальному времени — настройка-якорь, т.к. у игры нет API.
 */
export function getGamePhase(at: Date, config: GamePhaseConfig): GamePhaseInfo {
  const cycleMs = (config.dayMinutes + config.nightMinutes) * 60_000;
  const dayMs = config.dayMinutes * 60_000;

  const sinceAnchor = at.getTime() - config.anchor.getTime();
  if (sinceAnchor < 0) {
    throw new Error('Moment is before the anchor');
  }

  const cycleIndex = Math.floor(sinceAnchor / cycleMs);
  const cycleStart = config.anchor.getTime() + cycleIndex * cycleMs;
  const inCycle = sinceAnchor % cycleMs;

  return inCycle < dayMs
    ? { phase: 'DAY', switchesAt: new Date(cycleStart + dayMs) }
    : { phase: 'NIGHT', switchesAt: new Date(cycleStart + cycleMs) };
}
