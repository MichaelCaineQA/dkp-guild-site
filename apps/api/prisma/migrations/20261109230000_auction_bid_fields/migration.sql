-- Ставки, баланс и анти-снайп (issue #94, план 6, п. 4–6): независимое
-- продление анти-снайпа на лоте (существующие лоты — продление = окну),
-- полная стоимость и применённая наценка на ставке для заморозки и списания.
ALTER TABLE "Auction"
    ADD COLUMN "antiSnipeExtendSec" INTEGER NOT NULL DEFAULT 30;
UPDATE "Auction" SET "antiSnipeExtendSec" = "antiSnipeSec";

ALTER TABLE "Bid"
    ADD COLUMN "fullCost" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "markupPct" INTEGER NOT NULL DEFAULT 0;
