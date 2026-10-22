/**
 * Друзья: правила «можно ли» — чистые функции без базы и без HTTP.
 *
 * Каждое действие с друзьями — на сайте и в боте — собирает отношение двух
 * людей из базы (lib/friends) и спрашивает здесь, можно ли. Правила в одном
 * месте и покрыты тестами: заявка, приглашение в группу и просьба вступить
 * проверяются одинаково, откуда бы ни пришли.
 */

/** Ограничения против спама и перебора. Счётчики — bumpCounter в bot_state. */
export const FRIEND_LIMITS = {
  /** Заявок в друзья (и добавлений по ссылке) в сутки от одного человека. */
  requestsPerDay: 20,
  /** Поисков по @нику в час: перебирать ники пачками нельзя. */
  lookupsPerHour: 30,
  /** Приглашений в группы в сутки. */
  invitesPerDay: 30,
  /** Просьб вступить в группу друга в сутки. */
  asksPerDay: 10,
  /** Смен личной ссылки в сутки. */
  codeRotationsPerDay: 5,
  maxFriends: 500,
  /** Сколько заявок может одновременно ждать ответа. */
  maxPendingOut: 50,
  /** После отказа повторная заявка тому же человеку — не раньше чем через столько дней. */
  declineCooldownDays: 7,
  /** Сколько живёт приглашение в группу и просьба вступить. */
  inviteTtlDays: 14,
} as const;

const DAY_MS = 86_400_000;

