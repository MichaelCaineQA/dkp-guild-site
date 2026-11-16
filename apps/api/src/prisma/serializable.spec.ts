import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { serializable } from './serializable';
const conflict = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('conflict', { code, clientVersion: 'test' });
describe('Повтор транзакции', () => {
  it.each(['40001', '40P01'])('повторяет raw SQL при конфликте PostgreSQL %s', async (sqlState) => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('raw conflict', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code: sqlState },
        }),
      )
      .mockResolvedValueOnce('committed');
    await expect(
      serializable({ $transaction: transaction }, async () => 'committed'),
    ).resolves.toBe('committed');
  });
  it('не повторяет raw SQL при постоянной ошибке PostgreSQL', async () => {
    const error = new Prisma.PrismaClientKnownRequestError('relation missing', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '42P01' },
    });
    const transaction = jest.fn().mockRejectedValue(error);
    await expect(serializable({ $transaction: transaction }, async () => true)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('повторяет весь блок, включая проверки, после serialization failure', async () => {
    let attempts = 0;
    const work = jest.fn(async () => attempts);
    const db = {
      $transaction: async <T>(callback: (tx: object) => Promise<T>) => {
        attempts++;
        const result = await callback({});
        if (attempts === 1) throw conflict('P2034');
        return result;
      },
    };
    expect(await serializable(db, work)).toBe(2);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it('конкурентный unique повторяется только там, где это явно разрешено', async () => {
    let attempts = 0;
    const db = {
      $transaction: async <T>(callback: (tx: object) => Promise<T>) => {
        if (++attempts === 1) throw conflict('P2002');
        return callback({});
      },
    };
    await expect(serializable(db, async () => true)).rejects.toMatchObject({ code: 'P2002' });
    attempts = 0;
    expect(await serializable(db, async () => true, true)).toBe(true);
  });
  it('после трёх конфликтов отдаёт 409, обычная ошибка не повторяется', async () => {
    let attempts = 0;
    const db = {
      $transaction: async <T>(_callback: (tx: object) => Promise<T>): Promise<T> => {
        void _callback;
        attempts++;
        throw conflict('P2034');
      },
    };
    await expect(serializable(db, async () => true)).rejects.toThrow(ConflictException);
    expect(attempts).toBe(3);
    attempts = 0;
    db.$transaction = async () => {
      attempts++;
      throw new Error('storage failure');
    };
    await expect(serializable(db, async () => true)).rejects.toThrow('storage failure');
    expect(attempts).toBe(1);
  });
});
