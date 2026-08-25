import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ArrowLeft, Play } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { formatDuration, hasCover } from "../../utils/format";
import type { Track } from "../../types";

interface AlbumDetailViewProps {
	albumName: string;
	tracks: Track[];
	displayedTracksSetter: (tracks: Track[]) => void;
	playTrack: (track: Track, queue?: Track[]) => Promise<void>;
	onBack: () => void;
}

export function AlbumDetailView({ albumName, tracks, displayedTracksSetter, playTrack, onBack }: AlbumDetailViewProps) {
	const { currentTrack } = usePlayer();

	const albumTracks = useMemo(() => {
		const filtered = tracks.filter((t) => t.album === albumName);
		filtered.sort((a, b) => {
			const an = a.track_number ?? 0;
			const bn = b.track_number ?? 0;
			if (an !== bn) return an - bn;
			return a.title.localeCompare(b.title);
		});
		return filtered;
	}, [tracks, albumName]);

	const coverSrc = hasCover(albumTracks[0])
		? convertFileSrc(albumTracks[0].cover_path!)
		: undefined;

	const artist = albumTracks[0]?.artist || "Unknown Artist";

	const handlePlayAlbum = async () => {
		displayedTracksSetter(albumTracks);
		if (albumTracks.length === 0) return;
		await playTrack(albumTracks[0], albumTracks);
	};

	const totalDuration = albumTracks.reduce((acc, t) => acc + t.duration_secs, 0);

	return (
		<div>
			<div className="view-header" style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
				<button className="ctrl-btn" onClick={onBack} aria-label="Back to albums">
					<ArrowLeft size={18} />
				</button>
				<div>
					<div className="view-title">{albumName}</div>
					<div className="view-subtitle">{artist} · {albumTracks.length} tracks · {formatDuration(totalDuration)}</div>
				</div>
			</div>

			<div style={{ display: "flex", gap: 32, marginBottom: 32, alignItems: "flex-start" }}>
				<div style={{ flexShrink: 0 }}>
					{coverSrc ? (
						<img
							src={coverSrc}
							alt={albumName}
							style={{ width: 220, height: 220, borderRadius: 12, objectFit: "cover", boxShadow: "0 16px 48px rgba(0,0,0,0.45)" }}
						/>
					) : (
						<div
							style={{
								width: 220,
								height: 220,
								borderRadius: 12,
								background: "linear-gradient(145deg, #1c1f2b 0%, #252a38 100%)",
								boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
							}}
						/>
					)}
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{albumName}</div>
					<div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 18 }}>{artist}</div>
					<button
						className="play-btn"
						onClick={handlePlayAlbum}
						style={{ width: 44, height: 44, background: "#d4a373", color: "#0c0d12" }}
						aria-label="Play album"
					>
						<Play size={18} fill="#0c0d12" />
					</button>
				</div>
			</div>

			<div className="tracks-table">
				<div className="tracks-row track-header">
					<div className="track-cell" style={{ width: 48 }} />
					<div className="track-cell">#</div>
					<div className="track-cell">Title</div>
					<div className="track-cell time-cell">TIME</div>
				</div>
				{albumTracks.length === 0 ? (
					<div className="empty-state">
						<div className="empty-state-text">No tracks found for this album.</div>
					</div>
				) : (
					albumTracks.map((track, idx) => {
						const active = track.id === currentTrack?.id;
						const rowCover = hasCover(track) ? convertFileSrc(track.cover_path!) : undefined;
						return (
							<div
								key={track.id}
								className={`tracks-row ${active ? "track-active" : ""}`}
								onClick={() => {
									displayedTracksSetter(albumTracks);
									playTrack(track, albumTracks);
								}}
							>
								<div className="track-cell" style={{ width: 48 }}>
									{rowCover ? (
										<img className="track-thumb" src={rowCover} alt="" />
									) : (
										<div className="track-thumb-empty" />
									)}
								</div>
								<div className="track-cell track-num">{active ? <span className="equalizer" /> : idx + 1}</div>
								<div className="track-cell track-title">{track.title}</div>
								<div className="track-cell time-cell">{formatDuration(track.duration_secs)}</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
