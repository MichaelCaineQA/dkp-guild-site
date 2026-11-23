/** Discord applies guild roles, then everyone, role and member channel overwrites. */
export interface DiscordRole {
  id: string;
  permissions: string;
}

export interface DiscordOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export function canBotSendToChannel(input: {
  guildId: string;
  botId: string;
  roleIds: string[];
  roles: DiscordRole[];
  overwrites: DiscordOverwrite[];
  isOwner: boolean;
}): boolean {
  const everyone = input.roles.find((role) => role.id === input.guildId);
  if (!everyone) return false;
  let permissions = BigInt(everyone.permissions);
  for (const id of input.roleIds) {
    const role = input.roles.find((candidate) => candidate.id === id);
    if (!role) return false;
    permissions |= BigInt(role.permissions);
  }
  const administrator = 1n << 3n;
  if (input.isOwner || (permissions & administrator) !== 0n) return true;

  const apply = (allow: bigint, deny: bigint) => {
    permissions = (permissions & ~deny) | allow;
  };
  const all = input.overwrites.find((entry) => entry.type === 0 && entry.id === input.guildId);
  if (all) apply(BigInt(all.allow), BigInt(all.deny));
  let allow = 0n;
  let deny = 0n;
  for (const overwrite of input.overwrites) {
    if (overwrite.type === 0 && input.roleIds.includes(overwrite.id)) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  }
  apply(allow, deny);
  const member = input.overwrites.find((entry) => entry.type === 1 && entry.id === input.botId);
  if (member) apply(BigInt(member.allow), BigInt(member.deny));
  const required = (1n << 10n) | (1n << 11n);
  return (permissions & required) === required;
}
