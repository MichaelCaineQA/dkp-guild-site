import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RulesMarkdown } from './rules';
afterEach(cleanup);

it('рендерит заголовки, таблицы, списки, эмодзи и картинки', () => {
  render(
    <RulesMarkdown
      content={
        '# Участие ✅\n\n- Первый пункт\n\n| Ивент | ДКП |\n| --- | --- |\n| Босс | 10 |\n\n![Пример](https://example.com/rules.png)'
      }
    />,
  );
  expect(screen.getByRole('heading', { name: 'Участие ✅' })).toBeDefined();
  expect(screen.getByRole('list')).toBeDefined();
  expect(screen.getByRole('table')).toBeDefined();
  expect(screen.getByRole('cell', { name: '10' })).toBeDefined();
  expect(screen.getByAltText('Пример').getAttribute('src')).toBe('https://example.com/rules.png');
});

it('не создаёт raw HTML и javascript-ссылки', () => {
  const { container } = render(
    <RulesMarkdown
      content={
        '<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>\n\n[Опасная ссылка](javascript:alert%281%29)'
      }
    />,
  );
  expect(container.querySelector('script, iframe')).toBeNull();
  expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript:');
});
