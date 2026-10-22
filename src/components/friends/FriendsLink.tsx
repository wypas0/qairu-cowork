import Link from "next/link";

import { IconFriends } from "../icons";

/**
 * «Друзья» в сайдбаре — рядом с «Создать группу». Счётчик — то же, что
 * точка на кнопке профиля: заявки, приглашения в группы, просьбы вступить.
 * В свёрнутой полосе он садится на угол значка, как у групп.
 */
export function FriendsLink({ label, count, countLabel }: { label: string; count: number; countLabel: string }) {
  return (
    <Link className="sidebar-link sidebar-friends" href="/friends" title={label}>
      <IconFriends size={18} />
      <span className="sidebar-label">{label}</span>
      {count > 0 && (
        <span className="count-badge" aria-label={countLabel}>
          {count}
        </span>
      )}
    </Link>
  );
}
