import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Music2, User, Disc3, Tag, Search } from "lucide-react";
import { hasCover } from "../utils/format";
import { parseArtists } from "../utils/artists";
import type { Track } from "../types";

export interface SearchPaletteActions {
	onClose: () => void;
	onPlayTrack: (track: Track, queue: Track[]) => void;
	onGoToArtist: (artist: string) => void;
	onGoToAlbum: (album: string) => void;
	onGoToGenre: (genre: string) => void;
}

interface ResultItem {
	key: string;
	kind: "track" | "artist" | "album" | "genre";
	title: string;
	subtitle: string;
	cover?: string;
	track?: Track;
	value?: string;
}

const GROUP_ORDER: ResultItem["kind"][] = ["track", "artist", "album", "genre"];

const KIND_LABEL: Record<ResultItem["kind"], string> = {
	track: "Tracks",
	artist: "Artists",
	album: "Albums",
	genre: "Genres",
};

const KIND_ICON: Record<ResultItem["kind"], typeof Music2> = {
	track: Music2,
	artist: User,
	album: Disc3,
	genre: Tag,
};

export function SearchPalette({
	tracks,
	actions,
}: {
	tracks: Track[];
	actions: SearchPaletteActions;
}) {
	const [query, setQuery] = useState("");
	const [activeIdx, setActiveIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return new Map<ResultItem["kind"], ResultItem[]>();
		const map = new Map<ResultItem["kind"], ResultItem[]>();
		const push = (item: ResultItem) => {
			const arr = map.get(item.kind) ?? [];
			if (arr.length < 6) arr.push(item);
			map.set(item.kind, arr);
		};

		const seenArtists = new Set<string>();
		for (const t of tracks) {
			if (
				t.title.toLowerCase().includes(q) ||
				t.artist.toLowerCase().includes(q) ||
				t.album.toLowerCase().includes(q)
			) {
				push({
					key: `t-${t.id}`,
					kind: "track",
					title: t.title,
					subtitle: `${t.artist} · ${t.album}`,
					cover: hasCover(t) ? convertFileSrc(t.cover_path!) : undefined,
					track: t,
				});
			}
			for (const a of parseArtists(t.artist)) {
				if (!seenArtists.has(a.toLowerCase())) {
					seenArtists.add(a.toLowerCase());
					if (a.toLowerCase().includes(q)) {
						push({
							key: `ar-${a}`,
							kind: "artist",
							title: a,
							subtitle: "Artist",
							value: a,
						});
					}
				}
			}
			if (t.album && t.album.toLowerCase().includes(q)) {
				push({
					key: `al-${t.album}`,
					kind: "album",
					title: t.album,
					subtitle: `Album · ${t.artist}`,
					cover: hasCover(t) ? convertFileSrc(t.cover_path!) : undefined,
					value: t.album,
				});
			}
			if (t.genre && t.genre.toLowerCase().includes(q)) {
				push({
					key: `g-${t.genre}`,
					kind: "genre",
					title: t.genre,
					subtitle: "Genre",
					value: t.genre,
				});
			}
		}
		return map;
	}, [query, tracks]);

	const flat = useMemo(
		() => GROUP_ORDER.flatMap((k) => groups.get(k) ?? []),
		[groups]
	);

	useEffect(() => setActiveIdx(0), [query]);

	useEffect(() => {
		const el = listRef.current?.querySelector(".sp-item.active");
		el?.scrollIntoView({ block: "nearest" });
	}, [activeIdx]);

	const activate = (item: ResultItem) => {
		switch (item.kind) {
			case "track":
				if (item.track) actions.onPlayTrack(item.track, tracks);
				break;
			case "artist":
				actions.onGoToArtist(item.value!);
				break;
			case "album":
				actions.onGoToAlbum(item.value!);
				break;
			case "genre":
				actions.onGoToGenre(item.value!);
				break;
		}
		actions.onClose();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			actions.onClose();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIdx((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIdx((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const item = flat[activeIdx];
			if (item) activate(item);
		}
	};

	let runningIdx = -1;

	return (
		<div className="sp-backdrop" onMouseDown={actions.onClose}>
			<div className="sp-panel" onMouseDown={(e) => e.stopPropagation()}>
				<div className="sp-input-row">
					<Search size={16} />
					<input
						ref={inputRef}
						className="sp-input"
						placeholder="Search tracks, artists, albums, genres…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
					/>
					<span className="sp-kbd">ESC</span>
				</div>
				<div className="sp-list" ref={listRef}>
					{flat.length === 0 ? (
						<div className="sp-empty">
							{query.trim() ? "No results" : "Type to search your library"}
						</div>
					) : (
						GROUP_ORDER.map((kind) => {
							const items = groups.get(kind);
							if (!items?.length) return null;
							const Icon = KIND_ICON[kind];
							return (
								<div key={kind}>
									<div className="sp-group-label">{KIND_LABEL[kind]}</div>
									{items.map((item) => {
										runningIdx += 1;
										const idx = runningIdx;
										return (
											<div
												key={item.key}
												className={`sp-item ${idx === activeIdx ? "active" : ""}`}
												onMouseEnter={() => setActiveIdx(idx)}
												onClick={() => activate(item)}
											>
												{item.cover ? (
													<img className="sp-thumb" src={item.cover} alt="" />
												) : (
													<div className="sp-thumb sp-thumb-empty">
														<Icon size={14} />
													</div>
												)}
												<div className="sp-texts">
													<div className="sp-title">{item.title}</div>
													<div className="sp-sub">{item.subtitle}</div>
												</div>
											</div>
										);
									})}
								</div>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
