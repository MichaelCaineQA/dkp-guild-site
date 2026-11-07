'use client';

import { useEffect, useState } from 'react';
import { getGamePhase, type GamePhaseConfig } from '@dkp/shared';
import { PhaseIndicator } from './ui';
import { api } from '../lib/api';

interface GameTimeState {
  phase: 'DAY' | 'NIGHT';
  /** Секунд до смены фазы. */
  secondsLeft: number;
  switchesAt: Date;
}

/**
 * Виджет игрового времени в шапке (план 2.1): иконка солнце/луна и отсчёт
 * до смены фазы. Якорь и длительности — из настроек гильдии (/settings/game-time).
 */
export function GameTimeWidget() {
  const [showDetails, setShowDetails] = useState(false);
  const [config, setConfig] = useState<GamePhaseConfig | null>(null);
  const [state, setState] = useState<GameTimeState | null>(null);

  useEffect(() => {
    api<{ gameTimeAnchor: string; gameTimeDayMinutes: number; gameTimeNightMinutes: number }>(
      '/settings/game-time',
    )
      .then((data) =>
        setConfig({
          anchor: new Date(data.gameTimeAnchor),
          dayMinutes: data.gameTimeDayMinutes,
          nightMinutes: data.gameTimeNightMinutes,
        }),
      )
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    const tick = () => {
      const now = new Date();
      if (now < config.anchor) {
        return; // якорь в будущем — фазу не считаем
      }
      const { phase, switchesAt } = getGamePhase(now, config);
      setState({
        phase,
        switchesAt,
        secondsLeft: Math.max(0, Math.round((switchesAt.getTime() - now.getTime()) / 1000)),
      });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [config]);

  if (!state) {
    return null;
  }

  const mm = String(Math.floor(state.secondsLeft / 60)).padStart(2, '0');
  const ss = String(state.secondsLeft % 60).padStart(2, '0');

  return (
    <PhaseIndicator
      phase={state.phase}
      timer={`${mm}:${ss}`}
      details={`Смена фазы: ${state.switchesAt.toLocaleString('ru-RU')}`}
      open={showDetails}
      onToggle={() => setShowDetails((value) => !value)}
    />
  );
}
