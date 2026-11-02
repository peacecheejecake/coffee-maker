/**
 * Per-tab state that has to survive the Google sign-in redirect (a full page load): which group this tab is
 * watching as a viewer.
 */
const PEEK_KEY = 'coffee-maker:peek';

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
