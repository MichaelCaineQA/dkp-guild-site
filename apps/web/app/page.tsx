import { COMBAT_ROLES, computeBalance, getGamePhase } from '@dkp/shared';
import { CombatRoleBadge } from '../components/status-badge';
import { Badge, Card, Muted, Page, PageHeader, SectionTitle } from '../components/ui';

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
    <Page>
      <PageHeader
        title="ДКП-система гильдии"
        subtitle="Расписание ивентов, посещение с чек-ин кодами, аукцион лута и статистика"
      />
      <Card>
        <SectionTitle>Проверка ядра</SectionTitle>
        <p className="mt-2 text-sm text-primary">
          Баланс из журнала ДКП (10 − 4 + 10): <Badge tone="accent">{balance}</Badge>
        </p>
        <p className="mt-2 text-sm text-primary">
          Игровое время сейчас: {phase.phase === 'DAY' ? '☀ день' : '🌙 ночь'}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-sm text-primary">
          Роли в бою:{' '}
          {COMBAT_ROLES.map((role) => (
            <CombatRoleBadge key={role} role={role} />
          ))}
        </p>
        <p className="mt-3 text-sm">
          <Muted>
            Продуктовые экраны появляются по этапам плана — см.{' '}
            <a
              className="text-accent hover:underline"
              href="https://github.com/MichaelCaineQA/dkp-guild-site/blob/main/docs/PLAN.md"
            >
              docs/PLAN.md
            </a>
            .
          </Muted>
        </p>
      </Card>
    </Page>
  );
}
