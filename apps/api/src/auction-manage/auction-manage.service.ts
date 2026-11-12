import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assignWinnerSchema,
  can,
  cancelLotSchema,
  canDecideLotOutcome,
  checkLotExtendAllowed,
  closeLotEarlySchema,
  extendedEndsAt,
  extendLotSchema,
  winningBid,
  type AuctionLotRow,
  type ItemTargetRole,
  type LotManageResult,
  type LotTimerKind,
  type LotStatus,
} from '@dkp/shared';
import { serializable } from '../prisma/serializable';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';

interface StoredBid {
  id: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
  discountPct: number;
  createdAt: Date;
  member: { nickname: string };
}

interface StoredAward {
  winnerId: string;
  finalPrice: number;
  markupPct: number;
  discountPct: number;
  winner: { nickname: string };
}

interface StoredAuction {
  id: string;
  status: string;
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  noBidTimeoutSec: number | null;
  markupPct: number;
  discountPct: number;
  targetRoles: ItemTargetRole[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { id: string; eventId: string | null; item: { name: string } };
  bids: StoredBid[];
  award: StoredAward | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface ManageTx {
  auction: {
    findUnique(args: {
      where: { id: string };
      include: {
        lootDrop: { include: { item: true } };
        bids: { include: { member: true } };
        award: { include: { winner: true } };
      };
    }): Promise<StoredAuction | null>;
    update(args: {
      where: { id: string };
      data: { status?: 'CLOSED' | 'CANCELLED'; endsAt?: Date };
    }): Promise<StoredAuction>;
  };
  lootAward: {
    create(args: {
      data: {
        auctionId: string;
        winnerId: string;
        finalPrice: number;
        markupPct: number;
        discountPct: number;
      };
    }): Promise<unknown>;
    update(args: {
      where: { auctionId: string };
      data: { winnerId: string; finalPrice: number; markupPct: number; discountPct: number };
    }): Promise<unknown>;
  };
  dkpEntry: {
    create(args: {
      data: {
        requestId: string;
        memberId: string;
        type: 'AUCTION_SPEND';
        amount: number;
        auctionId: string;
        comment: string;
      };
    }): Promise<unknown>;
  };
  member: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; nickname: string } | null>;
  };
  event: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      raidLeadId: string;
      creatorId?: string | null;
    } | null>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ManageDb extends ManageTx {
  $transaction<R>(
    work: (tx: ManageTx) => Promise<R>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<R>;
}

/** Актор ручного действия: ранг нужен для прав events.conduct (план 2.6). */
export interface ManageActor {
  memberId: string | null;
  isAdmin: boolean;
  rank: string | null;
}

/**
 * Ручное управление лотом и аудит (issue #96, план 2.4/2.6/2.9/6, п. 8–10).
 *
 * Продлить и отменить лот могут управляющие ивента (events.conduct по ивенту
 * лота — Глава/Админ, назначенный РЛ, создатель-офицер); лоты продолжают
 * торги независимо от статуса ивента (план 2.4), поэтому статус ивента их
 * не ограничивает. Досрочно завершить лот и назначить победителя вручную
 * может только Глава/Админ (план 6, п. 8): получатель — любой игрок, цена
 * произвольная (включая 0), без наценки; списание сразу и может увести баланс
 * в минус. При смене победителя завершённого лота прежнему возвращается
 * уплаченная сумма новой записью журнала, получение передаётся новому.
 *
 * Каждое действие — сериализуемая транзакция с повтором при гонке (ставка
 * или закрытие свипером успеют раньше — статус перечитывается и действие
 * корректно отклоняется); отказ не оставляет ни записей, ни аудита. Причина
 * обязательна и попадает в аудит вместе с автором, объектом и временем.
 * Отменённый лот не меняется (план 6, п. 10).
 */
@Injectable()
export class AuctionManageService {
  constructor(
    private readonly db: ManageDb,
    private readonly now: () => Date = () => new Date(),
    private readonly events: AuctionEventsPort = NOOP_AUCTION_EVENTS,
  ) {}

  /** Продление действующего лота (план 6, п. 8). */
  async extend(auctionId: string, body: unknown, actor: ManageActor): Promise<LotManageResult> {
    const parsed = extendLotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Некорректное продление лота',
      );
    }
    const now = this.now();
    const result = await serializable(this.db, async (tx) => {
      const auction = await this.mustLoadLot(tx, auctionId);
      await this.assertCanConduct(tx, auction, actor, 'Продлить лот');
      const rejection = checkLotExtendAllowed(
        { status: auction.status as LotStatus, endsAt: auction.endsAt },
        now,
      );
      if (rejection === 'LOT_NOT_OPEN') throw new ConflictException('Лот уже не действует');
      if (rejection === 'TIMER_NOT_STARTED')
        throw new ConflictException(
          'Таймер торгов ещё не запущен: продление доступно после первой ставки',
        );
      if (rejection === 'LOT_ENDING')
        throw new ConflictException('Время торгов истекло — лот закрывается');

      const endsAt = extendedEndsAt(auction.endsAt!, parsed.data.extendSec);
      const updated = await tx.auction.update({ where: { id: auctionId }, data: { endsAt } });
      await this.audit(
        tx,
        actor,
        'AUCTION_EXTEND',
        auctionId,
        `Лот «${auction.lootDrop.item.name}» продлён на ${parsed.data.extendSec} сек`,
        parsed.data.comment,
      );
      return this.result(updated, null, null, false);
    });
    // Новое окончание — подписчикам лота после фиксации (issue #97).
    this.events.lotUpdated(auctionId, result.lot, null);
    return result;
  }

  /** Отмена действующего лота (план 6, п. 8): заморозки снимаются, списаний нет. */
  async cancel(auctionId: string, body: unknown, actor: ManageActor): Promise<LotManageResult> {
    const parsed = cancelLotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Укажите причину отмены');
    }
    const result = await serializable(this.db, async (tx) => {
      const auction = await this.mustLoadLot(tx, auctionId);
      await this.assertCanConduct(tx, auction, actor, 'Отменить лот');
      if (auction.status !== 'OPEN')
        throw new ConflictException('Отменить можно только действующий лот');

      const updated = await tx.auction.update({
        where: { id: auctionId },
        data: { status: 'CANCELLED' },
      });
      await this.audit(
        tx,
        actor,
        'AUCTION_CANCEL',
        auctionId,
        `Лот «${auction.lootDrop.item.name}» отменён`,
        parsed.data.comment,
      );
      return this.result(updated, null, null, false);
    });
    // Отмена — событие закрытия после фиксации (issue #97).
    this.events.lotClosed(auctionId, null, 'CANCELLED');
    return result;
  }

  /**
   * Досрочное завершение лота Главой/Админом (план 6, п. 8): победитель —
   * автор ведущей ставки, списание как при обычном закрытии (свипер #95
   * увидит CLOSED и повторит ничего).
   */
  async closeEarly(auctionId: string, body: unknown, actor: ManageActor): Promise<LotManageResult> {
    const parsed = closeLotEarlySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Укажите причину досрочного завершения',
      );
    }
    const result = await serializable(this.db, async (tx) => {
      const auction = await this.mustLoadLot(tx, auctionId);
      this.assertCanDecide(actor, 'Завершить лот досрочно');
      if (auction.status !== 'OPEN')
        throw new ConflictException('Завершить досрочно можно только действующий лот');

      const itemName = auction.lootDrop.item.name;
      const top = winningBid(auction.bids);
      await tx.auction.update({ where: { id: auctionId }, data: { status: 'CLOSED' } });

      if (!top) {
        await this.audit(
          tx,
          actor,
          'AUCTION_CLOSE_EARLY',
          auctionId,
          `Лот «${itemName}» завершён досрочно без ставок — предмет остаётся в гильдии`,
          parsed.data.comment,
        );
        return this.result({ ...auction, status: 'CLOSED' }, null, null, false);
      }

      await tx.lootAward.create({
        data: {
          auctionId,
          winnerId: top.memberId,
          finalPrice: top.fullCost,
          markupPct: top.markupPct,
          discountPct: top.discountPct,
        },
      });
      await this.spendEntry(
        tx,
        `auction-close:${auctionId}`,
        top.memberId,
        -top.fullCost,
        auctionId,
        `Трата на аукционе: «${itemName}» за ${top.fullCost}` +
          priceModifiers(top),
      );
      await this.audit(
        tx,
        actor,
        'AUCTION_CLOSE_EARLY',
        auctionId,
        `Лот «${itemName}» завершён досрочно: победитель ${top.member.nickname}, списано ${top.fullCost} ДКП`,
        parsed.data.comment,
      );
      return this.result(
        { ...auction, status: 'CLOSED' },
        {
          memberId: top.memberId,
          memberName: top.member.nickname,
          finalPrice: top.fullCost,
          markupPct: top.markupPct,
          discountPct: top.discountPct,
        },
        null,
        false,
      );
    });
    // Досрочное завершение — событие закрытия после фиксации (issue #97).
    this.events.lotClosed(auctionId, result.winner, 'EARLY');
    return result;
  }

  /**
   * Ручной победитель — Глава/Админ (план 6, п. 8 и 10).
   * Действующий лот закрывается назначением; у завершённого победитель
   * меняется: прежнему возвращается уплаченная сумма новой записью журнала,
   * получение передаётся новому победителю. Цена — любая, включая 0, без
   * наценки; списание сразу, без проверки баланса (может уйти в минус).
   * Повтор запроса с тем же requestId — уже применённое назначение
   * возвращается без новых записей (requestId у финансовых записей).
   */
  async assignWinner(
    auctionId: string,
    body: unknown,
    actor: ManageActor,
  ): Promise<LotManageResult> {
    const parsed = assignWinnerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Некорректное назначение победителя',
      );
    }
    const input = parsed.data;
    // retryUnique: повтор уже применённого requestId после чужой смены
    // победителя упирается в уникальность requestId и отдаёт понятный отказ.
    let wasOpen = false;
    const result = await serializable(
      this.db,
      async (tx) => {
        const auction = await this.mustLoadLot(tx, auctionId);
        wasOpen = auction.status === 'OPEN';
        this.assertCanDecide(actor, 'Назначить победителя');
        if (auction.status === 'CANCELLED')
          throw new ConflictException('Отменённый лот не меняется');
        const winner = await tx.member.findUnique({ where: { id: input.winnerId } });
        if (!winner) throw new NotFoundException('Получатель не найден');

        const itemName = auction.lootDrop.item.name;

        // Повтор запроса: тот же получатель и цена уже зафиксированы.
        if (
          auction.status === 'CLOSED' &&
          auction.award &&
          auction.award.winnerId === winner.id &&
          auction.award.finalPrice === input.price
        ) {
          return this.result(
            { ...auction },
            {
              memberId: winner.id,
              memberName: winner.nickname,
              finalPrice: input.price,
              markupPct: auction.award.markupPct,
              discountPct: auction.award.discountPct,
            },
            null,
            true,
          );
        }

        const spent =
          auction.status === 'OPEN'
            ? null // торги остановлены назначением — записей выдачи ещё не было
            : auction.award; // завершённый лот: выдано раньше, вернём прежнему

        if (auction.status === 'OPEN') {
          await tx.auction.update({ where: { id: auctionId }, data: { status: 'CLOSED' } });
          await tx.lootAward.create({
            data: {
              auctionId,
              winnerId: winner.id,
              finalPrice: input.price,
              markupPct: 0,
              discountPct: 0,
            },
          });
        } else if (auction.award) {
          await tx.lootAward.update({
            where: { auctionId },
            data: { winnerId: winner.id, finalPrice: input.price, markupPct: 0, discountPct: 0 },
          });
        } else {
          // завершён без ставок (план 6, п. 9) — выдача назначается вручную
          await tx.lootAward.create({
            data: {
              auctionId,
              winnerId: winner.id,
              finalPrice: input.price,
              markupPct: 0,
              discountPct: 0,
            },
          });
        }

        // Возврат прежнему победителю — раньше списания с нового (план 6, п. 8).
        let refund: LotManageResult['refund'] = null;
        if (spent && spent.finalPrice > 0) {
          await this.spendEntry(
            tx,
            `auction-award-refund:${auctionId}:${input.requestId}`,
            spent.winnerId,
            spent.finalPrice,
            auctionId,
            `Возврат траты: победитель лота «${itemName}» изменён вручную`,
          );
          refund = {
            memberId: spent.winnerId,
            memberName: spent.winner.nickname,
            amount: spent.finalPrice,
          };
        }
        if (input.price > 0) {
          await this.spendEntry(
            tx,
            `auction-award:${auctionId}:${input.requestId}`,
            winner.id,
            -input.price,
            auctionId,
            `Трата на аукционе: «${itemName}» за ${input.price} (победитель назначен вручную)`,
          );
        }

        await this.audit(
          tx,
          actor,
          'AUCTION_ASSIGN_WINNER',
          auctionId,
          `Лот «${itemName}»: победитель назначен вручную — ${winner.nickname} за ${input.price} ДКП` +
            (auction.status === 'OPEN' ? ' (торги остановлены)' : '') +
            (refund ? `; прежнему победителю возвращено ${refund.amount} ДКП` : ''),
          input.comment,
        );
        return this.result(
          { ...auction, status: 'CLOSED' },
          {
            memberId: winner.id,
            memberName: winner.nickname,
            finalPrice: input.price,
            markupPct: 0,
            discountPct: 0,
          },
          refund,
          false,
        );
      },
      true,
    );
    // Назначение остановило торги — событие закрытия; смена победителя
    // завершённого лота — обновление лота. Повтор (repeated) молчит (#97).
    if (!result.repeated) {
      if (wasOpen) this.events.lotClosed(auctionId, result.winner, 'ASSIGNED');
      else this.events.lotUpdated(auctionId, result.lot, result.winner);
    }
    return result;
  }

  private async mustLoadLot(tx: ManageTx, auctionId: string): Promise<StoredAuction> {
    const auction = await tx.auction.findUnique({
      where: { id: auctionId },
      include: {
        lootDrop: { include: { item: true } },
        bids: { include: { member: true } },
        award: { include: { winner: true } },
      },
    });
    if (!auction) throw new NotFoundException('Лот не найден');
    return auction;
  }

  /**
   * Продление/отмена — управляющим ивента лота (план 2.6 и 6, п. 8).
   * Лот вне ивента (#137): ивента и РЛ нет — управляют Глава/Админ.
   */
  private async assertCanConduct(
    tx: ManageTx,
    auction: StoredAuction,
    actor: ManageActor,
    action: string,
  ) {
    if (auction.lootDrop.eventId === null) {
      this.assertCanDecide(actor, action);
      return;
    }
    const event = await tx.event.findUnique({
      where: { id: auction.lootDrop.eventId },
    });
    if (!event) throw new NotFoundException('Ивент лота не найден');
    const allowed = can(
      { rank: actor.rank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
      'events.conduct',
      event,
    );
    if (!allowed) throw new ForbiddenException(`${action} может управляющий ивента`);
  }

  /** Досрочное завершение и ручной победитель — только Глава/Админ (план 6, п. 8). */
  private assertCanDecide(actor: ManageActor, action: string) {
    if (!canDecideLotOutcome({ rank: actor.rank as never, isAdmin: actor.isAdmin })) {
      throw new ForbiddenException(`${action} может только Глава или Админ`);
    }
  }

  /** Запись журнала ДКП: append-only, requestId защищает от дублей. */
  private spendEntry(
    tx: ManageTx,
    requestId: string,
    memberId: string,
    amount: number,
    auctionId: string,
    comment: string,
  ) {
    return tx.dkpEntry.create({
      data: { requestId, memberId, type: 'AUCTION_SPEND', amount, auctionId, comment },
    });
  }

  /** Аудит ручного действия: автор, объект и обязательная причина (план 2.9). */
  private audit(
    tx: ManageTx,
    actor: ManageActor,
    action: string,
    auctionId: string,
    fact: string,
    reason: string,
  ) {
    return tx.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'Auction',
        entityId: auctionId,
        comment: `${fact}. Причина: ${reason}`,
      },
    });
  }

  private toLotRow(auction: StoredAuction): AuctionLotRow {
    return {
      id: auction.id,
      status: auction.status as LotStatus,
      startPrice: auction.startPrice,
      step: auction.step,
      timerKind: auction.timerFromFirstBid
        ? ('FIRST_BID' as LotTimerKind)
        : ('OPENING' as LotTimerKind),
      durationSec: auction.durationSec,
      antiSnipeSec: auction.antiSnipeSec,
      antiSnipeExtendSec: auction.antiSnipeExtendSec,
      noBidTimeoutSec: auction.noBidTimeoutSec,
      markupPct: auction.markupPct,
      discountPct: auction.discountPct,
      firstBidAt: auction.firstBidAt?.toISOString() ?? null,
      endsAt: auction.endsAt?.toISOString() ?? null,
      createdAt: auction.createdAt.toISOString(),
    };
  }

  private result(
    auction: StoredAuction,
    winner: LotManageResult['winner'],
    refund: LotManageResult['refund'],
    repeated: boolean,
  ): LotManageResult {
    return { lot: this.toLotRow(auction), winner, refund, repeated };
  }
}

/** Наценка и скидка в комментарии журнала (пусто — чистая цена). */
function priceModifiers(bid: { markupPct: number; discountPct: number }): string {
  const parts: string[] = [];
  if (bid.markupPct > 0) parts.push(`с наценкой ${bid.markupPct}%`);
  if (bid.discountPct > 0) parts.push(`со скидкой ${bid.discountPct}%`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
