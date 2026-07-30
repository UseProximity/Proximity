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

  // skipAuth: the refresh token IS the credential — no Bearer header
  refresh(refreshToken) {
    return this.client.request("/api/auth/mobile/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
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
