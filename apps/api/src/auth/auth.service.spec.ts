import { AuthService, type AuthDb, type UserRow } from './auth.service';

function makeDb(state: { users: UserRow[] }) {
  const db: AuthDb = {
    user: {
      count: async () => state.users.length,
      findFirst: async ({ where }) =>
        state.users.find((u) => u.username === where.username) ?? null,
      findUnique: async ({ where }) =>
        state.users.find((u) => u.id === where.id) ?? null,
      upsert: async ({ where, create, update }) => {
        let user = state.users.find((u) => u.discordId === where.discordId);
        if (!user) {
          user = {
            id: `user-${state.users.length + 1}`,
            username: create.username,
            discordId: create.discordId,
            member: null,
          };
          state.users.push(user);
        } else {
          user.username = update.username;
        }
        return user;
      },
    },
    member: {
      create: async ({ data }) => {
        // как Prisma: привязанный Member виден в user.member при следующем чтении
        const user = state.users.find((u) => u.id === data.userId)!;
        const member = { id: `member-for-${data.userId}`, rank: data.rank };
        user.member = { id: member.id, rank: member.rank };
        return member;
      },
    },
  };
  return db;
}

describe('AuthService', () => {
  it('первый вошедший больше не Глава — bootstrap убран (решение владельца)', async () => {
    const state = { users: [] as UserRow[] };
    const service = new AuthService(makeDb(state));

    const session = await service.loginWithDiscord({ discordId: '111', username: 'First' });

    // Аккаунт создаётся без Member и ранга: доступ только после одобрения
    // заявки главой/админом; единственный Глава — тестовый юзер из seed:test
    expect(session.rank).toBeNull();
    expect(session.memberId).toBeNull();
    expect(session.isAdmin).toBe(false);
  });

  it('второй и последующие — без Member и ранга (ждут привязку)', async () => {
    const state = { users: [] as UserRow[] };
    const service = new AuthService(makeDb(state));
    await service.loginWithDiscord({ discordId: '111', username: 'First' });

    const session = await service.loginWithDiscord({ discordId: '222', username: 'Second' });

    expect(session.rank).toBeNull();
    expect(session.memberId).toBeNull();
  });

  it('повторный вход того же пользователя обновляет ник, Member сохраняется', async () => {
    const state = { users: [] as UserRow[] };
    const service = new AuthService(makeDb(state));
    const first = await service.loginWithDiscord({ discordId: '111', username: 'Old' });

    const again = await service.loginWithDiscord({ discordId: '111', username: 'New' });

    expect(state.users).toHaveLength(1);
    expect(again.username).toBe('New');
    expect(again.memberId).toBe(first.memberId);
  });

  describe('резервный вход админа', () => {
    const service = new AuthService(makeDb({ users: [] }));
    const env = { login: 'admin', password: 'secret' };

    it('верные креды проходят', () => {
      expect(service.isAdminCredentials('admin', 'secret', env)).toBe(true);
    });

    it('неверный пароль не проходит', () => {
      expect(service.isAdminCredentials('admin', 'wrong', env)).toBe(false);
    });

    it('не настроен — никто не проходит', () => {
      expect(service.isAdminCredentials('admin', 'secret', {})).toBe(false);
    });
  });
});
