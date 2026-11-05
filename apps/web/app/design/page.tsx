import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Select,
  Table,
} from '../../components/ui';

/**
 * Витрина дизайна: все токены и UI-примитивы на живых примерах.
 * Страница для согласования стиля с главой гильдии — показываем её,
 * а не абстрактные палитры. Не требует входа: только демонстрация.
 * Когда дизайн согласован и внесён в токены, страница остаётся
 * живой документацией компонентов.
 */
export default function DesignPage() {
  return (
    <Page width="wide">
      <PageHeader
        title="Витрина дизайна"
        subtitle="Все цвета, текстуры и компоненты сайта. Стиль меняется в одном месте — app/globals.css (токены), components/ui (примитивы) — и применяется ко всем страницам."
      />

      <Card>
        <SectionTitle>Палитра</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ['Фон страницы', 'bg-page', 'bg-page'],
              ['Поверхность (карточки)', 'surface', 'bg-surface'],
              ['Приглушённая зона', 'surface-muted', 'bg-surface-muted'],
              ['Основной текст', 'text-primary', 'bg-primary'],
              ['Вторичный текст', 'text-secondary', 'bg-secondary'],
              ['Линии/рамки', 'border', 'bg-line'],
              ['Акцент', 'accent', 'bg-accent'],
              ['Акцент, лёгкая заливка', 'accent-soft', 'bg-accent-soft'],
              ['Успех', 'success', 'bg-success'],
              ['Ошибка', 'danger', 'bg-danger'],
              ['Предупреждение', 'warning', 'bg-warning'],
            ] as const
          ).map(([title, token, cls]) => (
            <div key={token} className="rounded-card border border-line">
              <div className={`h-12 rounded-t-card ${cls}`} />
              <div className="p-2 text-xs">
                <div className="font-medium text-primary">{title}</div>
                <code className="text-secondary">{token}</code>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm">
          <Muted>Тёмная тема — по системной настройке браузера: те же роли, другие значения.</Muted>
        </p>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Кнопки</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Основная</Button>
          <Button>Обычная</Button>
          <Button variant="danger">Разрушительная</Button>
          <Button disabled>Недоступная</Button>
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Поля ввода</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Игровой ник" />
          <Select defaultValue="">
            <option value="">роль в бою —</option>
            <option>ДД</option>
            <option>Хил</option>
            <option>Танк</option>
          </Select>
          <Field label="Период:">
            <Input type="date" />
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Бейджи</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>нейтральный</Badge>
          <Badge tone="accent">Хил</Badge>
          <Badge tone="success">пришёл</Badge>
          <Badge tone="warning">опоздал</Badge>
          <Badge tone="danger">неявка</Badge>
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Таблица (пример — состав гильдии)</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Table.Th>Ник</Table.Th>
              <Table.Th>Ранг</Table.Th>
              <Table.Th>Роль в бою</Table.Th>
              <Table.Th>Баланс</Table.Th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Aeliana', 'Глава', 'Хил', 320],
              ['Varkas', 'Офицер', 'Танк', 145],
              ['Nyx', 'Рядовой', 'ДД', 78],
            ].map(([nick, rank, role, balance]) => (
              <Table.Row key={nick as string}>
                <Table.Td className="font-medium">{nick}</Table.Td>
                <Table.Td>{rank}</Table.Td>
                <Table.Td>
                  <Badge tone="accent">{role}</Badge>
                </Table.Td>
                <Table.Td>{balance}</Table.Td>
              </Table.Row>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <SectionTitle>Сообщения</SectionTitle>
        <div className="flex flex-col gap-3">
          <Notice>
            Информационное сообщение — пояснения, приглашение войти, пустые состояния.
          </Notice>
          <Notice tone="success">Успех: заявка отправлена, сохранено, отметка принята.</Notice>
          <Notice tone="danger">Ошибка: не удалось загрузить, недостаточно прав.</Notice>
          <ErrorText>Текст ошибки прямо у контрола (ErrorText).</ErrorText>
          <p className="text-sm text-primary">
            Обычный текст и <Muted>приглушённый (Muted)</Muted>.
          </p>
        </div>
      </Card>
    </Page>
  );
}
