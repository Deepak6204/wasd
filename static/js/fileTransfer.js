// File transfer logic with Firefox compatibility fixes - COMPLETE VERSION
export class FileTransferManager {
  constructor(webrtcManager, uiManager) {
    this.webrtcManager = webrtcManager;
    this.uiManager = uiManager;
    this.fileTransfers = new Map();

    // Firefox needs smaller chunk sizes for reliability
    this.isFirefox = navigator.userAgent.toLowerCase().includes("firefox");
    this.CHUNK_SIZE = this.isFirefox ? 8 * 1024 : 16 * 1024; // 8KB for Firefox, 16KB for Chrome
    this.pendingFile = null;

    console.log(
      `📁 File transfer chunk size: ${this.CHUNK_SIZE} bytes (${
        this.isFirefox ? "Firefox" : "Chrome/Brave"
      } mode)`
    );
  }

  prepareFileReceive(sender, filename, fileSize, fileType) {
    console.log(`📁 Preparing to receive file from ${sender}: ${filename}`);

    this.fileTransfers.set(sender, {
      filename: filename,
      fileSize: fileSize,
      fileType: fileType,
      receivedChunks: [],
      receivedBytes: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
      lastBytes: 0,
      nextChunkIndex: 0,
      nextChunkSize: 0,
      expectedChunkSize: this.CHUNK_SIZE,
      senderBrowser: "Unknown",
    });

    this.uiManager.updateFileProgress(
      sender,
      0,
      fileSize,
      "Preparing to receive..."
    );
  }

  async sendFile(targetUsername, file) {
    try {
      const channel = this.webrtcManager.getDataChannel(targetUsername);
      if (!channel || channel.readyState !== "open") {
        throw new Error("Data channel not ready");
      }

      console.log(
        `📤 Starting file transfer: ${file.name} (${file.size} bytes)`
      );
      this.uiManager.displaySystemMessage(
        `📤 Sending ${file.name} to ${targetUsername}...`
      );
      this.uiManager.updateFileProgress(
        targetUsername,
        0,
        file.size,
        "Initializing..."
      );

      // Firefox needs to wait a bit more before starting transfer
      if (this.isFirefox) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Send file metadata first
      const metadata = {
        type: "file-metadata",
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
        chunkSize: this.CHUNK_SIZE,
        totalChunks: Math.ceil(file.size / this.CHUNK_SIZE),
        timestamp: Date.now(),
        senderBrowser: this.isFirefox ? "Firefox" : "Chrome/Brave",
      };

      channel.send(JSON.stringify(metadata));

      // Firefox needs extra delay after metadata
      if (this.isFirefox) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Send file in chunks with flow control
      await this.sendFileChunks(channel, file, targetUsername);
    } catch (error) {
      console.error("❌ Error sending file:", error);
      this.uiManager.displaySystemMessage(
        `❌ Error sending file: ${error.message}`
      );
      this.uiManager.updateFileProgress(targetUsername, 0, 0, "Failed!");
    }
  }

