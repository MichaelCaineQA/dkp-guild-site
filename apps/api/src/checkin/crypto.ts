import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { CHECKIN_CODE_PATTERN, type CheckInWindowState } from '@dkp/shared';

/**
 * Криптография чек-ина (план 2.2): node:crypto живёт здесь, не в shared.
 *
 * Хранение: хэш с солью (sha256) для сверки попыток + AES-256-GCM
 * шифротекст того же кода для повторного показа РЛ (переживает рестарт
 * процесса, нечитаем из БД напрямую). Открытым текстом код не хранится.
 */

/** Трёхзначный код: 100–999, без ведущих нулей (план 2.2). */
export function generateCheckInCode(): string {
  return String(randomInt(100, 1000));
}

/** Хэш кода с солью (sha256); соль уникальна для каждого кода. */
export function hashCheckInCode(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/** Генерация кода: тройка — сам код (один раз), соль и хэш для БД. */
export function newCodeWithHash(): { code: string; salt: string; codeHash: string } {
  const code = generateCheckInCode();
  const salt = randomBytes(16).toString('hex');
  return { code, salt, codeHash: hashCheckInCode(code, salt) };
}

/** Сверка попытки игрока с сохранённым хэшем. */
export function isCodeCorrect(attempt: string, salt: string, codeHash: string): boolean {
  return hashCheckInCode(attempt.trim(), salt) === codeHash;
}

/** Шифрование кода AES-256-GCM: «v1:iv:tag:ciphertext», всё в hex. */
export function encryptCheckInCode(code: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Расшифровка кода (только для показа РЛ). Битое значение — null. */
export function decryptCheckInCode(sealed: string, keyHex: string): string | null {
  try {
    const [version, ivHex, tagHex, dataHex] = sealed.split(':');
    if (version !== 'v1') {
      return null;
    }
    const key = Buffer.from(keyHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Набор из 4 вариантов для игрока (план 2.2): верный код + 3 обманки,
 * перемешанно. Обманки не совпадают с верным кодом и между собой.
 */
export function buildCodeChoices(correctCode: string): string[] {
  const choices = new Set<string>([correctCode]);
  while (choices.size < 4) {
    choices.add(generateCheckInCode());
  }
  // Перемешивание Фишера—Йетса по независимым случайным числам
  const array = Array.from(choices);
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/** Проверка формата кода (используется и в тестах). */
export function isValidCodeFormat(code: string): boolean {
  return CHECKIN_CODE_PATTERN.test(code);
}

/** Экспорт типа для удобства импорта рядом с crypto-хелперами. */
export type { CheckInWindowState };
