-- Чек-ин коды (план 2.2, issue #9): соль для хэша сверки попыток
-- и зашифрованный AES-256-GCM код для повторного показа РЛ.

-- AlterTable
ALTER TABLE "CheckInCode" ADD COLUMN     "codeEnc" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "salt" TEXT NOT NULL;
