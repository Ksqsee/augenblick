import clsx from 'clsx';
import { Camera, ImageOff, X } from 'lucide-react';
import { fileUrl } from '../../api';

/** Vorher/Nachher nebeneinander – auch wenn eines fehlt, bleibt der Platz als ruhiger Platzhalter. */
export function PhotoPair({ before, after, resolved }: { before?: string | null; after?: string | null; resolved: boolean }) {
  if (!before && !after) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Photo k={before} label="Vorher" />
      {after ? <Photo k={after} label="Nachher" tone="ok" /> : <Placeholder text={resolved ? 'Kein Foto nach Behebung' : 'Nach der Behebung'} />}
    </div>
  );
}

function Photo({ k, label, tone }: { k?: string | null; label: string; tone?: 'ok' }) {
  if (!k) return <Placeholder text="Kein Foto" />;
  return (
    <figure className="min-w-0">
      <a href={fileUrl(k)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-sunken">
        <img src={fileUrl(k)} alt={label} className="aspect-[4/3] w-full object-cover transition-transform duration-200 hover:scale-[1.02]" />
      </a>
      <figcaption className="mt-1.5 flex items-center gap-1.5 text-caption font-medium text-ink-2">
        <span className={clsx('size-1.5 rounded-full', tone === 'ok' ? 'bg-ok' : 'bg-ink-3')} />
        {label}
      </figcaption>
    </figure>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="min-w-0">
      <div className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-line-strong text-center text-caption text-ink-3">
        <span className="flex flex-col items-center gap-1.5 px-2">
          <ImageOff className="size-4 text-ink-4" />
          {text}
        </span>
      </div>
      <p className="mt-1.5 text-caption text-transparent select-none" aria-hidden>
        –
      </p>
    </div>
  );
}

/** Foto-Kachel zum Aufnehmen/Wählen (große Fläche, auch mit Handschuh gut zu treffen). */
export function PhotoPicker({ photo, onPick, onClear, label }: { photo: { url: string } | null; onPick: (f: File) => void; onClear: () => void; label: string }) {
  if (photo)
    return (
      <div className="relative w-36 shrink-0">
        <img src={photo.url} alt={label} className="aspect-[4/3] w-full rounded-xl object-cover shadow-card" />
        <button
          type="button"
          aria-label="Foto entfernen"
          onClick={onClear}
          className="absolute -top-2 -right-2 grid size-8 place-items-center rounded-full bg-ink text-white shadow-pop ring-2 ring-surface transition active:scale-95"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  return (
    <label className="flex aspect-[4/3] w-36 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-canvas text-meta font-medium text-ink-2 transition-colors hover:border-ink-3 hover:bg-hover focus-within:ring-[3px] focus-within:ring-ink/10">
      <Camera className="size-5 text-ink-3" />
      Foto
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </label>
  );
}
