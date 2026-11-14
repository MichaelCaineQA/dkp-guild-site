'use client';
import type { EventScopeInput } from '@dkp/shared';
import { Field, Select } from './ui';

export interface EventScopeGroup {
  id: string;
  name: string;
  packs: Array<{ id: string; name: string }>;
}

export function EventScopeFields({
  value,
  groups,
  onChange,
}: {
  value: EventScopeInput;
  groups: EventScopeGroup[];
  onChange: (value: EventScopeInput) => void;
}) {
  return (
    <>
      <Field label="Состав">
        <Select
          value={value.scope}
          onChange={(e) =>
            onChange({
              scope: e.target.value as EventScopeInput['scope'],
              kpId: null,
              packId: null,
            })
          }
        >
          <option value="GUILD">Вся гильдия</option>
          <option value="KP">КП</option>
          <option value="PACK">Пак</option>
        </Select>
      </Field>
      {value.scope !== 'GUILD' && (
        <Field label="КП">
          <Select
            required
            value={value.kpId ?? ''}
            onChange={(e) => onChange({ ...value, kpId: e.target.value, packId: null })}
          >
            <option value="" disabled>
              Выберите КП
            </option>
            {groups.map((kp) => (
              <option key={kp.id} value={kp.id}>
                {kp.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.scope === 'PACK' && (
        <Field label="Пак">
          <Select
            required
            value={value.packId ?? ''}
            onChange={(e) => onChange({ ...value, packId: e.target.value })}
          >
            <option value="" disabled>
              Выберите пак
            </option>
            {(groups.find((kp) => kp.id === value.kpId)?.packs ?? []).map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}
