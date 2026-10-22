"use client";

import { useState } from "react";

type Settings = { seeGroups: boolean; seeFree: boolean; findable: boolean };

/** Переключатель — флажок в виде тумблера: подпись, пояснение под ней. */
function Switch({
  name,
  value,
  checked,
  onChange,
  label,
  hint,
}: {
  name: string;
  value?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="fr-switch-row">
      <span className="fr-switch-text">
        <span>{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/**
 * Приватность друзей. Переключатели прямого смысла: «видна друзьям» у каждой
 * группы, а не «скрыть» (выключить «скрыть» — двойное отрицание). Список
 * групп гаснет, когда группы друзьям не видны вовсе: настраивать его тогда
 * бессмысленно, а прежний выбор сохраняется (погашенные поля не уходят на
 * сервер, см. saveFriendSettingsAction). Сохранение явное — это приватность —
 * и кнопка включается, только когда что-то изменено.
 */
export function PrivacyForm({
  action,
  initial,
  groups,
  labels,
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial: Settings;
  groups: { chatId: number; title: string; visible: boolean }[];
  labels: {
    seeGroups: string;
    seeGroupsHint: string;
    seeFree: string;
    seeFreeHint: string;
    findable: string;
    findableHint: string;
    groupsTitle: string;
    groupsOff: string;
    save: string;
  };
}) {
  const [settings, setSettings] = useState(initial);
  const [visible, setVisible] = useState(() => new Map(groups.map((group) => [group.chatId, group.visible])));
  const dirty =
    settings.seeGroups !== initial.seeGroups ||
    settings.seeFree !== initial.seeFree ||
    settings.findable !== initial.findable ||
    groups.some((group) => visible.get(group.chatId) !== group.visible);
  const set = (key: keyof Settings) => (next: boolean) => setSettings((current) => ({ ...current, [key]: next }));

  return (
    <form action={action} className="fr-settings">
      <Switch
        name="friends_see_groups"
        checked={settings.seeGroups}
        onChange={set("seeGroups")}
        label={labels.seeGroups}
        hint={labels.seeGroupsHint}
      />
      <Switch
        name="friends_see_free"
        checked={settings.seeFree}
        onChange={set("seeFree")}
        label={labels.seeFree}
        hint={labels.seeFreeHint}
      />
      <Switch
        name="findable"
        checked={settings.findable}
        onChange={set("findable")}
        label={labels.findable}
        hint={labels.findableHint}
      />
      {groups.length > 0 && (
        <fieldset className="fr-visible" disabled={!settings.seeGroups}>
          <legend className="label">{labels.groupsTitle}</legend>
          {!settings.seeGroups && <p className="small muted fr-visible-off">{labels.groupsOff}</p>}
          {groups.map((group) => (
            <Switch
              key={group.chatId}
              name="visible"
              value={String(group.chatId)}
              checked={visible.get(group.chatId) ?? true}
              onChange={(next) => setVisible((current) => new Map(current).set(group.chatId, next))}
              label={group.title}
            />
          ))}
        </fieldset>
      )}
      <button className="btn btn-primary" type="submit" disabled={!dirty}>
        {labels.save}
      </button>
    </form>
  );
}
