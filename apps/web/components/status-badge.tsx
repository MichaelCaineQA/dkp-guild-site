import { COMBAT_ROLE_LABELS, type CombatRole } from '@dkp/shared';

export function CombatRoleBadge({ role }: { role: CombatRole }) {
  return <span className="role-badge">{COMBAT_ROLE_LABELS[role]}</span>;
}
