export class AuthResource {
  constructor(client) {
    this.client = client;
  }

  login(email, password) {
    return this.client.request("/api/auth/mobile/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  signup(name, email, password, role) {
    return this.client.request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password, role }),
    });
  }

  googleSignIn(idToken) {
    return this.client.request("/api/auth/mobile/google", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
  }

  appleSignIn({ identityToken, authorizationCode, nonce, fullName }) {
    return this.client.request("/api/auth/mobile/apple", {
      method: "POST",
      body: JSON.stringify({ identityToken, authorizationCode, nonce, fullName }),
    });
  }

  // skipAuth: the refresh token IS the credential — no Bearer header
  // `signal` (optional AbortSignal) is forwarded when a caller's own request was
  // made abortable, so cancelling that request cancels its refresh too.
  refresh(refreshToken, { signal } = {}) {
    return this.client.request("/api/auth/mobile/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
      signal,
    });
  }

  forgotPassword(email) {
    return this.client.request("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  resendVerification(email) {
    return this.client.request("/api/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
      skipAuth: true,
    });
  }

  changePassword(currentPassword, newPassword) {
    return this.client.request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
}
