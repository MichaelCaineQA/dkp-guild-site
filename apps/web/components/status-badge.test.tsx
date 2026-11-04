import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CombatRoleBadge } from './status-badge';

describe('CombatRoleBadge', () => {
  it('показывает русскую подпись роли из @dkp/shared', () => {
    render(<CombatRoleBadge role="HEALER" />);
    expect(screen.getByText('Хил')).toBeDefined();
  });
});
