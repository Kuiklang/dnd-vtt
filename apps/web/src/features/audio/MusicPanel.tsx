import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioCategory, MusicLoopMode } from "@vtt/rules";
import { Badge, Button, Input, Modal, Select, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { postMultipart } from "../../lib/upload";
import { useAsync } from "../../lib/useAsync";
import { toast } from "../../stores/toast";
import { useT, type MessageKey } from "../../i18n";
import type { CampaignAudio } from "./useCampaignAudio";
import { formatTime, positionNow } from "./useCampaignAudio";
import { Slider } from "./AudioDock";
import type { AudioTrack, ControlAction, Playlist } from "./types";

export const AUDIO_ACCEPT = "audio/mpeg,audio/ogg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/x-m4a,audio/aac,audio/webm,.mp3,.ogg,.oga,.opus,.wav,.flac,.m4a,.webm";

type Tab = "now" | "library" | "playlists";
const CATEGORIES: AudioCategory[] = ["music", "ambient", "sfx"];
const CATEGORY_KEY: Record<AudioCategory, MessageKey> = { music: "audio.music", ambient: "audio.ambient", sfx: "audio.sfx" };

/** Reads a file's duration in the browser (the server can't decode audio). Null if the browser can't tell. */
export function measureDuration(file: File, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (v: number | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

const trackName = (file: File) => file.name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 100) || "Untitled";

interface Library {
  tracks: AudioTrack[];
  playlists: Playlist[];
}

export function MusicPanel({ open, onClose, campaignId, audio }: { open: boolean; onClose(): void; campaignId: string; audio: CampaignAudio }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("now");
  const base = `/api/campaigns/${campaignId}/audio`;
  const lib = useAsync(() => api.get<Library>(base), [base]);
  const tracks = useMemo(() => new Map((lib.data?.tracks ?? []).map((x) => [x.id, x])), [lib.data]);

  const run = async (action: ControlAction) => {
    try {
      await audio.control(action);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("audio.title")} wide>
      <div className="-mt-1 mb-3 flex flex-wrap gap-1 border-b border-ink-700" role="tablist">
        {(["now", "library", "playlists"] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            onClick={() => setTab(x)}
            data-testid={`music-tab-${x}`}
            className={cx("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === x ? "border-gold-400 text-gold-300" : "border-transparent text-parchment-400 hover:text-parchment-100")}
          >
            {t(`audio.tab.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      {tab === "now" && <NowPlaying audio={audio} tracks={tracks} playlists={lib.data?.playlists ?? []} run={run} />}
      {tab === "library" && <LibraryTab campaignId={campaignId} base={base} lib={lib} audio={audio} run={run} />}
      {tab === "playlists" && <PlaylistsTab base={base} lib={lib} run={run} />}
    </Modal>
  );
}

function NowPlaying({ audio, tracks, playlists, run }: { audio: CampaignAudio; tracks: Map<string, AudioTrack>; playlists: Playlist[]; run(a: ControlAction): Promise<void> }) {
  const t = useT();
  const music = audio.view?.music ?? null;
  const [, force] = useState(0);
  useEffect(() => {
    if (!music?.playing) return;
    const timer = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(timer);
  }, [music?.playing]);
  const pos = music ? positionNow(music, audio.offsetMs) : 0;
  const duration = music?.track?.durationSec ?? null;
  const playlist = music?.playlistId ? playlists.find((p) => p.id === music.playlistId) : undefined;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-ink-700 bg-ink-950/60 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-parchment-400">
          {t("audio.music")} {playlist && <Badge tone="gold">{playlist.name}</Badge>}
        </div>
        {music?.track ? (
          <>
            <p className="truncate font-display text-lg text-parchment-50" data-testid="music-current">
              {music.track.name}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs tabular-nums text-parchment-400">
              <span data-testid="music-position">{formatTime(duration ? Math.min(pos, duration) : pos)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(duration ?? 0))}
                value={Math.round(duration ? Math.min(pos, duration) : 0)}
                disabled={!duration}
                onChange={(e) => void run({ kind: "seek", position: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-gold-500"
                aria-label={t("audio.seek")}
              />
              <span>{formatTime(duration)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void run({ kind: "prev" })} aria-label={t("audio.prev")} title={t("audio.prev")}>⏮</Button>
              {music.playing ? (
                <Button size="sm" onClick={() => void run({ kind: "pause" })} data-testid="music-pause">⏸ {t("audio.pause")}</Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => void run({ kind: "resume" })} data-testid="music-resume">▶ {t("audio.play")}</Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void run({ kind: "next" })} aria-label={t("audio.next")} title={t("audio.next")} data-testid="music-next">⏭</Button>
              <Button size="sm" variant="ghost" onClick={() => void run({ kind: "stop" })} data-testid="music-stop">⏹ {t("audio.stop")}</Button>
              <div className="w-40">
              <Select value={music.loop} onChange={(e) => void run({ kind: "loop", loop: e.target.value as MusicLoopMode })} className="h-8 text-xs" aria-label={t("audio.loop")} data-testid="music-loop">
                <option value="off">{t("audio.loop.off")}</option>
                <option value="track">{t("audio.loop.track")}</option>
                <option value="queue">{t("audio.loop.queue")}</option>
              </Select>
              </div>
            </div>
            <div className="mt-3 max-w-sm">
              <Slider label={t("audio.dmVolume")} value={music.volume} onChange={(v) => void run({ kind: "musicVolume", volume: v })} testId="music-volume" />
            </div>
            {music.queue && music.queue.length > 1 && (
              <ol className="mt-3 max-h-40 space-y-0.5 overflow-y-auto text-sm" data-testid="music-queue">
                {music.queue.map((id, i) => (
                  <li key={`${id}-${i}`} className={cx("truncate", i === music.index ? "text-gold-300" : "text-parchment-400")}>
                    {i + 1}. {tracks.get(id)?.name ?? "…"}
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p className="text-sm text-parchment-400">{t("audio.nothing")}</p>
        )}
      </section>

      <section className="rounded-lg border border-ink-700 bg-ink-950/60 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-parchment-400">{t("audio.ambient")}</div>
        {audio.view?.ambient.length ? (
          <ul className="space-y-2" data-testid="ambient-layers">
            {audio.view.ambient.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2" data-testid={`ambient-${a.track.name}`}>
                <button
                  type="button"
                  onClick={() => void run({ kind: "ambientToggle", layerId: a.id, playing: !a.playing })}
                  className="h-7 w-7 rounded border border-ink-600 text-sm"
                  aria-label={a.playing ? t("audio.pause") : t("audio.play")}
                >
                  {a.playing ? "⏸" : "▶"}
                </button>
                <span className={cx("w-36 truncate text-sm", !a.playing && "text-parchment-500")}>{a.track.name}</span>
                <div className="min-w-40 flex-1">
                  <Slider label={t("audio.dmVolume")} value={a.volume} onChange={(v) => void run({ kind: "ambientVolume", layerId: a.id, volume: v })} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => void run({ kind: "ambientRemove", layerId: a.id })} aria-label={t("audio.remove")}>✕</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-parchment-400">{t("audio.noAmbient")}</p>
        )}
      </section>

      <div className="flex justify-end">
        <Button variant="danger" size="sm" onClick={() => void run({ kind: "stopAll" })} data-testid="music-stop-all">
          {t("audio.stopAll")}
        </Button>
      </div>
    </div>
  );
}

function LibraryTab({ campaignId, base, lib, audio, run }: { campaignId: string; base: string; lib: ReturnType<typeof useAsync<Library>>; audio: CampaignAudio; run(a: ControlAction): Promise<void> }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<AudioCategory>("music");
  const [uploading, setUploading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string; tags: string } | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const durationSec = await measureDuration(file);
        const { asset } = await postMultipart<{ asset: { id: string } }>("/api/assets", { kind: "audio", campaignId }, file);
        await api.post(`${base}/tracks`, { assetId: asset.id, name: trackName(file), category, durationSec });
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    await lib.reload();
  };

  const saveRename = async () => {
    if (!rename) return;
    try {
      const tags = rename.tags.split(",").map((x) => x.trim()).filter(Boolean);
      await api.put(`${base}/tracks/${rename.id}`, { name: rename.name.trim(), tags });
      setRename(null);
      await lib.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (track: AudioTrack) => {
    if (!window.confirm(t("audio.deleteConfirm", { name: track.name }))) return;
    try {
      await api.del(`${base}/tracks/${track.id}`);
      await lib.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setTrackCategory = async (track: AudioTrack, c: AudioCategory) => {
    try {
      await api.put(`${base}/tracks/${track.id}`, { category: c });
      await lib.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (lib.data?.tracks ?? []).filter((x) => !q || x.name.toLowerCase().includes(q) || x.tags.some((tag) => tag.toLowerCase().includes(q)));
  const ambientIds = new Set(audio.view?.ambient.map((a) => a.track.id));
  const currentId = audio.view?.music?.track?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-ink-600 p-3">
        <label className="w-40 text-sm">
          <span className="mb-1 block text-xs text-parchment-400">{t("audio.uploadAs")}</span>
          <Select value={category} onChange={(e) => setCategory(e.target.value as AudioCategory)} className="h-9" data-testid="audio-upload-category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(CATEGORY_KEY[c])}</option>
            ))}
          </Select>
        </label>
        <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} multiple className="hidden" onChange={(e) => void upload(e.target.files)} data-testid="audio-file" />
        <Button onClick={() => fileRef.current?.click()} loading={uploading !== null} data-testid="audio-upload">
          ⬆ {uploading ? t("audio.uploading", { name: uploading }) : t("audio.upload")}
        </Button>
        <p className="w-full text-xs text-parchment-500">{t("audio.uploadHint")}</p>
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("audio.search")} className="h-9" data-testid="audio-search" />
      {lib.error && <p className="text-sm text-blood-400">{lib.error}</p>}
      {lib.data && lib.data.tracks.length === 0 && <p className="text-sm text-parchment-400">{t("audio.emptyLibrary")}</p>}

      {CATEGORIES.map((c) => {
        const items = visible.filter((x) => x.category === c);
        if (items.length === 0) return null;
        return (
          <section key={c}>
            <h4 className="mb-1 text-xs uppercase tracking-wide text-parchment-400">{t(CATEGORY_KEY[c])}</h4>
            <ul className="divide-y divide-ink-800 rounded border border-ink-700">
              {items.map((track) => (
                <li key={track.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid={`track-${track.name}`}>
                  {rename?.id === track.id ? (
                    <>
                      <Input value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} className="h-8 w-44" aria-label={t("audio.name")} />
                      <Input value={rename.tags} onChange={(e) => setRename({ ...rename, tags: e.target.value })} className="h-8 w-44" placeholder={t("audio.tags")} aria-label={t("audio.tags")} />
                      <Button size="sm" variant="primary" onClick={() => void saveRename()}>{t("common.save")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRename(null)}>{t("common.cancel")}</Button>
                    </>
                  ) : (
                    <>
                      <span className={cx("min-w-0 flex-1 truncate text-sm", currentId === track.id && "text-gold-300")}>
                        {track.name}
                        {track.tags.length > 0 && <span className="ml-2 text-xs text-parchment-500">{track.tags.join(", ")}</span>}
                      </span>
                      <span className="text-xs tabular-nums text-parchment-500">{formatTime(track.durationSec)}</span>
                      {c === "music" && (
                        <Button size="sm" variant="primary" onClick={() => void run({ kind: "playTrack", trackId: track.id })} data-testid={`track-play-${track.name}`}>▶</Button>
                      )}
                      {c === "ambient" && (
                        <Button size="sm" disabled={ambientIds.has(track.id)} onClick={() => void run({ kind: "ambientAdd", trackId: track.id })} data-testid={`track-ambient-${track.name}`}>
                          + {t("audio.layer")}
                        </Button>
                      )}
                      {c === "sfx" && (
                        <Button size="sm" onClick={() => audio.playSfx(track.id).catch((e) => toast.error(errorMessage(e)))} data-testid={`track-sfx-${track.name}`}>
                          🔔 {t("audio.playOnce")}
                        </Button>
                      )}
                      <div className="w-32">
                        <Select value={track.category} onChange={(e) => void setTrackCategory(track, e.target.value as AudioCategory)} className="h-8 text-xs" aria-label={t("audio.category")}>
                          {CATEGORIES.map((x) => (
                            <option key={x} value={x}>{t(CATEGORY_KEY[x])}</option>
                          ))}
                        </Select>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setRename({ id: track.id, name: track.name, tags: track.tags.join(", ") })} aria-label={t("audio.rename")} title={t("audio.rename")}>✎</Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove(track)} aria-label={t("audio.delete")} title={t("audio.delete")}>🗑</Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PlaylistsTab({ base, lib, run }: { base: string; lib: ReturnType<typeof useAsync<Library>>; run(a: ControlAction): Promise<void> }) {
  const t = useT();
  const [edit, setEdit] = useState<{ id: string | null; version: number; name: string; trackIds: string[] } | null>(null);
  const [adding, setAdding] = useState("");
  const tracks = lib.data?.tracks ?? [];
  const byId = new Map(tracks.map((x) => [x.id, x]));

  const save = async () => {
    if (!edit) return;
    try {
      const body = { name: edit.name.trim(), trackIds: edit.trackIds };
      await (edit.id ? api.put(`${base}/playlists/${edit.id}`, { ...body, expectedVersion: edit.version }) : api.post(`${base}/playlists`, body));
      setEdit(null);
      await lib.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (p: Playlist) => {
    if (!window.confirm(t("audio.deleteConfirm", { name: p.name }))) return;
    try {
      await api.del(`${base}/playlists/${p.id}`);
      await lib.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const move = (i: number, d: number) =>
    edit &&
    setEdit((e) => {
      if (!e) return e;
      const ids = [...e.trackIds];
      const j = i + d;
      if (j < 0 || j >= ids.length) return e;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
      return { ...e, trackIds: ids };
    });

  if (edit) {
    return (
      <div className="space-y-3" data-testid="playlist-editor">
        <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder={t("audio.playlistName")} data-testid="playlist-name" />
        <ol className="space-y-1">
          {edit.trackIds.map((id, i) => (
            <li key={`${id}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-right text-parchment-500">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name ?? "?"}</span>
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label={t("audio.moveUp")}>↑</Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label={t("audio.moveDown")}>↓</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, trackIds: edit.trackIds.filter((_, k) => k !== i) })} aria-label={t("audio.remove")}>✕</Button>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-9" data-testid="playlist-pick">
            <option value="">{t("audio.pickTrack")}</option>
            {tracks.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
          <Button disabled={!adding} onClick={() => { setEdit({ ...edit, trackIds: [...edit.trackIds, adding] }); setAdding(""); }} data-testid="playlist-add">
            + {t("audio.add")}
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!edit.name.trim()} onClick={() => void save()} data-testid="playlist-save">{t("common.save")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => setEdit({ id: null, version: 1, name: "", trackIds: [] })} data-testid="playlist-new">+ {t("audio.newPlaylist")}</Button>
      {lib.data && lib.data.playlists.length === 0 && <p className="text-sm text-parchment-400">{t("audio.noPlaylists")}</p>}
      <ul className="divide-y divide-ink-800 rounded border border-ink-700">
        {(lib.data?.playlists ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-2 py-2" data-testid={`playlist-${p.name}`}>
            <span className="min-w-0 flex-1 truncate">
              {p.name} <span className="text-xs text-parchment-500">({t("audio.trackCount", { n: p.trackIds.length })})</span>
            </span>
            <Button size="sm" variant="primary" disabled={p.trackIds.length === 0} onClick={() => void run({ kind: "playPlaylist", playlistId: p.id })} data-testid={`playlist-play-${p.name}`}>
              ▶ {t("audio.play")}
            </Button>
            <Button size="sm" disabled={p.trackIds.length < 2} onClick={() => void run({ kind: "playPlaylist", playlistId: p.id, shuffle: true })} data-testid={`playlist-shuffle-${p.name}`}>
              🔀 {t("audio.shuffle")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ id: p.id, version: p.version, name: p.name, trackIds: p.trackIds })} aria-label={t("audio.edit")}>✎</Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(p)} aria-label={t("audio.delete")}>🗑</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
