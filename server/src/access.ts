import type { Board, Role } from './db/types.js';

/** Who someone is on a board: from ownership, membership, or the board's share link. */
export function roleFor(board: Board, userId?: string | null, linkKey?: string | null): Role | null {
  if (board.deletedAt && board.ownerId !== userId) return null;
  if (userId && board.ownerId === userId) return 'owner';
  const m = userId ? board.members.find((x) => x.userId === userId) : undefined;
  let role: Role | null = m ? m.role : null;
  if (linkKey && linkKey === board.linkToken && board.linkAccess !== 'none') {
    const viaLink: Role = board.linkAccess === 'edit' && userId ? 'editor' : 'viewer';
    if (!role || (role === 'viewer' && viaLink === 'editor')) role = viaLink;
  }
  return role;
}

export const canEdit = (r: Role | null) => r === 'owner' || r === 'editor';
