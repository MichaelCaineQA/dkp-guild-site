import { COMBAT_ROLES, computeBalance, getGamePhase } from '@dkp/shared';
import { CombatRoleBadge } from '../components/status-badge';

// Демо связки с @dkp/shared — реальные данные придут с API на этапе 1.
// Якорь игрового времени в проде берётся из настроек гильдии (модель Setting).
const DEMO_GAME_CONFIG = {
  anchor: new Date('2020-01-01T00:00:00Z'),
  dayMinutes: 90,
  nightMinutes: 30,
};

export default function HomePage() {
  const balance = computeBalance([{ amount: 10 }, { amount: -4 }, { amount: 10 }]);
  const phase = getGamePhase(new Date(), DEMO_GAME_CONFIG);

  return (
    <main style={{ padding: 24 }}>
      <h1>ДКП-система гильдии</h1>
      <p>
        Этап 0: каркас монорепо. Продуктовые экраны появятся на этапе 1 —
        см. <a href="https://github.com/MichaelCaineQA/dkp-guild-site/blob/main/docs/PLAN.md">docs/PLAN.md</a>.
      </p>
      <div className="card">
        <h2>Проверка ядра</h2>
        <p>Баланс из журнала ДКП (10 − 4 + 10): {balance}</p>
        <p>
          Игровое время сейчас: {phase.phase === 'DAY' ? '☀ день' : '🌙 ночь'}
        </p>
        <p>
          Роли в бою:{' '}
          {COMBAT_ROLES.map((role) => (
            <CombatRoleBadge key={role} role={role} />
          ))}
        </p>
      </div>
    </main>
  );
}