  async sendFileChunks(channel, file, targetUsername) {
    let offset = 0;
    let chunkIndex = 0;

    const sendNextChunk = () => {
      return new Promise((resolve, reject) => {
        if (offset >= file.size) {
          // File transfer complete
          channel.send(
            JSON.stringify({
              type: "file-complete",
              filename: file.name,
              timestamp: Date.now(),
            })
          );

          this.uiManager.displaySystemMessage(
            `✅ File sent successfully: ${file.name}`
          );
          this.uiManager.updateFileProgress(
            targetUsername,
            file.size,
            file.size,
            "Complete!"
          );
          this.pendingFile = null;
          resolve();
          return;
        }

        // Enhanced buffer management for Firefox
        const bufferThreshold = this.isFirefox ? 32 * 1024 : 64 * 1024;
        if (channel.bufferedAmount > bufferThreshold) {
          // Firefox needs longer waits for buffer to drain
          const waitTime = this.isFirefox ? 50 : 10;
          setTimeout(() => {
            sendNextChunk().then(resolve).catch(reject);
          }, waitTime);
          return;
        }

        const chunk = file.slice(offset, offset + this.CHUNK_SIZE);
        const reader = new FileReader();

        reader.onload = (event) => {
          try {
            // Send chunk metadata
            const metaMessage = JSON.stringify({
              type: "file-chunk-meta",
              chunkIndex: chunkIndex,
              size: chunk.size,
              offset: offset,
            });

            channel.send(metaMessage);

            // Firefox needs a small delay between metadata and data
            const sendData = () => {
              channel.send(event.target.result);

              // Update progress
              const progress = Math.round((offset / file.size) * 100);
              this.uiManager.updateFileProgress(
                targetUsername,
                offset,
                file.size,
                `Sending... ${progress}%`
              );

              offset += this.CHUNK_SIZE;
              chunkIndex++;

              // Continue with next chunk
              const nextDelay = this.isFirefox ? 15 : 5;
              setTimeout(() => {
                sendNextChunk().then(resolve).catch(reject);
              }, nextDelay);
            };

            if (this.isFirefox) {
              setTimeout(sendData, 5);
            } else {
              sendData();
            }
          } catch (error) {
            reject(error);
          }
        };

        reader.onerror = () => reject(new Error("File read error"));
        reader.readAsArrayBuffer(chunk);
      });
    };

    await sendNextChunk();
  }

