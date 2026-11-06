-- Старым игрокам и заявкам не назначаем вымышленные оружия.
CREATE TYPE "Weapon" AS ENUM ('SWORD_SHIELD', 'GREATSWORD', 'DAGGERS', 'CROSSBOW', 'LONGBOW', 'STAFF', 'WAND', 'SPEAR');
ALTER TABLE "Member" ADD COLUMN "weapons" "Weapon"[] NOT NULL DEFAULT ARRAY[]::"Weapon"[];
ALTER TABLE "MemberLinkRequest" ADD COLUMN "combatRole" "CombatRole", ADD COLUMN "weapons" "Weapon"[] NOT NULL DEFAULT ARRAY[]::"Weapon"[];
