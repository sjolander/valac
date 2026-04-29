# Valac

**Self-hosted AI with intelligent memory management**

Valac is a solo-developed personal AI assistant focused on offline, memory-augmented interactions. It builds a persistent memory of your interactions, creating increasingly personalized responses over time.

**Key Features:**

- Semantic memory via **vector embeddings** and **similarity search**
- Verbatim conversation memory via Postgres
- Local-first LLM orchestration with **no cloud dependencies**
- Thoughtful architecture for **future agent-like functionality**
- **Built with**: Python, TypeScript, React, Qdrant, PostgreSQL, Ollama

Valac stores and categorizes every interaction, then uses related memories from your history to provide more contextual, personalized responses as your conversation history grows.

```mermaid
graph TD;
    User --> UI[React Frontend]
    UI --> API[Python Backend<br/>- REST API<br/>- Scheduling<br/>- Memory Management]
    API --> LLM[Ollama LLM<br/>- Embedding<br/>- Prompt Generation<br/>- Title & Topic Generation]
    API --> VDB[Qdrant Vector DB<br/>- Topic Storage<br/>- Top K Semantic Memory Retrieval]
    API --> PostgreSQL[PostgreSQL DB<br/> Conversation History]


    API --> UI
    UI --> User

    style UI fill:#e1f5fe
    style API fill:#f3e5f5
    style LLM fill:#e8f5e8
    style VDB fill:#fff3e0
```

## Current Status: Functional for extended personalized conversations

## ✅ Phase 1: Proof of Concept

Goal: A self-contained, local system that runs end-to-end.

- [x] React + Vite frontend sends user input to backend
- [x] Node.js backend with `/ask` endpoint
- [x] Ollama LLM (e.g., Mistral) running locally
- [x] Generate embeddings from user prompts
- [x] Store and query vector data using Qdrant (previously Chroma)
- [x] Inject relevant memory into prompt to LLM
- [x] Return LLM response to user
- [x] Persist assistant responses to memory
- [x] Enforce minimum similarity (distance threshold) on memory query results

---

## 🔜 Phase 2: Memory Management

Goal: Sidestep hallucinations by trimming and summarizing memories

- [x] Add time to memories
- [x] Streaming response in UI
- [x] Show UI indication of memory updates
- [x] Add tags/topics to memories
- [x] Track conversation/session IDs
- [ ] Allow ability for user to spawn multiple threads based from the same conversation.
- [ ] Memory summarization
- [ ] Add topic viewer to UI
  - [x] Initial graph visualization
- [ ] Manual tag editing
- [ ] Memory deletion from UI
- [ ] Memory locks in UI - User marks a memory/topic/conversation as permanent and not a candidate for deletion and/or summarization
- [ ] DB size limit control in UI

---

## 🔜 Phase 3: Agency and Autonomous Behavior

Goal: Agency and passive memory management

- [x] Add automatic web search functionality
- [ ] Enable Valac to trim its own memory autonomously - consider memory importance based on frequency of access & relation to other topics
- [ ]
- [ ] Integrate LangChain plugins
- [ ] User selectable LLM models for both the core LLM (used for prompt generation) and auxiliary LLM (used for tag generation)

---

## 🎯 Phase 4: Hosting, Deployment, and UX Polish

Goal: Cloud-based deployment for quick demonstrations

- [ ] Deploy backend (Render, Fly.io, etc.)
- [ ] Deploy frontend (Vercel, Netlify, etc.)
- [ ] Add authentication, rate limiting, logging
- [ ] Improve error handling and user feedback
- [ ] Seed with memories

## Design Philosophy

Valac explores what a personal, local-first AI assistant could look like — one with long-term memory, contextual awareness, and plugin-based actionability. The project is designed with future capabilities in mind:

- Conversational memory that evolves over time
- Plugin system enabling agentic behaviors ("call a taxi", "remind me", "search the web")
- LoRA-ready architecture for eventual fine-tuning
