-- Лот (issue #93, план 6): тайм-аут закрытия без ставок для живой раздачи
-- и фиксация наценки с разметкой предмета при создании лота.
ALTER TABLE "Auction"
    ADD COLUMN "markupPct" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "noBidTimeoutSec" INTEGER,
    ADD COLUMN "targetRoles" "ItemTargetRole"[] DEFAULT ARRAY[]::"ItemTargetRole"[];
