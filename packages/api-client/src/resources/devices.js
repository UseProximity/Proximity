export class DevicesResource {
  constructor(client) {
    this.client = client;
  }

  registerPushToken({ expoPushToken, platform }) {
    return this.client.request("/api/devices/push-token", {
      method: "POST",
      body: JSON.stringify({ expoPushToken, platform }),
    });
  }

  // `signal` (optional AbortSignal) lets the caller cancel a stalled request.
  unregisterPushToken(expoPushToken, { signal } = {}) {
    return this.client.request("/api/devices/push-token", {
      method: "DELETE",
      body: JSON.stringify({ expoPushToken }),
      signal,
    });
  }
}
