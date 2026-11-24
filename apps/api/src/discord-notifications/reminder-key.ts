export const legacyReminderKey = (eventId: string, startsAt: Date) =>
  `reminder:${eventId}:${startsAt.getTime()}`;

export const reminderKey = (guildId: string, eventId: string, startsAt: Date) =>
  `reminder:${guildId}:${eventId}:${startsAt.getTime()}`;
