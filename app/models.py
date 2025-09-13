from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class User(BaseModel):
    id: str
    username: str
    socket_id: str

class Room(BaseModel):
    room_id: str
    users: List[User] = []

class Message(BaseModel):
    room_id: str
    message: str
    username: str
    timestamp: str = datetime.now().isoformat()

class WebRTCSignal(BaseModel):
    type: str
    sender: str
    target: str
    data: Dict[str, Any]

class FileTransferRequest(BaseModel):
    sender: str
    target: str
    filename: str
    file_size: int
