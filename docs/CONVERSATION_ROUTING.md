# NEUROGENESIS conversation routing

The primary **Отправить** action is a conversational turn: it calls the configured language-model gateway with the active dialogue thread and relevant local-memory excerpts. It does not write new long-term memories.

The secondary **Найти в моей памяти** action keeps the previous retrieval-only behaviour and never asks the generative model to invent an answer.

If the gateway is not configured or temporarily unavailable, common social prompts receive a local, honest response. Other prompts fall back to local retrieval; the interface does not expose provider stack traces or low-level file errors as chat replies.

A memory write remains a separate explicit action. Training the contextual masked-token model and updating the conversational language model are separate operations; the former must not be described as fine-tuning the latter.
