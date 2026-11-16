'use client';
import { GearScoreStale } from './ui/gear-score-stale';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMBAT_ROLE_LABELS, RANK_LABELS, formatWeapons, type SessionUser } from '@dkp/shared';
import { api, API_URL_VALUE } from '../lib/api';
import { Avatar } from './avatar';
import { Button, Card, ErrorText, Field, Input, Modal, Muted, Select, Table } from './ui';

type Pack = { id: string; name: string; kpId: string; leaderId: string | null };
type Group = { id: string; name: string; leaderId: string | null; packs: Pack[] };
type Member = {
  id: string;
  nickname: string;
  avatar?: string | null;
  avatarColor?: string | null;
  rank: keyof typeof RANK_LABELS;
  combatRole: keyof typeof COMBAT_ROLE_LABELS | null;
  weapons: Parameters<typeof formatWeapons>[0];
  pack: {
    id: string;
    name: string;
    leaderId: string | null;
    kp: { id: string; name: string; leaderId: string | null };
  } | null;
  gearScore?: number | null;
  gearScoreStale?: boolean;
  screenshotIds?: string[];
};
type RosterResponse = { groups: Group[]; members: Member[] };
type Dialog =
  | 'create-kp'
  | 'create-pack'
  | 'kp-leader'
  | 'pack-leader'
  | 'confirm-kp-leader'
  | 'confirm-pack-leader'
  | 'transfer'
  | null;

export function TransferMemberModal({
  memberId,
  memberName,
  groups,
  currentPackId,
  onClose,
  onTransferred,
}: {
  memberId: string;
  memberName: string;
  groups: Group[];
  currentPackId?: string;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [kpId, setKpId] = useState(
    groups.find((group) => group.packs.some((pack) => pack.id === currentPackId))?.id ?? '',
  );
  const [packId, setPackId] = useState(currentPackId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Modal title="Переместить участника" onClose={onClose}>
      <div className="space-y-4">
        <p>{memberName}</p>
        <Field label="КП">
          <Select
            value={kpId}
            onChange={(event) => {
              setKpId(event.target.value);
              setPackId('');
            }}
          >
            <option value="">Выберите КП</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Пак">
          <Select value={packId} onChange={(event) => setPackId(event.target.value)}>
            <option value="">Выберите пак</option>
            {groups
              .filter((group) => group.id === kpId)
              .flatMap((group) =>
                group.packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name}
                  </option>
                )),
              )}
          </Select>
        </Field>
        {error && <ErrorText>Не удалось переместить участника</ErrorText>}
        <Button
          disabled={busy || !packId}
          onClick={() => {
            setBusy(true);
            api(`/org/members/${encodeURIComponent(memberId)}/transfer`, {
              method: 'POST',
              body: JSON.stringify({ packId }),
            })
              .then(onTransferred)
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        >
          Принять
        </Button>
      </div>
    </Modal>
  );
}

