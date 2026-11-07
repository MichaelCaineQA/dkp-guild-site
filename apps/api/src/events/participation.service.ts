import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  canCancelAbsence,
  isEventInvitee,
  participationActions,
  participationInputSchema,
  parseSettingValue,
  SETTING_DEFAULTS,
  type ParticipationState,
} from '@dkp/shared';
type ReadDb = Pick<Prisma.TransactionClient, 'event' | 'member' | 'absence' | 'setting'>;
@Injectable()
export class ParticipationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private async context(db: ReadDb, id: string, memberId: string | null) {
    if (!memberId) throw new ForbiddenException('Участие доступно игроку с привязанным профилем');
    const [event, member, setting] = await Promise.all([
      db.event.findUnique({
        where: { id },
        select: { startsAt: true, status: true, scope: true, kpId: true, packId: true },
      }),
      db.member.findUnique({
        where: { id: memberId },
        select: { id: true, packId: true, pack: { select: { kpId: true } } },
      }),
      db.setting.findUnique({
        where: { key: 'absence.deadlineBeforeStartSec' },
        select: { value: true },
      }),
    ]);
    if (!event) throw new NotFoundException('Ивент не найден');
    if (!member) throw new ForbiddenException('Профиль игрока не найден');
    const invited = isEventInvitee(event, { ...member, kpId: member.pack?.kpId ?? null });
    const absences = await db.absence.findMany({
      where: {
        memberId,
        status: 'ACTIVE',
        OR: [
          { eventId: id },
          { eventId: null, dateFrom: { lte: event.startsAt }, dateTo: { gte: event.startsAt } },
        ],
      },
      select: { id: true, dateFrom: true, dateTo: true, reason: true, eventId: true },
    });
    const now = this.clock();
    const deadline = parseSettingValue(
      'absence.deadlineBeforeStartSec',
      setting?.value ?? SETTING_DEFAULTS['absence.deadlineBeforeStartSec'],
    );
    const actions = participationActions(event, now, deadline);
    let canAttend = actions.canAttend;
    if (canAttend && absences.length > 0) {
      const events = await db.event.findMany({
        where: {
          status: { not: 'CANCELLED' },
          OR: absences.map((a) =>
            a.eventId ? { id: a.eventId } : { startsAt: { gte: a.dateFrom, lte: a.dateTo } },
          ),
        },
        select: { startsAt: true },
      });
      canAttend = absences.every((a) =>
        a.eventId ? actions.canAttend : canCancelAbsence(a, events, now),
      );
    }
    const state: ParticipationState = {
      ...actions,
      canAttend: invited && canAttend,
      canDecline: invited && actions.canDecline,
      invited,
      attending: invited && absences.length === 0,
      absences: absences.map((a) => ({
        id: a.id,
        reason: a.reason,
        dateFrom: (a.eventId ? event.startsAt : a.dateFrom).toISOString(),
        dateTo: (a.eventId ? event.startsAt : a.dateTo).toISOString(),
      })),
    };
    return { event, state, memberId };
  }
  async get(id: string, memberId: string | null): Promise<ParticipationState> {
    return (await this.context(this.db, id, memberId)).state;
  }
  async update(id: string, memberId: string | null, body: unknown): Promise<{ ok: true }> {
    const parsed = participationInputSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Некорректное участие или причина длиннее 500 символов');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const { event, state, memberId: self } = await this.context(tx, id, memberId);
            if (!state.invited) throw new ForbiddenException('Вы не входите в приглашённый состав');
            if (parsed.data.attending === state.attending) return { ok: true as const };
            if (parsed.data.attending ? !state.canAttend : !state.canDecline)
              throw new ConflictException('Срок изменения участия истёк');
            if (
              parsed.data.attending &&
              (state.absences.length !== new Set(parsed.data.absenceIds).size ||
                state.absences.some((a) => !parsed.data.absenceIds.includes(a.id)))
            )
              throw new ConflictException(
                'Список заявок изменился — подтвердите актуальные периоды',
              );
            if (!parsed.data.attending) {
              // Точечный интервал покрывает только начало выбранного события, не весь день.
              const absence = await tx.absence.create({
                data: {
                  memberId: self,
                  eventId: id,
                  dateFrom: event.startsAt,
                  dateTo: event.startsAt,
                  reason: parsed.data.reason,
                },
              });
              await tx.auditLog.create({
                data: {
                  actorMemberId: self,
                  action: 'ABSENCE_CREATE',
                  entityType: 'Absence',
                  entityId: absence.id,
                  comment: 'Не приду на ивент ' + id,
                },
              });
            } else {
              for (const absence of state.absences) {
                await tx.absence.update({
                  where: { id: absence.id },
                  data: { status: 'CANCELLED' },
                });
                await tx.auditLog.create({
                  data: {
                    actorMemberId: self,
                    action: 'ABSENCE_CANCEL',
                    entityType: 'Absence',
                    entityId: absence.id,
                    comment: 'Отмена своего отсутствия: буду на ивенте ' + id,
                  },
                });
              }
            }
            return { ok: true as const };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
    throw new ConflictException('Повторите изменение участия');
  }
}
