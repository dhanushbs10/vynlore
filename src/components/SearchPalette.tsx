import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
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

	const flatIndexByKey = useMemo(() => {
		const map = new Map<string, number>();
		flat.forEach((item, i) => map.set(item.key, i));
		return map;
	}, [flat]);

	useEffect(() => setActiveIdx(0), [query]);

	useEffect(() => {
		const el = listRef.current?.querySelector("[data-active]");
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

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 z-[2000] bg-black/70 flex justify-center pt-[12vh]"
				onMouseDown={actions.onClose}
			>
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: 10 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: 10 }}
					transition={{ type: "spring", stiffness: 400, damping: 30 }}
					className="w-[min(640px,90vw)] max-h-[62vh] bg-[#111] border border-border rounded-lg flex flex-col overflow-hidden"
					onMouseDown={(e) => e.stopPropagation()}
				>
					<div className="flex items-center gap-3 px-5 py-4 border-b border-border">
						<Search size={16} className="text-text-muted shrink-0" />
						<input
							ref={inputRef}
							className="flex-1 bg-transparent border-none outline-none text-text text-[15px] placeholder:text-text-muted"
							placeholder="Search tracks, artists, albums, genres…"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={onKeyDown}
						/>
						<span className="text-[10px] font-semibold text-text-muted border border-border-hover rounded px-1.5 py-0.5 shrink-0">ESC</span>
					</div>
					<div className="overflow-y-auto p-2" ref={listRef}>
						{flat.length === 0 ? (
							<div className="px-4 py-8 text-center text-text-muted text-sm">
								{query.trim() ? "No results" : "Type to search your library"}
							</div>
						) : (
							GROUP_ORDER.map((kind) => {
								const items = groups.get(kind);
								if (!items?.length) return null;
								const Icon = KIND_ICON[kind];
								return (
									<div key={kind}>
										<div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-text-muted px-2.5 pt-2.5 pb-1">{KIND_LABEL[kind]}</div>
									{items.map((item) => {
										const idx = flatIndexByKey.get(item.key) ?? 0;
										const isActive = idx === activeIdx;
											return (
											<motion.div
												key={item.key}
												className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-white/5 transition-colors ${isActive ? "bg-white/5" : ""}`}
													data-active={isActive ? "" : undefined}
													onMouseEnter={() => setActiveIdx(idx)}
													onClick={() => activate(item)}
												>
													{item.cover ? (
														<img className="w-9 h-9 rounded-sm object-cover shrink-0" src={item.cover} alt="" />
													) : (
														<div className="w-9 h-9 rounded-sm bg-bg-surface flex items-center justify-center text-text-muted shrink-0">
															<Icon size={14} />
														</div>
													)}
													<div className="min-w-0">
														<div className="text-[13.5px] text-text truncate">{item.title}</div>
														<div className="text-[11.5px] text-text-muted truncate">{item.subtitle}</div>
													</div>
												</motion.div>
											);
										})}
									</div>
								);
							})
						)}
					</div>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
}
