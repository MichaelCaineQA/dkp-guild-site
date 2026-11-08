CREATE UNIQUE INDEX "Member_single_guild_leader" ON "Member" ("rank") WHERE "rank" = 'GUILD_LEADER';
