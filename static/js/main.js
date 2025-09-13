// Main application entry point and orchestrator
import { UIManager } from "./ui.js";
import { WebSocketManager } from "./websocket.js";
import { WebRTCManager } from "./webrtc.js";
import { FileTransferManager } from "./fileTransfer.js";
import { Utils } from "./utils.js";

class WebRTCChat {
  constructor() {
    this.username = null;
    this.roomId = null;
    this.socketId = null;
    this.onlineUsers = [];

    // Initialize managers
    this.ui = new UIManager();
    this.websocket = new WebSocketManager((event, data) =>
      this.handleWebSocketEvent(event, data)
    );
    this.webrtc = new WebRTCManager(
      (target, data) => this.sendWebRTCSignal(target, data),
      (event, data) => this.handleWebRTCEvent(event, data)
    );
    this.fileTransfer = new FileTransferManager(this.webrtc, this.ui);

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupMobileToggles();
    this.ui.showJoinModal();
  }

  setupEventListeners() {
    // Join modal events
    this.ui.elements.joinBtn.addEventListener("click", () => this.joinRoom());
    this.ui.elements.usernameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.joinRoom();
    });

    // Chat events
    this.ui.elements.sendBtn.addEventListener("click", () =>
      this.sendMessage()
    );
    this.ui.elements.messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.sendMessage();
    });

    // File sharing events
    this.ui.elements.shareFileBtn.addEventListener("click", () =>
      this.initiateFileShare()
    );
    this.ui.elements.fileInput.addEventListener("change", () =>
      this.ui.updateFileInfo()
    );
  }

  setupMobileToggles() {
    const toggleUsers = document.getElementById("toggle-users");
    const toggleFiles = document.getElementById("toggle-files");
    const usersList = document.getElementById("users-list");
    const fileControls = document.getElementById("file-controls");

    if (toggleUsers) {
      toggleUsers.addEventListener("click", () => {
        usersList.classList.toggle("hidden");
        usersList.classList.toggle("lg:block");

        // Rotate arrow
        const arrow = toggleUsers.querySelector("svg");
        arrow.classList.toggle("rotate-180");
      });
    }

    if (toggleFiles) {
      toggleFiles.addEventListener("click", () => {
        fileControls.classList.toggle("hidden");
        fileControls.classList.toggle("lg:block");

        // Rotate arrow
        const arrow = toggleFiles.querySelector("svg");
        arrow.classList.toggle("rotate-180");
      });
    }
  }

  async joinRoom() {
    const credentials = this.ui.getCredentials();

    if (!credentials.username) {
      alert("Please enter a username");
      return;
    }

    this.username = credentials.username;
    this.roomId =
      credentials.room || window.location.pathname.slice(1) || "general";

    // Update URL if needed
    if (window.location.pathname === "/" && credentials.room) {
      window.history.pushState(null, null, `/${this.roomId}`);
    }

    try {
      await this.websocket.connect(this.roomId);
      this.ui.hideJoinModal();
      this.ui.enableControls();
    } catch (error) {
      alert("Failed to connect to server");
    }
  }

  handleWebSocketEvent(event, data) {
    switch (event) {
      case "connected":
        this.websocket.joinRoom(this.username);
        break;

      case "message":
        this.handleWebSocketMessage(data);
        break;

      case "disconnected":
        this.ui.displaySystemMessage("Disconnected from server");
        break;

      case "error":
        this.ui.displaySystemMessage("WebSocket error occurred");
        break;
    }
  }

  handleWebSocketMessage(data) {
    console.log("📨 Received message:", data);

    switch (data.type) {
      case "join_success":
        this.socketId = data.socket_id;
        this.ui.updateRoomInfo(data.room_id);
        break;

      case "new_message":
        this.ui.displayMessage(data.username, data.message, data.timestamp);
        break;

      case "user_joined":
      case "user_left":
        this.ui.displaySystemMessage(data.message);
        break;

      case "online_users":
        this.onlineUsers = this.ui.updateUsersList(data.users, this.username);
        break;

      case "webrtc_signal":
        this.webrtc.handleSignal(data.sender, data.data);
        break;

      case "file_transfer_request":
        this.handleFileTransferRequest(data);
        break;

      case "file_transfer_response":
        this.handleFileTransferResponse(data);
        break;

      case "error":
        console.error("❌ Server error:", data.message);
        this.ui.displaySystemMessage(`Error: ${data.message}`);
        break;
    }
  }

  handleWebRTCEvent(event, data) {
    switch (event) {
      case "dataChannelOpen":
        this.ui.displaySystemMessage(
          `📡 Data channel ready with ${data.username}`
        );
        this.ui.updateConnectionStatus(data.username, "Connected");

        // Start file transfer if we have a pending file
        const pendingFile = this.fileTransfer.getPendingFile();
        if (pendingFile) {
          setTimeout(() => {
            this.fileTransfer.sendFile(data.username, pendingFile);
          }, 100);
        }
        break;

      case "dataChannelMessage":
        this.fileTransfer.handleDataChannelMessage(data.data, data.username);
        break;

      case "dataChannelClose":
        this.ui.updateConnectionStatus(data.username, "Disconnected");
        break;

      case "dataChannelError":
        this.ui.displaySystemMessage(
          `❌ Data channel error with ${data.username}`
        );
        this.ui.updateConnectionStatus(data.username, "Error");
        break;

      case "iceConnected":
        this.ui.displaySystemMessage(`🟢 Connected to ${data.username}`);
        break;

      case "iceDisconnected":
        this.ui.displaySystemMessage(`🟡 Disconnected from ${data.username}`);
        break;

      case "iceFailed":
        this.ui.displaySystemMessage(
          `🔴 Connection failed with ${data.username}`
        );
        break;

      case "connectionFailed":
        this.ui.displaySystemMessage(
          `❌ Failed to connect to ${data.username} after multiple attempts`
        );
        break;
    }
  }

  sendMessage() {
    const message = this.ui.getMessageInput();

    if (message && this.websocket.isConnected) {
      this.websocket.sendChatMessage(this.username, message);
      this.ui.clearMessageInput();
    }
  }

  async initiateFileShare() {
    const file = this.ui.getSelectedFile();
    const targetUser = this.ui.getTargetUser();

    if (!file) {
      alert("Please select a file first");
      return;
    }

    if (!targetUser) {
      alert("Please select a target user");
      return;
    }

    const validation = Utils.validateFile(file);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    console.log("📁 Sharing file:", {
      name: validation.fileName,
      size: validation.fileSize,
      type: validation.fileType,
      target: targetUser,
    });

    // Store file for later transfer
    this.fileTransfer.setPendingFile(file);

    // Send file transfer request
    this.websocket.sendFileTransferRequest(
      this.username,
      targetUser,
      validation.fileName,
      validation.fileSize,
      validation.fileType
    );

    this.ui.displaySystemMessage(
      `Requesting file transfer to ${targetUser}: ${
        validation.fileName
      } (${Utils.formatFileSize(validation.fileSize)})`
    );
  }

  handleFileTransferRequest(data) {
    const safeName = data.filename || "Unknown file";
    const safeSize = data.file_size || 0;
    const formattedSize = Utils.formatFileSize(safeSize);

    console.log("📁 File transfer request received:", data);

    const accept = confirm(
      `${data.sender} wants to send you a file:\n\n${safeName} (${formattedSize})\n\nAccept this file transfer?`
    );

    this.websocket.sendFileTransferResponse(
      this.username,
      data.sender,
      accept,
      safeName,
      safeSize,
      data.file_type
    );

    if (accept) {
      this.ui.displaySystemMessage(
        `✅ Accepting file transfer from ${data.sender}: ${safeName}`
      );
      // This is the correct method call
      this.fileTransfer.prepareFileReceive(
        data.sender,
        safeName,
        safeSize,
        data.file_type
      );
    } else {
      this.ui.displaySystemMessage(
        `❌ Declined file transfer from ${data.sender}: ${safeName}`
      );
    }
  }

  async handleFileTransferResponse(data) {
    if (data.accepted) {
      this.ui.displaySystemMessage(
        `✅ ${data.sender} accepted file transfer: ${
          data.filename || "Unknown file"
        }. Establishing connection...`
      );
      this.ui.updateConnectionStatus(data.sender, "Connecting...");

      try {
        await this.webrtc.createOffer(data.sender);
      } catch (error) {
        this.ui.displaySystemMessage(
          `❌ Error starting file transfer: ${error.message}`
        );
        this.ui.updateConnectionStatus(data.sender, "Failed");
      }
    } else {
      this.ui.displaySystemMessage(
        `❌ ${data.sender} declined file transfer: ${
          data.filename || "Unknown file"
        }`
      );
      this.fileTransfer.setPendingFile(null);
    }
  }

  sendWebRTCSignal(target, data) {
    this.websocket.sendWebRTCSignal(this.username, target, data);
  }

  cleanup() {
    this.websocket.disconnect();
    this.webrtc.cleanup();
    this.fileTransfer.cleanup();
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  new WebRTCChat();
});
