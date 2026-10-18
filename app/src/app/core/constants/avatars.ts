/**
 * Curated default avatars for every account (Discord-style: nobody gets a
 * bare emoji unless they had one already).
 *
 * The set is DiceBear's "Adventurer" collection — illustrated, Mobile
 * Legends-like portraits — fetched once and bundled in assets/avatars so
 * they work offline with zero license-cleaning: the collection is CC BY 4.0
 * ("Adventurer" by Lisa Wischofsky), credited in Settings → About.
 */
export const AVATAR_PATHS: string[] = [
  'assets/avatars/a01.svg',
  'assets/avatars/a02.svg',
  'assets/avatars/a03.svg',
  'assets/avatars/a04.svg',
  'assets/avatars/a05.svg',
  'assets/avatars/a06.svg',
  'assets/avatars/a07.svg',
  'assets/avatars/a08.svg',
  'assets/avatars/a09.svg',
  'assets/avatars/a10.svg',
  'assets/avatars/a11.svg',
  'assets/avatars/a12.svg',
  'assets/avatars/a13.svg',
  'assets/avatars/a14.svg',
  'assets/avatars/a15.svg',
  'assets/avatars/a16.svg',
];

/** True when an avatar string is an image we should render as <img>. */
export function isImageAvatar(avatar: string | null | undefined): boolean {
  return !!avatar && (avatar.startsWith('assets/') || avatar.startsWith('/') || avatar.startsWith('http'));
}

/** A random avatar from the set — for new accounts. */
export function randomAvatar(): string {
  return AVATAR_PATHS[Math.floor(Math.random() * AVATAR_PATHS.length)];
}
