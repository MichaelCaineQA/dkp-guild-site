import { COMBAT_ROLE_LABELS, RANK_LABELS, type PlayerProfile } from '@dkp/shared';
import { Card, Muted, SectionTitle } from './layout';
import { Table } from './data';

const ENTRY_LABELS: Record<string, string> = {
  CHECKIN_EARN: 'Чек-ин',
  MANUAL_EARN: 'Ручное начисление',
  AUCTION_SPEND: 'Покупка на аукционе',
  ADJUSTMENT: 'Корректировка',
};

export function ProfileDetails({ profile }: { profile: PlayerProfile }) {
  return (
    <Card>
      <SectionTitle>Об игроке</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt>Ник</dt>
        <dd className="break-all">{profile.nickname}</dd>
        <dt>Discord</dt>
        <dd className="break-all">{profile.discord ?? 'Не привязан'}</dd>
        <dt>Ранг</dt>
        <dd>{RANK_LABELS[profile.rank]}</dd>
        <dt>Роль в бою</dt>
        <dd>{profile.combatRole ? COMBAT_ROLE_LABELS[profile.combatRole] : 'Не указана'}</dd>
        <dt>Баланс ДКП</dt>
        <dd className="text-xl font-semibold tabular-nums">{profile.balance}</dd>
      </dl>
    </Card>
  );
}

export function ProfileHistory({ entries }: { entries: PlayerProfile['recentEntries'] }) {
  return (
    <Card>
      <SectionTitle>Последние операции ДКП</SectionTitle>
      <Muted>Последние 10 операций. Баланс учитывает весь журнал.</Muted>
      {!entries.length ? (
        <p>Операций пока нет</p>
      ) : (
        <Table>
          <thead>
            <tr>
              {['Когда', 'Тип', 'Сумма', 'Комментарий'].map((title) => (
                <Table.Th key={title}>{title}</Table.Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <Table.Td className="whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleString('ru-RU')}
                </Table.Td>
                <Table.Td>{ENTRY_LABELS[entry.type] ?? 'Другая операция'}</Table.Td>
                <Table.Td className="tabular-nums">
                  {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                </Table.Td>
                <Table.Td className="min-w-48 break-words">
                  {entry.comment ?? 'Без комментария'}
                </Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