/** Пара в порядке хранения: меньший id первым (friendships.user_a < user_b). */
export function pairOf(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/** Как связаны «я» и другой человек — всё, что нужно правилам. */
export type Relation = {
  self: boolean;
  friends: boolean;
  /** Я заблокировал его. */
  blockedByMe: boolean;
  /** Он заблокировал меня — об этом я узнать не должен. */
  blockedMe: boolean;
  /** Живая заявка от меня к нему. */
  outgoing: boolean;
  /** Живая заявка от него ко мне. */
  incoming: boolean;
  /** Когда он последний раз отклонил мою заявку. */
  declinedAt: Date | null;
};

export const NO_RELATION: Relation = {
  self: false,
  friends: false,
  blockedByMe: false,
  blockedMe: false,
  outgoing: false,
  incoming: false,
  declinedAt: null,
};

export type RequestRefusal =
  | "self"
  | "friends"
  | "pending"
  | "blocked"
  | "cooldown"
  | "too_many_friends"
  | "too_many_pending";

/**
 * Можно ли отправить заявку.
 *
 * - встречная заявка уже ждёт меня — это сразу дружба (`accept`);
 * - меня заблокировали — заявка «уходит» (`silent`), но её никто не увидит
 *   и уведомления не будет: о блокировке человек не узнаёт;
 * - после отказа — пауза `declineCooldownDays`, чтобы заявки не стали спамом.
 */
export function requestVerdict(
  rel: Relation,
  counts: { myFriends: number; theirFriends: number; myPendingOut: number },
  now: Date,
): { ok: true; accept: boolean; silent: boolean } | { ok: false; reason: RequestRefusal } {
  if (rel.self) return { ok: false, reason: "self" };
  if (rel.blockedByMe) return { ok: false, reason: "blocked" };
  if (rel.friends) return { ok: false, reason: "friends" };
  if (rel.incoming && !rel.blockedMe) return { ok: true, accept: true, silent: false };
  if (rel.outgoing) return { ok: false, reason: "pending" };
  if (rel.declinedAt && now.getTime() - rel.declinedAt.getTime() < FRIEND_LIMITS.declineCooldownDays * DAY_MS) {
    return { ok: false, reason: "cooldown" };
  }
  if (counts.myFriends >= FRIEND_LIMITS.maxFriends) return { ok: false, reason: "too_many_friends" };
  if (counts.myPendingOut >= FRIEND_LIMITS.maxPendingOut) return { ok: false, reason: "too_many_pending" };
  if (rel.blockedMe) return { ok: true, accept: false, silent: true };
  if (counts.theirFriends >= FRIEND_LIMITS.maxFriends) return { ok: false, reason: "too_many_friends" };
  return { ok: true, accept: false, silent: false };
}

/**
 * Добавление по личной ссылке: человек сам ею поделился, поэтому сразу
 * дружба, без заявки. Если владелец ссылки заблокировал пришедшего, ссылка
 * для него просто «не работает» — так же, как устаревшая.
 */
export function linkVerdict(
  rel: Relation,
  counts: { myFriends: number; theirFriends: number },
): { ok: true } | { ok: false; reason: "self" | "friends" | "blocked" | "invalid" | "too_many_friends" } {
  if (rel.self) return { ok: false, reason: "self" };
  if (rel.blockedMe) return { ok: false, reason: "invalid" };
  if (rel.blockedByMe) return { ok: false, reason: "blocked" };
  if (rel.friends) return { ok: false, reason: "friends" };
  if (counts.myFriends >= FRIEND_LIMITS.maxFriends || counts.theirFriends >= FRIEND_LIMITS.maxFriends) {
    return { ok: false, reason: "too_many_friends" };
  }
  return { ok: true };
}

/** Видит ли друг группы человека: только друг, без блокировок, если тот не скрыл их все. */
export function canSeeGroups(rel: Relation, owner: { friendsSeeGroups: boolean }): boolean {
  return rel.friends && !rel.blockedByMe && !rel.blockedMe && owner.friendsSeeGroups;
}

/** Видит ли друг общее свободное время: оба не против, и это друзья. */
export function canSeeFreeTime(
  rel: Relation,
  me: { friendsSeeFree: boolean },
  other: { friendsSeeFree: boolean },
): boolean {
  return rel.friends && !rel.blockedByMe && !rel.blockedMe && me.friendsSeeFree && other.friendsSeeFree;
}

export type InviteRefusal = "not_member" | "not_friend" | "blocked" | "already_member" | "pending";

/**
 * Можно ли позвать друга в группу. Звать может любой участник группы
 * (решение 22.10.2026), но только своего друга и только того, кого там нет.
 */
export function inviteVerdict(args: {
  rel: Relation;
  inviterIsMember: boolean;
  inviteeIsMember: boolean;
  pending: boolean;
}): { ok: true } | { ok: false; reason: InviteRefusal } {
  if (!args.inviterIsMember) return { ok: false, reason: "not_member" };
  if (args.rel.blockedByMe || args.rel.blockedMe) return { ok: false, reason: "blocked" };
  if (!args.rel.friends) return { ok: false, reason: "not_friend" };
  if (args.inviteeIsMember) return { ok: false, reason: "already_member" };
  if (args.pending) return { ok: false, reason: "pending" };
  return { ok: true };
}

export type AskRefusal = "not_friend" | "blocked" | "hidden" | "already_member" | "not_member" | "pending";

/**
 * Можно ли попроситься в группу друга: группа должна быть видна мне в его
 * карточке (не скрыта), он в ней состоит, а меня там нет.
 */
export function askVerdict(args: {
  rel: Relation;
  groupVisible: boolean;
  friendIsMember: boolean;
  askerIsMember: boolean;
  pending: boolean;
}): { ok: true } | { ok: false; reason: AskRefusal } {
  if (args.rel.blockedByMe || args.rel.blockedMe) return { ok: false, reason: "blocked" };
  if (!args.rel.friends) return { ok: false, reason: "not_friend" };
  if (!args.friendIsMember) return { ok: false, reason: "not_member" };
  if (!args.groupVisible) return { ok: false, reason: "hidden" };
  if (args.askerIsMember) return { ok: false, reason: "already_member" };
  if (args.pending) return { ok: false, reason: "pending" };
  return { ok: true };
}

/** Приглашение или просьба, как они лежат в базе, — для проверки при ответе. */
export type InviteRow = {
  kind: string;
  status: string;
  fromUser: number;
  toUser: number;
  expiresAt: Date;
};

export type InviteAnswerRefusal = "gone" | "not_yours" | "expired" | "already_member" | "inviter_left" | "blocked";

/**
 * Можно ли ответить на приглашение или просьбу — проверяется заново в момент
 * ответа: за две недели многое меняется. Отвечает всегда адресат (to_user).
 *
 * - invite: пригласивший всё ещё в группе, меня там нет;
 * - ask: я (участник) всё ещё в группе, просящего там нет.
 * Отказаться можно всегда, пока приглашение живо и адресовано мне.
 */
export function inviteAnswerVerdict(args: {
  invite: InviteRow | null;
  me: number;
  accept: boolean;
  now: Date;
  /** Кто должен быть в группе: пригласивший (invite) или я (ask). */
  hostIsMember: boolean;
  /** Кто должен вступить: я (invite) или просящий (ask). */
  joinerIsMember: boolean;
  blocked: boolean;
}): { ok: true } | { ok: false; reason: InviteAnswerRefusal } {
  const { invite } = args;
  if (!invite || invite.status !== "pending") return { ok: false, reason: "gone" };
  if (invite.toUser !== args.me) return { ok: false, reason: "not_yours" };
  if (invite.expiresAt.getTime() <= args.now.getTime()) return { ok: false, reason: "expired" };
  if (!args.accept) return { ok: true };
  if (args.blocked) return { ok: false, reason: "blocked" };
  if (!args.hostIsMember) return { ok: false, reason: "inviter_left" };
  if (args.joinerIsMember) return { ok: false, reason: "already_member" };
  return { ok: true };
}

/** Срок приглашения от момента создания. */
export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + FRIEND_LIMITS.inviteTtlDays * DAY_MS);
}

