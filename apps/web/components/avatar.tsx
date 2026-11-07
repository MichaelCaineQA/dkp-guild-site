import type { Avatar as AvatarId, AvatarColor } from '@dkp/shared';
export const AVATAR_PALETTE: Record<AvatarColor, { color: string; label: string }> = {
  ORANGE: { color: '#f97316', label: 'Оранжевый' },
  RED: { color: '#dc2626', label: 'Красный' },
  PINK: { color: '#db2777', label: 'Розовый' },
  PURPLE: { color: '#9333ea', label: 'Фиолетовый' },
  INDIGO: { color: '#4f46e5', label: 'Индиго' },
  BLUE: { color: '#2563eb', label: 'Синий' },
  CYAN: { color: '#0891b2', label: 'Голубой' },
  TEAL: { color: '#0f766e', label: 'Бирюзовый' },
  GREEN: { color: '#15803d', label: 'Зелёный' },
  LIME: { color: '#65a30d', label: 'Лаймовый' },
  GOLD: { color: '#ca8a04', label: 'Золотой' },
  SLATE: { color: '#475569', label: 'Графитовый' },
};

const ICONS: Record<AvatarId, { color: string; symbol: string; label: string }> = {
  AURORA: { color: '#6d28d9', symbol: '🌟', label: 'Звезда' },
  EMBER: { color: '#ea580c', symbol: '🔥', label: 'Уголь' },
  FOREST: { color: '#15803d', symbol: '🌳', label: 'Лес' },
  OCEAN: { color: '#0284c7', symbol: '🌊', label: 'Океан' },
  VIOLET: { color: '#a21caf', symbol: '✨', label: 'Сияние' },
  GOLD: { color: '#d97706', symbol: '☀️', label: 'Солнце' },
  IRON: { color: '#475569', symbol: '🛡️', label: 'Щит' },
  ROSE: { color: '#db2777', symbol: '🌺', label: 'Цветок' },
  FOX: { color: '#f97316', symbol: '🦊', label: 'Лиса' },
  WOLF: { color: '#6366f1', symbol: '🐺', label: 'Волк' },
  DRAGON: { color: '#059669', symbol: '🐲', label: 'Дракон' },
  OWL: { color: '#92400e', symbol: '🦉', label: 'Сова' },
  RAVEN: { color: '#4338ca', symbol: '🐦‍⬛', label: 'Ворон' },
  TIGER: { color: '#f59e0b', symbol: '🐯', label: 'Тигр' },
  LION: { color: '#b45309', symbol: '🦁', label: 'Лев' },
  PANDA: { color: '#0d9488', symbol: '🐼', label: 'Панда' },
  FROG: { color: '#65a30d', symbol: '🐸', label: 'Лягушка' },
  BUTTERFLY: { color: '#7c3aed', symbol: '🦋', label: 'Бабочка' },
  PHOENIX: { color: '#e11d48', symbol: '🐦‍🔥', label: 'Феникс' },
  UNICORN: { color: '#c026d3', symbol: '🦄', label: 'Единорог' },
  MOON: { color: '#3730a3', symbol: '🌙', label: 'Луна' },
  COMET: { color: '#2563eb', symbol: '☄️', label: 'Комета' },
  CRYSTAL: { color: '#0891b2', symbol: '💎', label: 'Кристалл' },
  POTION: { color: '#9333ea', symbol: '🧪', label: 'Зелье' },
  BOOK: { color: '#be123c', symbol: '📖', label: 'Гримуар' },
  BOW: { color: '#4d7c0f', symbol: '🏹', label: 'Лучник' },
  SWORD: { color: '#1d4ed8', symbol: '⚔️', label: 'Воин' },
  CROWN: { color: '#ca8a04', symbol: '👑', label: 'Корона' },
  MUSHROOM: { color: '#dc2626', symbol: '🍄', label: 'Гриб' },
  LOTUS: { color: '#db2777', symbol: '🪷', label: 'Лотос' },
  SHELL: { color: '#0f766e', symbol: '🐚', label: 'Ракушка' },
  LIGHTNING: { color: '#4f46e5', symbol: '⚡', label: 'Молния' },
};
export function avatarLabel(id: AvatarId) {
  return ICONS[id].label;
}
export function Avatar({
  avatar,
  avatarColor,
  nickname,
  size = 'default',
}: {
  avatar?: string | null;
  avatarColor?: string | null;
  nickname: string;
  size?: 'default' | 'large' | 'profile';
}) {
  const icon = avatar ? ICONS[avatar as AvatarId] : undefined;
  const background =
    (avatarColor ? AVATAR_PALETTE[avatarColor as AvatarColor]?.color : undefined) ??
    icon?.color ??
    '#64748b';
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-2xl text-white shadow-sm ring-1 ring-inset ring-white/20 ${size === 'profile' ? 'h-24 w-24 text-5xl' : size === 'large' ? 'h-16 w-16 text-4xl' : 'h-12 w-12 text-3xl'}`}
      style={{
        background: `radial-gradient(circle at 25% 15%, #ffffff70, transparent 65%), linear-gradient(145deg, ${background}, ${background}cc)`,
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
      }}
    >
      {icon?.symbol ?? Array.from(nickname).slice(0, 2).join('')}
    </span>
  );
}
