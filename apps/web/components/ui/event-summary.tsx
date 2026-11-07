import {
  isAcceptedCheckIn,
  previewSummaryStatus,
  type EventSummaryRow,
  type SummaryAction,
} from '@dkp/shared';
import { Badge, Table } from './data';
import { Button } from './controls';
import { Muted } from './layout';
const LABELS: Record<string, string> = {
  PRESENT: 'Участвовал',
  LATE: 'Опоздал',
  LEFT_EARLY: 'Ушёл раньше',
  NO_SHOW: 'Отсутствовал',
  EXCUSED_ABSENCE: 'Отсутствовал по ув. причине',
};
const CODE_LABELS: Record<string, string> = {
  PENDING: '—',
  ACTIVE: 'Вводит',
  PASSED: 'Самостоятельно',
  FAILED: 'Ошибка',
  EXPIRED: 'Не успел',
  MANUAL: 'Ручная отметка',
};
export function describeSummaryAction(action: SummaryAction): string {
  if (action.kind === 'CHECKIN')
    return `+ код: ${action.phase === 'START' ? 'старт' : 'финал'} — ${action.comment}`;
  if (action.kind === 'EXCUSE') return `Ув. причина — ${action.reason}`;
  if (action.kind === 'ATTENDANCE') return `Статус: ${LABELS[action.status]} — ${action.comment}`;
  return `ДКП ${action.amount > 0 ? '+' : ''}${action.amount} — ${action.comment}`;
}
export function EventSummaryTable({
  rows,
  actions,
  canEdit,
  locked,
  onEdit,
}: {
  rows: EventSummaryRow[];
  actions: SummaryAction[];
  canEdit: boolean;
  locked: boolean;
  onEdit: (row: EventSummaryRow, kind: SummaryAction['kind']) => void;
}) {
  return (
    <Table>
      <thead>
        <tr>
          {[
            'Участник',
            'Старт',
            'Финал',
            'Текущий статус',
            'ДКП',
            ...(canEdit ? ['Подготовить корректировку'] : []),
          ].map((label) => (
            <Table.Th key={label}>{label}</Table.Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const preview = previewSummaryStatus(row, actions);
          return (
            <tr key={row.memberId}>
              <Table.Td className="font-medium">{row.memberName}</Table.Td>
              <Table.Td>
                <Badge tone={isAcceptedCheckIn(row.checkinStart) ? 'success' : 'neutral'}>
                  {CODE_LABELS[row.checkinStart] ?? '—'}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge tone={isAcceptedCheckIn(row.checkinEnd) ? 'success' : 'neutral'}>
                  {CODE_LABELS[row.checkinEnd] ?? '—'}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge tone={row.attendanceStatus === 'NO_SHOW' ? 'danger' : 'neutral'}>
                  {LABELS[row.attendanceStatus ?? ''] ?? '—'}
                </Badge>
                {row.statusIsManual && (
                  <div>
                    <Muted>Ручная отметка; авто: {LABELS[row.automaticStatus]}</Muted>
                  </div>
                )}
                {preview && preview !== row.attendanceStatus && (
                  <div className="mt-1 text-xs text-accent">
                    После применения: {LABELS[preview]}
                  </div>
                )}
              </Table.Td>
              <Table.Td className="tabular-nums">{row.dkpEarned}</Table.Td>
              {canEdit && (
                <Table.Td>
                  <div className="flex flex-wrap gap-1">
                    {(!isAcceptedCheckIn(row.checkinStart) ||
                      !isAcceptedCheckIn(row.checkinEnd)) && (
                      <Button
                        aria-label={`Добавить код: ${row.memberName}`}
                        disabled={locked}
                        onClick={() => onEdit(row, 'CHECKIN')}
                      >
                        + код
                      </Button>
                    )}
                    <Button
                      aria-label={`Уважительная причина: ${row.memberName}`}
                      disabled={locked}
                      onClick={() => onEdit(row, 'EXCUSE')}
                    >
                      Ув. причина
                    </Button>
                    <Button
                      aria-label={`ДКП: ${row.memberName}`}
                      disabled={locked}
                      onClick={() => onEdit(row, 'DKP')}
                    >
                      ДКП
                    </Button>
                    <Button
                      aria-label={`Ручной статус: ${row.memberName}`}
                      disabled={locked}
                      onClick={() => onEdit(row, 'ATTENDANCE')}
                    >
                      Статус
                    </Button>
                  </div>
                </Table.Td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
