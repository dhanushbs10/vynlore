export function parseArtists(artistString: string): string[] {
	if (!artistString || !artistString.trim()) return [];

	const delimiters = [",", "&", "/"];
	const keywords = ["feat.", "ft.", "x"];

	let parts: string[] = [artistString];

	for (const delim of delimiters) {
		const newParts: string[] = [];
		for (const part of parts) {
			newParts.push(...part.split(delim));
		}
		parts = newParts;
	}

	const keywordParts: string[] = [];
	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const lowerTrimmed = trimmed.toLowerCase();
		let split = false;
		for (const kw of keywords) {
			const idx = lowerTrimmed.indexOf(kw);
			if (idx !== -1) {
				const before = trimmed.slice(0, idx).trim();
				const after = trimmed.slice(idx + kw.length).trim();
				if (before) keywordParts.push(before);
				if (after) keywordParts.push(after);
				split = true;
				break;
			}
		}
		if (!split) keywordParts.push(trimmed);
	}

	return keywordParts.filter((a) => a.length > 0);
}