  handleDataChannelMessage(data, sender) {
    try {
      if (typeof data === "string") {
        const message = JSON.parse(data);
        this.handleFileMessage(message, sender);
      } else if (data instanceof ArrayBuffer) {
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
        console.log(
          `📁 Receiving file metadata from ${
            message.senderBrowser || "Unknown"
          }:`,
          message
        );
        this.uiManager.updateFileProgress(
          sender,
          0,
          message.fileSize,
          "Starting download..."
        );

        // Update transfer info with metadata
        if (transfer) {
          transfer.expectedChunkSize = message.chunkSize;
          transfer.senderBrowser = message.senderBrowser;
          transfer.totalChunks = message.totalChunks;
        }
        break;

      case "file-chunk-meta":
        if (transfer) {
          transfer.nextChunkIndex = message.chunkIndex;
          transfer.nextChunkSize = message.size;
          transfer.nextOffset = message.offset;
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

    // Store chunk with proper indexing
    transfer.receivedChunks.push({
      index: transfer.nextChunkIndex || transfer.receivedChunks.length,
      data: arrayBuffer,
      offset:
        transfer.nextOffset ||
        transfer.receivedChunks.length * transfer.expectedChunkSize,
    });

    transfer.receivedBytes += arrayBuffer.byteLength;

    // Update progress with speed calculation
    const progress = Math.round(
      (transfer.receivedBytes / transfer.fileSize) * 100
    );
    const speed = this.calculateSpeed(sender, transfer.receivedBytes);
    const speedText = speed ? ` (${speed})` : "";

    this.uiManager.updateFileProgress(
      sender,
      transfer.receivedBytes,
      transfer.fileSize,
      `Downloading... ${progress}%${speedText}`
    );

    console.log(
      `📦 Received chunk ${transfer.receivedChunks.length}/${
        transfer.totalChunks || "?"
      } (${arrayBuffer.byteLength} bytes)`
    );
  }

  completeFileReceive(sender) {
    const transfer = this.fileTransfers.get(sender);
    if (!transfer) {
      console.error("No transfer found for completion:", sender);
      return;
    }

    try {
      console.log(
        `📥 Completing file receive from ${sender}: ${transfer.filename}`
      );

      // Sort chunks by index to ensure correct order
      transfer.receivedChunks.sort((a, b) => a.index - b.index);

      // Combine all chunks into a single blob
      const chunks = transfer.receivedChunks.map((chunk) => chunk.data);
      const blob = new Blob(chunks, { type: transfer.fileType });

      // Verify file size
      if (blob.size !== transfer.fileSize) {
        console.warn(
          `⚠️ File size mismatch: expected ${transfer.fileSize}, got ${blob.size}`
        );
      }

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
      this.uiManager.displaySystemMessage(
        `✅ File received: ${transfer.filename} (${duration}s)`
      );
      this.uiManager.updateFileProgress(
        sender,
        transfer.fileSize,
        transfer.fileSize,
        "Complete!"
      );

      console.log(
        `✅ File download complete: ${transfer.filename} (${transfer.receivedChunks.length} chunks)`
      );
    } catch (error) {
      console.error("Error completing file receive:", error);
      this.uiManager.displaySystemMessage(
        `❌ Error receiving file: ${error.message}`
      );
      this.fileTransfers.delete(sender);
    }
  }

  calculateSpeed(sender, receivedBytes) {
    const transfer = this.fileTransfers.get(sender);
    if (!transfer) return null;

    const now = Date.now();

    if (transfer.lastUpdate && transfer.lastBytes !== undefined) {
      const timeDiff = (now - transfer.lastUpdate) / 1000; // seconds
      const bytesDiff = receivedBytes - transfer.lastBytes;

      if (timeDiff > 1) {
        // Calculate speed every second
        const bytesPerSecond = bytesDiff / timeDiff;

        // Update tracking values
        transfer.lastUpdate = now;
        transfer.lastBytes = receivedBytes;

        // Format speed
        if (bytesPerSecond > 1024 * 1024) {
          return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        } else if (bytesPerSecond > 1024) {
          return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        } else {
          return `${bytesPerSecond.toFixed(0)} B/s`;
        }
      }
    } else {
      // Initialize tracking
      transfer.lastUpdate = now;
      transfer.lastBytes = receivedBytes;
    }

    return null;
  }

  setPendingFile(file) {
    this.pendingFile = file;
    console.log(`📎 Pending file set: ${file ? file.name : "null"}`);
  }

  getPendingFile() {
    return this.pendingFile;
  }

  hasActiveTransfer(username) {
    return this.fileTransfers.has(username);
  }

  getTransferStatus(username) {
    const transfer = this.fileTransfers.get(username);
    if (!transfer) return null;

    return {
      filename: transfer.filename,
      progress: Math.round((transfer.receivedBytes / transfer.fileSize) * 100),
      receivedBytes: transfer.receivedBytes,
      totalBytes: transfer.fileSize,
      chunksReceived: transfer.receivedChunks.length,
      totalChunks: transfer.totalChunks || 0,
    };
  }

  cancelTransfer(username) {
    if (this.fileTransfers.has(username)) {
      console.log(`🚫 Cancelling file transfer with ${username}`);
      this.fileTransfers.delete(username);
      this.uiManager.displaySystemMessage(
        `🚫 File transfer cancelled with ${username}`
      );
    }

    if (this.pendingFile) {
      this.pendingFile = null;
      console.log(`🚫 Pending file cleared`);
    }
  }

  cleanup() {
    console.log(`🧹 Cleaning up file transfers`);
    this.fileTransfers.clear();
    this.pendingFile = null;
  }

  // Debug method
  getDebugInfo() {
    return {
      activeTransfers: Array.from(this.fileTransfers.keys()),
      pendingFile: this.pendingFile
        ? {
            name: this.pendingFile.name,
            size: this.pendingFile.size,
            type: this.pendingFile.type,
          }
        : null,
      chunkSize: this.CHUNK_SIZE,
      isFirefox: this.isFirefox,
      transferDetails: Array.from(this.fileTransfers.entries()).map(
        ([username, transfer]) => ({
          username,
          filename: transfer.filename,
          progress: Math.round(
            (transfer.receivedBytes / transfer.fileSize) * 100
          ),
          chunksReceived: transfer.receivedChunks.length,
          senderBrowser: transfer.senderBrowser,
        })
      ),
    };
  }
}
