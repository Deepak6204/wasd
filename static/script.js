class WebRTCChat {
  constructor() {
    this.socket = null;
    this.username = null;
    this.roomId = null;
    this.socketId = null;
    this.onlineUsers = [];

    // WebRTC
    this.peerConnections = new Map(); // username -> RTCPeerConnection
    this.dataChannels = new Map(); // username -> RTCDataChannel

    // File Transfer
    this.pendingFile = null;
    this.fileTransfers = new Map(); // Transfer tracking
    this.CHUNK_SIZE = 16 * 1024; // 16KB chunks (more reliable)

    // Connection retry logic
    this.connectionAttempts = new Map(); // username -> attempt count
    this.MAX_RETRY_ATTEMPTS = 3;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.showJoinModal();
  }

  setupEventListeners() {
    // Join modal
    document
      .getElementById("join-btn")
      .addEventListener("click", () => this.joinRoom());
    document
      .getElementById("username-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.joinRoom();
      });

    // Chat
    document
      .getElementById("send-btn")
      .addEventListener("click", () => this.sendMessage());
    document
      .getElementById("message-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.sendMessage();
      });

    // File sharing
    document
      .getElementById("share-file-btn")
      .addEventListener("click", () => this.initiateFileShare());

    // Add this to your setupEventListeners() method
    document.getElementById("file-input").addEventListener("change", (e) => {
      this.updateFileInfo();
    });
  }

  updateFileInfo() {
    const fileInput = document.getElementById("file-input");
    const fileInfo = document.getElementById("file-info");

    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const fileName = file.name || "Unknown";
      const fileSize = this.formatFileSize(file.size || 0);
      const fileType = file.type || "Unknown type";

      fileInfo.innerHTML = `
            <small>
                Selected: <strong>${fileName}</strong><br>
                Size: ${fileSize}<br>
                Type: ${fileType}
            </small>
        `;
    } else {
      fileInfo.innerHTML = "<small>No file selected</small>";
    }
  }

  showJoinModal() {
    document.getElementById("join-modal").style.display = "flex";
  }

  hideJoinModal() {
    document.getElementById("join-modal").style.display = "none";
  }

  async joinRoom() {
    const username = document.getElementById("username-input").value.trim();
    const roomInput = document.getElementById("room-input").value.trim();

    if (!username) {
      alert("Please enter a username");
      return;
    }

    this.username = username;
    this.roomId = roomInput || window.location.pathname.slice(1) || "general";

    // Update URL if needed
    if (window.location.pathname === "/" && roomInput) {
      window.history.pushState(null, null, `/${this.roomId}`);
    }

    await this.connectWebSocket();
    this.hideJoinModal();
    this.enableControls();
  }

  async connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/${this.roomId}`;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log("🔌 Connected to WebSocket");
      this.socket.send(
        JSON.stringify({
          type: "join_room",
          username: this.username,
        })
      );
    };

    this.socket.onmessage = (event) => this.handleMessage(event);
    this.socket.onclose = () => console.log("❌ WebSocket disconnected");
    this.socket.onerror = (error) => console.error("WebSocket error:", error);
  }

  handleMessage(event) {
    const data = JSON.parse(event.data);
    console.log("📨 Received message:", data);

    switch (data.type) {
      case "join_success":
        this.socketId = data.socket_id;
        document.getElementById(
          "room-id"
        ).textContent = `Room: ${data.room_id}`;
        console.log("✅ Successfully joined room");
        break;

      case "new_message":
        this.displayMessage(data.username, data.message, data.timestamp);
        break;

      case "user_joined":
        this.displaySystemMessage(data.message);
        break;

      case "user_left":
        this.displaySystemMessage(data.message);
        break;

      case "online_users":
        console.log("👥 Updating user list:", data.users);
        this.updateUsersList(data.users);
        break;

      case "webrtc_signal":
        console.log("🔄 WebRTC signal received from:", data.sender);
        this.handleWebRTCSignal(data.sender, data.data);
        break;

      case "file_transfer_request":
        console.log("📁 File transfer request received:", data);
        this.handleFileTransferRequest(
          data.sender,
          data.filename,
          data.file_size,
          data.file_type
        );
        break;

      case "file_transfer_response":
        console.log("📁 File transfer response received:", data);
        this.handleFileTransferResponse(
          data.sender,
          data.accepted,
          data.filename
        );
        break;

      case "error":
        console.error("❌ Server error:", data.message);
        this.displaySystemMessage(`Error: ${data.message}`);
        break;

      default:
        console.log("❓ Unknown message type:", data.type);
    }
  }

  enableControls() {
    document.getElementById("message-input").disabled = false;
    document.getElementById("send-btn").disabled = false;
    document.getElementById("share-file-btn").disabled = false;
    document.getElementById("target-user").disabled = false;
  }

  sendMessage() {
    const input = document.getElementById("message-input");
    const message = input.value.trim();

    if (message && this.socket) {
      this.socket.send(
        JSON.stringify({
          type: "chat_message",
          username: this.username,
          message: message,
          timestamp: new Date().toISOString(),
        })
      );
      input.value = "";
    }
  }

  displayMessage(username, message, timestamp) {
    const messagesDiv = document.getElementById("messages");
    const messageDiv = document.createElement("div");
    messageDiv.className = "message";

    const time = new Date(timestamp).toLocaleTimeString();
    messageDiv.innerHTML = `
            <div class="message-header">
                <span class="username">${username}</span>
                <span class="timestamp">${time}</span>
            </div>
            <div class="message-content">${message}</div>
        `;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  displaySystemMessage(message) {
    const messagesDiv = document.getElementById("messages");
    const messageDiv = document.createElement("div");
    messageDiv.className = "system-message";
    messageDiv.textContent = message;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  updateUsersList(users) {
    this.onlineUsers = users.filter((user) => user.username !== this.username);

    // Update users list
    const usersList = document.getElementById("users-list");
    usersList.innerHTML = "";

    users.forEach((user) => {
      const li = document.createElement("li");
      li.textContent = user.username;
      if (user.username === this.username) {
        li.classList.add("current-user");
      }
      usersList.appendChild(li);
    });

    // Update user count
    document.getElementById("user-count").textContent = `${users.length} users`;

    // Update target user dropdown
    const targetSelect = document.getElementById("target-user");
    targetSelect.innerHTML = '<option value="">Select user...</option>';

    this.onlineUsers.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.username;
      option.textContent = user.username;
      targetSelect.appendChild(option);
    });
  }

  // WebRTC File Sharing
  async createPeerConnection(targetUsername) {
    const config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    };

    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(targetUsername, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebRTCSignal(targetUsername, {
          type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    // Handle data channel
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(channel, targetUsername);
    };

    return pc;
  }

  setupDataChannel(channel, username) {
    this.dataChannels.set(username, channel);

    channel.onopen = () => {
      console.log(`📡 Data channel opened with ${username}`);
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data, username);
    };

    channel.onclose = () => {
      console.log(`📡 Data channel closed with ${username}`);
      this.dataChannels.delete(username);
    };
  }

  async initiateFileShare() {
    const fileInput = document.getElementById("file-input");
    const targetUser = document.getElementById("target-user").value;

    // Validate file input exists and has files
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      alert("Please select a file first");
      return;
    }

    // Validate target user selection
    if (!targetUser || targetUser.trim() === "") {
      alert("Please select a target user");
      return;
    }

    const file = fileInput.files[0];

    // Validate file object and properties
    if (!file) {
      alert("No file selected");
      return;
    }

    // Ensure file has required properties
    const fileName = file.name || "Unknown file";
    const fileSize = file.size || 0;

    // Additional validation
    if (fileSize === 0) {
      alert("Cannot share empty files");
      return;
    }

    // Size limit check (100MB)
    if (fileSize > 100 * 1024 * 1024) {
      alert("File too large. Maximum size is 100MB.");
      return;
    }

    console.log("📁 Sharing file:", {
      name: fileName,
      size: fileSize,
      type: file.type,
      target: targetUser,
    });

    // Store file for later transfer
    this.pendingFile = file;

    // Send file transfer request with validated data
    this.socket.send(
      JSON.stringify({
        type: "file_transfer_request",
        sender: this.username,
        target: targetUser,
        filename: fileName,
        file_size: fileSize,
        file_type: file.type || "application/octet-stream",
      })
    );

    this.displaySystemMessage(
      `Requesting file transfer to ${targetUser}: ${fileName} (${this.formatFileSize(
        fileSize
      )})`
    );
  }

  handleFileTransferRequest(sender, filename, fileSize, fileType = "file") {
    // Validate incoming data
    const safeName = filename || "Unknown file";
    const safeSize = fileSize || 0;
    const formattedSize = this.formatFileSize(safeSize);

    console.log("📁 File transfer request received:", {
      sender,
      filename: safeName,
      fileSize: safeSize,
      fileType,
    });

    const accept = confirm(
      `${sender} wants to send you a file:\n\n${safeName} (${formattedSize})\n\nAccept this file transfer?`
    );

    this.socket.send(
      JSON.stringify({
        type: "file_transfer_response",
        sender: this.username,
        target: sender,
        accepted: accept,
        filename: safeName,
        file_size: safeSize,
        file_type: fileType,
      })
    );

    if (accept) {
      this.displaySystemMessage(
        `✅ Accepting file transfer from ${sender}: ${safeName}`
      );
      // Prepare to receive file
      this.prepareFileReceive(sender, safeName, safeSize, fileType);
    } else {
      this.displaySystemMessage(
        `❌ Declined file transfer from ${sender}: ${safeName}`
      );
    }
  }

  async handleFileTransferResponse(
    sender,
    accepted,
    filename = "Unknown file"
  ) {
    if (accepted) {
      this.displaySystemMessage(
        `✅ ${sender} accepted file transfer: ${filename}. Establishing connection...`
      );
      await this.startFileTransfer(sender);
    } else {
      this.displaySystemMessage(
        `❌ ${sender} declined file transfer: ${filename}`
      );
      this.pendingFile = null;
    }
  }

  // === WebRTC CONNECTION MANAGEMENT ===

  async createPeerConnection(targetUsername) {
    const config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    };

    const pc = new RTCPeerConnection(config);
    this.peerConnections.set(targetUsername, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWebRTCSignal(targetUsername, {
          type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    // Handle data channel from remote peer
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(channel, targetUsername);
    };

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      console.log(
        `🔗 Connection state with ${targetUsername}: ${pc.connectionState}`
      );
      if (pc.connectionState === "connected") {
        this.displaySystemMessage(`🔗 Connected to ${targetUsername}`);
      } else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.displaySystemMessage(`❌ Connection lost with ${targetUsername}`);
        this.cleanupPeerConnection(targetUsername);
      }
    };

    return pc;
  }

  setupDataChannel(channel, username) {
    this.dataChannels.set(username, channel);

    channel.onopen = () => {
      console.log(`📡 Data channel opened with ${username}`);
      this.displaySystemMessage(`📡 Data channel ready with ${username}`);

      // Start file transfer if we have a pending file
      if (this.pendingFile && channel.label === "fileTransfer") {
        this.sendFile(username, this.pendingFile);
      }
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data, username);
    };

    channel.onclose = () => {
      console.log(`📡 Data channel closed with ${username}`);
      this.dataChannels.delete(username);
    };

    channel.onerror = (error) => {
      console.error(`❌ Data channel error with ${username}:`, error);
      this.displaySystemMessage(`❌ Data channel error with ${username}`);
    };
  }

  // === FILE TRANSFER IMPLEMENTATION ===

  async startFileTransfer(targetUsername) {
    try {
      const pc = await this.createPeerConnection(targetUsername);

      // Create data channel for file transfer
      const channel = pc.createDataChannel("fileTransfer", {
        ordered: true,
        maxRetransmits: 3,
      });
      this.setupDataChannel(channel, targetUsername);

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendWebRTCSignal(targetUsername, {
        type: "offer",
        offer: offer,
      });
    } catch (error) {
      console.error("Error starting file transfer:", error);
      this.displaySystemMessage("❌ Error starting file transfer");
    }
  }

  prepareFileReceive(sender, filename, fileSize, fileType) {
    // Initialize file transfer tracking
    this.fileTransfers.set(sender, {
      filename: filename,
      fileSize: fileSize,
      fileType: fileType,
      receivedChunks: [],
      receivedBytes: 0,
      startTime: Date.now(),
    });

    // Update progress display
    this.updateFileProgress(sender, 0, fileSize, "Preparing to receive...");
  }

  async sendFile(targetUsername, file) {
    try {
      const channel = this.dataChannels.get(targetUsername);
      if (!channel || channel.readyState !== "open") {
        throw new Error("Data channel not ready");
      }

      console.log(
        `📤 Starting file transfer: ${file.name} (${file.size} bytes)`
      );
      this.displaySystemMessage(
        `📤 Sending ${file.name} to ${targetUsername}...`
      );

      // Send file metadata first
      const metadata = {
        type: "file-metadata",
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
        chunkSize: this.CHUNK_SIZE,
        totalChunks: Math.ceil(file.size / this.CHUNK_SIZE),
      };

      channel.send(JSON.stringify(metadata));

      // Read file and send in chunks
      const reader = new FileReader();
      let offset = 0;
      let chunkIndex = 0;
      const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

      const sendNextChunk = () => {
        if (offset >= file.size) {
          // File transfer complete
          channel.send(
            JSON.stringify({
              type: "file-complete",
              filename: file.name,
            })
          );
          this.displaySystemMessage(`✅ File sent successfully: ${file.name}`);
          this.pendingFile = null;
          return;
        }

        const chunk = file.slice(offset, offset + this.CHUNK_SIZE);

        reader.onload = (event) => {
          const chunkData = {
            type: "file-chunk",
            chunkIndex: chunkIndex,
            data: event.target.result, // ArrayBuffer
          };

          // Send chunk metadata as JSON
          channel.send(
            JSON.stringify({
              type: "file-chunk-meta",
              chunkIndex: chunkIndex,
              size: chunk.size,
            })
          );

          // Send actual chunk data as ArrayBuffer
          channel.send(event.target.result);

          // Update progress
          const progress = Math.round((offset / file.size) * 100);
          this.updateFileProgress(
            targetUsername,
            offset,
            file.size,
            `Sending... ${progress}%`
          );

          offset += this.CHUNK_SIZE;
          chunkIndex++;

          // Send next chunk after a small delay to prevent overwhelming
          setTimeout(sendNextChunk, 10);
        };

        reader.readAsArrayBuffer(chunk);
      };

      sendNextChunk();
    } catch (error) {
      console.error("Error sending file:", error);
      this.displaySystemMessage(`❌ Error sending file: ${error.message}`);
    }
  }

  handleDataChannelMessage(data, sender) {
    try {
      // Try to parse as JSON (metadata)
      if (typeof data === "string") {
        const message = JSON.parse(data);
        this.handleFileMessage(message, sender);
      } else if (data instanceof ArrayBuffer) {
        // Binary data (file chunk)
        this.handleFileChunk(data, sender);
      }
    } catch (error) {
      console.error("Error handling data channel message:", error);
    }
  }

  handleFileMessage(message, sender) {
    const transfer = this.fileTransfers.get(sender);

    switch (message.type) {
      case "file-metadata":
        console.log(`📁 Receiving file metadata:`, message);
        this.updateFileProgress(
          sender,
          0,
          message.fileSize,
          "Starting download..."
        );
        break;

      case "file-chunk-meta":
        // Store chunk metadata for next binary data
        if (transfer) {
          transfer.nextChunkIndex = message.chunkIndex;
          transfer.nextChunkSize = message.size;
        }
        break;

      case "file-complete":
        this.completeFileReceive(sender);
        break;
    }
  }

  handleFileChunk(arrayBuffer, sender) {
    const transfer = this.fileTransfers.get(sender);
    if (!transfer) {
      console.error("No active transfer found for sender:", sender);
      return;
    }

    // Store chunk
    transfer.receivedChunks.push({
      index: transfer.nextChunkIndex || transfer.receivedChunks.length,
      data: arrayBuffer,
    });

    transfer.receivedBytes += arrayBuffer.byteLength;

    // Update progress
    const progress = Math.round(
      (transfer.receivedBytes / transfer.fileSize) * 100
    );
    this.updateFileProgress(
      sender,
      transfer.receivedBytes,
      transfer.fileSize,
      `Downloading... ${progress}%`
    );

    console.log(
      `📦 Received chunk ${transfer.receivedChunks.length} (${arrayBuffer.byteLength} bytes)`
    );
  }

  completeFileReceive(sender) {
    const transfer = this.fileTransfers.get(sender);
    if (!transfer) return;

    try {
      // Sort chunks by index to ensure correct order
      transfer.receivedChunks.sort((a, b) => a.index - b.index);

      // Combine all chunks into a single blob
      const chunks = transfer.receivedChunks.map((chunk) => chunk.data);
      const blob = new Blob(chunks, { type: transfer.fileType });

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = transfer.filename;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Cleanup
      URL.revokeObjectURL(url);
      this.fileTransfers.delete(sender);

      const duration = ((Date.now() - transfer.startTime) / 1000).toFixed(1);
      this.displaySystemMessage(
        `✅ File received: ${transfer.filename} (${duration}s)`
      );
      this.updateFileProgress(
        sender,
        transfer.fileSize,
        transfer.fileSize,
        "Complete!"
      );

      console.log(`✅ File download complete: ${transfer.filename}`);
    } catch (error) {
      console.error("Error completing file receive:", error);
      this.displaySystemMessage(`❌ Error receiving file: ${error.message}`);
    }
  }

  // === PROGRESS TRACKING ===

  updateFileProgress(user, received, total, status) {
    const progressDiv = document.getElementById("file-progress");
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    const receivedMB = (received / (1024 * 1024)).toFixed(2);
    const totalMB = (total / (1024 * 1024)).toFixed(2);

    progressDiv.innerHTML = `
        <div class="transfer-info">
            <strong>Transfer with ${user}</strong><br>
            Status: ${status}<br>
            Progress: ${receivedMB}MB / ${totalMB}MB (${percentage}%)
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${percentage}%"></div>
            </div>
        </div>
    `;
  }

  // === CLEANUP ===

  cleanupPeerConnection(username) {
    if (this.peerConnections.has(username)) {
      this.peerConnections.get(username).close();
      this.peerConnections.delete(username);
    }

    if (this.dataChannels.has(username)) {
      this.dataChannels.delete(username);
    }

    if (this.fileTransfers.has(username)) {
      this.fileTransfers.delete(username);
    }
  }

  // === WebRTC SIGNALING ===

  async handleWebRTCSignal(sender, data) {
    try {
      let pc = this.peerConnections.get(sender);

      if (data.type === "offer") {
        if (!pc) {
          pc = await this.createPeerConnection(sender);
        }

        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendWebRTCSignal(sender, {
          type: "answer",
          answer: answer,
        });
      } else if (data.type === "answer") {
        if (pc) {
          await pc.setRemoteDescription(data.answer);
        }
      } else if (data.type === "ice-candidate") {
        if (pc && data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      }
    } catch (error) {
      console.error("Error handling WebRTC signal:", error);
    }
  }

  sendWebRTCSignal(target, data) {
    this.socket.send(
      JSON.stringify({
        type: "webrtc_signal",
        sender: this.username,
        target: target,
        data: data,
      })
    );
  }

  async startFileTransfer(targetUsername) {
    try {
      const pc = await this.createPeerConnection(targetUsername);

      // Create data channel for file transfer
      const channel = pc.createDataChannel("fileTransfer", {
        ordered: true,
      });
      this.setupDataChannel(channel, targetUsername);

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendWebRTCSignal(targetUsername, {
        type: "offer",
        offer: offer,
      });
    } catch (error) {
      console.error("Error starting file transfer:", error);
      this.displaySystemMessage("Error starting file transfer");
    }
  }

  async handleWebRTCSignal(sender, data) {
    try {
      let pc = this.peerConnections.get(sender);

      if (data.type === "offer") {
        if (!pc) {
          pc = await this.createPeerConnection(sender);
        }

        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendWebRTCSignal(sender, {
          type: "answer",
          answer: answer,
        });
      } else if (data.type === "answer") {
        if (pc) {
          await pc.setRemoteDescription(data.answer);
        }
      } else if (data.type === "ice-candidate") {
        if (pc && data.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      }
    } catch (error) {
      console.error("Error handling WebRTC signal:", error);
    }
  }

  sendWebRTCSignal(target, data) {
    this.socket.send(
      JSON.stringify({
        type: "webrtc_signal",
        sender: this.username,
        target: target,
        data: data,
      })
    );
  }

  handleDataChannelMessage(data, sender) {
    // Handle received file data
    console.log(`📁 Received data from ${sender}:`, data);
    this.displaySystemMessage(`Received file data from ${sender}`);
  }

  formatFileSize(bytes) {
    // Handle edge cases
    if (!bytes || bytes === 0 || isNaN(bytes)) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Ensure we don't go out of bounds
    const sizeIndex = Math.min(i, sizes.length - 1);
    const formattedSize = parseFloat(
      (bytes / Math.pow(k, sizeIndex)).toFixed(2)
    );

    return `${formattedSize} ${sizes[sizeIndex]}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new WebRTCChat();
});
