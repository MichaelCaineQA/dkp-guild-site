import { DiscordChannelValidator } from './discord-channel-validator';

describe('Discord channel validation', () => {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guild = process.env.DISCORD_GUILD_ID;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.DISCORD_GUILD_ID = '100';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const path = String(url);
        let body: unknown;
        if (path.endsWith('/users/@me')) body = { id: '200' };
        else if (path.endsWith('/guilds/100')) body = { owner_id: '300' };
        else if (path.endsWith('/channels/400'))
          body = { guild_id: '100', type: 0, permission_overwrites: [] };
        else if (path.endsWith('/guilds/100/roles')) body = [{ id: '100', permissions: '3072' }];
        else if (path.endsWith('/guilds/100/members/200')) body = { roles: [] };
        else return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(body));
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (token === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = token;
    if (guild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = guild;
  });

  it('accepts an accessible text channel on the configured server', async () => {
    await expect(new DiscordChannelValidator().validate('400')).resolves.toBeUndefined();
  });

  it('rejects a channel from a different server', async () => {
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      if (String(url).endsWith('/channels/400'))
        return new Response(JSON.stringify({ guild_id: '999', type: 0 }));
      if (String(url).endsWith('/users/@me')) return new Response('{"id":"200"}');
      if (String(url).endsWith('/guilds/100')) return new Response('{"owner_id":"300"}');
      return new Response('[{"id":"100","permissions":"3072"}]');
    });
    await expect(new DiscordChannelValidator().validate('400')).rejects.toThrow(
      'настроенного Discord-сервера',
    );
  });

  it('reports missing bot configuration without contacting Discord', async () => {
    delete process.env.DISCORD_GUILD_ID;
    await expect(new DiscordChannelValidator().validate('400')).rejects.toThrow('не настроен');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
