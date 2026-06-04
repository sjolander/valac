from pydantic import BaseModel


class AskRequest(BaseModel):
    prompt: str
    user_id: str = "default"
    conversation_id: str = "default"
    forgetful: bool = False