import clsx from 'clsx';
import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { api, type TaskComment, useAction, useMe, useMembers, useTaskComments } from '../../api';
import { fmtDateTime, fmtRelative } from '../../format';
import { Avatar, ErrorBox, Input, Skeleton, Timeline, type TimelineItem } from '../ui';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Kommentartext mit hervorgehobenen @-Erwähnungen. */
function CommentBody({ c, names }: { c: TaskComment; names: Map<string, string> }) {
  const mentioned = (c.mentions ?? []).map((m) => names.get(m)).filter((n): n is string => !!n);
  if (!mentioned.length) return <p className="break-words whitespace-pre-line text-ink">{c.body}</p>;
  const re = new RegExp(`(${mentioned.map((n) => `@${esc(n)}`).join('|')})`, 'g');
  return (
    <p className="break-words whitespace-pre-line text-ink">
      {c.body.split(re).map((part, i) =>
        mentioned.some((n) => part === `@${n}`) ? (
          <span key={i} className="rounded-[5px] bg-info-soft px-1 py-px font-medium text-info">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export type ActivityEvent = { id: string; at: number; icon: ReactNode; tone?: TimelineItem['tone']; title: ReactNode };

/**
 * Aktivität einer Aufgabe: Ereignisse (angelegt, erledigt …) und Kommentare in zeitlicher Reihenfolge,
 * darunter das Eingabefeld mit @-Erwähnungen (Pfeiltasten, Enter/Tab übernimmt, Escape schließt).
 */
export function Activity({ taskId, canWrite, events }: { taskId: string; canWrite: boolean; events: ActivityEvent[] }) {
  const { data, isLoading } = useTaskComments(taskId);
  const members = useMembers();
  const names = useMemo(() => new Map((members.data?.members ?? []).map((m) => [m.id, m.name])), [members.data]);
  const items: (TimelineItem & { at: number })[] = [
    ...events.map((e) => ({ id: e.id, at: e.at, icon: e.icon, tone: e.tone, title: e.title, time: <span title={fmtDateTime(e.at)}>{fmtRelative(e.at)}</span> })),
    ...(data ?? []).map((c) => ({
      id: c.id,
      at: c.createdAt,
      icon: <Avatar name={c.authorName} size="sm" />,
      title: <span className="font-medium">{c.authorName}</span>,
      time: <span title={fmtDateTime(c.createdAt)}>{fmtRelative(c.createdAt)}</span>,
      body: <CommentBody c={c} names={names} />,
    })),
  ].sort((a, b) => a.at - b.at);
  return (
    <div>
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : (
        <Timeline items={items} />
      )}
      {!isLoading && !data?.length && <p className="mt-4 text-meta text-ink-3">Noch keine Kommentare. Mit @ holst du jemanden dazu.</p>}
      {canWrite && <Composer taskId={taskId} />}
    </div>
  );
}

function Composer({ taskId }: { taskId: string }) {
  const members = useMembers();
  const { data: me } = useMe();
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Erwähnung beginnt mit @ am Wortanfang bis zur Schreibmarke
  const query = /(?:^|\s)@([^\s@]{0,30})$/.exec(body.slice(0, caret))?.[1];
  const suggestions =
    query == null ? [] : (members.data?.members ?? []).filter((m) => m.id !== me?.user.id && m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const add = useAction(
    () => api(`/tasks/${taskId}/comments`, { body: { body, mentions: picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id) } }),
    () => {
      setBody('');
      setPicked([]);
    },
  );
  const choose = (m: { id: string; name: string }) => {
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${m.name} `);
    setBody(before + body.slice(caret));
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, { id: m.id, name: m.name }]));
    setCaret(before.length);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(suggestions[Math.min(active, suggestions.length - 1)]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      setCaret(0);
    }
  };
  return (
    <form
      className="relative mt-5 flex items-center gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) add.mutate(undefined);
      }}
    >
      {me && <Avatar name={me.user.name} size="sm" className="hidden sm:inline-grid" />}
      <div className="relative min-w-0 flex-1">
        <Input
          ref={input}
          placeholder="Kommentar schreiben … (@ erwähnt jemanden)"
          aria-label="Kommentar"
          value={body}
          onKeyDown={onKey}
          className="rounded-full pr-12 pl-4"
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        />
        <button
          aria-label="Senden"
          disabled={add.isPending}
          className={clsx(
            'absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full transition-colors',
            body.trim() ? 'bg-ink text-white hover:bg-ink/88' : 'bg-sunken text-ink-3',
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.25} />
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Teammitglied erwähnen" className="animate-menu absolute bottom-full left-0 z-10 mb-1.5 w-72 max-w-full overflow-hidden rounded-xl bg-surface p-1 shadow-pop sm:left-9">
          {suggestions.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                className={clsx('flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left text-body sm:h-9', i === active ? 'bg-sunken' : 'hover:bg-hover')}
              >
                <Avatar name={m.name} size="xs" />
                <span className="truncate font-medium">{m.name}</span>
                <span className="ml-auto truncate text-caption text-ink-3">{m.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {add.error && <ErrorBox error={add.error} className="absolute top-full mt-2 w-full" />}
    </form>
  );
}
