// WebSocket connection and messaging
export class WebSocketManager {
  constructor(eventCallback) {
    this.socket = null;
    this.eventCallback = eventCallback;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect(roomId) {
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/${roomId}`;

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log("🔌 Connected to WebSocket");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.eventCallback("connected");
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("📨 Received message:", data);
          this.eventCallback("message", data);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      this.socket.onclose = () => {
        console.log("❌ WebSocket disconnected");
        this.isConnected = false;
        this.eventCallback("disconnected");
        this.handleReconnect(roomId);
      };

      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.eventCallback("error", error);
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      throw error;
    }
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
      return true;
    } else {
      console.warn("WebSocket not connected, message not sent:", data);
      return false;
    }
  }

  handleReconnect(roomId) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
      );

      setTimeout(() => {
        this.connect(roomId);
      }, 2000 * this.reconnectAttempts);
    }
  }

  joinRoom(username) {
    return this.send({
      type: "join_room",
      username: username,
    });
  }

  sendChatMessage(username, message) {
    return this.send({
      type: "chat_message",
      username: username,
      message: message,
      timestamp: new Date().toISOString(),
    });
  }

  sendFileTransferRequest(sender, target, filename, fileSize, fileType) {
    return this.send({
      type: "file_transfer_request",
      sender: sender,
      target: target,
      filename: filename,
      file_size: fileSize,
      file_type: fileType,
    });
  }

  sendFileTransferResponse(
    sender,
    target,
    accepted,
    filename,
    fileSize,
    fileType
  ) {
    return this.send({
      type: "file_transfer_response",
      sender: sender,
      target: target,
      accepted: accepted,
      filename: filename,
      file_size: fileSize,
      file_type: fileType,
    });
  }

  sendWebRTCSignal(sender, target, data) {
    return this.send({
      type: "webrtc_signal",
      sender: sender,
      target: target,
      data: data,
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnected = false;
  }
}
