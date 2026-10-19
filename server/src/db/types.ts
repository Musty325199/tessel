export type Role = 'owner' | 'editor' | 'viewer';
export type LinkAccess = 'none' | 'view' | 'edit';

export interface User {
  _id: string;
  email: string;
  name: string;
  passwordHash: string;
  color: string;
  createdAt: Date;
}

export interface Session {
  _id: string; // sha256 of the refresh token; the token itself is never stored
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface Member { userId: string; role: Exclude<Role, 'owner'>; addedAt: Date }

export interface Board {
  _id: string;
  title: string;
  ownerId: string;
  members: Member[];
  linkAccess: LinkAccess;
  linkToken: string;
  starredBy: string[];
  thumbnail: string; // small SVG drawn from the board's shapes
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BoardDoc { _id: string; state: Uint8Array; updatedAt: Date }

export interface Version {
  _id: string;
  boardId: string;
  name: string | null;
  auto: boolean;
  state: Uint8Array;
  shapeCount: number;
  createdBy: string | null;
  createdAt: Date;
}
export type VersionMeta = Omit<Version, 'state'>;

export interface Comment {
  _id: string;
  boardId: string;
  x: number; y: number;
  /** pinned to a shape: the pin follows it, offset by (ox, oy) */
  shapeId: string | null; ox: number; oy: number;
  resolved: boolean;
  messages: { id: string; userId: string; text: string; mentions: string[]; createdAt: Date; editedAt?: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  _id: string;
  userId: string;
  kind: 'mention' | 'reply' | 'invite';
  boardId: string;
  fromUserId: string;
  text: string;
  read: boolean;
  createdAt: Date;
}

/** Everything the app needs from a database. Mongo in production; an in-memory version for tests and local runs. */
export interface Store {
  users: {
    insert(u: User): Promise<void>;
    byId(id: string): Promise<User | null>;
    byEmail(email: string): Promise<User | null>;
    byIds(ids: string[]): Promise<User[]>;
    update(id: string, patch: Partial<User>): Promise<void>;
  };
  sessions: {
    insert(s: Session): Promise<void>;
    get(id: string): Promise<Session | null>;
    delete(id: string): Promise<void>;
    deleteForUser(userId: string): Promise<void>;
  };
  boards: {
    insert(b: Board): Promise<void>;
    get(id: string): Promise<Board | null>;
    update(id: string, patch: Partial<Board>): Promise<void>;
    forUser(userId: string): Promise<Board[]>;
    delete(id: string): Promise<void>;
  };
  docs: {
    get(boardId: string): Promise<BoardDoc | null>;
    put(boardId: string, state: Uint8Array): Promise<void>;
    delete(boardId: string): Promise<void>;
  };
  versions: {
    insert(v: Version): Promise<void>;
    list(boardId: string): Promise<VersionMeta[]>;
    get(id: string): Promise<Version | null>;
    latestAuto(boardId: string): Promise<VersionMeta | null>;
    prune(boardId: string, keepAuto: number): Promise<void>;
    deleteForBoard(boardId: string): Promise<void>;
  };
  comments: {
    insert(c: Comment): Promise<void>;
    get(id: string): Promise<Comment | null>;
    list(boardId: string): Promise<Comment[]>;
    update(id: string, patch: Partial<Comment>): Promise<void>;
    delete(id: string): Promise<void>;
    deleteForBoard(boardId: string): Promise<void>;
  };
  notifications: {
    insert(n: Notification): Promise<void>;
    list(userId: string, limit: number): Promise<Notification[]>;
    markRead(userId: string, ids?: string[]): Promise<void>;
  };
  close(): Promise<void>;
}
