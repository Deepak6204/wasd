from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
import json
import asyncio
import logging
from .models import User, Room

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Room management
        self.rooms: Dict[str, Room] = {}
        # WebSocket connections - socket_id -> WebSocket
        self.active_connections: Dict[str, WebSocket] = {}
        # User mappings
        self.user_sockets: Dict[str, str] = {}  # username -> socket_id
        self.socket_users: Dict[str, str] = {}  # socket_id -> username
        self.socket_rooms: Dict[str, str] = {}  # socket_id -> room_id

    async def connect(self, websocket: WebSocket, socket_id: str):
        """Accept WebSocket connection"""
        await websocket.accept()
        self.active_connections[socket_id] = websocket
        logger.info(f"🔌 WebSocket connected: {socket_id}")
        logger.info(f"📊 Total connections: {len(self.active_connections)}")

    def disconnect(self, socket_id: str):
        """Remove WebSocket connection"""
        # Get user info before cleanup
        username = self.socket_users.get(socket_id)
        room_id = self.socket_rooms.get(socket_id)
        
        # Remove from active connections
        if socket_id in self.active_connections:
            del self.active_connections[socket_id]
        
        # Clean up user mappings
        if username:
            if username in self.user_sockets:
                del self.user_sockets[username]
            del self.socket_users[socket_id]
        
        # Clean up room mapping
        if socket_id in self.socket_rooms:
            del self.socket_rooms[socket_id]
        
        logger.info(f"❌ WebSocket disconnected: {socket_id} (user: {username})")
        logger.info(f"📊 Total connections: {len(self.active_connections)}")

    async def join_room(self, socket_id: str, room_id: str, username: str):
        """Add user to a room"""
        # Store user mappings
        old_username = self.socket_users.get(socket_id)
        if old_username and old_username != username:
            # Clean up old username mapping
            if old_username in self.user_sockets:
                del self.user_sockets[old_username]
        
        self.user_sockets[username] = socket_id
        self.socket_users[socket_id] = username
        self.socket_rooms[socket_id] = room_id

        # Create room if it doesn't exist
        if room_id not in self.rooms:
            self.rooms[room_id] = Room(room_id=room_id, users=[])

        room = self.rooms[room_id]
        
        # Remove existing user entry (in case of reconnection)
        room.users = [u for u in room.users if u.id != socket_id and u.username != username]
        
        # Add new user
        user = User(id=socket_id, username=username, socket_id=socket_id)
        room.users.append(user)

        # Debug logging
        logger.info(f"🏠 User {username} ({socket_id}) joined room {room_id}")
        logger.info(f"📋 Room {room_id} users: {[u.username for u in room.users]}")
        logger.info(f"📋 User mappings: {self.user_sockets}")

        # Notify room about new user
        await self.broadcast_to_room(room_id, {
            "type": "user_joined",
            "username": username,
            "message": f"{username} has joined the room!"
        }, exclude_socket=socket_id)

        # Send updated user list
        await self.send_user_list(room_id)

    async def leave_room(self, socket_id: str, room_id: str):
        """Remove user from room"""
        if room_id not in self.rooms:
            return

        room = self.rooms[room_id]
        username = self.socket_users.get(socket_id)
        
        # Remove user from room
        initial_count = len(room.users)
        room.users = [u for u in room.users if u.id != socket_id]
        
        if len(room.users) < initial_count and username:
            logger.info(f"🚪 User {username} left room {room_id}")
            await self.broadcast_to_room(room_id, {
                "type": "user_left",
                "username": username,
                "message": f"{username} has left the room!"
            })

        # Send updated user list
        await self.send_user_list(room_id)
        
        # Remove empty room
        if not room.users:
            del self.rooms[room_id]
            logger.info(f"🗑️ Removed empty room {room_id}")

    async def send_personal_message(self, socket_id: str, message: dict):
        """Send message to specific WebSocket"""
        if socket_id in self.active_connections:
            websocket = self.active_connections[socket_id]
            try:
                message_str = json.dumps(message)
                await websocket.send_text(message_str)
                logger.info(f"✅ Sent message to {socket_id}: {message.get('type', 'unknown')}")
                return True
            except Exception as e:
                logger.error(f"❌ Error sending personal message to {socket_id}: {e}")
                self.disconnect(socket_id)
                return False
        else:
            logger.warning(f"❌ Socket {socket_id} not found in active connections")
            return False

    async def send_to_user(self, username: str, message: dict):
        """Send message to user by username"""
        socket_id = self.user_sockets.get(username)
        logger.info(f"📤 Attempting to send to user {username} (socket: {socket_id})")
        logger.info(f"📋 Available users: {list(self.user_sockets.keys())}")
        
        if socket_id:
            success = await self.send_personal_message(socket_id, message)
            if success:
                logger.info(f"✅ Successfully sent {message.get('type')} to {username}")
            else:
                logger.error(f"❌ Failed to send {message.get('type')} to {username}")
            return success
        else:
            logger.warning(f"❌ User {username} not found for message delivery")
            logger.info(f"📋 Current user mappings: {self.user_sockets}")
            return False

    async def broadcast_to_room(self, room_id: str, message: dict, exclude_socket: str = None):
        """Broadcast message to all users in room"""
        if room_id not in self.rooms:
            logger.warning(f"❌ Room {room_id} not found for broadcast")
            return
            
        room = self.rooms[room_id]
        successful_sends = 0
        disconnected_sockets = []
        
        logger.info(f"📡 Broadcasting {message.get('type')} to room {room_id} ({len(room.users)} users)")
        
        for user in room.users:
            if user.socket_id != exclude_socket:
                websocket = self.active_connections.get(user.socket_id)
                if websocket:
                    try:
                        await websocket.send_text(json.dumps(message))
                        successful_sends += 1
                        logger.debug(f"✅ Sent to {user.username}")
                    except Exception as e:
                        logger.error(f"❌ Error broadcasting to {user.username}: {e}")
                        disconnected_sockets.append(user.socket_id)
                else:
                    logger.warning(f"❌ WebSocket not found for {user.username}")
                    disconnected_sockets.append(user.socket_id)
        
        logger.info(f"📡 Broadcast complete: {successful_sends} successful sends")
        
        # Clean up disconnected sockets
        for socket_id in disconnected_sockets:
            self.disconnect(socket_id)

    async def send_user_list(self, room_id: str):
        """Send updated user list to room"""
        if room_id in self.rooms:
            room = self.rooms[room_id]
            user_list = [{"username": u.username, "id": u.id} for u in room.users]
            await self.broadcast_to_room(room_id, {
                "type": "online_users",
                "users": user_list
            })
            logger.info(f"📋 Sent user list to room {room_id}: {[u['username'] for u in user_list]}")

    def get_room_users(self, room_id: str) -> List[dict]:
        """Get list of users in room"""
        if room_id in self.rooms:
            return [{"username": u.username, "id": u.id} for u in self.rooms[room_id].users]
        return []

    def get_debug_info(self) -> dict:
        """Get debug information"""
        return {
            "rooms": {rid: {"users": [u.dict() for u in room.users]} for rid, room in self.rooms.items()},
            "active_connections": list(self.active_connections.keys()),
            "user_sockets": self.user_sockets,
            "socket_users": self.socket_users,
            "socket_rooms": self.socket_rooms,
            "total_connections": len(self.active_connections)
        }

# Global connection manager instance
manager = ConnectionManager()
