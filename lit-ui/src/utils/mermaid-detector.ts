/**
 * Mermaid detector and extractor for markdown content
 * Detects ```mermaid blocks and extracts them for rendering
 */

export interface MermaidBlock {
	content: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Extract all mermaid blocks from markdown content
 * @param markdown - The markdown content to search
 * @returns Array of mermaid blocks found
 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
	const blocks: MermaidBlock[] = [];
	const mermaidPattern = /```mermaid\n([\s\S]*?)```/g;
	let match;

	while ((match = mermaidPattern.exec(markdown)) !== null) {
		blocks.push({
			content: match[1].trim(),
			startIndex: match.index,
			endIndex: match.index + match[0].length,
		});
	}

	return blocks;
}

/**
 * Check if markdown contains mermaid blocks
 * @param markdown - The markdown content to check
 * @returns true if mermaid blocks are found
 */
export function hasMermaidBlocks(markdown: string): boolean {
	return /```mermaid\n/i.test(markdown);
}

/**
 * Replace mermaid blocks in markdown with a placeholder
 * Returns both the modified markdown and the extracted blocks
 */
export function extractAndReplaceMermaid(
	markdown: string,
): { markdown: string; blocks: MermaidBlock[] } {
	const blocks = extractMermaidBlocks(markdown);
	
	if (blocks.length === 0) {
		return { markdown, blocks };
	}

	let modifiedMarkdown = markdown;
	let offset = 0;

	// Process blocks in reverse order to maintain correct indices
	for (let i = blocks.length - 1; i >= 0; i--) {
		const block = blocks[i];
		const before = modifiedMarkdown.substring(0, block.startIndex - offset);
		const after = modifiedMarkdown.substring(block.endIndex - offset);
		
		// Replace with a comment/placeholder
		modifiedMarkdown = before + `<!-- Mermaid diagram extracted -->` + after;
		offset += block.endIndex - block.startIndex - 25; // 25 = length of placeholder comment
	}

	return { markdown: modifiedMarkdown, blocks };
}
