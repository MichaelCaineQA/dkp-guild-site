-- Ник члена гильдии уникален в БД (issue #6): заявки на привязку
-- и создание членов больше не полагаются только на логику приложения.

-- CreateIndex
CREATE UNIQUE INDEX "Member_nickname_key" ON "Member"("nickname");
