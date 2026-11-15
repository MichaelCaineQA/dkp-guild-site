
import {
  buildCodeChoices,
  decryptCheckInCode,
  encryptCheckInCode,
  generateCheckInCode,
  hashCheckInCode,
  isCodeCorrect,
  isValidCodeFormat,
  newCodeWithHash,
} from './crypto';

const KEY = 'ab'.repeat(32);

describe('generateCheckInCode', () => {
  it('трёхзначный код без ведущих нулей', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateCheckInCode();
      expect(isValidCodeFormat(code)).toBe(true);
      expect(Number(code)).toBeGreaterThanOrEqual(100);
    }
  });
});

describe('hashCheckInCode / isCodeCorrect', () => {
  it('хэш с солью стабилен и проверяем', () => {
    const { code, salt, codeHash } = newCodeWithHash();
    expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(isCodeCorrect(code, salt, codeHash)).toBe(true);
    expect(isCodeCorrect(code === '999' ? '111' : '999', salt, codeHash)).toBe(false);
  });

  it('разные соли — разные хэши одного кода', () => {
    expect(hashCheckInCode('123', 'salt-a')).not.toBe(hashCheckInCode('123', 'salt-b'));
  });

  it('попытка с пробелами приводится', () => {
    const { code, salt, codeHash } = newCodeWithHash();
    expect(isCodeCorrect(` ${code} `, salt, codeHash)).toBe(true);
  });
});

describe('encryptCheckInCode / decryptCheckInCode', () => {
  it('шифрует и расшифровывает код', () => {
    const sealed = encryptCheckInCode('482', KEY);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).toMatch(/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]{6}$/);
    expect(decryptCheckInCode(sealed, KEY)).toBe('482');
  });

  it('чужой ключ не расшифровывает — null', () => {
    const sealed = encryptCheckInCode('482', KEY);
    expect(decryptCheckInCode(sealed, 'cd'.repeat(32))).toBeNull();
  });

  it('битое значение — null', () => {
    expect(decryptCheckInCode('мусор', KEY)).toBeNull();
    expect(decryptCheckInCode('v2:aa:bb:cc', KEY)).toBeNull();
  });
});

describe('buildCodeChoices', () => {
  it('4 уникальных трёхзначных кода, включая верный', () => {
    const choices = buildCodeChoices('482', 'salt-a');
    expect(choices).toHaveLength(4);
    expect(new Set(choices).size).toBe(4);
    expect(choices).toContain('482');
    for (const code of choices) {
      expect(isValidCodeFormat(code)).toBe(true);
    }
  });

  it('детерминирован: тот же код и соль — тот же набор и порядок', () => {
    // Регрессия: обманки генерировались на каждый запрос, и перезагрузка
    // страницы выдавала верный код как единственный неизменный.
    expect(buildCodeChoices('482', 'salt-a')).toEqual(buildCodeChoices('482', 'salt-a'));
  });

  it('разные соли — разные наборы, верный код всегда внутри', () => {
    const sets = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const choices = buildCodeChoices('482', `salt-${i}`);
      expect(choices).toContain('482');
      sets.add(choices.join(','));
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  it('позиция верного кода варьируется между солями', () => {
    const positions = new Set<number>();
    for (let i = 0; i < 50; i++) {
      positions.add(buildCodeChoices('482', `salt-${i}`).indexOf('482'));
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});
