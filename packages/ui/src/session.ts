/**
 * Per-tab state that has to survive the Google sign-in redirect (a full page load): which group this tab is
 * watching as a viewer, and what the user picked on the claim screen before being sent to sign in.
 */
const PEEK_KEY = 'coffee-maker:peek';
const PENDING_KEY = 'coffee-maker:pending-claim';

export type PendingClaim = { groupId: string; playerId: string } | { groupId: string; name: string };

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private mode etc.: the flow just starts over after the redirect.
  }
}

export const peekGroup = () => read(PEEK_KEY);
export const setPeekGroup = (groupId: string | null) => write(PEEK_KEY, groupId);

export function takePendingClaim(groupId: string): PendingClaim | null {
  const raw = read(PENDING_KEY);
  if (!raw) return null;
  write(PENDING_KEY, null);
  try {
    const pending = JSON.parse(raw) as PendingClaim;
    return pending.groupId === groupId ? pending : null;
  } catch {
    return null;
  }
}

export const setPendingClaim = (pending: PendingClaim) => write(PENDING_KEY, JSON.stringify(pending));
