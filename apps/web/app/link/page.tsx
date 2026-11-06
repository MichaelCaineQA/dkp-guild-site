'use client';

import { useState } from 'react';
import {
  COMBAT_ROLES,
  COMBAT_ROLE_LABELS,
  createLinkRequestSchema,
  type CombatRole,
  type Weapon,
} from '@dkp/shared';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  Field,
  Select,
  WeaponPicker,
  Input,
  Notice,
  Page,
  PageHeader,
} from '../../components/ui';

/** Заявка на привязку Discord-аккаунта к нику члена гильдии (план 2.9). */
export default function LinkPage() {
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<CombatRole | ''>('');
  const [weapons, setWeapons] = useState<Array<Weapon | ''>>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'ok' | 'error'>('idle');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const input = createLinkRequestSchema.safeParse({ nickname, combatRole: role, weapons });
    if (!input.success) {
      setResult('error');
      return;
    }
    setBusy(true);
    setResult('idle');
    try {
      await api('/auth/link-request', {
        method: 'POST',
        body: JSON.stringify(input.data),
      });
      setResult('ok');
    } catch {
      setResult('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        title="Привязка игрового ника"
        subtitle="Твой Discord пока не связан с профилем члена гильдии"
      />
      <Card>
        <p className="text-sm text-secondary">
          Укажи игровой ник — офицер подтвердит заявку, и профили объединятся.
        </p>
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={submit}>
          <Input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="Игровой ник"
            minLength={2}
            maxLength={40}
            required
          />
          <Field label="Роль">
            <Select
              required
              value={role}
              onChange={(event) => setRole(event.target.value as CombatRole)}
            >
              <option value="" disabled>
                Выберите роль
              </option>
              {COMBAT_ROLES.map((value) => (
                <option key={value} value={value}>
                  {COMBAT_ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <WeaponPicker value={weapons} onChange={setWeapons} />
          <Button type="submit" variant="primary" disabled={busy || nickname.length < 2}>
            Отправить заявку
          </Button>
        </form>
        {result === 'ok' && (
          <Notice tone="success">✅ Заявка отправлена — дождись подтверждения офицера.</Notice>
        )}
        {result === 'error' && (
          <Notice tone="danger">
            Проверьте ник, роль и два разных оружия. Если данные верны, попробуйте отправить заявку
            позже.
          </Notice>
        )}
      </Card>
    </Page>
  );
}
