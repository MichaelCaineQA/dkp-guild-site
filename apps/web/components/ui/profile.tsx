import { COMBAT_ROLE_LABELS, RANK_LABELS, formatWeapons, type PlayerProfile } from '@dkp/shared';
import { Card, Muted, SectionTitle } from './layout';
import { Table } from './data';
import { Avatar } from '../avatar';

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
      <div className="mb-4">
        <Avatar
          avatar={profile.avatar}
          avatarColor={profile.avatarColor}
          nickname={profile.nickname}
          size="profile"
        />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt>Ник</dt>
        <dd className="break-all">{profile.nickname}</dd>
        <dt>Discord</dt>
        <dd className="break-all">{profile.discord ?? 'Не привязан'}</dd>
        <dt>Ранг</dt>
        <dd>{RANK_LABELS[profile.rank]}</dd>
        <dt>Роль</dt>
        <dd>{profile.combatRole ? COMBAT_ROLE_LABELS[profile.combatRole] : 'Не указана'}</dd>
        <dt>Класс (оружия)</dt>
        <dd>{formatWeapons(profile.weapons ?? [])}</dd>
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

/** Полученный лут в профиле (план 2.5, issue #99): только фактические выдачи. */
export function ProfileLoot({
  loot,
  total,
  memberId,
}: {
  loot: PlayerProfile['loot'];
  total: number;
  memberId: string;
}) {
  return (
    <Card>
      <SectionTitle>Полученный лут</SectionTitle>
      {!loot.length ? (
        <p>Лута пока нет</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                {['Когда', 'Предмет', 'Событие', 'Стоимость'].map((title) => (
                  <Table.Th key={title}>{title}</Table.Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loot.map((award) => (
                <tr key={award.awardId}>
                  <Table.Td className="whitespace-nowrap">
                    {new Date(award.createdAt).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Table.Td>
                  <Table.Td className="font-medium">
                    {award.itemName}
                    {award.rarity ? ` (${award.rarity})` : ''}
                  </Table.Td>
                  <Table.Td>{award.eventName}</Table.Td>
                  <Table.Td className="tabular-nums">
                    {award.finalPrice}
                    {award.markupPct > 0 ? ` (+${award.markupPct}%)` : ''}
                  </Table.Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {total > loot.length && (
            <p className="mt-2 text-sm">
              <Muted>
                Показаны последние {loot.length} из {total} —{' '}
                <a
                  className="text-accent hover:underline"
                  href={`/auction?loot-member=${encodeURIComponent(memberId)}`}
                >
                  весь лут игрока в лут-логе
                </a>
              </Muted>
            </p>
          )}
        </>
      )}
    </Card>
  );
}
