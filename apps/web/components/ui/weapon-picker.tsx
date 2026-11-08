import { WEAPONS, WEAPON_LABELS, type Weapon } from '@dkp/shared';
import { Field, Select } from './controls';

export function WeaponPicker({
  value,
  onChange,
  required = true,
}: {
  value: readonly (Weapon | '')[];
  onChange: (weapons: Array<Weapon | ''>) => void;
  required?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-wrap gap-3 [&_label]:flex-wrap [&_select]:max-w-full">
      <legend className="mb-2 text-sm">Класс (два разных оружия)</legend>
      {[0, 1].map((index) => (
        <Field key={index} label={index === 0 ? 'Первое оружие' : 'Второе оружие'}>
          <Select
            required={required}
            value={value[index] ?? ''}
            onChange={(event) => {
              const next: Array<Weapon | ''> = [value[0] ?? '', value[1] ?? ''];
              next[index] = event.target.value as Weapon | '';
              onChange(next);
            }}
          >
            <option value="" disabled>
              Выберите оружие
            </option>
            {WEAPONS.map((weapon) => (
              <option key={weapon} value={weapon} disabled={value[1 - index] === weapon}>
                {WEAPON_LABELS[weapon]}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </fieldset>
  );
}
