import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
/** Короткие транзакции: при конфликте повторяется весь блок, включая проверки. */
export async function serializable<TDb, T>(
  db: {
    $transaction<R>(
      work: (tx: TDb) => Promise<R>,
      options: { isolationLevel: 'Serializable' },
    ): Promise<R>;
  },
  work: (tx: TDb) => Promise<T>,
  retryUnique = false,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      const retry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || (retryUnique && error.code === 'P2002'));
      if (!retry) throw error;
      if (attempt === 2) throw new ConflictException('Данные изменились — повторите действие');
    }
  }
  throw new ConflictException('Повторите действие');
}
