import { COMBAT_ROLE_LABELS, type CombatRole } from '@dkp/shared';
import { Badge } from './ui';

export function CombatRoleBadge({ role }: { role: CombatRole }) {
  return <Badge tone="accent">{COMBAT_ROLE_LABELS[role]}</Badge>;
}
