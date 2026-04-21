// JWT stored in module-level variable — survives re-renders, not page refresh
// This is intentional: no XSS risk unlike localStorage, and wallet re-auth
// on page refresh is acceptable (silent re-sign if wallet still connected)

let jwt: string | null = null;

export function setJwt(token: string) {
    jwt = token;
}

export function getJwt(): string | null {
    return jwt;
}

export function clearJwt() {
    jwt = null;
}

export function authHeaders(): HeadersInit {
    if (!jwt) return {};
    return { Authorization: `Bearer ${jwt}` };
}
