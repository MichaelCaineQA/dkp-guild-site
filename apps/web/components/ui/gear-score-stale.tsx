export function GearScoreStale({ stale }: { stale?: boolean }) {
  return stale ? (
    <span title="GS устарел" aria-label="GS устарел" className="ml-1 text-amber-500">
      ⚠
    </span>
  ) : null;
}
