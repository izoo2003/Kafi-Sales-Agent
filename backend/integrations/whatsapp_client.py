"""WhatsApp Cloud API client stub."""


class WhatsAppClient:
    def send_message(self, *, phone: str, message: str) -> dict:
        return {
            "status": "stub",
            "message": "WhatsApp Cloud API not configured.",
            "phone": phone,
        }
