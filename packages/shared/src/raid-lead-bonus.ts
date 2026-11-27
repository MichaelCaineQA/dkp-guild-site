/** Бонус РЛ считается от фактически начисленных ДКП за отметки ивента. */
export function raidLeadBonusAmount(checkInDkp: number): number {
  return Math.ceil(checkInDkp / 10);
}
