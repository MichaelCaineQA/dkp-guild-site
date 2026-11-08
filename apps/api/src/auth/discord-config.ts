/** Общая проверка для регистрации стратегии и публичного состояния входа. */
export function isDiscordConfigured(): boolean {
  return Boolean(
    process.env.DISCORD_CLIENT_ID?.trim() && process.env.DISCORD_CLIENT_SECRET?.trim(),
  );
}
