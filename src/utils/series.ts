import type { CollectionEntry } from 'astro:content';

/**
 * Calculates the active part index or returns "Quick Byte" if the post is marked as quickByte: true.
 * Quick Byte entries do not increment the serial Part N numbering for subsequent posts.
 */
export function getSeriesPartLabel(
  currentPost: CollectionEntry<'blog'>,
  sortedSeriesPosts: CollectionEntry<'blog'>[]
): string {
  if (currentPost.data.quickByte) {
    return "Quick Byte";
  }
  let partCounter = 1;
  for (const p of sortedSeriesPosts) {
    if (p.id === currentPost.id) {
      return `Part ${partCounter}`;
    }
    if (!p.data.quickByte) {
      partCounter++;
    }
  }
  return "";
}