// --------------------------------------------------------------------------
// Личная ссылка
// --------------------------------------------------------------------------

/**
 * Алфавит кодов — тот же, что у кодов групп (lib/invite: без 0/O, 1/l/I и u),
 * но ядро не зависит от lib, поэтому своя копия; совпадение проверяет тест.
 */
export const FRIEND_CODE_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

/** Длина кода личной ссылки: 30^10 ≈ 6·10^14 — перебором не угадать. */
export const FRIEND_CODE_LENGTH = 10;

/** Новый случайный код. `random(n)` — n криптостойких байтов (crypto.randomBytes). */
export function newFriendCode(random: (n: number) => Uint8Array): string {
  const bytes = random(FRIEND_CODE_LENGTH * 2);
  let code = "";
  for (const byte of bytes) {
    // Отбрасываем хвост байта, на котором алфавит делится неровно, — без перекоса.
    if (byte >= 240) continue;
    code += FRIEND_CODE_ALPHABET[byte % FRIEND_CODE_ALPHABET.length];
    if (code.length === FRIEND_CODE_LENGTH) return code;
  }
  return code.length === FRIEND_CODE_LENGTH ? code : newFriendCode(random);
}

/**
 * Код из того, что пришло: ссылка /f/<код>, параметр мини-аппа f_<код> или
 * сам код с пробелами и заглавными. null — не похоже на код.
 */
export function normalizeFriendCode(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = /\/f\/([a-z0-9]+)/i.exec(trimmed)?.[1];
  const fromParam = /^f_([a-z0-9]+)$/i.exec(trimmed)?.[1];
  const candidate = (fromLink ?? fromParam ?? trimmed).replace(/[\s_-]+/g, "").toLowerCase();
  return candidate.length === FRIEND_CODE_LENGTH && [...candidate].every((char) => FRIEND_CODE_ALPHABET.includes(char))
    ? candidate
    : null;
}

/** Ник из поиска: «@Asel_N», «t.me/asel_n» → «asel_n». null — такого ника в Telegram быть не может. */
export function normalizeUsername(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "").replace(/^@+/, "");
  return /^[a-z][a-z0-9_]{3,31}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}
