from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
import uuid
import json
import logging
from pathlib import Path

from .websocket_manager import manager
from .models import Message, WebRTCSignal

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="FastAPI WebRTC Chat", version="1.0.0")

# Static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="static")

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the main chat interface"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/{room_id}", response_class=HTMLResponse)
async def room(request: Request, room_id: str):
    """Serve room-specific chat interface"""
    return templates.TemplateResponse("index.html", {"request": request, "room_id": room_id})

@app.get("/api/rooms/{room_id}/users")
async def get_room_users(room_id: str):
    """Get users in a specific room"""
    users = manager.get_room_users(room_id)
    return {"room_id": room_id, "users": users}

@app.get("/api/debug")
async def debug_info():
    """Get server debug information"""
    return manager.get_debug_info()

@app.get("/api/debug/connections")
async def debug_connections():
    """Get detailed connection information"""
    debug_info = manager.get_debug_info()
    
    # Add connection health check
    connection_health = {}
    for socket_id, websocket in manager.active_connections.items():
        username = manager.socket_users.get(socket_id, "Unknown")
        room_id = manager.socket_rooms.get(socket_id, "Unknown")
        
        connection_health[socket_id] = {
            "username": username,
            "room_id": room_id,
            "websocket_state": str(websocket.client_state) if hasattr(websocket, 'client_state') else "Unknown"
        }
    
    debug_info["connection_health"] = connection_health
    return debug_info


@app.get("/api/debug/webrtc/{room_id}")
async def debug_webrtc(room_id: str):
    """Get WebRTC debugging information for a room"""
    room_users = manager.get_room_users(room_id)
    
    return {
        "room_id": room_id,
        "users": room_users,
        "total_users": len(room_users),
        "webrtc_tips": {
            "stun_servers": [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302"
            ],
            "common_issues": [
                "Symmetric NAT blocking connections",
                "Firewall blocking UDP ports",
                "Browser security restrictions",
                "Network timeout issues"
            ],
            "solutions": [
                "Try different network (mobile hotspot)",
                "Use TURN server for relay",
                "Check browser console for errors",
                "Ensure both users are online"
            ]
        }
    }


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """WebSocket endpoint for real-time communication"""
    socket_id = str(uuid.uuid4())
    await manager.connect(websocket, socket_id)
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message_data = json.loads(data)
            message_type = message_data.get("type")
            
            logger.info(f"📨 Received {message_type} from {socket_id}")
            
            if message_type == "join_room":
                username = message_data.get("username")
                if username:
                    await manager.join_room(socket_id, room_id, username)
                    await websocket.send_text(json.dumps({
                        "type": "join_success",
                        "room_id": room_id,
                        "socket_id": socket_id
                    }))
            
            elif message_type == "chat_message":
                username = message_data.get("username")
                message = message_data.get("message")
                if username and message:
                    await manager.broadcast_to_room(room_id, {
                        "type": "new_message",
                        "username": username,
                        "message": message,
                        "timestamp": message_data.get("timestamp")
                    })
            
            elif message_type == "webrtc_signal":
                # Handle WebRTC signaling
                sender = message_data.get("sender")
                target = message_data.get("target")
                signal_data = message_data.get("data")
                
                logger.info(f"🔄 WebRTC signal: {sender} -> {target} ({signal_data.get('type', 'unknown')})")
                
                if sender and target and signal_data:
                    success = await manager.send_to_user(target, {
                        "type": "webrtc_signal",
                        "sender": sender,
                        "data": signal_data
                    })
                    
                    if not success:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Failed to deliver WebRTC signal to {target}"
                        }))
            
            elif message_type == "file_transfer_request":
                sender = message_data.get("sender")
                target = message_data.get("target")
                filename = message_data.get("filename")
                file_size = message_data.get("file_size")
                file_type = message_data.get("file_type", "application/octet-stream")
                
                logger.info(f"📁 File transfer request: {sender} -> {target} ({filename}, {file_size} bytes)")
                
                # Validate required fields
                if not all([sender, target]):
                    logger.warning("❌ Invalid file transfer request: missing sender or target")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Invalid file transfer request"
                    }))
                    continue
                
                # Ensure file_size is a valid number
                if not isinstance(file_size, (int, float)) or file_size < 0:
                    file_size = 0
                    logger.warning(f"⚠️ Invalid file size received: {message_data.get('file_size')}")
                
                # Send file transfer request to target user
                success = await manager.send_to_user(target, {
                    "type": "file_transfer_request",
                    "sender": sender,
                    "filename": filename or "Unknown file",
                    "file_size": file_size,
                    "file_type": file_type
                })
                
                if success:
                    logger.info(f"✅ File transfer request sent to {target}")
                else:
                    logger.error(f"❌ Failed to send file transfer request to {target}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"User {target} is not available"
                    }))
            
            elif message_type == "file_transfer_response":
                sender = message_data.get("sender")
                target = message_data.get("target")
                accepted = message_data.get("accepted")
                filename = message_data.get("filename", "Unknown file")
                
                logger.info(f"📁 File transfer response: {sender} -> {target} (accepted: {accepted})")
                
                if sender and target:
                    success = await manager.send_to_user(target, {
                        "type": "file_transfer_response",
                        "sender": sender,
                        "accepted": accepted,
                        "filename": filename
                    })
                    
                    if not success:
                        logger.error(f"❌ Failed to send file transfer response to {target}")
                        
    except WebSocketDisconnect:
        logger.info(f"🔌 WebSocket disconnected: {socket_id}")
        await manager.leave_room(socket_id, room_id)
        manager.disconnect(socket_id)
    except Exception as e:
        logger.error(f"❌ WebSocket error for {socket_id}: {e}")
        await manager.leave_room(socket_id, room_id)
        manager.disconnect(socket_id)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
