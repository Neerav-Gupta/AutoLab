"""
AutoLab configuration — reads from .env file or environment variables.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from pathlib import Path


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SSH
    ssh_host: str = Field(default="", alias="SSH_HOST")
    ssh_port: int = Field(default=22, alias="SSH_PORT")
    ssh_user: str = Field(default="root", alias="SSH_USER")
    ssh_key_path: str = Field(default="~/.ssh/id_ed25519", alias="SSH_KEY_PATH")
    workspace: str = Field(default="/workspace", alias="WORKSPACE")

    # LLM — LiteLLM model string
    model: str = Field(default="gemini/gemini-2.5-flash", alias="MODEL")

    # API keys (LiteLLM reads these from env automatically)
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")

    # Agent
    max_iterations: int = Field(default=25, alias="MAX_ITERATIONS")
    tool_timeout: int = Field(default=600, alias="TOOL_TIMEOUT")

    # Notifications
    webhook_url: str = Field(default="", alias="WEBHOOK_URL")
    notify_email: str = Field(default="", alias="NOTIFY_EMAIL")
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    smtp_from: str = Field(default="autolab@localhost", alias="SMTP_FROM")

    # Server
    ui_host: str = Field(default="0.0.0.0", alias="UI_HOST")
    ui_port: int = Field(default=7860, alias="UI_PORT")

    @property
    def ssh_key_expanded(self) -> str:
        return str(Path(self.ssh_key_path).expanduser())


# Singleton
config = Config()