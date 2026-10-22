import { displayName, type User } from "@/db/schema";

/** Две первые буквы имени: «Асель» → «Ас» — как кружки людей на доске. */
function initials(name: string): string {
  const word = name.replace(/^@/, "").trim().split(/\s+/)[0] ?? "";
  const letters = [...word];
  return letters.length === 0 ? "?" : letters[0]!.toUpperCase() + (letters[1] ?? "").toLowerCase();
}

/**
 * Фото человека или его инициалы — в списках друзей, заявок и в карточке.
 * `version` — метка фото (repo.avatarVersions): адрес с ней кэшируется навсегда.
 */
export function PersonAvatar({
  user,
  version,
  size = 40,
}: {
  user: Pick<User, "userId" | "fullName" | "username" | "realName">;
  version?: number | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (version) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- своё маленькое фото, оптимизатор Next не нужен
      <img
        className="fr-avatar"
        src={`/api/avatar/${user.userId}?v=${version}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        style={style}
      />
    );
  }
  return (
    <span className="fr-avatar" aria-hidden="true" style={style}>
      {initials(displayName(user))}
    </span>
  );
}
