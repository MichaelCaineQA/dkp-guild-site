import { canBotSendToChannel, type DiscordOverwrite } from './channel-permissions';

const viewAndSend = '3072';
function input(overwrites: DiscordOverwrite[] = []) {
  return {
    guildId: '1',
    botId: '2',
    roleIds: ['3'],
    roles: [
      { id: '1', permissions: '0' },
      { id: '3', permissions: viewAndSend },
    ],
    overwrites,
    isOwner: false,
  };
}

it('allows sending when guild roles grant view and send', () => {
  expect(canBotSendToChannel(input())).toBe(true);
});

it('honours a member-specific denial after role grants', () => {
  expect(canBotSendToChannel(input([{ id: '2', type: 1, allow: '0', deny: '2048' }]))).toBe(false);
});

it('applies role allows after the everyone denial', () => {
  expect(
    canBotSendToChannel(
      input([
        { id: '1', type: 0, allow: '0', deny: '3072' },
        { id: '3', type: 0, allow: '3072', deny: '0' },
      ]),
    ),
  ).toBe(true);
});

it('fails closed when a role is missing', () => {
  expect(canBotSendToChannel({ ...input(), roles: [{ id: '1', permissions: viewAndSend }] })).toBe(
    false,
  );
});

it('honours administrator despite channel denies', () => {
  expect(
    canBotSendToChannel({
      ...input([{ id: '1', type: 0, allow: '0', deny: '3072' }]),
      roles: [
        { id: '1', permissions: '8' },
        { id: '3', permissions: '0' },
      ],
    }),
  ).toBe(true);
});
