// WebRTC connections and signaling
export class WebRTCManager {
  constructor(signalCallback, messageCallback) {
    this.peerConnections = new Map();
    this.dataChannels = new Map();
    this.connectionAttempts = new Map();
    this.signalCallback = signalCallback;
    this.messageCallback = messageCallback;
    this.MAX_RETRY_ATTEMPTS = 3;

    this.config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
  }

  async createPeerConnection(targetUsername) {
    console.log(`🔗 Creating peer connection with ${targetUsername}`);

    const pc = new RTCPeerConnection(this.config);
    this.peerConnections.set(targetUsername, pc);

    // ICE candidate handling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(
          `🧊 ICE candidate for ${targetUsername}:`,
          event.candidate.type
        );
        this.signalCallback(targetUsername, {
          type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    // ICE connection state monitoring
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`🧊 ICE connection state with ${targetUsername}: ${state}`);
      this.handleConnectionStateChange(targetUsername, state);
    };

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`🔗 Connection state with ${targetUsername}: ${state}`);
      this.messageCallback("connectionStateChange", {
        username: targetUsername,
        state,
      });
    };

    // Data channel from remote peer
    pc.ondatachannel = (event) => {
      console.log(`📡 Received data channel from ${targetUsername}`);
      this.setupDataChannel(event.channel, targetUsername);
    };

    return pc;
  }

  setupDataChannel(channel, username) {
    console.log(
      `📡 Setting up data channel with ${username}: ${channel.label}`
    );
    this.dataChannels.set(username, channel);

    channel.onopen = () => {
      console.log(`✅ Data channel opened with ${username}`);
      this.messageCallback("dataChannelOpen", { username });
    };

    channel.onmessage = (event) => {
      console.log(
        `📨 Data channel message from ${username}:`,
        typeof event.data
      );
      this.messageCallback("dataChannelMessage", {
        username,
        data: event.data,
      });
    };

    channel.onclose = () => {
      console.log(`📡 Data channel closed with ${username}`);
      this.dataChannels.delete(username);
      this.messageCallback("dataChannelClose", { username });
    };

    channel.onerror = (error) => {
      console.error(`❌ Data channel error with ${username}:`, error);
      this.messageCallback("dataChannelError", { username, error });
    };

    // Set buffer thresholds for better performance
    if (channel.bufferedAmountLowThreshold !== undefined) {
      channel.bufferedAmountLowThreshold = 64 * 1024;
    }
  }

  async createOffer(targetUsername) {
    try {
      const pc = await this.createPeerConnection(targetUsername);

      // Create data channel for file transfer
      const channel = pc.createDataChannel("fileTransfer", {
        ordered: true,
        maxPacketLifeTime: 3000,
        protocol: "file-transfer-v1",
      });

      this.setupDataChannel(channel, targetUsername);

      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });

      await pc.setLocalDescription(offer);

      console.log(`📤 Sending offer to ${targetUsername}`);
      this.signalCallback(targetUsername, {
        type: "offer",
        offer: offer,
      });
    } catch (error) {
      console.error("❌ Error creating offer:", error);
      throw error;
    }
  }

  async handleSignal(sender, data) {
    try {
      let pc = this.peerConnections.get(sender);

      console.log(`📡 Handling WebRTC signal from ${sender}: ${data.type}`);

      if (data.type === "offer") {
        if (!pc) {
          pc = await this.createPeerConnection(sender);
        }

        await pc.setRemoteDescription(data.offer);

        const answer = await pc.createAnswer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });

        await pc.setLocalDescription(answer);

        console.log(`📤 Sending answer to ${sender}`);
        this.signalCallback(sender, {
          type: "answer",
          answer: answer,
        });
      } else if (data.type === "answer") {
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(data.answer);
          console.log(`✅ Answer processed from ${sender}`);
        }
      } else if (data.type === "ice-candidate") {
        if (pc && pc.remoteDescription && data.candidate) {
          await pc.addIceCandidate(data.candidate);
          console.log(`🧊 ICE candidate added from ${sender}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error handling WebRTC signal from ${sender}:`, error);
      throw error;
    }
  }

  handleConnectionStateChange(targetUsername, state) {
    switch (state) {
      case "connected":
      case "completed":
        this.messageCallback("iceConnected", { username: targetUsername });
        this.connectionAttempts.delete(targetUsername);
        break;

      case "disconnected":
        this.messageCallback("iceDisconnected", { username: targetUsername });
        setTimeout(() => {
          const pc = this.peerConnections.get(targetUsername);
          if (pc && pc.iceConnectionState === "disconnected") {
            this.restartIce(targetUsername);
          }
        }, 5000);
        break;

      case "failed":
        this.messageCallback("iceFailed", { username: targetUsername });
        this.handleConnectionFailure(targetUsername);
        break;

      case "closed":
        this.messageCallback("iceClosed", { username: targetUsername });
        this.cleanupPeerConnection(targetUsername);
        break;
    }
  }

  async handleConnectionFailure(targetUsername) {
    const attempts = this.connectionAttempts.get(targetUsername) || 0;

    if (attempts < this.MAX_RETRY_ATTEMPTS) {
      this.connectionAttempts.set(targetUsername, attempts + 1);
      console.log(
        `🔄 Retrying connection to ${targetUsername} (attempt ${attempts + 1})`
      );

      this.cleanupPeerConnection(targetUsername);

      setTimeout(async () => {
        try {
          await this.createOffer(targetUsername);
        } catch (error) {
          console.error(`❌ Retry failed for ${targetUsername}:`, error);
        }
      }, 2000 * (attempts + 1));
    } else {
      this.messageCallback("connectionFailed", { username: targetUsername });
      this.connectionAttempts.delete(targetUsername);
    }
  }

  async restartIce(targetUsername) {
    const pc = this.peerConnections.get(targetUsername);
    if (pc && pc.connectionState !== "closed") {
      try {
        console.log(`🔄 Restarting ICE for ${targetUsername}`);
        await pc.restartIce();
      } catch (error) {
        console.error(`❌ ICE restart failed for ${targetUsername}:`, error);
      }
    }
  }

  getDataChannel(username) {
    return this.dataChannels.get(username);
  }

  cleanupPeerConnection(username) {
    if (this.peerConnections.has(username)) {
      this.peerConnections.get(username).close();
      this.peerConnections.delete(username);
    }

    if (this.dataChannels.has(username)) {
      this.dataChannels.delete(username);
    }

    if (this.connectionAttempts.has(username)) {
      this.connectionAttempts.delete(username);
    }
  }

  cleanup() {
    for (const [username] of this.peerConnections) {
      this.cleanupPeerConnection(username);
    }
  }
}
