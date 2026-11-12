'use client';

import {
  LOT_DURATION_UNIT_LABELS,
  LOT_DURATION_UNITS,
  LOT_LIMITS,
  LOT_TIMER_KIND_LABELS,
  LOT_TIMER_KINDS,
  type LotDefaults,
  type LotDurationUnit,
  type LotTimerKind,
} from '@dkp/shared';
import { Field, Input, Muted, Select } from './ui';

/**
 * Общие поля формы лота (план 6, п. 1): тип таймера, стартовая цена, шаг,
 * длительность, анти-снайп и тайм-аут без ставок. Используются лотом по дропу
 * в проведении ивента (loot-panel) и лотом вне ивента (#137).
 */
export interface LotParamsState {
  timerKind: LotTimerKind;
  startPrice: string;
  step: string;
  durationValue: string;
  durationUnit: LotDurationUnit;
  antiSnipeSec: string;
  noBidTimeoutSec: string;
}

/** Начальные значения полей из дефолтов для выбранного типа таймера. */
export function lotParamsFromDefaults(
  kind: LotTimerKind,
  defaults: LotDefaults,
): LotParamsState {
  if (kind === 'FIRST_BID') {
    return {
      timerKind: kind,
      startPrice: String(defaults.startPrice),
      step: String(defaults.step),
      durationValue: String(defaults.live.durationValue),
      durationUnit: defaults.live.durationUnit,
      antiSnipeSec: String(defaults.live.antiSnipeSec),
      noBidTimeoutSec: String(defaults.live.noBidTimeoutSec),
    };
  }
  return {
    timerKind: kind,
    startPrice: String(defaults.startPrice),
    step: String(defaults.step),
    durationValue: String(defaults.long.durationValue),
    durationUnit: defaults.long.durationUnit,
    antiSnipeSec: String(defaults.long.antiSnipeSec),
    noBidTimeoutSec: '',
  };
}

/**
 * Смена типа таймера подставляет длительность и анти-снайп этого типа;
 * стартовая цена и шаг остаются как ввёл пользователь.
 */
export function switchLotParams(
  state: LotParamsState,
  defaults: LotDefaults,
  timerKind: LotTimerKind,
): LotParamsState {
  if (state.timerKind === timerKind) return state;
  if (timerKind === 'FIRST_BID') {
    return {
      ...state,
      timerKind,
      durationValue: String(defaults.live.durationValue),
      durationUnit: 'MINUTES',
      antiSnipeSec: String(defaults.live.antiSnipeSec),
      noBidTimeoutSec: String(defaults.live.noBidTimeoutSec),
    };
  }
  return {
    ...state,
    timerKind,
    durationValue: String(defaults.long.durationValue),
    durationUnit: 'DAYS',
    antiSnipeSec: String(defaults.long.antiSnipeSec),
  };
}

/** Числовой payload полей для zod-схемы создания лота. */
export function lotParamsPayload(state: LotParamsState) {
  return {
    startPrice: Number(state.startPrice),
    step: Number(state.step),
    timerKind: state.timerKind,
    durationValue: Number(state.durationValue),
    durationUnit: state.durationUnit,
    antiSnipeSec: Number(state.antiSnipeSec),
    noBidTimeoutSec:
      state.timerKind === 'FIRST_BID' ? Number(state.noBidTimeoutSec) : undefined,
  };
}

/** Поля формы лота; состояние заменяется целиком через onChange. */
export function LotParamsFields({
  state,
  defaults,
  onChange,
}: {
  state: LotParamsState;
  defaults: LotDefaults;
  onChange: (next: LotParamsState) => void;
}) {
  const patch = (part: Partial<LotParamsState>) => onChange({ ...state, ...part });
  return (
    <>
      <Field label="Тип таймера">
        <Select
          value={state.timerKind}
          onChange={(e) => onChange(switchLotParams(state, defaults, e.target.value as LotTimerKind))}
        >
          {LOT_TIMER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LOT_TIMER_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Стартовая цена">
        <Input
          type="number"
          min={LOT_LIMITS.startPrice.min}
          max={LOT_LIMITS.startPrice.max}
          step={1}
          value={state.startPrice}
          onChange={(e) => patch({ startPrice: e.target.value })}
        />
      </Field>
      <Field label="Минимальный шаг ставки">
        <Input
          type="number"
          min={LOT_LIMITS.step.min}
          max={LOT_LIMITS.step.max}
          step={1}
          value={state.step}
          onChange={(e) => patch({ step: e.target.value })}
        />
      </Field>
      <Field label="Длительность">
        <Input
          type="number"
          min={0}
          step={state.durationUnit === 'MINUTES' ? 0.5 : 1}
          value={state.durationValue}
          onChange={(e) => patch({ durationValue: e.target.value })}
        />
        <Select
          value={state.durationUnit}
          onChange={(e) => patch({ durationUnit: e.target.value as LotDurationUnit })}
          aria-label="Единица длительности"
        >
          {LOT_DURATION_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {LOT_DURATION_UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Анти-снайп, сек (окно и продление)">
        <Input
          type="number"
          min={LOT_LIMITS.antiSnipeSec.min}
          max={LOT_LIMITS.antiSnipeSec.max}
          step={1}
          value={state.antiSnipeSec}
          onChange={(e) => patch({ antiSnipeSec: e.target.value })}
        />
      </Field>
      {state.timerKind === 'FIRST_BID' && (
        <Field label="Тайм-аут без ставок, сек">
          <Input
            type="number"
            min={LOT_LIMITS.noBidTimeoutSec.min}
            max={LOT_LIMITS.noBidTimeoutSec.max}
            step={1}
            value={state.noBidTimeoutSec}
            onChange={(e) => patch({ noBidTimeoutSec: e.target.value })}
          />
        </Field>
      )}
      <Muted>
        Наценка «чужим» классам по настройкам гильдии: {defaults.markupPct}% —
        зафиксируется на лоте при создании.
      </Muted>
    </>
  );
}
