// UI updates and DOM manipulation
import { Utils } from "./utils.js";

export class UIManager {
  constructor() {
    this.elements = this.initializeElements();
  }

  initializeElements() {
    return {
      joinModal: document.getElementById("join-modal"),
      usernameInput: document.getElementById("username-input"),
      roomInput: document.getElementById("room-input"),
      joinBtn: document.getElementById("join-btn"),

      roomId: document.getElementById("room-id"),
      userCount: document.getElementById("user-count"),
      usersList: document.getElementById("users-list"),

      messages: document.getElementById("messages"),
      messageInput: document.getElementById("message-input"),
      sendBtn: document.getElementById("send-btn"),

      fileInput: document.getElementById("file-input"),
      fileInfo: document.getElementById("file-info"),
      shareFileBtn: document.getElementById("share-file-btn"),
      targetUser: document.getElementById("target-user"),
      fileProgress: document.getElementById("file-progress"),
    };
  }

  showJoinModal() {
    this.elements.joinModal.style.display = "flex";
  }

  hideJoinModal() {
    this.elements.joinModal.style.display = "none";
  }

  enableControls() {
    this.elements.messageInput.disabled = false;
    this.elements.sendBtn.disabled = false;
    this.elements.shareFileBtn.disabled = false;
    this.elements.targetUser.disabled = false;
  }

  updateRoomInfo(roomId) {
    this.elements.roomId.textContent = `Room: ${roomId}`;
  }

  updateFileInfo() {
    const fileInput = this.elements.fileInput;
    const fileInfo = this.elements.fileInfo;

    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const fileName = file.name || "Unknown";
      const fileSize = Utils.formatFileSize(file.size || 0);
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

  displayMessage(username, message, timestamp) {
    const messagesDiv = this.elements.messages;
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
    const messagesDiv = this.elements.messages;
    const messageDiv = document.createElement("div");
    messageDiv.className = "system-message";
    messageDiv.textContent = message;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  updateUsersList(users, currentUsername) {
    const onlineUsers = users.filter(
      (user) => user.username !== currentUsername
    );

    // Update users list
    const usersList = this.elements.usersList;
    usersList.innerHTML = "";

    users.forEach((user) => {
      const li = document.createElement("li");
      li.textContent = user.username;
      if (user.username === currentUsername) {
        li.classList.add("current-user");
      }
      usersList.appendChild(li);
    });

    // Update user count
    this.elements.userCount.textContent = `${users.length} users`;

    // Update target user dropdown
    const targetSelect = this.elements.targetUser;
    targetSelect.innerHTML = '<option value="">Select user...</option>';

    onlineUsers.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.username;
      option.textContent = user.username;
      targetSelect.appendChild(option);
    });

    return onlineUsers;
  }

  updateFileProgress(user, received, total, status) {
    const progressDiv = this.elements.fileProgress;
    const percentage = total > 0 ? Math.round((received / total) * 100) : 0;
    const receivedMB = (received / (1024 * 1024)).toFixed(2);
    const totalMB = (total / (1024 * 1024)).toFixed(2);

    // Update or create progress display
    let transferDiv = progressDiv.querySelector(".transfer-progress");
    if (!transferDiv) {
      transferDiv = document.createElement("div");
      transferDiv.className = "transfer-progress";
      progressDiv.appendChild(transferDiv);
    }

    transferDiv.innerHTML = `
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

  updateConnectionStatus(username, status) {
    const progressDiv = this.elements.fileProgress;
    const statusDiv =
      progressDiv.querySelector(".connection-status") ||
      document.createElement("div");

    statusDiv.className = "connection-status";
    statusDiv.innerHTML = `
            <div class="status-item">
                <strong>Connection to ${username}:</strong> 
                <span class="status-${status
                  .toLowerCase()
                  .replace(/[^a-z]/g, "")}">${status}</span>
            </div>
        `;

    if (!progressDiv.querySelector(".connection-status")) {
      progressDiv.appendChild(statusDiv);
    }
  }

  getSelectedFile() {
    return this.elements.fileInput.files?.[0] || null;
  }

  getTargetUser() {
    return this.elements.targetUser.value?.trim() || "";
  }

  getMessageInput() {
    return this.elements.messageInput.value.trim();
  }

  clearMessageInput() {
    this.elements.messageInput.value = "";
  }

  getCredentials() {
    return {
      username: this.elements.usernameInput.value.trim(),
      room: this.elements.roomInput.value.trim(),
    };
  }
}
