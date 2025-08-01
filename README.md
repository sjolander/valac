# Valac Project Development Phases

This document outlines the planned phases for building out the Valac system, from a local proof of concept to a cloud-hosted, agentic assistant.

---

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

## 🔜 Phase 2: Persistence

Goal: Prepare for real-world users and long-term memory.

- [ ] Add user-selectable LLM models
- [ ] Add persistent disk-based or cloud storage
- [ ] Track conversation/session IDs
- [ ] Add memory filtering and deletion from UI

---

## 🚧 Phase 3: Scheduling, Awareness, and Agency

Goal: Add proactive behavior and time/context awareness.

- [ ] Add scheduling/task queue system
- [ ] Enable Valac to initiate actions (autonomous behavior)
- [ ] Integrate plugin/capability system (search, email, etc.)
- [ ] Maintain time awareness and deadlines
- [ ] Summarize and categorize memory by topic

---

## 🎯 Phase 4: Hosting, Deployment, and UX Polish

Goal: Transition to production-ready, demo-capable deployment.

- [ ] Deploy backend (Render, Fly.io, etc.)
- [ ] Deploy frontend (Vercel, Netlify, etc.)
- [ ] Add authentication, rate limiting, logging
- [ ] Improve error handling and user feedback
- [ ] Polish UI for memory review/editing

---

## Notes

- The system is designed to be modular: LLM backend, vector store, and storage abstraction can all be swapped independently.
- Each phase should maintain backward compatibility where possible to avoid regressions during future iteration.
