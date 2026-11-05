// Username lookup is server-side only. Supabase Auth still verifies passwords.
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeLogin(input) {
  return String(input ?? '').trim().toLowerCase();
}

export function validUsername(username) {
  return USERNAME_RE.test(username);
}

export class LoginLookupError extends Error {
  constructor() {
    super('Не удалось проверить логин. Обратитесь к администратору.');
    this.code = 'USERNAME_LOOKUP_UNAVAILABLE';
  }
}

export async function resolveLoginEmail(input, service) {
  const login = normalizeLogin(input);
  if (!login) return null;
  // Rolling-deploy compatibility: older, already-installed applications still send email.
  if (login.includes('@')) return EMAIL_RE.test(login) ? login : null;
  if (!validUsername(login)) return null;
  if (!service) throw new LoginLookupError();

  let row;
  try {
    const response = await service.from('staff_login_aliases')
      .select('auth_user_id').eq('username', login).maybeSingle();
    if (response.error) throw response.error;
    row = response.data;
  } catch {
    throw new LoginLookupError();
  }
  if (!row?.auth_user_id) return null;

  try {
    const {data, error} = await service.auth.admin.getUserById(row.auth_user_id);
    if (error) throw error;
    const email = normalizeLogin(data?.user?.email);
    return EMAIL_RE.test(email) ? email : null;
  } catch {
    throw new LoginLookupError();
  }
}
