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

  unregisterPushToken(expoPushToken) {
    return this.client.request("/api/devices/push-token", {
      method: "DELETE",
      body: JSON.stringify({ expoPushToken }),
    });
  }
}
