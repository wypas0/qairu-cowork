"use client";

import Link from "next/link";
import { useState } from "react";

import { IconChevronRight, IconSearch } from "../icons";

export type FriendRow = {
  id: number;
  name: string;
  /** «@asel_n» или null. */
  nick: string | null;
  /** «2 общие группы» или «друзья с 22.10». */
  note: string;
  avatarUrl: string | null;
  initials: string;
};

/** С какого числа друзей появляется поиск: в короткий список и так всё видно. */
const FILTER_FROM = 9;

/**
 * Список друзей. Строка целиком — ссылка на карточку друга. Когда друзей
 * больше восьми, сверху поиск по имени и нику: в длинном списке человека
 * иначе не найти.
 */
export function FriendsList({ rows, labels }: { rows: FriendRow[]; labels: { filter: string; none: string } }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  const shown = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle) || (row.nick ?? "").toLowerCase().includes(needle))
    : rows;

  return (
    <>
      {rows.length >= FILTER_FROM && (
        <div className="fr-filter">
          <IconSearch size={16} className="muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.filter}
            aria-label={labels.filter}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="small muted fr-search-note">{labels.none}</p>
      ) : (
        <ul className="fr-list">
          {shown.map((row) => (
            <li key={row.id}>
              <Link className="fr-row fr-link" href={`/friends/${row.id}`}>
                {row.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- своё маленькое фото, оптимизатор Next не нужен
                  <img className="fr-avatar" src={row.avatarUrl} alt="" width={40} height={40} loading="lazy" style={{ width: 40, height: 40 }} />
                ) : (
                  <span className="fr-avatar" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 14 }}>
                    {row.initials}
                  </span>
                )}
                <span className="fr-who">
                  <b>{row.name}</b>
                  <span className="small muted">{[row.nick, row.note].filter(Boolean).join(" · ")}</span>
                </span>
                <IconChevronRight className="muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