export function RosterGroups({ user, mode }: { user: SessionUser; mode: 'kp' | 'pack' }) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const requestVersion = useRef(0);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const [formKpId, setFormKpId] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [transferMemberId, setTransferMemberId] = useState('');
  const [transferPackId, setTransferPackId] = useState('');

  const load = useCallback(
    async (selection = selectedId) => {
      const version = ++requestVersion.current;
      setLoading(true);
      setError(null);
      try {
        const query = selection
          ? new URLSearchParams(
              mode === 'kp' ? { kpId: selection } : { packId: selection },
            ).toString()
          : '';
        const result = await api<RosterResponse>(`/org/roster${query ? `?${query}` : ''}`);
        if (version === requestVersion.current) setData(result);
      } catch {
        if (version === requestVersion.current) setError('Не удалось загрузить состав КП и паков');
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [mode, selectedId],
  );

  useEffect(() => {
    void load(selectedId);
  }, [load]);

  useEffect(() => {
    if (dialog === 'create-pack')
      void api<RosterResponse>('/org/roster')
        .then((result) => setAllMembers(result.members))
        .catch(() => setError('Не удалось загрузить участников'));
  }, [dialog]);

  const selectedKp = data?.groups.find((group) => group.id === selectedId);
  const selectedPack = data?.groups
    .flatMap((group) => group.packs)
    .find((pack) => pack.id === selectedId);
  const groups =
    mode === 'kp' ? (data?.groups ?? []) : (data?.groups.flatMap((group) => group.packs) ?? []);
  const members = useMemo(() => {
    const rows = (data?.members ?? []).filter((member) =>
      mode === 'kp' ? member.pack?.kp.id === selectedId : member.pack?.id === selectedId,
    );
    return rows.sort(
      (a, b) =>
        (mode === 'kp' ? (a.pack?.name ?? '') : '').localeCompare(
          mode === 'kp' ? (b.pack?.name ?? '') : '',
          'ru',
        ) ||
        a.nickname.localeCompare(b.nickname, 'ru') ||
        a.id.localeCompare(b.id),
    );
  }, [data, mode, selectedId]);
  const isGuildManager = user.isAdmin || user.rank === 'GUILD_LEADER';
  const selectedGroupKp =
    mode === 'kp' ? selectedKp : data?.groups.find((group) => group.id === selectedPack?.kpId);
  const ownKp = data?.groups.find((group) => group.leaderId === user.memberId);
  const canCreatePack = isGuildManager || !!ownKp;
  const canManageSelectedPack =
    isGuildManager || (!!user.memberId && selectedGroupKp?.leaderId === user.memberId);
  const canViewGs =
    isGuildManager ||
    user.rank === 'ADMIN' ||
    (mode === 'kp' &&
      (selectedKp?.leaderId === user.memberId ||
        !!selectedKp?.packs.some((pack) => pack.leaderId === user.memberId))) ||
    (mode === 'pack' &&
      (selectedPack?.leaderId === user.memberId || selectedGroupKp?.leaderId === user.memberId));
  const selectedLeaderId = mode === 'kp' ? selectedKp?.leaderId : selectedPack?.leaderId;
  const selectedLeader = members.find((member) => member.id === candidateId);
  const candidateOptions = members;
  const targetPacks = data?.groups.flatMap((group) => group.packs) ?? [];
  const targetPack = targetPacks.find((pack) => pack.id === transferPackId);

  async function submit(path: string, body: unknown, nextSelection = selectedId) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      setDialog(null);
      setName('');
      setSearch('');
      setChosenIds([]);
      setCandidateId('');
      setTransferMemberId('');
      setTransferPackId('');
      setSelectedId(nextSelection);
      await load(nextSelection);
    } catch {
      setError('Не удалось выполнить действие. Проверьте права и выбранные данные.');
    } finally {
      setBusy(false);
    }
  }

  const title =
    dialog === 'confirm-kp-leader' || dialog === 'confirm-pack-leader'
      ? 'Подтвердить смену лидера'
      : dialog === 'create-kp'
        ? 'Создать КП'
        : dialog === 'create-pack'
          ? 'Создать пак'
          : dialog === 'transfer'
            ? 'Переместить участника'
            : dialog === 'kp-leader'
              ? 'Выбрать лидера КП'
              : 'Выбрать лидера пака';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {groups.length > 0 && (
          <Field label={mode === 'kp' ? 'КП:' : 'Пак:'}>
            <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Выберите {mode === 'kp' ? 'КП' : 'пак'}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {mode === 'kp' && isGuildManager && (
            <Button
              onClick={() => {
                setName('');
                setChosenIds([]);
                setDialog('create-kp');
              }}
            >
              Создать КП
            </Button>
          )}
          {mode === 'pack' && canCreatePack && (
            <Button
              onClick={() => {
                setName('');
                setChosenIds([]);
                setFormKpId(isGuildManager ? '' : (ownKp?.id ?? ''));
                setDialog('create-pack');
              }}
            >
              Создать пак
            </Button>
          )}
          {selectedId && isGuildManager && (
            <Button onClick={() => setDialog('transfer')}>Переместить участника</Button>
          )}
          {selectedId && (mode === 'kp' ? isGuildManager : canManageSelectedPack) && (
            <Button
              onClick={() => {
                setCandidateId(selectedLeaderId ?? '');
                setDialog(mode === 'kp' ? 'kp-leader' : 'pack-leader');
              }}
            >
              Поменять лидера
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {loading && <Muted>Загрузка состава…</Muted>}
      {!loading && !error && groups.length === 0 && <Muted>Групп пока нет</Muted>}
      {!loading && !error && groups.length > 0 && !selectedId && (
        <Muted>Выберите {mode === 'kp' ? 'КП' : 'пак'}, чтобы увидеть участников</Muted>
      )}
      {!loading && !error && selectedId && (
        <Card className="p-0">
          <Table className="p-5">
            <thead>
              <tr>
                <Table.Th>Ник</Table.Th>
                <Table.Th>Ранг</Table.Th>
                {mode === 'kp' && <Table.Th>Пак</Table.Th>}
                <Table.Th>Класс (оружия)</Table.Th>
                <Table.Th>Боевая роль</Table.Th>
                {canViewGs && <Table.Th>GS</Table.Th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <Table.Row key={member.id}>
                  <Table.Td className="font-medium">
                    <div className="flex items-center gap-2">
                      <Avatar
                        avatar={member.avatar}
                        avatarColor={member.avatarColor}
                        nickname={member.nickname}
                      />
                      <a
                        className="text-accent hover:underline"
                        href={`/profiles/${encodeURIComponent(member.id)}`}
                      >
                        {member.nickname}
                        <GearScoreStale stale={member.gearScoreStale} />
                        {member.id === member.pack?.kp.leaderId && (
                          <span className="ml-1 text-amber-500" aria-label="Лидер КП">
                            👑
                          </span>
                        )}
                        {member.id === member.pack?.leaderId && (
                          <span className="ml-1 text-slate-400" aria-label="Лидер пака">
                            👑
                          </span>
                        )}
                      </a>
                    </div>
                  </Table.Td>
                  <Table.Td>{RANK_LABELS[member.rank]}</Table.Td>
                  {mode === 'kp' && <Table.Td>{member.pack?.name ?? '—'}</Table.Td>}
                  <Table.Td>{formatWeapons(member.weapons ?? [])}</Table.Td>
                  <Table.Td>
                    {member.combatRole ? COMBAT_ROLE_LABELS[member.combatRole] : <Muted>—</Muted>}
                  </Table.Td>
                  {canViewGs && (
                    <Table.Td className="tabular-nums">
                      {member.gearScore ?? <Muted>—</Muted>}{' '}
                      {member.screenshotIds?.map((id, index) => (
                        <a
                          key={id}
                          href={`${API_URL_VALUE}/screenshots/${encodeURIComponent(id)}?${mode === 'kp' ? 'kpId' : 'packId'}=${encodeURIComponent(selectedId)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Скриншот {index + 1}
                        </a>
                      ))}
                    </Table.Td>
                  )}
                </Table.Row>
              ))}
              {members.length === 0 && (
                <tr>
                  <Table.Td colSpan={4 + (canViewGs ? 1 : 0) + (mode === 'kp' ? 1 : 0)}>
                    <Muted>В этой группе пока нет участников</Muted>
                  </Table.Td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {dialog && (
        <Modal title={title} onClose={() => setDialog(null)} wide>
          <div className="space-y-4">
            {dialog === 'create-kp' && (
              <>
                <Field label="Название КП">
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                  />
                </Field>
                <Field label="Найти пак">
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Название пака"
                  />
                </Field>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {targetPacks
                    .filter(
                      (pack) =>
                        !!search.trim() &&
                        pack.name
                          .toLocaleLowerCase('ru')
                          .includes(search.toLocaleLowerCase('ru')) &&
                        !chosenIds.includes(pack.id),
                    )
                    .map((pack) => (
                      <Button
                        key={pack.id}
                        className="mr-2"
                        onClick={() => setChosenIds((ids) => [...ids, pack.id])}
                      >
                        {pack.name} · {data?.groups.find((group) => group.id === pack.kpId)?.name}
                      </Button>
                    ))}
                </div>
                <div className="text-sm">
                  Выбранные паки:{' '}
                  {chosenIds.length === 0
                    ? 'нет'
                    : chosenIds.map((id) => (
                        <Button
                          key={id}
                          onClick={() => setChosenIds((ids) => ids.filter((item) => item !== id))}
                        >
                          {targetPacks.find((pack) => pack.id === id)?.name} ×
                        </Button>
                      ))}
                </div>
                <Button
                  disabled={busy || !name.trim()}
                  onClick={() => void submit('/org/kps', { name, packIds: chosenIds })}
                >
                  Принять
                </Button>
              </>
            )}
            {dialog === 'create-pack' && (
              <>
                <Field label="КП">
                  <Select
                    disabled={!isGuildManager}
                    value={formKpId}
                    onChange={(event) => {
                      setFormKpId(event.target.value);
                      setChosenIds([]);
                    }}
                  >
                    <option value="">Выберите КП</option>
                    {data?.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Название пака">
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                  />
                </Field>
                <Field label="Найти игрока">
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Игровой ник"
                  />
                </Field>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {allMembers
                    .filter(
                      (member) =>
                        !!search.trim() &&
                        member.pack?.kp.id === formKpId &&
                        member.nickname
                          .toLocaleLowerCase('ru')
                          .includes(search.toLocaleLowerCase('ru')) &&
                        !chosenIds.includes(member.id),
                    )
                    .map((member) => (
                      <Button
                        key={member.id}
                        className="mr-2"
                        onClick={() => setChosenIds((ids) => [...ids, member.id])}
                      >
                        {member.nickname}
                      </Button>
                    ))}
                </div>
                <div className="text-sm">
                  Выбранные игроки:{' '}
                  {chosenIds.length === 0
                    ? 'нет'
                    : chosenIds.map((id) => (
                        <Button
                          key={id}
                          onClick={() => setChosenIds((ids) => ids.filter((item) => item !== id))}
                        >
                          {allMembers.find((member) => member.id === id)?.nickname} ×
                        </Button>
                      ))}
                </div>
                <Button
                  disabled={busy || !name.trim() || !formKpId}
                  onClick={() =>
                    void submit(
                      '/org/packs',
                      { name, kpId: formKpId, memberIds: chosenIds },
                      mode === 'pack' ? selectedId : '',
                    )
                  }
                >
                  Принять
                </Button>
              </>
            )}
            {(dialog === 'kp-leader' || dialog === 'pack-leader') && (
              <>
                <Field label="Новый лидер">
                  <Select
                    value={candidateId}
                    onChange={(event) => setCandidateId(event.target.value)}
                  >
                    <option value="">Выберите участника</option>
                    {candidateOptions.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.nickname}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={!candidateId}
                  onClick={() =>
                    setDialog(dialog === 'kp-leader' ? 'confirm-kp-leader' : 'confirm-pack-leader')
                  }
                >
                  Назначить
                </Button>
              </>
            )}
            {(dialog === 'confirm-kp-leader' || dialog === 'confirm-pack-leader') && (
              <>
                <p>
                  Назначить {selectedLeader?.nickname ?? candidateId} лидером{' '}
                  {mode === 'kp' ? selectedKp?.name : selectedPack?.name}?
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={busy || !candidateId}
                    onClick={() =>
                      void submit(
                        `/org/${mode === 'kp' ? `kps/${selectedId}` : `packs/${selectedId}`}/leader`,
                        { memberId: candidateId },
                      )
                    }
                  >
                    Подтвердить
                  </Button>
                  <Button onClick={() => setDialog(mode === 'kp' ? 'kp-leader' : 'pack-leader')}>
                    Отмена
                  </Button>
                </div>
              </>
            )}
            {dialog === 'transfer' && (
              <>
                <Field label="Участник">
                  <Select
                    value={transferMemberId}
                    onChange={(event) => setTransferMemberId(event.target.value)}
                  >
                    <option value="">Выберите участника</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.nickname}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Новая КП и пак">
                  <Select
                    value={transferPackId}
                    onChange={(event) => setTransferPackId(event.target.value)}
                  >
                    <option value="">Выберите пак</option>
                    {targetPacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {data?.groups.find((group) => group.id === pack.kpId)?.name} · {pack.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {targetPack && (
                  <Muted>
                    Новый состав: {data?.groups.find((group) => group.id === targetPack.kpId)?.name}{' '}
                    · {targetPack.name}
                  </Muted>
                )}
                <Button
                  disabled={busy || !transferMemberId || !transferPackId}
                  onClick={() =>
                    void submit(`/org/members/${encodeURIComponent(transferMemberId)}/transfer`, {
                      packId: transferPackId,
                    })
                  }
                >
                  Принять
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
